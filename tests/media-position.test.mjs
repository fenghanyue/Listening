// 本地音频 + 模拟 APK：验证发给原生 MediaSession 的进度，不依赖网易云 / QQ 接口。
import fs from 'node:fs/promises';
import { BASE, launchBrowser, logicDriver, createChecker } from './lib.mjs';
import { patchMediaSessionSources } from '../mobile/scripts/patch-media-session.mjs';

const { check, finish } = createChecker();
const dir = new URL('../mobile/node_modules/@capgo/capacitor-media-session/android/src/main/java/com/capgo/mediasession/', import.meta.url);
try {
  const [plugin, service] = await Promise.all(['MediaSessionPlugin.java', 'MediaSessionService.java'].map(f => fs.readFile(new URL(f, dir), 'utf8')));
  const patched = patchMediaSessionSources(plugin, service);
  check('native progress patch can be applied repeatedly', JSON.stringify(patchMediaSessionSources(patched.plugin, patched.service)) === JSON.stringify(patched));
  let rejected = false;
  try { patchMediaSessionSources('unknown plugin source', service); } catch { rejected = true; }
  check('unrecognized native source fails instead of silently omitting the fix', rejected);
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
  console.log('SKIP  native patch checks: mobile dependencies are not installed');
}

function wav(seconds) {
  const n = 8000 * seconds, b = Buffer.alloc(44 + n, 0x80);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34);
  b.write('data', 36); b.writeUInt32LE(n, 40);
  return b;
}

function serveAudio(route, seconds) {
  const body = wav(seconds);
  const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
  const start = range ? Number(range[1]) : 0;
  const end = range && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
  return route.fulfill({
    status: range ? 206 : 200, contentType: 'audio/wav',
    headers: { 'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${start}-${end}/${body.length}` } : {}) },
    body: body.subarray(start, end + 1),
  });
}

const browser = await launchBrowser(['--autoplay-policy=no-user-gesture-required']);
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
await ctx.addInitScript(() => {
  window.__calls = [];
  window.__handlers = {};
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    PluginHeaders: [{ name: 'MediaSession', methods: [] }],
    nativePromise(plugin, method, options) {
      window.__calls.push({ plugin, method, options, at: performance.now() });
      return Promise.resolve({});
    },
    nativeCallback(plugin, method, options, cb) {
      window.__handlers[options.action] = cb;
      return 'cb-' + options.action;
    },
  };
});
const page = await ctx.newPage();
const errors = [], external = [];
page.on('pageerror', e => errors.push(String(e)));
let releaseSecond;
const secondGate = new Promise(resolve => { releaseSecond = resolve; });
await page.route('**/*', async route => {
  const u = new URL(route.request().url());
  if (u.origin !== new URL(BASE).origin) { external.push(u.href); return route.abort(); }
  if (u.pathname === '/media-position-first.wav') return serveAudio(route, 40);
  if (u.pathname === '/media-position-second.wav') {
    await secondGate;
    return serveAudio(route, 75);
  }
  return route.continue();
});
const L = logicDriver(page);
const positions = () => page.evaluate(() => window.__calls.filter(c => c.method === 'setPositionState'));
const latest = async () => (await positions()).at(-1)?.options;
const mediaState = () => page.evaluate(() => window.__calls.filter(c => c.method === 'setPlaybackState').at(-1)?.options.playbackState);
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.dc-topbar');
await page.waitForTimeout(500);
await L(`
  logic.ensureLyricsForCurrent = () => {};
  logic.prefetchTrack = () => {};
  const tracks = [
    { id: 1, duration: 400, audioUrl: arg + 'media-position-first.wav' },
    { id: 2, duration: 0, audioUrl: arg + 'media-position-second.wav' },
  ].map(t => ({ ...t, songid: String(t.id), title: 'Local track ' + t.id, artist: 'Test', album: '', cover: null, source: 'netease', detailsLoaded: true, lrc: '[00:00.00]Instrumental' }));
  logic.patch({ queue: tracks, playOrder: [1, 2], currentId: 1, playing: false });
`, BASE);
const restoring = await L(`logic.startTrack(logic.state.queue[0], 5); return window.__calls.filter(c => c.method === 'setPositionState').at(-1).options;`);
check('loading reports the requested restore position without extrapolating', restoring.duration === 400 && restoring.position === 5 && restoring.playbackRate === 0, restoring);
await page.waitForFunction(() => {
  const a = document.getElementById('player-audio');
  const last = window.__calls.filter(c => c.method === 'setPositionState').at(-1)?.options;
  return a.duration === 40 && a.currentTime > 5.1 && !a.paused && !a.seeking && last?.playbackRate === 1;
});
let p = await latest();
const actual = await L('return logic._audio.currentTime;');
check('real duration and audio clock replace the loading estimates', p.duration === 40 && Math.abs(p.position - actual) < 1.3 && p.playbackRate === 1, { reported: p, actual });

const before = (await positions()).at(-1);
await page.waitForTimeout(2400);
const updates = (await positions()).filter(c => c.at > before.at);
p = await latest();
check('playing audio sends periodic corrections from the actual audio clock', updates.length >= 1 && updates.length <= 3 && p.position > before.options.position + 1, updates.map(c => c.options));
const count = (await positions()).length;
await L(`for (let i = 0; i < 20; i++) logic._audio.dispatchEvent(new Event('timeupdate'));`);
check('a burst of timeupdate events is throttled', (await positions()).length <= count + 1);

await L(`logic._audio.dispatchEvent(new Event('waiting'));`);
p = await latest();
check('buffering immediately freezes system progress without changing playback intent', p.playbackRate === 0 && (await mediaState()) === 'playing' && await L('return logic.state.playing;'), p);
await page.waitForTimeout(1100);
check('periodic corrections do not restart extrapolation while buffering', (await latest()).playbackRate === 0);
await L(`logic._audio.dispatchEvent(new Event('playing'));`);
check('playing after buffering restores normal extrapolation immediately', (await latest()).playbackRate === 1);

await page.evaluate(() => window.__handlers.pause({}));
await page.waitForFunction(() => document.getElementById('player-audio').paused);
await page.waitForTimeout(100);
const paused = await latest();
await page.waitForTimeout(1100);
p = await latest();
check('pause freezes the reported position and state', paused.playbackRate === 0 && p.position === paused.position && (await mediaState()) === 'paused', p);
await page.evaluate(() => window.__handlers.play({}));
await page.waitForFunction(() => !document.getElementById('player-audio').paused);
await page.waitForTimeout(100);
check('resume restores playing state and speed', (await latest()).playbackRate === 1 && (await mediaState()) === 'playing');

await L(`logic._audio.currentTime = 20;`);
await page.waitForFunction(() => !document.getElementById('player-audio').seeking && document.getElementById('player-audio').currentTime >= 20);
await page.waitForTimeout(100);
p = await latest();
check('a completed seek immediately reports the resulting position', p.position >= 20 && p.position < 22 && p.playbackRate === 1, p);
await L(`logic._audio.playbackRate = 1.5;`);
await page.waitForTimeout(100);
check('playback rate changes are reflected in system extrapolation', (await latest()).playbackRate === 1.5);
await L(`logic._audio.playbackRate = 1;`);

const late = await L(`
  logic.startTrack(logic.state.queue[1]);
  // 同一轮调用中旧音频仍在，缓存读取还没返回；重放旧 metadata 事件。
  logic._audio.dispatchEvent(new Event('timeupdate'));
  logic._audio.dispatchEvent(new Event('loadedmetadata'));
  return window.__calls.filter(c => c.method === 'setPositionState').at(-1).options;
`);
p = await latest();
check('loading a track of unknown duration clears the preceding duration and position', p.duration === 0 && p.position === 0 && p.playbackRate === 0, p);
check('late time and metadata events from the previous source cannot restore its progress', late.duration === 0 && late.position === 0, late);
releaseSecond();
await page.waitForFunction(() => document.getElementById('player-audio').duration === 75 && !document.getElementById('player-audio').paused);
await page.waitForTimeout(150);
p = await latest();
check('new audio metadata replaces the cleared state with the correct duration', p.duration === 75 && p.position < 2 && p.playbackRate === 1, p);

// 单曲循环：真实 ended 事件应重播，不能先给原生会话报一次“用户暂停”。
const endMarker = await L(`
  logic.patch({ playMode: 2 });
  window.__naturalEnd = false;
  logic._audio.addEventListener('ended', () => { window.__naturalEnd = true; }, { once: true });
  const at = performance.now();
  logic._audio.playbackRate = 10;
  logic._audio.currentTime = 74.5;
  return at;
`);
await page.waitForFunction(() => {
  const a = document.getElementById('player-audio');
  return window.__naturalEnd && a.currentTime > 0 && a.currentTime < 10 && !a.paused;
});
const endStates = await page.evaluate(t => window.__calls.filter(c => c.at >= t && c.method === 'setPlaybackState').map(c => c.options.playbackState), endMarker);
check('natural ending and repeat preserve the active media session', !endStates.includes('paused') && (await mediaState()) === 'playing', endStates);
await L(`logic.unloadAudio();`);
p = await latest();
check('unloading clears duration and position and stops progress', p.duration === 0 && p.position === 0 && p.playbackRate === 0 && (await mediaState()) === 'paused', p);
const all = await positions();
check('every native position snapshot is finite and within its duration', all.every(c => {
  const { duration, position, playbackRate } = c.options;
  return [duration, position, playbackRate].every(Number.isFinite) && duration >= 0 && position >= 0 && position <= duration && playbackRate >= 0;
}));
check('no page errors', errors.length === 0, errors);
check('all audio and application resources stayed local', external.length === 0, external);
await browser.close();
process.exit(finish());

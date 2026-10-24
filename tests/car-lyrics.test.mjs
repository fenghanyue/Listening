// 本地音频 + 模拟原生壳：车载歌词开关、时间同步、去重、异步封面竞态和网页版隔离。
import { BASE, OUT, launchBrowser, logicDriver, createChecker } from './lib.mjs';

const { check, finish } = createChecker();
const browser = await launchBrowser(['--autoplay-policy=no-user-gesture-required']);
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
await ctx.addInitScript(() => {
  window.__calls = [];
  window.__coverReplies = [];
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    PluginHeaders: ['MediaSession', 'CapacitorHttp', 'AppShell'].map(name => ({ name, methods: [] })),
    nativePromise(plugin, method, options) {
      window.__calls.push({ plugin, method, options });
      if (method === 'getBatteryOptimization') return Promise.resolve({ ignoring: true });
      if (plugin === 'CapacitorHttp') return new Promise(resolve => window.__coverReplies.push(() => resolve({ status: 200, data: png, headers: { 'Content-Type': 'image/png' } })));
      return Promise.resolve({});
    },
    nativeCallback() { return 'test-callback'; },
  };
});
const samples = 60 * 8000, audio = Buffer.alloc(44 + samples, 0x80);
audio.write('RIFF', 0); audio.writeUInt32LE(36 + samples, 4); audio.write('WAVE', 8);
audio.write('fmt ', 12); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(8000, 28); audio.writeUInt16LE(1, 32); audio.writeUInt16LE(8, 34);
audio.write('data', 36); audio.writeUInt32LE(samples, 40);
const page = await ctx.newPage();
const errors = [], external = [];
page.on('pageerror', e => errors.push(String(e)));
await ctx.route('**/*', route => {
  const u = new URL(route.request().url());
  if (u.href === 'https://car-lyrics.test/slow-cover.png') return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
  if (u.origin !== new URL(BASE).origin) { external.push(u.href); return route.abort(); }
  if (u.pathname.startsWith('/car-lyrics-')) {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range && range[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav', headers: {
      'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${start}-${end}/${audio.length}` } : {}),
    }, body: audio.subarray(start, end + 1) });
  }
  return route.continue();
});
const L = logicDriver(page);
const metadata = () => page.evaluate(() => window.__calls.filter(c => c.method === 'setMetadata').map(c => c.options));
const title = async () => (await metadata()).at(-1)?.title;
const waitTitle = text => page.waitForFunction(text => window.__calls.filter(c => c.method === 'setMetadata').at(-1)?.options.title === text, text);
const seek = async time => {
  await L('logic._audio.currentTime = arg;', time);
  await page.waitForFunction(time => {
    const a = document.getElementById('player-audio');
    return !a.seeking && Math.abs(a.currentTime - time) < 0.1;
  }, time);
};
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.dc-topbar');
await L(`
  logic.prefetchTrack = () => {};
  const tracks = [
    { id: 1, title: 'Original song', cover: 'https://car-lyrics.test/slow-cover.png', lrc: ['[00:01.00]First test line', '[00:03.00]Second test line', '[00:30.00]Last test line'].join(String.fromCharCode(10)) },
    { id: 2, title: 'Instrumental song', cover: null, lrc: '[instrumental]' },
  ].map(t => ({ ...t, songid: String(90000 + t.id), artist: 'Original artist', album: 'Original album', source: 'netease', duration: 60, audioUrl: arg + 'car-lyrics-' + t.id + '.wav', detailsLoaded: true }));
  logic.patch({ queue: tracks, playOrder: [1, 2], currentId: 1, playing: false });
  logic.setPage('settings');
`, BASE);
const toggle = page.getByRole('switch', { name: '车载蓝牙歌词', exact: true });
await toggle.waitFor();
check('native setting is visible and defaults to off', await toggle.getAttribute('aria-checked') === 'false' && await L('return !logic.state.carBluetoothLyrics;'));
await L('logic.startTrack(logic.state.queue[0]);');
await page.waitForFunction(() => document.getElementById('player-audio').currentTime > 0.05);
await L('logic._audio.pause();');
await waitTitle('Original song');
check('disabled mode preserves normal metadata', (await metadata()).every(m => m.title === 'Original song'));
await toggle.click();
check('enabling is persisted and exposed to accessibility', await toggle.getAttribute('aria-checked') === 'true' && await page.evaluate(() => localStorage.getItem('listening-car-bluetooth-lyrics-v1') === '1'));
await seek(0.2);
check('intro before the first timed line displays the song title', await title() === 'Original song');
await seek(1.5);
await waitTitle('First test line');
let m = (await metadata()).at(-1);
check('a lyric update only changes the native title', Object.keys(m).join() === 'title', m);
const n = (await metadata()).length;
const covers = await page.evaluate(() => window.__calls.filter(c => c.plugin === 'CapacitorHttp').length);
await L(`for (let i = 0; i < 20; i++) logic._audio.dispatchEvent(new Event('timeupdate'));`);
check('repeated updates within one line neither resend metadata nor fetch artwork', (await metadata()).length === n && await page.evaluate(n => window.__calls.filter(c => c.plugin === 'CapacitorHttp').length === n, covers));
await page.waitForTimeout(250);
check('paused playback keeps the current lyric line', await title() === 'First test line');
await L('logic._audio.play();');
await waitTitle('Second test line');
await L('logic._audio.pause();');
check('normal playback advances lyrics without opening the lyrics page', await L('return logic.state.page === "settings" && logic.state.mediaView === "cover";'));
await page.evaluate(() => { for (const reply of window.__coverReplies.splice(0)) reply(); });
await page.waitForFunction(() => window.__calls.filter(c => c.method === 'setMetadata' && c.options.artwork).length >= 2);
check('late cover artwork preserves the current lyric title', (await metadata()).at(-1).title === 'Second test line', (await metadata()).at(-1)?.title);
const data = await L('return { track: logic.state.queue[0].title, shown: logic.renderVals().v.track.title };');
const widget = await page.evaluate(() => window.__calls.filter(c => c.method === 'updateWidget').at(-1)?.options.title);
check('library, app player and widget retain the original song title', data.track === 'Original song' && data.shown === 'Original song' && widget === 'Original song', { ...data, widget });
const position = await page.evaluate(() => window.__calls.filter(c => c.method === 'setPositionState').at(-1)?.options);
check('lyric metadata preserves the real duration and position reporting', position.duration === 60 && position.position >= 3, position);
await seek(0.2);
await waitTitle('Original song');
check('seeking backward into the intro restores the song title', await title() === 'Original song');
await seek(1.5);
await waitTitle('First test line');
await toggle.click();
await waitTitle('Original song');
check('disabling immediately restores the song title and persists off', await page.evaluate(() => localStorage.getItem('listening-car-bluetooth-lyrics-v1') === '0'));
await toggle.click();
await waitTitle('First test line');
await page.screenshot({ path: `${OUT}/car-lyrics-settings-zh.png` });
await L('logic.setLang("en");');
const englishToggle = page.getByRole('switch', { name: 'Car Bluetooth lyrics', exact: true });
await englishToggle.waitFor();
check('English setting and side-effect hint are translated', await englishToggle.innerText().then(t => /notifications and lock screen/.test(t) && !/[\u3400-\u9fff]/.test(t)));
for (const [width, height] of [[360, 780], [915, 412], [820, 1180]]) {
  await page.setViewportSize({ width, height });
  check(`native settings fit ${width}x${height}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
}
await page.setViewportSize({ width: 412, height: 915 });
await page.screenshot({ path: `${OUT}/car-lyrics-settings-en.png` });
await L('logic.startTrack(logic.state.queue[1]);');
await page.waitForFunction(() => document.getElementById('player-audio').currentTime > 0.1 && !document.getElementById('player-audio').paused);
await waitTitle('Instrumental song');
await L('logic._audio.pause(); logic.parseAndSetLyrics("[00:00.00]Late lyrics from another song", 1);');
await page.waitForTimeout(100);
check('a track without lyrics and late lyrics from another track display its own song title', await title() === 'Instrumental song');
const switchMarker = (await metadata()).length;
await L('logic.startTrack(logic.state.queue[0]); logic.startTrack(logic.state.queue[1]);');
await page.waitForTimeout(250);
check('rapid switching rejects late artwork and lyrics from previous tracks', (await metadata()).slice(switchMarker).every(m => m.title === 'Instrumental song'));
await L('logic.unloadAudio(); logic.persist();');
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.dc-topbar');
check('the setting remains enabled after reloading the app', await L('return logic.state.carBluetoothLyrics;'));

const webCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
await webCtx.addInitScript(() => localStorage.setItem('listening-car-bluetooth-lyrics-v1', '1'));
const web = await webCtx.newPage();
await web.goto(BASE, { waitUntil: 'load' });
await web.waitForSelector('.dc-topbar');
const W = logicDriver(web);
await W('logic.setPage("settings"); logic.toggleCarLyrics();');
check('web version hides this setting and cannot enable it', await W('return !logic.state.carBluetoothLyrics && !logic.renderVals().v.showCarLyricsSettings;') && await web.getByRole('switch', { name: '车载蓝牙歌词', exact: true }).count() === 0);
check('no native page errors', errors.length === 0, errors);
check('native test uses only local audio and mocked artwork', external.length === 0, external);
await browser.close();
process.exit(finish());

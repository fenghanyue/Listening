// 复现 Mac 上 navigator.onLine=false、但同站 HTTP 请求返回 200 的情况。
// 使用真实页面和本地 HTTP/WAV；只模拟浏览器联网标志、搜索/详情结果及检查请求失败。
import { BASE, launchBrowser, logicDriver, seedRecommendationCache, createChecker } from './lib.mjs';

const { check, finish } = createChecker();
const browser = await launchBrowser(['--autoplay-policy=no-user-gesture-required']);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
await seedRecommendationCache(ctx);
await ctx.addInitScript(() => {
  window.__browserOnline = false;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.__browserOnline });
});
const page = await ctx.newPage();
const L = logicDriver(page);
const errors = [], external = [], probes = [], held = [];
let probeMode = 'normal', probeStatus = 200, audioRequests = 0;
const wav = Buffer.alloc(44 + 8000 * 4, 0x80);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32);
wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
page.on('pageerror', error => errors.push(String(error)));
await page.route('**/*', route => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== new URL(BASE).origin || /^\/(proxy|stream|sc-client-id)/.test(url.pathname)) {
    external.push(url.href);
    return route.abort();
  }
  if (url.pathname === '/manifest.json' && request.method() === 'HEAD') {
    probes.push(url.href);
    if (probeMode === 'hold') { held.push(route); return; }
    if (probeMode === 'fail') return route.abort();
    if (probeMode === 'response') return route.fulfill({ status: probeStatus, body: '' });
  }
  if (url.pathname === '/connectivity.wav') {
    audioRequests++;
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: wav });
  }
  return route.continue();
});
const snapshot = () => L(`return { browserOnline: navigator.onLine, online: logic.state.online,
  offline: logic.isOfflineMode(), icon: document.querySelector('.sw-status-btn .ms')?.textContent.trim(),
  actions: { ...window.__actions }, playing: logic.state.playing, progress: logic._audio?.currentTime || 0 };`);
async function waitFor(predicate, timeout = 1500) {
  const until = Date.now() + timeout;
  do {
    if (await predicate()) { await page.waitForTimeout(30); return true; }
    await page.waitForTimeout(25);
  } while (Date.now() < until);
  return false;
}
const trigger = name => page.evaluate(event => window.dispatchEvent(new Event(event)), name);
const releaseHeld = async () => {
  for (const route of held.splice(0)) await route.abort().catch(() => {});
};

try {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.dc-topbar');
  await L(`return logic._startupCacheRead;`);
  await waitFor(async () => (await snapshot()).online);
  let s = await snapshot();
  check('false browser flag is corrected at startup by a real same-origin HTTP response',
    !s.browserOnline && s.online && !s.offline && !s.icon && probes.length > 0, s);
  check('the connection check uses HEAD and a fresh URL instead of cached page content',
    probes.length > 0 && probes.every(url => new URL(url).search.length > 1), probes);

  await L(`
    window.__actions = { starts: 0, searches: 0, details: 0, cached: 0 };
    const tracks = [1, 2, 3, 4].map(id => ({ id, songid: 'connectivity-' + id, source: 'netease',
      title: 'Connectivity ' + id, artist: 'Test', album: '', cover: null, duration: 4,
      lrc: '[00:00.00]Test', ...(id === 1 ? { audioUrl: arg + 'connectivity.wav', detailsLoaded: true } : {}) }));
    logic.patch({ queue: tracks, playOrder: [1], currentId: 1,
      playlists: [{ id: 'network-test', name: 'Network test', trackIds: [4] }] });
    const start = logic.startTrack.bind(logic);
    logic.startTrack = (...args) => { window.__actions.starts++; return start(...args); };
    // 打包导出是只读 getter；替换外层对象，避免给 getter 赋值后仍然访问真实音乐接口。
    window.ListeningAPI = { ...window.ListeningAPI,
      searchAll: async () => { window.__actions.searches++; return []; },
      ensureTrackDetails: async track => {
        window.__actions.details++; track.audioUrl = arg + 'connectivity.wav?id=' + track.id;
        track.detailsLoaded = true; return track;
      },
    };
    logic.cacheTrackNow = async () => { window.__actions.cached++; return true; };
  `, BASE);

  await L(`logic.playTrackAt(1);`);
  const played = await waitFor(async () => { const s = await snapshot(); return s.playing && s.progress > 0.1; });
  check('an uncached song actually plays from HTTP while the browser flag remains false', played && audioRequests > 0, await snapshot());
  await L(`logic._audio.pause();`);
  await L(`logic.patch({ searchQuery: 'no-matching-track' }); logic.doSearch();`);
  await waitFor(async () => (await snapshot()).actions.searches === 1);
  check('search uses the corrected connection state', (await snapshot()).actions.searches === 1);
  await L(`return logic.prefetchTrack(logic.state.queue[2]);`);
  check('next-song prefetch uses the corrected connection state', (await snapshot()).actions.details === 1);
  await L(`logic.patch({ viewingPlaylistId: 'network-test' }); return logic.cachePlaylist();`);
  check('playlist caching uses the corrected connection state', (await snapshot()).actions.cached === 1);

  probeMode = 'fail';
  await trigger('offline');
  await waitFor(async () => !(await snapshot()).online);
  s = await snapshot();
  check('a failed connection check keeps the offline icon and playback restriction', !s.online && s.offline && s.icon === 'cloud_off', s);
  const beforeBlocked = s.actions;
  await L(`logic.playTrackAt(4); logic.patch({ searchQuery: 'offline-query' }); logic.doSearch(); return logic.prefetchTrack(logic.state.queue[3]);`);
  s = await snapshot();
  check('confirmed offline state still blocks playback, online search and prefetch',
    s.actions.starts === beforeBlocked.starts && s.actions.searches === beforeBlocked.searches && s.actions.details === beforeBlocked.details, s);

  probeMode = 'normal';
  await trigger('focus');
  await waitFor(async () => (await snapshot()).online);
  check('focus restores connectivity even when the browser flag never becomes true', (await snapshot()).online && !await page.evaluate(() => navigator.onLine));
  await L(`logic.toggleOfflineOnly();`);
  await trigger('focus');
  await page.waitForTimeout(50);
  const starts = (await snapshot()).actions.starts;
  await L(`logic.playTrackAt(4);`);
  s = await snapshot();
  check('successful connectivity checks preserve the manual cached-only restriction',
    s.online && s.offline && s.icon === 'download_done' && s.actions.starts === starts, s);
  await L(`logic.toggleOfflineOnly();`);

  probeMode = 'response'; probeStatus = 503;
  await trigger('offline'); await trigger('focus');
  await waitFor(async () => (await snapshot()).online);
  check('an HTTP server error still proves network access instead of being called offline', (await snapshot()).online);

  probeMode = 'hold';
  const probeCount = probes.length;
  await trigger('offline');
  await waitFor(() => probes.length > probeCount);
  await page.evaluate(() => { for (const name of ['focus', 'pageshow', 'focus']) window.dispatchEvent(new Event(name)); });
  await page.waitForTimeout(50);
  check('overlapping checks share one pending request', probes.length === probeCount + 1 && held.length === 1, { count: probes.length - probeCount, held: held.length });
  await page.evaluate(() => { window.__browserOnline = true; window.dispatchEvent(new Event('online')); });
  await waitFor(async () => (await snapshot()).online);
  await releaseHeld(); await page.waitForTimeout(50);
  check('an older failed check cannot override a newer online notification', (await snapshot()).online);

  await page.evaluate(() => { window.__browserOnline = false; });
  const timeoutProbeCount = probes.length;
  await trigger('offline');
  const timeoutStarted = await waitFor(() => probes.length > timeoutProbeCount);
  await page.waitForTimeout(5200);
  await releaseHeld();
  s = await snapshot();
  check('a check that times out stays offline and does not permit uncached playback', timeoutStarted && !s.online && s.offline, s);
  probeMode = 'normal'; await trigger('focus');
  await waitFor(async () => (await snapshot()).online);
  check('a timed-out check does not prevent a later successful retry', (await snapshot()).online);

  // 不再派发任何网络/焦点事件：原始标志一直为 false 时，前台定期检查仍能发现后来的断开。
  probeMode = 'fail';
  const periodicCount = probes.length;
  const detected = await page.waitForFunction(() => document.querySelector('.sw-status-btn .ms')?.textContent.trim() === 'cloud_off',
    null, { timeout: 31000 }).then(() => true, () => false);
  check('foreground rechecks detect a later disconnection without any browser notification',
    detected && probes.length > periodicCount && !(await snapshot()).online);
  probeMode = 'normal'; await trigger('focus');
  await waitFor(async () => (await snapshot()).online);

  probeMode = 'hold';
  await trigger('offline'); await waitFor(() => held.length > 0);
  await L(`logic.componentWillUnmount();`);
  await releaseHeld(); await page.waitForTimeout(50);
  check('unmount cancels pending verification without changing connection state', !(await snapshot()).online);

  // APK 的 manifest 是本地打包文件，收到它的响应不能当作联网依据。
  probeMode = 'normal';
  await ctx.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true, PluginHeaders: [],
      nativePromise: () => Promise.resolve({}), nativeCallback: () => null };
  });
  const beforeNative = probes.length;
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.dc-topbar');
  await page.waitForTimeout(100);
  s = await snapshot();
  check('native mode stays offline and never treats bundled files as proof of Internet access',
    !s.online && s.offline && probes.length === beforeNative, s);
  check('no page errors', errors.length === 0, errors);
  check('no music-service or external requests were made', external.length === 0, external);
} finally {
  await releaseHeld();
  await browser.close();
}
process.exit(finish());

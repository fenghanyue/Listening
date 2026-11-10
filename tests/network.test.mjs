// 浏览器联网状态同步（不访问外部接口）：漏掉网络通知后，从前台、焦点、恢复和 BFCache 返回时纠正状态。
// 保留离线播放限制，并检查图标、播放入口和推荐任务跟着状态一起恢复。
import { BASE, launchBrowser, logicDriver, createChecker, seedRecommendationCache } from './lib.mjs';

const { check, finish } = createChecker();
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
await seedRecommendationCache(ctx);
await ctx.addInitScript(() => {
  // 提前截住事件，只让浏览器自己的 navigator.onLine 改变，模拟网页漏收网络通知。
  const suppress = event => { if (window.__dropNetworkEvents) event.stopImmediatePropagation(); };
  window.addEventListener('online', suppress, true);
  window.addEventListener('offline', suppress, true);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__visibility || 'visible' });
});
const page = await ctx.newPage();
const errors = [], external = [];
page.on('pageerror', error => errors.push(String(error)));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin === new URL(BASE).origin && !/^\/(proxy|stream|sc-client-id)/.test(url.pathname)) return route.continue();
  external.push(url.href);
  return route.abort();
});
const L = logicDriver(page);
const state = () => L(`
  const v = logic.renderVals().v;
  return { online: logic.state.online, offline: logic.isOfflineMode(), chip: v.showOfflineChip, icon: v.offlineChipIcon,
    shownIcon: document.querySelector('.sw-status-btn .ms')?.textContent.trim(),
    calls: { ...logic.__networkCalls }, started: [...logic.__started], toast: logic.state.toast };
`);
async function waitForOnline(online) {
  for (let i = 0; i < 30; i++) {
    if ((await state()).online === online) { await page.waitForTimeout(30); return true; }
    await page.waitForTimeout(25);
  }
  return false;
}
async function changeNetwork(online, dropEvents = false) {
  await page.evaluate(drop => { window.__dropNetworkEvents = drop; }, dropEvents);
  // 正常通知的场景先经过反方向，确保上一项失败也不会污染下一项的起始状态。
  if (!dropEvents) {
    await ctx.setOffline(online);
    await page.waitForFunction(expected => navigator.onLine !== expected, online);
  }
  await ctx.setOffline(!online);
  await page.waitForFunction(expected => navigator.onLine === expected, online);
  if (!dropEvents) await waitForOnline(online);
}
const dispatch = event => page.evaluate(name => {
  if (name === 'visibilitychange') {
    window.__visibility = 'visible';
    document.dispatchEvent(new Event(name));
  } else if (name === 'resume') document.dispatchEvent(new Event(name));
  else if (name === 'pageshow') window.dispatchEvent(new PageTransitionEvent(name, { persisted: true }));
  else window.dispatchEvent(new Event(name));
}, event);

try {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.dc-topbar');
  await L(`return logic._startupCacheRead;`);
  await L(`
    logic._recommendationEngine.cancel();
    logic.__networkCalls = { start: 0, cancel: 0, emit: 0 };
    for (const method of ['start', 'cancel', 'emit']) {
      logic._recommendationEngine[method] = () => { logic.__networkCalls[method]++; };
    }
    logic.__started = [];
    logic.startTrack = track => { logic.__started.push(track.id); };
    logic._cachedKeys = new Set(['netease:2']);
    const tracks = [1, 2].map(id => ({ id, songid: String(id), source: 'netease', title: 'Track ' + id,
      artist: 'Test', album: '', duration: 200, cover: null, lrc: '[00:00.00]Test' }));
    logic.patch({ queue: tracks, playOrder: [1, 2], currentId: 1, offlineOnly: false });
  `);
  let s = await state();
  check('online startup has no offline icon', s.online && !s.offline && !s.chip && !s.shownIcon, s);

  await changeNetwork(false);
  s = await state();
  check('a normal offline notification updates state, icon and recommendation tasks',
    !s.online && s.offline && s.icon === 'cloud_off' && s.shownIcon === 'cloud_off'
      && s.calls.cancel === 1 && s.calls.emit === 1, s);
  await L(`logic.playTrackAt(1);`);
  s = await state();
  check('offline still blocks an uncached song before playback starts', s.started.length === 0 && /还没缓存/.test(s.toast), s);
  await L(`logic.playTrackAt(2);`);
  check('offline still allows a cached song', (await state()).started.join() === '2');
  check('offline next-track selection still skips uncached songs', await L(`return logic.findPlayableInOrder(1, 1, { includeSelf: true })?.id === 2;`));
  await changeNetwork(true);
  s = await state();
  check('a normal online notification clears the offline icon and restarts recommendations',
    s.online && !s.offline && !s.chip && !s.shownIcon && s.calls.start === 1, s);

  for (const event of ['visibilitychange', 'focus', 'resume', 'pageshow']) {
    await changeNetwork(false);
    await changeNetwork(true, true);
    check(`${event}: the missed online notification leaves the old offline state`, !(await state()).online && await page.evaluate(() => navigator.onLine));
    const starts = (await state()).calls.start;
    await dispatch(event);
    await waitForOnline(true);
    s = await state();
    check(`${event}: recovery updates playback eligibility and removes the rendered offline icon`,
      s.online && !s.offline && !s.chip && !s.shownIcon, s);
    check(`${event}: recommendations restart after recovery`, s.calls.start === starts + 1, s.calls);

    // 相同的恢复入口也要发现漏掉的断网通知，不能只把标记往“联网”方向改。
    await changeNetwork(true);
    await changeNetwork(false, true);
    check(`${event}: the missed offline notification leaves the old online state`, (await state()).online && !await page.evaluate(() => navigator.onLine));
    const cancels = (await state()).calls.cancel;
    await dispatch(event);
    await waitForOnline(false);
    s = await state();
    check(`${event}: a still-offline browser keeps the cloud icon and cached-only playback`,
      !s.online && s.offline && s.shownIcon === 'cloud_off' && s.calls.cancel === cancels + 1, s);
  }

  await changeNetwork(true);
  await L(`logic.toggleOfflineOnly();`);
  await page.waitForTimeout(30);
  await changeNetwork(false);
  await changeNetwork(true, true);
  await dispatch('focus');
  await waitForOnline(true);
  s = await state();
  check('network recovery preserves the manual cached-only setting and its icon',
    s.online && s.offline && s.chip && s.icon === 'download_done' && s.shownIcon === 'download_done', s);
  await L(`logic.__started = []; logic.playTrackAt(1); logic.playTrackAt(2);`);
  check('manual cached-only mode still blocks uncached playback after network recovery', (await state()).started.join() === '2');

  await L(`logic.toggleOfflineOnly();`);
  await page.waitForTimeout(30);
  await L(`logic.__started = []; logic.playTrackAt(1);`);
  check('ordinary playback is available again when online and cached-only is off', (await state()).started.join() === '1');

  const before = (await state()).calls;
  await dispatch('focus');
  await dispatch('pageshow');
  await dispatch('resume');
  await page.waitForTimeout(30);
  check('repeated foreground checks do not restart unchanged network tasks', JSON.stringify((await state()).calls) === JSON.stringify(before));
  check('no page errors', errors.length === 0, errors);
  check('no external or proxy requests were made', external.length === 0, external);
} finally {
  await browser.close();
}
process.exit(finish());

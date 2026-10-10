// 模拟 APK（联网：网易云搜索、播放）：注入一个假的 Capacitor 原生壳，记录页面发出的每个原生调用。
// 覆盖沉浸式状态栏、电池提示、检查更新、媒体通知（通知栏 / 锁屏控制）、拔耳机、返回键、导出和分享
import { BASE, OUT, launchBrowser, logicDriver, createChecker } from './lib.mjs';

const { check, finish } = createChecker();
const browser = await launchBrowser(['--autoplay-policy=no-user-gesture-required']);
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

// 1x1 的 PNG，冒充原生 HTTP 下载到的封面
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
await ctx.addInitScript(({ PNG_B64 }) => {
  window.__calls = [];
  window.__cbs = {};
  const headers = ['App', 'AppShell', 'MediaSession', 'SystemBars', 'CapacitorHttp', 'Filesystem', 'Share'].map(name => ({ name, methods: [] }));
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    PluginHeaders: headers,
    nativePromise(plugin, method, options) {
      window.__calls.push({ plugin, method, options: JSON.parse(JSON.stringify(options || {})) });
      if (plugin === 'App' && method === 'getInfo') return Promise.resolve({ version: '1.0.5', build: '5', name: '听音乐', id: 'io.github.fenghanyue.listening' });
      if (plugin === 'AppShell' && method === 'getBatteryOptimization') return Promise.resolve({ ignoring: false });
      if (plugin === 'CapacitorHttp' && method === 'request') return Promise.resolve({ status: 200, headers: { 'Content-Type': 'image/png' }, data: PNG_B64.slice(0, 40) + '\n' + PNG_B64.slice(40) });
      if (plugin === 'Filesystem' && method === 'getUri') return Promise.resolve({ uri: 'file:///data/user/0/x/cache/' + options.path });
      return Promise.resolve({});
    },
    nativeCallback(plugin, method, options, cb) {
      window.__calls.push({ plugin, method, options: JSON.parse(JSON.stringify(options || {})), callback: true });
      const key = method === 'addListener' ? `${plugin}:${options.eventName}` : `${plugin}:${method}:${options.action || ''}`;
      window.__cbs[key] = cb;
      return 'cb-' + key;
    },
  };
}, { PNG_B64 });

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('dialog', d => d.accept());
await page.route('https://api.github.com/repos/fenghanyue/Listening/releases/latest', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ tag_name: 'v1.0.9' }) }));

const L = logicDriver(page);
const calls = (plugin, method) => page.evaluate(([p, m]) => window.__calls.filter(c => c.plugin === p && (!m || c.method === m)), [plugin, method]);
const fire = (key, data) => page.evaluate(([k, d]) => { const cb = window.__cbs[k]; if (!cb) return false; cb(d); return true; }, [key, data]);
const waitFor = async (fn, timeout = 30000, arg) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await L(fn, arg)) return true; await page.waitForTimeout(400); } return false; };

await page.goto(BASE, { waitUntil: 'load' });
// MainActivity 在页面提交（onPageCommitVisible）后注入安全区：模拟 32px 状态栏 + 24px 手势条
await page.evaluate(() => {
  document.documentElement.style.setProperty('--safe-area-inset-top', '32px');
  document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px');
});
await page.waitForSelector('.dc-topbar');
await page.waitForTimeout(1000);

// --- 环境 / 状态栏 ---
check('proxy base points at the Render instance', (await page.evaluate(() => window.LISTENING_PROXY_BASE)) === 'https://listening-5bnv.onrender.com');
const barCalls0 = await calls('SystemBars', 'setStyle');
// 默认白底：状态栏图标是深色（LIGHT），切到黑底再换成浅色图标（DARK）
check('status bar style set early (head script) and on mount: LIGHT', barCalls0.length >= 2 && barCalls0.every(c => c.options.style === 'LIGHT'), barCalls0.map(c => c.options.style));
const topbar = await page.$eval('.dc-topbar', el => { const cs = getComputedStyle(el); return { h: el.getBoundingClientRect().height, pt: cs.paddingTop, bg: cs.backgroundColor }; });
check('topbar extends under the 32px status bar (height 80, padding-top 32px)', Math.round(topbar.h) === 80 && topbar.pt === '32px', topbar);
await page.screenshot({ path: `${OUT}/native-light.png`, clip: { x: 0, y: 0, width: 412, height: 200 } });
await L(`logic.toggleTheme();`);
await page.waitForTimeout(300);
const barDark = (await calls('SystemBars', 'setStyle')).slice(-1)[0];
check('switching to dark theme -> SystemBars DARK (light icons)', barDark && barDark.options.style === 'DARK', barDark);
await page.screenshot({ path: `${OUT}/native-dark.png`, clip: { x: 0, y: 0, width: 412, height: 200 } });
await L(`logic.toggleTheme();`);

// --- 电池提示 / 检查更新 ---
await page.waitForTimeout(500);
const hint = await L(`const v = logic.renderVals().v; return { show: v.showBatteryHint, text: v.batteryHintText, upd: v.showUpdateBanner };`);
check('battery hint shown with APK wording (not yet whitelisted)', hint.show && /允许「听音乐」在后台运行/.test(hint.text) && !hint.upd, hint);
await L(`logic.openBatterySettings();`);
const bat = (await calls('AppShell', 'openBatterySettings')).slice(-1)[0];
check('去设置 opens battery settings (target auto)', bat && bat.options.target === 'auto', bat);
await L(`logic.dismissBatteryHint();`);
await waitFor(`return logic.renderVals().v.showUpdateBanner;`, 5000);
const upd = await L(`const v = logic.renderVals().v; return { show: v.showUpdateBanner, text: v.updateBannerText, ver: v.appVersionText };`);
check('update banner: v1.0.9 newer than build 5', upd.show && /v1\.0\.9/.test(upd.text) && /1\.0\.5/.test(upd.text), upd);
await L(`logic.downloadUpdate();`);
const openUrl = (await calls('AppShell', 'openUrl')).slice(-1)[0];
check('download opens the latest APK URL in the system browser', openUrl && openUrl.options.url === 'https://github.com/fenghanyue/Listening/releases/latest/download/listening.apk', openUrl);

// --- 播放 + 媒体会话 ---
await L(`logic.toggleSource('qq'); logic.patch({ searchQuery: '晴天 周杰伦' }); logic.doSearch();`);
await waitFor(`return !logic.state.isSearching && logic.state.searchResults.length > 0;`, 30000);
const t0 = await L(`const t = logic.state.searchResults[0]; return { id: t.id, title: t.title };`);
await L(`logic.playTrackAt(arg);`, t0.id);
const playing = await waitFor(`const a = document.getElementById('player-audio'); return a.currentTime > 0.5;`, 45000);
check('track plays', playing);
await page.waitForTimeout(1500);
const meta = await calls('MediaSession', 'setMetadata');
check('setMetadata: title right, artwork always a data: image', meta.length >= 1 && meta.every(m => m.options.title === t0.title && m.options.artwork.length === 1 && /^data:image\//.test(m.options.artwork[0].src)), meta.map(m => ({ t: m.options.title, a: (m.options.artwork[0] || {}).src && m.options.artwork[0].src.slice(0, 22) })));
const http = await calls('CapacitorHttp', 'request');
check('cover fetched via native HTTP with timeouts', http.length >= 1 && http[0].options.connectTimeout > 0 && http[0].options.readTimeout > 0, http[0] && http[0].options);
const states = (await calls('MediaSession', 'setPlaybackState')).map(c => c.options.playbackState);
check('playback state playing reported', states.includes('playing'), states);
const pos = (await calls('MediaSession', 'setPositionState')).slice(-1)[0];
check('position state reported with real duration', pos && pos.options.duration > 30 && pos.options.position >= 0, pos && pos.options);
const handlers = (await calls('MediaSession', 'setActionHandler')).map(c => c.options.action).sort();
check('action handlers registered (play/pause/prev/next/seekto)', ['nexttrack', 'pause', 'play', 'previoustrack', 'seekto'].every(a => handlers.includes(a)), handlers);
await fire('MediaSession:setActionHandler:seekto', { action: 'seekto', seekTime: 30 });
await page.waitForTimeout(500);
const ct = await page.evaluate(() => document.getElementById('player-audio').currentTime);
check('notification seek moves playback to 30s', ct >= 29.5 && ct < 40, ct);
await fire('MediaSession:setActionHandler:pause', { action: 'pause' });
await page.waitForTimeout(300);
check('notification pause pauses audio', await page.evaluate(() => document.getElementById('player-audio').paused));
check('paused state reported', (await calls('MediaSession', 'setPlaybackState')).slice(-1)[0].options.playbackState === 'paused');
await fire('MediaSession:setActionHandler:play', { action: 'play' });
await page.waitForTimeout(800);
check('notification play resumes audio', !(await page.evaluate(() => document.getElementById('player-audio').paused)));

// --- 拔耳机 ---
const noisyOk = await fire('AppShell:audioBecomingNoisy', {});
await page.waitForTimeout(300);
const afterNoisy = await page.evaluate(() => document.getElementById('player-audio').paused);
check('headphones unplugged -> paused + toast', noisyOk && afterNoisy && /耳机/.test(await L(`return logic.state.toast;`)));

// --- 返回键 ---
const back = () => fire('App:backButton', { canGoBack: false });
await L(`logic.openSettings();`); await back(); await page.waitForTimeout(100);
check('back on the settings page returns to search', (await L(`return logic.state.page;`)) === 'search');
await L(`logic.toggleMobileNowPlaying();`); await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/native-nowplaying.png` });
await L(`logic.toggleMenu('player');`); await back(); await page.waitForTimeout(100);
check('back in player closes the ⋮ menu first', (await L(`return [logic.state.openMenu, logic.state.mobileNowPlayingExpanded];`)).join() === ',true');
await L(`logic.toggleQueuePanel();`); await back(); await page.waitForTimeout(100);
check('back in player closes the queue next', (await L(`return [logic.state.mobileNowPlayingExpanded, logic.state.rightPanel];`)).join() === 'true,browse');
await back(); await page.waitForTimeout(100);
check('back closes the now-playing page', !(await L(`return logic.state.mobileNowPlayingExpanded;`)));
await L(`logic.selectPlaylist('liked');`); await back(); await page.waitForTimeout(100);
check('back leaves the playlist view for the playlist list', (await L(`return [logic.state.viewingPlaylistId, logic.state.page];`)).join() === ',library');
await back(); await page.waitForTimeout(100);
check('back on the playlist list returns to search', (await L(`return logic.state.page;`)) === 'search' && (await calls('App', 'minimizeApp')).length === 0);
await back(); await page.waitForTimeout(100);
check('back on the search page minimizes the app (does not exit)', (await calls('App', 'minimizeApp')).length === 1);

// --- 收起键盘 ---
// MainActivity 确认键盘收起后派发 listening:ime-hidden：页面让搜索框失焦，「最近搜索」跟着收起
await L(`logic.setPage('search'); logic.patch({ hasSearched: false, searchQuery: '', appliedQuery: '' });`);
await page.waitForTimeout(150);
await page.tap('.dc-search-input');
await page.waitForTimeout(250);
const searchUi = () => page.evaluate(() => ({ focused: document.activeElement === document.querySelector('.dc-search-input'), recents: document.querySelectorAll('.sw-recent-row').length }));
const imeOpen = await searchUi();
await page.evaluate(() => window.dispatchEvent(new Event('listening:ime-hidden')));
await page.waitForTimeout(300);
const imeHidden = await searchUi();
check('keyboard hidden (event from MainActivity) unfocuses the search box and hides recent searches',
  imeOpen.focused && imeOpen.recents > 0 && !imeHidden.focused && imeHidden.recents === 0, { imeOpen, imeHidden });

// --- 导出 / 分享 ---
await waitFor(`return logic.state.exportReady === true;`, 90000);
await L(`logic.exportCurrentTrack();`);
await waitFor(`return true;`, 1000);
await page.waitForTimeout(4000);
const fs = await page.evaluate(() => window.__calls.filter(c => c.plugin === 'Filesystem').map(c => ({ m: c.method, path: c.options.path, len: c.options.data ? atob(c.options.data).length : 0 })));
const share = (await calls('Share', 'share')).slice(-1)[0];
const written = fs.filter(f => f.m === 'writeFile' || f.m === 'appendFile');
const totalBytes = written.reduce((n, f) => n + f.len, 0);
const realSize = await page.evaluate(() => new Promise(res => { const r = indexedDB.open('listening-audio-cache', 1); r.onsuccess = () => { const q = r.result.transaction('tracks').objectStore('tracks').getAll(); q.onsuccess = () => res(q.result[0] && q.result[0].size); }; }));
check('export writes the file in chunks (first writeFile, then appendFile) with exact byte count', written.length >= 2 && written[0].m === 'writeFile' && written.slice(1).every(f => f.m === 'appendFile') && totalBytes === realSize, { chunks: written.length, totalBytes, realSize });
check('export hands the file to the system share sheet', share && share.options.files && /^file:\/\/.*\/exports\//.test(share.options.files[0]), share && share.options);
await L(`logic.openShareModal();`);
check('share button available in APK', await L(`return logic.renderVals().v.shareCanSystemShare;`));
await L(`logic.systemShare();`);
const shareText = (await calls('Share', 'share')).slice(-1)[0];
check('share text goes through native share (text only, no url)', shareText && typeof shareText.options.text === 'string' && !shareText.options.url && shareText.options.text.includes('music.163.com'), shareText && shareText.options);

// --- 设置页里的版本号 ---
await L(`logic.closeShareModal(); logic.openSettings();`);
check('settings page shows app version (APK only)', (await L(`const v = logic.renderVals().v; return v.isNative && v.isSettingsPage && v.appVersionText;`)) === '1.0.5');

check('no page errors', errors.length === 0, errors);
await browser.close();
process.exit(finish());

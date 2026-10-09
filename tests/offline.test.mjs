// 离线功能全流程（联网：网易云搜索、播放、下载）：播放到整首缓存完 → 元数据和封面落库 → 已缓存标记和
// 「已缓存」列表 → 断网后只播缓存、离线搜索本地曲库、设置页里的「缓存与离线」→ 恢复联网后「只播已缓存」开关、
// 一键缓存歌单、删除缓存、刷新后重建索引
import { BASE, OUT, launchBrowser, logicDriver, createChecker } from './lib.mjs';

const { check, finish } = createChecker();
const browser = await launchBrowser(['--autoplay-policy=no-user-gesture-required']);
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const warnings = [];
page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.type() + ': ' + m.text().slice(0, 200)); });
page.on('dialog', d => d.accept());
const L = logicDriver(page);

const waitFor = async (desc, fn, timeout = 60000, arg) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await L(fn, arg)) return true;
    await page.waitForTimeout(500);
  }
  console.log('timeout waiting for', desc);
  return false;
};

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.dc-topbar');
await page.waitForTimeout(800);

// 只搜网易云（QQ 接口在有些网络下不稳定）
await L(`logic.toggleSource('qq');`);
await L(`logic.patch({ searchQuery: '晴天 周杰伦' }); logic.doSearch();`);
const searched = await waitFor('search results', `return !logic.state.isSearching && logic.state.searchResults.length > 3;`, 30000);
check('online search returns results', searched, await L(`return logic.state.searchResults.length;`));

// 播放第一首，等它整首缓存完
const first = await L(`const t = logic.state.searchResults[0]; return { id: t.id, title: t.title, cover: t.cover };`);
await L(`logic.playTrackAt(arg);`, first.id);
const playing = await waitFor('audio playing', `const a = document.getElementById('player-audio'); return a && a.currentTime > 0.5;`, 45000);
check('first track starts playing online', playing);
const cachedOk = await waitFor('first track cached', `return logic.state.exportReady === true;`, 90000);
check('first track gets fully cached (exportReady)', cachedOk);
await waitFor('cache index refreshed', `return logic.state.cachedCount >= 1;`, 10000);

// 元数据和封面存进单独的元数据库
const metaRec = await page.evaluate(() => new Promise(res => {
  const r = indexedDB.open('listening-audio-meta', 1);
  r.onsuccess = () => {
    const q = r.result.transaction('meta', 'readonly').objectStore('meta').getAll();
    q.onsuccess = () => res(q.result.map(m => ({ id: m.id, title: m.meta && m.meta.title, hasLrc: !!(m.meta && m.meta.lrc), cover: !!m.coverBlob, coverType: m.coverBlob && m.coverBlob.type })));
  };
}));
check('meta record written with title', metaRec.length === 1 && metaRec[0].title === first.title, metaRec);
await waitFor('cover blob', `return true;`, 1000);
await page.waitForTimeout(4000);
const coverRec = await page.evaluate(() => new Promise(res => {
  const r = indexedDB.open('listening-audio-meta', 1);
  r.onsuccess = () => {
    const q = r.result.transaction('meta', 'readonly').objectStore('meta').getAll();
    q.onsuccess = () => res(q.result.map(m => ({ cover: !!m.coverBlob, type: m.coverBlob && m.coverBlob.type, size: m.coverBlob && m.coverBlob.size })));
  };
}));
check('cover blob stored (netease covers are CORS-readable)', coverRec[0] && coverRec[0].cover, coverRec);
const coverLocal = await L(`const r = logic.renderVals().v.tracksRender.find(r => r.id === arg); return r && r.coverStyle;`, first.id);
check('cached row renders its cover from a local blob: URL', /url\('blob:/.test(coverLocal || ''), (coverLocal || '').slice(0, 60));

// 搜索列表里的已缓存标记 + 歌单列表里的「已缓存」入口
const badgeRows = await page.$$eval('.dc-result-row', rows => rows.map(r => r.textContent.includes('download_done')));
check('search row of cached track shows the cached badge', badgeRows[0] === true && badgeRows.slice(1).every(x => !x), badgeRows.slice(0, 4));
const sidebarFirst = await L(`return logic.renderVals().v.playlistsRender[0];`);
check('sidebar first entry is 已缓存 with count 1', sidebarFirst.name === '已缓存' && sidebarFirst.countLabel === 1, { name: sidebarFirst.name, count: sidebarFirst.countLabel });

// 把前 3 首都点喜欢：「喜欢的音乐」里 1 首已缓存 + 2 首没缓存
const ids = await L(`return logic.state.searchResults.slice(0, 3).map(t => t.id);`);
await L(`logic.toggleLike(arg[0]); logic.toggleLike(arg[1]); logic.toggleLike(arg[2]);`, ids);

// 「已缓存」列表
await L(`logic.selectPlaylist('__cached');`);
await page.waitForTimeout(300);
const cachedView = await L(`const v = logic.renderVals().v; return { name: v.playlistHeaderName, n: v.tracksRender.length, status: v.statusText, icon: v.tracksRender[0] && v.tracksRender[0].primaryActionIcon, showCacheAll: v.showCacheAll };`);
check('cached view lists the cached track with delete action', cachedView.n === 1 && cachedView.icon === 'delete' && !cachedView.showCacheAll, cachedView);
await page.screenshot({ path: `${OUT}/e2e-cached-view.png` });

// 断网
await L(`document.getElementById('player-audio').pause();`);
await ctx.setOffline(true);
await waitFor('online=false', `return logic.state.online === false;`, 5000);
const chip = await L(`const v = logic.renderVals().v; return { show: v.showOfflineChip, icon: v.offlineChipIcon };`);
check('offline chip appears in topbar', chip.show && chip.icon === 'cloud_off', chip);

// 断网时的「喜欢的音乐」：没缓存的行变灰，播放全部从已缓存的那首开始
await L(`logic.selectPlaylist('liked');`);
await page.waitForTimeout(300);
const likedRows = await L(`return logic.renderVals().v.tracksRender.map(r => ({ id: r.id, cached: r.isCached, op: r.rowOpacity }));`);
check('offline: uncached rows dimmed, cached row not', likedRows.length === 3 && likedRows.filter(r => r.op === '0.45').length === 2 && likedRows.find(r => r.cached).op === '1', likedRows);

// 断网时点没缓存的歌：只提示，不去加载
const uncachedId = likedRows.find(r => !r.cached).id;
const beforeCur = await L(`return logic.state.currentId;`);
await L(`logic.playTrackAt(arg);`, uncachedId);
const afterClick = await L(`return { cur: logic.state.currentId, toast: logic.state.toast };`);
check('offline: tapping an uncached track only shows a toast', afterClick.cur === beforeCur && /还没缓存/.test(afterClick.toast || ''), afterClick);

// 断网时播放全部：从已缓存的那首开始，音频来自 IndexedDB
await L(`logic.playAllInPlaylist();`);
const offlinePlay = await waitFor('offline playback from cache', `const a = document.getElementById('player-audio'); return a.currentTime > 1 && /^blob:/.test(a.src);`, 20000);
check('offline: play all starts the cached track from a blob: URL', offlinePlay, await L(`return { cur: logic.state.currentId, toast: logic.state.toast };`));
check('offline: current track is the cached one', (await L(`return logic.state.currentId;`)) === first.id);

// 下一首 / 上一首 / 播完自动切歌只落在已缓存的歌上（只有一首已缓存，就停在它上面）
const nextT = await L(`const t = logic.nextListLoopTrack(); return t && t.id;`);
check('offline: nextListLoopTrack skips uncached (only self is playable)', nextT === first.id, nextT);
const shuffleId = await L(`return logic.pickShuffleNextId();`);
check('offline: shuffle only picks cached', shuffleId === first.id, shuffleId);

// 断网搜索 → 搜本地曲库
await L(`logic.patch({ searchQuery: '晴天' }); logic.doSearch();`);
await page.waitForTimeout(300);
const ls = await L(`const v = logic.renderVals().v; return { local: logic.state.localSearch, n: v.tracksRender.length, status: v.statusText, firstCached: v.tracksRender[0] && v.tracksRender[0].isCached };`);
check('offline search uses local library, cached first', ls.local && ls.n >= 1 && ls.firstCached && /本地曲库/.test(ls.status), ls);
await page.screenshot({ path: `${OUT}/e2e-offline-search.png` });

// 设置页里的「缓存与离线」
await L(`logic.openSettings();`);
await page.waitForTimeout(600);
const panel = await L(`const v = logic.renderVals().v; return { open: v.isSettingsPage, count: v.cachedCount, usage: v.cacheUsageText, net: v.netStatusText, caps: v.capChoicesRender.map(c => c.label) };`);
check('settings page shows cache usage and cap choices', panel.open && panel.count === 1 && /\/ 300MB/.test(panel.usage) && panel.caps.join(',') === '300MB,1GB,2GB,5GB,不限', panel);
await page.screenshot({ path: `${OUT}/e2e-settings-cache.png` });
await L(`logic.setCacheCap(1024);`);
check('cap setting persists', (await page.evaluate(() => localStorage.getItem('listening-cache-cap-mb-v1'))) === '1024');
await L(`logic.setPage('search');`);

// 恢复联网：开着「只播已缓存」时照样只播缓存
await ctx.setOffline(false);
await waitFor('online=true', `return logic.state.online === true;`, 5000);
await L(`logic.toggleOfflineOnly();`);
const ooMode = await L(`return { mode: logic.isOfflineMode(), chip: logic.renderVals().v.offlineChipText };`);
check('offline-only toggle forces offline mode while online', ooMode.mode && ooMode.chip === '只播缓存', ooMode);
await L(`logic.toggleOfflineOnly();`);
check('offline-only toggle off restores normal mode', !(await L(`return logic.isOfflineMode();`)));

// 一键缓存「喜欢的音乐」（还剩 2 首没缓存）
await L(`document.getElementById('player-audio').pause(); logic.selectPlaylist('liked');`);
await L(`window.__toasts = []; const orig = logic.showToast.bind(logic); logic.showToast = (t) => { window.__toasts.push(t); orig(t); };`);
await L(`logic.cachePlaylist();`);
await page.waitForTimeout(500);
const prog = await L(`const v = logic.renderVals().v; return { label: v.cacheAllLabel, icon: v.cacheAllIcon, batch: logic.state.batchCache };`);
check('batch cache shows progress', /缓存中 \d+\/2/.test(prog.label) && prog.icon === 'progress_activity', prog);
const batchDone = await waitFor('batch done', `return logic.state.batchCache === null;`, 180000);
await waitFor('index refresh', `return logic.state.cachedCount >= 3;`, 15000);
const after = await L(`return { count: logic.state.cachedCount, toasts: window.__toasts, rows: logic.renderVals().v.tracksRender.map(r => r.isCached) };`);
check('batch cache finished and all 3 liked tracks are cached', batchDone && after.count === 3 && after.rows.every(Boolean), after);

// 在「已缓存」列表里删掉一首
await L(`logic.selectPlaylist('__cached');`);
const delId = await L(`return logic.renderVals().v.tracksRender[0].id;`);
const beforeDel = await L(`return logic.state.cachedCount;`);
await L(`logic.removeFromPlaylist(arg);`, delId);
await waitFor('deleted', `return logic.state.cachedCount === arg;`, 10000, beforeDel - 1);
const afterDel = await L(`return { count: logic.state.cachedCount, stillListed: logic.renderVals().v.tracksRender.some(r => r.id === arg) };`, delId);
check('delete single cache from cached view', afterDel.count === beforeDel - 1 && !afterDel.stillListed, { beforeDel, ...afterDel });

// 刷新页面：已缓存索引从 IndexedDB 重建，喜欢的歌还在
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.dc-topbar');
await waitFor('index after reload', `return logic.state.cachedCount === arg;`, 10000, afterDel.count);
check('after reload the cached index is rebuilt', (await L(`return logic.state.cachedCount;`)) === afterDel.count, afterDel.count);

check('no page errors', errors.length === 0, errors);
console.log('console warnings/errors:', JSON.stringify(warnings, null, 1));
await browser.close();
process.exit(finish());

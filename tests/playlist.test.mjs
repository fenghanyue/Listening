// 歌单回归（联网：网易云搜索）：建歌单、加歌、导出成 LSNPL2 串再导回来、播放全部、移出歌单、
// 联网时的上一首 / 下一首
import { BASE, launchBrowser, logicDriver, createChecker } from './lib.mjs';

const { check, finish } = createChecker();
const browser = await launchBrowser(['--autoplay-policy=no-user-gesture-required']);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('dialog', d => d.accept());
const L = logicDriver(page);

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.dc-topbar');
await page.waitForTimeout(800);

// 只搜网易云（关掉 QQ，结果更稳定）
await L(`logic.toggleSource('qq'); logic.patch({ searchQuery: '七里香' }); logic.doSearch();`);
for (let i = 0; i < 60 && !(await L(`return !logic.state.isSearching && logic.state.searchResults.length > 2;`)); i++) await page.waitForTimeout(500);
const ids = await L(`return logic.state.searchResults.slice(0, 3).map(t => t.id);`);
check('search returns at least 3 results', ids.length === 3, ids);

await L(`logic.patch({ createName: '测试歌单' }); logic.confirmCreate();`);
const pid = await L(`return logic.state.playlists.find(p => p.name === '测试歌单').id;`);
for (const id of ids) await L(`logic.openAddModal(arg[0]); logic.confirmAdd(arg[1], '测试歌单');`, [id, pid]);
await L(`logic.selectPlaylist(arg);`, pid);
const view = await L(`const v = logic.renderVals().v; return { name: v.playlistHeaderName, n: v.tracksRender.length, ids: v.tracksRender.map(r => r.id), cacheAll: v.showCacheAll, status: v.statusText };`);
check('playlist view lists tracks in playlist order', view.name === '测试歌单' && view.n === 3 && view.ids.join() === ids.join() && view.cacheAll, view);

await L(`logic.exportPlaylist();`);
await page.waitForTimeout(800);
const exported = await page.evaluate(() => navigator.clipboard.readText());
check('export produces an LSNPL2 string', /^LSNPL2:/.test(exported), exported.slice(0, 20));
await L(`logic.patch({ importUrl: arg, importPlaylistName: '导回来的' }); logic.confirmImport();`, exported);
await page.waitForTimeout(800);
const imported = await L(`const p = logic.state.playlists.find(p => p.name === '导回来的'); return p && p.trackIds.length;`);
check('import of exported string recreates the playlist', imported === 3, imported);

await L(`logic.selectPlaylist(arg);`, pid);
await L(`logic.playAllInPlaylist();`);
await page.waitForTimeout(500);
const pa = await L(`return { order: logic.state.playOrder, cur: logic.state.currentId, toast: logic.state.toast };`);
check('play all replaces the queue and starts the first track', pa.order.join() === ids.join() && pa.cur === ids[0], pa);
await L(`logic.removeFromPlaylist(arg);`, ids[1]);
check('remove from playlist works', (await L(`return logic.state.playlists.find(p => p.id === arg).trackIds.length;`, pid)) === 2);
const next = await L(`const t = logic.nextListLoopTrack(); return t && t.id;`);
check('online next track = following entry in queue', next === ids[1], next);
await L(`logic.stepTrack(1);`);
check('online step next moves forward', (await L(`return logic.state.currentId;`)) === ids[1]);
await L(`logic.stepTrack(-1);`);
check('online step prev moves back', (await L(`return logic.state.currentId;`)) === ids[0]);
check('no page errors', errors.length === 0, errors);

await browser.close();
process.exit(finish());

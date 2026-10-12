// 迷你播放器（不联网）：电脑上的 Chrome / Edge 点音量那一排的按钮，播放器单独弹成一个浮在所有窗口最上面的小窗
// （Document Picture-in-Picture）。小窗里的键都管用、跟着主页面的状态走；播放队列弹在播放器上面，每行能上移 / 下移 /
// 移出；长歌词放不下时按播放进度往左滑；跟着主题换黑白、跟着界面语言换中英文；「回到网页」关掉小窗。startTrack 换成只记一笔的假函数。
// 注意两点：
// - 不能用 page.route / ctx.route 拦请求：Playwright 一拦，搬到小窗里的样式表就加载不出来（图标变成一串英文）。
//   这里只监听、不拦，最后检查没有请求出本机。
// - 没界面的 Chromium 不管小窗要多大，开出来跟主窗口一样大：用 setViewportSize 当作窗口被改了大小
import { OUT, BASE, launchBrowser, logicDriver, createChecker } from './lib.mjs';

const { check, finish } = createChecker();
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const external = [];
ctx.on('request', req => {
  const u = new URL(req.url());
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
  if (u.origin !== new URL(BASE).origin || /^\/(proxy|stream|sc-client-id)/.test(u.pathname)) external.push(u.href);
});
const errors = [];
const page = await ctx.newPage();
page.on('pageerror', e => errors.push('page: ' + String(e)));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.dc-topbar');
await page.waitForTimeout(800); // 等启动时那次已缓存索引读完
const L = logicDriver(page);

const T = (id, title, artist, album) => ({ id, songid: String(7000 + id), title, artist, album, source: 'netease', duration: 200, cover: null });
const TRACKS = [T(1, '第一首', '歌手甲', '专辑一'), T(2, '第二首', '歌手乙', '专辑二'), T(3, '第三首', '歌手丙', ''), T(4, '第四首', '歌手丁', ''),
  ...[5, 6, 7, 8, 9, 10, 11, 12].map(i => T(i, `第${i}首`, '歌手', ''))];
const LONG = '后来我总算学会了如何去爱，可惜你早已远去消失在人海，后来终于在眼泪中明白';
const LRC = [{ time: 0, text: '短的一句' }, { time: 20, text: LONG }, { time: 26, text: '下一句' }];

// 每一段从同一份数据开始：曲库 12 首，播放队列前 4 首，暂停在第二首的第 10 秒，有歌词
const seed = (opt = {}) => L(`
  logic.__started = [];
  logic.startTrack = function (t, at) { logic.__started.push(t.id); logic.patch({ currentId: t.id, currentTime: at || 0, playing: true }); };
  logic.ensureLyricsForCurrent = function () {};
  logic.prefetchTrack = async function () {}; // 真放起来时会预取下一首（要联网）
  logic.patch({
    page: 'search', openMenu: null, rightPanel: 'browse', mediaView: 'cover', toast: null, theme: 'light',
    queue: arg.tracks, playOrder: arg.order || [1, 2, 3, 4], currentId: arg.current ?? 2, currentTime: 10, playing: false, playMode: 0,
    online: true, offlineOnly: false, lyrics: arg.lrc, lyricsTrackId: arg.current ?? 2, lyricsLoading: false, loadingTrackId: null,
  });
`, { tracks: TRACKS, lrc: LRC, ...opt });
const wait = (ms) => page.waitForTimeout(ms);

const btn = page.locator('button[aria-label="迷你播放器"]');
const openMini = async () => {
  const [mp] = await Promise.all([ctx.waitForEvent('page'), btn.click()]);
  mp.on('pageerror', e => errors.push('mini: ' + String(e)));
  await mp.waitForFunction(() => document.body.classList.contains('sw-mp'));
  await mp.waitForFunction(() => [...document.fonts].some(f => /Material/.test(f.family) && f.status === 'loaded'), null, { timeout: 15000 });
  return mp;
};
// 小窗里看到的样子
const view = (mp) => mp.evaluate(() => {
  const $ = (s) => document.querySelector(s);
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const shift = ($('.sw-mp-ly-txt').style.transform.match(/-?[\d.]+/) || ['0'])[0];
  return {
    theme: document.documentElement.getAttribute('data-app-theme'), bg: getComputedStyle(document.body).backgroundColor,
    title: $('.sw-mp-t').textContent, artist: $('.sw-mp-a').textContent, cover: $('.sw-mp-cover').textContent,
    ly: $('.sw-mp-ly-txt').textContent, lyEmpty: $('.sw-mp-ly').classList.contains('is-empty'), shift: Number(shift),
    fadeL: $('.sw-mp-ly').classList.contains('is-fade-l'), fadeR: $('.sw-mp-ly').classList.contains('is-fade-r'),
    lyBox: r($('.sw-mp-ly')), lyTxt: r($('.sw-mp-ly-txt')),
    play: [$('[data-act="play"] .ms').textContent, $('[data-act="play"]').getAttribute('aria-label'), $('[data-act="play"]').disabled],
    mode: [$('[data-act="mode"] .ms').textContent, $('[data-act="mode"]').getAttribute('aria-label'), $('[data-act="mode"]').className],
    stepDisabled: [$('[data-act="prev"]').disabled, $('[data-act="next"]').disabled],
    list: document.body.classList.contains('is-list'), listBtnOn: $('[data-act="list"]').classList.contains('is-on'),
    rows: [...document.querySelectorAll('.sw-mp-row')].map(row => ({
      id: Number(row.getAttribute('data-id')), cur: row.classList.contains('is-current'),
      up: row.querySelector('[data-act="up"]').disabled, down: row.querySelector('[data-act="down"]').disabled,
    })),
    count: $('.sw-mp-count').textContent,
    body: r(document.body), player: r($('.sw-mp-player')), listBox: r($('.sw-mp-list')), H: document.documentElement.clientHeight,
    // 图标字体没加载出来时，.ms 里的连字会显示成 skip_next 这样一长串字母
    wideIcons: [...document.querySelectorAll('.ms')].filter(el => el.getClientRects().length && el.getBoundingClientRect().width > 32).map(el => el.textContent),
    // 主页面的 html 上 ms-loading 会把图标藏起来（图标字体还没到的时候）；小窗的 html 上没有它，图标不能跟着藏
    hiddenIcons: [...document.querySelectorAll('.ms')].filter(el => el.getClientRects().length && getComputedStyle(el).visibility === 'hidden'
      && getComputedStyle(el.parentElement).visibility !== 'hidden').map(el => el.textContent),
    unlabeled: [...document.querySelectorAll('button')].filter(b => !(b.getAttribute('aria-label') || '').trim()).map(b => b.outerHTML.slice(0, 80)),
  };
});
const shot = async (mp, name) => { await mp.mouse.move(-50, -50); await mp.waitForTimeout(150); await mp.screenshot({ path: `${OUT}/miniplayer-${name}.png` }); };
const closed = (mp) => new Promise(resolve => { if (mp.isClosed()) resolve(true); mp.once('close', () => resolve(true)); setTimeout(() => resolve(mp.isClosed()), 3000); });

// 30 秒的静音 WAV（8kHz、8 位、单声道）：给 audio 元素装上"正在放的那首"，才有真的播放 / 暂停 / 跳转
const WAV = (() => {
  const n = 8000 * 30;
  const b = Buffer.alloc(44 + n, 0x80);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34);
  b.write('data', 36); b.writeUInt32LE(n, 40);
  return 'data:audio/wav;base64,' + b.toString('base64');
})();
const loadAudio = () => page.evaluate(src => new Promise(resolve => {
  const a = document.getElementById('player-audio');
  const timer = setTimeout(() => resolve(false), 5000);
  a.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolve(true); }, { once: true });
  a.src = src;
}), WAV);

// ---- 按钮：只在电脑浏览器里出（APK 里没有，见 native 测试） ----
await seed();
await wait(150);
check('mini player button sits in the volume row', await btn.isVisible() && (await btn.getAttribute('title')).startsWith('迷你播放器'));

// ---- 打开：没界面的 Chromium 开出来的小窗跟主窗口一样高，就像上回开着播放队列关掉的窗口 → 队列直接展开 ----
let mp = await openMini();
let st = await L(`return { open: logic.state.miniPlayerOpen, list: logic._mpListOpen };`);
check('a tall window (closed last time with the queue open) reopens with the queue showing',
  st.open && st.list && (await view(mp)).list && (await btn.getAttribute('class')).includes('is-on'), st);
await btn.click();
const gone = await closed(mp);
await wait(100);
st = { gone, open: await L(`return logic.state.miniPlayerOpen;`), cls: await btn.getAttribute('class') };
check('the button closes it again', st.gone && !st.open && st.cls.includes('is-dim'), st);

// 再开一次，这回让小窗报告自己是平常的 140 高；顺便记下页面要的窗口参数
await page.evaluate(() => {
  const orig = documentPictureInPicture.requestWindow.bind(documentPictureInPicture);
  documentPictureInPicture.requestWindow = async (o) => { window.__mpOpts = o; const w = await orig(o); w.innerHeight = 140; return w; };
});
mp = await openMini();
await mp.setViewportSize({ width: 420, height: 140 });
await wait(150);
const opts = await page.evaluate(() => window.__mpOpts);
check('asks for 420×140, hides Chrome\'s own back-to-tab button, lets Chrome reopen it where the user left it',
  opts.width === 420 && opts.height === 140 && opts.disallowReturnToOpener === true && !('preferInitialWindowPlacement' in opts), opts);
let v = await view(mp);
check('a normal-size window opens without the queue', !v.list && !(await L(`return logic._mpListOpen;`)), v.list);
check('shows the current song: title, artist — album, cover letter, current lyric line',
  v.title === '第二首' && v.artist === '歌手乙 — 专辑二' && v.cover === '第' && v.ly === '短的一句' && !v.lyEmpty, v);
check('icons draw as icons (the icon font loaded in the small window) and none is hidden', v.wideIcons.length === 0 && v.hiddenIcons.length === 0, [...v.wideIcons, ...v.hiddenIcons]);
check('every button has a screen-reader label', v.unlabeled.length === 0, v.unlabeled);
check('player is 420×140 at the top-left', v.body.x === 0 && v.body.y === 0 && v.body.w === 420 && v.body.h === 140 && v.player.y === 0 && v.player.h === 140, v.body);
await shot(mp, 'default');

// 窗口被拖大了：内容不跟着变，照旧贴在左上角
await mp.setViewportSize({ width: 640, height: 300 });
await wait(150);
v = await view(mp);
check('dragging the window bigger does not stretch the player', v.body.x === 0 && v.body.y === 0 && v.body.w === 420 && v.body.h === 140, v.body);
await mp.setViewportSize({ width: 420, height: 140 });

// ---- 跟着主页面：主题、没歌、歌词加载中 / 暂无 ----
await L(`logic.patch({ theme: 'dark' });`);
await wait(150);
const dark = await view(mp);
await shot(mp, 'dark');
await L(`logic.patch({ theme: 'light' });`);
await wait(150);
const light = await view(mp);
check('follows the light / dark theme', dark.theme === 'dark' && light.theme === 'light' && dark.bg !== light.bg, [dark.bg, light.bg]);

// 主页面切到英文：小窗里的字（标签页标题、按钮的读屏名字、播放队列的标题和首数、没歌词时那一行）都跟着换，切回来再换回中文。
// 弹出播放队列直接调 toggleMiniPlayerList：点按钮会顺带改窗口大小
const mpText = (mp) => mp.evaluate(() => {
  const $ = (s) => document.querySelector(s);
  const label = (el) => el.getAttribute('aria-label');
  const row = $('.sw-mp-row');
  return {
    lang: document.documentElement.lang, title: document.title,
    buttons: ['back', 'mode', 'prev', 'play', 'next', 'list'].map(a => label($(`[data-act="${a}"]`))),
    row: row ? [...row.querySelectorAll('button')].map(label) : [],
    head: $('.sw-mp-list-t').textContent, count: $('.sw-mp-count').textContent, ly: $('.sw-mp-ly-txt').textContent,
  };
});
await L(`logic.setLang('en'); logic.patch({ lyricsTrackId: null, lyricsLoading: false }); logic.toggleMiniPlayerList();`);
await wait(150);
const enText = await mpText(mp);
await shot(mp, 'english');
await L(`logic.toggleMiniPlayerList(); logic.setLang('zh');`);
await wait(150);
const zhText = await mpText(mp);
check('switching the page to English switches the small window too (title, button labels, queue, lyric line)',
  JSON.stringify(enText) === JSON.stringify({ lang: 'en', title: 'Listening', buttons: ['Back to page', 'Repeat all', 'Previous', 'Play', 'Next', 'Queue'],
    row: ['Move up', 'Move down', 'Remove from queue'], head: 'Queue', count: '4 songs', ly: 'No lyrics' }), enText);
check('…and back to Chinese', zhText.lang === 'zh-CN' && zhText.title === '听音乐'
  && zhText.buttons.join() === '回到网页,列表循环,上一首,播放,下一首,播放队列' && zhText.ly === '暂无歌词', zhText);
await L(`logic.patch({ lyricsTrackId: null, lyricsLoading: true });`);
await wait(100);
const lyLoading = (await view(mp)).ly;
await L(`logic.patch({ lyricsLoading: false });`);
await wait(100);
v = await view(mp);
check('lyric line says 歌词加载中… / 暂无歌词 when there are none', lyLoading === '歌词加载中…' && v.ly === '暂无歌词' && v.lyEmpty, [lyLoading, v.ly]);
await L(`logic.patch({ currentId: null, playOrder: [] });`);
await wait(100);
v = await view(mp);
check('with nothing to play: 暂无播放, play / prev / next disabled', v.title === '暂无播放' && v.play[2] && v.stepDisabled.every(Boolean), v);

// ---- 键：播放模式、播放、上一首 / 下一首 ----
await seed();
await wait(100);
const modes = [];
for (let i = 0; i < 3; i++) {
  await mp.click('[data-act="mode"]');
  await wait(80);
  modes.push([await L(`return logic.state.playMode;`), ...(await view(mp)).mode]);
}
check('mode button cycles 随机播放 → 单曲循环 → 列表循环 and shows it',
  JSON.stringify(modes) === JSON.stringify([[1, 'shuffle', '随机播放', 'is-on'], [2, 'repeat_one', '单曲循环', 'is-on'], [0, 'repeat', '列表循环', 'is-dim']]), modes);
await mp.click('[data-act="play"]');
await wait(80);
await mp.click('[data-act="next"]');
await wait(80);
await mp.click('[data-act="prev"]');
await wait(80);
st = await L(`return { started: logic.__started, playing: logic.state.playing };`);
v = await view(mp);
check('play, next and previous drive the player', JSON.stringify(st.started) === '[2,3,2]' && st.playing && v.play[0] === 'pause' && v.play[1] === '暂停', { ...st, play: v.play });

// 真的音频：播放 / 暂停、空格键、点进度线跳转
await seed();
check('test audio loaded into the player', await loadAudio());
await mp.click('[data-act="play"]');
await page.waitForFunction(() => !document.getElementById('player-audio').paused, null, { timeout: 5000 }).catch(() => {});
await wait(200);
const playing1 = await L(`return logic.state.playing;`);
await mp.click('[data-act="play"]');
await wait(200);
const playing2 = await L(`return logic.state.playing;`);
check('play / pause toggles the real audio', playing1 === true && playing2 === false, [playing1, playing2]);
await mp.keyboard.press('Space');
await wait(300);
const spacePlay = await L(`return logic.state.playing;`);
await mp.keyboard.press('Space');
await wait(300);
check('space bar plays and pauses', spacePlay === true && (await L(`return logic.state.playing;`)) === false, spacePlay);
await mp.click('[data-act="seek"]', { position: { x: 105, y: 1 } });
await wait(150);
st = await L(`return { audio: document.getElementById('player-audio').currentTime, state: logic.state.currentTime };`);
check('clicking the progress line seeks (a quarter of the way → 7.5s of 30s)', Math.abs(st.audio - 7.5) < 0.3 && Math.abs(st.state - 7.5) < 0.3, st);

// ---- 长歌词：放不下就在唱这句的时间里往左滑（20s 开始、26s 下一句：20.9s 前停在句首，24.8s 滑到句尾） ----
const lyricAt = async (t, name) => {
  await L(`logic.patch({ currentTime: arg, playing: false });`, t);
  await wait(120);
  if (name) await shot(mp, name);
  return view(mp);
};
const shortLine = await lyricAt(10);
const start = await lyricAt(20, 'lyric-1-start');
const over = start.lyTxt.w - start.lyBox.w;
const middle = await lyricAt(22.85, 'lyric-2-middle');
const end = await lyricAt(24.8, 'lyric-3-end');
const next = await lyricAt(26);
check('a short lyric line stays put, no fading edges', shortLine.ly === '短的一句' && shortLine.shift === 0 && !shortLine.fadeL && !shortLine.fadeR, shortLine);
check('a long line keeps all its words (no …) and starts at its beginning, right edge fading',
  start.ly === LONG && over > 100 && start.shift === 0 && !start.fadeL && start.fadeR, { over, shift: start.shift });
check('…halfway through the line it has slid halfway, both edges fading', Math.abs(middle.shift + over / 2) <= 2 && middle.fadeL && middle.fadeR, { shift: middle.shift, over });
check('…by 80% of the line its end is showing, left edge fading', Math.abs(end.shift + over) <= 1 && Math.abs(end.lyTxt.r - end.lyBox.r) <= 1 && end.fadeL && !end.fadeR, { shift: end.shift, txtR: end.lyTxt.r, boxR: end.lyBox.r });
check('the next (short) line starts fresh', next.ly === '下一句' && next.shift === 0 && !next.fadeL && !next.fadeR, next);
// 在放的时候按 audio 的进度走，每帧更新；暂停就停下
await page.evaluate(() => { document.getElementById('player-audio').currentTime = 22.85; });
await L(`logic.patch({ currentTime: 22.85, playing: true });`);
await wait(150);
const playingView = await view(mp);
const looping = await L(`return !!logic._mpLyRaf;`);
await L(`logic.patch({ playing: false });`);
await wait(150);
check('while playing it follows the audio every frame, and stops when paused',
  Math.abs(playingView.shift + over / 2) <= 2 && looping && !(await L(`return !!logic._mpLyRaf;`)), { shift: playingView.shift, looping });

// ---- 播放队列：弹在整个播放器上面，每行上移 / 下移 / 移出，点一行放那首 ----
await seed();
await wait(100);
await mp.click('[data-act="list"]');
await wait(120);
v = await view(mp);
check('opening the queue does not push the player out while the window is still small', v.list && v.listBtnOn && v.listBox.h === 0 && v.player.y === 0 && v.player.b === 140, { list: v.listBox, player: v.player });
await mp.setViewportSize({ width: 420, height: 460 }); // 真窗口里 fitMiniPlayer 会把窗口加高到 460
await wait(150);
v = await view(mp);
await shot(mp, 'queue');
check('once the window is 460 tall: queue on top, player at the bottom',
  v.listBox.y === 0 && v.listBox.h === 320 && v.player.y === 320 && v.player.b === 460, { list: v.listBox, player: v.player });
check('queue lists the play order with the current song marked',
  v.count === '4 首' && JSON.stringify(v.rows.map(r => r.id)) === '[1,2,3,4]' && v.rows.filter(r => r.cur).map(r => r.id).join() === '2'
  && v.rows[0].up && !v.rows[0].down && v.rows[3].down && !v.rows[3].up, v.rows);
const rowBtn = (id, act) => mp.click(`.sw-mp-row[data-id="${id}"] [data-act="${act}"]`);
await rowBtn(1, 'down');
await wait(80);
await rowBtn(4, 'up');
await wait(80);
const moved = await L(`return logic.state.playOrder;`);
await rowBtn(3, 'remove');
await wait(80);
st = await L(`return { order: logic.state.playOrder, library: logic.state.queue.length };`);
check('↓ / ↑ move songs, × only takes them out of the queue',
  JSON.stringify(moved) === '[2,1,4,3]' && JSON.stringify(st.order) === '[2,1,4]' && st.library === 12, { moved, ...st });
await mp.click('.sw-mp-row[data-id="4"]');
await wait(120);
v = await view(mp);
check('clicking a row plays that song', JSON.stringify(await L(`return logic.__started;`)) === '[4]' && v.rows.find(r => r.cur).id === 4 && v.title === '第四首', v.rows);
await mp.click('[data-act="list"]');
await wait(100);
check('the queue button folds it away again', !(await view(mp)).list && !(await L(`return logic._mpListOpen;`)));
await mp.setViewportSize({ width: 420, height: 140 });

// 长队列：窗口加高以后把正在放的那首滚到队列中间
await seed({ order: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], current: 7 });
await wait(100);
await mp.click('[data-act="list"]');
await mp.setViewportSize({ width: 420, height: 460 });
await wait(200);
const centred = await mp.evaluate(() => {
  const lr = document.querySelector('.sw-mp-list').getBoundingClientRect();
  const r = document.querySelector('.sw-mp-row.is-current').getBoundingClientRect();
  return { row: r.y + r.height / 2, list: lr.y + lr.height / 2, scrolled: document.querySelector('.sw-mp-list').scrollTop, bodyScroll: document.scrollingElement.scrollTop };
});
check('in a long queue the current song is scrolled to the middle (only the queue scrolls)',
  Math.abs(centred.row - centred.list) <= 24 && centred.scrolled > 0 && centred.bodyScroll === 0, centred);
await mp.click('[data-act="list"]');
await mp.setViewportSize({ width: 420, height: 140 });

// ---- 回到网页：关掉小窗 ----
await mp.click('[data-act="back"]');
const backGone = await closed(mp);
await wait(100);
st = { gone: backGone, open: await L(`return logic.state.miniPlayerOpen;`), cls: await btn.getAttribute('class') };
check('回到网页 closes the small window', st.gone && !st.open && st.cls.includes('is-dim'), st);

check('no page errors', errors.length === 0, errors);
check('no network requests left the machine', external.length === 0, external.slice(0, 5));

await browser.close();
process.exit(finish());

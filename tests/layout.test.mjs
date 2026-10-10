// 版面检查（不联网）：手机竖屏、横过来的手机、平板、电脑四种尺寸，把每个页面、播放页的封面 / 歌词 / 队列、
// ⋮ 菜单和各个弹窗都走一遍：没有报错、没有东西伸出屏幕，该出现的栏出现、不该出现的藏好，顶栏高度、
// 播放页底下 5 个键等距、歌词当前行居中、纯图标按钮都有读屏名字、点菜单外面能收起菜单。
// 每一屏存一张截图（OUT/layout-<尺寸>-<屏>.png）。示例数据直接塞进页面状态；外网请求一律拦掉，
// 封面图回一张本地小图，本地服务器上会再去联网的接口（/proxy、/stream）也拦掉
import { BASE, OUT, launchBrowser, logicDriver, createChecker } from './lib.mjs';

const { check, finish } = createChecker();
const browser = await launchBrowser();

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const T = (id, title, artist, album, source, hasCover, duration) => ({
  id, songid: String(9000 + id), title, artist, album, source, duration,
  cover: hasCover ? `https://p3.music.126.net/layout-test/${id}.jpg?param=300y300` : null,
});
const RESULTS = [
  T(101, '后来', '刘若英', '我等你', 'netease', true, 341),
  T(102, '刘若英-后来（Y remix）', 'Tina', '', 'qq', true, 212),
  T(103, '后来（温柔女声版）', '西罕', '', 'netease', true, 290),
  T(104, '后来(live)', '傻蛋', '', 'qq', true, 301),
  T(105, '后来 (烟嗓版)', '郑大钱', '', 'netease', true, 276),
  T(106, '后来 (翻唱)', '回音哥', '', 'qq', true, 288),
  T(107, '后来（雷鬼）', '时空音造局', '', 'netease', true, 233),
  T(108, '后来 (伴奏)', '刘若英', '', 'qq', false, 341),
  T(109, '后来', '张敬轩', '', 'netease', true, 265),
  // 特别长的歌名和歌手：看会不会把行撑出屏幕
  T(110, '后来（Live at Taipei Arena 2026 · 二十五周年巡回演唱会 · 加长版 · 无删减）', '刘若英 & 一个名字非常非常长的乐队 & 另一位特别嘉宾', '一张名字也很长的现场专辑', 'qq', true, 280),
];
const MORE = [
  T(201, '平凡之路', '朴树', '猎户星座', 'netease', true, 301),
  T(202, '晴天 (钢琴版) [原唱: 周杰伦]', '纪钧瀚 (Bryan Chi)', '', 'netease', true, 269),
  T(203, '七里香 (女声版)', '吉拉朵', '', 'qq', true, 245),
  T(204, '七里香 (MV版)', '王俊凯', '', 'qq', true, 299),
  T(205, '晴天', 'Jay', '', 'netease', true, 269),
  T(206, '后来 (Live)', '刘若英', '', 'netease', true, 362),
  T(207, '平凡之路', '陌尘', '', 'qq', true, 298),
];
const COMMUTE = [101, 201, 202, 203, 204, 205, 206, 207];
const LRC = ['后来 我总算学会了如何去爱', '可惜你 早已远去 消失在人海', '后来 终于在眼泪中明白', '有些人 一旦错过就不在',
  '栀子花 白花瓣', '落在我蓝色百褶裙上', '爱你 你轻声说', '我低下头 闻见一阵芬芳', '那个永恒的夜晚', '十七岁仲夏',
  '你吻我的那个夜晚，让我往后的时光每当有感叹总想起当天的星光，那时候的爱情为什么就能那样简单（一句特别长的歌词）',
  '每当有感叹', '总想起当天的星光', '那时候的爱情', '为什么就能那样简单'].map((text, i) => ({ time: 10 + i * 6, text }));

// 每一屏从同一份数据开始：曲库、播放队列、当前曲目、歌单、喜欢、搜索历史、已缓存，界面状态全部复位
const SEED = `
  logic._cachedKeys = new Set(['netease:9101', 'netease:9201', 'netease:9205', 'netease:9109']);
  logic.patch({
    page: 'search', viewingPlaylistId: null, openMenu: null, mobileNowPlayingExpanded: false, rightPanel: 'browse', mediaView: 'cover',
    addModalId: null, importModalOpen: false, createModalOpen: false, shareModalOpen: false, toast: '',
    queue: [...arg.results, ...arg.more], searchResults: arg.results, hasSearched: false, appliedQuery: '', searchQuery: '',
    searchFocused: false, suggestions: [], suggestActiveIdx: -1, suggestDismissed: false, localSearch: false,
    playOrder: arg.commute, currentId: 101, currentTime: 66, playing: false, online: true,
    liked: { 101: true, 201: true, 203: true, 105: true }, likedOrder: [101, 201, 203, 105],
    playlists: [
      { id: 'liked', name: '喜欢的音乐', builtin: true, glyph: 'favorite', iconFill: 1, tileBg: '' },
      { id: 'pl_1', name: '通勤路上', builtin: false, trackIds: arg.commute, glyph: 'queue_music', iconFill: 0, tileBg: '' },
      { id: 'pl_2', name: '一个名字特别特别长、长到一行放不下的歌单（周末午后慢慢听）', builtin: false, trackIds: [202, 205, 206], glyph: 'queue_music', iconFill: 0, tileBg: '' },
      { id: 'pl_3', name: '空歌单', builtin: false, trackIds: [], glyph: 'queue_music', iconFill: 0, tileBg: '' },
    ],
    searchHistory: ['后来', '周杰伦', '平凡之路', '陈奕迅 十年', '七里香 钢琴', 'Taylor Swift'],
    lyrics: arg.lrc, lyricsTrackId: 101, cachedCount: 4, cachedBytes: 386 * 1024 * 1024, cacheCapMB: 2048,
    exportReady: false, cacheRev: (logic.state.cacheRev || 0) + 1,
  });
`;
const SEARCHED = `logic.patch({ hasSearched: true, appliedQuery: '后来', searchQuery: '后来' });`;
const PLAYER = `logic.patch({ mobileNowPlayingExpanded: true });`;
const SCREENS = {
  'search-home': ``,
  'search-focus': `logic.patch({ searchFocused: true });`,
  'suggest': `logic.patch({ searchQuery: '后', searchFocused: true, suggestActiveIdx: 1, suggestions: [
      { title: '后来', artist: '刘若英' }, { title: '后来的我们', artist: '五月天' }, { title: '后会无期', artist: 'G.E.M.邓紫棋' }, { title: '后继者', artist: '任然' } ] });`,
  'search': SEARCHED,
  'add-sheet': `${SEARCHED} logic.openAddModal(110);`,
  'library': `logic.setPage('library');`,
  'playlist': `logic.selectPlaylist('pl_1');`,
  'playlist-menu': `logic.selectPlaylist('pl_2'); logic.toggleMenu('playlist');`,
  'playlist-empty': `logic.selectPlaylist('pl_3');`,
  'cached': `logic.selectPlaylist('__cached');`,
  'settings': `logic.setPage('settings'); logic.patch({ online: false });`,
  'player-cover': `${PLAYER} logic.setMediaView('cover');`,
  'player-lyrics': `${PLAYER} logic.setMediaView('lyrics');`,
  'player-queue': `${PLAYER} logic.setMediaView('queue');`,
  'player-menu': `${PLAYER} logic.toggleMenu('player');`,
  'player-long-title': `${PLAYER} logic.patch({ currentId: 110 });`,
  'share': `logic.openShareModal();`,
  'import': `logic.openImportModal();`,
  'create': `logic.openCreateModal();`,
};

// mobile：手机布局（迷你播放条 + 全屏播放页）；two：当前页 | 播放栏（npW 是播放栏的宽度）。
// 电脑上原来是三栏（左边多一条歌单栏），跟顶栏的「歌单」重复，去掉了（#27）
const VIEWPORTS = [
  { name: 'phone', size: { width: 412, height: 915 }, touch: true, layout: 'mobile' },
  { name: 'landscape', size: { width: 915, height: 412 }, touch: true, layout: 'mobile' },
  { name: 'tablet', size: { width: 1024, height: 768 }, touch: false, layout: 'two', npW: 340 },
  { name: 'desktop', size: { width: 1440, height: 900 }, touch: false, layout: 'two', npW: 400 },
];

// 在页面里量一屏：可见的元素有没有伸出屏幕左右两边、纯图标按钮有没有 aria-label、几个关键部件的位置
const measure = () => {
  const vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const box = (el) => { if (!vis(el)) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
  const $ = (sel) => document.querySelector(sel);
  const W = window.innerWidth;
  const name = (el) => `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).join('.')}`;
  // 看得见的那一截：被外层 overflow 裁掉的部分（比如长歌名末尾的省略号）不算伸出去
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    let left = r.left, right = r.right;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (getComputedStyle(a).overflowX === 'visible') continue;
      const ar = a.getBoundingClientRect();
      left = Math.max(left, ar.left); right = Math.min(right, ar.right);
    }
    return { left, right };
  };
  const outside = [];
  for (const el of document.querySelectorAll('.dc-app-shell *')) {
    if (!vis(el)) continue;
    const { left, right } = shown(el);
    if (right <= left) continue;
    if (right > W + 1 || left < -1) outside.push(`${name(el)} [${Math.round(left)}, ${Math.round(right)}]`);
    // 能横着滚的区域也算：内容比框宽，手指一划就歪了
    const ox = getComputedStyle(el).overflowX;
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1) outside.push(`${name(el)} scrolls sideways by ${el.scrollWidth - el.clientWidth}px`);
  }
  // 能点的东西（按钮、链接、输入框）可见部分的左右边界，量侧边安全区用
  const hits = [...document.querySelectorAll('.dc-app-shell button, .dc-app-shell a, .dc-app-shell input')].filter(vis)
    .map(el => ({ el: name(el).slice(0, 60), ...shown(el) })).filter(h => h.right > h.left);
  const unlabeled = [];
  for (const b of document.querySelectorAll('.dc-app-shell button, .dc-app-shell a')) {
    if (!vis(b)) continue;
    const clone = b.cloneNode(true);
    clone.querySelectorAll('.ms').forEach(n => n.remove());
    if (!clone.textContent.trim() && !(b.getAttribute('aria-label') || '').trim()) unlabeled.push(b.outerHTML.slice(0, 120));
  }
  const ctrls = [...document.querySelectorAll('.sw-controls > button')].map(box);
  const lines = [...document.querySelectorAll('.sw-ly')].map(box).filter(Boolean);
  return {
    W, H: window.innerHeight,
    docOverflow: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
    outside: outside.slice(0, 8), outsideCount: outside.length, unlabeled,
    topbar: box($('.dc-topbar')),
    nav: [...document.querySelectorAll('.sw-nav-btn')].map(b => ({ label: b.getAttribute('aria-label'), title: b.getAttribute('title'), active: b.classList.contains('is-active'), w: b.offsetWidth, h: b.offsetHeight })),
    main: box($('.sw-main')), np: box($('.dc-nowplaying')), mini: box($('.sw-mini')),
    libRows: [...document.querySelectorAll('.sw-lib-row')].filter(vis).length,
    modal: box($('.dc-modal')), menu: box($('.sw-menu')), cover: box($('.sw-big-cover')), viewport: box($('.dc-media-viewport')),
    title: box($('.sw-np-title')), titleLine: parseFloat(getComputedStyle($('.sw-np-title')).lineHeight),
    ctrls, playIdx: [...document.querySelectorAll('.sw-controls > button')].findIndex(b => b.classList.contains('sw-play-big')),
    lines, curLine: box($('.sw-ly.is-cur')),
    rowBtns: [...document.querySelectorAll('.dc-result-row .sw-acts > button')].filter(vis).map(b => [b.offsetWidth, b.offsetHeight]),
    hits,
    // 播放页顶部那一行：标签组、⋮、⌄（电脑上 ⌄ 隐藏）
    head: box($('.sw-np-head')), tabs: box($('.sw-np-head .sw-tabs')), more: box($('.sw-np-more > .sw-icon-btn')), collapse: box($('.sw-np-head .sw-collapse')),
    npLabel: [...document.querySelectorAll('.dc-nowplaying *')].some(el => vis(el) && !el.children.length && el.textContent.trim() === '正在播放'),
    filtersText: ($('.sw-filters') || {}).textContent || '',
    recents: document.querySelectorAll('.sw-recent-row').length, hint: /一起搜/.test(document.body.textContent),
    scrollbar: (({ scrollbarWidth, scrollbarColor }) => ({ scrollbarWidth, scrollbarColor }))(getComputedStyle($('.sw-main'))),
  };
};

for (const vp of VIEWPORTS) {
  for (const theme of vp.name === 'phone' ? ['light', 'dark'] : ['light']) {
    const tag = theme === 'light' ? vp.name : `${vp.name}-dark`;
    const ctx = await browser.newContext({
      viewport: vp.size, deviceScaleFactor: 2, isMobile: vp.touch, hasTouch: vp.touch,
      serviceWorkers: 'block', reducedMotion: 'reduce',
    });
    if (theme === 'dark') await ctx.addInitScript(() => { try { localStorage.setItem('listening-player-theme-v1', 'dark'); } catch (e) { /* 读不到就是白底 */ } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    const external = [];
    await page.route('**/*', route => {
      const req = route.request();
      const u = new URL(req.url());
      const local = u.origin === new URL(BASE).origin;
      if (local && !/^\/(proxy|stream|sc-client-id)/.test(u.pathname)) return route.continue();
      if (req.resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      external.push(req.url());
      return route.abort();
    });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('.dc-topbar');
    await page.evaluate(() => document.fonts.ready);
    const L = logicDriver(page);

    if (tag === 'phone') {
      const t0 = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-app-theme'), bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() }));
      check('default theme is white (no saved choice)', t0.attr === 'light' && t0.bg.toUpperCase() === '#F7F7F4', t0);
    }
    if (tag === 'phone-dark') {
      check('saved dark theme is applied before first paint', (await page.evaluate(() => document.documentElement.getAttribute('data-app-theme'))) === 'dark');
    }

    const bad = { outside: [], unlabeled: [], overflow: [] };
    const shots = {};
    for (const [name, code] of Object.entries(SCREENS)) {
      await L(SEED, { results: RESULTS, more: MORE, commute: COMMUTE, lrc: LRC });
      await page.waitForTimeout(50);
      if (code) await L(code);
      await page.waitForTimeout(name === 'player-lyrics' ? 400 : 150);
      const m = await page.evaluate(measure);
      shots[name] = m;
      if (m.outsideCount) bad.outside.push(`${name}: ${m.outsideCount} → ${m.outside.join(' | ')}`);
      if (m.unlabeled.length) bad.unlabeled.push(`${name}: ${m.unlabeled.join(' | ')}`);
      if (m.docOverflow > 0) bad.overflow.push(`${name}: ${m.docOverflow}px`);
      await page.screenshot({ path: `${OUT}/layout-${tag}-${name}.png` });
    }
    check(`${tag}: nothing sticks out past the screen edges`, bad.outside.length === 0 && bad.overflow.length === 0, [...bad.overflow, ...bad.outside]);
    check(`${tag}: every icon-only button has an aria-label`, bad.unlabeled.length === 0, bad.unlabeled);

    // 顶栏：48px 高，三个 48×48 图标按钮（搜索 / 歌单 / 设置），读屏名字和悬停提示都在，当前页那个是选中态
    const home = shots['search-home'];
    const navOk = home.nav.length === 3 && home.nav.map(n => n.label).join() === '搜索,歌单,设置'
      && home.nav.every(n => n.title === n.label && n.w === 48 && n.h === 48)
      && home.nav.map(n => n.active).join() === 'true,false,false'
      && shots.settings.nav.map(n => n.active).join() === 'false,false,true'
      && shots.playlist.nav.map(n => n.active).join() === 'false,true,false';
    check(`${tag}: topbar is 48px with the three labelled nav icons`, Math.round(home.topbar.h) === 48 && navOk, { h: home.topbar.h, nav: home.nav });

    // 歌单只从顶栏的「歌单」进：只有歌单页上列着歌单（已缓存、喜欢的音乐和 3 个歌单），别的页上一行都没有
    check(`${tag}: playlists are listed only on the playlists page`, shots.library.libRows === 5 && home.libRows === 0,
      { library: shots.library.libRows, search: home.libRows });

    // 分栏
    if (vp.layout === 'mobile') {
      check(`${tag}: phone layout (mini player at the bottom, player page hidden)`,
        !home.np && home.mini && Math.round(home.mini.b) === home.H && Math.round(home.mini.h) === 64,
        { np: home.np, mini: home.mini });
      const pc = shots['player-cover'];
      check(`${tag}: player page covers the whole screen when opened`, pc.np && Math.round(pc.np.w) === pc.W && Math.round(pc.np.h) === pc.H, pc.np);
    } else {
      // 当前页从屏幕最左边开始（左边没有别的栏），右边紧挨着播放栏
      check(`${tag}: two columns (page | player ${vp.npW}px), nothing left of the page, no mini player`,
        home.main && Math.round(home.main.x) === 0 && home.np && Math.round(home.np.w) === vp.npW && !home.mini && Math.round(home.main.r) === Math.round(home.np.x),
        { main: home.main, np: home.np, mini: home.mini });
    }

    // 播放页：5 个键五等分（中心等距、播放键在正中间）、封面是正方形且在媒体区里、长歌名最多两行
    const pc = shots['player-cover'];
    const centers = pc.ctrls.map(c => c.x + c.w / 2);
    const gaps = centers.slice(1).map((c, i) => c - centers[i]);
    check(`${tag}: 5 player controls evenly spaced, play in the middle`,
      pc.ctrls.length === 5 && pc.playIdx === 2 && Math.max(...gaps) - Math.min(...gaps) <= 1 && pc.ctrls.every(c => c.w >= 44 && c.h >= 44),
      { gaps: gaps.map(g => Math.round(g * 10) / 10), playIdx: pc.playIdx });
    check(`${tag}: cover is square and fits the media area`,
      pc.cover && Math.abs(pc.cover.w - pc.cover.h) <= 1 && pc.cover.w > 100 && pc.cover.y >= pc.viewport.y - 1 && pc.cover.b <= pc.viewport.b + 1,
      { cover: pc.cover, viewport: pc.viewport });
    const lt = shots['player-long-title'];
    check(`${tag}: long song title is cut to two lines`, lt.title && lt.title.h <= lt.titleLine * 2 + 1, { h: lt.title && lt.title.h, line: lt.titleLine });

    // 播放页顶部只有一行：标签在左，⋮ 在右（手机上 ⋮ 右边紧挨着 ⌄，⌄ 在最右；电脑上没有 ⌄，⋮ 在最右），
    // 三样东西的竖直中心都在这一行里；不再有「正在播放」小标题
    const inRow = (b) => b && Math.abs((b.y + b.h / 2) - (pc.head.y + pc.head.h / 2)) <= 2;
    const headOk = pc.head && Math.round(pc.head.h) === 48 && inRow(pc.tabs) && inRow(pc.more) && !pc.npLabel
      && pc.tabs.r <= pc.more.x + 0.5
      && (vp.layout === 'mobile'
        ? inRow(pc.collapse) && Math.abs(pc.more.r - pc.collapse.x) <= 0.5 && pc.collapse.r > pc.head.r
        : !pc.collapse && pc.more.r > pc.head.r);
    check(`${tag}: player top is one row (tabs, then ⋮${vp.layout === 'mobile' ? ', then ⌄ at the far right' : ' at the far right'})`, headOk,
      { head: pc.head, tabs: pc.tabs, more: pc.more, collapse: pc.collapse, label: pc.npLabel });
    // ⋮ 菜单挂在 ⋮ 正下方：上沿贴着这一行的底线，右边缘落在 ⋮ 按钮的范围里
    const pm = shots['player-menu'];
    check(`${tag}: player ⋮ menu hangs right under the ⋮ button`,
      pm.menu && pm.more && Math.abs(pm.menu.y - pm.head.b) <= 4 && pm.menu.r >= pm.more.x && pm.menu.r <= pm.more.r + 0.5,
      { menu: pm.menu, more: pm.more, headBottom: pm.head && pm.head.b });

    // 搜索页没有分组选项了（搜到结果之后也没有）
    check(`${tag}: search filters have no grouping options`, /网易云/.test(shots.search.filtersText) && !/分组|歌手|来源/.test(shots.search.filtersText), shots.search.filtersText);

    // 「最近搜索」平时不显示，点进输入框（框里没字、还没搜过）才出现；原来那句「网易云音乐、QQ音乐一起搜」的提示删掉了
    check(`${tag}: recent searches only show while the search box is focused, no hint line`,
      shots['search-home'].recents === 0 && !shots['search-home'].hint && shots['search-focus'].recents === 6,
      { home: shots['search-home'].recents, focused: shots['search-focus'].recents, hint: shots['search-home'].hint });

    // 滚动条：触屏不自定义（用系统那种滑动才出现的），用鼠标的电脑上是细方条
    const sb = home.scrollbar;
    check(`${tag}: ${vp.touch ? 'system scrollbar on touch screens' : 'thin custom scrollbar with a mouse'}`,
      vp.touch ? sb.scrollbarWidth === 'auto' && sb.scrollbarColor === 'auto' : sb.scrollbarWidth === 'thin', sb);

    // 歌词：每行 48px（滚动定位按这个数算），当前行停在歌词区正中间
    const ly = shots['player-lyrics'];
    const mid = ly.viewport && (ly.viewport.y + ly.viewport.h / 2);
    check(`${tag}: lyric lines are 48px and the current line sits in the middle`,
      ly.lines.length === LRC.length && ly.lines.every(l => Math.round(l.h) === 48) && ly.curLine && Math.abs(ly.curLine.y + ly.curLine.h / 2 - mid) <= 2,
      { heights: [...new Set(ly.lines.map(l => Math.round(l.h)))], cur: ly.curLine, mid });

    // 菜单在屏幕里；弹窗：手机是贴底的弹层，电脑是屏幕中间的方框
    const menuOk = ['player-menu', 'playlist-menu'].every(n => shots[n].menu && shots[n].menu.x >= 0 && shots[n].menu.r <= shots[n].W);
    check(`${tag}: ⋮ menus open inside the screen`, menuOk, { player: shots['player-menu'].menu, playlist: shots['playlist-menu'].menu });
    const sheets = ['add-sheet', 'share', 'import', 'create'].map(n => [n, shots[n].modal, shots[n].H, shots[n].W]);
    const sheetOk = sheets.every(([, b, H, W]) => b && (vp.layout === 'mobile'
      ? Math.round(b.b) === H && Math.round(b.w) === W
      : Math.abs((b.x + b.w / 2) - W / 2) <= 1 && Math.abs((b.y + b.h / 2) - H / 2) <= 1));
    check(`${tag}: dialogs are ${vp.layout === 'mobile' ? 'bottom sheets' : 'centred boxes'}`, sheetOk, sheets.map(([n, b]) => [n, b]));

    if (vp.layout === 'mobile') {
      const btns = shots.search.rowBtns;
      check(`${tag}: list row buttons are 44px tap targets`, btns.length > 0 && btns.every(([w, h]) => w >= 44 && h >= 44), btns.slice(0, 4));
    }

    // 点菜单外面收起菜单，而且这一下不会顺带点到下面的东西（比如放了别的歌）
    await L(SEED, { results: RESULTS, more: MORE, commute: COMMUTE, lrc: LRC });
    await L(`${SEARCHED} ${PLAYER} logic.toggleMenu('player');`);
    await page.waitForTimeout(150);
    const target = vp.layout === 'mobile' ? { x: 24, y: Math.round(vp.size.height * 0.6) } : { x: Math.round((home.main.x + home.main.r) / 2), y: Math.round(home.main.y + home.main.h * 0.6) };
    if (vp.touch) await page.touchscreen.tap(target.x, target.y); else await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(150);
    const after = await L(`return { menu: logic.state.openMenu, cur: logic.state.currentId, open: logic.state.mobileNowPlayingExpanded };`);
    check(`${tag}: tapping outside closes the ⋮ menu without hitting what is underneath`,
      after.menu === null && after.cur === 101 && (vp.layout !== 'mobile' || after.open === true), after);

    // 真点一下：点进输入框出现最近搜索，点其中一条就用这个词去搜（doSearch 临时换成只记下关键词，免得联网）
    const tapAt = async (sel, i = 0) => {
      const b = await page.evaluate(([q, n]) => { const r = document.querySelectorAll(q)[n].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, [sel, i]);
      if (vp.touch) await page.touchscreen.tap(b.x, b.y); else await page.mouse.click(b.x, b.y);
    };
    const searchState = () => page.evaluate(() => ({
      focused: document.activeElement === document.querySelector('.dc-search-input'),
      recents: document.querySelectorAll('.sw-recent-row').length,
    }));
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await L(SEED, { results: RESULTS, more: MORE, commute: COMMUTE, lrc: LRC });
    await L(`logic.__picked = null; logic.doSearch = function () { logic.__picked = logic.state.searchQuery; };`);
    await page.waitForTimeout(250);
    const before = await searchState();
    await tapAt('.dc-search-input');
    await page.waitForTimeout(150);
    const focused = await searchState();
    await tapAt('.sw-recent-row', 1);
    await page.waitForTimeout(250);
    const picked = await L(`const kw = logic.__picked; delete logic.doSearch; return kw;`);
    check(`${tag}: tapping the search box shows recent searches; tapping one searches it`,
      before.recents === 0 && focused.focused && focused.recents === 6 && picked === '周杰伦', { before, focused, picked });

    // 可视区域怎么变都不许让搜索框失焦：v1.0.10 曾按「可视区域突然变高」去猜键盘收起，真机上键盘弹出时可视区域
    // 会先缩过头再弹回来，被当成收起，结果一点搜索框键盘就被收回去。这里照那个过程改一遍视口（弹出、缩过头、弹回、
    // 收起、转屏），搜索框得一直聚焦、最近搜索一直在。APK 里收起键盘由 MainActivity 发事件，见 native 测试
    if (vp.touch) {
      const size = vp.size;
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      await L(SEED, { results: RESULTS, more: MORE, commute: COMMUTE, lrc: LRC });
      await page.waitForTimeout(250);
      await tapAt('.dc-search-input');
      // 按屏幕高度的比例缩：横屏时高度只有 400 出头，减固定像素会减成负数
      const kb = Math.round(size.height * 0.45), over = Math.round(size.height * 0.75);
      const steps = [
        { width: size.width, height: size.height - kb },     // 键盘弹出
        { width: size.width, height: size.height - over },   // 缩过头
        { width: size.width, height: size.height - kb },     // 弹回来（就是这一下被误当成收键盘）
        { width: size.width, height: size.height },          // 高度恢复
        { width: size.height, height: size.width },         // 转屏
        size,                                               // 转回来
      ];
      const seen = [];
      for (const st of steps) {
        await page.setViewportSize(st);
        await page.waitForTimeout(250);
        seen.push(await searchState());
      }
      check(`${tag}: viewport changes (keyboard opening, bouncing, rotating) never unfocus the search box`,
        seen.every(x => x.focused && x.recents === 6), seen);
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      await page.waitForTimeout(250);
    }

    // 手机上再看一次刘海 / 手势条的避让：顶栏让出状态栏，迷你播放条让出手势条
    if (vp.name === 'phone') {
      await L(SEED, { results: RESULTS, more: MORE, commute: COMMUTE, lrc: LRC });
      await page.evaluate(() => {
        document.documentElement.style.setProperty('--safe-area-inset-top', '32px');
        document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px');
      });
      await page.waitForTimeout(150);
      const sa = await page.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        const mini = document.querySelector('.sw-mini');
        return { topbar: r('.dc-topbar').height, miniH: r('.sw-mini').height, miniBottom: r('.sw-mini').bottom, miniPad: getComputedStyle(mini).paddingBottom, H: innerHeight };
      });
      check(`${tag}: safe areas (topbar 80px under a 32px status bar, mini player above a 24px gesture bar)`,
        Math.round(sa.topbar) === 80 && Math.round(sa.miniH) === 88 && sa.miniPad === '24px' && Math.round(sa.miniBottom) === sa.H, sa);
      await page.screenshot({ path: `${OUT}/layout-${tag}-safe-area.png` });
    }

    // 横过来的手机：三键导航栏在右边、刘海在左边，能点的东西都要躲开（MainActivity 把它们注入成左右安全区）
    if (vp.name === 'landscape') {
      await page.evaluate(() => {
        const st = document.documentElement.style;
        st.setProperty('--safe-area-inset-top', '24px');
        st.setProperty('--safe-area-inset-left', '32px');
        st.setProperty('--safe-area-inset-right', '48px');
      });
      const blocked = [];
      for (const name of ['search', 'player-cover', 'player-queue', 'player-menu', 'add-sheet']) {
        await L(SEED, { results: RESULTS, more: MORE, commute: COMMUTE, lrc: LRC });
        await L(SCREENS[name]);
        await page.waitForTimeout(150);
        const m = await page.evaluate(measure);
        for (const h of m.hits) if (h.left < 32 - 0.5 || h.right > m.W - 48 + 0.5) blocked.push(`${name}: ${h.el} [${Math.round(h.left)}, ${Math.round(h.right)}]`);
        await page.screenshot({ path: `${OUT}/layout-${tag}-safe-area-${name}.png` });
      }
      check(`${tag}: nothing tappable under the side navigation bar or the notch`, blocked.length === 0, blocked.slice(0, 8));
    }

    check(`${tag}: no page errors`, errors.length === 0, errors);
    check(`${tag}: no network requests left the machine (except images, answered locally)`, external.length === 0, external.slice(0, 5));
    await ctx.close();
  }
}

await browser.close();
process.exit(finish());

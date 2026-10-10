// 播放队列里的 ×（不联网）：只把歌移出播放队列，曲库、歌单、「喜欢的音乐」都不动（#29）。
// 移出正在放的那首：在放就接着放下一首，暂停着就停在下一首、点播放从头放，队列移空了就什么都不放；
// 断网时跳过没缓存的。用电脑尺寸，队列就在右边的播放栏里，直接点每一行的 ×。
// startTrack 换成只记一笔的假函数：真去加载要联网
import { BASE, launchBrowser, logicDriver, createChecker } from './lib.mjs';

const { check, finish } = createChecker();
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const external = [];
await page.route('**/*', route => {
  const u = new URL(route.request().url());
  if (u.origin === new URL(BASE).origin && !/^\/(proxy|stream|sc-client-id)/.test(u.pathname)) return route.continue();
  external.push(u.href);
  return route.abort();
});
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.dc-topbar');
await page.waitForTimeout(800); // 等启动时那次已缓存索引读完，免得它晚到、盖掉下面塞进去的已缓存标记
const L = logicDriver(page);

const T = (id, title) => ({ id, songid: String(8000 + id), title, artist: '测试歌手', album: '', source: 'netease', duration: 200, cover: null });
const TRACKS = [T(1, '第一首'), T(2, '第二首'), T(3, '第三首'), T(4, '第四首'), T(5, '第五首')];
const cachedKey = (id) => `netease:${8000 + id}`;

// 每一段从同一份数据开始：曲库 5 首；播放队列默认是前 4 首、正在放第二首；「通勤」歌单和喜欢里都有第一、二首
const seed = async (opt = {}) => { await seedState(opt); await page.waitForTimeout(150); };
const seedState = (opt) => L(`
  logic.__started = [];
  logic.startTrack = function (t, at) { logic.__started.push([t.id, at || 0]); logic.patch({ currentId: t.id, currentTime: at || 0, playing: true }); };
  logic._cachedKeys = new Set(arg.cached || []);
  logic.patch({
    page: 'search', viewingPlaylistId: null, openMenu: null, rightPanel: 'queue', toast: null,
    queue: arg.tracks, playOrder: arg.order || [1, 2, 3, 4], currentId: arg.current ?? 2, currentTime: 30,
    playing: !!arg.playing, online: arg.online ?? true, offlineOnly: false,
    liked: { 1: true, 2: true }, likedOrder: [2, 1],
    playlists: [
      { id: 'liked', name: '喜欢的音乐', builtin: true, glyph: 'favorite', iconFill: 1, tileBg: '' },
      { id: 'pl_1', name: '通勤', builtin: false, trackIds: [1, 2, 5], glyph: 'queue_music', iconFill: 0, tileBg: '' },
    ],
  });
`, { tracks: TRACKS, ...opt });

// 真点队列里那一行的 ×（顺带确认点 × 不会把这首放起来：整行点下去是播放）
const removeByTitle = async (title) => {
  await page.locator('.sw-qrow', { hasText: title }).locator('button[aria-label="移出队列"]').click();
  await page.waitForTimeout(150);
};

const state = () => L(`
  const s = logic.state, v = logic.renderVals().v;
  const a = document.getElementById('player-audio');
  const saved = JSON.parse(localStorage.getItem('listening-player-library-v1') || 'null');
  const pl = (list) => list.find(p => p.id === 'pl_1').trackIds;
  return {
    order: s.playOrder, cur: s.currentId, playing: s.playing, time: s.currentTime, toast: s.toast,
    started: logic.__started, title: v.hasTrack ? v.track.title : null,
    library: s.queue.map(t => t.id), liked: s.likedOrder.filter(id => s.liked[id]), pl: pl(s.playlists),
    src: a.getAttribute('src'), paused: a.paused,
    saved: saved && { order: saved.playOrder, cur: saved.currentId, library: saved.queue.map(t => t.id), liked: saved.likedOrder, pl: pl(saved.playlists) },
  };
`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// 曲库、歌单、喜欢（内存里和存到本地的都算）一首都没少
const intact = (st) => same(st.library, [1, 2, 3, 4, 5]) && same(st.pl, [1, 2, 5]) && same(st.liked, [2, 1])
  && st.saved && same(st.saved.library, [1, 2, 3, 4, 5]) && same(st.saved.pl, [1, 2, 5]) && same(st.saved.liked, [2, 1]);

// 半秒静音的 WAV（8kHz、8 位、单声道），给 audio 元素装上"正在放的那首"
const WAV = (() => {
  const n = 4000;
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

// × 的文字如实写「移出队列」
await seed();
const labels = await page.$$eval('.sw-qrow .sw-qbtns > button', bs => bs.map(b => [b.getAttribute('aria-label'), b.getAttribute('title')]));
check('every queue row has a × labelled 移出队列', labels.length === 4 && labels.every(([a, t]) => a === '移出队列' && t === '移出队列'), labels);

// 移出不是正在放的歌：只少了队列里那一行
await removeByTitle('第一首');
let st = await state();
check('× on another song only takes it out of the queue',
  same(st.order, [2, 3, 4]) && st.cur === 2 && !st.playing && st.started.length === 0 && same(st.saved.order, [2, 3, 4]), st);
check('…the song stays in the library, the playlist and 喜欢的音乐 (saved too)', intact(st), st);

// 暂停着移出正在放的那首：停在下一首、不出声，audio 清空；点播放从头放下一首
await seed();
const loaded = await loadAudio();
check('test audio loaded into the player', loaded);
await removeByTitle('第二首');
st = await state();
check('× on the paused current song moves to the next one and stays paused',
  same(st.order, [1, 3, 4]) && st.cur === 3 && !st.playing && st.time === 0 && st.title === '第三首' && st.started.length === 0
  && st.src === null && st.paused && st.saved.cur === 3, st);
check('…and the removed song stays in the library, the playlist and 喜欢的音乐', intact(st), st);
await L(`logic.togglePlay();`);
st = await state();
check('play then starts the new current song from the beginning', same(st.started, [[3, 0]]), st.started);

// 在放的时候移出正在放的那首：接着放下一首；在队尾就绕回队首
await seed({ playing: true });
await removeByTitle('第二首');
st = await state();
check('× on the playing song plays the next one', same(st.order, [1, 3, 4]) && same(st.started, [[3, 0]]) && intact(st), st);
await seed({ playing: true, current: 4 });
await removeByTitle('第四首');
st = await state();
check('× on the playing last song wraps to the first', same(st.order, [1, 2, 3]) && same(st.started, [[1, 0]]), st);

// 队列移空了：什么都不放，耳机 / 通知栏的播放键也不会让界面以为在放
await seed({ playing: true, order: [2] });
await removeByTitle('第二首');
st = await state();
check('removing the only song empties the queue and stops',
  st.order.length === 0 && st.cur === null && !st.playing && st.title === null && st.started.length === 0 && st.saved.cur === null && intact(st), st);
await L(`logic.togglePlay();`);
await page.waitForTimeout(300);
st = await state();
check('…and play does nothing afterwards', !st.playing && st.paused && st.started.length === 0, st);

// 断网：跳过没缓存的，接着放后面已缓存的；暂停着就停在那首已缓存的上
await seed({ playing: true, online: false, cached: [cachedKey(2), cachedKey(4)] });
await removeByTitle('第二首');
st = await state();
check('offline: × on the playing song skips to the next cached one', same(st.order, [1, 3, 4]) && same(st.started, [[4, 0]]), st);
await seed({ online: false, cached: [cachedKey(2), cachedKey(4)] });
await removeByTitle('第二首');
st = await state();
check('offline: × on the paused song stops on the next cached one', st.cur === 4 && !st.playing && st.started.length === 0, st);

// 断网、队列里剩下的都没缓存：停下，停在紧挨着的下一首上，给个提示
await seed({ playing: true, online: false, cached: [cachedKey(2)] });
await removeByTitle('第二首');
st = await state();
check('offline with nothing cached left: stops on the next song and says why',
  st.cur === 3 && !st.playing && st.started.length === 0 && st.toast === '播放队列里没有已缓存的歌，联网后才能切', st);

check('no page errors', errors.length === 0, errors);
check('no network requests left the machine', external.length === 0, external.slice(0, 5));

await browser.close();
process.exit(finish());

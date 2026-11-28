// 搜索超时、先回先显、网易云三层兜底与 QQ 主(vkeys)/副(xunhuisi)切换（不开浏览器、不联网）
import { searchAll, searchNetease, fetchNeteasePlaylist, fetchNeteaseDetails, searchQQ, fetchQQDetails } from '../src/api/index.js';
import { createChecker } from './lib.mjs';

const { check, finish } = createChecker();
const originalFetch = globalThis.fetch;
const jsonRes = (body, ok = true, status = 200) => ({
  ok, status,
  headers: { get: k => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const textRes = (body, ok = true, status = 200) => ({
  ok, status,
  headers: { get: k => (k.toLowerCase() === 'content-type' ? 'text/plain' : null) },
  json: async () => JSON.parse(body),
  text: async () => body,
});

try {
  // 1. 单源挂死超时不拖垮另一个好源，且 onPartial 立即交付先回来的结果
  {
    const partials = [];
    const seen = [];
    globalThis.fetch = async (url) => {
      seen.push(String(url));
      if (String(url).includes('api.qijieya.cn')) {
        return jsonRes([{ name: '晴天', artist: '周杰伦', url: 'https://api.qijieya.cn/meting/?type=url&id=186016', pic: 'https://img.example/1.jpg', lrc: null }]);
      }
      // 模拟 QQ 主副接口全部假死（甚至忽略 signal），必须靠超时机制兜底结束
      return new Promise(() => {});
    };
    const t0 = Date.now();
    const tracks = await searchAll({
      keyword: '晴天',
      sources: ['netease', 'qq'],
      limit: 5,
      timeout: 50,
      onPartial: snap => partials.push({ t: Date.now() - t0, count: snap.tracks.length, pending: [...snap.pendingSources], failed: [...snap.failedSources] }),
    });
    const elapsed = Date.now() - t0;
    check('fast source delivers partial results while slow source is still pending',
      partials.length >= 2 && partials[0].count === 1 && partials[0].pending.includes('qq') && partials[0].t < 40, partials);
    check('hanging source times out cleanly and reports failedSources without blocking fast source',
      tracks.length === 1 && tracks[0].source === 'netease' && partials.at(-1).pending.length === 0
      && partials.at(-1).failed.includes('qq') && elapsed < 1000, { elapsed, last: partials.at(-1) });
    check('QQ search tried primary vkeys then fallback xunhuisi before giving up',
      seen.some(u => u.startsWith('https://api.vkeys.cn/v2/music/tencent?word='))
      && seen.some(u => u.startsWith('https://api.xunhuisi.store/API/QQMusic/Song.php?name=')), seen);
  }

  // 2. QQ 主接口 vkeys 正常时不打备用接口，并把 y.qq.com 封面归一化为 https://y.gtimg.cn/
  {
    const seen = [];
    globalThis.fetch = async (url) => {
      seen.push(String(url));
      if (String(url).startsWith('https://api.vkeys.cn/v2/music/tencent?word=')) {
        return jsonRes({
          code: 200,
          data: [{ mid: '0039MnYb0qxYhV', song: '晴天', singer: '周杰伦', album: '叶惠美', cover: 'https://y.qq.com/music/photo_new/T002R800x800M000000MkMni19ClKG.jpg', pay: '付费' }],
        });
      }
      throw new Error('unexpected url: ' + url);
    };
    const list = await searchQQ('晴天', 5, { timeout: 200 });
    check('QQ primary vkeys search skips xunhuisi and normalizes cover host to https://y.gtimg.cn/',
      list.length === 1 && list[0].qqId === '0039MnYb0qxYhV' && list[0].album === '叶惠美'
      && list[0].cover === 'https://y.gtimg.cn/music/photo_new/T002R800x800M000000MkMni19ClKG.jpg'
      && seen.length === 1, { list, seen });
  }

  // 3. QQ 主接口报错时自动切到备用 xunhuisi，且不标记失败
  {
    let errored = false;
    globalThis.fetch = async (url) => {
      if (String(url).startsWith('https://api.vkeys.cn/')) return jsonRes({ code: 503, data: [] });
      if (String(url).startsWith('https://api.xunhuisi.store/')) {
        return jsonRes({
          code: 200,
          data: [{ mid: '004WAfxJ1q8L9h', name: '凤凰于飞', singer: '刘欢', cover: 'http://y.gtimg.cn/music/photo_new/T002R300x300M000003AhhSv2qI3aE.jpg' }],
        });
      }
      throw new Error('unexpected url: ' + url);
    };
    const list = await searchQQ('凤凰于飞', 5, { timeout: 200, onError: () => { errored = true; } });
    check('QQ search falls back to xunhuisi when vkeys fails without flagging source error',
      list.length === 1 && list[0].qqId === '004WAfxJ1q8L9h' && list[0].cover.startsWith('https://y.gtimg.cn/') && !errored, { list, errored });
  }

  // 4. QQ 播放详情：vkeys 跳过 28kbps 试听并走 song/link 拿无损；遇到 vkeys 110000 时回退 xunhuisi 并解析 [al:...]
  {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/v2/music/tencent?mid=vip1')) {
        return jsonRes({ code: 200, data: { mid: 'vip1', song: '晴天', singer: '周杰伦', album: '叶惠美', cover: 'https://y.qq.com/music/photo_new/a.jpg', link: 'https://y.qq.com/s/vip1', quality: '音乐试听', kbps: '28kbps', url: 'http://ws.stream.qqmusic.qq.com/RS02vip1.mp3' } });
      }
      if (u.includes('/music/tencent/song/link?mid=vip1&quality=10')) {
        return jsonRes({ code: 0, data: { songMID: 'vip1', kbps: '1644kbps', url: 'http://ws.stream.qqmusic.qq.com/F000vip1.flac' } });
      }
      if (u.includes('/v2/music/tencent/lyric?mid=vip1')) {
        return jsonRes({ code: 200, data: { lrc: '[00:00.00]晴天' } });
      }
      if (u.includes('api.vkeys.cn') && u.includes('mid=old1')) {
        return jsonRes({ code: 110000, data: null });
      }
      if (u.includes('api.xunhuisi.store') && u.includes('mid=old1')) {
        return jsonRes({ code: 200, title: '凤凰于飞', singer: '刘欢', cover: 'https://y.gtimg.cn/music/photo_new/b.jpg', link: 'https://y.qq.com/n/ryqq/songDetail/old1', music_url: 'http://isure6.stream.qqmusic.qq.com/C600old1.m4a', quality: 'M4A高品质(320kbps AAC)', lyric: '[ti:凤凰于飞]\n[al:甄嬛传]\n[00:00.00]旧梦依稀' });
      }
      throw new Error('unexpected url: ' + url);
    };
    const vip = { source: 'qq', qqId: 'vip1', songid: 'vip1', title: '晴天', artist: '周杰伦', cover: null, album: '', audioUrl: null, lrc: null, detailsLoaded: false };
    await fetchQQDetails(vip);
    check('QQ VIP detail rejects 28kbps trial and upgrades vkeys song/link lossless audio to https',
      vip.detailsLoaded && vip.audioUrl === 'https://ws.stream.qqmusic.qq.com/F000vip1.flac'
      && vip.quality === 'lossless' && vip.lrc === '[00:00.00]晴天' && vip.cover.startsWith('https://y.gtimg.cn/'), vip);

    const old = { source: 'qq', qqId: 'old1', songid: 'old1', title: '凤凰于飞', artist: '刘欢', cover: null, album: '', audioUrl: null, lrc: null, detailsLoaded: false };
    await fetchQQDetails(old);
    check('QQ detail falls back to xunhuisi on vkeys code=110000 and extracts album from [al:...]',
      old.detailsLoaded && old.audioUrl === 'https://isure6.stream.qqmusic.qq.com/C600old1.m4a'
      && old.quality === 'hq' && old.album === '甄嬛传' && old.cover === 'https://y.gtimg.cn/music/photo_new/b.jpg', old);
  }

  // 5. 网易云三层搜索兜底：qijieya 返空 -> vkeys；qijieya 超时 + vkeys 失败 -> /proxy cloudsearch；全失败报 onError
  {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.startsWith('https://api.qijieya.cn/')) return jsonRes([]);
      if (u.startsWith('https://api.vkeys.cn/v2/music/netease?word=')) {
        return jsonRes({ code: 200, data: [{ id: 5257138, song: '屋顶', singer: '周杰伦/温岚', album: '男女情歌对唱', cover: 'http://p4.music.126.net/a.jpg' }] });
      }
      throw new Error('unexpected url: ' + url);
    };
    const list1 = await searchNetease('屋顶', 1, 5, { timeout: 200 });
    check('Netease search falls back to vkeys when qijieya returns []',
      list1.length === 1 && list1[0].songid === '5257138' && list1[0].album === '男女情歌对唱'
      && list1[0].cover === 'https://p4.music.126.net/a.jpg', list1);

    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.startsWith('https://api.qijieya.cn/')) return new Promise(() => {});
      if (u.startsWith('https://api.vkeys.cn/')) return jsonRes({ code: 500, data: [] });
      if (u.includes('/proxy?url=') && decodeURIComponent(u).includes('cloudsearch/pc')) {
        return jsonRes({ result: { songs: [{ id: 186016, name: '晴天', ar: [{ name: '周杰伦' }], al: { name: '叶惠美', picUrl: 'http://p1.music.126.net/b.jpg' } }] } });
      }
      throw new Error('unexpected url: ' + url);
    };
    const list2 = await searchNetease('晴天', 1, 5, { timeout: 40 });
    check('Netease search falls back to /proxy cloudsearch when qijieya times out and vkeys fails',
      list2.length === 1 && list2[0].songid === '186016' && list2[0].album === '叶惠美'
      && list2[0].cover === 'https://p1.music.126.net/b.jpg', list2);

    let failed = false;
    globalThis.fetch = async () => { throw new Error('network down'); };
    const list3 = await searchNetease('晴天', 1, 5, { timeout: 40, onError: () => { failed = true; } });
    check('Netease search reports onError only when all three tiers fail', list3.length === 0 && failed, { list3, failed });
  }

  // 6. 网易云歌单兜底（qijieya -> injahow）与播放重试兜底（qijieya -> yutangxiaowu -> injahow）+ 歌词兜底（qijieya -> vkeys）
  {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.startsWith('https://api.qijieya.cn/')) return jsonRes([], false, 502);
      if (u.startsWith('https://api.injahow.cn/meting/?type=playlist')) {
        return jsonRes([{ name: '我不难过', artist: '孙燕姿', url: 'https://api.injahow.cn/meting/?server=netease&type=url&id=287398', pic: 'https://api.injahow.cn/pic.jpg', lrc: null }]);
      }
      if (u.includes('api.vkeys.cn/v2/music/netease/lyric')) {
        return jsonRes({ code: 200, data: { lrc: '[00:00.00]我不难过' } });
      }
      if (u.startsWith('https://api.yutangxiaowu.cn/')) {
        return jsonRes({ status: 200, url: 'http://m701.music.126.net/287398.mp3', al_name: '未完成', lyric: '[00:00.00]我不难过' });
      }
      if (u.includes('/proxy?url=')) return jsonRes({}, false, 502);
      throw new Error('unexpected url: ' + url);
    };
    const pl = await fetchNeteasePlaylist('3778678', { timeout: 200 });
    check('Netease playlist falls back from qijieya to injahow', pl.length === 1 && pl[0].songid === '287398', pl);

    const tr = { source: 'netease', songid: '287398', title: '我不难过', artist: '孙燕姿', album: '', audioUrl: null, lrc: null, lrcUrl: null, detailsLoaded: false };
    await fetchNeteaseDetails(tr);
    check('Netease first play keeps qijieya URL and falls back lyrics to vkeys',
      tr.audioUrl.startsWith('https://api.qijieya.cn/meting/?server=netease&type=url&id=287398')
      && tr.lrc === '[00:00.00]我不难过', tr);

    tr.audioUrl = null;
    tr.detailsLoaded = false;
    await fetchNeteaseDetails(tr);
    check('Netease playback retry switches to yutangxiaowu direct https URL and fills album',
      tr.audioUrl === 'https://m701.music.126.net/287398.mp3' && tr.album === '未完成', tr);

    tr.audioUrl = null;
    tr.detailsLoaded = false;
    await fetchNeteaseDetails(tr);
    check('Netease subsequent retry cycles to injahow URL',
      tr.audioUrl.startsWith('https://api.injahow.cn/meting/?server=netease&type=url&id=287398'), tr);
  }

  // 7. 外部取消 AbortController 立即中止，不触发备用源也不误报失败
  {
    const seen = [];
    const ac = new AbortController();
    globalThis.fetch = async (url, { signal }) => {
      seen.push(String(url));
      return new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    };
    let errored = false;
    const p = searchQQ('周杰伦', 5, { signal: ac.signal, timeout: 5000, onError: () => { errored = true; } });
    ac.abort();
    const res = await p;
    check('caller abort cancels immediately without hitting fallback or firing onError',
      res.length === 0 && !errored && seen.length === 1, { res, errored, seen });
  }
} finally {
  globalThis.fetch = originalFetch;
}

process.exit(finish());

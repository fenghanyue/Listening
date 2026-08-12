/**
 * SoundCloud 搜索 & 详情 (api-v2)
 *
 * SoundCloud 已停止发放新 API key，client_id 需从 SoundCloud 网页 JavaScript 中提取。
 * ⚠️ SoundCloud API 在中国大陆无法直连，需要代理/VPN。
 * ⚠️ api-v2.soundcloud.com 不返回 CORS 响应头，浏览器端必须经代理（server.mjs 提供的
 *    /proxy /stream /sc-client-id）转发，否则搜索/详情请求会被浏览器直接拦截。代理走
 *    相对路径（同源）——本机开发和线上部署页面与代理都在同一个进程/同一个域名下，不需要
 *    区分环境。代理不可用时退回直连（仅适用于 Node 等无 CORS 限制的环境，浏览器端会失败）。
 */

const SC_PROXY = '';
let scProxyAvailable = null;
let scProxyCheckedAt = 0;
// 失败结果只短暂缓存：Render 冷启动等瞬时问题不该让整个会话永久判定代理不可用
const SC_PROXY_NEGATIVE_TTL = 30000;

// 探测代理是否在跑。
// 浏览器里其实不需要探测：SC_PROXY 是空串（同源），这个页面本身就是代理进程发出来的，
// 探测等于问"我自己在不在"。而这次探测只给 6 秒，Render 免费实例冷启动经常超过 6 秒——
// 一超时整个会话就被判成"代理不可用"，接下来所有 SoundCloud 请求改直连 api-v2 并被 CORS
// 全部拦掉，表现就是搜索静默返回 0 首。真正没有代理的只有 file:// 直接打开单页这种情况，
// 以及 Node 里独立引用 src/api（那边 fetch('/sc-client-id') 会立刻抛错，很快得到 false）
async function checkScProxy() {
  if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) return true;
  if (scProxyAvailable === true) return true;
  if (scProxyAvailable === false && Date.now() - scProxyCheckedAt < SC_PROXY_NEGATIVE_TTL) return false;
  try {
    const r = await fetch(`${SC_PROXY}/sc-client-id`, { signal: AbortSignal.timeout(6000) });
    scProxyAvailable = r.ok;
  } catch (e) {
    scProxyAvailable = false;
  }
  scProxyCheckedAt = Date.now();
  return scProxyAvailable;
}

// 走本地代理（可用时）获取 JSON，否则直连；直连在浏览器端会因 CORS 失败。
// 失败时把 HTTP 状态码挂到 error 上——上层要靠它区分"client_id 被拒了"(401/403) 和别的错误。
// 这是可行的：server.mjs 的 /proxy 用 writeHead(result.status) 把上游状态码原样透传，
// 而它自己的传输失败用的是 502，两者不会混淆
async function scFetchJson(url, timeout = 10000) {
  const viaProxy = await checkScProxy();
  const target = viaProxy ? `${SC_PROXY}/proxy?url=${encodeURIComponent(url)}` : url;
  const r = await fetch(target, { signal: AbortSignal.timeout(timeout) });
  if (!r.ok) {
    const err = new Error(`${viaProxy ? 'proxy' : 'direct'} ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

// ====================== client_id ======================

// 备用硬编码 key（可能随时失效，只是不让流程彻底卡死）
const SC_FALLBACK_IDS = [
  'O7atZypwLvuWSY9hWnnQ3vrLTHH7wqMe', // 2025-07 从 soundcloud.com 提取
];
// 必须锚定 client_id 这个词。旧实现用的是 /"([A-Za-z0-9]{32})"/，抓到的是页面里第一个
// 32 位字母数字串（构建哈希/nonce），根本不是 client_id——所谓"自动抓取"其实一次都没成功过
const SC_ID_RE = /client_id\s*[:=]\s*["']([A-Za-z0-9]{32})["']/;
const SC_CID_TTL = 30 * 60 * 1000;  // 正常 key 的缓存时长
const SC_CID_NEG_TTL = 60 * 1000;   // 只拿到兜底值时的缓存时长，别每次调用都重跑整条抓取链

let scClientId = null;
let scClientIdAt = 0;
let scClientIdIsFallback = false;

// 用一次真实搜索来验证 key 还能不能用。旧实现拿 /tracks/1 且只认 200——那条 track 存不存在
// 没人保证，一个完全有效的 key 在那里拿到 404 同样会被判死，于是永远落到硬编码兜底值
async function validateSCClientId(id) {
  try {
    const r = await fetch(
      `https://api-v2.soundcloud.com/search/tracks?q=a&client_id=${id}&limit=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    return r.ok;
  } catch (e) {
    return false;
  }
}

// 从 SoundCloud 网页抓 client_id。浏览器里直连大概率被 CORS 拦掉，这条路实际只在
// Node 独立使用 src/api（代理不可用）时才真正跑得通
async function scrapeClientIdFromPage() {
  try {
    const html = await (await fetch('https://soundcloud.com', {
      signal: AbortSignal.timeout(10000)
    })).text();
    const inline = html.match(SC_ID_RE);
    if (inline) return inline[1];
    // client_id 实际藏在首页引用的资源包里，编号最大的那个最可能有，所以取最后几个倒着试。
    // 只试 4 个：这些 chunk 动辄几百 KB，全拉下来既慢又费内存
    const scripts = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)]
      .map(m => m[1]);
    for (const src of scripts.slice(-4).reverse()) {
      try {
        const js = await (await fetch(src, { signal: AbortSignal.timeout(10000) })).text();
        const m = js.match(SC_ID_RE);
        if (m) return m[1];
      } catch (e) { /* 这个包拿不到就换下一个 */ }
    }
  } catch (e) { /* skip */ }
  return null;
}

/**
 * 取一个可用的 client_id。
 * @param {object} [opts]
 * @param {boolean} [opts.refresh] - 手上这个 id 被源站拒了，要求换一个新的
 * @param {string}  [opts.stale]   - 被拒的那个 id，交给服务端判断是否真的该换（见 server.mjs 的 /sc-client-id）
 */
async function getSCClientId({ refresh = false, stale = null } = {}) {
  const ttl = scClientIdIsFallback ? SC_CID_NEG_TTL : SC_CID_TTL;
  if (!refresh && scClientId && Date.now() - scClientIdAt < ttl) return scClientId;
  if (refresh) scClientId = null;

  const remember = (id, isFallback) => {
    scClientId = id;
    scClientIdAt = Date.now();
    scClientIdIsFallback = isFallback;
    return id;
  };

  // 1. 优先走本地代理的 /sc-client-id（服务端抓取+校验，不受浏览器 CORS 限制，最可靠）
  if (await checkScProxy()) {
    try {
      const q = refresh ? `?refresh=1${stale ? `&stale=${encodeURIComponent(stale)}` : ''}` : '';
      // refresh 那条路服务端是设计成阻塞等新值的，5 秒不够
      const r = await fetch(`${SC_PROXY}/sc-client-id${q}`, {
        signal: AbortSignal.timeout(refresh ? 15000 : 8000),
      });
      const j = await r.json();
      // 服务端自己也只抓到兜底值时（source=fallback）按短 TTL 记，好让下次调用再问一次
      if (j.client_id) return remember(j.client_id, j.source === 'fallback');
    } catch (e) { /* 代理没答上来就往下走 */ }
  }

  // 2. 代理不可用（Node 里独立用 src/api）时自己抓
  const scraped = await scrapeClientIdFromPage();
  if (scraped && await validateSCClientId(scraped)) return remember(scraped, false);

  // 3. 尝试备用硬编码 key
  for (const id of SC_FALLBACK_IDS) {
    if (await validateSCClientId(id)) return remember(id, false);
  }

  // 4. 都失败就用第一个备用的（至少不会卡住），按短 TTL 记，等下次调用重新尝试
  return remember(SC_FALLBACK_IDS[0], true);
}

/**
 * 带 client_id 自愈的请求。源站用 401/403 明确表示"这个 key 不能用了"，这时换一个新 key
 * 重试一次才有意义——旧实现的 client_id 是永久缓存的，拿着同一个死 key 一直撞，
 * 整个 SoundCloud 会一直挂到进程重启为止。
 * 参数是 URL 的构造函数而不是 URL 本身：重试必须把新 key 重新拼进去。
 * @param {(cid: string) => string} buildUrl
 * @param {number} [timeout]
 */
async function scFetchWithAuthRetry(buildUrl, timeout) {
  const cid = await getSCClientId();
  try {
    return await scFetchJson(buildUrl(cid), timeout);
  } catch (e) {
    if (e.status !== 401 && e.status !== 403) throw e;
    const fresh = await getSCClientId({ refresh: true, stale: cid });
    if (!fresh || fresh === cid) throw e; // 服务端也换不出新的，别空转
    return scFetchJson(buildUrl(fresh), timeout);
  }
}

/**
 * 搜索 SoundCloud 曲目
 * @param {string} kw - 关键词
 * @param {number} limit - 结果数量
 * @returns {Promise<Array>} track 数组
 */
export async function searchSoundCloud(kw, limit) {
  const results = [];
  try {
    // 这里继续吞掉异常返回空数组是有意的：searchAll 会并行跑三个源，
    // SoundCloud 挂掉不该把网易云/QQ 的结果一起带走
    const json = await scFetchWithAuthRetry(cid =>
      `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(kw)}&client_id=${cid}&limit=${limit}&linked_partitioning=1`);
    const tracks = json.collection || [];
    tracks.forEach((it, idx) => {
      const username = it.user?.username || 'Unknown';
      results.push({
        uid: `sc-${it.id}`,
        source: 'soundcloud',
        di: idx + 1,
        kw,
        songid: it.id,
        title: it.title || '',
        artist: username,
        album: '',
        cover: it.artwork_url || it.user?.avatar_url || null,
        audioUrl: null,
        lrc: null,
        lrcUrl: null,
        detailsLoaded: false,
        quality: null,
        qualityLabel: null,
        scStreamUrl: it.stream_url || null,
        scTranscodings: it.media?.transcodings || null,
        scTrackAuth: it.track_authorization || null,
        scDuration: it.duration || 0,
        scGenre: it.genre || '',
        scPermalink: it.permalink_url || '',
        scPlayCount: it.playback_count || 0,
      });
    });
  } catch (e) {
    console.error('soundcloud search:', e);
  }
  return results;
}

// 当前环境到底能不能放 HLS。hls.js 是从 cdn.jsdelivr.net 加载的，国内经常不通；
// 拿不到它、浏览器又不原生支持 m3u8（桌面 Chrome/Firefox 都不支持）时还把 HLS 排在第一，
// 等于必然先播失败一次再靠兜底救回来。不如一开始就别选它
function canPlayHls() {
  if (typeof window === 'undefined') return true; // Node 端不做判断，交给调用方
  if (window.Hls && window.Hls.isSupported && window.Hls.isSupported()) return true;
  try {
    return !!document.createElement('audio').canPlayType('application/vnd.apple.mpegurl');
  } catch (e) {
    return false;
  }
}

/**
 * 获取 SoundCloud 曲目播放详情
 * @param {object} t - track 对象
 * @returns {Promise<object>} 更新后的 track
 */
export async function fetchSoundCloudDetails(t) {
  const useProxy = await checkScProxy();

  // 1. 优先用搜索时已返回的 transcodings（避免多一次请求）
  let transcodings = t.scTranscodings || null;

  // 2. 否则重新请求 track 详情
  if (!transcodings) {
    const d = await scFetchWithAuthRetry(
      cid => `https://api-v2.soundcloud.com/tracks/${t.songid}?client_id=${cid}`
    );
    transcodings = d.media?.transcodings || [];
    t.cover = d.artwork_url || d.user?.avatar_url || t.cover;
    t.title = d.title || t.title;
    t.artist = d.user?.username || t.artist;
  }

  // 3. 从 transcodings 选最佳可播放链接
  // SoundCloud 有三套 CDN：
  //   - cf-media.sndcdn.com (CloudFront progressive mp3)    → 部分区域 403
  //   - cf-hls-media.sndcdn.com (CloudFront HLS mp3)        → 部分区域 403
  //   - playback.media-streaming.soundcloud.cloud (AAC HLS) → 可访问 ✅
  // 优先选 AAC HLS（soundcloud.cloud CDN 可访问），其次选 mp3 progressive
  if (transcodings && transcodings.length > 0) {
    const hlsOk = canPlayHls();
    const scored = transcodings.map(tr => {
      let score = 0;
      const proto = tr.format?.protocol || '';
      const mime = tr.format?.mime_type || '';
      // 最高优先级：AAC HLS（soundcloud.cloud CDN 可访问）——前提是这个环境放得了 HLS
      if (hlsOk && proto === 'hls' && mime.includes('mp4')) score += 100;
      // 其次：progressive mp3（CloudFront CDN 可能被墙，走代理 /stream 转发）
      if (proto === 'progressive' && mime.includes('mpeg')) score += 60;
      // 再次：其他 HLS
      if (hlsOk && proto === 'hls' && !mime.includes('mp4')) score += 40;
      // 加分项
      if (tr.preset?.includes('160')) score += 10;
      if (tr.preset?.includes('sq')) score += 5;
      return { ...tr, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const isHLS = best.format?.protocol === 'hls';

    // 播放走 HLS 时，另找一条 progressive mp3 转码，把它的 resolve 端点先存下来
    // （不在这里内联解析，免得给起播多加一次请求）。它有两个用途：后台解析出整段 mp3 存进
    // 本地缓存，以及 HLS 播不动时当兜底音源。存**不带 client_id 的裸地址**——转码端点是稳定的，
    // client_id 不是，把它烤进去意味着兜底会在最需要有效 key 的时刻用上一个过期的 key
    const bestProgressive = scored.find(
      tr => tr.format?.protocol === 'progressive' && tr.format?.mime_type?.includes('mpeg')
    );
    t.scProgressiveResolveBase = bestProgressive ? bestProgressive.url : null;
    t.scProgressiveResolveUrl = null; // 旧字段（带 client_id）不再写，留着只为兼容旧的本地存档

    const resolved = await scFetchWithAuthRetry(cid => `${best.url}?client_id=${cid}`);
    if (resolved.url) {
      if (isHLS) {
        // HLS 播放：交给前端 hls.js 直接从 CDN 拉流（manifest+分片走代理成本太高）。
        // 本地缓存另走一条路：前端后台用 scProgressiveResolveBase 解析出整段 mp3 存起来。
        t.audioUrl = resolved.url;
        t.scIsHLS = true;
      } else {
        // progressive mp3：走本地代理 /stream 流式转发，绕开 CDN 对部分地区的 403
        t.audioUrl = useProxy
          ? `${SC_PROXY}/stream?url=${encodeURIComponent(resolved.url)}`
          : resolved.url;
        t.scIsHLS = false;
      }
    }

    if (t.audioUrl && best.preset) {
      const m = best.preset.match(/(\d+)/);
      t.quality = m ? m[1] + 'k' : '128k';
      t.qualityLabel = best.preset.replace(/_/g, ' ').toUpperCase();
    }
  }

  // 4. fallback: 旧格式 stream_url
  if (!t.audioUrl && t.scStreamUrl) {
    t.audioUrl = `${t.scStreamUrl}?client_id=${await getSCClientId()}`;
  }

  if (t.audioUrl && !t.quality) {
    t.quality = '128k';
    t.qualityLabel = '128K';
  }

  // 一条能播的链接都没解析出来时必须抛出去。以前这里连同上面所有异常一起被 catch 吞掉、
  // promise 照常 resolve，于是播放器那边的 .catch 永远不触发，整条重试阶梯根本进不去，
  // 只弹一句"暂无可用播放链接"就结束，只能干等 12 秒看门狗跳歌
  if (!t.audioUrl) throw new Error(`soundcloud: no playable url for ${t.songid}`);
  t.detailsLoaded = true;
  return t;
}

/**
 * 解析出一首 SoundCloud 曲目的 progressive mp3 直链。
 * 两个用途：① 播放走 HLS 时后台把整段 mp3 下载进本地缓存；② HLS 播不动时当兜底音源
 * （progressive 走同源 /stream 转发，CDN 被区域封锁时它往往还通）。
 * 代理可用时走同源 /stream（服务端抓取，绕开部分地区 CDN 的 403），否则退回 CDN 直连。
 * 没有 progressive 转码、或解析失败时返回 null，调用方据此静默跳过。
 * @param {object} t - track 对象（需带 fetchSoundCloudDetails 设好的 scProgressiveResolveBase）
 * @param {number} [timeout] - 解析请求超时；当兜底音源用时要压得比前端看门狗短
 * @returns {Promise<string|null>}
 */
export async function resolveSoundCloudCacheUrl(t, timeout) {
  if (!t) return null;
  // scProgressiveResolveUrl 是旧字段（地址里已经烤进了 client_id），只为兼容早先存下的曲目对象
  const base = t.scProgressiveResolveBase || t.scProgressiveResolveUrl;
  if (!base) return null;
  try {
    const resolved = base.includes('client_id=')
      ? await scFetchJson(base, timeout)
      : await scFetchWithAuthRetry(cid => `${base}?client_id=${cid}`, timeout);
    if (!resolved || !resolved.url) return null;
    const useProxy = await checkScProxy();
    return useProxy
      ? `${SC_PROXY}/stream?url=${encodeURIComponent(resolved.url)}`
      : resolved.url;
  } catch (e) {
    console.warn('soundcloud cache url resolve:', e);
    return null;
  }
}

/**
 * SoundCloud 搜索 & 详情 (api-v2)
 *
 * SoundCloud 已停止发放新 API key，client_id 需从 SoundCloud 网页 JavaScript 中提取。
 * ⚠️ SoundCloud API 在中国大陆无法直连，需要代理/VPN。
 */

// 从 SoundCloud 网页抓取最新的 client_id
let scClientId = null;

async function scrapeClientIdFromPage() {
  try {
    const html = await (await fetch('https://soundcloud.com', {
      signal: AbortSignal.timeout(10000)
    })).text();
    // SoundCloud 网页 JS 中嵌入了 client_id，格式类似: "client_id":"xxxxx"
    const m = html.match(/"([A-Za-z0-9]{32})"/);
    if (m) return m[1];
  } catch (e) { /* skip */ }
  return null;
}

// 备用硬编码 key（从网页抓取的最新值，可能随时失效）
const SC_FALLBACK_IDS = [
  'O7atZypwLvuWSY9hWnnQ3vrLTHH7wqMe', // 2025-07 从 soundcloud.com 提取
];

// SoundCloud api-v2 不带 CORS 头，浏览器直连会被拦截；本地代理可绕过。
// 探测一次结果就缓存，代理不可用时优雅降级为直连（Node/无 CORS 限制环境下仍可用）。
const SC_PROXY = 'http://localhost:8765';
let scProxyAvailable = null;

async function checkScProxy() {
  if (scProxyAvailable !== null) return scProxyAvailable;
  try {
    const r = await fetch(`${SC_PROXY}/sc-client-id`, { signal: AbortSignal.timeout(3000) });
    scProxyAvailable = r.ok;
  } catch (e) {
    scProxyAvailable = false;
  }
  return scProxyAvailable;
}

async function scFetchJson(url, timeoutMs = 10000) {
  if (await checkScProxy()) {
    const r = await fetch(`${SC_PROXY}/proxy?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error(`proxy ${r.status}`);
    return r.json();
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`direct ${r.status}`);
  return r.json();
}

async function getSCClientId() {
  if (scClientId) return scClientId;

  // 1. 优先从 SoundCloud 网页动态抓取
  const scraped = await scrapeClientIdFromPage();
  if (scraped) {
    // 验证是否能用于 API
    try {
      await scFetchJson(`https://api-v2.soundcloud.com/tracks/1?client_id=${scraped}`, 5000);
      scClientId = scraped;
      return scClientId;
    } catch (e) { /* skip */ }
  }

  // 2. 尝试备用硬编码 key
  for (const id of SC_FALLBACK_IDS) {
    try {
      await scFetchJson(`https://api-v2.soundcloud.com/tracks/1?client_id=${id}`, 5000);
      scClientId = id;
      return scClientId;
    } catch (e) { /* skip */ }
  }

  // 3. 都失败就用第一个备用的（至少不会卡住）
  scClientId = SC_FALLBACK_IDS[0];
  return scClientId;
}

/**
 * 搜索 SoundCloud 曲目
 * @param {string} kw - 关键词
 * @param {number} limit - 结果数量
 * @returns {Promise<Array>} track 数组
 */
export async function searchSoundCloud(kw, limit) {
  const cid = await getSCClientId();
  const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(kw)}&client_id=${cid}&limit=${limit}&linked_partitioning=1`;
  const results = [];
  try {
    const json = await scFetchJson(url);
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

/**
 * 获取 SoundCloud 曲目播放详情
 * @param {object} t - track 对象
 * @returns {Promise<object>} 更新后的 track
 */
export async function fetchSoundCloudDetails(t) {
  try {
    const cid = await getSCClientId();
    let d = null;

    // 1. 优先用搜索时已返回的 transcodings（避免多一次请求）
    let transcodings = t.scTranscodings || null;

    // 2. 否则重新请求 track 详情
    if (!transcodings) {
      d = await scFetchJson(`https://api-v2.soundcloud.com/tracks/${t.songid}?client_id=${cid}`);
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
    // 优先选 AAC HLS（soundcloud.cloud CDN），其次选 mp3 progressive，
    // 因为 media resolve 只需要 ?client_id= 不需要 JWT
    if (transcodings && transcodings.length > 0) {
      const scored = transcodings.map(tr => {
        let score = 0;
        const proto = tr.format?.protocol || '';
        const mime = tr.format?.mime_type || '';
        // 最高优先级：AAC HLS（soundcloud.cloud CDN 可访问）
        if (proto === 'hls' && mime.includes('mp4')) score += 100;
        // 其次：progressive mp3（CloudFront CDN 可能被墙）
        if (proto === 'progressive' && mime.includes('mpeg')) score += 60;
        // 再次：其他 HLS
        if (proto === 'hls' && !mime.includes('mp4')) score += 40;
        // 加分项
        if (tr.preset?.includes('160')) score += 10;
        if (tr.preset?.includes('sq')) score += 5;
        return { ...tr, score };
      });
      scored.sort((a, b) => b.score - a.score);
      const best = scored[0];
      const isHLS = (best.format?.protocol === 'hls');
      // best.url 是 transcoding 的 "resolve" 端点，请求它返回的是 JSON
      // {"url": "<真实签名 CDN 地址>"}，不是可直接播放的媒体地址，需要再请求一次。
      const mediaUrl = `${best.url}?client_id=${cid}`;
      try {
        const resolved = await scFetchJson(mediaUrl);
        if (resolved && resolved.url) {
          if (isHLS) {
            // AAC HLS CDN（playback.media-streaming.soundcloud.cloud）自带 CORS，直连即可
            t.audioUrl = resolved.url;
          } else {
            // progressive mp3 的 CDN（CloudFront）部分区域无 CORS/被墙，代理可用时走二进制转发
            t.audioUrl = (await checkScProxy())
              ? `${SC_PROXY}/stream?url=${encodeURIComponent(resolved.url)}`
              : resolved.url;
          }
        } else {
          t.audioUrl = mediaUrl;
        }
      } catch (e) {
        t.audioUrl = mediaUrl;
      }
      // 标记是否为 HLS（浏览器需要 hls.js 播放）
      t.scIsHLS = isHLS;
      if (best.preset) {
        const m = best.preset.match(/(\d+)/);
        t.quality = m ? m[1] + 'k' : '128k';
        t.qualityLabel = best.preset.replace(/_/g, ' ').toUpperCase();
      }
    }

    // 4. fallback: 旧格式 stream_url
    if (!t.audioUrl && t.scStreamUrl) {
      t.audioUrl = `${t.scStreamUrl}?client_id=${cid}`;
    }

    if (t.audioUrl) {
      if (!t.quality) { t.quality = '128k'; t.qualityLabel = '128K'; }
    }
    t.detailsLoaded = true;
  } catch (e) {
    console.error('soundcloud detail:', e);
  }
  return t;
}

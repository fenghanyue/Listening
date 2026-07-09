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

// 探测本地代理是否在跑（结果缓存，避免每次请求都探测一遍）
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

// 走本地代理（可用时）获取 JSON，否则直连；直连在浏览器端会因 CORS 失败
async function scFetchJson(url, timeout = 10000) {
  if (await checkScProxy()) {
    const r = await fetch(`${SC_PROXY}/proxy?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(timeout) });
    if (!r.ok) throw new Error(`proxy ${r.status}`);
    return r.json();
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`direct ${r.status}`);
  return r.json();
}

// 从 SoundCloud 网页抓取最新的 client_id（浏览器端直连大概率被 CORS 拦截，仅作代理不可用时的兜底）
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

async function getSCClientId() {
  if (scClientId) return scClientId;

  // 1. 优先走本地代理的 /sc-client-id（服务端抓取+验证，不受浏览器 CORS 限制，最可靠）
  if (await checkScProxy()) {
    try {
      const r = await fetch(`${SC_PROXY}/sc-client-id`, { signal: AbortSignal.timeout(5000) });
      const j = await r.json();
      if (j.client_id) {
        scClientId = j.client_id;
        return scClientId;
      }
    } catch (e) { /* skip */ }
  }

  // 2. 代理不可用时，尝试浏览器端直接抓取
  const scraped = await scrapeClientIdFromPage();
  if (scraped) {
    try {
      const r = await fetch(
        `https://api-v2.soundcloud.com/tracks/1?client_id=${scraped}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (r.ok) {
        scClientId = scraped;
        return scClientId;
      }
    } catch (e) { /* skip */ }
  }

  // 3. 尝试备用硬编码 key
  for (const id of SC_FALLBACK_IDS) {
    try {
      const r = await fetch(
        `https://api-v2.soundcloud.com/tracks/1?client_id=${id}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (r.ok) {
        scClientId = id;
        return scClientId;
      }
    } catch (e) { /* skip */ }
  }

  // 4. 都失败就用第一个备用的（至少不会卡住）
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
    const useProxy = await checkScProxy();

    // 1. 优先用搜索时已返回的 transcodings（避免多一次请求）
    let transcodings = t.scTranscodings || null;

    // 2. 否则重新请求 track 详情
    if (!transcodings) {
      const d = await scFetchJson(`https://api-v2.soundcloud.com/tracks/${t.songid}?client_id=${cid}`);
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
    // 优先选 AAC HLS（soundcloud.cloud CDN），其次选 mp3 progressive
    if (transcodings && transcodings.length > 0) {
      const scored = transcodings.map(tr => {
        let score = 0;
        const proto = tr.format?.protocol || '';
        const mime = tr.format?.mime_type || '';
        // 最高优先级：AAC HLS（soundcloud.cloud CDN 可访问）
        if (proto === 'hls' && mime.includes('mp4')) score += 100;
        // 其次：progressive mp3（CloudFront CDN 可能被墙，走代理 /stream 转发）
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
      const isHLS = best.format?.protocol === 'hls';
      // media resolve 只需要 ?client_id= 不需要 JWT
      const mediaUrl = `${best.url}?client_id=${cid}`;

      try {
        const resolved = await scFetchJson(mediaUrl);
        if (resolved.url) {
          if (isHLS) {
            // HLS 播放：交给前端 hls.js 直接从 CDN 拉流（manifest+分片走代理成本太高）
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
      } catch (e) {
        console.error('soundcloud media resolve:', e);
        t.audioUrl = mediaUrl;
        t.scIsHLS = isHLS;
      }

      if (t.audioUrl && best.preset) {
        const m = best.preset.match(/(\d+)/);
        t.quality = m ? m[1] + 'k' : '128k';
        t.qualityLabel = best.preset.replace(/_/g, ' ').toUpperCase();
      }
    }

    // 4. fallback: 旧格式 stream_url
    if (!t.audioUrl && t.scStreamUrl) {
      t.audioUrl = `${t.scStreamUrl}?client_id=${cid}`;
    }

    if (t.audioUrl && !t.quality) {
      t.quality = '128k';
      t.qualityLabel = '128K';
    }
    t.detailsLoaded = true;
  } catch (e) {
    console.error('soundcloud detail:', e);
  }
  return t;
}

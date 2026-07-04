/**
 * 网易云音乐搜索 & 详情
 * API 来源: qijieya meting (第三方代理)
 */

const BASE_URL = 'https://api.qijieya.cn/meting/';

/**
 * 从 URL 里提取 query param 的值（不依赖 window.location）
 */
function pickQueryParam(rawUrl, key) {
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl, 'http://placeholder.local').searchParams.get(key) || '';
  } catch (e) {
    const m = String(rawUrl).match(new RegExp('[?&]' + key + '=([^&]+)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
}

/**
 * 搜索网易云
 * @param {string} kw - 关键词
 * @param {number} [page=1]
 * @param {number} [num=10]
 * @returns {Promise<Array>} track 对象数组
 */
export async function searchNetease(kw, page = 1, num = 10) {
  const requestLimit = Math.max(1, page) * Math.max(1, num);
  const url = `${BASE_URL}?type=search&id=${encodeURIComponent(kw)}&limit=${encodeURIComponent(requestLimit)}&server=netease`;
  const results = [];

  try {
    const res = await fetch(url);
    const json = await res.json();
    if (!Array.isArray(json)) return results;

    json.forEach((it, idx) => {
      const songId = pickQueryParam(it.url, 'id') || `${kw}-${idx + 1}`;
      results.push({
        uid: `netease-${songId}`,
        source: 'netease',
        displayIndex: idx + 1,
        keyword: kw,

        songid: songId,
        title: it.name || '',
        artist: it.artist || '',
        album: '',

        cover: it.pic || null,
        audioUrl: null,
        lrc: null,
        lrcUrl: it.lrc || null,

        detailsLoaded: false,
        quality: null,
        qualityLabel: null,
      });
    });
  } catch (e) {
    console.error('netease search error:', e);
  }
  return results;
}

/**
 * 获取网易云详情（播放链接 + 歌词内容）
 * @param {object} track - 搜索结果里的 track 对象
 * @returns {Promise<object>} 更新后的 track（原地修改）
 */
export async function fetchNeteaseDetails(track) {
  if (track.songid) {
    if (!track.audioUrl) {
      track.audioUrl = `${BASE_URL}?server=netease&type=url&id=${encodeURIComponent(track.songid)}`;
    }
    if (!track.lrcUrl) {
      track.lrcUrl = `${BASE_URL}?server=netease&type=lrc&id=${encodeURIComponent(track.songid)}`;
    }
  }

  // 音质推断
  if (track.audioUrl) {
    const url = track.audioUrl;
    const base = url.split('?')[0].toLowerCase();
    const extMatch = base.match(/\.([a-z0-9]+)$/);
    const ext = extMatch ? extMatch[1] : '';
    if (['flac', 'wav', 'ape', 'alac', 'aiff'].includes(ext)) {
      track.quality = 'lossless';
      track.qualityLabel = 'LOSSLESS';
    } else {
      track.quality = '320k';
      track.qualityLabel = '320K';
    }
  }

  // 获取歌词
  if (!track.lrc && track.lrcUrl) {
    try {
      const lr = await fetch(track.lrcUrl);
      const contentType = (lr.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('json')) {
        const lj = await lr.json();
        track.lrc =
          (typeof lj === 'string' ? lj : null) ||
          lj?.lrc ||
          lj?.lyric ||
          lj?.data?.lrc ||
          lj?.data?.lyric ||
          (typeof lj?.data === 'string' ? lj.data : null) ||
          null;
      } else {
        track.lrc = await lr.text();
      }
    } catch (e) {
      console.warn('netease lyric fetch failed:', e);
    }
  }

  track.detailsLoaded = true;
  return track;
}

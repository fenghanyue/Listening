/**
 * 酷我音乐搜索 & 详情
 * API 来源: kw-api.cenguigui.cn (第三方代理)
 */

const SEARCH_URL = 'https://kw-api.cenguigui.cn/';

/**
 * 搜索酷我
 * @param {string} kw - 关键词
 * @param {number} [limit=10]
 * @returns {Promise<Array>} track 对象数组
 */
export async function searchKuwo(kw, limit = 10) {
  const url = `${SEARCH_URL}?name=${encodeURIComponent(kw)}&page=1&limit=${encodeURIComponent(limit)}`;
  const results = [];

  try {
    const res = await fetch(url);
    const json = await res.json();
    if (json.code !== 200 || !Array.isArray(json.data)) return results;

    json.data.forEach((it, idx) => {
      results.push({
        uid: `kuwo-${it.rid}`,
        source: 'kuwo',
        displayIndex: idx + 1,
        keyword: kw,
        songid: it.rid,

        title: it.name || '',
        artist: it.artist || '',
        album: it.album || '',

        cover: it.pic || null,
        audioUrl: null,
        lrc: null,
        lrcUrl: null,

        detailsLoaded: false,
        quality: null,
        qualityLabel: null,
      });
    });
  } catch (e) {
    console.error('kuwo search error:', e);
  }
  return results;
}

/**
 * 获取酷我详情（播放链接 + 歌词 + 音质）
 * @param {object} track - 搜索结果里的 track 对象
 * @returns {Promise<object>} 更新后的 track（原地修改）
 */
export async function fetchKuwoDetails(track) {
  const api = `${SEARCH_URL}?id=${encodeURIComponent(track.songid)}&type=song&level=zp&format=json`;

  try {
    const res = await fetch(api);
    const j = await res.json();
    if (!j || j.code !== 200 || !j.data) throw new Error('kuwo detail failed');

    const d = j.data;
    Object.assign(track, {
      title: d.name || track.title,
      artist: d.artist || track.artist,
      album: d.album || track.album,
      cover: d.pic || track.cover,
      audioUrl: d.url || track.audioUrl,
      lrc: d.lyric || track.lrc || null,
      lrcUrl: null,
      detailsLoaded: true,
    });

    // 音质推断
    if (track.audioUrl) {
      const base = track.audioUrl.split('?')[0].toLowerCase();
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
  } catch (e) {
    console.error('kuwo detail error:', e);
  }
  return track;
}

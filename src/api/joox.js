/**
 * JOOX 搜索 & 详情
 * API 来源: apicx.asia (第三方代理)
 */

const SEARCH_URL = 'https://apicx.asia/api/joox_music';
const JOOX_TOKEN = 'f84ao9lMF_q7husBWRfgUw';
const JOOX_BR = 4;

/**
 * 搜索 JOOX
 * @param {string} kw - 关键词
 * @param {number} [limit=10]
 * @returns {Promise<Array>} track 对象数组
 */
export async function searchJoox(kw, limit = 10) {
  const url = `${SEARCH_URL}?msg=${encodeURIComponent(kw)}&token=${encodeURIComponent(JOOX_TOKEN)}&br=${encodeURIComponent(JOOX_BR)}`;
  const results = [];

  try {
    const res = await fetch(url);
    const json = await res.json();
    const songs = json && json.code === 200 && json.data && Array.isArray(json.data.songs) ? json.data.songs : [];
    songs.slice(0, limit).forEach((it, idx) => {
      const songMid = it.songmid || '';
      const songId = it['歌曲ID'] || songMid || (idx + 1);

      results.push({
        uid: `joox-${songMid || songId}`,
        source: 'joox',
        displayIndex: idx + 1,
        keyword: kw,
        jooxIndex: idx + 1,
        songid: songId,
        songMid: songMid,

        title: it['歌曲名称'] || '',
        artist: it['歌手'] || '',
        album: it['专辑'] || '',

        cover: null,
        audioUrl: null,
        lrc: it['歌词内容'] || null,
        lrcUrl: null,

        detailsLoaded: false,
        quality: null,
        qualityLabel: null,
      });
    });
  } catch (e) {
    console.error('joox search error:', e);
  }
  return results;
}

/**
 * 探测某个播放链接是否可用（HEAD 或 Range GET）
 */
async function probeJooxAudioUrl(u) {
  if (!u) return false;

  async function request(method, extraOptions) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(u, Object.assign({
        method,
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal,
      }, extraOptions || {}));
      return res && (res.ok || res.status === 206 || (res.status >= 200 && res.status < 400));
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    if (await request('HEAD')) return true;
  } catch (e) { /* HEAD not supported */ }

  try {
    return await request('GET', { headers: { Range: 'bytes=0-0' } });
  } catch (e) {
    return false;
  }
}

/**
 * 从 JOOX 返回的播放链接里选最佳
 */
async function pickJooxPlayUrl(links) {
  const order = ['Atmos全景声', '无损FLAC', 'Hi-Res无损', '母带无损', 'OGG 320', 'MP3 320', 'AAC 192', 'OGG 192', 'MP3 128', 'AAC 96', 'AAC 48'];
  for (const name of order) {
    const u = links[name];
    if (!u) continue;
    if (!(await probeJooxAudioUrl(u))) continue;
    if (/母带|无损|flac|hi-res|atmos/i.test(name) || /\.flac(?:\?|$)/i.test(u)) {
      return { url: u, tag: 'lossless', label: 'LOSSLESS', text: name };
    }
    const m = name.match(/(\d+)$/);
    if (m) return { url: u, tag: m[1] + 'k', label: m[1] + 'K', text: name };
    return { url: u, tag: null, label: null, text: name };
  }
  return { url: null, tag: null, label: null, text: null };
}

/**
 * 获取 JOOX 详情（播放链接 + 歌词 + 音质）
 * @param {object} track - 搜索结果里的 track 对象
 * @returns {Promise<object>} 更新后的 track（原地修改）
 */
export async function fetchJooxDetails(track) {
  const n = track.jooxIndex || track.displayIndex || 1;
  const url = `${SEARCH_URL}?msg=${encodeURIComponent(track.keyword)}&n=${n}&token=${encodeURIComponent(JOOX_TOKEN)}&br=${encodeURIComponent(JOOX_BR)}`;

  try {
    const res = await fetch(url);
    const j = await res.json();
    if (!j || j.code !== 200 || !j.data) throw new Error('joox detail failed');

    const d = j.data;
    const playLinks = d['播放链接'] || {};
    const best = await pickJooxPlayUrl(playLinks);

    Object.assign(track, {
      title: d['歌曲名称'] || track.title,
      artist: d['歌手'] || track.artist,
      album: d['专辑'] || track.album,
      songid: d['歌曲ID'] || track.songid,
      songMid: d.songmid || track.songMid,
      audioUrl: best.url || track.audioUrl,
      lrc: d['歌词内容'] || track.lrc || null,
      lrcUrl: null,
      jooxQualityText: best.text || track.jooxQualityText || null,
      detailsLoaded: true,
    });

    if (best.tag && best.label) {
      track.quality = best.tag;
      track.qualityLabel = best.label;
    }
  } catch (e) {
    console.error('joox detail error:', e);
  }
  return track;
}

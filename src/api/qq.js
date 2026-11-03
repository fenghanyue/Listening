/**
 * QQ 音乐搜索 & 详情
 * API 来源: tang.api.s01s.cn (第三方代理)
 */

import { isLosslessExtension } from './utils.js';

const SEARCH_URL = 'https://tang.api.s01s.cn/music_open_api.php';
const detailRequests = new Map();

// 展示和播放可共享正在进行的查询；已返回的音频直链不缓存，播放时仍取得新链接。
function requestQQDetails(track, { signal } = {}) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const mid = String(track.qqId || track.songMid || track.songid || '').trim();
  if (!mid) return Promise.reject(new Error('qq detail error (missing mid)'));
  let job = detailRequests.get(mid);
  if (!job) {
    const msg = (track.qqSearchKey || track.keyword || '').trim() || `${track.title || ''} ${track.artist || ''}`.trim();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    job = { controller, users: 0 };
    job.promise = (async () => {
      const res = await fetch(`${SEARCH_URL}?msg=${encodeURIComponent(msg)}&type=json&mid=${encodeURIComponent(mid)}`, { signal: controller.signal });
      if (!res.ok) throw new Error('qq detail error (HTTP ' + res.status + ')');
      const data = await res.json();
      if (String(data?.song_mid || '') !== mid) throw new Error('qq detail error (mismatched mid)');
      return data;
    })().finally(() => {
      clearTimeout(timer);
      if (detailRequests.get(mid) === job) detailRequests.delete(mid);
    });
    detailRequests.set(mid, job);
  }
  job.users++;
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (callback, value) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      if (--job.users === 0) {
        if (detailRequests.get(mid) === job) detailRequests.delete(mid);
        job.controller.abort();
      }
      callback(value);
    };
    const onAbort = () => finish(reject, signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    job.promise.then(value => finish(resolve, value), error => finish(reject, error));
  });
}

function displayMetadata(data) {
  const pic = data.album_pic || data.singer_pic;
  return {
    cover: typeof pic === 'string' ? pic.replace(/^http:\/\//i, 'https://') : null,
    album: data.album_name || data.album_title || '',
    pageUrl: data.song_h5_url || '',
    lrc: data.song_lyric || data.lyric || null,
  };
}

// 只返回展示资料，不修改 track，不设置 audioUrl/detailsLoaded，也不请求音频文件。
export async function fetchQQMetadata(track, options) {
  return displayMetadata(await requestQQDetails(track, options));
}

/**
 * 搜索 QQ 音乐
 * @param {string} kw - 关键词
 * @param {number} [limit=10]
 * @returns {Promise<Array>} track 对象数组
 */
export async function searchQQ(kw, limit = 10, {signal} = {}) {
  const url = `${SEARCH_URL}?msg=${encodeURIComponent(kw)}&type=json`;
  const results = [];

  try {
    const res = await fetch(url, {signal});
    const json = await res.json();
    const data = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
    if (!Array.isArray(data) || data.length === 0) return results;

    const list = data.slice(0, limit);
    list.forEach((it, idx) => {
      const mid = it.song_mid;
      if (!mid) return;

      results.push({
        uid: `qq-${mid}`,
        source: 'qq',
        displayIndex: idx + 1,
        keyword: kw,
        qqSearchKey: kw,
        qqIndex: idx + 1,

        qqId: mid,
        songid: mid,
        songMid: mid,

        title: it.song_title || '',
        artist: it.singer_name || '',
        album: '',

        cover: null,
        audioUrl: null,
        lrc: null,
        lrcUrl: null,

        detailsLoaded: false,
        quality: null,
        qualityLabel: null,
        qqQualityText: it.pay || null,
        pay: it.pay || null,
      });
    });
  } catch (e) {
    if (!signal?.aborted) console.error('qq search error:', e);
  }
  return results;
}

/**
 * 按音质优先级选播放链接
 */
function pickBestPlayUrl(d) {
  if (d.song_play_url_sq) return { url: d.song_play_url_sq, tag: 'lossless', label: 'LOSSLESS', text: `SQ ${d.kbps_sq || ''}`.trim() };
  if (d.song_play_url_pq) return { url: d.song_play_url_pq, tag: 'lossless', label: 'LOSSLESS', text: `PQ ${d.kbps_pq || ''}`.trim() };
  if (d.song_play_url_accom) return { url: d.song_play_url_accom, tag: 'hq', label: 'HQ', text: `ACCOM ${d.kbps_accom || ''}`.trim() };
  if (d.song_play_url_hq) return { url: d.song_play_url_hq, tag: 'hq', label: 'HQ', text: `HQ ${d.kbps_hq || ''}`.trim() };
  if (d.song_play_url_standard) return { url: d.song_play_url_standard, tag: 'standard', label: 'STD', text: `STD ${d.kbps_standard || ''}`.trim() };
  if (d.song_play_url_fq) return { url: d.song_play_url_fq, tag: 'low', label: 'LOW', text: `FQ ${d.kbps_fq || ''}`.trim() };
  if (d.song_play_url) return { url: d.song_play_url, tag: null, label: null, text: null };
  return { url: null, tag: null, label: null, text: null };
}

/**
 * 获取 QQ 详情（播放链接 + 歌词 + 封面）
 * @param {object} track - 搜索结果里的 track 对象
 * @returns {Promise<object>} 更新后的 track（原地修改）
 */
export async function fetchQQDetails(track, options) {
  try {
    const d = await requestQQDetails(track, options);

    track.title = d.song_title || d.song_name || track.title;
    track.artist = d.singer_name || track.artist;
    // 封面同样固定返回 http://y.gtimg.cn/…，https 实测一样能取。浏览器会自动把 http 图片升级成
    // https，APK 的 WebView 不会：直接当混合内容拦掉，原生下载也被安卓默认禁止明文 http，
    // 封面就既显示不出来也缓存不下来
    for (const [key, value] of Object.entries(displayMetadata(d))) {
      if (value) track[key] = value;
    }

    const best = pickBestPlayUrl(d);
    // CDN 实测 http/https 都通且都发 CORS 头（access-control-allow-origin: *），但接口固定返回
    // http://，页面部署到 HTTPS 域名后浏览器会拦截这种混合内容，这里统一升级成 https
    if (best.url) track.audioUrl = best.url.replace(/^http:\/\//, 'https://');
    track.lrc = d.song_lyric || d.lyric || track.lrc;
    track.qqQualityText = best.text || (d.vip ? `VIP:${d.vip}` : null) || track.qqQualityText;

    if (best.tag && best.label) {
      track.quality = best.tag;
      track.qualityLabel = best.label;
    }

    if (track.audioUrl && isLosslessExtension(track.audioUrl)) {
      track.quality = 'lossless';
      track.qualityLabel = 'LOSSLESS';
    }

    track.detailsLoaded = true;
  } catch (e) {
    console.error('qq detail error:', e);
  }
  return track;
}

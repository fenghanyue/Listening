/**
 * QQ 音乐搜索 & 详情
 * 主接口: api.vkeys.cn
 * 备用接口: api.xunhuisi.store（主接口超时、报错或缺失曲目时自动切换）
 */

import { isLosslessExtension, withTimeoutSignal } from './utils.js';

const VKEYS_BASE = 'https://api.vkeys.cn';
const XUNHUISI_URL = 'https://api.xunhuisi.store/API/QQMusic/Song.php';
const SEARCH_TIMEOUT = 5000;
const DETAIL_TIMEOUT = 6000;
const detailRequests = new Map();

function httpsUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  return url.trim().replace(/^http:\/\//i, 'https://');
}

// 封面统一用 https，并把 vkeys 返回的 y.qq.com/music/photo_new/ 归一化到同源静态图床 y.gtimg.cn
function normalizeQQCover(pic) {
  const url = httpsUrl(pic);
  if (!url) return null;
  return url.replace(/^https:\/\/y\.qq\.com\/music\/photo_new\//i, 'https://y.gtimg.cn/music/photo_new/');
}

function parseAlbumFromLrc(lrc) {
  if (typeof lrc !== 'string') return '';
  const m = lrc.match(/^\[al:([^\]]+)\]/m);
  return m ? m[1].trim() : '';
}

function extractMidFromLink(link) {
  if (typeof link !== 'string') return '';
  const m = link.match(/songDetail\/([A-Za-z0-9]+)/) || link.match(/[?&]songmid=([A-Za-z0-9]+)/);
  return m ? m[1] : '';
}

function isTrialQQAudio(url, qualityText = '', kbps = '') {
  if (!url) return true;
  if (/\/RS02/i.test(url)) return true;
  if (/试听/.test(String(qualityText || ''))) return true;
  const num = parseInt(String(kbps || ''), 10);
  if (num > 0 && num <= 48) return true;
  return false;
}

function classifyQQQuality(url, qualityText = '', kbps = '') {
  const kbpsText = String(kbps || '').trim();
  const qText = String(qualityText || '').trim();
  if (isLosslessExtension(url) || /无损|母带|flac/i.test(qText)) {
    return { tag: 'lossless', label: 'LOSSLESS', text: kbpsText || qText || 'LOSSLESS' };
  }
  const num = parseInt(kbpsText, 10) || parseInt((qText.match(/(\d+)\s*kbps/i) || [])[1], 10) || 0;
  if (num >= 256 || /高品|hq|320/i.test(qText)) {
    return { tag: 'hq', label: 'HQ', text: kbpsText || qText || 'HQ' };
  }
  if (num >= 128 || /标准|std/i.test(qText)) {
    return { tag: 'standard', label: 'STD', text: kbpsText || qText || 'STD' };
  }
  return { tag: null, label: null, text: kbpsText || qText || null };
}

async function fetchVkeysMeta(mid, signal) {
  const json = await withTimeoutSignal(signal, DETAIL_TIMEOUT, async reqSignal => {
    const res = await fetch(`${VKEYS_BASE}/v2/music/tencent?mid=${encodeURIComponent(mid)}`, { signal: reqSignal });
    if (!res.ok) throw new Error('qq detail error (HTTP ' + res.status + ')');
    return res.json();
  });
  const data = json?.data && !Array.isArray(json.data) ? json.data : null;
  if (json?.code !== 200 || !data) throw new Error('qq detail error (vkeys code ' + json?.code + ')');
  const gotMid = String(data.mid || data.song_mid || '').trim();
  if (gotMid !== mid) throw new Error('qq detail error (mismatched mid)');
  const audioUrl = isTrialQQAudio(data.url, data.quality, data.kbps) ? null : httpsUrl(data.url);
  return {
    mid,
    title: data.song || data.song_title || '',
    artist: data.singer || data.singer_name || '',
    album: data.album || data.album_name || '',
    cover: normalizeQQCover(data.cover || data.album_pic || data.singer_pic),
    pageUrl: data.link || data.song_h5_url || '',
    lrc: data.lrc || data.song_lyric || data.lyric || null,
    audioUrl,
    qualityText: data.quality || '',
    kbps: data.kbps || '',
    pay: data.pay || null,
    provider: 'vkeys',
  };
}

async function fetchXunhuisiDetail(mid, signal) {
  const json = await withTimeoutSignal(signal, DETAIL_TIMEOUT, async reqSignal => {
    const res = await fetch(`${XUNHUISI_URL}?mid=${encodeURIComponent(mid)}&type=json`, { signal: reqSignal });
    if (!res.ok) throw new Error('qq fallback detail error (HTTP ' + res.status + ')');
    return res.json();
  });
  if (json?.code !== 200) throw new Error('qq fallback detail error (code ' + json?.code + ')');
  const gotMid = String(json.mid || json.song_mid || extractMidFromLink(json.link) || '').trim();
  if (gotMid && gotMid !== mid) throw new Error('qq detail error (mismatched mid)');
  const lrc = json.lyric || json.lrc || null;
  const audioUrl = isTrialQQAudio(json.music_url, json.quality) ? null : httpsUrl(json.music_url);
  return {
    mid,
    title: json.title || json.name || '',
    artist: json.singer || '',
    album: json.album || parseAlbumFromLrc(lrc),
    cover: normalizeQQCover(json.cover),
    pageUrl: json.link || '',
    lrc,
    audioUrl,
    qualityText: json.quality || '',
    kbps: '',
    pay: null,
    provider: 'xunhuisi',
  };
}

async function fetchVkeysPlayUrl(mid, signal) {
  for (const quality of [10, 8]) {
    let json;
    try {
      json = await withTimeoutSignal(signal, DETAIL_TIMEOUT, async reqSignal => {
        const res = await fetch(`${VKEYS_BASE}/music/tencent/song/link?mid=${encodeURIComponent(mid)}&quality=${quality}`, { signal: reqSignal });
        if (!res.ok) throw new Error('qq link error (HTTP ' + res.status + ')');
        return res.json();
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      return null;
    }
    const data = json?.data;
    if (json?.code === 0 && data) {
      const gotMid = String(data.songMID || data.mid || '').trim();
      if (gotMid && gotMid !== mid) throw new Error('qq detail error (mismatched mid)');
      if (!isTrialQQAudio(data.url, data.quality, data.kbps)) {
        return {
          audioUrl: httpsUrl(data.url),
          kbps: data.kbps || '',
          qualityText: data.quality || '',
          pageUrl: data.link || '',
        };
      }
    }
    // 110000 等曲目级不可解析错误不再重复换音质请求，直接交给备用接口
    if (json?.code === 110000) return null;
  }
  return null;
}

async function fetchVkeysLyric(mid, signal) {
  try {
    const json = await withTimeoutSignal(signal, SEARCH_TIMEOUT, async reqSignal => {
      const res = await fetch(`${VKEYS_BASE}/v2/music/tencent/lyric?mid=${encodeURIComponent(mid)}`, { signal: reqSignal });
      if (!res.ok) return null;
      return res.json();
    });
    return json?.data?.lrc || null;
  } catch (e) {
    return null;
  }
}

// 展示和播放可共享正在进行的查询；已返回的音频直链不缓存，播放时仍取得新链接。
function requestQQDetails(track, { signal } = {}) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const mid = String(track.qqId || track.songMid || track.songid || '').trim();
  if (!mid) return Promise.reject(new Error('qq detail error (missing mid)'));
  let job = detailRequests.get(mid);
  if (!job) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    job = { controller, users: 0 };
    job.promise = (async () => {
      try {
        return await fetchVkeysMeta(mid, controller.signal);
      } catch (e) {
        if (controller.signal.aborted || /mismatched mid/.test(e?.message || '')) throw e;
        return await fetchXunhuisiDetail(mid, controller.signal);
      }
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
  return {
    cover: normalizeQQCover(data.cover),
    album: data.album || '',
    pageUrl: data.pageUrl || '',
    lrc: data.lrc || null,
  };
}

// 只返回展示资料，不修改 track，不设置 audioUrl/detailsLoaded，也不请求音频文件。
export async function fetchQQMetadata(track, options) {
  return displayMetadata(await requestQQDetails(track, options));
}

function mapQQSearchItem(it, idx, kw) {
  const mid = String(it?.mid || it?.song_mid || '').trim();
  if (!mid) return null;
  return {
    uid: `qq-${mid}`,
    source: 'qq',
    displayIndex: idx + 1,
    keyword: kw,
    qqSearchKey: kw,
    qqIndex: idx + 1,

    qqId: mid,
    songid: mid,
    songMid: mid,

    title: it.song || it.name || it.song_title || '',
    artist: it.singer || it.singer_name || '',
    album: it.album || it.album_name || '',

    cover: normalizeQQCover(it.cover || it.album_pic),
    audioUrl: null,
    lrc: null,
    lrcUrl: null,

    detailsLoaded: false,
    quality: null,
    qualityLabel: null,
    qqQualityText: it.quality || it.pay || null,
    pay: it.pay || null,
  };
}

/**
 * 搜索 QQ 音乐（主 vkeys，副 xunhuisi）
 * @param {string} kw - 关键词
 * @param {number} [limit=10]
 * @returns {Promise<Array>} track 对象数组
 */
export async function searchQQ(kw, limit = 10, { signal, timeout = SEARCH_TIMEOUT, onError } = {}) {
  const results = [];
  let primaryErr = null;

  // 1. 主接口：api.vkeys.cn
  try {
    const url = `${VKEYS_BASE}/v2/music/tencent?word=${encodeURIComponent(kw)}&num=${encodeURIComponent(limit)}`;
    const json = await withTimeoutSignal(signal, timeout, async reqSignal => {
      const res = await fetch(url, { signal: reqSignal });
      if (!res.ok) throw new Error('qq search error (HTTP ' + res.status + ')');
      return res.json();
    });
    if (json?.code != null && json.code !== 200) throw new Error('qq search error (vkeys code ' + json.code + ')');
    const data = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
    data.slice(0, limit).forEach((it, idx) => {
      const mapped = mapQQSearchItem(it, idx, kw);
      if (mapped) results.push(mapped);
    });
    if (results.length > 0) return results;
  } catch (e) {
    primaryErr = e;
    if (!signal?.aborted) console.error('qq search error (vkeys):', e);
  }

  if (signal?.aborted) return results;

  // 2. 备用接口：api.xunhuisi.store
  try {
    const url = `${XUNHUISI_URL}?name=${encodeURIComponent(kw)}&type=json`;
    const json = await withTimeoutSignal(signal, timeout, async reqSignal => {
      const res = await fetch(url, { signal: reqSignal });
      if (!res.ok) throw new Error('qq fallback search error (HTTP ' + res.status + ')');
      return res.json();
    });
    if (json?.code != null && json.code !== 200) throw new Error('qq fallback search error (code ' + json.code + ')');
    const data = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
    data.slice(0, limit).forEach((it, idx) => {
      const mapped = mapQQSearchItem(it, idx, kw);
      if (mapped) results.push(mapped);
    });
  } catch (e) {
    if (!signal?.aborted) {
      console.error('qq search error (xunhuisi):', e);
      if (primaryErr) onError?.(e);
    }
  }
  return results;
}

function applyDetailMetadata(track, d) {
  if (!d) return;
  if (d.title) track.title = d.title;
  if (d.artist) track.artist = d.artist;
  for (const [key, value] of Object.entries(displayMetadata(d))) {
    if (value) track[key] = value;
  }
}

/**
 * 获取 QQ 详情（播放链接 + 歌词 + 封面 + 专辑）
 * 优先走 vkeys（播放链接 /music/tencent/song/link + 歌词），缺失或失败时自动回退到 xunhuisi。
 * @param {object} track - 搜索结果里的 track 对象
 * @returns {Promise<object>} 更新后的 track（原地修改）
 */
export async function fetchQQDetails(track, options) {
  const mid = String(track.qqId || track.songMid || track.songid || '').trim();
  if (!mid) return track;
  const signal = options?.signal;

  try {
    let meta = null;
    if (!track.cover || !track.album || !track.pageUrl || detailRequests.has(mid)) {
      try {
        meta = await requestQQDetails(track, options);
        applyDetailMetadata(track, meta);
      } catch (e) {
        if (signal?.aborted || /mismatched mid/.test(e?.message || '')) throw e;
      }
    }

    let playUrl = meta?.audioUrl || null;
    let qualityText = meta?.qualityText || '';
    let kbps = meta?.kbps || '';

    // vkeys 元数据在 VIP 曲目上仅给试听链接，正式播放走 /music/tencent/song/link 拿完整高品/无损直链
    if (!playUrl) {
      const [vkeysPlay, vkeysLrc] = await Promise.all([
        fetchVkeysPlayUrl(mid, signal),
        !track.lrc ? fetchVkeysLyric(mid, signal) : Promise.resolve(null),
      ]);
      if (vkeysLrc && !track.lrc) track.lrc = vkeysLrc;
      if (vkeysPlay?.audioUrl) {
        playUrl = vkeysPlay.audioUrl;
        qualityText = vkeysPlay.qualityText || qualityText;
        kbps = vkeysPlay.kbps || kbps;
        if (vkeysPlay.pageUrl && !track.pageUrl) track.pageUrl = vkeysPlay.pageUrl;
      }
    }

    // 主接口没拿到完整音频直链时，回退到 xunhuisi（若前面元数据已回退过则不重复请求）
    if (!playUrl && meta?.provider !== 'xunhuisi' && !signal?.aborted) {
      const fallback = await fetchXunhuisiDetail(mid, signal);
      applyDetailMetadata(track, fallback);
      if (fallback.audioUrl) {
        playUrl = fallback.audioUrl;
        qualityText = fallback.qualityText || qualityText;
        kbps = fallback.kbps || kbps;
      }
    }

    if (!track.lrc && !signal?.aborted) {
      const lrc = await fetchVkeysLyric(mid, signal);
      if (lrc) track.lrc = lrc;
    }

    if (playUrl) {
      track.audioUrl = playUrl;
      const q = classifyQQQuality(playUrl, qualityText, kbps);
      if (q.tag && q.label) {
        track.quality = q.tag;
        track.qualityLabel = q.label;
      }
      if (q.text) track.qqQualityText = q.text;
      track.detailsLoaded = true;
    }
  } catch (e) {
    console.error('qq detail error:', e);
  }
  return track;
}


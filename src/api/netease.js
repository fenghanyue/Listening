/**
 * 网易云音乐搜索 & 详情
 * 搜索：主 qijieya meting → 备1 api.vkeys.cn → 备2 现有 /proxy 转发网易云官方 cloudsearch
 * 歌单：主 qijieya meting → 备 api.injahow.cn meting
 * 播放与歌词：主 qijieya meting → 失败重试自动切 api.yutangxiaowu.cn / api.injahow.cn / vkeys 歌词
 */

import { isLosslessExtension, proxyBase, withTimeoutSignal } from './utils.js';

const BASE_URL = 'https://api.qijieya.cn/meting/';
const INJAHOW_URL = 'https://api.injahow.cn/meting/';
const VKEYS_NETEASE_URL = 'https://api.vkeys.cn/v2/music/netease';
const YUTANG_NETEASE_URL = 'https://api.yutangxiaowu.cn/api/music/Song_V1';
const SEARCH_TIMEOUT = 5000;
const PLAYLIST_TIMEOUT = 8000;
const DETAIL_TIMEOUT = 6000;

function httpsUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  return url.trim().replace(/^http:\/\//i, 'https://');
}

// meting 的 search/url/lrc 接口本身不带专辑名（固定 name/artist/url/pic/lrc 5 字段），
// 专辑名需要额外查网易云官方接口，且该接口不发 CORS 头，浏览器端必须经代理转发（server.mjs
// 提供的 /proxy；网页版同源走相对路径，APK 里走线上实例，前缀见 utils.js 的 proxyBase）

/**
 * 查专辑名（走本地代理，代理不可用或请求失败时静默放弃，不影响播放主流程）
 */
async function fetchNeteaseAlbum(songid) {
  const target = `https://interface3.music.163.com/api/v3/song/detail?c=${encodeURIComponent(JSON.stringify([{ id: Number(songid) }]))}`;
  try {
    const r = await fetch(`${proxyBase()}/proxy?url=${encodeURIComponent(target)}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return '';
    const json = await r.json();
    return json?.songs?.[0]?.al?.name || '';
  } catch (e) {
    return '';
  }
}

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

// meting 返回的曲目对象（search/playlist 共用同一形状）转换成 track 对象
function mapMetingItem(it, idx, keyword) {
  const songId = pickQueryParam(it.url, 'id') || `${keyword || 'pl'}-${idx + 1}`;
  return {
    uid: `netease-${songId}`,
    source: 'netease',
    displayIndex: idx + 1,
    keyword: keyword || '',

    songid: songId,
    title: it.name || '',
    artist: it.artist || '',
    album: '',

    cover: httpsUrl(it.pic),
    audioUrl: null,
    lrc: null,
    lrcUrl: it.lrc || null,

    detailsLoaded: false,
    quality: null,
    qualityLabel: null,
  };
}

// vkeys 网易云搜索返回的曲目转换成 track 对象（直连带 CORS 头，自带专辑与封面）
function mapVkeysNeteaseItem(it, idx, keyword) {
  const songId = String(it?.id || '').trim();
  if (!songId) return null;
  return {
    uid: `netease-${songId}`,
    source: 'netease',
    displayIndex: idx + 1,
    keyword: keyword || '',

    songid: songId,
    title: it.song || it.name || '',
    artist: it.singer || '',
    album: it.album || '',

    cover: httpsUrl(it.cover),
    audioUrl: null,
    lrc: null,
    lrcUrl: null,

    detailsLoaded: false,
    quality: null,
    qualityLabel: null,
  };
}

// 网易云官方 cloudsearch 返回的曲目转换成 track 对象（作为第三方搜索限流/超时时的代理兜底）
function mapCloudSearchItem(it, idx, keyword) {
  const songId = String(it?.id || `${keyword || 'ne'}-${idx + 1}`);
  const artists = Array.isArray(it?.ar)
    ? it.ar.map(a => a?.name).filter(Boolean).join('/')
    : (Array.isArray(it?.artists) ? it.artists.map(a => a?.name).filter(Boolean).join('/') : '');
  const pic = it?.al?.picUrl || it?.album?.picUrl || null;
  return {
    uid: `netease-${songId}`,
    source: 'netease',
    displayIndex: idx + 1,
    keyword: keyword || '',

    songid: songId,
    title: it?.name || '',
    artist: artists,
    album: it?.al?.name || it?.album?.name || '',

    cover: httpsUrl(pic),
    audioUrl: null,
    lrc: null,
    lrcUrl: null,

    detailsLoaded: false,
    quality: null,
    qualityLabel: null,
  };
}

/**
 * 搜索网易云
 * 优先走 qijieya meting；超时或限流返空时，依次回退到 vkeys 网易云接口与 /proxy 官方 cloudsearch。
 * @param {string} kw - 关键词
 * @param {number} [page=1]
 * @param {number} [num=10]
 * @returns {Promise<Array>} track 对象数组
 */
export async function searchNetease(kw, page = 1, num = 10, { signal, timeout = SEARCH_TIMEOUT, onError } = {}) {
  const requestLimit = Math.max(1, page) * Math.max(1, num);
  const results = [];
  let primaryErr = null;
  let vkeysErr = null;

  // 1. 主接口：qijieya meting
  try {
    const url = `${BASE_URL}?type=search&id=${encodeURIComponent(kw)}&limit=${encodeURIComponent(requestLimit)}&server=netease`;
    const json = await withTimeoutSignal(signal, timeout, async reqSignal => {
      const res = await fetch(url, { signal: reqSignal });
      if (!res.ok) throw new Error(`netease search error (HTTP ${res.status})`);
      return res.json();
    });
    if (Array.isArray(json) && json.length > 0) {
      json.forEach((it, idx) => results.push(mapMetingItem(it, idx, kw)));
      return results;
    }
  } catch (e) {
    primaryErr = e;
    if (!signal?.aborted) console.error('netease search error (qijieya):', e);
  }

  if (signal?.aborted) return results;

  // 2. 备用 1：vkeys 网易云搜索（直连带 CORS，不经代理）
  try {
    const vkeysUrl = `${VKEYS_NETEASE_URL}?word=${encodeURIComponent(kw)}&num=${encodeURIComponent(requestLimit)}`;
    const json = await withTimeoutSignal(signal, timeout, async reqSignal => {
      const res = await fetch(vkeysUrl, { signal: reqSignal });
      if (!res.ok) throw new Error(`netease vkeys search error (HTTP ${res.status})`);
      return res.json();
    });
    if (json?.code != null && json.code !== 200) throw new Error(`netease vkeys search error (code ${json.code})`);
    const list = Array.isArray(json?.data) ? json.data : [];
    list.slice(0, requestLimit).forEach((it, idx) => {
      const mapped = mapVkeysNeteaseItem(it, idx, kw);
      if (mapped) results.push(mapped);
    });
    if (results.length > 0) return results;
  } catch (e) {
    vkeysErr = e;
    if (!signal?.aborted) console.error('netease fallback search error (vkeys):', e);
  }

  if (signal?.aborted) return results;

  // 3. 备用 2：经现有 /proxy 转发网易云官方 cloudsearch
  const target = `https://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(kw)}&type=1&limit=${encodeURIComponent(requestLimit)}&offset=0`;
  const proxyUrl = `${proxyBase()}/proxy?url=${encodeURIComponent(target)}`;
  try {
    const json = await withTimeoutSignal(signal, timeout, async reqSignal => {
      const res = await fetch(proxyUrl, { signal: reqSignal });
      if (!res.ok) throw new Error(`netease proxy search error (HTTP ${res.status})`);
      return res.json();
    });
    const songs = json?.result?.songs;
    if (Array.isArray(songs) && songs.length > 0) {
      songs.slice(0, requestLimit).forEach((it, idx) => results.push(mapCloudSearchItem(it, idx, kw)));
      return results;
    }
  } catch (e) {
    if (!signal?.aborted) {
      console.error('netease fallback search error (proxy):', e);
      if (primaryErr && vkeysErr) onError?.(e);
    }
  }
  return results;
}

/**
 * 解析网易云 App「分享」生成的 163cn.tv 短链，返回跳转后的真实长链接
 * 短链没有 CORS 头，必须走 /proxy 代理请求，从响应头 X-Proxy-Location 里读跳转目标；
 * 跳转链路可能不止一跳，最多跟进 3 次，直到拿到 music.163.com 长链接或没有更多跳转
 */
export async function resolveNeteaseShortLink(shortUrl) {
  let url = shortUrl;
  try {
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${proxyBase()}/proxy?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(5000) });
      const location = res.headers.get('x-proxy-location');
      if (!location) break;
      url = new URL(location, url).toString();
      if (/music\.163\.com/.test(url)) return url;
    }
  } catch (e) {
    console.error('netease short link resolve error:', e);
    return '';
  }
  return /music\.163\.com/.test(url) ? url : '';
}

/**
 * 拉取网易云歌单全部曲目（主 qijieya，备 injahow）
 * @param {string|number} playlistId - 歌单数字 id
 * @returns {Promise<Array>} track 对象数组
 */
export async function fetchNeteasePlaylist(playlistId, { signal, timeout = PLAYLIST_TIMEOUT } = {}) {
  const id = String(playlistId || '').trim();
  const results = [];
  if (!/^\d+$/.test(id)) return results;

  for (const base of [BASE_URL, INJAHOW_URL]) {
    if (signal?.aborted) return results;
    const url = `${base}?type=playlist&id=${encodeURIComponent(id)}&server=netease`;
    try {
      const json = await withTimeoutSignal(signal, timeout, async reqSignal => {
        const res = await fetch(url, { signal: reqSignal });
        if (!res.ok) throw new Error(`netease playlist error (HTTP ${res.status})`);
        return res.json();
      });
      if (Array.isArray(json) && json.length > 0) {
        json.forEach((it, idx) => results.push(mapMetingItem(it, idx, '')));
        return results;
      }
    } catch (e) {
      if (!signal?.aborted) console.error('netease playlist fetch error:', e);
    }
  }
  return results;
}

async function fetchLyricFromUrl(url) {
  try {
    const text = await withTimeoutSignal(null, DETAIL_TIMEOUT, async reqSignal => {
      const lr = await fetch(url, { signal: reqSignal });
      if (!lr.ok) return null;
      const contentType = (lr.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('json')) {
        const lj = await lr.json();
        return (
          (typeof lj === 'string' ? lj : null) ||
          lj?.lrc ||
          lj?.lyric ||
          lj?.data?.lrc ||
          lj?.data?.lyric ||
          (typeof lj?.data === 'string' ? lj.data : null) ||
          null
        );
      }
      return lr.text();
    });
    return typeof text === 'string' && text.trim() ? text : null;
  } catch (e) {
    console.warn('netease lyric fetch failed:', e);
    return null;
  }
}

async function fetchYutangNeteaseDetail(songid) {
  try {
    const json = await withTimeoutSignal(null, DETAIL_TIMEOUT, async reqSignal => {
      const res = await fetch(`${YUTANG_NETEASE_URL}?url=${encodeURIComponent(songid)}&level=exhigh&type=json`, { signal: reqSignal });
      if (!res.ok) return null;
      return res.json();
    });
    if (json?.status !== 200 || !json?.url) return null;
    return {
      audioUrl: httpsUrl(json.url),
      album: json.al_name || '',
      lrc: json.lyric || null,
    };
  } catch (e) {
    console.warn('netease fallback detail failed (yutang):', e);
    return null;
  }
}

/**
 * 获取网易云详情（播放链接 + 歌词内容）
 * 首次默认走 qijieya 播放直链；播放失败自动重试时，依次切到 yutangxiaowu 与 injahow 备用源。
 * 歌词在主源失败或空串时自动回退到 vkeys 与 injahow。
 * @param {object} track - 搜索结果里的 track 对象
 * @returns {Promise<object>} 更新后的 track（原地修改）
 */
export async function fetchNeteaseDetails(track) {
  const step = Number(track._neteaseProviderStep) || 0;
  if (track.songid) {
    if (!track.audioUrl) {
      if (step === 0) {
        track.audioUrl = `${BASE_URL}?server=netease&type=url&id=${encodeURIComponent(track.songid)}`;
        track._neteaseProviderStep = 1;
      } else if (step === 1) {
        const alt = await fetchYutangNeteaseDetail(track.songid);
        if (alt?.audioUrl) {
          track.audioUrl = alt.audioUrl;
          if (!track.album && alt.album) track.album = alt.album;
          if (!track.lrc && alt.lrc) track.lrc = alt.lrc;
        } else {
          track.audioUrl = `${INJAHOW_URL}?server=netease&type=url&id=${encodeURIComponent(track.songid)}`;
        }
        track._neteaseProviderStep = 2;
      } else {
        track.audioUrl = `${INJAHOW_URL}?server=netease&type=url&id=${encodeURIComponent(track.songid)}`;
        track._neteaseProviderStep = 0;
      }
    }
    if (!track.lrcUrl) {
      track.lrcUrl = `${BASE_URL}?server=netease&type=lrc&id=${encodeURIComponent(track.songid)}`;
    }
  }

  // 音质推断
  if (track.audioUrl) {
    if (isLosslessExtension(track.audioUrl)) {
      track.quality = 'lossless';
      track.qualityLabel = 'LOSSLESS';
    } else {
      track.quality = '320k';
      track.qualityLabel = '320K';
    }
  }

  // 获取歌词 + 专辑名（并行，互不影响；专辑名查询失败静默放弃）
  const jobs = [];

  if (!track.lrc && (track.lrcUrl || track.songid)) {
    jobs.push((async () => {
      const candidates = [
        track.lrcUrl,
        track.songid ? `${VKEYS_NETEASE_URL}/lyric?id=${encodeURIComponent(track.songid)}` : null,
        track.songid ? `${INJAHOW_URL}?server=netease&type=lrc&id=${encodeURIComponent(track.songid)}` : null,
      ].filter(Boolean);
      for (const lrcUrl of candidates) {
        const lrc = await fetchLyricFromUrl(lrcUrl);
        if (lrc) { track.lrc = lrc; break; }
      }
    })());
  }

  if (!track.album && track.songid) {
    jobs.push((async () => {
      track.album = await fetchNeteaseAlbum(track.songid);
    })());
  }

  if (jobs.length) await Promise.all(jobs);

  track.detailsLoaded = true;
  return track;
}


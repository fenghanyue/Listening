var ListeningAPI = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/api/index.js
  var index_exports = {};
  __export(index_exports, {
    ensureTrackDetails: () => ensureTrackDetails,
    fetchJooxDetails: () => fetchJooxDetails,
    fetchNeteaseDetails: () => fetchNeteaseDetails,
    fetchQQDetails: () => fetchQQDetails,
    fetchSoundCloudDetails: () => fetchSoundCloudDetails,
    searchAll: () => searchAll,
    searchJoox: () => searchJoox,
    searchNetease: () => searchNetease,
    searchQQ: () => searchQQ,
    searchSoundCloud: () => searchSoundCloud
  });

  // src/api/netease.js
  var BASE_URL = "https://api.qijieya.cn/meting/";
  function pickQueryParam(rawUrl, key) {
    if (!rawUrl) return "";
    try {
      return new URL(rawUrl, "http://placeholder.local").searchParams.get(key) || "";
    } catch (e) {
      const m = String(rawUrl).match(new RegExp("[?&]" + key + "=([^&]+)"));
      return m ? decodeURIComponent(m[1]) : "";
    }
  }
  async function searchNetease(kw, page = 1, num = 10) {
    const requestLimit = Math.max(1, page) * Math.max(1, num);
    const url = `${BASE_URL}?type=search&id=${encodeURIComponent(kw)}&limit=${encodeURIComponent(requestLimit)}&server=netease`;
    const results = [];
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (!Array.isArray(json)) return results;
      json.forEach((it, idx) => {
        const songId = pickQueryParam(it.url, "id") || `${kw}-${idx + 1}`;
        results.push({
          uid: `netease-${songId}`,
          source: "netease",
          displayIndex: idx + 1,
          keyword: kw,
          songid: songId,
          title: it.name || "",
          artist: it.artist || "",
          album: "",
          cover: it.pic || null,
          audioUrl: null,
          lrc: null,
          lrcUrl: it.lrc || null,
          detailsLoaded: false,
          quality: null,
          qualityLabel: null
        });
      });
    } catch (e) {
      console.error("netease search error:", e);
    }
    return results;
  }
  async function fetchNeteaseDetails(track) {
    if (track.songid) {
      if (!track.audioUrl) {
        track.audioUrl = `${BASE_URL}?server=netease&type=url&id=${encodeURIComponent(track.songid)}`;
      }
      if (!track.lrcUrl) {
        track.lrcUrl = `${BASE_URL}?server=netease&type=lrc&id=${encodeURIComponent(track.songid)}`;
      }
    }
    if (track.audioUrl) {
      const url = track.audioUrl;
      const base = url.split("?")[0].toLowerCase();
      const extMatch = base.match(/\.([a-z0-9]+)$/);
      const ext = extMatch ? extMatch[1] : "";
      if (["flac", "wav", "ape", "alac", "aiff"].includes(ext)) {
        track.quality = "lossless";
        track.qualityLabel = "LOSSLESS";
      } else {
        track.quality = "320k";
        track.qualityLabel = "320K";
      }
    }
    if (!track.lrc && track.lrcUrl) {
      try {
        const lr = await fetch(track.lrcUrl);
        const contentType = (lr.headers.get("content-type") || "").toLowerCase();
        if (contentType.includes("json")) {
          const lj = await lr.json();
          track.lrc = (typeof lj === "string" ? lj : null) || lj?.lrc || lj?.lyric || lj?.data?.lrc || lj?.data?.lyric || (typeof lj?.data === "string" ? lj.data : null) || null;
        } else {
          track.lrc = await lr.text();
        }
      } catch (e) {
        console.warn("netease lyric fetch failed:", e);
      }
    }
    track.detailsLoaded = true;
    return track;
  }

  // src/api/qq.js
  var SEARCH_URL = "https://tang.api.s01s.cn/music_open_api.php";
  async function searchQQ(kw, limit = 10) {
    const url = `${SEARCH_URL}?msg=${encodeURIComponent(kw)}&type=json`;
    const results = [];
    try {
      const res = await fetch(url);
      const json = await res.json();
      const data = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
      if (!Array.isArray(data) || data.length === 0) return results;
      const list = data.slice(0, limit);
      list.forEach((it, idx) => {
        const mid = it.song_mid;
        if (!mid) return;
        results.push({
          uid: `qq-${mid}`,
          source: "qq",
          displayIndex: idx + 1,
          keyword: kw,
          qqSearchKey: kw,
          qqIndex: idx + 1,
          qqId: mid,
          songid: mid,
          songMid: mid,
          title: it.song_title || "",
          artist: it.singer_name || "",
          album: "",
          cover: null,
          audioUrl: null,
          lrc: null,
          lrcUrl: null,
          detailsLoaded: false,
          quality: null,
          qualityLabel: null,
          qqQualityText: it.pay || null,
          pay: it.pay || null
        });
      });
    } catch (e) {
      console.error("qq search error:", e);
    }
    return results;
  }
  function pickBestPlayUrl(d) {
    if (d.song_play_url_sq) return { url: d.song_play_url_sq, tag: "lossless", label: "LOSSLESS", text: `SQ ${d.kbps_sq || ""}`.trim() };
    if (d.song_play_url_pq) return { url: d.song_play_url_pq, tag: "lossless", label: "LOSSLESS", text: `PQ ${d.kbps_pq || ""}`.trim() };
    if (d.song_play_url_accom) return { url: d.song_play_url_accom, tag: "hq", label: "HQ", text: `ACCOM ${d.kbps_accom || ""}`.trim() };
    if (d.song_play_url_hq) return { url: d.song_play_url_hq, tag: "hq", label: "HQ", text: `HQ ${d.kbps_hq || ""}`.trim() };
    if (d.song_play_url_standard) return { url: d.song_play_url_standard, tag: "standard", label: "STD", text: `STD ${d.kbps_standard || ""}`.trim() };
    if (d.song_play_url_fq) return { url: d.song_play_url_fq, tag: "low", label: "LOW", text: `FQ ${d.kbps_fq || ""}`.trim() };
    if (d.song_play_url) return { url: d.song_play_url, tag: null, label: null, text: null };
    return { url: null, tag: null, label: null, text: null };
  }
  async function fetchQQDetails(track) {
    const msg = (track.qqSearchKey || track.keyword || "").trim() || ((track.title || "") + " " + (track.artist || "")).trim();
    const mid = (track.qqId || track.songMid || track.songid || "").toString().trim();
    if (!mid) return track;
    const url = `${SEARCH_URL}?msg=${encodeURIComponent(msg)}&type=json&mid=${encodeURIComponent(mid)}`;
    try {
      const res = await fetch(url);
      const d = await res.json();
      if (!d || typeof d !== "object" || !d.song_mid) {
        throw new Error("qq detail error (invalid response)");
      }
      track.title = d.song_title || d.song_name || track.title;
      track.artist = d.singer_name || track.artist;
      track.album = d.album_name || d.album_title || track.album || "";
      track.cover = d.album_pic || d.singer_pic || track.cover;
      track.pageUrl = d.song_h5_url || track.pageUrl;
      const best = pickBestPlayUrl(d);
      track.audioUrl = best.url || track.audioUrl;
      track.lrc = d.song_lyric || d.lyric || track.lrc;
      track.qqQualityText = best.text || (d.vip ? `VIP:${d.vip}` : null) || track.qqQualityText;
      if (best.tag && best.label) {
        track.quality = best.tag;
        track.qualityLabel = best.label;
      }
      if (track.audioUrl) {
        const base = track.audioUrl.split("?")[0].toLowerCase();
        const extMatch = base.match(/\.([a-z0-9]+)$/);
        const ext = extMatch ? extMatch[1] : "";
        if (["flac", "wav", "ape", "alac", "aiff"].includes(ext)) {
          track.quality = "lossless";
          track.qualityLabel = "LOSSLESS";
        }
      }
      track.detailsLoaded = true;
    } catch (e) {
      console.error("qq detail error:", e);
    }
    return track;
  }

  // src/api/joox.js
  var SEARCH_URL2 = "https://apicx.asia/api/joox_music";
  var JOOX_TOKEN = "f84ao9lMF_q7husBWRfgUw";
  var JOOX_BR = 4;
  async function searchJoox(kw, limit = 10) {
    const url = `${SEARCH_URL2}?msg=${encodeURIComponent(kw)}&token=${encodeURIComponent(JOOX_TOKEN)}&br=${encodeURIComponent(JOOX_BR)}`;
    const results = [];
    try {
      const res = await fetch(url);
      const json = await res.json();
      const songs = json && json.code === 200 && json.data && Array.isArray(json.data.songs) ? json.data.songs : [];
      songs.slice(0, limit).forEach((it, idx) => {
        const songMid = it.songmid || "";
        const songId = it["\u6B4C\u66F2ID"] || songMid || idx + 1;
        results.push({
          uid: `joox-${songMid || songId}`,
          source: "joox",
          displayIndex: idx + 1,
          keyword: kw,
          jooxIndex: idx + 1,
          songid: songId,
          songMid,
          title: it["\u6B4C\u66F2\u540D\u79F0"] || "",
          artist: it["\u6B4C\u624B"] || "",
          album: it["\u4E13\u8F91"] || "",
          cover: null,
          audioUrl: null,
          lrc: it["\u6B4C\u8BCD\u5185\u5BB9"] || null,
          lrcUrl: null,
          detailsLoaded: false,
          quality: null,
          qualityLabel: null
        });
      });
    } catch (e) {
      console.error("joox search error:", e);
    }
    return results;
  }
  async function probeJooxAudioUrl(u) {
    if (!u) return false;
    async function request(method, extraOptions) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3e3);
      try {
        const res = await fetch(u, Object.assign({
          method,
          cache: "no-store",
          redirect: "follow",
          signal: controller.signal
        }, extraOptions || {}));
        return res && (res.ok || res.status === 206 || res.status >= 200 && res.status < 400);
      } finally {
        clearTimeout(timer);
      }
    }
    try {
      if (await request("HEAD")) return true;
    } catch (e) {
    }
    try {
      return await request("GET", { headers: { Range: "bytes=0-0" } });
    } catch (e) {
      return false;
    }
  }
  async function pickJooxPlayUrl(links) {
    const order = ["Atmos\u5168\u666F\u58F0", "\u65E0\u635FFLAC", "Hi-Res\u65E0\u635F", "\u6BCD\u5E26\u65E0\u635F", "OGG 320", "MP3 320", "AAC 192", "OGG 192", "MP3 128", "AAC 96", "AAC 48"];
    for (const name of order) {
      const u = links[name];
      if (!u) continue;
      if (!await probeJooxAudioUrl(u)) continue;
      if (/母带|无损|flac|hi-res|atmos/i.test(name) || /\.flac(?:\?|$)/i.test(u)) {
        return { url: u, tag: "lossless", label: "LOSSLESS", text: name };
      }
      const m = name.match(/(\d+)$/);
      if (m) return { url: u, tag: m[1] + "k", label: m[1] + "K", text: name };
      return { url: u, tag: null, label: null, text: name };
    }
    return { url: null, tag: null, label: null, text: null };
  }
  async function fetchJooxDetails(track) {
    const n = track.jooxIndex || track.displayIndex || 1;
    const url = `${SEARCH_URL2}?msg=${encodeURIComponent(track.keyword)}&n=${n}&token=${encodeURIComponent(JOOX_TOKEN)}&br=${encodeURIComponent(JOOX_BR)}`;
    try {
      const res = await fetch(url);
      const j = await res.json();
      if (!j || j.code !== 200 || !j.data) throw new Error("joox detail failed");
      const d = j.data;
      const playLinks = d["\u64AD\u653E\u94FE\u63A5"] || {};
      const best = await pickJooxPlayUrl(playLinks);
      Object.assign(track, {
        title: d["\u6B4C\u66F2\u540D\u79F0"] || track.title,
        artist: d["\u6B4C\u624B"] || track.artist,
        album: d["\u4E13\u8F91"] || track.album,
        songid: d["\u6B4C\u66F2ID"] || track.songid,
        songMid: d.songmid || track.songMid,
        audioUrl: best.url || track.audioUrl,
        lrc: d["\u6B4C\u8BCD\u5185\u5BB9"] || track.lrc || null,
        lrcUrl: null,
        jooxQualityText: best.text || track.jooxQualityText || null,
        detailsLoaded: true
      });
      if (best.tag && best.label) {
        track.quality = best.tag;
        track.qualityLabel = best.label;
      }
    } catch (e) {
      console.error("joox detail error:", e);
    }
    return track;
  }

  // src/api/soundcloud.js
  var SC_PROXY = "http://localhost:8765";
  var scProxyAvailable = null;
  async function checkScProxy() {
    if (scProxyAvailable !== null) return scProxyAvailable;
    try {
      const r = await fetch(`${SC_PROXY}/sc-client-id`, { signal: AbortSignal.timeout(3e3) });
      scProxyAvailable = r.ok;
    } catch (e) {
      scProxyAvailable = false;
    }
    return scProxyAvailable;
  }
  async function scFetchJson(url, timeout = 1e4) {
    if (await checkScProxy()) {
      const r2 = await fetch(`${SC_PROXY}/proxy?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(timeout) });
      if (!r2.ok) throw new Error(`proxy ${r2.status}`);
      return r2.json();
    }
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (!r.ok) throw new Error(`direct ${r.status}`);
    return r.json();
  }
  var scClientId = null;
  async function scrapeClientIdFromPage() {
    try {
      const html = await (await fetch("https://soundcloud.com", {
        signal: AbortSignal.timeout(1e4)
      })).text();
      const m = html.match(/"([A-Za-z0-9]{32})"/);
      if (m) return m[1];
    } catch (e) {
    }
    return null;
  }
  var SC_FALLBACK_IDS = [
    "O7atZypwLvuWSY9hWnnQ3vrLTHH7wqMe"
    // 2025-07 从 soundcloud.com 提取
  ];
  async function getSCClientId() {
    if (scClientId) return scClientId;
    if (await checkScProxy()) {
      try {
        const r = await fetch(`${SC_PROXY}/sc-client-id`, { signal: AbortSignal.timeout(5e3) });
        const j = await r.json();
        if (j.client_id) {
          scClientId = j.client_id;
          return scClientId;
        }
      } catch (e) {
      }
    }
    const scraped = await scrapeClientIdFromPage();
    if (scraped) {
      try {
        const r = await fetch(
          `https://api-v2.soundcloud.com/tracks/1?client_id=${scraped}`,
          { signal: AbortSignal.timeout(5e3) }
        );
        if (r.ok) {
          scClientId = scraped;
          return scClientId;
        }
      } catch (e) {
      }
    }
    for (const id of SC_FALLBACK_IDS) {
      try {
        const r = await fetch(
          `https://api-v2.soundcloud.com/tracks/1?client_id=${id}`,
          { signal: AbortSignal.timeout(5e3) }
        );
        if (r.ok) {
          scClientId = id;
          return scClientId;
        }
      } catch (e) {
      }
    }
    scClientId = SC_FALLBACK_IDS[0];
    return scClientId;
  }
  async function searchSoundCloud(kw, limit) {
    const cid = await getSCClientId();
    const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(kw)}&client_id=${cid}&limit=${limit}&linked_partitioning=1`;
    const results = [];
    try {
      const json = await scFetchJson(url);
      const tracks = json.collection || [];
      tracks.forEach((it, idx) => {
        const username = it.user?.username || "Unknown";
        results.push({
          uid: `sc-${it.id}`,
          source: "soundcloud",
          di: idx + 1,
          kw,
          songid: it.id,
          title: it.title || "",
          artist: username,
          album: "",
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
          scGenre: it.genre || "",
          scPermalink: it.permalink_url || "",
          scPlayCount: it.playback_count || 0
        });
      });
    } catch (e) {
      console.error("soundcloud search:", e);
    }
    return results;
  }
  async function fetchSoundCloudDetails(t) {
    try {
      const cid = await getSCClientId();
      const useProxy = await checkScProxy();
      let transcodings = t.scTranscodings || null;
      if (!transcodings) {
        const d = await scFetchJson(`https://api-v2.soundcloud.com/tracks/${t.songid}?client_id=${cid}`);
        transcodings = d.media?.transcodings || [];
        t.cover = d.artwork_url || d.user?.avatar_url || t.cover;
        t.title = d.title || t.title;
        t.artist = d.user?.username || t.artist;
      }
      if (transcodings && transcodings.length > 0) {
        const scored = transcodings.map((tr) => {
          let score = 0;
          const proto = tr.format?.protocol || "";
          const mime = tr.format?.mime_type || "";
          if (proto === "hls" && mime.includes("mp4")) score += 100;
          if (proto === "progressive" && mime.includes("mpeg")) score += 60;
          if (proto === "hls" && !mime.includes("mp4")) score += 40;
          if (tr.preset?.includes("160")) score += 10;
          if (tr.preset?.includes("sq")) score += 5;
          return { ...tr, score };
        });
        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];
        const isHLS = best.format?.protocol === "hls";
        const mediaUrl = `${best.url}?client_id=${cid}`;
        try {
          const resolved = await scFetchJson(mediaUrl);
          if (resolved.url) {
            if (isHLS) {
              t.audioUrl = resolved.url;
              t.scIsHLS = true;
            } else {
              t.audioUrl = useProxy ? `${SC_PROXY}/stream?url=${encodeURIComponent(resolved.url)}` : resolved.url;
              t.scIsHLS = false;
            }
          }
        } catch (e) {
          console.error("soundcloud media resolve:", e);
          t.audioUrl = mediaUrl;
          t.scIsHLS = isHLS;
        }
        if (t.audioUrl && best.preset) {
          const m = best.preset.match(/(\d+)/);
          t.quality = m ? m[1] + "k" : "128k";
          t.qualityLabel = best.preset.replace(/_/g, " ").toUpperCase();
        }
      }
      if (!t.audioUrl && t.scStreamUrl) {
        t.audioUrl = `${t.scStreamUrl}?client_id=${cid}`;
      }
      if (t.audioUrl && !t.quality) {
        t.quality = "128k";
        t.qualityLabel = "128K";
      }
      t.detailsLoaded = true;
    } catch (e) {
      console.error("soundcloud detail:", e);
    }
    return t;
  }

  // src/api/index.js
  async function searchAll({ keyword, sources = ["netease", "qq", "soundcloud"], limit = 10 } = {}) {
    if (!keyword) throw new Error("keyword is required");
    const tasks = [];
    if (sources.includes("netease")) {
      tasks.push(
        searchNetease(keyword, 1, limit).then((tracks) => ({ source: "netease", tracks }))
      );
    }
    if (sources.includes("qq")) {
      tasks.push(
        searchQQ(keyword, limit).then((tracks) => ({ source: "qq", tracks }))
      );
    }
    if (sources.includes("joox")) {
      tasks.push(
        searchJoox(keyword, limit).then((tracks) => ({ source: "joox", tracks }))
      );
    }
    if (sources.includes("soundcloud")) {
      tasks.push(
        searchSoundCloud(keyword, limit).then((tracks) => ({ source: "soundcloud", tracks }))
      );
    }
    const results = await Promise.all(tasks);
    const grouped = {};
    const order = [];
    for (const r of results) {
      grouped[r.source] = r.tracks;
      order.push(r.source);
    }
    return interleave(grouped, order);
  }
  function interleave(grouped, order) {
    const idx = {};
    for (const s of order) idx[s] = 0;
    const out = [];
    let added = true;
    while (added) {
      added = false;
      for (const s of order) {
        const arr = grouped[s];
        const i = idx[s];
        if (arr && i < arr.length) {
          out.push(arr[i]);
          idx[s]++;
          added = true;
        }
      }
    }
    return out;
  }
  async function ensureTrackDetails(track) {
    if (track.detailsLoaded && track.audioUrl && (track.lrc || !track.lrcUrl)) {
      return track;
    }
    switch (track.source) {
      case "netease":
        return fetchNeteaseDetails(track);
      case "qq":
        return fetchQQDetails(track);
      case "joox":
        return fetchJooxDetails(track);
      case "soundcloud":
        return fetchSoundCloudDetails(track);
      default:
        return track;
    }
  }
  return __toCommonJS(index_exports);
})();

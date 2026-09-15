/**
 * 聚合跨平台音乐搜索
 * 并行调用网易云 / QQ，按源交错排列结果
 * SoundCloud 不在默认源里（已从搜索下掉，见 searchAll 注释），但显式点名仍能搜
 */

import { searchNetease, fetchNeteaseDetails, fetchNeteasePlaylist, resolveNeteaseShortLink } from './netease.js';
import { searchQQ, fetchQQDetails } from './qq.js';
import { searchSoundCloud, fetchSoundCloudDetails } from './soundcloud.js';

/**
 * 聚合搜索（多源并行）
 * @param {object} options
 * @param {string} options.keyword - 搜索关键词
 * @param {string[]} [options.sources=['netease','qq']] - 启用的音乐源。
 *   'soundcloud' 已从默认值里去掉（这个源反复修不好：client_id 失效 / HLS 流打不开），
 *   下面识别它的分支没删，显式传 sources: ['soundcloud'] 仍然会去搜，方便以后手动排查。
 *   播放器页面另有一份 SEARCH_SOURCES（examples/Listening Player.dc.html）控制筛选芯片
 * @param {number} [options.limit=10] - 每源取多少首
 * @returns {Promise<Array>} 按源交错排列的 track 数组
 */
export async function searchAll({ keyword, sources = ['netease', 'qq'], limit = 10 } = {}) {
  if (!keyword) throw new Error('keyword is required');

  const tasks = [];

  // 网易云
  if (sources.includes('netease')) {
    tasks.push(
      searchNetease(keyword, 1, limit).then(tracks => ({ source: 'netease', tracks }))
    );
  }
  // QQ
  if (sources.includes('qq')) {
    tasks.push(
      searchQQ(keyword, limit).then(tracks => ({ source: 'qq', tracks }))
    );
  }
  // SoundCloud：不在默认源里，只有调用方显式点名才走到这里
  if (sources.includes('soundcloud')) {
    tasks.push(
      searchSoundCloud(keyword, limit).then(tracks => ({ source: 'soundcloud', tracks }))
    );
  }

  const results = await Promise.all(tasks);

  // 按优先级顺序交错排列
  const grouped = {};
  const order = [];
  for (const r of results) {
    grouped[r.source] = r.tracks;
    order.push(r.source);
  }

  return interleave(grouped, order);
}

/**
 * 按源交错排列结果（保持各源内部顺序）
 * 如 [netease1, qq1, soundcloud1, netease2, qq2, soundcloud2, ...]
 */
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

/**
 * 给指定的 track 加载详情（播放链接 + 歌词）
 * @param {object} track
 * @returns {Promise<object>} 更新后的 track
 */
export async function ensureTrackDetails(track) {
  if (track.detailsLoaded && track.audioUrl && (track.lrc || !track.lrcUrl)) {
    return track;
  }

  switch (track.source) {
    case 'netease':
      return fetchNeteaseDetails(track);
    case 'qq':
      return fetchQQDetails(track);
    case 'soundcloud':
      return fetchSoundCloudDetails(track);
    default:
      return track;
  }
}

/**
 * 检出所有 API 源
 */
export { searchNetease, fetchNeteaseDetails, fetchNeteasePlaylist, resolveNeteaseShortLink } from './netease.js';
export { searchQQ, fetchQQDetails } from './qq.js';
export { searchSoundCloud, fetchSoundCloudDetails, resolveSoundCloudCacheUrl } from './soundcloud.js';
export { officialSongUrl, shareText } from './share.js';

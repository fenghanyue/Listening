/**
 * 聚合跨平台音乐搜索
 * 并行调用网易云 / QQ / 酷我 / JOOX，按源交错排列结果
 */

import { searchNetease, fetchNeteaseDetails } from './netease.js';
import { searchQQ, fetchQQDetails } from './qq.js';
import { searchKuwo, fetchKuwoDetails } from './kuwo.js';
import { searchJoox, fetchJooxDetails } from './joox.js';
import { searchSoundCloud, fetchSoundCloudDetails } from './soundcloud.js';

/**
 * 聚合搜索（多源并行）
 * @param {object} options
 * @param {string} options.keyword - 搜索关键词
 * @param {string[]} [options.sources=['netease','qq','kuwo']] - 启用的音乐源
 * @param {number} [options.limit=10] - 每源取多少首
 * @returns {Promise<Array>} 按源交错排列的 track 数组
 */
export async function searchAll({ keyword, sources = ['netease', 'qq', 'kuwo'], limit = 10 } = {}) {
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
  // 酷我
  if (sources.includes('kuwo')) {
    tasks.push(
      searchKuwo(keyword, limit).then(tracks => ({ source: 'kuwo', tracks }))
    );
  }
  // JOOX
  if (sources.includes('joox')) {
    tasks.push(
      searchJoox(keyword, limit).then(tracks => ({ source: 'joox', tracks }))
    );
  }
  // SoundCloud
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
 * 如 [netease1, qq1, kuwo1, netease2, qq2, kuwo2, ...]
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
    case 'kuwo':
      return fetchKuwoDetails(track);
    case 'joox':
      return fetchJooxDetails(track);
    case 'soundcloud':
      return fetchSoundCloudDetails(track);
    default:
      return track;
  }
}

/**
 * 检出所有 API 源
 */
export { searchNetease, fetchNeteaseDetails } from './netease.js';
export { searchQQ, fetchQQDetails } from './qq.js';
export { searchKuwo, fetchKuwoDetails } from './kuwo.js';
export { searchJoox, fetchJooxDetails } from './joox.js';
export { searchSoundCloud, fetchSoundCloudDetails } from './soundcloud.js';

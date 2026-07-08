/**
 * Node.js 调用示例
 * 需要在浏览器环境运行（ES Module + fetch），或使用 node --experimental-vm-modules
 *
 * 运行: node examples/node-demo.mjs
 * 注意: 需要 Node 18+ (原生 fetch 支持)
 */

import { searchAll, ensureTrackDetails } from '../src/api/index.js';

async function main() {
  const keyword = process.argv[2] || '周杰伦';

  console.log(`搜索: "${keyword}"\n`);

  const results = await searchAll({
    keyword,
    sources: ['netease', 'qq', 'soundcloud'],
    limit: 3,
  });

  console.log(`找到 ${results.length} 首:\n`);

  for (const [i, track] of results.entries()) {
    console.log(`${i + 1}. [${track.source}] ${track.title} — ${track.artist}`);
    console.log(`   uid: ${track.uid}`);
    if (track.cover) console.log(`   cover: ${track.cover}`);
  }

  // 取第一首拿详情
  if (results.length) {
    const first = results[0];
    console.log(`\n加载第一首详情: ${first.title}...`);
    await ensureTrackDetails(first);
    console.log(`   audioUrl: ${first.audioUrl}`);
    console.log(`   quality:  ${first.qualityLabel}`);
    console.log(`   lrc:      ${first.lrc ? first.lrc.substring(0, 80) + '...' : '(none)'}`);
  }
}

main().catch(console.error);

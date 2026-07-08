# Listening

跨平台音乐搜索 & 播放 API 层，从 [MusicSquare](https://github.com/CharlesPikachu/musicsquare) 提取核心功能模块化。

## 目录结构

```
Listening/
├── src/
│   └── api/
│       ├── index.js      # 聚合入口：searchAll / ensureTrackDetails
│       ├── netease.js    # 网易云音乐 (qijieya meting)
│       ├── qq.js         # QQ音乐 (tang api)
│       ├── soundcloud.js # SoundCloud (api-v2，浏览器端需配合 proxy-server.mjs)
│       └── utils.js      # LRC 解析
├── examples/
│   ├── browser-demo.html # 浏览器 Demo（可直接打开）
│   └── node-demo.mjs     # Node.js 示例（需要 Node 18+）
└── README.md
```

## 使用方式

### 聚合搜索（推荐）

```js
import { searchAll, ensureTrackDetails } from './src/api/index.js';
import { parseLRC } from './src/api/utils.js';

// 搜索
const tracks = await searchAll({
  keyword: '周杰伦',
  sources: ['netease', 'qq', 'soundcloud'],
  limit: 10,
});
// 返回按源交错排列的 track 数组

// 加载播放详情
const track = tracks[0];
await ensureTrackDetails(track);
console.log(track.audioUrl);  // 直链
console.log(track.qualityLabel); // LOSSLESS / 320K
console.log(track.lrc);       // 歌词原文

// 解析歌词
const lrcLines = parseLRC(track.lrc);
// [{time: 1.5, text: '...'}, ...]
```

### 单源搜索

```js
import { searchNetease, fetchNeteaseDetails } from './src/api/netease.js';
import { searchQQ, fetchQQDetails } from './src/api/qq.js';
import { searchSoundCloud, fetchSoundCloudDetails } from './src/api/soundcloud.js';

const tracks = await searchNetease('关键词', 1, 10);
await fetchNeteaseDetails(tracks[0]);
```

### track 对象结构

```js
{
  uid: 'netease-123456',      // 全局唯一标识
  source: 'netease',           // netease | qq | soundcloud
  // 基础信息
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  cover: 'https://...',        // 封面图 URL (可为 null)
  // 播放信息（需要 ensureTrackDetails 后才有）
  audioUrl: 'https://...',     // 直链
  lrc: '[00:01.00]...',       // LRC 原文
  quality: 'lossless',         // lossless | 320k | 128k
  qualityLabel: 'LOSSLESS',    // LOSSLESS | 320K | 128K
  detailsLoaded: true,         // 详情是否已加载
}
```

## 第三方 API 源

| 平台 | 搜索/详情 | 域名 |
|------|-----------|------|
| 网易云 | meting proxy | api.qijieya.cn |
| QQ音乐 | tang proxy | tang.api.s01s.cn |
| SoundCloud | api-v2（浏览器端需走本地 `proxy-server.mjs` :8765 代理，见下方限制说明） | api-v2.soundcloud.com |

> ⚠️ 以上均为第三方反向代理，非官方 API，不可控且无版权授权。仅供学习参考。

## 依赖

零外部依赖，仅需 `fetch`（浏览器原生 / Node 18+）。

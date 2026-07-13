<div align="center">

<img src="examples/icons/icon-192.png" width="96" height="96" alt="Listening icon" />

# Listening

**网易云音乐 · QQ音乐 · SoundCloud 聚合播放器**

跨平台聚合搜索 · 歌单管理 · 离线缓存 · 可安装为 PWA，单文件 Node 服务一键部署

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-blue)](package.json)
[![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa&logoColor=white)](examples/manifest.json)
[![Learning Use Only](https://img.shields.io/badge/用途-仅供学习交流-red)](#)

[在线体验](https://listening-5bnv.onrender.com) · [快速开始](#快速开始) · [部署](#部署) · [功能](#功能)

</div>

---

> ⚠️ **本项目仅供学习交流使用，请勿用于任何商业用途。**

**Listening** 是一个把网易云音乐、QQ音乐、SoundCloud 三个源聚合到一起搜索和播放的音乐播放器。前端页面和 CORS 代理被合并成了一个 Node 进程，没有任何第三方依赖，克隆下来就能跑，也能直接扔到 Render 这类平台上部署成公网可访问的实例。

**在线体验**：[listening-5bnv.onrender.com](https://listening-5bnv.onrender.com)（Render 免费实例，长时间无人访问会休眠，首次打开可能要等几十秒冷启动）

## 目录

- [功能](#功能)
- [快速开始](#快速开始)
- [部署](#部署)
- [目录结构](#目录结构)
- [单独使用搜索 / 播放 API](#单独使用搜索--播放-api)
- [第三方 API 源](#第三方-api-源)
- [开发相关](#开发相关)

## 功能

| | |
|---|---|
| 🔍 **聚合搜索** | 网易云音乐 / QQ音乐 / SoundCloud 并行搜索，按源交错排列结果，可单独勾选/取消某个源 |
| ▶️ **播放** | 进度条、音量、三种播放模式（列表循环 / 随机 / 单曲循环）、歌词滚动 |
| 🗂️ **歌单管理** | 新建歌单、加入/移出歌单、拖拽调整播放队列顺序 |
| 📥 **网易云歌单导入** | 粘贴分享链接（整段分享文本也行）一键导入整份歌单，可选导入到新建歌单或直接并入「喜欢的音乐」 |
| 🔀 **播放队列** | 和曲库解耦——"播放全部"会整个替换当前播放队列，点单曲播放则是插队到队列最前面，互不干扰 |
| 💾 **本地持久化** | 歌单、喜欢的音乐、播放队列、播放进度都存在浏览器 `localStorage`，刷新或关闭重开都还在；首次访问是干净的空状态，不会看到别人的示例数据 |
| 📦 **离线缓存** | 播放过的歌曲（IndexedDB）和封面图片（Service Worker）缓存在浏览器本地，重复播放/查看不用再联网 |
| 📱 **PWA** | 可安装到桌面/主屏幕，离线也能打开壳页面 |
| 🌗 **主题** | 深色 / 浅色一键切换 |

## 快速开始

```bash
npm start   # 等价于 node server.mjs，默认监听 :4444
```

打开 `http://localhost:4444` 即可使用。零外部依赖，只需要 Node 18+（原生 `fetch`）。

## 部署

[server.mjs](server.mjs) 把静态页面和 CORS 代理合并成了一个单进程服务，可以直接部署到 Render 之类支持 Node 的平台：

- Build Command 留空（或 `npm install`，项目零依赖）
- Start Command：`npm start`
- Render 会自动注入 `PORT` 环境变量，`server.mjs` 会读取它监听对应端口

<details>
<summary>防止免费实例休眠</summary>

Render 免费层闲置约 15 分钟会自动休眠，下次请求要冷启动（几秒到几十秒不等）。项目内置两层保活，互相兜底：

- **进程内自 ping**（[server.mjs](server.mjs)）：服务启动后每 10 分钟请求一次自己的公网地址（`RENDER_EXTERNAL_URL`，Render 自动注入），能防止睡着，但真睡着了没法叫醒自己
- **GitHub Actions 外部 ping**（[.github/workflows/keep-alive.yml](.github/workflows/keep-alive.yml)）：每 10 分钟从 GitHub 侧主动请求一次，即使进程已经休眠也能把它唤醒

</details>

## 目录结构

```
Listening/
├── server.mjs                      # 一体化服务：静态页面 + CORS 代理，本机和线上都跑这一个文件
├── src/api/                        # 可独立使用的搜索/播放 API 层
│   ├── index.js                    # 聚合入口：searchAll / ensureTrackDetails
│   ├── netease.js                  # 网易云音乐（qijieya meting 代理），含单曲搜索和歌单拉取
│   ├── qq.js                       # QQ音乐（tang api 代理）
│   ├── soundcloud.js               # SoundCloud（api-v2，需配合 server.mjs 代理）
│   └── utils.js                    # LRC 歌词解析
├── examples/
│   ├── Listening Player.dc.html    # 播放器主应用（唯一的生产页面，根路径 / 直接返回它）
│   ├── api-bundle.js               # src/api 用 esbuild 打包成的浏览器端产物
│   ├── manifest.json               # PWA manifest
│   ├── icons/                      # PWA 图标
│   ├── sw.js                       # Service Worker，封面图片本地缓存
│   ├── support.js                  # 页面模板渲染的支持代码
│   ├── browser-demo.html           # API 层的浏览器端最小示例（不含播放器 UI）
│   ├── node-demo.mjs               # API 层的 Node 端最小示例
│   └── search-test.html            # 手动测试用页面
├── .github/workflows/keep-alive.yml
└── DEBUG.md                        # 开发过程中的排查记录，供追溯细节
```

## 单独使用搜索 / 播放 API

`src/api/` 这一层不依赖播放器 UI，可以单独拿来用。

### 聚合搜索

```js
import { searchAll, ensureTrackDetails } from './src/api/index.js';

const tracks = await searchAll({
  keyword: '周杰伦',
  sources: ['netease', 'qq', 'soundcloud'],
  limit: 10,
});
// 返回按源交错排列的 track 数组

const track = tracks[0];
await ensureTrackDetails(track);
console.log(track.audioUrl);     // 直链
console.log(track.qualityLabel); // LOSSLESS / 320K
console.log(track.lrc);          // 歌词原文

import { parseLRC } from './src/api/utils.js';
const lrcLines = parseLRC(track.lrc);
// [{ time: 1.5, text: '...' }, ...]
```

### 单源搜索 / 网易云歌单

```js
import { searchNetease, fetchNeteaseDetails, fetchNeteasePlaylist } from './src/api/netease.js';
import { searchQQ, fetchQQDetails } from './src/api/qq.js';
import { searchSoundCloud, fetchSoundCloudDetails } from './src/api/soundcloud.js';

const tracks = await searchNetease('关键词', 1, 10);
await fetchNeteaseDetails(tracks[0]);

const playlistTracks = await fetchNeteasePlaylist('36420739'); // 歌单分享链接里的数字 id
```

### track 对象结构

```js
{
  uid: 'netease-123456',      // 全局唯一标识
  source: 'netease',          // netease | qq | soundcloud
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  cover: 'https://...',       // 封面图 URL（可能为 null）
  audioUrl: 'https://...',    // 直链，ensureTrackDetails 后才有
  lrc: '[00:01.00]...',       // LRC 原文
  quality: 'lossless',        // lossless | 320k | 128k
  qualityLabel: 'LOSSLESS',
  detailsLoaded: true,
}
```

## 第三方 API 源

| 平台 | 搜索/详情 | 域名 |
|------|-----------|------|
| 网易云 | meting 代理 | api.qijieya.cn |
| QQ音乐 | tang 代理 | tang.api.s01s.cn |
| SoundCloud | api-v2（浏览器端需经 `server.mjs` 的 `/proxy` `/stream` `/sc-client-id` 转发，否则会被 CORS 拦截） | api-v2.soundcloud.com |

## 开发相关

- 改了 `src/api/*` 之后记得跑 `npm run build` 重新生成 `examples/api-bundle.js`——浏览器端用的是这个打包产物，不是 ES module 源码，源码改了不重新构建不会生效
- 更详细的实现背景和历史排查记录见 [DEBUG.md](DEBUG.md)

---

<div align="center">

本项目仅供学习交流，音频版权归原平台及版权方所有

</div>

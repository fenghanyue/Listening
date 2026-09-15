<div align="center">

<img src="examples/icons/icon-192.png" width="96" height="96" alt="Listening icon" />

# Listening

**网易云音乐 · QQ音乐聚合播放器**

跨平台聚合搜索 · 歌单管理 · 离线缓存 · 可安装为 PWA，单文件 Node 服务一键部署

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-blue)](package.json)
[![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa&logoColor=white)](examples/manifest.json)
[![Learning Use Only](https://img.shields.io/badge/用途-仅供学习交流-red)](#)

[在线体验](https://listening-5bnv.onrender.com) · [快速开始](#快速开始) · [部署](#部署) · [功能](#功能)

</div>

---

> ⚠️ **本项目仅供学习交流使用，请勿用于任何商业用途。**

**Listening** 是一个把网易云音乐、QQ音乐聚合到一起搜索和播放的音乐播放器。前端页面和 CORS 代理被合并成了一个 Node 进程，没有任何第三方依赖，克隆下来就能跑，也能直接扔到 Render 这类平台上部署成公网可访问的实例。

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
| 🔍 **聚合搜索** | 网易云音乐 / QQ音乐并行搜索，按源交错排列结果，可单独勾选/取消某个源。SoundCloud 已从搜索下掉，见[下方说明](#soundcloud-已从搜索下掉) |
| ▶️ **播放** | 进度条、音量、三种播放模式（列表循环 / 随机 / 单曲循环）、歌词滚动 |
| 🗂️ **歌单管理** | 新建歌单、加入/移出歌单、拖拽调整播放队列顺序 |
| 📥 **歌单导入 / 导出** | 网易云分享链接一键导入整份歌单（整段分享文本也行），可选导入到新建歌单或直接并入「喜欢的音乐」；歌单也能导出成一段字符串，粘贴回去即可原样恢复，方便备份/分享（覆盖式：同名歌单直接替换，留空则整体替换「喜欢的音乐」）。**不支持 QQ 音乐歌单链接导入**，目前没有计划支持 |
| 🔗 **分享单曲** | 「正在播放」页右上角一键分享，产出一段纯文本：歌名 + 艺术家（+ 专辑）+ 这首歌在**官方平台**的页面链接，复制或走系统分享面板发给微信 / QQ 的朋友。刻意不分享本站链接——本站跑在免费层会休眠、域名也可能被 IM 拦，而官方链接朋友必然点得开、还能唤起对方的音乐 App。支持 `navigator.share` 的浏览器会多一个「分享到…」按钮，不支持的（桌面端、微信内置浏览器）只显示「复制」 |
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
│   ├── soundcloud.js               # SoundCloud（api-v2，需配合 server.mjs 代理）——已从搜索下掉，代码保留
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
├── docs/
│   └── mobile-status-bar.md        # 手机端状态栏能做什么/不能做什么（含两条已验证走不通的路）
└── .github/workflows/keep-alive.yml
```

## 单独使用搜索 / 播放 API

`src/api/` 这一层不依赖播放器 UI，可以单独拿来用。

### 聚合搜索

```js
import { searchAll, ensureTrackDetails } from './src/api/index.js';

const tracks = await searchAll({
  keyword: '周杰伦',
  sources: ['netease', 'qq'],   // 默认值就是这两个；想试 SoundCloud 得自己把 'soundcloud' 加进来
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

### 分享链接

`officialSongUrl(track)` 按音源拼出歌曲在官方平台的页面地址，`shareText(track)` 在此基础上组装成可直接粘贴到 IM 的纯文本。

| 音源 | 链接来源 |
|---|---|
| 网易云 | `https://music.163.com/m/song?id={songid}`。**只认纯数字 `songid`** ——`mapMetingItem` 在 meting 返回的 url 里取不到 id 时会 fallback 成 `${keyword}-${idx+1}` 这种占位值，拼进 URL 就是坏链接，所以这种情况直接返回 `null` |
| QQ音乐 | 优先用 `track.pageUrl`（接口的 `song_h5_url`，本身就是 h5 分享链接，拉过详情才有）；没有则用 `song_mid` 拼 `https://y.qq.com/n/ryqq/songDetail/{mid}` |
| SoundCloud | `track.scPermalink`（API 的 `permalink_url`） |

拿不到可靠链接时返回 `null`，`shareText` 会降级成只给歌曲信息，UI 上也会提示朋友需要自己搜。URL 模板集中在 `src/api/share.js` 顶部，方便调整。

调用 `navigator.share` 时**只传 `text`、不传 `url`**：一旦带上 `url` 字段，iOS 微信会优先把它渲染成链接卡片，就不是纯文本了。

## 第三方 API 源

| 平台 | 搜索/详情 | 域名 |
|------|-----------|------|
| 网易云 | meting 代理 | api.qijieya.cn |
| QQ音乐 | tang 代理 | tang.api.s01s.cn |
| SoundCloud | api-v2（浏览器端需经 `server.mjs` 的 `/proxy` `/stream` `/sc-client-id` 转发，否则会被 CORS 拦截）——**已从搜索下掉**，仅用于老曲目播放和手动排查 | api-v2.soundcloud.com |

### SoundCloud 已从搜索下掉

这个源实际上用不了（`client_id` 反复失效、HLS 流打不开），前后修了好几次都没修好，就不再继续修了。现在的处理是**从搜索侧隐藏，而不是把代码删干净**：

- 搜索筛选芯片里不再出现 SoundCloud，聚合搜索也不再请求它
- **已经在歌单 / 播放队列 / 「喜欢的音乐」里的 SoundCloud 曲目一个都没动**——照旧显示歌名、来源标签和来源色点，想自己删就删、想一直留着也行、点播放也随意（播不了就走现有的播放失败重试逻辑）；歌单导出 / 导入也照旧能原样往返
- 详情拉取、分享链接、离线缓存、`server.mjs` 的三个代理路由全部保留，一行没删

**想恢复的话**，只有两个入口：

| 位置 | 改什么 |
|---|---|
| `SEARCH_SOURCES`（`examples/Listening Player.dc.html`） | 把 `'soundcloud'` 加回这个数组。筛选芯片、`state.sources` 初值、`doSearch` 真正发出去的源三处都从它推导 |
| `searchAll` 的默认 `sources`（`src/api/index.js`） | 同样加回 `'soundcloud'`，然后跑 `npm run build` |

识别 `soundcloud` 的分支和 `searchSoundCloud` 导出都没删，所以**不改代码也能单独试一下它还活不活**：

```js
// 浏览器控制台（页面已加载）
await ListeningAPI.searchAll({ keyword: 'lofi', sources: ['soundcloud'] });
```

`examples/search-test.html` 是不走 `src/api` 的独立手测页，这次没动，正好留着当以后排查 SoundCloud 的探针。

## 开发相关

- 改了 `src/api/*` 之后记得跑 `npm run build` 重新生成 `examples/api-bundle.js`——浏览器端用的是这个打包产物，不是 ES module 源码，源码改了不重新构建不会生效
- 想动手机端状态栏 / 通知栏沉浸之前，**先看 [`docs/mobile-status-bar.md`](docs/mobile-status-bar.md)**——纯 PWA 做不到沉浸，状态栏颜色也不受页面控制，里面记了两条已经真机验证过走不通的路，以及以后真要做时的正确入口

---

<div align="center">

本项目仅供学习交流，音频版权归原平台及版权方所有

</div>

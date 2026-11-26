<div align="center">

<img src="examples/icons/icon-192.png" width="96" height="96" alt="Listening icon" />

# Listening

**网易云音乐 · QQ音乐聚合播放器**

跨平台聚合搜索 · 歌单管理 · 离线缓存 · 安卓 APK / PWA

[![Node.js](https://img.shields.io/badge/Node.js-22%20%2F%2024%20LTS-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Zero npm Runtime Dependencies](https://img.shields.io/badge/npm%20runtime%20dependencies-0-blue)](package.json)
[![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa&logoColor=white)](examples/manifest.json)
[![Learning Use Only](https://img.shields.io/badge/用途-仅供学习交流-red)](#)

[下载 APK](https://github.com/fenghanyue/Listening/releases/latest/download/listening.apk) · [快速开始](#快速开始) · [部署](#部署) · [功能](#功能)

</div>

---

> ⚠️ **本项目仅供学习交流使用，请勿用于任何商业用途。**

**Listening** 是一个聚合网易云音乐和 QQ 音乐的播放器，支持搜索、歌单管理和离线缓存。网页和跨域请求代理由同一个 Node.js 进程提供，安卓 APK 将同一套页面打包到本地。

## 目录

- [功能](#功能)
- [安卓 APK](#安卓-apk)
- [快速开始](#快速开始)
- [部署](#部署)
- [目录结构](#目录结构)
- [单独使用搜索 / 播放 API](#单独使用搜索--播放-api)
- [第三方 API 源](#第三方-api-源)
- [开发相关](#开发相关)

## 功能

| | |
|---|---|
| 🔍 **聚合搜索** | 并行搜索网易云音乐和 QQ 音乐，按音源交错排列结果，可按音源筛选。[SoundCloud 旧曲目兼容说明](#soundcloud-旧曲目) |
| 🎧 **猜你喜欢** | 首页用统一封面网格展示推荐，支持播放全部、换一批、收藏、加歌单和不感兴趣。点搜索框后立即显示音源选择，清空关键词仍停留在搜索状态，取消返回推荐。基础推荐结合收藏、歌单和有效收听；首次使用以公开歌单补充，离线时只选已缓存曲目 |
| ✨ **可选 AI 推荐** | 在设置里自行填写 OpenAI 兼容服务的 HTTPS API 地址、Key 和模型名称。一次生成最多 50 首候选，经现有音乐接口核验后缓存、分批展示；换一批不调用模型。未配置、关闭或请求失败时使用可用的已有或基础推荐。数据发送范围和使用说明见 [docs/recommendations.md](docs/recommendations.md) |
| ▶️ **播放** | 进度条、音量、三种播放模式（列表循环 / 随机 / 单曲循环）、歌词滚动。某首播不了会自动重新要一次链接重试，还不行就跳到下一首（连续 3 首都不行才停下） |
| 🪟 **迷你播放器** | 电脑上的 Chrome / Edge：音量旁边的按钮把播放器弹成一个浮在所有窗口最上面的小窗，一排六个键：换播放模式、上一首、播放、下一首、「播放队列」（箭头向下，在播放器下方展开队列，能上移 / 下移 / 移出）、「回到网页」（切回网页并关掉小窗）。不放歌词，窗口只有 420×100。按住小窗顶上的标题栏拖动，关掉再开还在原处（记到关浏览器为止）。别的浏览器和 APK 里没有，原理和限制见 [`docs/mini-player.md`](docs/mini-player.md) |
| 🗂️ **歌单管理** | 新建歌单、加入/移出歌单、调整播放队列顺序（电脑上拖动，手机上点上移 / 下移） |
| 📥 **歌单导入 / 导出** | 支持网易云歌单分享链接（包括整段分享文本），也可用导出字符串备份或恢复。填写新名称会新建歌单，填写已有名称会替换同名歌单，留空或填写「喜欢的音乐」会整体替换收藏。QQ 音乐歌单链接暂未支持 |
| 🔗 **分享单曲** | 在「正在播放」页打开 ⋮ 菜单，分享歌名、艺人、专辑和可用的官方歌曲页链接。可复制文本，支持系统分享的浏览器和安卓 APK 也可打开分享面板 |
| 🔀 **播放队列** | 和曲库解耦——"播放全部"会整个替换当前播放队列，点单曲播放则是插队到队列最前面，互不干扰。队列里点 × 只是移出队列，歌单和「喜欢的音乐」里的歌都还在；移出正在放的那首会换到下一首 |
| 💾 **本地持久化** | 歌单、喜欢的音乐、播放队列、播放进度都存在浏览器 `localStorage`，刷新或关闭重开都还在；网页版和 APK 分别保存自己的数据 |
| 📦 **离线缓存** | 播放过的歌曲（IndexedDB）和封面图片缓存在本地，重复播放/查看不用再联网。「歌单」页的「已缓存」列出全部能离线放的歌；断网时（或打开「只播已缓存」）切歌、随机、播放全部都只挑已缓存的，没缓存的变灰，搜索改搜本地曲库；歌单页「缓存全部」可以提前整单下载；缓存上限在「设置」页里调（网页版默认 300MB，APK 默认 2GB） |
| 🤖 **安卓 APK** | 断网也能打开、沉浸式状态栏、通知栏/锁屏控制、桌面挂件、锁屏后连续播放、返回键不停歌、拔耳机自动暂停、App 内检查更新，见[下方](#安卓-apk) |
| 📱 **PWA** | 可安装到桌面或主屏幕。网页打开后可以播放已缓存的歌曲。需要在断网时从头打开播放器，可使用安卓 APK |
| 🌐 **中文 / English** | 「设置」→「语言」切换，界面上的字、弹出的提示、迷你播放器、桌面挂件、分享出去那段文字里固定的字都跟着换；歌名、歌手、歌词和自己起的歌单名原样不动。默认中文，选了会记住。英文系统的手机上 App 叫 Listening |
| 🎨 **界面** | 瑞士风格：网格对齐、无衬线大字、黑白加一个红，不用圆角 / 阴影 / 渐变。西文和数字用 TeX Gyre Heros（Helvetica 的开源复刻，跟页面一起打包），中文用手机自带的字体。顶栏三个图标切换「搜索 / 歌单 / 设置」；手机底部是迷你播放条，点开是全屏播放页（封面 / 歌词 / 队列）；平板和电脑是两栏（当前页 \| 正在播放），视口宽至少 1600 px 且高至少 560 px 时是三栏（当前页 \| 正在播放 \| 歌词）。白底 / 黑底两套，默认白底，在「设置」里切 |

## 安卓 APK

[下载最新正式版 APK](https://github.com/fenghanyue/Listening/releases/latest/download/listening.apk)

用 [Capacitor](https://capacitorjs.com) 把同一个页面打包成 APK（工程在 [`mobile/`](mobile)），[Android APK 工作流](.github/workflows/android.yml) 在 main 分支收到网页、API、安卓工程或工作流的改动后构建，配置签名后发布正式版。
APK 支持断网打开、沉浸式状态栏（图标深浅跟
App 主题走）、通知栏 / 锁屏 / 蓝牙耳机控制、桌面 2×2 挂件（播放模式、上一首、下一首、播放）、锁屏后靠前台服务
连续自动播放、返回手势退到后台不停歌、拔耳机自动暂停、启动时提示新版本、单曲导出 / 分享走系统分享面板。
车载蓝牙进度会定期校准；「设置 → 车载蓝牙」还可开启逐句歌词（默认关闭，通知栏和锁屏标题也会显示歌词，效果取决于车机支持）。

- 用同一签名的新版覆盖安装可以保留歌单和缓存。卸载会清空 App 数据
- 网页版的数据不会自动带过去：歌单用「导出歌单」→ APK 里「导入」搬，缓存的歌在 APK 里重新缓存
- 网页版和 APK 的关系、安装、离线用法、国产机后台设置、签名配置、原理取舍都在 [`docs/android-app.md`](docs/android-app.md)

## 快速开始

```bash
npm start   # 等价于 node server.mjs，默认监听 :4444
```

建议使用 Node.js 22 或 24 LTS。克隆仓库后在根目录运行上述命令，再打开 <http://localhost:4444>。启动网页服务无需安装 npm 依赖，前端依赖和 API 打包产物已包含在仓库里。

## 部署

[server.mjs](server.mjs) 提供网页、跨域请求代理和 AI 推荐转发。把仓库部署到支持 Node.js 的环境，在仓库根目录运行 `npm start` 即可。服务读取 `PORT` 环境变量，默认端口为 `4444`。

直接使用仓库中的前端产物即可启动。修改 `src/api/` 后，先运行 `npm run build` 更新浏览器用的 `examples/api-bundle.js`。部署时保留 `examples/` 和 `server/`，它们分别提供页面资源和 AI 推荐转发实现。

## 目录结构

```
Listening/
├── server.mjs                      # 网页服务和跨域请求代理入口
├── server/
│   └── ai-recommendations.mjs      # 网页端 AI 推荐转发
├── src/api/                        # 可独立使用的搜索/播放 API 层
│   ├── index.js                    # 聚合入口：searchAll / ensureTrackDetails
│   ├── netease.js                  # 网易云音乐（qijieya meting 代理），含单曲搜索和歌单拉取
│   ├── qq.js                       # QQ音乐（tang api 代理）
│   ├── soundcloud.js               # SoundCloud 旧曲目兼容
│   ├── share.js                    # 官方歌曲页和分享文本
│   ├── metadata.mjs                # 曲目展示资料加载
│   ├── recommendations.mjs         # 基础推荐和 AI 推荐逻辑
│   └── utils.js                    # LRC 歌词解析
├── examples/
│   ├── Listening Player.dc.html    # 播放器主应用（唯一的生产页面，根路径 / 直接返回它；APK 里也是它）
│   ├── api-bundle.js               # src/api 用 esbuild 打包成的浏览器端产物
│   ├── vendor/                     # React / hls.js / 字体图标的本地副本（不再走 CDN，断网也能起来）
│   ├── manifest.json               # PWA manifest
│   ├── icons/                      # PWA 图标
│   ├── sw.js                       # Service Worker，封面图片本地缓存
│   ├── support.js                  # 页面模板渲染的支持代码
│   ├── browser-demo.html           # API 层的浏览器端最小示例（不含播放器 UI）
│   ├── node-demo.mjs               # API 层的 Node 端最小示例
│   └── search-test.html            # 手动测试用页面
├── mobile/                         # 安卓 APK（Capacitor）：独立的 package.json，根目录仍然零依赖
│   ├── scripts/build-www.mjs       # 把 examples 里的页面拷进 www/，顺带拦截外网脚本/字体
│   ├── capacitor.config.json
│   └── android/                    # 原生工程：MainActivity（沉浸式状态栏）、AppShellPlugin（耳机/后台/开链接）
├── scripts/
│   └── vendor-assets.mjs           # 下载并校验 examples/vendor/ 里的依赖
├── docs/                           # 安卓 APK、迷你播放器、状态栏和推荐说明
└── tests/                          # 自动测试
```

## 单独使用搜索 / 播放 API

`src/api/` 可独立于播放器 UI 使用。Node.js 示例见 [`examples/node-demo.mjs`](examples/node-demo.mjs)。

### 聚合搜索

```js
import { searchAll, ensureTrackDetails } from './src/api/index.js';
import { parseLRC } from './src/api/utils.js';

const tracks = await searchAll({
  keyword: '周杰伦',
  sources: ['netease', 'qq'],   // 默认音源
  limit: 10,
});
// 返回按源交错排列的 track 数组

if (tracks.length) {
  const track = await ensureTrackDetails(tracks[0]);
  console.log(track.audioUrl);     // 可用时返回播放地址
  console.log(track.qualityLabel); // 如 LOSSLESS、HQ 或 320K
  console.log(parseLRC(track.lrc)); // [{ time: 1.5, text: '...' }, ...]
}
```

### 单源搜索 / 网易云歌单

```js
import { searchNetease, fetchNeteaseDetails, fetchNeteasePlaylist } from './src/api/netease.js';
import { searchQQ, fetchQQDetails } from './src/api/qq.js';

const tracks = await searchNetease('关键词', 1, 10);
if (tracks.length) await fetchNeteaseDetails(tracks[0]);

const playlistTracks = await fetchNeteasePlaylist('36420739'); // 歌单分享链接里的数字 id
```

### track 对象结构

```js
const track = {
  uid: 'netease-123456',      // 全局唯一标识
  source: 'netease',          // netease | qq | soundcloud
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  cover: 'https://...',       // 封面图 URL（可能为 null）
  audioUrl: 'https://...',    // 直链，ensureTrackDetails 后才有
  lrc: '[00:01.00]...',       // LRC 原文
  quality: 'lossless',        // 音质标记，取值随音源而异
  qualityLabel: 'LOSSLESS',
  detailsLoaded: true,
};
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
| SoundCloud | api-v2（浏览器端需经 `server.mjs` 的 `/proxy` `/stream` `/sc-client-id` 转发，否则会被 CORS 拦截）。主要用于旧曲目兼容 | api-v2.soundcloud.com |

### SoundCloud 旧曲目

播放器搜索和 `searchAll` 的默认音源为网易云音乐和 QQ 音乐。旧歌单、收藏和队列里的 SoundCloud 曲目仍可显示、导入和导出，有缓存时可以离线播放。在线播放取决于当时可用的上游接口和音频流。

在已打开播放器的浏览器控制台中，可显式指定 SoundCloud 排查接口。

```js
await ListeningAPI.searchAll({ keyword: 'lofi', sources: ['soundcloud'] });
```

## 开发相关

- 使用 `npm test` 运行自动测试。Playwright 安装方法和用例说明见 [自动测试](tests/README.md)。
- 改了 `src/api/*` 之后记得跑 `npm run build` 重新生成 `examples/api-bundle.js`——浏览器端用的是这个打包产物，不是 ES module 源码，源码改了不重新构建不会生效
- 推荐逻辑在 `src/api/recommendations.mjs`，网页端 AI 转发在 `server/ai-recommendations.mjs`；后者需要随 `server.mjs` 一起部署。APK 使用现有原生 HTTP 直接调用用户配置的模型服务。推荐缓存、收听统计和 AI 配置独立存储，不改变已有歌单格式。
- QQ 推荐、搜索和曲目列表会按显示需要补封面/专辑，查询队列在 `src/api/metadata.mjs`。`fetchQQMetadata(track, {signal})` 只返回展示资料，不修改曲目或下载音频；播放准备使用 `fetchQQDetails`。下一首音频预加载和手动缓存继续保留，详见 [推荐说明](docs/recommendations.md#qq-展示资料)。
- 手机上遇到切歌卡住：打开「设置」页点「复制切歌诊断记录」，把复制出来的文字贴到 issue 里。记录只存在本机 localStorage（最近 200 条），不上传：每次切歌是自动还是手动、音源走的本地缓存 / 已有链接 / 现场要链接、隔多久出声、播放失败后是重试 / 跳过 / 停止、12 秒看门狗实际晚了多少（晚很多说明页面在后台被系统冻住了）、前后台切换、页面冻结 / 恢复、网络断开 / 恢复
- 想动手机端状态栏 / 通知栏沉浸之前，**先看 [`docs/mobile-status-bar.md`](docs/mobile-status-bar.md)**——纯 PWA 做不到沉浸，状态栏颜色也不受页面控制，里面记了两条已经真机验证过走不通的路，以及 APK 里是怎么做到的
- 页面别再引用外网的脚本 / 样式 / 字体：放进 `examples/vendor/`（`node scripts/vendor-assets.mjs` 负责下载和校验）。APK 打包时 `mobile/scripts/build-www.mjs` 发现外链会直接报错，不然 APK 断网就是白屏
- 改了页面或 `src/api` 推到 GitHub，可按上面的工作流条件触发 APK 打包。本机打包见 [`docs/android-app.md`](docs/android-app.md) 第四节
- APK 专属的代码都在页面里 `IS_NATIVE` 的判断后面（原生桥那一节），网页版不受影响
- 界面上的字都在页面的 `STRINGS` 表里，每条是 `[中文, English]` 一对：模板里写 `{{ L.键名 }}`，代码里写 `tr('键名')`。新加的字两种语言都要写，`node tests/i18n.test.mjs` 会查
- 图标是 Material Symbols 字体，只打包页面用到的那些：加新图标先加进 `scripts/vendor-assets.mjs` 的 `ICONS`，再跑 `node scripts/vendor-assets.mjs icons` 重新生成字体，`node tests/run.mjs icons` 会查

---

<div align="center">

本项目仅供学习交流，音频版权归原平台及版权方所有

</div>

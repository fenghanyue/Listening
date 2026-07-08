# DEBUG 日志

> ⚠️ 当前功能状态以 **「2026-07-08 — 播放器功能规划 + 进展核对（权威）」** 一节为准。
> 其下的 2026-07-07 / 2025-07 条目为历史记录，描述的实现已被取代或作废，仅供追溯。

---

## 2026-07-08 — 播放器功能规划 + 进展核对（权威）

**一句话现状**：正式前端页面 `examples/Listening Player.dc.html` 已从「假计时器 + 内联搜索函数」的中间实现，切换为 **真实 `<audio>` 元素播放 + `api-bundle.js`（`window.ListeningAPI`）搜索/详情** 的架构。搜索与播放主链路可用；歌单为纯内存态（无持久化）；SoundCloud、歌单链接导入、JSON 导入导出等尚缺。**旧文档（2026-07-07）与现代码多处不符，本节据实重写。**

图例：✅ 已实现（已验证） · ⚠️ 部分/受限 · ❌ 缺失

### A. 播放器功能规划（目标形态，作为核对基准）

| 模块 | 目标行为 |
|------|----------|
| 搜索 | 多源聚合（网易云 / QQ / 酷我 / JOOX / SoundCloud）；音源筛选芯片；回车或按钮触发 |
| 播放 | 真实音频；播放/暂停、上一首/下一首、进度拖动、音量；三种播放模式；按需取播放链接；播完自动切歌；失败提示 |
| 队列 | 查看、拖拽排序、移除、点击播放、当前曲高亮、数量角标 |
| 歌单 | 新建/删除、加入/移出、喜欢（内置「喜欢的音乐」）、播放全部、**持久化**、**JSON 导入导出**、**从歌单链接导入** |
| 歌词 | LRC 解析、逐行滚动高亮、封面/歌词切换、黑胶随播放旋转/暂停 |
| 界面 | 暗/亮主题、三栏布局、toast、弹窗（加入歌单 / 导入 / 新建） |

### B. 功能进展核对表

实现位置均指 `examples/Listening Player.dc.html`（除非另注）。「已联网实测」= 本环境用 node 加载真实 `api-bundle.js` 跑通；「渲染实测」= headless Chromium 加载页面确认渲染。

**搜索**

| 功能 | 状态 | 实现位置 / 说明 |
|------|------|-----------------|
| 多源聚合搜索（网易云/QQ/酷我） | ✅ 已联网实测 | `doSearch` → `window.ListeningAPI.searchAll({keyword,sources,limit})`；结果写入 `state.searchResults`（**不入 queue、不自动播放**） |
| 音源筛选芯片 | ✅ | `toggleSource` / `sourcesRender`；实际参与 `doSearch` 的 `sources` 过滤 |
| 回车 / 按钮触发 | ✅ | `searchKeyDown`（Enter）/ `doSearch` |
| 空结果与状态提示 | ✅ | `showToast`；`renderVals` 的 `statusText` / `emptyText` |
| SoundCloud 搜索 | ⚠️ 受限 | `src/api/soundcloud.js` 支持，但依赖本地代理 `proxy-server.mjs`（:8765）；未起代理时不可用 |
| JOOX 搜索 | ⚠️ 未暴露 | `api-bundle.js` 含 `searchJoox`，但 DC 页 UI 只有网易云/QQ/酷我/SoundCloud 四个芯片，无 JOOX |

**播放**

| 功能 | 状态 | 实现位置 / 说明 |
|------|------|-----------------|
| 真实音频播放 | ✅ 渲染实测 | `<audio id="player-audio">` + `initAudio()`（挂 `timeupdate/ended/play/pause/error/loadedmetadata`）；`loadAndPlay()` 设 `a.src=track.audioUrl` 后 `a.play()` |
| 播放 / 暂停 | ✅ | `togglePlay`；首播时懒加载当前曲 |
| 上一首 / 下一首 | ✅ | `stepTrack(dir)` → `playTrackAt`（真实加载并播放） |
| 进度拖动 | ✅ | `seek` 直接写 `audio.currentTime` |
| 音量 | ✅ | `setVolume` 直接写 `audio.volume` |
| 播放模式（列表/随机/单曲） | ✅ | `cycleMode` 切换；真正分支在 `handleTrackEnd()`（`ended` 事件）三态 |
| 按需取播放链接 | ✅ 已联网实测 | `loadAndPlay` → `API.ensureTrackDetails(track)`；网易云/QQ 实测返回 `audioUrl` + `qualityLabel` |
| 播完自动切歌 | ✅ | `ended` → `handleTrackEnd` |
| 播放失败提示 | ✅ | `_onError` → toast「播放失败，请尝试其他音源」 |
| SoundCloud 播放 | ✅ 数据层实测 / ⚠️ 浏览器端到端受环境限制 | DC 页已加载 `hls.js`（jsDelivr CDN）；`loadAndPlay` 按 `track.scIsHLS` 分流到 `Hls` 实例播放（`MANIFEST_PARSED` 触发播放、`ERROR` 兜底提示）或原生 `<audio>`（Safari）；`stopHLS()` 在切歌/组件卸载时清理实例。同时修了 `src/api/soundcloud.js` 里的一个 bug：原来 `audioUrl` 是未解析的 transcoding resolve 端点（返回 JSON，不是 m3u8），现在补了第二次 resolve 请求拿到真实签名 CDN 地址；并补回本地代理 `:8765` 的探测/优雅降级（`scFetchJson`，代理不可用时直连）。Node 直连实测：`ensureTrackDetails` 返回的 `audioUrl` 可直接 `curl` 到 `#EXTM3U` 开头的真实 m3u8 清单。浏览器内「点击播放→真实出声」未能实测——本 sandbox 代理拦截 Chromium 发往外部 CDN 的请求（连 React 自身在本环境同样加载失败，见下方「E」节），是既有环境限制，非本次改动引入的缺陷 |

**队列**

| 功能 | 状态 | 实现位置 |
|------|------|----------|
| 队列面板查看 | ✅ | `toggleQueuePanel` / `queueRender` |
| 拖拽排序 | ✅ | `dragStart` / `dragOverRow` / `dragEnd`（HTML5 drag） |
| 移除队列项 | ✅ | `removeTrack`（正确处理 `currentId` 迁移） |
| 点击队列项播放 | ✅ | `playTrackAt` |
| 当前曲高亮 + 数量角标 | ✅ | `renderVals`（`isCurrent` 配色 / `queueCount`） |

**歌单**

| 功能 | 状态 | 实现位置 / 说明 |
|------|------|-----------------|
| 新建 / 删除 | ✅ | `confirmCreate` / `deletePlaylist`（`builtin` 守卫 + `confirm` + toast） |
| 加入 / 移出 | ✅ | `confirmAdd`（去重追加）/ `removeFromPlaylist`（liked → 取消喜欢；普通歌单 → 过滤 `trackIds`） |
| 喜欢（内置「喜欢的音乐」） | ✅ | `toggleLike` + `liked` map |
| 播放全部 | ✅ | `playAllInPlaylist` → `playTrackAt`（真实播放） |
| **持久化** | ❌ | 歌单 / 喜欢 / 队列全在 `state`，**刷新即丢**；旧 standalone 有 localStorage，未合并 |
| **JSON 导入 / 导出** | ❌ | DC 页无；旧 standalone 有 `exportPlaylists`/`importPlaylists` |
| **从歌单链接导入** | ❌ 桩 | `confirmImport` 仅用正则识别网易云/QQ 链接来源，解析仍是 TODO（第 547-566 行），只弹 toast |

**歌词**

| 功能 | 状态 | 实现位置 / 说明 |
|------|------|-----------------|
| LRC 解析 | ✅ 已联网实测 | `parseAndSetLyrics(lrcText)`；网易云/QQ 实测 `ensureTrackDetails` 返回 `lrc` |
| 逐行滚动高亮 | ✅ | `renderVals` 的 `lyricsRender`（当前行放大高亮，前后行渐隐 + 位移动画） |
| 封面 / 歌词切换 | ✅ | `toggleMediaView` |
| 黑胶随播放旋转 / 暂停 | ✅ | `mediaDiscStyle` 的 `animation-play-state`（由 `state.playing` 驱动） |
| 无歌词回退 | ✅ | 无真实 `lyrics` 时回退到 mock `LYRICS` |

**界面**

| 功能 | 状态 | 实现位置 |
|------|------|----------|
| 暗 / 亮主题 | ✅ 渲染实测 | `toggleTheme` + `THEMES`（暗色已实测渲染） |
| 三栏布局 | ✅ 渲染实测 | 侧栏歌单 / 中栏搜索&队列 / 右栏播放器，均正确渲染 |
| toast | ✅ | `showToast`（2.2s 自动消失） |
| 弹窗（加入/导入/新建） | ✅ | `openAddModal` / `openImportModal` / `openCreateModal` 及各自 close |

### C. 与旧记录（2026-07-07）不符之处 —— 已按现代码更正

| 旧文档说 | 实际代码 |
|----------|----------|
| 用假 `syncTimer()`（`setInterval`）模拟播放进度 | 已删除；改为真实 `<audio>` 元素 + 事件监听 |
| 行 381-497 有 4 个内联 `searchNetease/QQ/Kuwo/All` 函数 | 已删除；改用 `api-bundle.js` 暴露的 `window.ListeningAPI` |
| 搜索结果「替换 `state.queue`，自动播放第一首」 | 结果写入独立的 `state.searchResults`，**不自动播放**，队列另算 |
| `playTrackAt` 只设 `currentId`（缺陷）/ 靠 syncTimer 修复 | 走真实 `playTrackAt → loadAndPlay → ensureTrackDetails → audio.play()` |
| 新增 `examples/verify.mjs` | 该文件**不存在** |
| 测试环境「浏览器打开 standalone.html」而小节标题写「测试 .dc.html」 | 自相矛盾，且启动路径写死了他人本机绝对路径 |
| `confirmImport` 仍是 TODO 桩 | ✅ **此条属实**，至今仍是桩 |

### D. standalone（旧）→ DC（新正式页）未合并功能

旧 `standalone.html`（纯 vanilla JS，源码在 git 历史 `f11a16b:examples/standalone.html`，现已打包成自解压 bundle）中有、而 DC 页尚缺：

| # | 功能 | 旧版实现 | 优先级 |
|---|------|----------|--------|
| 1 | localStorage 持久化 | `loadPlaylists`/`savePlaylists` | 高 |
| 2 | 歌单 JSON 导入/导出 | `exportPlaylists`/`importPlaylists`/`doExport`/`doImport` | 高 |
| 3 | SoundCloud HLS 播放 | 加载 `hls.js` + 走本地代理 :8765 + `stopHLS` | ✅ 已完成（2026-07-08，见上方「SoundCloud 播放」行） |
| 4 | JOOX 音源 | 搜索/详情 + UI 芯片 | 中 |
| 5 | 列表 / 网格视图切换 | `setTrackViewMode` | 中 |
| 6 | 歌单链接解析导入（URL→曲目） | 两版都是桩，实为**从未实现** | 低 |

### E. 运行与验证方法

```bash
# 1) 起本地代理（SoundCloud 需要，:8765）
npm run proxy

# 2) 起静态服务器（examples/，:4444）
npm run serve
# 浏览器打开 http://localhost:4444/Listening%20Player.dc.html

# 3) 重新打包 API（改了 src/api/ 后）
npm run build            # esbuild → examples/api-bundle.js（暴露 window.ListeningAPI）
```

接口层自测（本次即用此法，netease/qq 通过、kuwo 偶发 DNS 失败）：

```bash
node -e "const c=require('fs').readFileSync('examples/api-bundle.js','utf8');
eval(c+';globalThis.A=ListeningAPI');(async()=>{
  const t=await A.searchAll({keyword:'周杰伦',sources:['netease','qq'],limit:2});
  await A.ensureTrackDetails(t[0]);
  console.log(t[0].title, t[0].audioUrl?'audioUrl√':'✗', t[0].lrc?'lrc√':'✗', t[0].qualityLabel);
})();"
```

本次验证结论：
- **页面挂载/渲染**：headless Chromium 实测通过 —— `React`/`ReactDOM`/`ListeningAPI`/`DCLogic` 均加载，三栏 UI（侧栏歌单、搜索与音源芯片、播放器黑胶/进度/控制）完整渲染，暗色主题生效。
- **搜索 + 详情**：node 加载真实 bundle 实测 —— 网易云/QQ 稳定返回 `audioUrl`/`lrc`/音质；酷我在本环境偶发代理 DNS 失败（间歇可用）。
- **限制**：浏览器内「搜索→播放」端到端交互未跑通 —— 本环境代理对 Chromium 发往 localhost 的子资源请求返回 405（非 CONNECT），并会拦截外部 CDN；属环境限制，非页面缺陷。故 UI 交互以「渲染实测 + 接口实测 + 静态代码核对」三者交叉印证。

**2026-07-08 SoundCloud HLS 播放实现，本次会话（sandbox）复测**：
- `src/api/soundcloud.js` 的 resolve-URL 修复：node 直连 `searchSoundCloud` + `fetchSoundCloudDetails`，确认 `scIsHLS===true` 且 `audioUrl` 已是带 `Signature=` 的真实签名 CDN 地址；额外 `curl` 该地址返回 `#EXTM3U` 开头的合法 m3u8 —— 数据层实测通过。
- 该验证同时天然覆盖了「本地代理未启动」的降级路径（本 sandbox 未起 `proxy-server.mjs`，`checkScProxy()` 探测失败后直连成功，未阻塞/未抛错）。
- headless Chromium 复测（本次单独用 Playwright + `--proxy-server` 显式配置代理）：外部 CDN（`unpkg.com` 的 React、`cdn.jsdelivr.net` 的 `hls.js`）均 `ERR_CONNECTION_RESET`，页面因 React 加载失败而未渲染——与上一条「页面挂载/渲染」实测结论不一致，说明本环境对 Chromium 外部 CDN 请求的限制在本次会话中更严格（或环境状态已变化）；本地文件（`api-bundle.js`/`support.js`）和 `#player-audio` 元素本身加载正常，说明限制在「外部 CDN」而非页面结构。因此 `hls.js` 分支/`stopHLS()` 的正确性以「JS 语法校验通过 + 与旧版 `standalone.html`（git 历史 `c5a8a63`）已验证过的 hls.js 生命周期模式一致」佐证，未能做到真实点击播放出声的端到端验证。

### F. 后续待办

1. `confirmImport` 落地：网易云/QQ 歌单链接 → 解析曲目 → 写入指定歌单 / 「喜欢的音乐」。
2. 歌单/喜欢/队列 localStorage 持久化。
3. 歌单 JSON 导入/导出。
4. ~~DC 页补 `hls.js`，打通 SoundCloud HLS 播放（配合 :8765 代理）。~~ ✅ 已完成（2026-07-08），见上方「SoundCloud 播放」行；浏览器端到端出声受本 sandbox 网络限制未能实测。
5. UI 暴露 JOOX 音源芯片。
6. （可选）列表/网格视图切换。

---

<details>
<summary>📦 历史记录 (2026-07-07) — 已被上方 2026-07-08 章节取代（描述的是已废弃的「假计时器 + 内联搜索函数」实现）</summary>

> 以下三节记录的是把 mock 搜索接到内联 API、并用 `setInterval` 假计时器驱动播放的中间实现。
> 该实现之后被「真实 `<audio>` + `api-bundle.js`」架构整体替换，故内容已过时，仅供追溯。
> 注：其中提到的 `examples/verify.mjs` 实际并未留存；启动命令里的绝对路径为他人本机路径。

### 2026-07-07 — 新前端页面按钮功能测试（旧）
- 结论摘要：✅ 19/25、⚠️ 1/25（搜索为 mock）、❌ 5/25（导入确认、播放触发、切歌触发、播放模式）。
- 这些「缺陷/修复」都是围绕假计时器方案展开的，与当前真实音频架构不对应。

### 2026-07-07 — 接入真实搜索 API（旧）
- 当时方案：在页面内联 `searchNetease/searchQQ/searchKuwo/searchAll` 4 个函数，`doSearch` 改为真实搜索、结果替换 `state.queue` 并自动播放第一首；`playTrackAt/stepTrack/syncTimer` 补 `playing:true`。
- 现状差异：内联函数已删除、改走 `window.ListeningAPI`；搜索结果改入 `state.searchResults` 且不自动播放；`syncTimer` 已被真实 `<audio>` 事件取代。

### 2026-07-07 — DC 框架环境就绪 + 搜索 API 集成（旧）
- 有效沿用至今的部分：从 standalone.html 提取 `examples/support.js`（DC 运行时）、页面加载 React 18 UMD、以及「导入歌单仍是 TODO 桩」这一结论。
- 已过时的部分：内联搜索函数、假计时器、`verify.mjs`、写死的本机启动路径。

</details>

<details>
<summary>📦 历史记录 (2025-07-04 ~ 2025-07-05) — 已作废</summary>

- SoundCloud 集成调试（API CORS、CDN 403、HLS playback）
- 原 standalone.html 的歌单 CRUD / 主题切换 / localStorage 持久化
- 代理服务器 proxy-server.mjs 的搭建和测试

</details>

### 关键文件路径

```
Listening/
├── examples/
│   ├── Listening Player.dc.html  ← 正式前端（DC 框架 + 真实 <audio> + ListeningAPI）
│   ├── api-bundle.js             ← esbuild 打包的 API，暴露 window.ListeningAPI
│   ├── support.js                ← DC 运行时（从 standalone.html 提取）
│   ├── search-test.html          ← 纯 vanilla 搜索验证页
│   └── standalone.html           ← 旧版播放器（现为自解压 bundle，源码见 git 历史）
├── src/api/                      ← API 模块（netease/qq/kuwo/joox/soundcloud + index 聚合）
├── proxy-server.mjs              ← CORS 代理（:8765，SoundCloud 用）
└── DEBUG.md                      ← 本文档
```

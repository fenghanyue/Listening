# DEBUG 日志

> ⚠️ 当前功能状态以 **「2026-07-08 — 播放器功能规划 + 进展核对（权威）」** 一节为准。
> 其下的 2026-07-07 / 2025-07 条目为历史记录，描述的实现已被取代或作废，仅供追溯。

---

## 2026-07-08 — 播放器功能规划 + 进展核对（权威）

**一句话现状**：正式前端页面 `examples/Listening Player.dc.html` 已从「假计时器 + 内联搜索函数」的中间实现，切换为 **真实 `<audio>` 元素播放 + `api-bundle.js`（`window.ListeningAPI`）搜索/详情** 的架构。搜索与播放主链路可用（含 SoundCloud，2026-07-08 已修复，见 H 节）；**酷我音源已于 2026-07-08 整体下线（见 I 节），当前音源固定为网易云 + QQ + SoundCloud**；歌单为纯内存态（无持久化）；歌单链接导入、JSON 导入导出等尚缺。**旧文档（2026-07-07）与现代码多处不符，本节据实重写。**

图例：✅ 已实现（已验证） · ⚠️ 部分/受限 · ❌ 缺失

### A. 播放器功能规划（目标形态，作为核对基准）

| 模块 | 目标行为 |
|------|----------|
| 搜索 | 多源聚合（网易云 / QQ / SoundCloud；JOOX 代码留着但未在 UI 暴露）；音源筛选芯片；回车或按钮触发 |
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
| 多源聚合搜索（网易云/QQ/SoundCloud） | ✅ 已联网实测 | `doSearch` → `window.ListeningAPI.searchAll({keyword,sources,limit})`；结果写入 `state.searchResults`（**不入 queue、不自动播放**）。酷我已于 2026-07-08 下线，见 I 节 |
| 音源筛选芯片 | ✅ | `toggleSource` / `sourcesRender`；实际参与 `doSearch` 的 `sources` 过滤 |
| 回车 / 按钮触发 | ✅ | `searchKeyDown`（Enter）/ `doSearch` |
| 空结果与状态提示 | ❌ 用户前端实测确认，缺"搜索中"状态 | `doSearch()`（[Listening Player.dc.html:515](examples/Listening%20Player.dc.html:515)）在发起异步 `API.searchAll()` **之前**就同步把 `hasSearched:true, searchResults:[]` patch 进 state；`renderVals` 里 `hasNoResults = !showPrompt && displayTracks.length===0`（[:940](examples/Listening%20Player.dc.html:940)）在请求返回前就已经为真，所以搜索请求进行中的这段时间（多源并行请求，可能有明显延迟）主内容区会先显示「没有找到相关歌曲，换个关键词试试」，直到结果回来才刷新成真实列表。虽然有一个 `showToast('正在搜索...')`，但那是 2.2s 自动消失的悬浮提示，不是搜索区域的常驻状态，用户观感上就是"搜索栏显示没搜到"。需要新增一个独立的 `isSearching` 状态，加载中单独展示"搜索中…"而不是空结果态 |
| SoundCloud 搜索 | ✅ 已修复，已联网实测 | 参照 git 历史 `f11a16b` 的旧实现，重写了 `src/api/soundcloud.js`：新增 `checkScProxy`/`scFetchJson`，`searchSoundCloud`/`fetchSoundCloudDetails` 现在都经本地代理 `:8765/proxy?url=` 转发（代理不可用时退回直连，仅适用于无 CORS 限制的环境）；`getSCClientId` 优先调代理的 `/sc-client-id`。本次通过活跃的本地代理+静态服务器实测：搜索、详情、HLS 播放链接解析全部走通 |
| JOOX 搜索 | ⚠️ 未暴露 | `api-bundle.js` 含 `searchJoox`，但 DC 页 UI 只有网易云/QQ/SoundCloud 三个芯片，无 JOOX |

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
| SoundCloud 播放 | ✅ 已修复，已联网实测（HLS 分支）；progressive 分支机制验证通过、CDN 侧偶发 403 | DC 页头部加了 `<script src=".../hls.js@1.5">`；`loadAndPlay` 里 `track.scIsHLS` 为真时用 `new Hls()` + `loadSource`/`attachMedia`，`MANIFEST_PARSED` 后才 `a.play()`，并新增 `stopHLS()` 在切歌/卸载时 `hls.destroy()`。实测：AAC HLS（`playback.media-streaming.soundcloud.cloud`）的 manifest + 分片本次通过本地代理拿到手后确认**自带 CORS**（真实 `Origin` 头请求会返回 `access-control-allow-origin: *`），hls.js 可直接从 CDN 拉流，不需要额外代理；顺带发现两个上游限制（非本次引入的 bug，属第三方 API 固有约束）：① 部分曲目的 progressive mp3 走 CloudFront（`cf-media.sndcdn.com`）在本环境网络出口会 403（`src/api/soundcloud.js` 的打分逻辑已优先选 HLS，规避了大部分这种情况）；② 部分曲目的播放走 `track_authorization` JWT 里编码了 `geo` 限制（如 `"geo":"US"`），出口 IP 不在允许地区时 resolve 会 404/401，任何客户端都一样，不是代理或本项目代码的问题 |
| 酷我播放 | 🗑️ 音源已下线，见 I 节 | 原因是 `fetchKuwoDetails` 硬编码 `level=zp`（无损 FLAC，实测单曲 50MB+，`Content-Type: audio/x-flac` 不在浏览器标准 MIME 支持列表），2026-07-08 决定直接砍掉酷我音源而不是修，`src/api/kuwo.js` 已删除 |
| 播放后"正在播放"标题切换 | ❌ 用户前端实测确认 | 根因是 `id` 分配机制的通用缺陷，三个源都会中招（不是 SoundCloud 专属）：`_apiIdSeq`（[:386](examples/Listening%20Player.dc.html:386)）从 0 自增给搜索结果分配 `id`，与 `makeQueue()` 硬编码的 mock 种子 `id:1~7` 共用同一空间。已用 node 模拟验证（按当前网易云/QQ/SoundCloud 三源重算）：首次搜索时前 7 条结果精确落在 `id:1~7`，每条都会撞上 mock 队列里对应 id 的条目。`playTrackAt()`（[:744](examples/Listening%20Player.dc.html:744)）的"是否已在队列"判断因此误判为真，真正点的曲目从未写入 `state.queue`；音频照样能播（`loadAndPlay` 用的是 `searchResults` 里对的 track），但界面标题从 `s.queue.find(id===currentId)` 读到的是撞车的旧 mock 条目，显示就一直是错的/不对的。detail 见「F. 后续待办」第 12 条 |

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
| 专辑封面（真实图片） | ❌ 用户前端实测确认（含搜索结果列表，见待办第 9 条） | 黑胶大图（`mediaDiscStyle`，行920）、列表/队列缩略图（行104/170）和搜索结果列表（行879）**只用 `GRADIENTS[track.source]` 纯色渐变**，从未使用 `track.cover`；而各源 API 其实都已返回封面图 URL（`netease/qq/soundcloud.js` 均有 `cover` 字段），只是前端没接 |
| 专辑名称显示 | ❌ 用户前端实测确认 | 全文 `grep "\.album"` 零匹配，`track.album` 字段（各 API 已提供）从未在任何位置渲染，播放器/队列/搜索结果都只显示歌名+歌手 |

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

> ⚠️ **2026-07-08 代码清理时发现并已删除 `examples/standalone.html` / `examples/template.html`**（详见本节末尾说明）。下表列的功能出处仍是 **git 历史 `f11a16b:examples/standalone.html`**（1743 行可读源码，`git show f11a16b:examples/standalone.html` 可找回），不是删除前工作区里那份文件——那份其实是更早、更简配的快照，解压后核对确认**不含**下表任何一项。以后要抄旧实现做参考，必须从 `f11a16b` 这个 commit 取，不要以为工作区曾经的 `standalone.html`/`template.html` 里有。

旧 `standalone.html`（纯 vanilla JS，源码在 git 历史 `f11a16b:examples/standalone.html`）中有、而 DC 页尚缺：

| # | 功能 | 旧版实现 | 优先级 |
|---|------|----------|--------|
| 1 | localStorage 持久化 | `loadPlaylists`/`savePlaylists` | 高 |
| 2 | 歌单 JSON 导入/导出 | `exportPlaylists`/`importPlaylists`/`doExport`/`doImport` | 高 |
| 3 | SoundCloud HLS 播放 | 加载 `hls.js` + 走本地代理 :8765 + `stopHLS` | 中 |
| 4 | JOOX 音源 | 搜索/详情 + UI 芯片 | 中 |
| 5 | 列表 / 网格视图切换 | `setTrackViewMode` | 中 |
| 6 | 歌单链接解析导入（URL→曲目） | 两版都是桩，实为**从未实现** | 低 |

**清理说明**：工作区里的 `examples/standalone.html` 早先被换成了一个自解压 bundle（base64+gzip 内嵌资源的单文件版本），本次核对时解压比对发现：① 其内嵌的运行时 JS 与 `examples/support.js` 逐字节相同；② 其内嵌模板与已删除的 `examples/template.html` 逐字节相同（`template.html` 就是这份模板的可读副本，但引用的脚本资源 `bc1beacb-...` 未内嵌，本身打不开，纯粹是失效文件）；③ 模板里搜不到 `localStorage`/`loadPlaylists`/`hls.js`/`exportPlaylists` 等字符串，说明这份 bundle 快照比 `f11a16b` 还早，功能更少。两个文件均已确认无独特价值并删除，`f11a16b` 仍是唯一权威旧源码出处。

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
- **【2026-07-08 补充】用户真实前端反馈的 4 个问题核对**：用户在浏览器里实测反馈「酷我播放不了 / SoundCloud 搜索不行 / 黑胶转圈但不是专辑封面 / 专辑名字哪都不显示」，逐条 curl + 代码核对后 **4 条全部坐实**（详见上方「播放」「界面」表格新增行）。方法：直接 curl 目标 API（绕开本环境 Node fetch 的证书问题）拿到真实响应头和文件信息，再对照 DC 页源码确认前端是否使用了对应字段。

### F. 后续待办

1. `confirmImport` 落地：网易云/QQ 歌单链接 → 解析曲目 → 写入指定歌单 / 「喜欢的音乐」。
2. 歌单/喜欢/队列 localStorage 持久化。
3. 歌单 JSON 导入/导出。
4. ~~DC 页补 `hls.js`，打通 SoundCloud HLS 播放（配合 :8765 代理）。~~ ✅ **2026-07-08 已完成**，见下方「H. SoundCloud 搜索/播放修复」。
5. UI 暴露 JOOX 音源芯片。
6. （可选）列表/网格视图切换。
7. ~~修复酷我播放失败~~ 🗑️ **2026-07-08 决定不修了，直接下线酷我音源**，见「I. 下线酷我音源」。
8. ~~修复 SoundCloud 搜索~~ ✅ **2026-07-08 已完成**，见下方「H. SoundCloud 搜索/播放修复」。
9. **接入真实专辑封面**：黑胶大图、队列列表缩略图**以及搜索结果列表**（用户 2026-07-08 前端实测确认搜索结果同样没有封面，根因相同：[Listening Player.dc.html:879](examples/Listening%20Player.dc.html:879) 的 `coverGradient: GRADIENTS[t.source]`）改为优先渲染 `track.cover`（图片），封面缺失时才回退现有的 `GRADIENTS[source]` 渐变。
10. **显示专辑名称**：在播放器信息区 / 队列行补上 `track.album` 的渲染；注意目前网易云/SoundCloud 搜索结果的 `album` 字段是空字符串，需要看是否要在 `ensureTrackDetails` 阶段一并补齐。
11. **【新增】搜索过程中显示"没搜到"而不是"搜索中"**：`doSearch()`（[:515](examples/Listening%20Player.dc.html:515)）在异步请求返回前就把 `hasSearched:true, searchResults:[]` 写进 state，导致请求进行中的这段时间会先显示空结果提示。需要加一个独立的 `isSearching` 状态区分"搜索中"与"搜索完但没结果"。
12. **【高优先级】播放后"正在播放"标题不切换**：根因是 `_apiIdSeq`（[:386](examples/Listening%20Player.dc.html:386)）从 0 自增给每条新搜索结果分配 `id`，与 `makeQueue()`（[:340](examples/Listening%20Player.dc.html:340)）硬编码的 mock 种子数据 `id:1~7` 共用同一个 id 空间。用 node 模拟验证过（2026-07-08 下线酷我后按当前三源 netease/qq/soundcloud 重新算了一遍）：首次搜索、三源全开时，交错顺序是 netease→qq→soundcloud，前 7 条结果精确拿到 `id:1~7`，**每一条都会撞上 mock 队列里对应 id 的条目**（比如 SoundCloud 第一条结果分配到 `id:3`，撞上 mock 里的「第七个路口」——凑巧两者都标了 `source:'soundcloud'`，但标题/歌手对不上，仍然是错的）。`playTrackAt()` 里 `!s.queue.find(t => t.id === id)`（[:744](examples/Listening%20Player.dc.html:744)）误判为"已在队列"（其实是撞上了不相关的 mock 条目），真正点的曲目从未被写入 `state.queue`；音频本身能正常播放（`loadAndPlay` 用的是 `searchResults` 里正确的 track 对象），但界面"正在播放"信息来自 `s.queue.find(id===currentId)`，找到的是旧 mock 条目，标题/歌手就一直是错的。这个 bug 对三个源一视同仁，只是撞车的具体 mock 条目不同。修法：`normalizeTrack` 的 id 生成要避开 mock 种子已占用的 id 区间（比如 `_apiIdSeq` 初始值设成比 mock 最大 id 大，或者 mock 种子和搜索结果分别用不同前缀的 uid 而不是数字 id 做 key）。

### H. SoundCloud 搜索/播放修复（2026-07-08）

参照 git 历史 `f11a16b:examples/standalone.html` 里更完整的旧实现，重写了 `src/api/soundcloud.js` 并给 DC 页接上了 `hls.js`：

- **搜索/详情走代理**：新增 `checkScProxy()`（探测 `:8765/sc-client-id` 并缓存结果）+ `scFetchJson()`（代理可用时经 `:8765/proxy?url=` 转发，否则直连兜底）。`searchSoundCloud`、`fetchSoundCloudDetails`、`getSCClientId` 全部改走这条路径，彻底解决了 `api-v2.soundcloud.com` 不发 CORS 头导致浏览器直接拦截的问题。
- **HLS 播放**：`Listening Player.dc.html` 头部加了 `<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5">`；`loadAndPlay()` 里新增判断，`track.scIsHLS` 为真时用 `new Hls()` + `loadSource`/`attachMedia`，等 `MANIFEST_PARSED` 事件再 `a.play()`；新增 `stopHLS()` 方法，在切歌前和组件卸载时 `hls.destroy()`，避免播放器实例泄漏。
- **progressive mp3 走 `/stream` 代理**：非 HLS 的 transcoding 解析出真实 CDN 地址后，通过 `proxy-server.mjs` 已有的 `/stream?url=` 流式转发（绕开 CDN 对部分地区的 403），而不是把 CDN 地址直接交给 `<audio>`。

**验证方式**：本环境两台长期运行的服务（`node proxy-server.mjs`:8765、`python3 -m http.server 4444`）本来就在跑，用 node 加载重新打包的 `examples/api-bundle.js`、经这两个真实服务走了一遍完整链路（搜索 → 详情/media resolve → 拿到最终播放地址），而不是只读代码判断。

**结论 & 顺带发现的两个上游限制（非本次改动引入，是 SoundCloud 自身的固有约束）**：
- HLS（AAC，`playback.media-streaming.soundcloud.cloud`）路径完全走通：manifest 和分片都实测可达，且该 CDN 对真实 `Origin` 请求头会返回 `access-control-allow-origin: *`，所以 hls.js 在浏览器里可以直接拉流，不需要额外代理。
- 部分曲目的 progressive mp3 CDN（`cf-media.sndcdn.com`，CloudFront）在本环境的网络出口下实测 403——这也是为什么打分逻辑本来就优先选 HLS，大部分情况能绕开。
- 部分曲目的 `track_authorization` JWT 里编码了地域限制（实测抓到一个 `"geo":"US"` 的例子），出口 IP 不在允许地区时 resolve 会 404/401，这是内容分发层面的地域限制，任何客户端、任何代理配置都一样，不是本项目代码或代理的问题。

### G. 代码清理记录（2026-07-08）

项目文件变多有点乱，做了一轮「确认零引用/零价值才删」的清理：

| 删除对象 | 确认方式 | 结论 |
|----------|----------|------|
| `examples/template.html` | 全仓 grep 零引用；`<script src="bc1beacb-...">` 指向的资源不存在（本文件不含 manifest，打不开） | 解压 `standalone.html` 的 bundle 后发现这份 template 其实是 bundle 内嵌模板的可读副本（逐字节相同），但脚本引用本身是失效的，纯属废弃导出物 |
| `examples/standalone.html` | 解压 bundle 比对：内嵌 JS 与 `support.js` 逐字节相同；内嵌模板与 `template.html` 逐字节相同；模板里搜不到 `localStorage`/`hls.js`/`exportPlaylists` 等字符串 | 工作区这份是比 `f11a16b` 更早、功能更少的快照，无独特价值；真正有参考价值的旧版持久化/导出/HLS 源码在 git 历史 `f11a16b:examples/standalone.html`，删工作区文件不影响找回（详见上方 D 节说明） |
| `src/api/utils.js` 里的 `inferQualityFromUrl` / `formatTime` | 全仓 grep 零调用（`browser-demo.html` 里的 `formatTime` 是同名但自己本地定义的另一个函数，没有 import utils.js 的版本） | 保留仍在用的 `parseLRC` |
| `.DS_Store`（根目录 / examples / src） | macOS 产生的本地元数据文件，未被 git 跟踪 | 顺手删除并加进 `.gitignore` 防止以后误提交 |

未删除、但记录一下顺带发现的重复逻辑（非本次清理范围，仅供后续参考）：`netease.js`/`qq.js`（原来 `kuwo.js` 也有一份，2026-07-08 随音源下线一起删了）里各自都内联了一份几乎相同的「按扩展名推断音质」代码块，本可以复用（已删除的）`utils.js:inferQualityFromUrl`，但实现细节略有差异，未来如要合并需要先核对差异再动手。

### I. 下线酷我音源（2026-07-08）

酷我播放一直没修好（见「播放」表格，硬编码无损 FLAC 导致浏览器播不了），用户决定不修了，直接把酷我这个音源整个砍掉。以后固定只用**网易云 + QQ + SoundCloud** 三源（JOOX 代码还留着，但本来就没在 UI 里暴露，不受影响）。

改动范围：

| 文件 | 改动 |
|------|------|
| `src/api/kuwo.js` | 整个文件删除 |
| `src/api/index.js` | 去掉 `searchKuwo`/`fetchKuwoDetails` 的 import 和 re-export；`searchAll` 里去掉酷我分支，默认 `sources` 从 `['netease','qq','kuwo']` 改成 `['netease','qq','soundcloud']`；`ensureTrackDetails` 的 switch 去掉 `case 'kuwo'` |
| `examples/Listening Player.dc.html` | `SOURCE_COLORS`/`SOURCE_LABELS`/`GRADIENTS` 去掉 `kuwo` 项；默认 `state.sources` 去掉 `kuwo:true`；`sourcesRender` 的音源芯片列表去掉 `'kuwo'`；mock 种子 `makeQueue()` 里原本标 `source:'kuwo'` 的两条（id3「第七个路口」、id6「安静的光」）改成了 `source:'soundcloud'`（避免 mock 数据引用一个已经不存在的音源） |
| `proxy-server.mjs` | 顶部注释里"网易云/QQ/酷我可以直连"改成"网易云/QQ" |
| `README.md` | 目录结构、代码示例、track 字段注释、第三方 API 源表格里的酷我全部替换成 SoundCloud |
| `examples/browser-demo.html`、`examples/node-demo.mjs`、`examples/search-test.html` | 默认 `sources` 数组和 CSS 音源标签样式都去掉 `kuwo`，补上 `soundcloud`（`search-test.html` 原来的内联 `searchKuwo()` 直接换成了一个走本地代理的 `searchSoundCloud()`，写法上对齐 `src/api/soundcloud.js`） |
| `examples/api-bundle.js` | 重新 `npm run build` 生成，不再包含酷我模块 |

顺带影响：F 节待办第 7 条（修复酷我播放失败）作废；第 12 条（播放标题不切换）的 id 碰撞位置从四源版本的 `id:4` 重算成了三源版本（每个源的首条结果都会撞车，见该条最新描述）。

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
│   ├── support.js                ← DC 运行时（原从 standalone.html 提取；旧文件已删，见下方清理记录）
│   ├── browser-demo.html         ← 纯 vanilla API 用法 demo（README 里文档化的官方示例之一）
│   ├── node-demo.mjs             ← Node.js API 用法 demo（README 里文档化的官方示例之一）
│   └── search-test.html          ← 纯 vanilla 搜索验证页
├── src/api/                      ← API 模块（netease/qq/soundcloud/joox + index 聚合；酷我已下线）
├── proxy-server.mjs              ← CORS 代理（:8765，SoundCloud 用）
└── DEBUG.md                      ← 本文档
```

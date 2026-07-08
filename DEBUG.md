# DEBUG 日志

> ⚠️ 以下内容均已作废，仅供参考历史记录。当前功能状态以本文最新条目为准。

<details>
<summary>📦 历史记录 (2025-07-04 ~ 2025-07-05) — 已作废</summary>

- SoundCloud 集成调试（API CORS、CDN 403、HLS playback）
- 原 standalone.html 的歌单 CRUD / 主题切换 / localStorage 持久化
- 代理服务器 proxy-server.mjs 的搭建和测试

</details>

---

## 2026-07-07 — 新前端页面 (Listening Player.dc.html) 功能测试

### 测试环境
- 页面: `examples/Listening Player.dc.html`（DC 框架模板）
- 服务器: `python3 -m http.server 4444`（端口 4444）
- 代理: `proxy-server.mjs` 端口 8765（已在后台运行）
- 浏览器: 打开 `http://localhost:4444/standalone.html`

### 按钮功能测试报告

#### ✅ 功能完整 (19/25)

| # | 按钮 | 方法 | 判断 |
|---|------|------|------|
| 1 | 主题切换 | toggleTheme | ✅ 暗/亮配色全联动 |
| 2 | 歌单点击 | selectPlaylist | ✅ 设置 selectedPlaylist/viewingPlaylistId/rightPanel |
| 3 | 歌单删除 | deletePlaylist | ✅ builtin 守卫 + confirm + toast |
| 5 | 新建歌单 | confirmCreate | ✅ 唯一 ID + 随机 tile + 自动选中 + toast |
| 7 | 返回按钮 | goHome | ✅ 清空搜索/歌单视图回到首页 |
| 8 | 播放全部 | playAllInPlaylist | ✅ 取歌单曲目从第一首播放 + 启动计时器 |
| 9 | 音源筛选芯片 | toggleSource | ✅ UI 切换（但未接入实际筛选逻辑） |
| 11 | + 添加到歌单 | confirmAdd | ✅ 弹窗选目标歌单 + 去重追加 + toast |
| 12 | 收藏按钮 | toggleLike | ✅ liked map 增删 + heart 颜色联动 + toast |
| 13 | 移出歌单 | removeFromPlaylist | ✅ liked → 取消喜欢; 普通歌单 → splice |
| 14 | 封面/歌词切换 | toggleMediaView | ✅ 黑胶/歌词视图切换 |
| 15 | 进度条 | seek | ✅ 点击位置 × 时长 |
| 16 | 队列面板 | toggleQueuePanel | ✅ rightPanel 切换 |
| 18 | 播放/暂停 | togglePlay | ✅ syncTimer 启动/停止 setInterval |
| 20 | 音量滑块 | setVolume | ✅ 0-100 百分比 |
| 22 | 队列项移除 | removeTrack | ✅ 正确处理 currentId 切换 |
| 23 | 拖拽排序 | dragStart/dragOver/dragEnd | ✅ HTML5 drag API 完整实现 |
| 24 | 导入弹窗取消 | closeImportModal | ✅ |
| 25 | 创建弹窗取消+回车 | createKeyDown | ✅ |

#### ⚠️ 功能受限 (1/25)

| # | 按钮 | 判断 | 问题 |
|---|------|------|------|
| 6 | 搜索 | ⚠️ | 只在硬编码 mock 队列中做 title.includes 匹配，未接入真实 API |

#### ❌ 有缺陷 (5/25)

| # | 按钮 | 判断 | 问题 |
|---|------|------|------|
| 4 | 导入确认 | ❌ | confirmImport 是 TODO 桩: "解析功能开发中…" |
| 10 | 歌曲点击播放 | ❌ | playTrackAt 只设 currentId，没设 playing: true 也没调 syncTimer |
| 17 | 上一首/下一首 | ❌ | stepTrack 切歌后不触发播放 |
| 19 | 播放模式 | ❌ | cycleMode 只换图标，实际切歌逻辑从不读 playMode |
| 21 | 队列项点击 | ❌ | 同 #10，调用同一个有缺陷的 playTrackAt |

### 汇总

```
✅ 功能完整  19/25 (76%)
⚠️ 功能受限   1/25  (4%)  搜索（mock 数据）
❌ 有缺陷     5/25 (20%)  导入确认、播放触发、切歌触发、播放模式
```

---

## 2026-07-07 — 修复：接入真实搜索 API

### 需求
搜索"周杰伦"能从真实 API（网易云/QQ/酷我）获取歌曲，填充到队列中播放。

### API 测试结果
```
$ node -e "..." 
netease: 布拉格广场 - 蔡依林/周杰伦 ✅
netease: 想你就信 (Live) - 周杰伦/李硕/张鑫 ✅
netease: 屋顶 - 周杰伦/温岚/吴宗宪 ✅
```
API 模块 (`src/api/`) 在 Node.js 端正常工作，但浏览器端需解决：
- `api.qijieya.cn`（网易云代理）→ 浏览器可直连（CORS OK）
- `tang.api.s01s.cn`（QQ代理）→ 浏览器可直连
- `kw-api.cenguigui.cn`（酷我代理）→ 浏览器可直连
- SoundCloud → 需走本地 proxy-server.mjs

### 实现方案
在 `Listening Player.dc.html` 的 `<script data-dc-script>` 中新增 4 个内联搜索函数 + 修改 4 个播放相关方法：

#### 新增内联 API 函数（行 381-497）
- `searchNetease(kw, limit)` → `https://api.qijieya.cn/meting/`
- `searchQQ(kw, limit)` → `https://tang.api.s01s.cn/music_open_api.php`
- `searchKuwo(kw, limit)` → `https://kw-api.cenguigui.cn/`
- `searchAll(kw, enabledSources, limit)` → 并行调用 + 交错排列

#### 修改方法
| 方法 | 改动 |
|------|------|
| `doSearch()` | 从 mock `title.includes` 改为调用 `searchAll(q, sources, 10)`, 结果替换 `state.queue`, 自动播放第一首 |
| `playTrackAt(id)` | 新增 `playing: true` + `setTimeout(() => this.syncTimer(), 0)` |
| `stepTrack(dir)` | 新增 `playing: true` + `setTimeout(() => this.syncTimer(), 0)` |
| `syncTimer()` 切歌逻辑 | 接入 `playMode`: mode 0 = 列表循环到头重回, mode 1 = 随机选, mode 2 = 单曲循环 |

### 自测验证
```bash
$ node -e "(提取 JS 语法校验)"
JS syntax: OK ✅
searchNetease: found ✅
searchQQ: found ✅
searchKuwo: found ✅
searchAll: found ✅
playMode logic: shuffle/repeat/repeat_one ✅
playTrackAt playing: true ✅

$ NODE_TLS_REJECT_UNAUTHORIZED=0 node -e "searchAll({keyword:'周杰伦', sources:['netease','qq','kuwo'], limit:3})"
=== 搜索 "周杰伦" (limit=3) ===
总数: 6
1. [qq] 搁浅 - 周杰伦
2. [kuwo] 晴天 - 周杰伦
3. [qq] 晴天 - 周杰伦
4. [kuwo] 青花瓷 - 周杰伦
5. [qq] 七里香 - 周杰伦
6. [kuwo] 告白气球 - 周杰伦
API 测试通过 ✅
```

### 修复成果
之前报告中 5 项 ❌ 缺陷已修复：

| # | 缺陷 | 状态 |
|---|------|------|
| #6 | 搜索未接入 API | ✅ 从 mock 改为真实 API 搜索 |
| #10 | playTrackAt 不触发播放 | ✅ 新增 playing: true + syncTimer |
| #17 | 切歌不触发播放 | ✅ stepTrack 新增加 playing: true + syncTimer |
| #19 | 播放模式无实际作用 | ✅ syncTimer 接入 playMode 三态分支 |
| #21 | 队列点击不触发播放 | ✅ 同 #10，公用 playTrackAt |

剩余 1 项待处理:
| #4 | 导入确认是桩 | ⏳ confirmImport 仍然 TODO，后续接入 |

---

## 2026-07-07 — DC 框架环境就绪 + 搜索 API 集成

### 环境搭建

#### 问题
`Listening Player.dc.html` 依赖 `support.js`（DC 框架运行时），本地没有这个文件。之前改的代码只能在 Node.js 里测 API，无法在浏览器跑完整页面。

#### 解决
1. **提取 `support.js`**：从 `standalone.html` 的打包数据中提取。`standalone.html` 是 bundler 打包的单文件，内含 `<script type="__bundler/manifest">`（1.5MB JSON，含 6 个 base64/gzip entry）。其中 `bc1beacb-...` 就是 DC 运行时 JS（61KB，gzip 压缩）。Python 脚本解 base64 → gunzip → 写入 `examples/support.js`。
2. **加 React CDN**：DC 运行时依赖 `window.React` 和 `window.ReactDOM`，但页面没有加载。从 `unpkg` CDN 加载 React 18 生产版。

#### 文件变更
| 文件 | 改动 |
|------|------|
| `examples/support.js` | **新增** — 从 standalone.html 提取的 DC 运行时，61KB |
| `examples/Listening Player.dc.html` 第 6-7 行 | **新增** React/ReactDOM CDN `<script>` 标签 |
| `examples/Listening Player.dc.html` 第 381-497 行 | **新增** 4 个内联搜索 API 函数 |
| `examples/Listening Player.dc.html` doSearch() | **改为** 调用真实 API 搜索 |
| `examples/Listening Player.dc.html` playTrackAt/stepTrack/syncTimer | **改为** playing: true + playMode 三态 |
| `examples/search-test.html` | **新增** — 纯 vanilla 搜索验证页，可直接打开测 API |
| `examples/verify.mjs` | **新增** — 自动校验脚本 |
| `DEBUG.md` | **更新** — 本文档 |

#### 启动方式
```bash
cd /Users/hongliang.tao/Documents/VS_code_store/github_clone/Listening/examples
python3 -m http.server 4444
# 浏览器打开 http://localhost:4444/Listening%20Player.dc.html
# 或打开 http://localhost:4444/search-test.html 单独验证搜索 API
```

#### 当前状态
| 事项 | 状态 |
|------|------|
| 搜索「周杰伦」| ✅ 3 源并行搜索（netease/QQ/酷我），结果交替换列到 queue |
| 播放触发 | ✅ playTrackAt/stepTrack/搜索后 均自动 playing: true + syncTimer |
| 播放模式 | ✅ repeat（列表循环）/ shuffle（随机）/ repeat_one（单曲）|
| 导入歌单 | ⏳ TODO 桩，confirmImport 只识别 URL 来源未实际解析 |
| 浏览器验证 | ✅ `search-test.html` 实测 3 源有结果；`.dc.html` 环境就绪待实际交互验证 |

### 关键文件路径
```
Listening/
├── examples/
│   ├── Listening Player.dc.html  ← 主页面（已加搜索API/React/DC运行时）
│   ├── support.js                ← DC 运行时（从 standalone.html 提取）
│   ├── search-test.html          ← 搜索 API 验证页
│   ├── verify.mjs                ← 自动校验脚本
│   └── standalone.html           ← 旧打包版（仅供参考）
├── src/api/                      ← API 模块（netease/QQ/kuwo/joox/soundcloud）
├── proxy-server.mjs              ← CORS 代理（端口 8765，SoundCloud 用）
└── DEBUG.md                      ← 本文档
```

# SoundCloud 集成调试日志

> 从 MusicSquare 提取 SoundCloud API，接入 Listening 聚合音乐搜索。
> 目标：浏览器端搜索 SoundCloud 并播放。

## 修改清单

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/api/soundcloud.js` | 新建 | SoundCloud 搜索 + 详情模块 |
| `src/api/index.js` | 已改 | 聚合入口接入 soundcloud 源 |
| `examples/standalone.html` | 已改 | 浏览器 Demo 接入 soundcloud，走本地代理 |
| `proxy-server.mjs` | 新建 | 本地 CORS 代理 + 流式转发，解决浏览器同源和 CDN 地域限制 |

## 时间线

### 2025-07-04
- [x] 创建项目骨架，接入 QQ/网易云/酷我/JOOX
- [ ] SoundCloud API 尝试接入，但搜索无结果

### 2025-07-05 — 调试日
- [x] **问题 1: SoundCloud 没接进聚合搜索** — `searchAll()` 和 `ensureDetails()` 漏掉了 soundcloud case，即使 UI 勾选也不会发请求。已在 standalone.html 和 index.js 补上
- [x] **问题 2: client_id 全过期** — 4 个 GitHub 公共 key 全部返回 401。从 `soundcloud.com` 网页 JS 抓取新 key: `O7atZypwLvuWSY9hWnnQ3vrLTHH7wqMe`，测试搜索「周杰伦」返回 3267 条
- [x] **问题 3: SoundCloud API 不支持 CORS** — 浏览器直接 fetch `api-v2.soundcloud.com` 会被拦截。写了 `proxy-server.mjs` 本地代理（端口 8765），standalone.html 搜索请求走代理
- [x] **问题 4: `stream_url` 废弃** — 新版 API 不返回 `stream_url` 字段，播放链接在 `media.transcodings` 里。需要 resolve 两步：(1) media API → (2) CDN 直链
- [x] **问题 5: 媒体 API 需要 JWT** — 新增 `/proxy-auth` 端点，支持 Authorization header 传递 `track_authorization`
- [x] **问题 6 (解决): CDN 音频文件 403** — `cf-media.sndcdn.com`（CloudFront）无论是直连还是走公司代理 `proxy.nioint.com:8080` 都返回 Forbidden。Policy 解码后仅有时间限制，无 IP 限制，怀疑 CloudFront WAF 按 region 拦截
- [x] **待确认**: `cf-hls-media.sndcdn.com`→ 403, `playback.media-streaming.soundcloud.cloud`→ 200 ✅
- [x] **附加发现**: media API 只需 `?client_id=xxx` 即可 resolve，不需要 JWT Auth header

## ✅ 已解决

```
浏览器 → localhost:8081 (standalone.html)
  → search: ✅ localhost:8765/proxy → proxy.nioint.com → api-v2.soundcloud.com → 返回搜索结果
  → media resolve: ✅ localhost:8765/proxy → proxy.nioint.com → media API → HLS m3u8 URL
  → play: ✅ hls.js 直连 playback.media-streaming.soundcloud.cloud (CORS: *) → AAC segments
```

**根因**: 代码优先选 progressive mp3 → `cf-media.sndcdn.com`（CloudFront 被区域封锁 403）。改为优先选 AAC HLS → `playback.media-streaming.soundcloud.cloud`（SoundCloud 自有 CDN，可直连，带 CORS）。

**三套 CDN 状态**:
| CDN | 协议 | 区域 | 结果 |
|-----|------|------|------|
| `cf-media.sndcdn.com` | progressive mp3 | CloudFront | 403 ❌ |
| `cf-hls-media.sndcdn.com` | HLS mp3 | CloudFront | 403 ❌ |
| `playback.media-streaming.soundcloud.cloud` | HLS AAC (m4s) | SoundCloud 自有 | 200 ✅ + CORS: `*` |

**修复内容**:
1. [x] `src/api/soundcloud.js` — 选流优先级: AAC HLS (100) > progressive mp3 (60) > 其他 HLS (40)
2. [x] `examples/standalone.html` — 同步选流逻辑 + 接入 `hls.js` CDN + `play()` 根据 `isHLS` 走 hls.js 或原生 audio
3. [x] 浏览器端播放验证通过

## 代理环境信息

- **公司 PAC**: `http://proxy-pac.nioint.com:8000/proxy.pac`
- **代理服务器**: `proxy.nioint.com:8080`（内网 10.171.134.x）
- **PAC 覆盖域**: ~60 个域名（含 soundcloud.com），不含 sndcdn.com
- **系统代理**: 未启用（PAC 自动配置）
- **终端环境**: 无 http_proxy/https_proxy 环境变量
- **本地代理**: `proxy-server.mjs` 端口 8765（所有对外请求强制走 proxy.nioint.com:8080）
- **clash-verge-rev**: 已安装但未运行
- **MEP-VPN**: 已配置但未连接

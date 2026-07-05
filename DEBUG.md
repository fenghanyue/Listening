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
- [ ] **问题 6 (阻塞): CDN 音频文件 403** — `cf-media.sndcdn.com`（CloudFront）无论是直连还是走公司代理 `proxy.nioint.com:8080` 都返回 Forbidden。Policy 解码后仅有时间限制，无 IP 限制，怀疑 CloudFront WAF 按 region 拦截
- [ ] **待确认**: `cf-hls-media.sndcdn.com`（HLS CDN）是否同样 403

## 当前卡点

```
浏览器 → localhost:8081 (standalone.html)
  → search: ✅ localhost:8765/proxy → proxy.nioint.com → api-v2.soundcloud.com → 返回搜索结果
  → media resolve: ✅ localhost:8765/proxy-auth (带 JWT) → proxy.nioint.com → media API → CDN 签名 URL
  → play: ❌ localhost:8765/stream → proxy.nioint.com → cf-media.sndcdn.com → 403 Forbidden
```

**关键矛盾**: 用户说在 `soundcloud.com` 网站上可以直接播放，但我们的 curl/Node 请求相同 CDN 返回 403。需要排查浏览器端到底走的什么链路。

## 下一步

1. [ ] 在 soundcloud.com 页面打开 Chrome DevTools (Cmd+Option+I) → Network，播放一首歌，看 mp3/m3u8 请求的 Remote Address — 是走 `proxy.nioint.com:8080` 还是直连？
2. [ ] 确认 CDN 403 是因为 Referer/Origin header 还是 IP 限制
3. [ ] 如果 CDN 走的是浏览器 PAC 规则之外的代理（比如系统 VPN），调整 proxy-server 的上游代理
4. [ ] 播放成功后，commit 所有改动

## 代理环境信息

- **公司 PAC**: `http://proxy-pac.nioint.com:8000/proxy.pac`
- **代理服务器**: `proxy.nioint.com:8080`（内网 10.171.134.x）
- **PAC 覆盖域**: ~60 个域名（含 soundcloud.com），不含 sndcdn.com
- **系统代理**: 未启用（PAC 自动配置）
- **终端环境**: 无 http_proxy/https_proxy 环境变量
- **本地代理**: `proxy-server.mjs` 端口 8765（所有对外请求强制走 proxy.nioint.com:8080）
- **clash-verge-rev**: 已安装但未运行
- **MEP-VPN**: 已配置但未连接

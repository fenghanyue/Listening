# 自动测试

用 Playwright 打开页面，直接调页面组件的方法来测，网页版和 APK 的主要功能都覆盖到。APK 部分靠注入一个
假的 Capacitor 原生壳来模拟，不需要真手机。

## 怎么跑

在仓库根目录：

```bash
npm test                              # 全部
node tests/run.mjs smoke qq-cover     # 只跑这几个
```

`run.mjs` 会在随机端口起 `server.mjs`，依次跑测试，跑完关掉服务器并汇总。单独调试某一个时，也可以自己先
`PORT=4555 node server.mjs`，再 `node tests/<名字>.test.mjs`。截图存在系统临时目录下的 `listening-tests/`
（可以用环境变量 `TEST_OUT` 改）。

## 需要 Playwright

根目录 `package.json` 保持零依赖（Render 部署用），所以 Playwright 不写进项目依赖：

- Claude Code 云端环境自带，直接能跑。
- 本机：在仓库根目录 `npm i --no-save playwright && npx playwright install chromium`。装在根目录的
  `node_modules/` 里，已经被 `.gitignore` 忽略，也不会改动 `package.json`。
- 也可以用环境变量 `PLAYWRIGHT_MODULE` 指向别处装好的 Playwright（它的 `index.mjs`）。

## 各个测试

| 文件 | 测什么 | 联网 |
|---|---|---|
| `smoke` | 拦掉所有 CDN 后页面照常启动，字体都从本地加载，图标都显示成图形 | 不用 |
| `layout` | 手机竖屏 / 横屏、平板、电脑四种尺寸走一遍所有页面、播放页和弹窗：没有东西伸出屏幕、分栏对、顶栏和播放键的尺寸位置对、安全区让开了、纯图标按钮有读屏名字；每屏存一张截图 | 不用 |
| `queue` | 播放队列里的 ×：只移出队列，曲库、歌单、喜欢都不动；移出正在放的那首会换到下一首（在放接着放、暂停停住），移空了就什么都不放；断网时跳过没缓存的 | 不用 |
| `qq-cover` | QQ 封面按 https 用；APK 里已缓存的歌后台补存封面 | 有一项调 QQ 接口 |
| `playlist` | 建歌单、导出导入、播放全部、移出歌单、上一首 / 下一首 | 网易云搜索 |
| `native` | 模拟 APK：沉浸式状态栏、电池提示、检查更新、通知栏 / 锁屏控制、拔耳机、返回键、导出和分享 | 网易云搜索、播放 |
| `offline` | 已缓存标记和列表、断网只播缓存、离线搜索、缓存上限、一键缓存、删除缓存 | 网易云搜索、播放、下载 |

联网的测试用的是网易云 / QQ 的真实接口：接口挂了、限流了、换了格式，测试也会失败。失败时先看是哪一步、
报的什么错，再判断是不是代码的问题。

## 写新测试

- 文件名用 `<名字>.test.mjs`，`run.mjs` 会自动找到。
- 公共部分在 `lib.mjs`：
  - `launchBrowser()` 开浏览器（有 `HTTPS_PROXY` 时自动走代理）。
  - `logicDriver(page)` 返回 `L(代码字符串, 参数)`：代码里能用 `logic`（页面组件实例）和 `arg`，可以直接调
    它的方法、读 `logic.state` 和 `logic.renderVals().v`（模板用到的值）。
  - `createChecker()` 返回 `check(名字, 是否通过, 附带信息)` 和最后用的 `finish()`。
- 模拟 APK 的写法见 `native.test.mjs` 开头注入的 `window.Capacitor`。

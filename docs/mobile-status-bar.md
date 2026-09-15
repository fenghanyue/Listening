# 手机端状态栏（通知栏）：能做什么，不能做什么

> 记录时间：2026-09 ｜ 验证设备：安卓 + Edge 安装的 PWA

## 结论

**纯 PWA 在安卓上做不到通知栏沉浸**（内容画到状态栏底下），**状态栏颜色也不受页面控制**。

`manifest.json` 的 `theme_color`、页面里的 `<meta name="theme-color">`，这两条路实测都无效。
想要沉浸只能套原生壳，见文末。

---

## 一、真机实测到的事实

以下都是在真机上看到的，不是查文档推出来的：

- 系统状态栏在 App 的**两个主题下都是白底黑图标**，不是 `manifest.json` 里的 `theme_color`（`#1D1B20`）。
- `manifest.json` 从 2026-07-11 加进仓库那天起 `theme_color` 就没改过，所以排除
  "WebAPK 安装时烘焙了旧值" 这种解释。
- 运行时修改 `<meta name="theme-color">` 对安装版 PWA 的状态栏**没有任何效果**。
- **那条状态栏跟的是手机系统的深浅色设置**，和 App 自己的主题开关无关——把系统切到深色模式，
  状态栏就变深。

由此推出：**App 主题和系统主题不一致时必然错配**，且页面无法干预。比如系统浅色 + App 夜间，
就会是一条白色状态栏压在深色 App 上。

## 二、为什么网页做不到

核心原因只有一条：**网页不拥有 Android 窗口。**

原生 App 可以调 `WindowCompat.setDecorFitsSystemWindows(window, false)` 并把 `statusBarColor`
设成透明，自己的内容就铺到状态栏底下，系统再把时间/电量图标画在最上层。网页是跑在浏览器划定的
那块区域里的内容，**视口从哪里开始由浏览器决定**。

所以 `env(safe-area-inset-top)` 在安卓上返回 0 不是代码写错了，是**真的没有 inset 可报**。

浏览器给自己的内部页面开了后门（Edge 安卓版新标签页的壁纸就铺到状态栏底下，系统图标浮在上面），
但不给第三方页面和 PWA 开：

- Chrome 135+ 的 edge-to-edge **只管底部手势导航条**。
  [官方迁移指南](https://developer.chrome.com/docs/css-ui/edge-to-edge)原话是
  "the status bar remains fixed at the top"。
- 让**安装版 PWA** 也能 edge-to-edge 的 Chromium 工作，截至 2026-07 仍是 **In Progress，
  没有发布时间表**（[报道](https://tech-ish.com/2026/07/15/google-chrome-for-android-pwa-edge-to-edge/)）。

补充一条容易误导人的地方：[MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/theme_color)
写的是 `<meta name="theme-color">` 可以按页覆盖 manifest 的 `theme_color`。**这是规范意图，
Chromium 在安卓 WebAPK 上并没有这么实现。**别照着 MDN 推断行为。

## 三、试过且无效的两条路——别再试了

### 1. 把 `<meta name="theme-color">` 改成跟主题动态切换

安装版 PWA 忽略这个 meta，净效果为零。它**只对浏览器标签页的地址栏着色有效**。

### 2. 把顶栏钉死成 manifest 的 `#1D1B20`，去和状态栏对齐

前提就不成立——状态栏根本不是这个颜色。而且**有害**：

| | 状态栏 | 顶栏 | 观感 |
|---|---|---|---|
| 白天·改之前 | 白 | `#F7F2FA` 近白 | 本来就是连续的 |
| 白天·钉死后 | 白 | `#1D1B20` 黑 | 白 → 黑 → 浅，凭空多一条黑带 |
| 夜间·改前改后一样 | 白 | 深 | 一直不匹配 |

白天模式原本是好的，钉死反而改坏了。已回退。

## 四、代码里相关的地方

- `examples/Listening Player.dc.html` 的 `<head>` 里，`.dc-topbar` 那段
  `padding-top: env(safe-area-inset-top, 0px)`：**当前所有平台这个 inset 恒为 0，是死代码**，
  渲染结果和没写一样。留着是因为一旦套上原生壳、或 Chromium 把 PWA edge-to-edge 修好，
  它就是现成的正确布局，不用再改。同一段里 `.dc-sidebar` 的 `top` 也跟着它走。
- 同文件的 `syncThemeChrome()`：它写 `theme-color` meta **只对浏览器标签页的地址栏有用**，
  对安装版 PWA 无效。

## 五、以后真要做：Capacitor 原生壳的正确入口

网上大量资料已经过时，会把人带沟里。截至 2026-09：

- ❌ `StatusBar.setBackgroundColor()` 在 **Android 16 上已是 no-op**；`setOverlaysWebView()`
  同样失效。**别用这两个。**
- ✅ **Capacitor 8.3.2+ 自带 edge-to-edge**。Android 15 / API 35 起系统层面强制，
  Android 16 连 `windowOptOutEdgeToEdgeEnforcement` 这条退路都没了。
- ✅ 状态栏那块颜色**不由原生 API 设，而是用自己的 HTML 元素加 safe-area 内边距去填**——
  `.dc-topbar` 那段 padding 就是现成的，背景本来就绑着 `{{ v.c.surfaceLow }}` 跟主题走。
- ✅ 图标明暗用 `SystemBars.setStyle()`，运行时可切，夜间/白天都能对上。
- ⚠️ 安全区取值用 `var(--safe-area-inset-top, env(safe-area-inset-top, 0px))`——
  Android WebView < 140 的 `env()` 有 bug，Capacitor 8.3.0 起会注入 `--safe-area-inset-*`
  平行变量兜底。

参考：[Capacitor Edge-to-Edge & Safe Areas 指南](https://capawesome.io/blog/capacitor-edge-to-edge-and-safe-areas-guide/)

### 打包方式的成本差异

`SC_PROXY`（`src/api/soundcloud.js`）和 `NETEASE_PROXY`（`src/api/netease.js`）现在都是空串，
走相对路径、同源。所以：

- **瘦壳**（`capacitor.config` 的 `server.url` 指向线上实例）：页面 origin 就是线上域名，
  代理的相对路径原样能用，**API 层零改动**。代价是必须联网才能打开，Render 免费实例休眠后
  冷启动要等 10~30 秒。
- **内置页面**（HTML 打进 APK）：秒开，但 origin 变成 localhost，得把两个 PROXY 常量改成绝对
  地址、重新 `npm run build`，还要确认 `server.mjs` 的 CORS 头放行。活多不少。

## 六、方法论教训

这类平台行为**只能靠真机截图定案**。

排查这个问题时，前两轮诊断都是靠检索资料推断的，两次都错了：先是误以为"安卓安装版会响应运行时
theme-color"，又误以为"状态栏取 manifest 的 theme_color"。而且实际用的是 **Edge** 装的 PWA，
行为和检索到的 Chrome 资料并不一致。

下次再碰这块，先要一张真机截图，再动代码。

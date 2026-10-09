# 手机端状态栏（通知栏）：能做什么，不能做什么

> 记录时间：2026-09 ｜ 验证设备：安卓 + Edge 安装的 PWA
>
> 2026-10 更新：**安卓 APK 已经做到沉浸**（第五节）。下面一到四节说的是纯网页 / PWA，结论没变。
> APK 的整体说明见 [android-app.md](android-app.md)。

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

- `examples/Listening Player.dc.html` 的 `<head>` 里，`.dc-topbar` 那段 `padding-top`：安全区取值是
  `var(--safe-area-inset-top, env(safe-area-inset-top, 0px))`。**网页版 / PWA 里这个值恒为 0**，渲染和
  没写一样；APK 里是原生壳注入的状态栏高度，顶栏的底色就一路铺到状态栏下面。全屏播放页、底部迷你播放条、
  弹层、提示条的避让都是同一套写法；横过来的手机导航栏和刘海在侧边，左右两边也按 `--safe-area-inset-left / right` 让开。
- 同文件的 `syncThemeChrome()`：它写 `theme-color` meta **只对浏览器标签页的地址栏有用**，
  对安装版 PWA 无效；APK 里它另外调 `SystemBars.setStyle` 切状态栏图标的深浅。

## 五、APK 里是怎么做的（Capacitor 8.5.2）

原来这一节是"以后真要做的正确入口"，照着做的时候读了 Capacitor 8.5.2 的源码，发现有两条说错了，
已经改正：

- ❌ `StatusBar.setBackgroundColor()` 在 **Android 16 上已是 no-op**；`setOverlaysWebView()` 同样失效。
  **别用这两个。**（没变）
- ⚠️ ~~Capacitor 8.3.2+ 自带 edge-to-edge~~：自带的 `SystemBars` 插件（`insetsHandling: "css"`）**只在
  WebView ≥ 140 且页面写了 `viewport-fit=cover` 时**才真的让页面铺到状态栏下面；更老的 WebView 是给整个
  窗口加内边距——**不沉浸**。Android 14 及以下它也不会替你打开 edge-to-edge。
- ⚠️ ~~Capacitor 8.3.0 起会注入 `--safe-area-inset-*` 给 WebView < 140 兜底~~：只有在上面那种"真的铺满"
  的情况下注入的才是真实高度；WebView < 140 时注入的**全是 0**。国产系统自带的 WebView 经常偏旧，
  这条路在不少手机上等于没沉浸。

所以 APK 里关掉了自带的处理，自己做（代码在 `mobile/android/.../MainActivity.java`）：

1. `capacitor.config.json` 里 `SystemBars.insetsHandling: "disable"`。
2. `MainActivity` 调 `EdgeToEdge.enable`，状态栏、导航栏都透明，任何 Android 版本都铺满窗口。
3. 监听窗口 insets，把状态栏 / 导航栏 / 刘海的高度（dp）注入成 `<html>` 上的 `--safe-area-inset-*`，
   页面每次加载完再补一次；键盘弹出时给窗口底部加键盘高度的内边距，底部弹层里的输入框不会被盖住。
4. 页面一律用 `var(--safe-area-inset-*, env(safe-area-inset-*, 0px))` 取值——APK 里取注入的真实值，
   网页版取不到变量就退回 `env()`（也是 0），不用分两套 CSS。
5. 状态栏那块颜色**不由原生设**，就是页面自己的顶栏 / 播放页背景铺上去的，天然跟主题走；系统只画图标，
   图标深浅用 `SystemBars.setStyle()` 按 App 主题切（黑底 `DARK` = 浅色图标，白底 `LIGHT` = 深色图标）。
   App 默认白底，原生壳启动时就是透明系统栏配深色图标（`MainActivity` 的 `SystemBarStyle.light`、
   `capacitor.config.json` 的 `SystemBars.style: "LIGHT"`）；`<head>` 的首屏脚本再按存的主题切一次，免得选了黑底的人
   第一屏是看不见的深色图标。安卓 8 以下导航栏图标只能是白的，那里垫一层半透明黑，不然白底上看不见。

页面是打进 APK 的（不是瘦壳指向线上），代价和取舍见 [android-app.md](android-app.md) 第五节。

## 六、方法论教训

这类平台行为**只能靠真机截图定案**。

排查这个问题时，前两轮诊断都是靠检索资料推断的，两次都错了：先是误以为"安卓安装版会响应运行时
theme-color"，又误以为"状态栏取 manifest 的 theme_color"。而且实际用的是 **Edge** 装的 PWA，
行为和检索到的 Chrome 资料并不一致。

下次再碰这块，先要一张真机截图，再动代码。

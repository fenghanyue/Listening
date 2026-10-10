# 迷你播放器（电脑网页版）

电脑上的 Chrome / Edge 在「正在播放」栏音量那一排点「迷你播放器」按钮，播放器会单独弹成一个浮在所有窗口最上面的
小窗。用的是浏览器的 [Document Picture-in-Picture](https://developer.chrome.com/docs/web-platform/document-picture-in-picture)
接口：Firefox、Safari、手机浏览器和 APK 里都没有这个接口，按钮也就不出（`canMiniPlayer`）。

## 小窗里有什么

- 固定 420×140：左边封面；右边第一行歌名 + 歌手 — 专辑，最右边「回到网页」；第二行当前这句歌词；第三行五个键
  （播放模式、上一首、播放 / 暂停、下一首、播放队列）；最上沿一道进度细线，点哪儿跳到哪儿。空格键播放 / 暂停。
- 点「播放队列」，窗口加高到 460，队列在整个播放器上面，每行上移 / 下移 / 移出队列，点一行放那首；再点一下收起。
- 一句歌词放不下：字号不变，在唱这一句的时间里往左滑。前 15% 停在句首，到 80% 滑到句尾，还藏着字的那一头淡出；
  位置只看播放进度，所以暂停会停住、拖进度条会跟着跳。系统开了「减少动态效果」就不滑，唱到一半直接换成句尾。
- 跟着主页面的黑白主题；暂停时换了当前曲目也会自己去补歌词。

## 浏览器的限制

下面这些都在有界面的 Chromium 141（Xvfb 虚拟屏 + openbox 窗口管理器 + xdotool 发真鼠标事件）里试过：

- **只能按住标题栏拖**：小窗顶上那条显示网址、右边有 × 的深色标题栏是 Chrome 画的，按住它能拖。按住封面、空白处拖不动；
  `app-region: drag` 在这种小窗里不管用（点下去照样算点网页）；网页也挪不了它（`moveTo` / `moveBy` 被忽略，Chrome
  文档也写明网站不能设置小窗的位置）。
- **大小锁不住**：用户总能拖边框。内容是固定尺寸、贴在左上角，拖大了不变形；`resizeTo` 只能在用户刚点过小窗时调，
  而且调一次就把这次点击"用掉"，一次点击只能改一回大小。所以 `fitMiniPlayer` 放在点击处理的最后、只调一次，
  顺带把被拖大拖小的窗口改回固定尺寸。
- **位置 Chrome 按网站记**：关掉再开，出现在上回关掉时的位置、上回的大小；只记到关浏览器为止，重启后回到屏幕右下角；
  别的网站的小窗不影响它。所以不加 `preferInitialWindowPlacement`（加了每次都回右下角）。上回是开着队列关的，这回
  窗口是高的，打开时就把队列也展开，免得下面空一大块。
- **窗口变高往哪边长由 Chrome 定**：下面放不下就把窗口往上推（看起来是队列从上面弹出来），放得下就往下长、播放器跟着
  往下挪。收起时窗口从下往上缩，停在被推上去的地方，网页挪不回去。
- **两个返回键只留一个**：Chrome 自带的「返回标签页」用 `disallowReturnToOpener: true` 藏掉，用小窗里自己的「回到网页」。
  它调 `window.focus()` 要用这次点击的手势，所以在它前面不能改窗口大小。

## 代码在哪

全在 `examples/Listening Player.dc.html`：

- `toggleMiniPlayer`：开窗、把主页面 `<head>` 里的样式整份搬过去、搭节点、绑事件。小窗里的内容不归 dc-runtime 模板管。
- `syncMiniPlayer`：每次渲染完（`componentDidUpdate`）按状态改小窗里的节点，没变的不碰。歌名等外面接口来的字一律用
  `textContent` 填，不用 `innerHTML` 拼。
- `mpLyricFrame`（长歌词滑动）、`fitMiniPlayer`（改回固定尺寸）、`toggleMiniPlayerList` / `centerMiniPlayerRow`（播放队列）。
- 样式是 `.sw-mp-*`；尺寸常量 `MINI_PLAYER_W / MINI_PLAYER_H / MINI_PLAYER_LIST_H` 和 CSS 里的宽高是同一组数，改一处要改另一处。

## 测试

- 自动测试是 `tests/miniplayer.test.mjs`（不联网）。没界面的 Chromium 里小窗开出来跟主窗口一样大、`resizeTo` 不生效，
  用 `setViewportSize` 模拟窗口大小。
- **不能用 Playwright 的 `page.route` / `ctx.route` 拦请求**：一拦，搬到小窗里的样式表就加载不出来（图标变成一串英文）。
  要查有没有联网就只监听。
- 拖动、记位置、窗口往上推这些只能在有界面的浏览器里看。容器里可以 `apt-get install openbox xdotool`，在
  `xvfb-run` 里先起 openbox（没有窗口管理器标题栏拖不动），再用 Playwright 开有界面的 Chromium、用 xdotool 拖。
  启动参数别带 `--window-size` / `--window-position`，它们会连小窗一起改。

# 听音乐（Listening）维护说明

同一个页面有两个出口：**网页版**（Render 部署 main 分支）和**安卓 APK**（`mobile/`，Capacitor 8.5.2，
GitHub Actions 打包发布）。两者的关系、APK 的原理和取舍见 [docs/android-app.md](docs/android-app.md)。

## 改代码的规矩

- **页面只有一份**：`examples/Listening Player.dc.html`，网页版和 APK 共用，改一处两边都变。
  - 只在 APK 里生效的逻辑放在 `IS_NATIVE` 判断后面，网页版走原来的逻辑。
  - 调原生插件用页面里的 `nativeHas` / `nativeCall` / `nativeListen`，不要引入 `@capacitor/core`。
- **改了 `src/api/*.js`**：跑 `npm run build` 重新生成 `examples/api-bundle.js`，两个文件一起提交。
- **不许引用外网的脚本、样式、字体**：APK 要断网也能打开。新依赖放进 `examples/vendor/`，用
  `scripts/vendor-assets.mjs` 下载并校验；`mobile/scripts/build-www.mjs` 打包时发现外链会直接报错。
- **外部图片、音频地址用 https**：APK 里 http 资源会被拦（WebView 不放行混合内容，安卓默认也禁止
  明文 http）。封面统一过 `httpsCover()`。
- **安全区写 `var(--safe-area-inset-*, env(safe-area-inset-*, 0px))`**，不要直接写 `env(...)`：
  APK 的沉浸式状态栏靠 `MainActivity` 注入这些变量。
- **用户数据只在本地**：歌单、喜欢、缓存都存在浏览器 / App 本地（localStorage、IndexedDB），没有服务器
  备份。改存储的键名或数据结构必须兼容旧数据；歌单导出串（`LSNPL1:` / `LSNPL2:`）要一直能导入。
- **`server.mjs` 两边都依赖**：网页版的页面和代理都在它上面，APK 的代理也指向 Render 上的它
  （`LISTENING_PROXY_BASE`）。改了要等合并到 main、Render 部署后才生效。
- **根目录 `package.json` 保持零依赖**（Render 部署用），安卓相关依赖只放 `mobile/package.json`。
- **界面上的字（中文 / English）**：都在页面的 `STRINGS` 表里，每条是 `[中文, English]` 一对，新加的字两种语言都要写；
  模板里写 `{{ L.键名 }}`，代码里写 `tr('键名', 参数…)`（不叫 `t`：页面里到处拿 `t` 当曲目变量）。歌名、歌手、专辑、歌词、
  用户起的歌单名不翻；内置「喜欢的音乐」存的还是中文名，显示走 `playlistLabel`；切歌诊断记录（`diagLog`）一直是中文。
  断行用 `overflow-wrap: anywhere`，别用 `word-break: break-all`（英文单词会从中间断开）。
- **字体**：西文和数字用 TeX Gyre Heros（Helvetica 的开源复刻，`examples/vendor/fonts-heros.css`；`node scripts/vendor-assets.mjs heros`
  只更新这一项），只有常规和粗体；中文用手机自带的字体。
- **图标**：Material Symbols 连字字体（`<span class="ms">play_arrow</span>`，字体把这个词画成图标），只打包页面用到的那些，
  名单是 `scripts/vendor-assets.mjs` 的 `ICONS`（整套 2.3MB，网页版每次打开都要重新下，国内网慢时会露出满屏英文名字）。
  加新图标先加进名单，再跑 `node scripts/vendor-assets.mjs icons` 重新生成 `examples/vendor/fonts-icons.css` 和字体；
  漏了的话那个图标是一片空白，`node tests/run.mjs icons` 会报错。图标名要写成测试认得出的样子：直接写在
  `<span class="ms">名字</span>` 里，或者写成字符串放进模板 `{{ }}` 取的那个键、`…_ICONS` 数组里。字体到之前 `<html>` 上挂着
  `ms-loading`，图标先空着、只占一个图标的位置（head 里图标样式表后面那段脚本 + helmet 里 `html.ms-loading .ms`）。
- **界面（瑞士风格）**：颜色只在 `<head>` 里 `html[data-app-theme="light|dark"]` 的 CSS 变量定义一处（`--bg`、`--ink`、`--red`…），
  别处不写死色值；部件样式写在 `<helmet>` 里，类名用 `sw-` 前缀；`dc-` 开头的类是逻辑和测试找元素的钩子，别改名。
  默认白底：改了白底的 `--bg`，`mobile/` 里的 `colors.xml`、`capacitor.config.json` 和 `examples/manifest.json` 要一起改。
- **模板（dc-runtime）的坑**：
  - 不在 `examples/support.js` 的 `EVENT_MAP` 里的事件（拖拽、指针等）要写成驼峰，如 `onDragStart`、`onPointerDown`；
    写成全小写不会报错，但事件根本绑不上。
  - 通用重置（`button`、`a` 等）只用元素选择器；写成 `.dc-app-shell button` 会盖掉 `sw-` 类的底色。
  - 顶栏的 `padding-top`（状态栏安全区）写在 `<head>` 的 style 里，helmet 里只能写 `padding-left/right`，不能用 `padding` 简写。
- **键盘**：别在页面里按可视区域尺寸猜键盘开没开（v1.0.10 这么做过，结果一点搜索框键盘就收回）。APK 里键盘收起时，
  `MainActivity` 会派发 `listening:ime-hidden`，见 [docs/mobile-status-bar.md](docs/mobile-status-bar.md)。
- **安卓原生代码**：容器里没有安卓 SDK，`MainActivity` 等 Java 改动只能靠 Actions 打包来验证能不能编译；
  资源 XML 的注释里不能出现 `--`（比如写了个 CSS 变量名），否则打包直接失败。
- **安卓的字**：`res/values/strings.xml` 是中文（默认），`values-en/strings.xml` 是英文系统用的，新加一条两边都要写。
  App 图标下面的名字跟手机系统的语言走（英文系统叫 Listening），App 里的语言开关管不到。
- **桌面挂件**（`PlayerWidget`，只在 APK）：页面通过 `AppShell.updateWidget` 报显示的内容，挂件的键以 `widgetCommand`
  事件回到页面（`handleWidgetCommand`），来龙去脉见 [docs/android-app.md](docs/android-app.md) 第五节。清单里 `PlayerWidget` 要
  `exported="true"`（不公开时 ColorOS 的「卡片」列表里找不到），按键走不公开的 `PlayerWidgetCommands`。布局只能用桌面认得的
  控件（LinearLayout、FrameLayout、TextView、ImageView 等，普通 `View` 也不行）；颜色在 `colors.xml` 的 `widget_*`，
  跟页面白底主题那几个颜色同步改；改了布局要重画两张预览图（安卓 12 以下挂件列表里用）：`drawable-nodpi/` 和 `drawable-en-nodpi/`
  的 `widget_preview.png`。挂件上的字跟着 App 里选的语言（`updateWidget` 带着 `lang`），布局里写的 `@string` 只跟系统语言走，
  所以字要在 `PlayerWidget.render` 里按语言重设一遍。
- **电脑上的两样**（手机上看不到）：
  - 宽屏歌词栏（屏幕宽 1600 以上才出，三栏：当前页 | 播放栏 | 歌词）：断点只在 JS 的 `LYRICS_COL_QUERY` 写一处，
    CSS 跟着 shell 上的 `has-lyrics-col` 走。
  - 迷你播放器小窗（Document Picture-in-Picture，只有电脑上的 Chrome / Edge 有，APK 里不出）：里面的节点不归模板管，在 `toggleMiniPlayer` 里搭好，`syncMiniPlayer`
    每次渲染完按状态改；样式也写在 helmet 里（`.sw-mp-*`），打开时整份搬过去；外面接口来的文字只用 `textContent` 填；
    尺寸常量 `MINI_PLAYER_*` 和 CSS 是同一组数。浏览器的限制见 [docs/mini-player.md](docs/mini-player.md)。

## 测试

改完先跑 `npm test`（会自己起本地服务器），说明见 [tests/README.md](tests/README.md)。大部分测试会调
网易云 / QQ 的真实接口，接口本身挂了也会报错，先看失败信息再判断是不是代码的问题。

- 改界面先跑 `node tests/layout.test.mjs`：不联网，用手机、横屏、平板、电脑、宽屏电脑五种尺寸各走一遍（中文、英文各一遍，
  英文那遍界面上还有中文就算漏翻），截图存在系统临时目录的 `listening-tests/`。
- 改了界面上的字先跑 `node tests/i18n.test.mjs`：不开浏览器，几秒钟，查 `STRINGS` 有没有漏写英文、键名写错、哪条没用上。
- 加了、换了图标先跑 `node tests/run.mjs icons`：不联网，十几秒，查页面用到的图标名都在 `ICONS` 里、仓库里的字体都画得出来，
  图标字体下得慢时图标空着（不露英文名字）、字体到了版面不跳。`layout` 也会查每一屏的图标都画成了图标。
- Playwright 模拟不了真手机上的键盘、WebView 和状态栏。这类改动先推分支出预览版，让用户在手机上试。
- 迷你播放器（电脑 Chrome / Edge 的小窗）：测它不能用 Playwright 拦请求，一拦小窗的样式就加载不出来；拖动、记位置
  这些要在有窗口管理器的真窗口里试。浏览器的限制和试法见 [docs/mini-player.md](docs/mini-player.md)。
- 不联网的测试会被页面自己的两处联网绊倒：宽屏歌词栏或小窗开着时，暂停换了当前曲目会去补歌词；真放音频时会预取下一首。
  测试里把 `ensureLyricsForCurrent` / `prefetchTrack` 换成空函数（layout、miniplayer 就是这么做的）。
- 联网的几组时好时坏：native 的两项导出检查要在 90 秒内下完一整首歌；第三方搜索接口有时对所有关键词都返回空数组。
  失败了先用 curl 直接调一下接口，再判断是不是代码的问题。

## 发版

- 推到 `claude/**` 分支：Actions 自动打 APK，覆盖 `apk-preview` 预览版，可以先在手机上试。
- 合并到 `main`：Render 自动部署网页版；Actions 自动发正式版 `v1.0.<构建号>`，App 里「检查更新」
  会提示。只有改了 `examples/`、`src/`、`mobile/` 或工作流本身才会打包。
- 惯例：推分支出预览版，用户在手机上试过、说可以了，再开 PR 用合并提交合进 main。合并提交的标题写成
  `Merge pull request #N: 一句用户看得懂的话`，正式版发布说明的第一行就是这个标题。
- 只改电脑网页版的东西（宽屏、迷你播放器这类手机上看不到的）没法先在手机上试：效果图、截图和真窗口实测结果给用户看，
  用户说可以再开 PR 合进 main，Render 部署完才能在电脑上用。
- 签名钥匙只在仓库的 Actions Secrets 里，不在仓库里，也不要放进仓库。容器里没有这把钥匙：不要在本地
  用别的钥匙打包给用户安装——签名不同就没法覆盖安装，只能卸载、丢数据。要给手机装包就走 CI。
- 版本号就是构建号，自动递增，不用手动改。

# 安卓 APK

> 记录时间：2026-10 ｜ 壳：Capacitor 8.5.2 ｜ 工程目录：[`mobile/`](../mobile)

## 先看这里：网页版和 APK 是什么关系

**代码是同一份，数据各存各的。**

| | 网页版（浏览器 / PWA） | APK |
|---|---|---|
| 页面代码 | `examples/Listening Player.dc.html` | 同一个文件，打包时拷一份进去 |
| 歌单、喜欢的音乐、缓存的歌、设置 | 存在浏览器里 | 存在 App 里；两边互相看不到，也不同步 |
| 怎么用上新版 | 合并到 main → Render 重新部署 → 重新打开页面 | 合并到 main → Actions 自动打包 → App 里提示 → 覆盖安装 |
| 断网能不能打开 | 不能 | 能，放缓存过的歌 |
| 要不要 Render 服务器 | 页面和代理都在上面 | 网易云专辑名、短链导入、SoundCloud 的歌要用；网易云和 QQ 的搜索、播放不用 |

由此带来几件事：

- **改页面，两边都变。** 只在 APK 里生效的功能都藏在 `IS_NATIVE` 判断后面：沉浸状态栏、通知栏 / 锁屏 /
  耳机按键控制、锁屏后连续播放、返回手势不停歌、拔耳机暂停、检查更新、系统分享。
- **离线那几样网页版也有**：「已缓存」小勾和歌单、「缓存全部」、「缓存与离线」面板；React 和字体也改成从
  自己的服务器加载。网页版要等合并到 main 才有这些。
- **改了 `server.mjs`，APK 也要等合并到 main 才生效**，因为 APK 用的是线上那台服务器。比如短链导入要靠它放行
  一个响应头，合并之前 APK 里短链导入会失败。
- **两个可以装在同一台手机上，数据互不影响。** 从网页版换到 APK，歌单要手动搬一次（见第二节）。

## 第一次用：按顺序做

1. **配签名钥匙**：在 GitHub 里填 4 个 Secrets（见第四节「签名钥匙」）。不配也能打包，但只出临时签名的
   测试包，不发布。
2. **拿预览版**：GitHub → Actions → Android APK → Run workflow，选要试的分支；跑完到
   [apk-preview](https://github.com/fenghanyue/Listening/releases/tag/apk-preview) 下载。
3. **装上、搬歌单**：见第一、二节。
4. **试了没问题，合并到 main**：自动发正式版，固定下载地址会指向它；网页版同时更新。

---

## 一、安装和升级

**下载地址（永远是最新版）**：<https://github.com/fenghanyue/Listening/releases/latest/download/listening.apk>

手机浏览器打开这个地址，下载完点开安装；第一次会提示"允许安装未知应用"，给浏览器放行一次即可。

以后有新版，App 启动时会提示，点「下载新版」→ 安装，**直接覆盖**旧版，歌单和缓存都在。
也可以在「缓存与离线」面板底部点「检查更新」。

⚠️ **别卸载**。歌单、喜欢的音乐、缓存的歌都存在 App 自己的数据里，卸载就全没了。覆盖安装没问题——
前提是新旧两个包用的是同一把签名钥匙（CI 用的是同一把，见第四节）。如果哪天提示"签名冲突 / 与已安装的
应用不一致"，先别卸载，把歌单导出成字符串存好再说。

还没合并到 main 的改动有预览版：<https://github.com/fenghanyue/Listening/releases/tag/apk-preview>，
和正式版用同一把钥匙，可以互相覆盖安装。

## 二、从网页版（PWA）搬过来

PWA 和 APK 的数据**互相看不到**（浏览器和 App 各存各的），要手动搬一次：

1. **歌单**：在 PWA 里打开每个歌单（包括「喜欢的音乐」）→「导出歌单」，字符串会复制到剪贴板；
   到 APK 里点侧栏「导入」→ 粘贴 → 歌单名称按需填（留空就是整体替换「喜欢的音乐」）。
2. **缓存的歌**：没法搬，得重新下。在歌单页点「缓存全部」，连着 Wi-Fi 一次下完。

## 三、离线怎么用

- **看哪些歌能离线放**：列表里歌名下面带小勾的就是已缓存的；侧栏最上面的「已缓存」是全部已缓存的歌，
  按最近播放排序，可以一键播放、单首删缓存。
- **断网时**：下一首 / 上一首 / 随机 / 播放全部只在已缓存的歌里挑，没缓存的变灰、点了只提示不加载；
  搜索改成搜本地曲库。顶栏会出现一个离线标签，点它打开「缓存与离线」面板。
- **「只播已缓存」开关**（面板里）：联网时也只放缓存的歌，省流量。
- **缓存上限**（面板里）：APK 默认 2GB（网页版默认 300MB），超过就自动删最久没听的。
  QQ 音乐默认挑无损，一首 25~35MB，300MB 只够十来首——觉得"听过的歌离线放不了"，多半是上限太小被挤掉了。
- **提前缓存**：歌单页「缓存全部」，一首一首下，再点一次停止；用移动网络会先问一句。

## 四、构建和发布

推到 GitHub 后 [Actions 里的 Android APK 工作流](../.github/workflows/android.yml) 自动打包：

| 推到哪 | 结果 |
|---|---|
| `main` | 发正式 Release，tag 是 `v1.0.<构建号>`，上面的固定下载地址自动指向它 |
| 其他分支（`claude/**` 等） | 覆盖 `apk-preview` 预发布 |
| 还没配签名 Secrets | 只出临时签名的调试包，挂在那次运行的附件里，**不发布** |

版本号就是构建号（`github.run_number`），每次都比上一次大，手机上才能覆盖安装；App 里的检查更新也是拿
tag 里的构建号和本机的比。

### 签名钥匙（一次性配置）

钥匙**不进仓库**（仓库是公开的，钥匙公开了谁都能打一个"冒充更新"的包）。放在仓库的 Actions Secrets 里：
GitHub 仓库页 → Settings → Secrets and variables → Actions → New repository secret，建 4 个：

| Name | 值 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | 钥匙文件（.jks）的 base64，一整行 |
| `ANDROID_KEYSTORE_PASSWORD` | 钥匙库密码 |
| `ANDROID_KEY_ALIAS` | `listening` |
| `ANDROID_KEY_PASSWORD` | 和钥匙库密码相同（PKCS12 格式两个密码必须一样） |

Secrets 存进去之后 GitHub 不让再看，**钥匙文件和密码自己一定要另外备份**。丢了钥匙，以后的新版就没法覆盖
安装，只能卸载重装。当前这把钥匙的证书 SHA-256 指纹：

```
B6:CD:7A:EF:F3:BB:A2:AC:63:A3:30:32:4E:D8:8A:0C:24:14:A3:03:D5:5C:B5:7B:35:32:3D:89:99:33:40:2F
```

自己生成一把新的（只有第一次、或者钥匙丢了不得不换的时候才需要）：

```bash
keytool -genkeypair -keystore listening-release.jks -storetype PKCS12 -alias listening \
  -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=Listening, O=fenghanyue, C=CN"
base64 -w0 listening-release.jks   # 输出就是 ANDROID_KEYSTORE_BASE64
```

### 本机构建

需要 Node 22、JDK 21、Android SDK（platform 36）：

```bash
cd mobile
npm ci
npm run apk:debug      # = build:www + cap sync android + gradlew assembleDebug
# 正式签名：先设好 ANDROID_KEYSTORE_PATH / ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD
npm run apk:release
```

产物在 `mobile/android/app/build/outputs/apk/`。

## 五、原理和几个取舍

**页面打进 APK，不是"瘦壳"指向线上地址。** 瘦壳（`server.url` 指向 Render）断网根本打不开，Render
休眠后冷启动还要等 10~30 秒，和"离线可用"的目标直接冲突。代价是页面每改一次都要发一版 APK——CI 自动打、
App 里提示更新，把这个代价降到最低。

**页面依赖全部本地化。** React、hls.js、字体图标原来都从 CDN 拉，断网就是白屏、图标变成英文单词。现在都在
`examples/vendor/`（`scripts/vendor-assets.mjs` 下载并校验哈希）。`mobile/scripts/build-www.mjs` 打包前会
检查页面里有没有外网脚本 / 字体，有就报错退出，防止以后不小心加回 CDN。

**代理走线上实例。** APK 里页面来源是 `https://localhost`，同源的 `/proxy` 不存在，页面在 `<head>` 里把
`LISTENING_PROXY_BASE` 设成 Render 地址（`src/api/utils.js` 的 `proxyBase`）。搜索、播放不走代理（接口本身
发 CORS 头），只有网易云专辑名、短链导入、SoundCloud 用得到。`server.mjs` 为此放行了 `X-Proxy-Location`
这个响应头，不然跨域读不到它，短链导入会失败。

**沉浸式状态栏自己做，没用 Capacitor 自带的。** 读过 8.5.2 源码：自带的处理只在 WebView ≥ 140 时才真的铺到
状态栏下面，更老的 WebView 是给整个窗口加内边距（不沉浸），注入给页面的安全区变量全是 0。国产系统的 WebView
经常偏旧，所以在 `capacitor.config.json` 里关掉了它（`insetsHandling: "disable"`），由 `MainActivity` 铺满窗口、
把系统栏高度注入成 `--safe-area-inset-*`。来龙去脉见 [mobile-status-bar.md](mobile-status-bar.md)。

**媒体通知用 `@capgo/capacitor-media-session`，绕开了它两个坑：**

- 它的清单里缺 `FOREGROUND_SERVICE_MEDIA_PLAYBACK` 权限，Android 14 起一播放就崩——App 清单里补上了。
- 它下载 http 封面是在所有原生插件共用的线程里同步下、不设超时，弱网时会把状态栏、返回键等别的原生调用全堵住——
  页面只给它传 `data:` 图片：本地缓存的封面优先，没有就用 Capacitor 自带的原生 HTTP（8 秒超时）现拉，
  再没有就用 App 图标（它取不到新封面时会沿用上一首的，所以必须总给一张）。

**页面不打包 `@capacitor/core`。** 原生壳注入的 `Capacitor.nativePromise` / `nativeCallback` 就是 core 的
`registerPlugin` 底下调的东西，页面里封装了三个小函数（`nativeHas` / `nativeCall` / `nativeListen`）直接用，
网页版和 APK 共用同一个页面文件，不需要构建步骤。

## 六、已知限制

- **从最近任务里把 App 划掉会停歌。** 播放器在 WebView 里，App 被划掉 WebView 就没了；锁屏、切到别的 App
  不受影响。
- **国产系统还会额外杀后台。** 提示条和「缓存与离线」面板底部有「后台运行设置」：没放行时弹系统的
  "允许在后台运行"对话框；放行了就打开应用信息页，各家的开关在那里——
  小米：省电策略 → 无限制；华为 / 荣耀：应用启动管理 → 关掉自动管理、允许后台活动；
  OPPO / vivo：耗电管理 → 允许后台运行。
- **音频焦点靠 WebView 自己处理**（来电、别的 App 开始放歌时让出声音），没有额外写原生代码；
  真机上如果发现不让，再补。
- **网页版存不了 QQ 音乐的封面。** QQ 封面的服务器不发 CORS 头，网页读不到图片字节，离线时列表照样显示
  sw.js 缓存过的图；APK 走原生 HTTP，没有这个限制。
- PWA 本身断网还是打不开（`sw.js` 只缓存图片，没缓存页面），这次没改；要离线用，用 APK。

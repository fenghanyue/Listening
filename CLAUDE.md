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

## 测试

改完先跑 `npm test`（会自己起本地服务器），说明见 [tests/README.md](tests/README.md)。大部分测试会调
网易云 / QQ 的真实接口，接口本身挂了也会报错，先看失败信息再判断是不是代码的问题。

## 发版

- 推到 `claude/**` 分支：Actions 自动打 APK，覆盖 `apk-preview` 预览版，可以先在手机上试。
- 合并到 `main`：Render 自动部署网页版；Actions 自动发正式版 `v1.0.<构建号>`，App 里「检查更新」
  会提示。只有改了 `examples/`、`src/`、`mobile/` 或工作流本身才会打包。
- 签名钥匙只在仓库的 Actions Secrets 里，不在仓库里，也不要放进仓库。容器里没有这把钥匙：不要在本地
  用别的钥匙打包给用户安装——签名不同就没法覆盖安装，只能卸载、丢数据。要给手机装包就走 CI。
- 版本号就是构建号，自动递增，不用手动改。

/**
 * 把 ../examples 里的页面和它用到的文件拷进 www/，Capacitor 打包时把 www/ 原样放进 APK。
 * 页面只有一份（examples/Listening Player.dc.html，网页版和 APK 共用），这里不改内容，只改名成 index.html。
 *
 * 顺带做一道检查：页面里不许有从外网加载的脚本、样式、字体。APK 要断网也能打开，哪怕只有一个
 * <script src="https://..."> 断网时就是白屏——以后谁往页面里加回 CDN 链接，打包这一步就会报错退出。
 * 普通超链接（<a href="https://github.com/...">）不算，那只是点了才跳转。
 *
 * 用法：node scripts/build-www.mjs（零依赖）
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', '..', 'examples');
const OUT = path.join(HERE, '..', 'www');

const PAGE = 'Listening Player.dc.html';
const FILES = ['support.js', 'api-bundle.js', 'sw.js', 'manifest.json'];
const DIRS = ['icons', 'vendor'];

// <script src=…> / <link href=…>（样式、字体预加载、图标）指向外网的；CSS 里 @import / url() 指向外网的
function findRemoteResources(text) {
  const tags = [...text.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["'](?:https?:)?\/\/[^"']+["'][^>]*>/gi)].map(m => m[0]);
  const css = [...text.matchAll(/(?:@import\s+|url\(\s*)["']?(?:https?:)?\/\/[^"')\s]+/gi)].map(m => m[0]);
  return [...tags, ...css];
}

const html = await fs.readFile(path.join(SRC, PAGE), 'utf8');
const fontsCss = await fs.readFile(path.join(SRC, 'vendor', 'fonts.css'), 'utf8');
const remote = [...findRemoteResources(html), ...findRemoteResources(fontsCss)];
if (remote.length) {
  console.error('页面引用了外网资源，APK 断网时会加载失败（改成放进 examples/vendor/，见 scripts/vendor-assets.mjs）：');
  for (const r of remote) console.error('  ' + r.slice(0, 160));
  process.exit(1);
}

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, 'index.html'), html);
for (const f of FILES) await fs.copyFile(path.join(SRC, f), path.join(OUT, f));
for (const d of DIRS) await fs.cp(path.join(SRC, d), path.join(OUT, d), { recursive: true });
console.log(`www/ 已更新（来自 ${path.relative(path.join(HERE, '..'), SRC)}/）`);

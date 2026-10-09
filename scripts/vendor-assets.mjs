/**
 * 把页面原来从 CDN 拉的依赖下载到 examples/vendor/，网页版和 APK 都改从本地加载。
 *
 * 为什么要本地化：原来 React（unpkg）、hls.js（jsdelivr）、字体和图标（Google Fonts）全是外链，
 * 断网时页面根本起不来（React 不在就是白屏，图标字体不在就显示成 "play_arrow" 这种英文单词）。
 * APK 要做离线可用，这些东西必须打进包里；网页版顺带也不再依赖这几个在国内时好时坏的 CDN。
 *
 * 用法：node scripts/vendor-assets.mjs（零依赖，Node 18+ 自带 fetch）
 * 产物直接提交进仓库，平时不用跑；只有升级版本、或者 Google Fonts 那边字体更新了想跟进时才需要重跑。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'examples', 'vendor');

// 脚本文件：版本和 sha384 都钉死，下载到的字节对不上就报错退出，不会悄悄换成别的版本。
// React 这两个哈希和 support.js 里的 REACT_SRI / REACT_DOM_SRI 是同一个值——就是同一份文件，
// support.js 发现 window.React 已经在了就不会再去 unpkg 拉
const SCRIPTS = [
  {
    file: 'react.production.min.js',
    url: 'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
    sri: 'sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z',
  },
  {
    file: 'react-dom.production.min.js',
    url: 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
    sri: 'sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1',
  },
  {
    // 原来页面写的是 hls.js@1.5（浮动到 1.5.x 最新），这里钉在当时的最新版
    file: 'hls.min.js',
    url: 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js',
    sri: 'sha384-V5ruNBgmYcC3SJRUQeNykAAAgde5gOFq/Hu0CZj7bygDP0yRIhkvX8+w0u/7mRvr',
  },
];

// 字体：Google Fonts 按 User-Agent 决定给 woff2 还是老格式，这里冒充一个现代安卓 Chrome。
// Material Symbols 只保留 opsz / wght / FILL 三个轴：页面从来没设过 GRAD（用默认值 0），渲染结果和
// 原来的全轴版一模一样，体积从约 4MB 降到约 2.4MB。刻意**不**按图标名做子集——子集要求每加一个
// 新图标都得重新生成，漏一个离线时就会显示成英文单词，省下的体积不值这个坑。
// 西文字体 Inter（瑞士风格改版换掉了原来的 Plus Jakarta Sans），中文走系统黑体，不打包。
// 要用区间写法 wght@400..800：离散写法 wght@400;500;600;700 时 Google 有时回原版可变字体（/s/…woff2），
// 有时回现场按字重裁出来的 /l/font?kit=…，两次跑出来的文件不一样；区间写法稳定拿到原版可变字体
const FONTS = [
  {
    name: 'inter',
    css: 'https://fonts.googleapis.com/css2?family=Inter:wght@400..800&display=swap',
  },
  {
    name: 'material-symbols-outlined',
    css: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL@20..48,100..700,0..1&display=block',
  },
];

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

async function download(url, asText = false) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return asText ? res.text() : Buffer.from(await res.arrayBuffer());
}

function sri(buf) {
  return 'sha384-' + crypto.createHash('sha384').update(buf).digest('base64');
}

async function vendorScripts() {
  for (const s of SCRIPTS) {
    const buf = await download(s.url);
    const got = sri(buf);
    if (got !== s.sri) throw new Error(`${s.file} 哈希不对：期望 ${s.sri}，实际 ${got}`);
    await fs.writeFile(path.join(OUT, s.file), buf);
    console.log(`  ${s.file}  ${(buf.length / 1024).toFixed(0)} KB`);
  }
}

// 下载每个字体的 CSS，把里面的 fonts.gstatic.com 地址换成 ./fonts/ 下的本地文件。
// Inter 是可变字体，万一 Google 按字重拆出几段 @font-face 指向同一批文件，按 URL 去重只下一次；
// 文件名取 CSS 里每段 @font-face 前面的子集注释（latin / latin-ext …），方便看出是哪一块。
// Material Symbols 只有一个不分子集的文件，Google 给它的注释是 "fallback"，这种就不带后缀
async function vendorFonts() {
  await fs.mkdir(path.join(OUT, 'fonts'), { recursive: true });
  const parts = [];
  for (const f of FONTS) {
    let css = await download(f.css, true);
    const local = new Map();
    for (const m of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{[^}]*?url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)) {
      const [, subset, url] = m;
      if (!/^https:\/\/fonts\.gstatic\.com\/s\/[^?]+\.woff2$/.test(url)) {
        throw new Error(`${f.name} 拿到的不是原版字体文件（${url}），重跑一次或检查 FONTS 里的写法`);
      }
      if (!local.has(url)) local.set(url, subset === 'fallback' ? `${f.name}.woff2` : `${f.name}-${subset}.woff2`);
    }
    for (const [url, file] of local) {
      const buf = await download(url);
      await fs.writeFile(path.join(OUT, 'fonts', file), buf);
      console.log(`  fonts/${file}  ${(buf.length / 1024).toFixed(0)} KB`);
      css = css.split(url).join(`./fonts/${file}`);
    }
    if (css.includes('fonts.gstatic.com')) throw new Error(`${f.name} 的 CSS 里还有没替换掉的远程地址`);
    parts.push(`/* ${f.name} */\n${css.trim()}`);
  }
  const header = '/* 由 scripts/vendor-assets.mjs 生成，别手改；来源见脚本里的 FONTS */';
  await fs.writeFile(path.join(OUT, 'fonts.css'), [header, ...parts].join('\n\n') + '\n');
  console.log('  fonts.css');
}

await fs.mkdir(OUT, { recursive: true });
console.log(`写入 ${path.relative(ROOT, OUT)}/`);
await vendorScripts();
await vendorFonts();

/**
 * 把页面原来从 CDN 拉的依赖下载到 examples/vendor/，网页版和 APK 都改从本地加载。
 *
 * 为什么要本地化：原来 React（unpkg）、hls.js（jsdelivr）、字体和图标（Google Fonts）全是外链，
 * 断网时页面根本起不来（React 不在就是白屏，图标字体不在就显示成 "play_arrow" 这种英文单词）。
 * APK 要做离线可用，这些东西必须打进包里；网页版顺带也不再依赖这几个在国内时好时坏的 CDN。
 *
 * 用法：node scripts/vendor-assets.mjs（零依赖，Node 18+ 自带 fetch）
 *       node scripts/vendor-assets.mjs icons   只跑其中几步（scripts / fonts / icons / heros），别的文件不动
 * 产物直接提交进仓库，平时不用跑；只有升级版本、或者 Google Fonts 那边字体更新了想跟进时才需要重跑。
 * 加了新图标要跑 icons（见下面的 ICONS）。注意 Google 那边的 Material Symbols 隔一阵就出新版，跑 icons 会顺带把图标换成新版的。
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

// 图标 Material Symbols 是连字字体：页面里写 <span class="ms">play_arrow</span>，字体把这个词画成图标。
// 只打包页面用到的这些图标。原来打包整套三千多个图标，2.3MB：网页版每次打开都要重新下（服务器没让浏览器缓存），
// 国内网慢时 3 秒内下不完，浏览器就把 "play_arrow" 这种名字当文字显示出来、叠成一片；只留用到的是 18KB 左右。
// 加新图标：先加进这里，再跑 node scripts/vendor-assets.mjs icons 重新生成字体。漏了的话那个图标是一片空白，
// node tests/run.mjs icons 会报错：它把页面里用到的图标名都找出来跟这份名单对一遍，再用仓库里的字体逐个画一遍
const ICONS = [
  'add', 'arrow_back', 'arrow_forward', 'arrow_outward', 'close', 'cloud_off', 'content_copy', 'delete', 'download',
  'download_done', 'drag_indicator', 'favorite', 'graphic_eq', 'history', 'ios_share', 'keyboard_arrow_down',
  'keyboard_arrow_up', 'more_vert', 'music_note', 'open_in_full', 'pause', 'picture_in_picture_alt', 'play_arrow',
  'playlist_add', 'playlist_play', 'playlist_remove', 'progress_activity', 'queue_music', 'repeat', 'repeat_one',
  'search', 'settings', 'share', 'shuffle', 'skip_next', 'skip_previous', 'upload', 'volume_up',
];

// 字体：Google Fonts 按 User-Agent 决定给 woff2 还是老格式，这里冒充一个现代安卓 Chrome。每个字体写成 vendor/ 下
// 单独一个样式表（页面里并排引用），step 是命令行上只跑这一项时用的名字。
// 西文字体 Inter（瑞士风格改版换掉了原来的 Plus Jakarta Sans）现在排在 Heros 后面，只画 Heros 没有的字；中文走系统黑体，不打包。
// 要用区间写法 wght@400..800：离散写法 wght@400;500;600;700 时 Google 有时回原版可变字体（/s/…woff2），
// 有时回现场按字重裁出来的 /l/font?kit=…，两次跑出来的文件不一样；区间写法稳定拿到原版可变字体。
// Material Symbols 按图标名（icon_names，要按字母排好）让 Google 现场裁一份，所以只能是 /l/font?kit=…。
// 只保留 opsz / wght / FILL 三个轴：页面从来没设过 GRAD（用默认值 0）。裁出来的跟整套的比，24px 一模一样，
// 别的字号边缘偶尔有一两个像素深浅不同（Google 裁的时候重新压了可变字体的数据），看不出来
const FONTS = [
  {
    step: 'fonts',
    name: 'inter',
    file: 'fonts.css',
    css: 'https://fonts.googleapis.com/css2?family=Inter:wght@400..800&display=swap',
    src: /^https:\/\/fonts\.gstatic\.com\/s\/[^?]+\.woff2$/,
  },
  {
    step: 'icons',
    name: 'material-symbols-outlined',
    file: 'fonts-icons.css',
    css: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL@20..48,100..700,0..1'
      + `&icon_names=${[...ICONS].sort().join(',')}&display=block`,
    src: /^https:\/\/fonts\.gstatic\.com\/l\/font\?kit=/,
  },
];

// 西文和数字的主字体 TeX Gyre Heros：Helvetica 的开源复刻（GUST 字体许可），瑞士风格最经典的那款字。
// Google Fonts 上没有，直接从 CTAN 下原版 OTF：不转格式、不裁字（许可要求改过的版本得改名，原样带上最省事），
// 哈希钉死（所以从哪个 CTAN 镜像下都一样；mirrors.ctan.org 每次随机跳到一个镜像，偶尔碰上拒绝访问的，就挨个换）。
// 只有常规和粗体：页面里写 500 的会用常规，600 / 800 的用粗体。
// 它自带的行距（ascent + descent）比 Inter 高大约 18%，@font-face 里按 Inter 的数覆盖，换字体不挪版面
// （两者的大写字母高度几乎一样，覆盖后字在行里的位置也差不多）。Heros 没有的字（比如俄文）由排在后面的 Inter 画
const HEROS = [
  {
    file: 'texgyreheros-regular.otf',
    weight: 400,
    path: 'fonts/tex-gyre/opentype/texgyreheros-regular.otf',
    sri: 'sha384-neDWtFBXs7JXSUkPhWL+gRn+ciMvL8tfL3yaXvaMLiqw6LKGAjgPu6YCaQ+oE5V7',
  },
  {
    file: 'texgyreheros-bold.otf',
    weight: 700,
    path: 'fonts/tex-gyre/opentype/texgyreheros-bold.otf',
    sri: 'sha384-nHmGYln09/kv0qrvR8iAzI/1RMH68LIhdtZpBJQIQ13J0vemKLVRQqOraep+fYg/',
  },
];
const CTAN_MIRRORS = ['https://mirrors.ctan.org/', 'https://ctan.math.illinois.edu/', 'https://mirrors.rit.edu/CTAN/'];

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

// 下载字体的 CSS，把里面的 fonts.gstatic.com 地址换成 ./fonts/ 下的本地文件，写成 vendor/ 下的 f.file。
// Inter 是可变字体，万一 Google 按字重拆出几段 @font-face 指向同一批文件，按 URL 去重只下一次；
// 文件名取 CSS 里每段 @font-face 前面的子集注释（latin / latin-ext …），方便看出是哪一块。
// Material Symbols 只有一个文件，前面没有子集注释（整套的时候叫 "fallback"），这种就不带后缀
async function vendorFont(f) {
  await fs.mkdir(path.join(OUT, 'fonts'), { recursive: true });
  let css = await download(f.css, true);
  const local = new Map();
  for (const m of css.matchAll(/(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{[^}]*?url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)) {
    const [, subset, url] = m;
    if (!f.src.test(url)) throw new Error(`${f.name} 拿到的字体地址不对（${url}），重跑一次或检查 FONTS 里的写法`);
    if (!local.has(url)) local.set(url, !subset || subset === 'fallback' ? `${f.name}.woff2` : `${f.name}-${subset}.woff2`);
  }
  if (!local.size) throw new Error(`${f.name} 的 CSS 里没找到字体文件`);
  for (const [url, file] of local) {
    const buf = await download(url);
    if (buf.subarray(0, 4).toString('latin1') !== 'wOF2') throw new Error(`${f.name} 下回来的不是 woff2（${url}）`);
    await fs.writeFile(path.join(OUT, 'fonts', file), buf);
    console.log(`  fonts/${file}  ${(buf.length / 1024).toFixed(0)} KB`);
    css = css.split(url).join(`./fonts/${file}`);
  }
  if (css.includes('fonts.gstatic.com')) throw new Error(`${f.name} 的 CSS 里还有没替换掉的远程地址`);
  const header = '/* 由 scripts/vendor-assets.mjs 生成，别手改；来源见脚本里的 FONTS */';
  await fs.writeFile(path.join(OUT, f.file), `${header}\n\n/* ${f.name} */\n${css.trim()}\n`);
  console.log(`  ${f.file}`);
}

// Heros 单独写一份 fonts-heros.css（页面里和 fonts.css 并排引用），只跑这一步时 fonts.css 不用重新生成
async function vendorHeros() {
  await fs.mkdir(path.join(OUT, 'fonts'), { recursive: true });
  const faces = [];
  for (const f of HEROS) {
    let buf = null;
    for (const mirror of CTAN_MIRRORS) {
      try { buf = await download(mirror + f.path); break; } catch (e) { console.log(`  ${e.message}，换下一个镜像`); }
    }
    if (!buf) throw new Error(`${f.file} 所有镜像都下不下来`);
    const got = sri(buf);
    if (got !== f.sri) throw new Error(`${f.file} 哈希不对：期望 ${f.sri}，实际 ${got}`);
    await fs.writeFile(path.join(OUT, 'fonts', f.file), buf);
    console.log(`  fonts/${f.file}  ${(buf.length / 1024).toFixed(0)} KB`);
    faces.push([
      '@font-face {',
      "  font-family: 'TeX Gyre Heros';",
      '  font-style: normal;',
      `  font-weight: ${f.weight};`,
      '  font-display: swap;',
      `  src: url(./fonts/${f.file}) format('opentype');`,
      '  ascent-override: 96.88%;',
      '  descent-override: 24.12%;',
      '  line-gap-override: 0%;',
      '}',
    ].join('\n'));
  }
  const header = [
    '/* 由 scripts/vendor-assets.mjs 生成，别手改；来源见脚本里的 HEROS */',
    '/* TeX Gyre Heros：Helvetica 的开源复刻（GUST 字体许可），CTAN 原版 OTF，没改过。行距按 Inter 覆盖，换字体不挪版面 */',
  ].join('\n');
  await fs.writeFile(path.join(OUT, 'fonts-heros.css'), [header, ...faces].join('\n\n') + '\n');
  console.log('  fonts-heros.css');
}

const only = new Set(process.argv.slice(2));
const STEPS = ['scripts', ...FONTS.map(f => f.step), 'heros'];
const unknown = [...only].filter(s => !STEPS.includes(s));
if (unknown.length) throw new Error(`没有这一步：${unknown.join(', ')}。可选：${STEPS.join(' / ')}`);
const want = (step) => only.size === 0 || only.has(step);
await fs.mkdir(OUT, { recursive: true });
console.log(`写入 ${path.relative(ROOT, OUT)}/`);
if (want('scripts')) await vendorScripts();
for (const f of FONTS) if (want(f.step)) await vendorFont(f);
if (want('heros')) await vendorHeros();

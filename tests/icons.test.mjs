// 图标（不联网）：Material Symbols 是连字字体，页面里写 <span class="ms">play_arrow</span>，字体把这个词画成图标。
// 字体只打包了页面用到的那些（scripts/vendor-assets.mjs 的 ICONS），所以要查：
//  1. 页面里用到的图标名都在 ICONS 里，ICONS 里也没有页面用不到的（只读文件，不开浏览器）
//  2. 仓库里那份字体真能把 ICONS 里每个名字画成一个图标，实心、空心都试（改了 ICONS 忘了跑 icons 那一步就画不出来）
//  3. 字体下得慢时图标先空着、只占一个图标的位置，不露出 "play_arrow" 这种名字；字体到了正常显示，版面不跳
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, OUT, launchBrowser, createChecker } from './lib.mjs';

const { check, finish } = createChecker();
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const page = read('examples/Listening Player.dc.html');
const FONT = 'examples/vendor/fonts/material-symbols-outlined.woff2';

// ---- 1. 名单 ----
const ICONS = [...((read('scripts/vendor-assets.mjs').match(/\nconst ICONS = \[([\s\S]*?)\];/) || [])[1] || '').matchAll(/'(\w+)'/g)].map(m => m[1]);
check(`the ICONS list in scripts/vendor-assets.mjs loads (${ICONS.length} icons)`, ICONS.length > 10, ICONS.length);

const template = page.slice(page.indexOf('<x-dc'), page.indexOf('</x-dc>'));
const code = page.slice(page.indexOf('<script type="text/x-dc"'));
// 从 i 开始读一个表达式，到顶层的逗号、分号或者没配对的右括号为止，跳过引号里的东西
const exprAt = (src, i) => {
  let depth = 0, out = '', quote = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === '\\') out += src[++i];
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
    else if ((c === ',' || c === ';') && depth === 0) break;
    out += c;
  }
  return out;
};
const names = (s) => [...s.matchAll(/'([a-z][a-z0-9_]*)'/g)].map(m => m[1]);
// 对象里「键: 值」的值（键前面是 { 或 ,，免得把 a ? icon : b 这种三元表达式当成键）
const valuesOf = (key) => [...code.matchAll(new RegExp(`(?<=[{,]\\s*)\\b${key}\\s*:\\s*`, 'g'))].map(m => exprAt(code, m.index + m[0].length));
const lineAt = (i) => page.slice(0, i).split('\n').length;

// 页面里用到的图标名，按这几种写法找（换了别的写法这里找不到，下面第二条检查会报出来）：
//  a. 写死在 <span class="ms…">名字</span> 里：模板，还有迷你播放器拼的 HTML
//  b. 模板里 <span class="ms">{{ x.键 }}</span>：代码里「键: …」的值里写的名字（比如 playIcon: 加载中 ? 'progress_activity' : …）；
//     class 也是 {{ x.键 }} 的，看那个键的值里有没有 'ms'
//  c. 名字叫 …_ICONS 的数组（PLAY_MODE_ICONS）
//  d. 迷你播放器的节点是代码里搭的：给图标改字（playIcon.textContent = …、querySelector('.ms').textContent = …），
//     队列行的按钮 btn(动作, id, '图标', …)
const used = new Map();
const note = (name, where) => { if (!used.has(name)) used.set(name, where); };
for (const m of page.matchAll(/<span class="(?:[^"]*\s)?ms(?:\s[^"]*)?"[^>]*>([a-z0-9_]+)<\/span>/g)) note(m[1], `line ${lineAt(m.index)}`);
const unknownKeys = [];
for (const m of template.matchAll(/<span class="([^"]*)"[^>]*>\{\{\s*\w+\.(\w+)\s*\}\}<\/span>/g)) {
  const [, cls, key] = m;
  const clsKey = (cls.match(/^\{\{\s*\w+\.(\w+)\s*\}\}$/) || [])[1];
  if (!/(^|\s)ms(\s|$)/.test(cls) && !(clsKey && valuesOf(clsKey).some(v => /'ms\b/.test(v)))) continue;
  const vals = valuesOf(key);
  if (!vals.length) unknownKeys.push(`{{ ${key} }}: no "${key}: …" in the code, can't tell which icons it shows`);
  for (const v of vals) for (const n of names(v)) note(n, `{{ ${key} }}`);
}
for (const m of code.matchAll(/\b(\w+_ICONS)\s*=\s*\[([^\]]*)\]/g)) for (const n of names(m[2])) note(n, m[1]);
for (const m of code.matchAll(/([\w.$()'"]+)\.textContent\s*=\s*([^;]+);/g)) {
  if (/icon|\.ms\b/i.test(m[1])) for (const n of names(m[2])) note(n, `${m[1]}.textContent`);
}
for (const m of code.matchAll(/\bbtn\(\s*'\w+'\s*,[^,]+,\s*'([a-z0-9_]+)'/g)) note(m[1], 'btn(…)');

const notListed = [...used].filter(([n]) => !ICONS.includes(n)).map(([n, where]) => `${n} (${where})`);
check('every icon the page uses is in ICONS (add it there, then run: node scripts/vendor-assets.mjs icons)',
  notListed.length === 0 && unknownKeys.length === 0, [...notListed, ...unknownKeys]);
const unused = ICONS.filter(n => !used.has(n));
check('every name in ICONS is found in the page (if it is used after all, this test missed how it is written: teach the test, keep the icon)',
  unused.length === 0, unused);

// ---- 2. 仓库里那份字体 ----
const browser = await launchBrowser();
const fontPage = await browser.newPage();
await fontPage.setContent(`<!doctype html><style>
  @font-face { font-family: 'Icons'; font-weight: 100 700; src: url(data:font/woff2;base64,${fs.readFileSync(path.join(root, FONT)).toString('base64')}) format('woff2'); }
  body { margin: 0; background: #fff; }
  div { display: flex; }
  span { font: 24px/1 'Icons'; display: inline-block; white-space: nowrap; color: #000; }
  .fill span { font-variation-settings: 'FILL' 1; }
</style><div id="outline"></div><div id="fill" class="fill"></div>`);
// 字体里没有的名字画出来是一串字（不是一个字宽）：拿一个确认这个量法真能量出毛病
const PROBE = 'not_an_icon';
const drawn = await fontPage.evaluate(async (list) => {
  for (const id of ['outline', 'fill']) document.getElementById(id).innerHTML = list.map(n => `<span>${n}</span>`).join('');
  await document.fonts.load('24px Icons');
  return Object.fromEntries(['outline', 'fill'].map(id => [id, [...document.getElementById(id).children].map(s => [s.textContent, s.getBoundingClientRect().width])]));
}, [...ICONS, PROBE]);
const notOneGlyph = (row) => row.filter(([n, w]) => n !== PROBE && Math.abs(w - 24) > 0.5).map(([n, w]) => `${n}: ${w}px`);
check(`${FONT} draws all ${ICONS.length} ICONS as one icon each, outlined and filled (if not, run: node scripts/vendor-assets.mjs icons)`,
  notOneGlyph(drawn.outline).length === 0 && notOneGlyph(drawn.fill).length === 0, [...notOneGlyph(drawn.outline), ...notOneGlyph(drawn.fill)]);
const probe = drawn.outline.find(([n]) => n === PROBE);
check(`…and a name that is not in the font (${PROBE}) does not come out one icon wide, so the check above can fail`, !!probe && Math.abs(probe[1] - 24) > 0.5, probe);
await fontPage.evaluate(() => { for (const id of ['outline', 'fill']) [...document.getElementById(id).children].pop().remove(); });
const sameRows = (await fontPage.locator('#outline').screenshot()).equals(await fontPage.locator('#fill').screenshot());
check('filled icons look different from outlined ones (the font kept its FILL axis)', !sameRows);
await fontPage.close();

// ---- 3. 字体下得慢 ----
// 图标字体故意扣住不给：等浏览器等字体的 3 秒过去（过了这 3 秒它就会把名字当文字显示），看图标是不是空着、各占一个
// 图标宽；再放字体过去，看图标都出来了、界面上别的东西一个都没挪。手机、电脑各一遍
const snapshot = () => {
  const box = (el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 10) / 10).join(' '); };
  // 图标里的字本身多宽（不是框）：画成图标是一个字宽，没画成是一串字母
  const textW = (el) => { const r = document.createRange(); r.selectNodeContents(el); return Math.round(r.getBoundingClientRect().width * 10) / 10; };
  const icons = [...document.querySelectorAll('.dc-app-shell .ms')].filter(el => el.getClientRects().length);
  return {
    loading: document.documentElement.classList.contains('ms-loading'),
    icons: icons.map(el => {
      const cs = getComputedStyle(el);
      return {
        name: el.textContent, size: parseFloat(cs.fontSize), w: el.getBoundingClientRect().width, textW: textW(el),
        hidden: cs.visibility === 'hidden', parentHidden: getComputedStyle(el.parentElement).visibility === 'hidden',
      };
    }),
    // 每个元素的位置和大小。图标里面那层字除外：字体到之前它是一串字母，藏着
    layout: [...document.querySelectorAll('.dc-app-shell *')].filter(el => el.getClientRects().length && !el.parentElement.closest('.ms'))
      .map(el => `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).join('.')}  ${box(el)}`),
  };
};
for (const [label, opts] of [
  ['phone', { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true }],
  ['desktop', { viewport: { width: 1440, height: 900 } }],
]) {
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', e => errors.push(String(e)));
  let release;
  const held = new Promise(r => { release = r; });
  let askedAt = 0;
  await pg.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin !== new URL(BASE).origin || /^\/(proxy|stream|sc-client-id)/.test(u.pathname)) return route.abort();
    if (u.pathname.endsWith('/material-symbols-outlined.woff2')) { askedAt = Date.now(); await held; }
    return route.continue();
  });
  await pg.goto(BASE, { waitUntil: 'commit' });
  await pg.waitForSelector('.dc-app-shell .ms', { state: 'attached', timeout: 20000 }); // 这时图标本来就该藏着，不等它可见
  await pg.waitForTimeout(Math.max(0, askedAt + 3500 - Date.now()));
  const before = await pg.evaluate(snapshot);
  // page.screenshot 会等网页字体下完，这时字体正扣着，用 CDP 直接截
  const cdp = await ctx.newCDPSession(pg);
  fs.writeFileSync(path.join(OUT, `icons-${label}-font-loading.png`), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  release();
  await pg.waitForFunction(() => !document.documentElement.classList.contains('ms-loading'), null, { timeout: 15000 }).catch(() => {});
  await pg.waitForTimeout(200);
  const after = await pg.evaluate(snapshot);
  await pg.screenshot({ path: path.join(OUT, `icons-${label}-font-loaded.png`) });

  const blankBad = before.icons.filter(i => !i.hidden || Math.abs(i.w - i.size) > 0.5).map(i => `${i.name}: ${i.hidden ? '' : 'visible, '}${i.w}px`);
  check(`${label}: 3.5s into a slow icon font, all ${before.icons.length} icons are blank and one icon wide (no "play_arrow" text)`,
    askedAt > 0 && before.loading && before.icons.length > 0 && blankBad.length === 0, { askedAt: askedAt > 0, loading: before.loading, bad: blankBad });
  check(`${label}: …while the font really is still missing (the names underneath are wider than one icon)`,
    before.icons.some(i => i.textW > i.size * 1.5), before.icons.slice(0, 2));
  const shownBad = after.icons.filter(i => i.hidden !== i.parentHidden || i.textW > i.size * 1.5).map(i => `${i.name}: ${i.textW}px${i.hidden ? ', hidden' : ''}`);
  check(`${label}: once the font arrives every icon shows, one icon each`, !after.loading && after.icons.length > 0 && shownBad.length === 0, { loading: after.loading, bad: shownBad });
  const moved = before.layout.length !== after.layout.length ? [`${before.layout.length} elements before, ${after.layout.length} after`]
    : before.layout.flatMap((l, i) => (l === after.layout[i] ? [] : [`${l} → ${after.layout[i].split('  ').pop()}`]));
  check(`${label}: nothing on the page moves when the font arrives`, moved.length === 0, moved.slice(0, 4));
  check(`${label}: no page errors`, errors.length === 0, errors);
  await ctx.close();
}

await browser.close();
process.exit(finish());

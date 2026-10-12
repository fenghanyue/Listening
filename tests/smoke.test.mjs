// 冒烟测试（不联网）：拦掉所有 CDN 后页面照常启动，字体都从本地加载，每个 Material Symbols 图标
// 都渲染成图形（宽度不超过字号的 1.6 倍；字体没加载时会显示成一串英文单词，宽度远超）
import { BASE, OUT, launchBrowser, createChecker } from './lib.mjs';

const CDN = /(unpkg\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)/;
const { check, finish } = createChecker();

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const blocked = [];
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
await page.route('**/*', route => {
  const u = route.request().url();
  if (CDN.test(u)) { blocked.push(u); return route.abort(); }
  return route.continue();
});
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.dc-topbar', { timeout: 15000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);

const icons = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('span, .material-symbols-outlined')) {
    const cs = getComputedStyle(el);
    if (!cs.fontFamily.includes('Material Symbols Outlined')) continue;
    const text = el.textContent.trim();
    if (!text || el.children.length) continue;
    if (el.offsetParent === null && cs.position !== 'fixed') continue; // 隐藏的不算
    const fs = parseFloat(cs.fontSize);
    const w = el.getBoundingClientRect().width;
    out.push({ text, fs, w: Math.round(w * 10) / 10, ok: w <= fs * 1.6 });
  }
  return out;
});
// 字体要确认是从 vendor/ 真加载成功的那份（Heros 常规和粗体都有）：fonts.check 对加载失败的字体也会返回 true，
// 而测试机上可能本来就装着同名的系统字体，失败了也看不出来。图标字体没到时 html 上挂着 ms-loading，图标被藏起来、
// 宽度压成一个图标，上面量宽度就量不出毛病，所以还得确认它已经摘掉了
const fontOk = await page.evaluate(() => {
  const loaded = (family, weight) => [...document.fonts].some(f => f.family.replace(/["']/g, '') === family && (!weight || f.weight === weight) && f.status === 'loaded');
  return loaded('Material Symbols Outlined') && !document.documentElement.classList.contains('ms-loading')
    && loaded('TeX Gyre Heros', '400') && loaded('TeX Gyre Heros', '700');
});
await page.screenshot({ path: `${OUT}/smoke-home.png` });

check('page requested nothing from a CDN', blocked.length === 0, blocked);
check('icon font and text font load locally', fontOk);
check(`all ${icons.length} visible icons render as glyphs`, icons.length > 0 && icons.every(i => i.ok), icons.filter(i => !i.ok));
check('no page errors', pageErrors.length === 0, pageErrors);
if (consoleErrors.length) console.log('console errors (not failing):', JSON.stringify(consoleErrors).slice(0, 400));

await browser.close();
process.exit(finish());

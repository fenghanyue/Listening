// 界面文字表（不开浏览器、不联网）：页面里的 STRINGS 每一条都是 [中文, English] 一对，两边类型一样、都不是空的，
// 英文那边没有漏下中文；模板里的 {{ L.键名 }}、代码里的 tr('键名') 都在表里，表里也没有哪条没用上；
// 分享出去的那段文字中文跟原来一样、英文换成英文的引号和 Album:；安卓 values-en 里每条要翻译的字都有英文
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChecker } from './lib.mjs';

const { check, finish } = createChecker();
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const page = read('examples/Listening Player.dc.html');
// 中文字和中文标点（全角的也算）
const CJK = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;

// 表那一段（enSongs 到 STRINGS 的结尾）原样拿出来跑
const from = page.indexOf('const enSongs');
const to = page.indexOf('\n};\n', page.indexOf('const STRINGS = {')) + 3;
const STRINGS = new Function(`${page.slice(from, to)}\nreturn STRINGS;`)();
const keys = Object.keys(STRINGS);
check(`the string table loads (${keys.length} entries)`, from > 0 && keys.length > 100, keys.length);

// 带参数的用几组参数各调一次：数字 0 / 1 / 2（英文的单复数）、名字、空着（比如没有歌名）
const SAMPLES = [[0, 0, 0], [1, 1, 1], [2, 3, 4], ['Name', 'Two', 'Three'], [undefined, undefined, undefined]];
const kind = (v) => (Array.isArray(v) ? 'array' : typeof v);
const texts = (v) => {
  if (typeof v === 'function') return SAMPLES.map(args => v(...args));
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return Object.values(v);
  return [v];
};
const bad = { shape: [], empty: [], chinese: [] };
for (const k of keys) {
  const pair = STRINGS[k];
  if (!Array.isArray(pair) || pair.length !== 2 || kind(pair[0]) !== kind(pair[1])) { bad.shape.push(k); continue; }
  if (kind(pair[0]) === 'object' && Object.keys(pair[0]).join() !== Object.keys(pair[1]).join()) bad.shape.push(k);
  if (kind(pair[0]) === 'array' && pair[0].length !== pair[1].length) bad.shape.push(k);
  const [zh, en] = pair.map(texts);
  if ([...zh, ...en].some(t => typeof t !== 'string' || !t.trim())) bad.empty.push(k);
  const leak = en.find(t => CJK.test(String(t)));
  if (leak) bad.chinese.push(`${k}: ${leak}`);
}
check('every entry is a [中文, English] pair of the same kind', bad.shape.length === 0, bad.shape);
check('no entry is empty in either language', bad.empty.length === 0, bad.empty);
check('the English side has no Chinese characters or punctuation', bad.chinese.length === 0, bad.chinese);
const en = (k, ...a) => STRINGS[k][1](...a);
check('English plurals: 1 song / 2 songs, 1 result / 3 results',
  en('songs', 1) === '1 song' && en('songs', 2) === '2 songs' && en('cachedSongs', 1) === '1 song cached'
  && en('statusFound', 1, 'x') === ' · 1 result' && en('statusFound', 3, '') === '3 results',
  [en('songs', 1), en('songs', 2), en('cachedSongs', 1), en('statusFound', 1, 'x'), en('statusFound', 3, '')]);

// 用到的键：模板里的 {{ L.键名 }}（只能是字符串）、代码里 tr( 的第一个参数里写的键名（可能是 a ? 'x' : 'y' 挑一个）、STRINGS.键名
const template = page.slice(page.indexOf('<x-dc'), page.indexOf('</x-dc>'));
const code = page.slice(page.indexOf('<script type="text/x-dc"')).replace(page.slice(from, to), '');
// 从 i 开始读到这个调用的第一个参数结束（顶层的逗号或右括号），跳过引号里的东西
const firstArg = (src, i) => {
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
    else if (c === ',' && depth === 0) break;
    out += c;
  }
  return out.trim();
};
// 注释里提到的 tr(…) 不算：这一行在它前面（去掉引号里的东西以后）有 //，或者是 /* */ 里以 * 开头的行
const inComment = (src, i) => {
  const before = src.slice(src.lastIndexOf('\n', i) + 1, i);
  return /^\s*\*/.test(before) || before.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '').includes('//');
};
const used = new Set();
const missing = [];
for (const m of template.matchAll(/\{\{\s*L\.(\w+)\s*\}\}/g)) {
  used.add(m[1]);
  if (!(m[1] in STRINGS)) missing.push(`L.${m[1]}`);
  else if (typeof STRINGS[m[1]][0] !== 'string') missing.push(`L.${m[1]} is not plain text (the template cannot call it)`);
}
for (const m of code.matchAll(/(?<!function )\btr\(/g)) {
  if (inComment(code, m.index)) continue;
  const arg = firstArg(code, m.index + m[0].length);
  const lits = [...arg.matchAll(/'(\w+)'/g)].map(x => x[1]);
  if (!lits.length) missing.push(`tr(${arg}): the key should be written out`);
  for (const k of lits) { used.add(k); if (!(k in STRINGS)) missing.push(`tr('${k}')`); }
}
for (const m of code.matchAll(/\bSTRINGS\.(\w+)/g)) { used.add(m[1]); if (!(m[1] in STRINGS)) missing.push(`STRINGS.${m[1]}`); }
check('every {{ L.… }}, tr(\'…\') and STRINGS.… in the page is in the table', missing.length === 0, missing);
const unused = keys.filter(k => !used.has(k));
check('every entry in the table is used somewhere', unused.length === 0, unused);

// 分享文字。src/api/share.js 是 ES 模块，根目录 package.json 没写 "type": "module"：用 data: 地址载入
const share = await import('data:text/javascript;base64,' + Buffer.from(read('src/api/share.js')).toString('base64'));
const track = { source: 'netease', songid: '186016', title: '晴天', artist: '周杰伦', album: '叶惠美' };
const zhShare = share.shareText(track);
const enShare = share.shareText(track, 'en');
check('share text in Chinese is unchanged', zhShare === '《晴天》— 周杰伦\n专辑：叶惠美\n\nhttps://music.163.com/m/song?id=186016', zhShare);
check('share text in English: “title” — artist, Album:, then the link', enShare === '“晴天” — 周杰伦\nAlbum: 叶惠美\n\nhttps://music.163.com/m/song?id=186016', enShare);
// 打包好的 api-bundle.js（页面实际用的）也得是改过的这份：改了 src/api 忘了 npm run build 就对不上
check('examples/api-bundle.js has the language-aware share text (npm run build after editing src/api)', /function shareText\(track, lang = "zh"\)/.test(read('examples/api-bundle.js')));

// 安卓：默认（中文）values 里每条要翻译的字，英文系统用的 values-en 里都有，而且是英文
const res = (rel) => Object.fromEntries([...read(rel).matchAll(/<string name="(\w+)"([^>]*)>([^<]*)</g)]
  .filter(m => !/translatable="false"/.test(m[2])).map(m => [m[1], m[3]]));
const zhRes = res('mobile/android/app/src/main/res/values/strings.xml');
const enRes = res('mobile/android/app/src/main/res/values-en/strings.xml');
const resBad = Object.keys(zhRes).filter(k => !enRes[k] || CJK.test(enRes[k]));
check(`Android: all ${Object.keys(zhRes).length} translatable strings have English versions (values-en)`, resBad.length === 0 && enRes.app_name === 'Listening', resBad);

process.exit(finish());

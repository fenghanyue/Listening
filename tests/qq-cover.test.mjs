// QQ 音乐封面（有一项联网：调 QQ 真实接口）：QQ 接口给的封面是 http:// 地址，页面里显示、下载都要按
// https 用；APK 里已缓存、但没存下封面的歌，要在后台补存封面。假的原生壳里 CapacitorHttp 遇到 http://
// 一律失败（模拟安卓禁止明文 http），遇到 https 就返回一张图
import { BASE, launchBrowser, logicDriver, createChecker } from './lib.mjs';

const { check, finish } = createChecker();

const KEY = 'qq:004WAfxJ1q8L9h';
const HTTP_COVER = 'http://y.gtimg.cn/music/photo_new/T002R500x500M000003AhhSv2qI3aE_3.jpg';
const HTTPS_COVER = HTTP_COVER.replace('http://', 'https://');
const META = {
  source: 'qq', songid: '004WAfxJ1q8L9h', qqId: '004WAfxJ1q8L9h', songMid: '004WAfxJ1q8L9h', keyword: '凤凰于飞 刘欢',
  title: '凤凰于飞', artist: '刘欢', album: '甄嬛传', cover: HTTP_COVER, duration: 200, lrc: null, pageUrl: '', scPermalink: '',
};
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const browser = await launchBrowser();

async function setup(native) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  if (native) {
    await ctx.addInitScript(({ PNG_B64 }) => {
      window.__http = [];
      const headers = ['App', 'AppShell', 'MediaSession', 'SystemBars', 'CapacitorHttp', 'Filesystem', 'Share'].map(name => ({ name, methods: [] }));
      window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        PluginHeaders: headers,
        nativePromise(plugin, method, options) {
          if (plugin === 'CapacitorHttp' && method === 'request') {
            window.__http.push(options.url);
            if (/^http:\/\//.test(options.url)) return Promise.reject(new Error('Cleartext HTTP traffic to y.gtimg.cn not permitted'));
            return Promise.resolve({ status: 200, headers: { 'Content-Type': 'image/png' }, data: PNG_B64 });
          }
          if (plugin === 'App' && method === 'getInfo') return Promise.resolve({ version: '1.0.1-local', build: '1' });
          if (plugin === 'AppShell' && method === 'getBatteryOptimization') return Promise.resolve({ ignoring: true });
          return Promise.resolve({});
        },
        nativeCallback() { return 'cb'; },
      };
    }, { PNG_B64 });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const coverRequests = [];
  page.on('request', r => { if (r.url().includes('y.gtimg.cn')) coverRequests.push(r.url()); });
  await page.route('https://api.github.com/**', r => r.fulfill({ status: 404, body: '' }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.dc-topbar');
  await page.waitForTimeout(800);
  // 放一首"已缓存"的 QQ 歌：音频在，元数据里封面是旧的 http 地址，没有封面字节
  await page.evaluate(({ KEY, META }) => Promise.all([
    new Promise((res, rej) => {
      const r = indexedDB.open('listening-audio-cache', 1);
      r.onsuccess = () => {
        const tx = r.result.transaction('tracks', 'readwrite');
        const blob = new Blob([new Uint8Array(4096)], { type: 'audio/mpeg' });
        tx.objectStore('tracks').put({ id: KEY, blob, size: blob.size, lastAccessed: Date.now() });
        tx.oncomplete = () => { r.result.close(); res(); };
        tx.onerror = () => rej(tx.error);
      };
    }),
    new Promise((res, rej) => {
      const r = indexedDB.open('listening-audio-meta', 1);
      r.onsuccess = () => {
        const tx = r.result.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({ id: KEY, meta: META, coverBlob: null });
        tx.oncomplete = () => { r.result.close(); res(); };
        tx.onerror = () => rej(tx.error);
      };
    }),
  ]), { KEY, META });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.dc-topbar');
  const L = logicDriver(page);
  const metaRecord = () => page.evaluate(KEY => new Promise(res => {
    const r = indexedDB.open('listening-audio-meta', 1);
    r.onsuccess = () => {
      const q = r.result.transaction('meta', 'readonly').objectStore('meta').get(KEY);
      q.onsuccess = () => { const m = q.result; r.result.close(); res(m ? { cover: m.meta && m.meta.cover, blob: !!m.coverBlob, type: m.coverBlob && m.coverBlob.type } : null); };
    };
  }), KEY);
  const rowCover = async () => {
    await L(`logic.selectPlaylist('__cached');`);
    await page.waitForTimeout(300);
    return L(`const r = logic.renderVals().v.tracksRender.find(r => r.title === '凤凰于飞'); return r ? r.coverStyle : null;`);
  };
  return { ctx, page, errors, coverRequests, L, metaRecord, rowCover };
}

// ---------- APK（假原生壳） ----------
{
  const t = await setup(true);
  let rec = null;
  for (let i = 0; i < 25; i++) { rec = await t.metaRecord(); if (rec && rec.blob) break; await t.page.waitForTimeout(400); }
  check('APK: cached QQ song gets its cover backfilled into the meta DB', rec && rec.blob && rec.type === 'image/png', rec);
  check('APK: stored meta keeps the original cover URL (data not rewritten)', rec && rec.cover === HTTP_COVER, rec && rec.cover);
  const http = await t.page.evaluate(() => window.__http);
  check('APK: native download asked for the https cover', http.includes(HTTPS_COVER), http);
  check('APK: native download never asked for an http:// URL', http.every(u => !/^http:\/\//.test(u)), http);
  check('APK: one backfill attempt per song (no repeated requests)', http.filter(u => u === HTTPS_COVER).length === 1, http.length);
  await t.page.waitForTimeout(800);
  const style = await t.rowCover();
  check('APK: 「已缓存」 row shows the cover from a local blob: URL', /url\('blob:/.test(style || ''), (style || '').slice(0, 80));
  check('APK: WebView never asked for an http:// cover image', t.coverRequests.every(u => !/^http:\/\//.test(u)), t.coverRequests);
  check('APK: no page errors', t.errors.length === 0, t.errors);
  await t.ctx.close();
}

// ---------- 网页版 ----------
{
  const t = await setup(false);
  await t.page.waitForTimeout(3000);
  const rec = await t.metaRecord();
  check('web: no backfill (QQ covers are not CORS-readable in a browser)', rec && !rec.blob, rec);
  const style = await t.rowCover();
  check('web: row uses the https cover URL', (style || '').includes(`url('${HTTPS_COVER}')`), (style || '').slice(0, 100));
  await t.page.waitForTimeout(1500);
  check('web: page never requested an http:// cover image', t.coverRequests.every(u => !/^http:\/\//.test(u)), t.coverRequests);
  // 真实接口：新取到的 QQ 封面地址就是 https
  const real = await t.page.evaluate(async () => {
    const tr = await window.ListeningAPI.fetchQQDetails({ qqId: '004WAfxJ1q8L9h', qqSearchKey: '凤凰于飞 刘欢' });
    return { cover: tr.cover, audio: tr.audioUrl && tr.audioUrl.slice(0, 8), loaded: tr.detailsLoaded };
  });
  check('real API: fetchQQDetails returns an https cover', real.loaded && /^https:\/\/y\.gtimg\.cn\//.test(real.cover || ''), real);
  check('web: no page errors', t.errors.length === 0, t.errors);
  await t.ctx.close();
}

await browser.close();
process.exit(finish());

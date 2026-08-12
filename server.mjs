/**
 * 一体化服务：静态页面（examples/）+ CORS 代理，合并成一个进程/一个端口。
 * 本机开发和线上部署（如 Render）都跑这一个文件：node server.mjs
 *
 * 静态部分：原 examples/static-server.mjs 的逻辑
 * 代理部分：原 proxy-server.mjs 的逻辑（/proxy /stream /sc-client-id）
 *
 * 为什么合并：合并后代理和页面同源，前端不用再写死 localhost:8765 这种本机地址，
 * 部署到公网上代理和页面自然就在同一个域名下。
 *
 * 为什么要能直连：proxy-server.mjs 原来所有出网请求都写死走公司内网代理隧道
 * proxy.nioint.com:8080，这是本机开发环境专用的出网方式；线上服务器（如 Render）
 * 根本连不到这个内网地址，所以这里默认直连，只有显式设置 CORP_PROXY_HOST 环境变量
 * 时才走隧道（留给还需要在公司网络里跑本机开发的场景用）。
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'examples');
const PORT = parseInt(process.env.PORT, 10) || 4444;
const CORP_PROXY_HOST = process.env.CORP_PROXY_HOST || null;
const CORP_PROXY_PORT = parseInt(process.env.CORP_PROXY_PORT, 10) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  // Range / Content-Range 是给 /stream 拖进度条用的：同源访问不需要这两行，
  // 但 src/api 也支持被别的页面跨域调用，那种场景下少了它们范围请求会被浏览器拦掉
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  // ---- 代理路由 ----

  if (req.url.startsWith('/sc-client-id')) {
    // ?refresh=1&stale=<id>：客户端拿这个 id 收到了 401/403，请求换一个。
    // 只有它报上来的失效值确实就是当前缓存的这个才真的去换——否则一个手里攥着旧 id 的标签页
    // 会把另一个标签页刚刷新成功的新值冲掉，几个客户端互相冲永远收敛不了。
    // 冷却时间是同一个道理：一整队 20 首歌全 401 时不能触发 20 次抓取
    const stale = reqUrl.searchParams.get('stale');
    const force = reqUrl.searchParams.get('refresh') === '1'
      && (!stale || !scId || stale === scId.id)
      && Date.now() - scLastRefreshAt > SC_REFRESH_COOLDOWN;
    if (force) scLastRefreshAt = Date.now();
    try {
      const cur = await getClientId({ force });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      // source 是线上唯一的可观测性：curl 一下就知道抓取到底有没有工作，还是一直在吃兜底值
      res.end(JSON.stringify({ client_id: cur.id, source: cur.source, fetched_at: cur.fetchedAt }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.url.startsWith('/stream')) {
    const targetUrl = reqUrl.searchParams.get('url');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing ?url= parameter' }));
      return;
    }
    try {
      const target = new URL(targetUrl);
      await streamProxyRequest(target, res, req);
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      } else if (!res.writableEnded) {
        // 响应头早就发出去了，没法再改成 502——只能掐断连接。不掐的话浏览器会一直挂着
        // 等剩下的字节，直到前端 12 秒看门狗把这首歌跳掉
        res.destroy();
      }
    }
    return;
  }

  if (req.url.startsWith('/proxy')) {
    const targetUrl = reqUrl.searchParams.get('url');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing ?url= parameter' }));
      return;
    }
    try {
      const target = new URL(targetUrl);
      const result = await proxyRequest(target);
      const headers = { 'Content-Type': result.contentType || 'application/json' };
      if (result.location) headers['X-Proxy-Location'] = result.location;
      res.writeHead(result.status, headers);
      res.end(result.body);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ---- 静态文件路由 ----

  const urlPath = decodeURIComponent(reqUrl.pathname);
  const relPath = urlPath === '/' ? '/Listening Player.dc.html' : urlPath;
  const filePath = path.join(dir, relPath);
  if (!filePath.startsWith(dir)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`listening server on :${PORT}`);
  console.log('  /                  — Listening Player.dc.html');
  console.log('  /proxy?url=...     — basic forward');
  console.log('  /stream?url=...    — streaming forward (audio)');
  console.log('  /sc-client-id      — get SoundCloud client_id');
  if (CORP_PROXY_HOST) console.log(`  outbound via corp tunnel ${CORP_PROXY_HOST}:${CORP_PROXY_PORT}`);
});

// 自 ping：防止 Render 免费实例闲置 ~15 分钟后休眠。RENDER_EXTERNAL_URL 由 Render 自动注入，
// 本机开发没有这个变量时不会启用。只能防止睡着，真睡着了还是得靠外部请求唤醒（见 .github/workflows/keep-alive.yml）。
if (process.env.RENDER_EXTERNAL_URL) {
  setInterval(() => {
    fetch(process.env.RENDER_EXTERNAL_URL).catch(() => {});
  }, 10 * 60 * 1000);
}

// ====================== helpers ======================

// ====================== SoundCloud client_id ======================
// SoundCloud 早就不发新 API key 了，client_id 只能从它自己的网页里抓。这里每一条都是为了让
// "抓取失败"不等于"服务永久死掉"——旧实现抓到什么就永久缓存什么，没有 TTL 也没有失效入口，
// 一次糟糕的冷启动足以把整个实例的 SoundCloud 毒死到下次重启为止。Render 免费实例天天休眠，
// 等于每次唤醒都在掷骰子，这就是"时好时坏"的来源。

const SC_FALLBACK_ID = 'O7atZypwLvuWSY9hWnnQ3vrLTHH7wqMe'; // 2025-07 从 soundcloud.com 提取，随时可能失效
const SC_ID_TTL = 6 * 60 * 60 * 1000;   // 校验通过的 id 能用多久
const SC_ID_NEG_TTL = 5 * 60 * 1000;    // 只抓到兜底值时的缓存时长——这条是"永久中毒"的解药
const SC_REFRESH_COOLDOWN = 60 * 1000;  // 两次强制刷新之间的最小间隔
const SC_COLD_WAIT_MS = 12000;          // 冷缓存最多阻塞这么久，超时先发兜底值，抓取继续在后台跑
// 必须锚定 client_id 这个词。旧实现用的是 /"([A-Za-z0-9]{32})"/，匹配到的是页面里第一个
// 32 位串（构建哈希/nonce），根本不是 client_id——所谓"自动抓取"其实一次都没成功过
const SC_ID_RE = /client_id\s*[:=]\s*["']([A-Za-z0-9]{32})["']/;

let scId = null;         // { id, source, fetchedAt, isFallback }
let scInflight = null;   // 正在进行的抓取，多标签页/整队列的歌共用同一次
let scLastRefreshAt = 0;

function scIdFresh() {
  if (!scId) return false;
  return Date.now() - scId.fetchedAt < (scId.isFallback ? SC_ID_NEG_TTL : SC_ID_TTL);
}

/**
 * 取一个可用的 client_id。默认是 stale-while-revalidate：有缓存就立刻返回，过期了在后台刷新。
 * 这不是优化而是必需——客户端那次 /sc-client-id 只等 5 秒，一次完整抓取要十几秒，
 * 若每次刷新都让客户端等，客户端就会超时并悄悄退回硬编码值，等于这个修复自己把自己废掉。
 * 只有完全没有缓存（或调用方明确要求 force）时才阻塞，且有上限。
 */
async function getClientId({ force = false } = {}) {
  if (!force && scIdFresh()) return scId;
  if (!force && scId) { refreshClientId(); return scId; } // 过期但有旧值：后台刷新，这次先用旧的
  const got = await Promise.race([
    refreshClientId(),
    new Promise(r => setTimeout(() => r(null), SC_COLD_WAIT_MS)),
  ]);
  return got || scId || { id: SC_FALLBACK_ID, source: 'fallback', isFallback: true, fetchedAt: Date.now() };
}

// 抓一次并写进缓存。并发调用共用同一个 promise，避免 N 个请求触发 N 次抓取
function refreshClientId() {
  if (scInflight) return scInflight;
  scInflight = resolveClientId()
    .catch(e => { console.warn('[sc] client_id 抓取失败:', e.message); return null; })
    .then(found => {
      scId = { ...(found || { id: SC_FALLBACK_ID, source: 'fallback' }), fetchedAt: Date.now() };
      scId.isFallback = scId.source === 'fallback';
      console.log(`[sc] client_id=${scId.id.slice(0, 6)}… source=${scId.source}`);
      scInflight = null;
      return scId;
    });
  return scInflight;
}

// 按可靠性从高到低找，找到就短路
async function resolveClientId() {
  // 1. 环境变量：线上出事时的逃生口。在 Render 面板填一个值重启就能恢复，不用等改代码重新部署
  const fromEnv = (process.env.SC_CLIENT_ID || '').trim();
  if (fromEnv) return { id: fromEnv, source: 'env' };

  const home = await proxyRequest(new URL('https://soundcloud.com'), {}, { timeout: 10000 });

  // 2. 万一哪天 client_id 就内联在首页里
  const inline = home.body.match(SC_ID_RE);
  if (inline && await validateClientId(inline[1])) return { id: inline[1], source: 'html' };

  // 3. 真正的位置：首页引用的 a-v2.sndcdn.com 资源包。client_id 历来在编号最大的那个 chunk 里，
  //    所以取最后几个倒着试。只试 4 个是因为 proxyRequest 会把整个 body 缓冲成字符串、没有大小上限，
  //    这些 chunk 动辄几百 KB，Render 免费实例经不起把十来个全拉下来
  const scripts = [...home.body.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)]
    .map(m => m[1]);
  for (const src of scripts.slice(-4).reverse()) {
    try {
      const js = await proxyRequest(new URL(src), {}, { timeout: 10000 });
      const m = js.body.match(SC_ID_RE);
      if (m && await validateClientId(m[1])) return { id: m[1], source: 'assets' };
    } catch (e) { /* 这个包拿不到就试下一个 */ }
  }

  return null; // 交给上层落到兜底值（并因此只缓存 5 分钟）
}

// 用一次真实搜索来验证。旧实现拿 /tracks/1 且只认 200——那条 track 存不存在没人保证，
// 一个完全有效的 key 在那里拿到 404 同样会被判死，于是永远落到硬编码兜底值
async function validateClientId(id) {
  try {
    const r = await proxyRequest(
      new URL(`https://api-v2.soundcloud.com/search/tracks?q=a&client_id=${id}&limit=1`),
      {}, { timeout: 8000 }
    );
    return r.status === 200;
  } catch (e) {
    return false;
  }
}

// timeout 可调是给 client_id 抓取用的：那条链路要串起首页 + 若干个资源包 + 一次校验，
// 每一跳都按默认 15 秒算的话总时长会超过客户端的等待窗口
function proxyRequest(target, extraHeaders = {}, { timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = target.protocol === 'https:';
    const mod = isHttps ? https : http;

    if (CORP_PROXY_HOST && isHttps) {
      const tunnelReq = http.request({
        hostname: CORP_PROXY_HOST,
        port: CORP_PROXY_PORT,
        method: 'CONNECT',
        path: `${target.hostname}:${target.port || 443}`,
        headers: { Host: `${target.hostname}:${target.port || 443}` },
        timeout,
      });
      tunnelReq.on('connect', (_, socket) => {
        const headers = {
          Host: target.hostname,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          ...extraHeaders,
        };
        const r = https.request({
          rejectUnauthorized: false,
          socket,
          hostname: target.hostname,
          port: target.port || 443,
          path: target.pathname + target.search,
          method: 'GET',
          headers,
          timeout,
          agent: false,
        }, response => {
          const chunks = [];
          response.on('data', c => chunks.push(c));
          response.on('end', () => resolve({
            status: response.statusCode,
            contentType: response.headers['content-type'],
            location: response.headers['location'],
            body: Buffer.concat(chunks).toString(),
          }));
        });
        r.on('error', reject);
        r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
        r.end();
      });
      tunnelReq.on('error', reject);
      tunnelReq.on('timeout', () => { tunnelReq.destroy(); reject(new Error('tunnel timeout')); });
      tunnelReq.end();
      return;
    }

    // 直连（线上默认路径；本机不在公司网络下也走这条）
    const opts = {
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname + target.search,
      method: 'GET',
      headers: {
        Host: target.hostname,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        ...extraHeaders,
      },
      timeout,
    };
    const r = mod.request(opts, response => {
      const chunks = [];
      response.on('data', c => chunks.push(c));
      response.on('end', () => resolve({
        status: response.statusCode,
        contentType: response.headers['content-type'],
        location: response.headers['location'],
        body: Buffer.concat(chunks).toString(),
      }));
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    r.end();
  });
}

// 上游响应头里必须原样带下去的那几个：少了 Content-Range 的 206 会被浏览器当成损坏响应
const STREAM_PASS_THROUGH = {
  'content-length': 'Content-Length',
  'content-range': 'Content-Range',
  'accept-ranges': 'Accept-Ranges',
  'etag': 'ETag',
  'last-modified': 'Last-Modified',
};

// 流式转发：用于 CDN 音频文件，不缓冲直接 pipe 给浏览器
function streamProxyRequest(target, clientRes, clientReq, hop = 0) {
  return new Promise((resolve, reject) => {
    const isHttps = target.protocol === 'https:';
    const mod = isHttps ? https : http;

    const reqHeaders = {
      Host: target.hostname,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      Referer: 'https://soundcloud.com/',
    };
    // 拖进度条时浏览器发的是 Range 请求。以前这个头被丢掉、却又无条件对外声明 Accept-Ranges: bytes，
    // 等于骗浏览器：它按 206 部分内容去解析，拿到的却是一个 200 全量响应
    if (clientReq && clientReq.headers.range) reqHeaders.Range = clientReq.headers.range;

    let upstreamReq = null;
    // 看门狗跳歌 / 用户切歌后浏览器那端已经断了，服务端却还在往一个死 socket 里下载几 MB。
    // Render 免费实例上这是实打实的浪费。正常播完时 close 也会触发，但那时请求早已结束，destroy 无害
    clientRes.on('close', () => { if (upstreamReq) upstreamReq.destroy(); });

    const handleUpstream = upstreamRes => {
      const st = upstreamRes.statusCode;

      // CDN 偶尔会 302 到另一个节点，把重定向响应体当音频原样传下去必然解码失败
      if (st >= 300 && st < 400 && upstreamRes.headers.location && hop < 3) {
        upstreamRes.resume(); // 排空，别让 socket 悬着
        streamProxyRequest(new URL(upstreamRes.headers.location, target), clientRes, clientReq, hop + 1)
          .then(resolve, reject);
        return;
      }

      const headers = {
        'Content-Type': upstreamRes.headers['content-type'] || 'audio/mpeg',
        // 失败响应绝不能缓存：一个被缓存的 403 会让接下来一小时内所有重试都直接命中浏览器缓存
        // 而失败，连网络都不碰——用户感受到的就是"重试也没用"
        'Cache-Control': st >= 200 && st < 300 ? 'public, max-age=3600' : 'no-store',
      };
      for (const [from, to] of Object.entries(STREAM_PASS_THROUGH)) {
        if (upstreamRes.headers[from]) headers[to] = upstreamRes.headers[from];
      }
      clientRes.writeHead(st, headers);
      upstreamRes.pipe(clientRes);
      upstreamRes.on('end', () => resolve());
      upstreamRes.on('error', err => {
        // 走到这里响应头已经发出去了，路由层的 catch 那时已经改不动状态码，只能掐断
        clientRes.destroy(err);
        reject(err);
      });
    };

    if (CORP_PROXY_HOST && isHttps) {
      const tunnelReq = http.request({
        hostname: CORP_PROXY_HOST,
        port: CORP_PROXY_PORT,
        method: 'CONNECT',
        path: `${target.hostname}:${target.port || 443}`,
        headers: { Host: `${target.hostname}:${target.port || 443}` },
        timeout: 60000,
      });
      tunnelReq.on('connect', (_, socket) => {
        const r = https.request({
          rejectUnauthorized: false,
          socket,
          hostname: target.hostname,
          port: target.port || 443,
          path: target.pathname + target.search,
          method: 'GET',
          headers: reqHeaders,
          timeout: 60000,
          agent: false,
        }, handleUpstream);
        upstreamReq = r;
        r.on('error', reject);
        r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
        r.end();
      });
      tunnelReq.on('error', reject);
      tunnelReq.on('timeout', () => { tunnelReq.destroy(); reject(new Error('tunnel timeout')); });
      tunnelReq.end();
      return;
    }

    // 直连
    const opts = {
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname + target.search,
      method: 'GET',
      headers: reqHeaders,
      timeout: 60000,
    };
    const r = mod.request(opts, handleUpstream);
    upstreamReq = r;
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    r.end();
  });
}

/**
 * 一体化服务：静态页面（examples/）+ CORS 代理，合并成一个进程/一个端口。
 * 本机开发和线上部署（如 Render）都跑这一个文件：node server.mjs
 *
 * 静态部分：原 examples/static-server.mjs 的逻辑
 * 代理部分：原 proxy-server.mjs 的逻辑（/proxy /proxy-auth /stream /sc-client-id）
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
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  // ---- 代理路由 ----

  if (req.url.startsWith('/sc-client-id')) {
    try {
      const cid = await getClientId();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ client_id: cid }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.url.startsWith('/proxy-auth')) {
    const targetUrl = reqUrl.searchParams.get('url');
    const auth = reqUrl.searchParams.get('auth');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing ?url= parameter' }));
      return;
    }
    try {
      const target = new URL(targetUrl);
      const result = await proxyRequest(target, auth ? { Authorization: auth } : {});
      res.writeHead(result.status, { 'Content-Type': result.contentType || 'application/json' });
      res.end(result.body);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
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
      await streamProxyRequest(target, res);
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
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
      res.writeHead(result.status, { 'Content-Type': result.contentType || 'application/json' });
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
  console.log('  /proxy-auth?url=...&auth=... — forward with Authorization header');
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

let cachedClientId = null;

async function getClientId() {
  if (cachedClientId) return cachedClientId;

  try {
    const html = await proxyRequest(new URL('https://soundcloud.com'));
    const m = html.body.match(/"([A-Za-z0-9]{32})"/);
    if (m) {
      const test = await proxyRequest(
        new URL(`https://api-v2.soundcloud.com/tracks/1?client_id=${m[1]}`)
      );
      if (test.status === 200) {
        cachedClientId = m[1];
        console.log('client_id from page:', cachedClientId);
        return cachedClientId;
      }
    }
  } catch (e) { /* skip */ }

  cachedClientId = 'O7atZypwLvuWSY9hWnnQ3vrLTHH7wqMe';
  return cachedClientId;
}

function proxyRequest(target, extraHeaders = {}) {
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
        timeout: 15000,
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
          timeout: 15000,
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
      timeout: 15000,
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

// 流式转发：用于 CDN 音频文件，不缓冲直接 pipe 给浏览器
function streamProxyRequest(target, clientRes) {
  return new Promise((resolve, reject) => {
    const isHttps = target.protocol === 'https:';
    const mod = isHttps ? https : http;

    const handleUpstream = upstreamRes => {
      const headers = {
        'Content-Type': upstreamRes.headers['content-type'] || 'audio/mpeg',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      };
      if (upstreamRes.headers['content-length']) {
        headers['Content-Length'] = upstreamRes.headers['content-length'];
      }
      clientRes.writeHead(upstreamRes.statusCode, headers);
      upstreamRes.pipe(clientRes);
      upstreamRes.on('end', () => resolve());
      upstreamRes.on('error', reject);
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
          headers: {
            Host: target.hostname,
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            Referer: 'https://soundcloud.com/',
          },
          timeout: 60000,
          agent: false,
        }, handleUpstream);
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
      headers: {
        Host: target.hostname,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        Referer: 'https://soundcloud.com/',
      },
      timeout: 60000,
    };
    const r = mod.request(opts, handleUpstream);
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    r.end();
  });
}

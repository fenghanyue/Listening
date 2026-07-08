/**
 * 本地 CORS 代理 — 转发浏览器发来的请求到真正 API，绕过浏览器同源策略
 * 启动: node proxy-server.mjs [端口号，默认 8765]
 *
 * 请求格式:
 *   GET /proxy?url=<URL编码的目标地址>
 *   GET /proxy-auth?url=<URL>&auth=<track_authorization JWT>
 *   GET /sc-client-id — 获取 SoundCloud 的 client_id
 *
 * 为什么需要这个？
 * SoundCloud api-v2 不支持 CORS，浏览器直接 fetch 会被拦截。
 * SoundCloud 媒体 API 需要 track_authorization JWT 作为 Authorization header。
 * 其他源（网易云/QQ）在浏览器端可以直连，不需要代理。
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';

const PORT = parseInt(process.argv[2], 10) || 8765;

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

  // GET /sc-client-id → 返回由服务器抓取的有效 client_id
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

  // GET /proxy-auth?url=...&auth=... → 带 Authorization header 代理
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
      if (result.status >= 300 && result.status < 400 && result.location) {
        // 处理重定向（SoundCloud 媒体 API 先返回 JSON，但也可能重定向）
        res.writeHead(result.status, { 'Content-Type': result.contentType || 'application/json' });
        res.end(result.body);
      } else {
        res.writeHead(result.status, { 'Content-Type': result.contentType || 'application/json' });
        res.end(result.body);
      }
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /stream?url=... → 流式转发 CDN mp3 给 audio 元素播放
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

  // GET /proxy?url=... → 无授权代理
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
});

server.listen(PORT, () => {
  console.log(`CORS proxy running at http://localhost:${PORT}`);
  console.log('  /proxy?url=...     — basic forward');
  console.log('  /proxy-auth?url=...&auth=... — forward with Authorization header');
  console.log('  /sc-client-id      — get SoundCloud client_id');
});

// ====================== helpers ======================

let cachedClientId = null;

async function getClientId() {
  if (cachedClientId) return cachedClientId;

  // 1. 从 SoundCloud 网页抓取
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

  // 2. 备用
  cachedClientId = 'O7atZypwLvuWSY9hWnnQ3vrLTHH7wqMe';
  return cachedClientId;
}

// 公司代理地址（终端不走 PAC，需要显式配置）
const PROXY_HOST = 'proxy.nioint.com';
const PROXY_PORT = 8080;

function proxyRequest(target, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = target.protocol === 'https:';
    const mod = isHttps ? https : http;

    if (isHttps) {
      const tunnelReq = http.request({
        hostname: PROXY_HOST,
        port: PROXY_PORT,
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
        const opts = {
          rejectUnauthorized: false,
          socket,
          hostname: target.hostname,
          port: target.port || 443,
          path: target.pathname + target.search,
          method: 'GET',
          headers,
          timeout: 15000,
          agent: false,
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
      tunnelReq.on('error', reject);
      tunnelReq.on('timeout', () => { tunnelReq.destroy(); reject(new Error('tunnel timeout')); });
      tunnelReq.end();
      return;
    }

    // HTTP 直连
    const opts = {
      hostname: target.hostname,
      port: target.port || 80,
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

// 流式转发：用于 CDN mp3 文件，不缓冲直接 pipe 给浏览器
function streamProxyRequest(target, clientRes) {
  return new Promise((resolve, reject) => {
    const isHttps = target.protocol === 'https:';
    const mod = isHttps ? https : http;

    if (isHttps) {
      const tunnelReq = http.request({
        hostname: PROXY_HOST,
        port: PROXY_PORT,
        method: 'CONNECT',
        path: `${target.hostname}:${target.port || 443}`,
        headers: { Host: `${target.hostname}:${target.port || 443}` },
        timeout: 60000,
      });
      tunnelReq.on('connect', (_, socket) => {
        const opts = {
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
        };
        const r = mod.request(opts, upstreamRes => {
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

    // HTTP 直连
    const opts = {
      hostname: target.hostname,
      port: target.port || 80,
      path: target.pathname + target.search,
      method: 'GET',
      headers: {
        Host: target.hostname,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        Referer: 'https://soundcloud.com/',
      },
      timeout: 60000,
    };
    const r = mod.request(opts, upstreamRes => {
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
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    r.end();
  });
}

/**
 * 🔧 工具函数
 * 从 MusicSquare 提取的 LRC 解析
 */

/**
 * 解析 LRC 歌词
 * @param {string} txt - 原始 LRC 文本
 * @returns {Array<{time: number, text: string}>}
 */
export function parseLRC(txt) {
  if (!txt) return [];
  const lines = txt.split(/\r?\n/);
  const reg = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/;
  const out = [];
  for (const line of lines) {
    const m = reg.exec(line);
    if (!m) continue;
    const min = parseInt(m[1], 10) || 0;
    const sec = parseInt(m[2], 10) || 0;
    const ms = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0;
    const time = min * 60 + sec + ms / 1000;
    const text = line.replace(reg, '').trim();
    if (text) out.push({ time, text });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/**
 * server.mjs 那几个代理路由（/proxy /stream /sc-client-id）的地址前缀。
 * 网页版和代理同源，前缀是空串、走相对路径；APK 里页面来源是 https://localhost，本机没有代理，
 * 页面会在加载 api-bundle.js 之前把 globalThis.LISTENING_PROXY_BASE 设成线上实例的地址。
 * 每次请求时才读，不在模块加载时定死——加载顺序万一有出入也不会一直拿着错的值
 * @returns {string}
 */
export function proxyBase() {
  return (typeof globalThis !== 'undefined' && globalThis.LISTENING_PROXY_BASE) || '';
}

/**
 * 根据播放链接的文件扩展名判断是否无损格式（flac/wav/ape/alac/aiff）
 * @param {string} url - 播放链接
 * @returns {boolean}
 */
export function isLosslessExtension(url) {
  if (!url) return false;
  const base = url.split('?')[0].toLowerCase();
  const extMatch = base.match(/\.([a-z0-9]+)$/);
  const ext = extMatch ? extMatch[1] : '';
  return ['flac', 'wav', 'ape', 'alac', 'aiff'].includes(ext);
}

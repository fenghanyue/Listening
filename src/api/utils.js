/**
 * 🔧 工具函数
 * 从 MusicSquare 提取的音质推断 / 时间格式化 / LRC 解析
 */

/**
 * 根据音频链接后缀推断音质
 * @param {string} url - 音频直链
 * @returns {{tag: string|null, label: string}}
 */
export function inferQualityFromUrl(url) {
  if (!url) return { tag: null, label: '' };
  let base = url.split('?')[0].toLowerCase();
  const m = base.match(/\.([a-z0-9]+)$/);
  const ext = m ? m[1] : '';
  const losslessExts = ['flac', 'wav', 'ape', 'alac', 'aiff'];
  if (losslessExts.includes(ext)) {
    return { tag: 'lossless', label: 'LOSSLESS' };
  }
  // 其他一律当作 320K
  return { tag: '320k', label: '320K' };
}

/**
 * 格式化秒数为 mm:ss
 * @param {number} sec
 * @returns {string}
 */
export function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

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

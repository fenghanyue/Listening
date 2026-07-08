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

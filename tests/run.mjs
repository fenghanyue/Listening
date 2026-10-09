// 一条命令跑测试：在随机端口起 server.mjs，依次跑 tests/*.test.mjs，跑完关掉服务器，最后汇总。
// 用法：npm test                         跑全部
//       node tests/run.mjs smoke qq-cover  只跑这几个
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);

// 快的、不联网的排前面
const ORDER = ['smoke', 'qq-cover', 'playlist', 'native', 'offline'];
const available = fs.readdirSync(here).filter(f => f.endsWith('.test.mjs')).map(f => f.slice(0, -'.test.mjs'.length));
const known = [...ORDER.filter(n => available.includes(n)), ...available.filter(n => !ORDER.includes(n)).sort()];
const wanted = process.argv.slice(2);
const unknown = wanted.filter(n => !known.includes(n));
if (unknown.length) {
  console.error(`没有这些测试：${unknown.join(', ')}。可选：${known.join(', ')}`);
  process.exit(2);
}
const names = wanted.length ? known.filter(n => wanted.includes(n)) : known;

const TEST_TIMEOUT_MS = 6 * 60 * 1000; // 单个测试最多跑这么久，超时算失败

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// 用 node:http 探活：它不走任何代理环境变量，本地服务器始终直连
function isUp(url) {
  return new Promise(resolve => {
    const req = http.get(url, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

const port = await freePort();
const BASE = `http://localhost:${port}/`;
const serverLog = [];
const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port) } });
server.stdout.on('data', d => serverLog.push(String(d)));
server.stderr.on('data', d => serverLog.push(String(d)));
const stopServer = () => { if (server.exitCode === null) server.kill(); };
process.on('SIGINT', () => { stopServer(); process.exit(130); });

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  up = await isUp(BASE);
  if (!up) await new Promise(r => setTimeout(r, 250));
}
if (!up) {
  console.error('本地服务器没起来：\n' + serverLog.join(''));
  stopServer();
  process.exit(1);
}
console.log(`本地服务器：${BASE}`);

const summary = [];
for (const name of names) {
  console.log(`\n===== ${name} =====`);
  const t0 = Date.now();
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(here, `${name}.test.mjs`)], { cwd: root, env: { ...process.env, BASE }, stdio: 'inherit' });
    const timer = setTimeout(() => { console.log(`超时（${TEST_TIMEOUT_MS / 60000} 分钟），停掉`); child.kill(); }, TEST_TIMEOUT_MS);
    child.on('exit', c => { clearTimeout(timer); resolve(c === null ? 1 : c); });
  });
  summary.push({ name, ok: code === 0, secs: Math.round((Date.now() - t0) / 1000) });
}
stopServer();

console.log('\n===== 汇总 =====');
for (const s of summary) console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.name}  (${s.secs}s)`);
process.exit(summary.every(s => s.ok) ? 0 : 1);

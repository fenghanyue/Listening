// 测试公共部分：找 Playwright、开浏览器、调页面组件、记录结果。各个 *.test.mjs 都从这里引
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// tests/run.mjs 会起好本地服务器并传进来；单独跑某个测试时自己先 `PORT=4555 node server.mjs`
export const BASE = process.env.BASE || 'http://localhost:4555/';

// 截图放系统临时目录，不进仓库
export const OUT = process.env.TEST_OUT || path.join(os.tmpdir(), 'listening-tests');
fs.mkdirSync(OUT, { recursive: true });

// Playwright 不是项目依赖（根目录 package.json 保持零依赖，Render 部署用）。依次试：
// PLAYWRIGHT_MODULE 指定的路径 → 装在 tests/ 或根目录 node_modules 里的 playwright →
// Claude Code 云端环境自带的那份
const PLAYWRIGHT_CANDIDATES = [
  process.env.PLAYWRIGHT_MODULE,
  'playwright',
  '/opt/node-tools/node_modules/playwright/index.mjs',
].filter(Boolean);

async function loadPlaywright() {
  for (const spec of PLAYWRIGHT_CANDIDATES) {
    try {
      return await import(spec);
    } catch (e) { /* 试下一个 */ }
  }
  throw new Error('找不到 Playwright，安装方法见 tests/README.md');
}

// 云端容器出网要走代理（HTTPS_PROXY），本机一般没有；本地服务器始终直连
export async function launchBrowser(args = []) {
  const { chromium } = await loadPlaywright();
  const proxy = process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY, bypass: '<-loopback>,localhost,127.0.0.1' }
    : undefined;
  return chromium.launch({ args, proxy });
}

// 页面是 dc-runtime 组件：顺着 React fiber 找到组件实例 logic，直接调它的方法、读 state / renderVals。
// fn 是函数体字符串，能用 logic 和 arg 两个变量
export function logicDriver(page) {
  return (fn, arg) => page.evaluate(([src, a]) => {
    const el = document.querySelector('.dc-app-shell');
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    let f = el[key];
    while (f && !(f.stateNode && f.stateNode.logic && f.stateNode.logic.renderVals)) f = f.return;
    return (new Function('logic', 'arg', src))(f.stateNode.logic, a);
  }, [fn, arg]);
}

// check(名字, 是否通过, 附带信息) 逐条打印 PASS / FAIL；最后 process.exit(finish()) 打印汇总、给出退出码
export function createChecker() {
  const results = [];
  const check = (name, ok, extra) => {
    results.push(!!ok);
    const tail = extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 400) : '';
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${tail}`);
  };
  const finish = () => {
    const passed = results.filter(Boolean).length;
    console.log(`\n${passed}/${results.length} passed`);
    return results.length > 0 && passed === results.length ? 0 : 1;
  };
  return { check, finish };
}

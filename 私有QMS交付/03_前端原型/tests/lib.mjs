/**
 * 测试公共方法（puppeteer-core + 本机 Chrome）
 *   npm install 之后可用；也可以用环境变量 QMS_TOOLS 指向装有 puppeteer-core 的目录，CHROME_BIN 指定浏览器。
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '..');
const require = createRequire(import.meta.url);

function loadPuppeteer() {
  for (const base of [process.env.QMS_TOOLS, ROOT].filter(Boolean)) {
    try { return require(require.resolve('puppeteer-core', { paths: [base] })); } catch (e) { /* 换下一个位置 */ }
  }
  throw new Error('找不到 puppeteer-core：请在 03_前端原型 目录执行 npm install');
}

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
].filter(Boolean);

export async function launch() {
  const puppeteer = loadPuppeteer();
  const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!executablePath) throw new Error('找不到 Chrome，请用环境变量 CHROME_BIN 指定浏览器路径');
  return puppeteer.launch({ executablePath, headless: true, args: ['--allow-file-access-from-files', '--no-first-run', '--disable-extensions'] });
}

/**
 * 收集页面错误：console.error、界面错误处理器的输出、未捕获异常。
 * 内嵌气泡服务的网络与证书错误属于预期，忽略：测试用 file:// 打开页面，也不启动气泡服务（localhost:3080），
 * 浏览器会报跨域、内嵌被拒（frame-ancestors）、连接失败；产品里这些情况已经有“请用 localhost:5180 打开”的提示。
 */
export function collect(page) {
  const errors = [], warnings = [];
  const ignore = (t) => /223\.106\.198\.62|localhost:3080|127\.0\.0\.1:3080|ERR_CERT|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_BLOCKED_BY_RESPONSE|cdn\.tailwindcss\.com should not be used/.test(t)
    || /^Failed to load resource: net::ERR_FAILED$/.test(t);
  page.on('console', (m) => {
    const t = m.text();
    if (ignore(t)) return;
    if (m.type() === 'error' || /\[Vue warn\]|\[QMS\]/.test(t)) errors.push(t);
    else if (m.type() === 'warning') warnings.push(t);
  });
  page.on('pageerror', (e) => { const t = String((e && (e.stack || e.message)) || e); if (!ignore(t)) errors.push('未捕获异常：' + t); });
  return { errors, warnings, clear() { errors.length = 0; warnings.length = 0; } };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 打开原型；fresh 默认 true：每个标签页首次加载前清空演示数据（之后的刷新保留数据，便于测持久化） */
export async function openApp(browser, htmlPath, opts = {}) {
  const page = await browser.newPage();
  const [w, h] = String(opts.viewport || '1440x900').split('x').map(Number);
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  const log = collect(page);
  if (opts.fresh !== false) {
    await page.evaluateOnNewDocument(() => {
      try {
        if (!sessionStorage.getItem('qms-test-cleared')) { localStorage.removeItem('worlder-qms-proto-v1'); sessionStorage.setItem('qms-test-cleared', '1'); }
      } catch (e) { /* 忽略 */ }
    });
  }
  await page.goto(pathToFileURL(resolve(htmlPath)).href + '#' + (opts.route || '/workbench'), { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__QMS && !document.getElementById('boot'), { timeout: 45000 });
  if (opts.user) await setUser(page, opts.user);
  return { page, log };
}

export async function gotoRoute(page, route, wait = 600) {
  await page.evaluate((r) => { location.hash = '#' + r; }, route);
  await sleep(wait);
}

export async function setUser(page, uid) {
  await page.evaluate((u) => { window.__QMS.S.me = u; }, uid);
  await sleep(150);
}

/** 简单断言收集器 */
export function checker() {
  const results = [];
  return {
    results,
    ok(name, cond, detail) { results.push({ name, pass: !!cond, detail: cond ? '' : (detail == null ? '' : String(detail)) }); console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond || detail == null ? '' : '  → ' + detail)); },
    failed() { return results.filter((r) => !r.pass); },
  };
}

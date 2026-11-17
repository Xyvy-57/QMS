#!/usr/bin/env node
/**
 * Worlder QMS 原型构建脚本
 *   src/00_head.html + src/*.js + styles/* + vendor/*  →  单文件 qms_pro_qms.html（全部内联，可离线打开）
 *
 * 用法：
 *   npm install            # 首次：安装 Tailwind CLI（devDependencies）
 *   node build.mjs         # 输出 ./qms_pro_qms.html；vendor/ 缺文件时自动从 npm 镜像下载
 *
 * 可选参数：
 *   --out <文件>            指定输出路径
 *   --extra <目录,目录>     追加源码目录，与 src 按文件名排序后合并
 *   --tailwind <路径>       指定 Tailwind CLI（默认 ./node_modules/.bin/tailwindcss，或环境变量 TAILWIND_BIN）
 *   --registry <地址>       下载 vendor 用的 npm 镜像（默认 https://registry.npmmirror.com）
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def; };

const srcDir = resolve(arg('src', join(root, 'src')));
const extraDirs = String(arg('extra', '')).split(',').map((s) => s.trim()).filter(Boolean).map((d) => resolve(d));
const out = resolve(arg('out', join(root, 'qms_pro_qms.html')));
const vendorDir = resolve(arg('vendor', join(root, 'vendor')));
const registry = String(arg('registry', 'https://registry.npmmirror.com')).replace(/\/$/, '');
const twBin = arg('tailwind', process.env.TAILWIND_BIN || join(root, 'node_modules/.bin/tailwindcss'));

function fail(msg) { console.error('构建失败：' + msg); process.exit(1); }

/* 0. 第三方库：缺失时从 npm 镜像下载到 vendor/（只在首次构建时需要联网） */
const VENDOR = [
  { file: 'vue.global.prod.js', path: '/vue/3.4.38/files/dist/vue.global.prod.js', mark: 'Vue' },
  { file: 'chart.umd.min.js', path: '/chart.js/4.4.1/files/dist/chart.umd.js', mark: 'Chart' },
];
mkdirSync(vendorDir, { recursive: true });
for (const v of VENDOR) {
  const p = join(vendorDir, v.file);
  if (existsSync(p)) continue;
  const url = registry + v.path;
  console.log('下载 ' + url);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    if (!text.includes(v.mark) || text.length < 50000) throw new Error('内容不像 ' + v.mark + ' 的发布文件');
    writeFileSync(p, text);
  } catch (e) { fail('下载 ' + v.file + ' 失败（' + e.message + '）。请手动把该文件放到 vendor/ 目录后重试。'); }
}

if (!existsSync(join(srcDir, '00_head.html'))) fail('找不到 ' + join(srcDir, '00_head.html'));
if (!existsSync(twBin)) fail('找不到 Tailwind CLI：' + twBin + '\n请先在本目录执行 npm install，或用 --tailwind / TAILWIND_BIN 指定路径。');

/* 1. 收集 JS：src 与 extra 目录下的 *.js，按文件名排序（10_core → 15_actions → 20_ui → 页面 → 90_app） */
const dirs = [srcDir, ...extraDirs];
const jsFiles = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.js')).map((f) => join(d, f))).sort((a, b) => basename(a).localeCompare(basename(b)));
const dup = jsFiles.map((f) => basename(f)).filter((n, i, a) => a.indexOf(n) !== i);
if (dup.length) fail('存在同名源码文件：' + [...new Set(dup)].join(', '));

/* 乱码检查：U+FFFD 说明源码里有被损坏的字符，逐处列出便于修复 */
const BAD = String.fromCharCode(0xfffd);
const bad = [];
for (const f of [...jsFiles, join(srcDir, '00_head.html'), join(root, 'styles/app.css'), join(root, 'styles/tailwind.css')]) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => { const k = line.indexOf(BAD); if (k >= 0) bad.push(basename(f) + ':' + (i + 1) + '  …' + line.slice(Math.max(0, k - 16), k + 16) + '…'); });
}
if (bad.length) fail('源码中存在乱码字符 U+FFFD，请先修复：\n  ' + bad.join('\n  '));

/* 语法与页面模板检查（只编译不运行）：模板 template: `...` 用 Vue 编译器预编译，表达式按 JS 语法检查。
   Vue 编译器取本目录或 ../04_气泡识别软件 的 node_modules；都没有时跳过模板检查并提示 */
{
  const req = createRequire(import.meta.url);
  let compile = null;
  for (const base of [root, join(root, '..', '04_气泡识别软件')]) {
    try { compile = req(req.resolve('@vue/compiler-dom', { paths: [base] })).compile; break; } catch (e) { /* 换下一个位置 */ }
  }
  const problems = [];
  for (const f of jsFiles) {
    const text = readFileSync(f, 'utf8');
    try { new vm.Script(text, { filename: basename(f) }); } catch (e) { problems.push(basename(f) + ' 语法错误：' + e.message); }
    if (!compile) continue;
    const re = /template:\s*`([\s\S]*?)`/g;
    let m;
    while ((m = re.exec(text))) {
      const tpl = m[1], line0 = text.slice(0, m.index).split('\n').length;
      if (tpl.indexOf('${') >= 0) problems.push(basename(f) + ':' + line0 + ' 模板里不能出现 ${');
      try { compile(tpl, { prefixIdentifiers: true, hoistStatic: false, onError: (e) => problems.push(basename(f) + ':' + (line0 + (e.loc ? e.loc.start.line - 1 : 0)) + ' 模板错误：' + e.message), onWarn: () => {} }); }
      catch (e) { problems.push(basename(f) + ':' + line0 + ' 模板无法编译：' + e.message); }
    }
  }
  if (problems.length) fail('源码检查没有通过：\n  ' + problems.join('\n  '));
  console.log('源码检查通过：' + jsFiles.length + ' 个文件语法正确' + (compile ? '，页面模板均可编译' : '（没有找到 Vue 编译器，跳过模板检查：在 ../04_气泡识别软件 执行 npm install 后可检查）'));
}

const appJs =jsFiles.map((f) => '/* ===== ' + basename(f) + ' ===== */\n' + readFileSync(f, 'utf8')).join('\n;\n');

/* 2. Tailwind：扫描全部源码中的 class，输出压缩 CSS */
const cssOut = out + '.tw.css';
mkdirSync(dirname(out), { recursive: true });
/* 用 JSON 传给 Tailwind 配置：glob 里的 {js,html} 自带逗号，不能再用逗号分隔 */
const content = JSON.stringify(dirs.map((d) => join(d, '**/*.{js,html}')));
try {
  execFileSync(twBin, ['-c', join(root, 'tailwind.config.cjs'), '-i', join(root, 'styles/tailwind.css'), '-o', cssOut, '--minify'], { env: { ...process.env, QMS_CONTENT: content }, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) { fail('Tailwind 编译出错：\n' + (e.stderr ? e.stderr.toString() : e.message)); }
const twCss = readFileSync(cssOut, 'utf8');
if (twCss.length < 20000 || !twCss.includes('.btn-primary')) fail('Tailwind 输出异常（只有 ' + twCss.length + ' 字节，没有扫描到源码里的 class）。请检查 tailwind.config.cjs 的 content 设置。');
const appCss = readFileSync(join(root, 'styles/app.css'), 'utf8');

/* 3. 内联脚本转义：避免 HTML 解析器把脚本里的 </script 或 <!-- 当作标记 */
const esc = (js) => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const vue = readFileSync(join(vendorDir, 'vue.global.prod.js'), 'utf8');
const chart = readFileSync(join(vendorDir, 'chart.umd.min.js'), 'utf8');

/* 4. 组装 */
let head = readFileSync(join(srcDir, '00_head.html'), 'utf8');
for (const ph of ['/*__TAILWIND__*/', '/*__APP_CSS__*/']) if (!head.includes(ph)) fail('00_head.html 中缺少占位符 ' + ph);
head = head.replace('/*__TAILWIND__*/', () => twCss).replace('/*__APP_CSS__*/', () => appCss);
const hash = createHash('sha256').update(appJs).digest('hex').slice(0, 12);
const stamp = new Date().toISOString();
const html = head +
  '\n<script>/* Vue 3.4.38 · MIT */\n' + esc(vue) + '\n</script>' +
  '\n<script>/* Chart.js 4.4.1 · MIT */\n' + esc(chart) + '\n</script>' +
  '\n<script>\n/* Worlder QMS 原型 · build ' + stamp + ' · src ' + hash + ' */\n(function () {\n\'use strict\';\n' + esc(appJs) + '\n})();\n</script>\n</body>\n</html>\n';
writeFileSync(out, html);
console.log('已生成 ' + out + '（' + (Buffer.byteLength(html) / 1024).toFixed(0) + ' KB，' + jsFiles.length + ' 个源码文件，src ' + hash + '）');

#!/usr/bin/env node
/**
 * 自研气泡识别软件 · 构建脚本
 *   1. 从 node_modules 复制运行时依赖到 vendor/（pdf.js、tesseract.js 与离线语言包、Vue）
 *   2. 检查源码：乱码字符、JS 语法（只编译不运行）、页面模板（用 Vue 编译器预编译，只编译不运行）、开发入口是否列全源码
 *   3. Tailwind 预编译样式，输出 dist/bubble.html（单页，Vue 与样式内联）与 dist/bubble.css（开发入口用）
 *
 * 用法：npm install && node build.mjs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, cpSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const NM = join(root, 'node_modules');
const fail = (msg) => { console.error('构建失败：' + msg); process.exit(1); };
const twBin = process.env.TAILWIND_BIN || join(NM, '.bin/tailwindcss');

/* 1. 运行时依赖 */
const VENDOR = [
  ['vue/dist/vue.global.prod.js', 'vue.global.prod.js'],
  ['pdfjs-dist/build/pdf.min.js', 'pdfjs/pdf.min.js'],
  ['pdfjs-dist/build/pdf.worker.min.js', 'pdfjs/pdf.worker.min.js'],
  ['pdfjs-dist/cmaps', 'pdfjs/cmaps'],
  ['pdfjs-dist/standard_fonts', 'pdfjs/standard_fonts'],
  ['tesseract.js/dist/tesseract.min.js', 'tesseract/tesseract.min.js'],
  ['tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract/core/tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract/core/tesseract-core-lstm.wasm.js'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'tesseract/lang/eng.traineddata.gz'],
  ['@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz', 'tesseract/lang/chi_sim.traineddata.gz'],
];
const vendorDir = join(root, 'vendor');
for (const [from, to] of VENDOR) {
  const dst = join(vendorDir, to);
  if (existsSync(dst)) continue;
  const src = join(NM, from);
  if (!existsSync(src)) fail('找不到 ' + from + '：请先在本目录执行 npm install');
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
  console.log('复制 ' + from + ' → vendor/' + to);
}
const twPlay = join(vendorDir, 'tailwind.play.js'), qmsPlay = join(root, '..', '03_前端原型', 'vendor', 'tailwind.play.js');
if (!existsSync(twPlay) && existsSync(qmsPlay)) cpSync(qmsPlay, twPlay);

/* 2. 源码检查 */
const srcDir = join(root, 'src');
const jsFiles = readdirSync(srcDir).filter((f) => f.endsWith('.js')).sort();
const problems = [];
const BAD = String.fromCharCode(0xfffd), BOM = String.fromCharCode(0xfeff);
for (const f of jsFiles.concat(['00_head.html'])) {
  const text = readFileSync(join(srcDir, f), 'utf8');
  text.split('\n').forEach((line, i) => {
    if (line.indexOf(BAD) >= 0) problems.push(f + ':' + (i + 1) + ' 有乱码字符 U+FFFD');
    if (line.indexOf(BOM) >= 0) problems.push(f + ':' + (i + 1) + ' 有不可见的 BOM 字符（请改用 \\uFEFF 写法）');
  });
  if (!f.endsWith('.js')) continue;
  try { new vm.Script(text, { filename: f }); } catch (e) { problems.push(f + ' 语法错误：' + e.message + ((e.stack || '').match(new RegExp(f.replace('.', '\\.') + ':(\\d+)')) ? '（第 ' + e.stack.match(new RegExp(f.replace('.', '\\.') + ':(\\d+)'))[1] + ' 行）' : '')); }
  /* 页面模板：template: `...` 用 Vue 编译器预编译，表达式按 JS 语法检查 */
  const re = /template:\s*`([\s\S]*?)`/g;
  let m;
  while ((m = re.exec(text))) {
    const tpl = m[1], startLine = text.slice(0, m.index).split('\n').length;
    if (tpl.indexOf('${') >= 0) problems.push(f + ':' + startLine + ' 模板里不能出现 ${');
    try {
      const { compile } = require('@vue/compiler-dom');
      compile(tpl, { prefixIdentifiers: true, hoistStatic: false, onError: (e) => problems.push(f + ':' + (startLine + (e.loc ? e.loc.start.line - 1 : 0)) + ' 模板错误：' + e.message), onWarn: () => {} });
    } catch (e) { problems.push(f + ':' + startLine + ' 模板无法编译：' + e.message); }
  }
}
/* 服务端与测试脚本：node --check 只检查语法，不运行 */
for (const f of ['server.mjs'].concat(existsSync(join(root, 'tests')) ? readdirSync(join(root, 'tests'), { recursive: true }).filter((x) => /\.mjs$/.test(x)).map((x) => join('tests', x)) : [])) {
  try { execFileSync(process.execPath, ['--check', join(root, f)], { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { problems.push(f + ' 语法错误：' + String(e.stderr || e.message).split('\n').slice(0, 5).join(' ')); }
}
/* 开发入口 index.html 要列出全部源码文件，顺序与构建一致 */
const devHtml = readFileSync(join(root, 'index.html'), 'utf8');
const listed = (devHtml.match(/'([0-9]{2}_[a-z0-9_]+\.js)'/g) || []).map((s) => s.slice(1, -1));
if (listed.join(',') !== jsFiles.join(',')) problems.push('index.html 里的源码清单与 src/ 不一致：\n    index.html：' + listed.join(', ') + '\n    src/：      ' + jsFiles.join(', '));
if (problems.length) fail('源码检查没有通过：\n  ' + problems.join('\n  '));
console.log('源码检查通过：' + jsFiles.length + ' 个文件，语法与页面模板均可编译');

/* 3. 样式与组装 */
if (!existsSync(twBin)) fail('找不到 Tailwind CLI：' + twBin + '（请先 npm install）');
mkdirSync(join(root, 'dist'), { recursive: true });
const cssOut = join(root, 'dist', 'bubble.css');
try {
  execFileSync(twBin, ['-c', join(root, 'tailwind.config.cjs'), '-i', join(root, 'styles/tailwind.css'), '-o', cssOut, '--minify'], { env: { ...process.env, BUBBLE_CONTENT: JSON.stringify([join(srcDir, '**/*.{js,html}')]) }, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) { fail('Tailwind 编译出错：\n' + (e.stderr ? e.stderr.toString() : e.message)); }
const twCss = readFileSync(cssOut, 'utf8');
if (twCss.length < 15000 || twCss.indexOf('.btn-primary') < 0) fail('Tailwind 输出异常（' + twCss.length + ' 字节），请检查 tailwind.config.cjs 的 content 设置');
const appCss = readFileSync(join(root, 'styles/app.css'), 'utf8');
writeFileSync(join(root, 'dist', 'bubble.css'), twCss + '\n' + appCss);

const esc = (js) => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const appJs = jsFiles.map((f) => '/* ===== ' + f + ' ===== */\n' + readFileSync(join(srcDir, f), 'utf8')).join('\n;\n');
let head = readFileSync(join(srcDir, '00_head.html'), 'utf8');
for (const ph of ['/*__TAILWIND__*/', '/*__APP_CSS__*/']) if (head.indexOf(ph) < 0) fail('00_head.html 缺少占位符 ' + ph);
head = head.replace('/*__TAILWIND__*/', () => twCss).replace('/*__APP_CSS__*/', () => appCss);
const hash = createHash('sha256').update(appJs).digest('hex').slice(0, 12);
const vue = readFileSync(join(vendorDir, 'vue.global.prod.js'), 'utf8');
const html = head +
  '\n<script>/* Vue 3.4.38 · MIT */\n' + esc(vue) + '\n</script>' +
  '\n<script>\n/* Worlder 气泡识别 · build ' + new Date().toISOString() + ' · src ' + hash + ' */\n(function () {\n\'use strict\';\n' + esc(appJs) + '\n})();\n</script>\n</body>\n</html>\n';
writeFileSync(join(root, 'dist', 'bubble.html'), html);
const size = (p) => { let t = 0; const walk = (d) => readdirSync(d).forEach((f) => { const q = join(d, f); const s = statSync(q); if (s.isDirectory()) walk(q); else t += s.size; }); walk(p); return t; };
console.log('已生成 dist/bubble.html（' + (Buffer.byteLength(html) / 1024).toFixed(0) + ' KB，src ' + hash + '）；vendor/ 共 ' + (size(vendorDir) / 1048576).toFixed(1) + ' MB');

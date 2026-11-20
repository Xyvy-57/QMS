#!/usr/bin/env node
/**
 * 运行时检查（不开浏览器；build.mjs 构建后自动运行）
 *   node tests/ssr.mjs [--quick]
 * 在 Node 里用 Vue 服务端渲染，把 QMS 原型的每个页面在每种身份下真实渲染一遍，再调用领域动作走一遍生产现场：
 *   报工（不良自动登记 NCR）→ 登记换刀 → 现场看板上开首件、录数、签名 → 门禁解除 → 让步放行 → 批次追溯与一键质量限制 → 扫码
 * 能抓到构建时语法检查发现不了的问题：模板里用了没定义的名字、setup / 计算属性里抛出的异常、找不到组件、属性类型不对。
 * 需要 vue（取本目录或 ../04_气泡识别软件 的 node_modules）。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUICK = process.argv.includes('--quick');
const req = createRequire(import.meta.url);
let Vue = null, SR = null;
for (const base of [ROOT, join(ROOT, '..', '04_气泡识别软件')]) {
  try { Vue = req(req.resolve('vue', { paths: [base] })); SR = req(req.resolve('vue/server-renderer', { paths: [base] })); break; } catch (e) { Vue = null; SR = null; }
}
if (!Vue || !SR) { console.log('跳过运行时检查：没有找到 vue（在 ../04_气泡识别软件 执行 npm install 后可检查）'); process.exit(0); }

/* ---------------- 浏览器环境的最小替身 ---------------- */
const store = new Map();
const loc = {
  hash: '#/workbench', protocol: 'http:', origin: 'http://localhost:5180', pathname: '/', host: 'localhost:5180',
  get href() { return this.origin + this.pathname + this.hash; }, replace(u) { const s = String(u); this.hash = s.slice(s.indexOf('#')); }, reload() {},
};
const winListeners = {};
const win = {
  location: loc, addEventListener(t, f) { (winListeners[t] = winListeners[t] || []).push(f); }, removeEventListener() {}, scrollTo() {}, print() {}, open() {}, postMessage() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
const el = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {}, remove() {}, click() {}, focus() {}, getContext: () => null, addEventListener() {} });
const def = (k, v) => { try { Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); } catch (e) { /* 只读的全局，保留原值 */ } };
def('window', win);
def('location', loc);
def('document', { title: '', getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, body: el(), documentElement: el(), addEventListener() {}, removeEventListener() {} });
def('localStorage', { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); }, clear: () => store.clear() });
def('navigator', { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Node SSR check)', language: 'zh-CN', clipboard: { writeText: () => Promise.resolve() } });
def('Chart', function Chart() { return { destroy() {}, update() {} }; });
def('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
def('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
def('requestAnimationFrame', (f) => setTimeout(f, 16));
def('cancelAnimationFrame', (t) => clearTimeout(t));
def('fetch', () => Promise.reject(new Error('运行时检查不联网')));
def('Vue', Vue);
const _st = setTimeout, _si = setInterval;
def('setTimeout', (f, ms, ...a) => { const t = _st(f, ms, ...a); if (t && t.unref) t.unref(); return t; });
def('setInterval', (f, ms, ...a) => { const t = _si(f, ms, ...a); if (t && t.unref) t.unref(); return t; });

/* 控制台：[QMS] 前缀的错误（流程条等兜底捕获的异常）也算失败 */
const consoleErrors = [];
const _err = console.error;
console.error = (...a) => { consoleErrors.push(a.map((x) => (x && x.stack) || String(x)).join(' ')); };

/* ---------------- 加载源码（与 build.mjs 相同的拼接顺序） ---------------- */
const srcDir = join(ROOT, 'src');
const files = readdirSync(srcDir).filter((f) => f.endsWith('.js')).sort((a, b) => a.localeCompare(b));
let code = files.map((f) => '/* ===== ' + f + ' ===== */\n' + readFileSync(join(srcDir, f), 'utf8')).join('\n;\n');
const swaps = [['const app = createApp(App);', 'const app = Vue.createSSRApp(App);'], ["app.mount('#app');", '/* 运行时检查：不挂载到页面 */']];
for (const [a, b] of swaps) { if (!code.includes(a)) { console.log('运行时检查无法进行：源码里找不到 ' + a); process.exit(1); } code = code.replace(a, b); }
code += '\n;globalThis.__T = { get: (n) => eval(n), app };';
try { vm.runInThisContext('(function () {\n"use strict";\n' + code + '\n})();', { filename: 'qms_app.js' }); }
catch (e) { console.error = _err; console.log('运行时检查：加载源码时出错\n' + (e.stack || e)); process.exit(1); }

const T = globalThis.__T, app = T.app, S = T.get('S'), UI = T.get('UI'), F = (n) => T.get(n);
const warns = [], errs = [];
app.config.warnHandler = (msg, inst, trace) => { warns.push(msg + (trace ? '\n' + trace : '')); };
app.config.errorHandler = (err, inst, info) => { errs.push(((err && err.message) || String(err)) + '（' + info + '）\n' + ((err && err.stack) || '').split('\n').slice(1, 4).join('\n')); };

let pass = 0, fail = 0, renders = 0;
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name + (detail ? '\n    ' + String(detail).slice(0, 1200) : '')); } };
const flush = () => new Promise((r) => _st(r, 0));
/* 同一个应用反复做服务端渲染时，Vue 会提示“已经 provide 过渲染上下文”：渲染前把上一次的清掉 */
const clearSsrContext = () => Object.getOwnPropertySymbols(app._context.provides).forEach((s) => { if (String(s) === 'Symbol(v-scx)') delete app._context.provides[s]; });
/* 没有组件实例的 Vue 警告走 console.warn，也收进来 */
const consoleWarns = [];
const _warn = console.warn;
console.warn = (...a) => { consoleWarns.push(a.map(String).join(' ')); };
async function renderHtml(ctx) {
  clearSsrContext();
  return SR.renderToString(app, ctx || {});
}
async function render(route, uid, label, expect) {
  S.me = uid;
  loc.hash = '#' + route;
  UI.route = F('parseHash')();
  warns.length = 0; errs.length = 0; consoleErrors.length = 0; consoleWarns.length = 0;
  let html = '';
  const ctx = {};
  try { html = await renderHtml(ctx); } catch (e) { errs.push('渲染中断：' + ((e && e.stack) || e)); }
  html += Object.values(ctx.teleports || {}).join('');
  renders++;
  const problems = warns.concat(errs, consoleErrors.filter((x) => /\[QMS\]|Error|错误/.test(x)), consoleWarns.filter((x) => /Vue warn/.test(x)));
  const missing = (expect || []).filter((s) => html.indexOf(s) < 0);
  ok((label || '页面') + ' ' + route + ' · ' + uid, !problems.length && html.length > 200 && !missing.length, problems.slice(0, 3).join('\n    ---\n    ') + (missing.length ? '\n    页面里没有：' + missing.join('、') : ''));
  return html;
}

/* ---------------- 0. 检查工具本身能抓到问题（反向对照） ---------------- */
{
  const probe = async (comp) => {
    const a = Vue.createSSRApp(comp), w = [], e = [];
    a.config.warnHandler = (m) => w.push(m);
    a.config.errorHandler = (err) => e.push(String(err && err.message));
    consoleWarns.length = 0; consoleErrors.length = 0;
    try { await SR.renderToString(a); } catch (x) { e.push(String(x && x.message)); }
    return { w: w.concat(consoleWarns.splice(0)), e: e.concat(consoleErrors.splice(0)) };
  };
  const p1 = await probe({ template: '<div>{{ notDefinedAnywhere }}</div>' });
  ok('反向对照：模板里用了没定义的名字能被抓到', p1.w.some((m) => /was accessed during render but is not defined/.test(m)), JSON.stringify(p1));
  const p2 = await probe({ setup() { throw new Error('故意抛出'); }, template: '<div/>' });
  ok('反向对照：setup 里抛出的异常能被抓到', p2.e.some((m) => /故意抛出/.test(m)), JSON.stringify(p2));
  const p3 = await probe({ template: '<div><no-such-comp/></div>' });
  ok('反向对照：找不到的组件能被抓到', p3.w.some((m) => /Failed to resolve component/.test(m)), JSON.stringify(p3));
}
const users = S.users.map((u) => u.id);
const byWo = (wo) => S.orders.find((o) => o.wo === wo) || null;

/* ---------------- 1. 演示数据升级 ---------------- */
console.log('\n[1] 生产现场演示数据');
const o11 = byWo('WO-2611-011'), o18 = byWo('WO-2611-018'), o21 = byWo('WO-2611-021'), o52 = byWo('WO-2611-052'), o64 = byWo('WO-2611-064'), o92 = byWo('WO-2611-092');
ok('升级标记、机台、批次台账、补齐的方案', S.prodV1 === true && S.machines.length === 7 && S.lots.length >= 6 && ['PL-011-OUT', 'PL-018-IQC', 'PL-018-OQC', 'PL-092-IQC', 'PL-092-FAI'].every((c) => S.plans.some((p) => p.code === c)), JSON.stringify({ m: (S.machines || []).length, l: (S.lots || []).length }));
ok('六张工单都在', !!(o11 && o18 && o21 && o52 && o64 && o92), S.orders.map((o) => o.wo).join(','));
{
  const ml64 = F('mainlineOf')(o64), q = ml64.qty, rel = ml64.stages[ml64.stages.length - 1];
  ok('WO-2611-064：检验全部合格，等待放行', rel.state === 'active' && ml64.stages.slice(0, -1).every((s) => s.state === 'done'), ml64.stages.map((s) => s.key + ':' + s.state + ':' + s.text).join(' | '));
  ok('WO-2611-064：数量平衡 300 = 298 + 2，直通率 98.7%', q.balanced && q.input === 300 && q.stocked === 298 && q.scrap === 2 && q.concession === 2 && Math.abs(q.rty - 296 / 300) < 1e-9, JSON.stringify({ input: q.input, stocked: q.stocked, scrap: q.scrap, concession: q.concession, pending: q.pending, wip: q.wip, rty: q.rty }));
  ok('WO-2611-064：放行检查里有让步提示', rel.checks.some((c) => c.warn && /让步接收 2 件/.test(c.text)), JSON.stringify(rel.checks.map((c) => c.text)));
  const ml52 = F('mainlineOf')(o52);
  ok('WO-2611-052：已放行，各节点完成', ml52.state === 'released' && ml52.stages.every((s) => s.state === 'done'), ml52.stages.map((s) => s.key + ':' + s.state + ':' + s.text).join(' | '));
  const ml11 = F('mainlineOf')(o11), fs11 = ml11.stages.find((s) => s.key === 'FIRST');
  ok('WO-2611-011：上一班首件合格、生产没完 → 本班要做开班首件（CNC-04）', !!fs11 && (fs11.refs.reqs || []).some((r) => r.auto && r.machine === 'CNC-04' && !r.task), JSON.stringify((fs11 && fs11.refs.reqs || []).map((r) => ({ m: r.machine, t: r.trigger, auto: !!r.auto, task: r.task && r.task.code }))));
  const iqcPt = F('orderPoints')(o11).find((x) => x.b.scene === 'IQC' && x.opNo === '10');
  ok('按批次关联的来料检验算在工单的来料检验点上（t6 → WO-2611-011）', !!iqcPt && !!iqcPt.last && iqcPt.last.id === 't6', iqcPt && iqcPt.last ? iqcPt.last.id : '无');
  const q11 = ml11.qty;
  ok('WO-2611-011：巡检发现的 36 件不良算进工序 20，一次合格率 70%', q11.rows.find((r) => r.key === '20 精车').bad === 36 && Math.abs(q11.rty - 0.7) < 1e-9 && q11.pending === 36, JSON.stringify({ rty: q11.rty, pending: q11.pending }));
}
ok('身份流程步数：检验员 6、质量工程师 6、质量负责人 7、生产主管 6、仓库 4、管理员 3', ['insp', 'qe', 'ql', 'pm', 'wh', 'admin'].map((r) => F('roleFlow')(r).length).join(',') === '6,6,7,6,4,3', ['insp', 'qe', 'ql', 'pm', 'wh', 'admin'].map((r) => F('roleFlow')(r).length).join(','));
{
  const sh = F('shiftAt');
  const a = sh(new Date(2026, 10, 17, 3, 0)), b = sh(new Date(2026, 10, 17, 9, 30)), c = sh(new Date(2026, 10, 17, 20, 0));
  ok('班次：03:00 属于前一天 20:00 起的夜班；09:30 白班；20:00 夜班开始', a.name === '夜班' && a.start.getDate() === 16 && a.start.getHours() === 20 && a.end.getDate() === 17 && a.end.getHours() === 8 && b.name === '白班' && b.start.getHours() === 8 && c.name === '夜班' && c.start.getDate() === 17, [a, b, c].map((x) => x.name + ' ' + x.start.toString().slice(4, 21) + '→' + x.end.toString().slice(4, 21)).join(' | '));
}

/* ---------------- 2. 每个页面 × 每种身份 ---------------- */
console.log('\n[2] 页面渲染（' + (QUICK ? '快速' : '全部身份') + '）');
const H2 = (S.lots.find((l) => /-H2$/.test(l.lot)) || {}).lot || '';
const baseRoutes = [
  '/workbench', '/workbench?step=take', '/orders?f=mine', '/orders?f=blocked', '/orders?f=released', '/floor', '/floor?line=车削线', '/trace', '/trace?q=DN-2611-007', '/trace?q=' + encodeURIComponent(H2),
  '/trace?q=' + encodeURIComponent('恒科五金（示例）'), '/trace?q=WO-2611-064', '/trace?q=NOPE-404', '/scan/WO-2611-021', '/scan/NOPE-404', '/dashboard', '/orders', '/bubble', '/standards', '/plans', '/plans?tab=tpl',
  '/tasks', '/tasks/IQC', '/tasks/FIRST', '/tasks/IPQC', '/tasks/FQC', '/tasks/OQC', '/reports', '/report-templates', '/ncr', '/ncr?tab=holds', '/parts', '/parts?id=p2', '/routes', '/scenes', '/gauges', '/users', '/audit', '/settings', '/rd', '/ext/capa',
];
const objRoutes = () => S.orders.map((o) => '/orders/' + o.id).concat(S.orders.map((o) => '/orders/' + o.id + '/card'), ['/orders/oh64?stage=release', '/orders/oh64?stage=FIRST', '/orders/' + o11.id + '?stage=FIRST', '/orders/' + o11.id + '?stage=IPQC'],
  S.tasks.map((t) => '/inspect/' + t.id), S.reports.slice(0, 10).map((r) => '/reports/' + r.id), S.ncrs.map((n) => '/ncr/' + n.id), S.standards.map((s) => '/standards/' + s.id), S.plans.map((p) => '/plans/' + p.id));
/* 关键页面要渲染出该有的内容，不只是“没报错” */
const EXPECT = {
  '/workbench': ['我的工作流程', '件事要做', 'data-todo'], '/orders': ['WO-2611-064', '交期临近', '等待质量放行'], '/orders?f=released': ['WO-2611-052'], '/floor': ['现场看板', '待检队列', 'CNC-04', '开班首件待检'], '/trace?q=DN-2611-007': ['往回查', 'WO-2611-052', '恒科五金（示例）'],
  ['/trace?q=' + encodeURIComponent(H2)]: ['往后查', 'WO-2611-064'], '/trace?q=NOPE-404': ['没有找到'], '/trace': ['发货单 DN-2611-007', '-R1'], '/settings': ['生产现场', '开班首件', 'CNC-04'],
  '/orders/oh64': ['直通率', '98.7%', '数量对得上', '切换为'], '/orders/oh64/card': ['生产工单流转卡', 'WO-2611-064', 'shape-rendering="crispEdges"', '扫码进入当前检验'], '/orders/oh64?stage=release': ['让步接收 2 件'],
  ['/orders/' + o11.id + '?stage=FIRST']: ['CNC-04', '开班首件'], '/scan/NOPE-404': ['没有找到'],
};
for (const r of baseRoutes.concat(objRoutes())) await render(r, 'u2', '', EXPECT[r]);
const others = QUICK ? ['u1', 'u3'] : users.filter((u) => u !== 'u2');
for (const u of others) for (const r of baseRoutes.concat(S.orders.map((o) => '/orders/' + o.id), S.tasks.slice(0, 4).map((t) => '/inspect/' + t.id))) await render(r, u);

/* 全局弹窗打开时 */
const modal = async (name, setUi, route, uid) => { setUi(); await render(route, uid, '弹窗 ' + name); };
await modal('报工', () => { UI.work = { orderId: o11.id }; }, '/floor', 'u4'); UI.work = null;
await modal('登记首件触发', () => { UI.setup = { orderId: o21.id }; }, '/floor', 'u4'); UI.setup = null;
await modal('扫码', () => { UI.scan = true; }, '/workbench', 'u1'); UI.scan = false;
await modal('质量放行（让步）', () => { UI.release = o64.id; }, '/orders/' + o64.id + '?stage=release', 'u3');
{
  /* 让步放行弹窗里要出现批准依据的输入 */
  S.me = 'u3'; loc.hash = '#/orders/' + o64.id; UI.route = F('parseHash')();
  const ctx = {};
  const html = await renderHtml(ctx);
  const tp = Object.values(ctx.teleports || {}).join('');
  ok('让步放行弹窗：有批准方、批准文件编号、批准人输入，文件编号已从处置理由带出', /让步放行依据/.test(tp) && /批准文件编号/.test(tp) && /CC-2611-05/.test(tp), html.length + ' / ' + tp.slice(0, 200));
}
UI.release = null;
await modal('登记工单', () => { UI.newOrder = true; }, '/workbench', 'u4'); UI.newOrder = false;
await modal('命令面板', () => { UI.palette = true; }, '/workbench', 'u2'); UI.palette = false;

/* ---------------- 3. 生产现场动作 ---------------- */
console.log('\n[3] 报工、首件触发、放行、追溯、扫码');
const attempt = (fn) => { try { fn(); return ''; } catch (e) { return e.message || String(e); } };
{
  S.me = 'u2';
  ok('质量工程师不能报工', /无权限/.test(attempt(() => F('reportWork')(o11, { op: '20 精车', good: 1 }))));
  S.me = 'u4';
  ok('有不良必须写现象', /不良现象/.test(attempt(() => F('reportWork')(o11, { op: '20 精车', good: 10, bad: 2 }))));
  ok('累计报工不能超过投产', /超过投产/.test(attempt(() => F('reportWork')(o11, { op: '20 精车', good: 500 }))));
  const n0 = S.ncrs.length;
  let res = null;
  const msg = attempt(() => { res = F('reportWork')(o11, { op: '20 精车', machine: 'CNC-04', good: 40, bad: 3, reason: '外径偏大' }); });
  ok('生产主管报工：合格 40、不良 3，自动登记 NCR', !msg && !!res && !!res.n && S.ncrs.length === n0 + 1 && res.n.workId === res.w.id && res.n.op === '20 精车' && res.n.qtySuspect === 3, msg);
  const q = F('orderQty')(o11), row = q.rows.find((r) => r.key === '20 精车');
  ok('工序 20：报工 163，不良 39（报工 3 + 巡检 36），一次合格率 (163-39)/163', row.processed === 163 && row.bad === 39 && Math.abs(row.fpy - 124 / 163) < 1e-9, JSON.stringify(row && { p: row.processed, b: row.bad, f: row.fpy }));
}
let newFai = null;
{
  S.me = 'u4';
  const ev = F('addSetup')(o21, { op: '20 精车', machine: 'CNC-02', trigger: '换刀', note: 'T03 刀片更换' });
  const reqs = F('faiReqs')(o21).filter((r) => r.key === '20 精车');
  ok('登记换刀：CNC-02 要重新做首件（换刀前开的首件单不算）', !!ev && reqs.length === 1 && reqs[0].machine === 'CNC-02' && reqs[0].trigger === '换刀' && !reqs[0].task, JSON.stringify(reqs.map((r) => ({ m: r.machine, t: r.trigger, task: r.task && r.task.code }))));
  const g = F('gateBlocker')(F('mainlineOf')(o21), 'IPQC', '20 精车');
  ok('门禁：这道工序换刀后首件没做，开巡检要先确认', !!g && /换刀后首件/.test(g.text), g && g.text);
  ok('检验员不能放行，管理员不能登记换刀', (S.me = 'u1', /无权限/.test(attempt(() => F('releaseOrder')(o64, {})))) && (S.me = 'u6', /无权限/.test(attempt(() => F('addSetup')(o21, { op: '20 精车', machine: 'CNC-02', trigger: '换刀' })))));
  S.me = 'u1';
  const item = F('floorItems')().find((i) => i.kind === 'fai' && i.o === o21 && i.machine === 'CNC-02');
  ok('现场看板：CNC-02 换刀后首件待检，排在前面', !!item && /换刀后首件待检/.test(item.title) && item.urgent, item ? item.title : '没有这一项');
  const nT = S.tasks.length;
  if (item) await F('floorAct')(item);
  newFai = S.tasks.length === nT + 1 ? S.tasks[0] : null;
  ok('在看板上开首件：带上机台、原因和登记记录，并跳到检验页', !!newFai && newFai.scene === 'FIRST' && newFai.ctx.machine === 'CNC-02' && newFai.ctx.trigger === '换刀' && newFai.ctx.setupId === ev.id && loc.hash === '#/inspect/' + newFai.id, newFai ? JSON.stringify(newFai.ctx) + ' ' + loc.hash : '没有建单');
  if (newFai) {
    const r = newFai.rounds[0];
    newFai.snap.items.forEach((it) => { if (it.group === 'M') r.samples.forEach((s, i) => { r.vals[it.cid][i] = F('demoOkValue')(it, i); }); if (it.group === 'C') r.cnt[it.cid].bad = '0'; });
    newFai.snap.items.filter((i) => i.cat === '外观').forEach((i) => r.photos.push({ id: 'ph-t-' + i.cid, url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', cid: i.cid, at: new Date().toISOString(), by: 'u1' }));
    const m = attempt(() => F('submitRound')(newFai, r, { sigImg: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }));
    const reqs2 = F('faiReqs')(o21).filter((x) => x.key === '20 精车');
    ok('首件合格后，CNC-02 的要求满足，巡检门禁解除', !m && newFai.status === 'pass' && reqs2[0].state === 'done' && !F('gateBlocker')(F('mainlineOf')(o21), 'IPQC', '20 精车'), m || JSON.stringify(reqs2.map((x) => x.state)));
    const nx = F('floorItems')().find((i) => i.o === o21 && i.op === '20 精车' && /^ipqc/.test(i.kind));
    const dueIn = nx && nx.due ? (new Date(nx.due).getTime() - Date.now()) / 3600e3 : -1;
    ok('首件合格后巡检从首件时间起算：2 小时后首次巡检', !!nx && nx.kind === 'ipqc-next' && dueIn > 1.9 && dueIn <= 2, nx ? nx.kind + ' ' + nx.title + ' ' + dueIn.toFixed(2) : '没有这一项');
    /* 巡检不合格：看板上变成红色的待处置，不再排“下次巡检” */
    const px = F('orderPoints')(o21).find((p) => p.b.scene === 'IPQC' && p.key === '20 精车');
    F('startPoint')(o21, px, null);
    const ip = S.tasks[0], ir = ip.rounds[0];
    ip.snap.items.forEach((it) => { if (it.group === 'M') ir.samples.forEach((s, i) => { ir.vals[it.cid][i] = F('demoOkValue')(it, i); }); if (it.group === 'C') ir.cnt[it.cid].bad = '0'; });
    const m0 = ip.snap.items.find((it) => it.group === 'M' && it.usl);
    ir.vals[m0.cid][0] = String(parseFloat(m0.usl) + 1);
    ir.photos.push({ id: 'ph-ng', url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', cid: m0.cid, at: new Date().toISOString(), by: 'u1' });
    const m2 = attempt(() => F('submitRound')(ip, ir, { sigImg: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }));
    const fx = F('floorItems')().find((i) => i.o === o21 && i.op === '20 精车' && /^ipqc/.test(i.kind));
    ok('巡检不合格：看板显示“巡检不合格，先处置”，CNC-02 标红', !m2 && ip.status === 'fail' && ip.ctx.machine === 'CNC-02' && !!fx && fx.kind === 'ipqc-fail' && fx.tone === 'red', m2 || (fx ? fx.kind + ' ' + fx.title : '没有这一项'));
  }
}
{
  S.me = 'u3';
  ok('让步放行：没填批准依据不能放行', /批准方、批准文件编号和批准人/.test(attempt(() => F('releaseOrder')(o64, {}))));
  const cons = F('orderConcessions')(o64);
  const basis = {};
  cons.forEach((c) => { basis[c.d.id] = { kind: '客户书面批准', docNo: F('guessDocNo')(c.d), approver: '客户质量部 王经理' }; });
  const m = attempt(() => F('releaseOrder')(o64, { note: '检验全部合格，让步 2 件有客户书面批准', basis }));
  ok('让步放行：依据写进放行记录', !m && !!o64.releasedAt && o64.releaseKind === 'concession' && o64.releaseBasis.length === 1 && o64.releaseBasis[0].docNo === 'CC-2611-05', m || JSON.stringify(o64.releaseBasis));
  ok('放行后的主线：已放行（让步放行）', F('mainlineOf')(o64).state === 'released' && /让步放行/.test(F('mainlineOf')(o64).stages.slice(-1)[0].text));
  ok('已放行的工单不能再报工', (S.me = 'u4', /已质量放行/.test(attempt(() => F('reportWork')(o64, { op: '30 终检', good: 1 })))));
}
{
  const back = F('traceOf')('DN-2611-007');
  const lot52 = (o52.inLots || [])[0];
  const li = lot52 ? F('lotInfo')(lot52) : null;
  ok('往回查：发货单 DN-2611-007 → WO-2611-052 → 来料批次 → 恒科五金', !!back && back.direction === 'back' && back.orders.length === 1 && back.orders[0] === o52 && back.lots.indexOf(lot52) >= 0 && !!li && li.supplier === '恒科五金（示例）' && li.iqc.length === 1, JSON.stringify(back && { k: back.kind, o: back.orders.map((o) => o.wo), l: back.lots }));
  const R1 = (o92.inLots || []).find((l) => /-R1$/.test(l));
  const fwd = F('traceOf')(R1);
  ok('往后查：来料批次 ' + R1 + ' → WO-2611-092', !!fwd && fwd.direction === 'forward' && fwd.orders.length === 1 && fwd.orders[0] === o92, JSON.stringify(fwd && { k: fwd.kind, o: fwd.orders.map((o) => o.wo) }));
  const sup = F('traceOf')('恒科五金（示例）');
  ok('按供应商查：恒科五金的批次用在 WO-2611-052 和 WO-2611-064', !!sup && sup.kind === '供应商' && sup.orders.length === 2, JSON.stringify(sup && sup.orders.map((o) => o.wo)));
  const scopes = F('traceHoldScopes')(fwd);
  ok('一键质量限制的范围：来料批次、在制工单、成品批次', scopes.some((s) => s.scopeVal === R1) && scopes.some((s) => s.scopeVal === o92.wo) && scopes.some((s) => s.scopeVal === o92.outLot), JSON.stringify(scopes.map((s) => s.scopeType + ' ' + s.scopeVal + ' ' + s.actions.join('/'))));
  S.me = 'u1';
  ok('检验员不能建立质量限制', /无权限/.test(attempt(() => F('traceHold')(fwd, scopes, ''))));
  S.me = 'u2';
  const nN = S.ncrs.length;
  let n = null;
  const m = attempt(() => { n = F('traceHold')(fwd, scopes, '涂层附着力不足'); });
  const ml92 = F('mainlineOf')(o92);
  ok('一键质量限制：登记 NCR 并建立 3 条限制，工单放行被挡住', !m && S.ncrs.length === nN + 1 && n.holds.length === 3 && ml92.holds.length >= 1 && ml92.stages.slice(-1)[0].state === 'blocked', m || JSON.stringify({ holds: n && n.holds.length, rel: ml92.stages.slice(-1)[0].state }));
  ok('再查一次：已经限制的范围不再列出', F('traceHoldScopes')(fwd).length === 0, JSON.stringify(F('traceHoldScopes')(fwd).map((s) => s.scopeVal)));
  if (n) {
    /* 追溯隔离单确认了不合格数量：不算进工单的生产数量（它可能挂在几张工单上），但照样挡放行 */
    const before = F('orderQty')(o92).defects;
    n.status = 'scoped'; n.qtyConfirmed = 50;
    const after = F('orderQty')(o92), rel = F('mainlineOf')(o92).stages.slice(-1)[0];
    ok('追溯隔离单不重复扣工单数量，但挡放行', after.defects === before && rel.checks.some((c) => !c.ok && /没有关闭/.test(c.text)), JSON.stringify({ before, after: after.defects }));
  }
}
{
  S.me = 'u7';
  const t7 = S.tasks.find((t) => t.id === 't7');
  const a = F('scanTarget')('WO-2611-021');
  ok('扫工单码：优先打开我在这张工单上的检验（刘志伟 → t7）', !!a && !!t7 && a.to === '/inspect/t7', JSON.stringify(a));
  S.me = 'u3';
  const b = F('scanTarget')(F('scanUrl')('WO-2611-018'));
  ok('扫二维码网址：解析出工单并跳转', !!b && /工单 WO-2611-018/.test(b.label), JSON.stringify(b));
  const c = F('scanTarget')(S.tasks.find((t) => t.id === 't3').code);
  ok('扫检验单号 → 检验页', !!c && c.to === '/inspect/t3', JSON.stringify(c));
  const d = F('scanTarget')('DN-2611-007');
  ok('扫发货单号 → 批次追溯', !!d && /^\/trace\?q=/.test(d.to), JSON.stringify(d));
  ok('扫不认识的码 → 没有结果', F('scanTarget')('NOPE-404') === null);
  const qr = F('qrEncode')(F('scanUrl')('WO-2611-011'));
  ok('流转卡二维码：本机地址的网址用 V3', qr.version === 3 && qr.size === 29, qr.version + ' / ' + qr.size);
  S.settings.scanBase = 'http://192.168.1.20:5180';
  ok('设置了扫码地址：二维码用局域网地址，不再提示只有本机能开', F('scanUrl')('WO-2611-011') === 'http://192.168.1.20:5180/#/scan/WO-2611-011' && !F('scanBaseLocal')(), F('scanUrl')('WO-2611-011'));
  S.settings.scanBase = '';
  /* 扫码枪：光标不在输入框里，快速输入加回车 */
  const keys = winListeners.keydown || [];
  const press = (k, tag) => keys.forEach((f) => f({ key: k, target: { tagName: tag || 'BODY' }, preventDefault() {} }));
  S.me = 'u7'; loc.hash = '#/workbench';
  'WO-2611-021'.split('').forEach((ch) => press(ch)); press('Enter');
  ok('扫码枪在页面上扫工单号：直接打开我的检验', keys.length === 1 && loc.hash === '#/inspect/t7', keys.length + ' 个监听 · ' + loc.hash);
  loc.hash = '#/workbench';
  'WO-2611-021'.split('').forEach((ch) => press(ch, 'INPUT')); press('Enter', 'INPUT');
  ok('在输入框里打字不当作扫码', loc.hash === '#/workbench', loc.hash);
}
{
  /* 弹窗的默认内容 */
  S.me = 'u4';
  const w1 = F('workForm')({ machine: 'CNC-04' });
  ok('从 CNC-04 的机台卡片点报工：带出 WO-2611-011、工序 20 精车', w1.orderId === o11.id && w1.op === '20 精车' && w1.machine === 'CNC-04', JSON.stringify(w1));
  const w2 = F('workForm')({ orderId: o21.id });
  ok('还没投产的工单：报工时先确认投产数量（默认计划数）', w2.qtyIn === String(o21.qty) && !!w2.op, JSON.stringify(w2));
  const s1 = F('setupForm')({ machine: 'CNC-02' });
  ok('从 CNC-02 点换型 / 换刀：带出 WO-2611-021、工序 20 精车', s1.orderId === o21.id && s1.op === '20 精车' && s1.machine === 'CNC-02', JSON.stringify(s1));
  const s2 = F('setupForm')({});
  ok('登记首件触发：只列有首件检验点的在制工单', !!s2.orderId && F('firstOpsOf')(F('partOf')(S.orders.find((o) => o.id === s2.orderId).partId)).length > 0, JSON.stringify(s2));
}
{
  /* 门禁确认（异步）：WO-2611-018 工序 40 的首件还在检验中，开巡检要先确认 */
  S.me = 'u1';
  const st = F('mainlineOf')(o18).stages.find((s) => s.key === 'IPQC');
  const n0 = S.tasks.length;
  let p = F('runStageAct')(o18, st);
  await flush();
  ok('门禁：开巡检前弹出确认，说明首件还没合格', !!UI.confirm && /首件/.test(UI.confirm.message) && /工序 40 精车/.test(UI.confirm.message), UI.confirm && UI.confirm.message);
  if (UI.confirm) UI.confirm.resolve(false);
  UI.confirm = null;
  await p;
  ok('选“取消”：不开单', S.tasks.length === n0, S.tasks.length - n0 + ' 张');
  p = F('runStageAct')(o18, st);
  await flush();
  if (UI.confirm) UI.confirm.resolve(true);
  UI.confirm = null;
  await p;
  const t = S.tasks.length === n0 + 1 ? S.tasks[0] : null;
  ok('选“仍要开检”：开出工序 40 的巡检单，带上机台', !!t && t.scene === 'IPQC' && t.ctx.op === '40 精车' && t.ctx.machine === 'CNC-03', t ? JSON.stringify(t.ctx) : '没有建单');
}

/* ---------------- 5. 审查代理发现的问题（回归）：每条都用构造的数据复现一遍 ---------------- */
console.log('\n[5] 审查发现的问题（回归）');
{
  const J = JSON.stringify;
  let seq = 0;
  const nid = (p) => (p || 'rv') + (++seq);
  const now = () => new Date().toISOString();
  const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  const mkO = (wo, partId, qtyIn, extra) => { S.orders.push(Object.assign({ id: nid('ot'), wo, partId, qty: qtyIn || 10, qtyIn, due: '', inLots: [], outLot: '', createdAt: ago(30), createdBy: 'u4', work: [], setups: [] }, extra || {})); return S.orders[S.orders.length - 1]; };
  const wk = (o, op, good, bad, extra) => { o.work.push(Object.assign({ id: nid('wt'), op, opNo: op.split(' ')[0], machine: '', good, bad: bad || 0, reason: bad ? '测试' : '', ncrId: '', shift: '白班', by: 'u4', at: now() }, extra || {})); return o.work[o.work.length - 1]; };
  const mkN = (f) => { S.ncrs.push(Object.assign({ id: nid('nt'), code: nid('NCR-T-'), title: '回归测试', severity: '一般', status: 'closed', partId: 'p3', batch: '', taskId: '', roundId: '', cids: [], desc: '', qtySuspect: 0, qtyConfirmed: 0, createdBy: 'u2', createdAt: now(), photos: [], disp: [], holds: [], log: [] }, f)); return S.ncrs[S.ncrs.length - 1]; };
  const ln = (action, qty) => ({ id: nid('dt'), qty, action, reason: '测试', by: 'u2', approved: true, executed: true });
  const mkT = (partId, scene, ctx, agoH, status) => { const at = ago(agoH || 1); S.tasks.push({ id: nid('tt'), code: nid(scene + '-T-'), scene, partId, planId: '', lot: 0, ctx, assignee: 'u7', due: at, status: status || 'pass', rounds: [{ id: nid('rd'), no: 1, status: 'submitted', submittedAt: at, photos: [] }], reportIds: [], createdAt: at, createdBy: 'u2' }); return S.tasks[S.tasks.length - 1]; };
  const Q = (o) => F('orderQty')(o);
  const brief = (q) => J({ input: q.input, stocked: q.stocked, scrap: q.scrap, returned: q.returned, concession: q.concession, pending: q.pending, wip: q.wip, defects: q.defects });

  { const shared = 'LOT-SHARED-DISPATCH';
    const first = mkO('WO-SHARED-A', 'p3', 10, { inLots: [shared] });
    const second = mkO('WO-SHARED-B', 'p3', 10, { inLots: [shared] });
    const t = mkT('p3', 'IQC', { wo: second.wo, batch: shared }, 2);
    const n = mkN({ taskId: t.id, batch: shared });
    ok('明确的工单号优先于共用物料批次，待办与检验节点不串到第一张工单', F('orderOfTask')(t) === second && F('orderOfNcr')(n) === second && !F('stageTasks')(first, 'IQC', []).includes(t));
    t.ctx.wo = '';
    ok('仅有共享批次的事项不猜所属工单；按批次追溯仍能看到两张工单', !F('orderOfTask')(t) && !F('orderOfNcr')(n) && F('traceOf')(shared).orders.length === 2);
    // 共享批次夹具只验证此契约，不进入后面的生产场景。
    S.orders.splice(S.orders.indexOf(first), 1); S.orders.splice(S.orders.indexOf(second), 1);
    S.tasks.splice(S.tasks.indexOf(t), 1); S.ncrs.splice(S.ncrs.indexOf(n), 1);
  }

  /* 数量台账（p3 路线：10 刃具来料 → 20 组装（首件）→ 30 终检（完工）→ 40 出货（出货）） */
  { const o = mkO('WO-T-01', 'p3', 100); wk(o, '20 组装', 100); const w = wk(o, '30 终检', 97, 3);
    const n = mkN({ batch: o.wo, workId: w.id, op: '30 终检', qtySuspect: 3, qtyConfirmed: 3, disp: [ln('让步接收', 3)] }); w.ncrId = n.id;
    const q = Q(o);
    ok('终检工序上让步接收的 3 件算进入库合格：投产 100 = 入库 100，能放行', q.balanced && q.stocked === 100 && q.concession === 3 && q.wip === 0, brief(q)); }
  { const o = mkO('WO-T-02', 'p3', 100, { outLot: 'FG-T-02' }); wk(o, '20 组装', 100); wk(o, '30 终检', 100);
    const t = mkT('p3', 'OQC', { customer: '锐驰装备（示例）', shipment: 'DN-T-02', batch: 'FG-T-02' }, 1, 'fail');
    mkN({ batch: 'FG-T-02', taskId: t.id, qtySuspect: 3, qtyConfirmed: 3, disp: [ln('报废', 3)] });
    const q = Q(o);
    ok('出货检验（按成品批次开单、没写工序）判退报废 3 件：从入库合格里扣，100 = 97 + 3', q.balanced && q.stocked === 97 && q.scrap === 3 && q.wip === 0, brief(q)); }
  { const o = mkO('WO-T-03', 'p3', 100); wk(o, '20 组装', 100); wk(o, '30 终检', 100); const w = wk(o, '40 出货', 98, 2);
    const n = mkN({ batch: o.wo, workId: w.id, op: '40 出货', qtySuspect: 2, qtyConfirmed: 2, disp: [ln('报废', 2)] }); w.ncrId = n.id;
    const q = Q(o);
    ok('终检之后的工序报废 2 件：100 = 98 + 2，在制不会变负', q.balanced && q.stocked === 98 && q.wip === 0, brief(q)); }
  { const o = mkO('WO-T-04', 'p3', 100, { inLots: ['LOT-T-04'] }); wk(o, '20 组装', 100); wk(o, '30 终检', 100);
    const t = mkT('p3', 'IQC', { supplier: '恒科五金（示例）', batch: 'LOT-T-04' }, 30, 'fail');
    const n = mkN({ batch: 'LOT-T-04', taskId: t.id, status: 'disposing', qtySuspect: 20, qtyConfirmed: 20, disp: [ln('退货', 20)] });
    const q = Q(o), ml = F('mainlineOf')(o), rel = ml.stages[ml.stages.length - 1];
    ok('来料检验的不合格不进工单数量（退货 20 不算本工单的），没关闭时照样挡放行', q.balanced && q.returned === 0 && q.defects === 0 && ml.ncrs.indexOf(n) >= 0 && rel.checks.some((c) => !c.ok && /没有关闭/.test(c.text)), brief(q)); }
  { S.me = 'u4';
    const o = mkO('WO-T-05', 'p3', 100); const w = wk(o, '20 组装', 90, 10);
    const n = mkN({ batch: o.wo, workId: w.id, op: '20 组装', qtySuspect: 10, qtyConfirmed: 10, disp: [ln('报废', 10)] }); w.ncrId = n.id;
    const m1 = attempt(() => F('reportWork')(o, { op: '30 终检', good: 100 }));
    const m2 = attempt(() => F('reportWork')(o, { op: '30 终检', good: 90 }));
    ok('前道报废 10 件，终检最多报 90 件：报 100 被拦下，报 90 数量平衡', /能到这道工序的 90 件/.test(m1) && !m2 && Q(o).balanced, m1 + ' | ' + m2 + ' | ' + brief(Q(o))); }
  { S.me = 'u4';
    const o = mkO('WO-T-06', 'p3', 100); wk(o, '20 组装', 100);
    const r1 = F('reportWork')(o, { op: '30 终检', good: 60, bad: 2, reason: '报错测试' });
    const before = Q(o).rows.find((r) => r.key === '30 终检').processed;
    const m = attempt(() => F('voidWork')(o, r1.w.id, '数量报错'));
    const q = Q(o);
    ok('撤销报工：这条报工不再计算，自动登记的不合格随之关闭（0 件）', !m && before === 62 && q.rows.find((r) => r.key === '30 终检').processed === 0 && r1.n.status === 'closed' && r1.n.qtyConfirmed === 0 && q.pending === 0, m + ' ' + before + ' ' + brief(q));
    F('reportWork')(o, { op: '30 终检', good: 100 });
    ok('撤销后重新报 100 件，数量平衡', Q(o).balanced, brief(Q(o)));
    const o2 = mkO('WO-T-07', 'p3', 100); wk(o2, '20 组装', 100);
    const r2 = F('reportWork')(o2, { op: '30 终检', good: 95, bad: 5, reason: '测试' });
    Object.assign(r2.n, { status: 'scoped', qtyConfirmed: 5 });
    ok('报工的不合格已经在处置时不能撤销，仓库执行人不能撤销', /已经在处置/.test(attempt(() => F('voidWork')(o2, r2.w.id, '测试'))) && (S.me = 'u5', /无权限/.test(attempt(() => F('voidWork')(o2, r2.w.id, '测试')))));
    S.me = 'u4'; }
  { const o = mkO('WO-T-08', 'p3', 300);
    mkN({ batch: o.wo, op: '20 组装', qtySuspect: 5, qtyConfirmed: 5, disp: [ln('报废', 5)] });
    const w = wk(o, '20 组装', 295, 5); const nd = mkN({ batch: o.wo, workId: w.id, op: '20 组装', status: 'registered', qtySuspect: 5 }); w.ncrId = nd.id;
    const b1 = Q(o).rows.find((r) => r.key === '20 组装').bad;
    Object.assign(nd, { status: 'closed', qtyConfirmed: 0 });
    const b2 = Q(o).rows.find((r) => r.key === '20 组装').bad;
    ok('报工重复登记的不良：确认 0 件关闭后不再重复计算（10 → 5）', b1 === 10 && b2 === 5, b1 + ' → ' + b2); }

  /* 首件、巡检、看板 */
  { S.me = 'u4';
    const o = mkO('WO-T-09', 'p3', 0);
    const ev = F('addSetup')(o, { op: '20 组装', machine: '装配线 A', trigger: '开工' });
    const r0 = F('faiReqs')(o).map((r) => r.machine).sort().join(',');
    S.me = 'u7';
    F('startPoint')(o, F('orderPoints')(o).find((p) => p.b.scene === 'FIRST'), { machine: '装配线 A', trigger: '开工', setupId: ev.id });
    const reqs = F('faiReqs')(o);
    ok('另一台机台先做了首件，路线默认机台（装配线 B）的开工首件要求还在', r0 === '装配线 A,装配线 B' && reqs.length === 2 && reqs.some((r) => r.machine === '装配线 B' && r.implicit && !r.task) && reqs.some((r) => r.machine === '装配线 A' && !!r.task), J(reqs.map((r) => ({ m: r.machine, t: r.trigger, imp: !!r.implicit, task: r.task && r.task.code })))); }
  { const o = mkO('WO-T-10', 'p3', 100); const w = wk(o, '20 组装', 95, 5);
    const n = mkN({ batch: o.wo, workId: w.id, op: '20 组装', qtySuspect: 5, qtyConfirmed: 5, disp: [ln('报废', 5)] }); w.ncrId = n.id;
    wk(o, '30 终检', 95);
    const part = F('partOf')('p3'), op = (key) => F('opByKey')(part, key);
    ok('前道报废 5 件、后道报满 95 件：两道工序都算做完了（不再要求开班首件、不再提醒巡检）', !F('opRunning')(o, op('20 组装')) && !F('opRunning')(o, op('30 终检')) && Q(o).balanced, brief(Q(o))); }
  { const mk = (wo, at50) => { const o = mkO(wo, 'p2', 10); ['10 下料', '20 粗车', '40 精车'].forEach((key) => wk(o, key, 10)); wk(o, '50 磨削', at50);
      ['20 粗车', '40 精车', '50 磨削'].forEach((key) => mkT('p2', 'IPQC', { wo, op: key }, 3)); return o; };
    const fin = mk('WO-T-11', 10), going = mk('WO-T-12', 5);
    const s1 = F('mainlineOf')(fin).stages.find((s) => s.key === 'IPQC'), s2 = F('mainlineOf')(going).stages.find((s) => s.key === 'IPQC');
    ok('巡检到点只提醒还在生产的工序：做完的不提醒，磨削还差 5 件的提醒', s1.state === 'done' && s2.state === 'active' && /50 磨削/.test(s2.text), s1.state + ' / ' + s2.state + ' ' + s2.text); }
  ok('“每班 1 次”按班次时长算（默认两班倒 12 小时）', F('freqHours')('每班 1 次') === 12, String(F('freqHours')('每班 1 次')));
  { const fai = F('floorItems')().filter((i) => i.kind === 'fai');
    ok('等首件的项分数封顶，排在巡检超时（400 起）后面', fai.length > 0 && fai.every((i) => i.score < 400), J(fai.map((i) => Math.round(i.score)))); }
  { const a = mkO('WO-T-17', 'p3', 100); wk(a, '20 组装', 100, 0, { at: ago(14) }); wk(a, '30 终检', 100, 0, { at: ago(14) });
    const b = mkO('WO-T-18', 'p3', 100); wk(b, '20 组装', 100, 0, { at: ago(14) });
    const due = F('workDue')();
    ok('“待报工”不再列终检已经报完的工单，还没报完的照列', due.indexOf(a) < 0 && due.indexOf(b) >= 0, due.map((o) => o.wo).join(',')); }
  { const o = mkO('WO-T-19', 'p3', 100); wk(o, '20 组装', 40, 0, { machine: '装配线 A', at: ago(2) });
    o.setups.push({ id: nid('su'), op: '20 组装', opNo: '20', machine: '装配线 A', trigger: '下机', note: '', shift: '白班', by: 'u4', at: ago(1) });
    const jobs = (F('machineJobs')()['装配线 A'] || []).filter((j) => j.o === o);
    ok('登记“下机”之后，机台卡片不再显示这张工单', jobs.length === 0, J(jobs.map((j) => j.op))); }
  { const w = F('workForm')({ orderId: o11.id, op: '20 精车' }), s = F('setupForm')({ orderId: o11.id });
    ok('报工、登记换刀默认取工单实际在做的机台（WO-2611-011 在 CNC-04，不是路线上的 CNC-02）', F('runningMachine')(o11, '20 精车') === 'CNC-04' && w.machine === 'CNC-04' && s.machine === 'CNC-04', w.machine + ' / ' + s.machine);
    ok('换工单、换工序时，原来选的机台这道工序也能用就留着，用不了才换', F('keepMachine')(o21, '20 精车', 'CNC-04') === 'CNC-04' && F('keepMachine')(o21, '20 精车', '装配线 A') !== '装配线 A'); }
  await render('/floor', 'u4', '生产主管的现场看板：本班待报工', ['本班待报工', 'WO-2611-018']);

  /* 追溯、放行、扫码 */
  { const o = mkO('WO-T-13', 'p3', 10, { inLots: ['LOT-T-13A', 'LOT-T-13B'] });
    const tr = F('traceOf')('LOT-T-13A'), sc = F('traceHoldScopes')(tr);
    ok('往后查只把查到的来料批次当可疑：同一工单的另一个来料批次不列、不限制', tr.direction === 'forward' && J(tr.lots) === J(['LOT-T-13A']) && !sc.some((x) => x.scopeVal === 'LOT-T-13B') && sc.some((x) => x.scopeVal === o.wo), J({ lots: tr.lots, sc: sc.map((x) => x.scopeVal) })); }
  { S.me = 'u2';
    mkT('p2', 'IQC', { supplier: '华研精密（示例）', batch: 'LOT-T-14' }, 2, 'fail');
    const tr = F('traceOf')('LOT-T-14'), n = F('traceHold')(tr, F('traceHoldScopes')(tr), '回归测试');
    ok('只在来料检验里出现过的批次：一键隔离的不合格挂在来料检验的零件上', tr.orders.length === 0 && n.partId === 'p2', n.partId); }
  { const o = mkO('WO-T-16', 'p3', 10, { inLots: ['LOT-T-16'], releasedAt: ago(1), releasedBy: 'u3', releaseKind: 'normal', releaseBasis: [] });
    const sc = F('traceHoldScopes')(F('traceOf')('LOT-T-16'));
    ok('已放行未发货、成品批次没登记的工单：一键限制给出“按工单号禁止发运”', sc.some((x) => x.scopeType === '工单' && x.scopeVal === o.wo && J(x.actions) === J(['ship']) && x.on), J(sc.map((x) => x.label))); }
  { const o = mkO('WO-T-15', 'p3', 10, { outLot: 'FG-T-15', releasedAt: ago(1), releasedBy: 'u3', releaseKind: 'normal', releaseBasis: [] });
    const shipN = () => F('roleFlow')('wh').find((x) => x.key === 'ship').n;
    const before = shipN();
    mkN({ status: 'scoped', batch: 'FG-T-15', qtySuspect: 10, qtyConfirmed: 1, holds: [{ id: nid('ht'), scopeType: '批次', scopeVal: 'FG-T-15', actions: ['ship'], status: 'active', by: 'u2', at: now() }] });
    const ml = F('mainlineOf')(o), after = shipN();
    ok('已放行的成品批次被限制发运：仓库“可发货的工单”不再计入', ml.shipHolds.length === 1 && after === before - 1, before + ' → ' + after);
    await render('/orders?f=released', 'u5', '仓库：已放行但禁止发运的工单', ['暂不能发货']); }
  ok('让步批准文件编号不会预填成工单号、报废单号、NCR 编号', F('guessDocNo')({ reason: '工单 WO-2611-064 报废单 SC-2611-21，客户同意（CC-2611-05）', evidence: '' }) === 'CC-2611-05' && F('guessDocNo')({ reason: '见 NCR-2026-0013', evidence: '报废单 SC-2611-21' }) === '');
  { S.settings.scanBase = 'http://192.168.1.20:5180/#/workbench';
    const u = F('scanUrl')('WO-T-X');
    S.settings.scanBase = '';
    ok('扫码地址带了 #… 也能拼出正确的二维码网址', u === 'http://192.168.1.20:5180/#/scan/WO-T-X', u); }
  { const keys = winListeners.keydown || [], cb = { tagName: 'INPUT', type: 'checkbox' };
    S.me = 'u7'; loc.hash = '#/workbench';
    'WO-2611-021'.split('').forEach((ch) => keys.forEach((f) => f({ key: ch, target: cb, preventDefault() {} })));
    keys.forEach((f) => f({ key: 'Enter', target: cb, preventDefault() {} }));
    ok('复选框获得焦点时，扫码枪照样能用', loc.hash === '#/inspect/t7', loc.hash); }
}

/* ---------------- 4. 动作之后再渲染一遍 ---------------- */
console.log('\n[4] 动作之后的页面');
for (const u of ['u1', 'u2', 'u3', 'u4', 'u5']) for (const r of ['/workbench', '/orders', '/orders?f=released', '/floor', '/trace?q=DN-2611-007', '/orders/' + o21.id + '?stage=FIRST', '/orders/' + o64.id + '?stage=release', '/orders/' + o92.id, '/orders/' + o11.id, '/ncr', '/ncr?tab=holds'].concat(S.ncrs.slice(0, 3).map((n) => '/ncr/' + n.id), newFai ? ['/inspect/' + newFai.id] : [])) await render(r, u);

await flush();
console.error = _err;
console.warn = _warn;
if (fail) { console.log('\n运行时检查：' + fail + ' 项没有通过（通过 ' + pass + ' 项，渲染 ' + renders + ' 次）'); process.exit(1); }
console.log('运行时检查通过：' + pass + ' 项（Node 中渲染页面 ' + renders + ' 次，覆盖 ' + users.length + ' 种演示身份；生产现场动作全部按预期）');
process.exit(0);

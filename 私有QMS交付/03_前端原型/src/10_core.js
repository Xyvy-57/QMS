/* =====================================================================
 * Worlder QMS 原型 · 核心（工具 / 规则 / 演示数据 / 状态 / 权限 / 路由）
 * 说明：正式系统中“判定、抽样、签名摘要、权限”都在服务端执行；
 *       原型在浏览器内模拟同一套规则，便于评审交互与规则口径。
 * ===================================================================== */
const { createApp, reactive, ref, computed, watch, nextTick, onMounted, onBeforeUnmount, h } = Vue;

/* ---------------- 十进制精确比较（判定口径：不用浮点） ---------------- */
const NUM_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
function normDec(s) {
  s = String(s == null ? '' : s).trim();
  if (!NUM_RE.test(s)) return null;
  let neg = s[0] === '-';
  if (s[0] === '+' || s[0] === '-') s = s.slice(1);
  const parts = s.split('.');
  const i = parts[0].replace(/^0+/, '') || '0';
  const f = (parts[1] || '').replace(/0+$/, '');
  if (i === '0' && f === '') neg = false;
  return { neg, i, f };
}
function cmpAbs(a, b) {
  if (a.i.length !== b.i.length) return a.i.length > b.i.length ? 1 : -1;
  if (a.i !== b.i) return a.i > b.i ? 1 : -1;
  const L = Math.max(a.f.length, b.f.length);
  const fa = a.f.padEnd(L, '0'), fb = b.f.padEnd(L, '0');
  if (fa === fb) return 0;
  return fa > fb ? 1 : -1;
}
/** 比较两个十进制字符串：-1 / 0 / 1；任一不是有效数字时返回 null */
function cmpDec(x, y) {
  const a = normDec(x), b = normDec(y);
  if (!a || !b) return null;
  if (a.neg !== b.neg) return a.neg ? -1 : 1;
  const c = cmpAbs(a, b);
  return a.neg ? -c : c;
}
/** 单值判定：ok / high / low / missing / invalid（规格限含边界，A08） */
function judgeValue(v, it) {
  v = String(v == null ? '' : v).trim();
  if (!v) return 'missing';
  if (!NUM_RE.test(v)) return 'invalid';
  if (it.lsl !== '' && it.lsl != null && cmpDec(v, it.lsl) < 0) return 'low';
  if (it.usl !== '' && it.usl != null && cmpDec(v, it.usl) > 0) return 'high';
  return 'ok';
}
/** 预警带（参照云质“预警值”，只提示、不改变判定）：落在公差带两端各 10% 内 */
function inWarnBand(v, it) {
  if (!it.lsl || !it.usl || !NUM_RE.test(String(v == null ? '' : v).trim())) return false;
  const l = parseFloat(it.lsl), u = parseFloat(it.usl), x = parseFloat(v), t = (u - l) * 0.1;
  return x >= l && x <= u && (x < l + t || x > u - t);
}
function specText(it) {
  if (it.kind === 'count') return it.spec || '计数（不良即不符合）';
  if (it.nominal && it.upper && it.lower) return (it.sym || '') + it.nominal + ' ' + it.upper + '/' + it.lower;
  if (it.lsl && it.usl) return it.lsl + ' ~ ' + it.usl;
  if (it.lsl) return '≥ ' + it.lsl;
  if (it.usl) return '≤ ' + it.usl;
  return '—';
}

/* ---------------- 摘要 / 通用工具 ---------------- */
function fnv(s, seedVal) { let x = seedVal >>> 0; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; } return x >>> 0; }
/** 内容摘要（原型用 64 位 FNV 变体演示“签名绑定内容”；正式系统用 SHA-256） */
function hashOf(obj) {
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return (fnv(s, 2166136261).toString(16).padStart(8, '0') + fnv(s, 0x9e3779b1).toString(16).padStart(8, '0')).toUpperCase();
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const nowISO = () => new Date().toISOString();
const pad2 = (n) => String(n).padStart(2, '0');
function fmtTime(iso) { if (!iso) return '—'; const d = new Date(iso); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function fmtDate(iso) { if (!iso) return '—'; const d = new Date(iso); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function fmtRel(iso) {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) { const m = -s / 60; if (m < 60) return Math.max(1, Math.round(m)) + ' 分钟后'; if (m < 1440) return Math.round(m / 60) + ' 小时后'; return Math.round(m / 1440) + ' 天后'; }
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' 天前';
  return fmtDate(iso);
}
function dateCode(d) { d = d || new Date(); return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()); }
/** 演示数据的时间：n 天前的 hh:mm。当天还没到的时刻（例如凌晨打开演示时的“今天 08:00”）改成刚才，按时刻先后排在最近二十几分钟内，演示数据里不出现未来的记录 */
const daysAgo = (n, hh, mm) => {
  const d = new Date(); d.setDate(d.getDate() - n); d.setHours(hh == null ? 9 : hh, mm || 0, 0, 0);
  if (n === 0 && d.getTime() > Date.now()) return new Date(Date.now() - (24 * 60 - (d.getHours() * 60 + d.getMinutes())) * 1000).toISOString();
  return d.toISOString();
};
const hoursFromNow = (n) => new Date(Date.now() + n * 3600e3).toISOString();
const nextRev = (r) => String.fromCharCode((r || 'A').charCodeAt(0) + 1);
const sum = (arr) => arr.reduce((a, b) => a + b, 0);

/* ---------------- 抽样（GB/T 2828.1 一般检验水平 II · 正常检验一次抽样 · 演示子集） ----------------
 * 正式使用前须导入企业授权版本并复核；子集之外的组合（含箭头规则）明确拒绝，不推算（V3 A44）。 */
const CODE_LETTERS = [[8, 'A', 2], [15, 'B', 3], [25, 'C', 5], [50, 'D', 8], [90, 'E', 13], [150, 'F', 20], [280, 'G', 32], [500, 'H', 50], [1200, 'J', 80], [3200, 'K', 125], [10000, 'L', 200], [35000, 'M', 315], [150000, 'N', 500], [500000, 'P', 800], [Infinity, 'Q', 1250]];
const AQL_DEMO = {
  E: { '1.0': [0, 1], '4.0': [1, 2], '6.5': [2, 3] },
  F: { '0.65': [0, 1], '2.5': [1, 2], '4.0': [2, 3], '6.5': [3, 4] },
  G: { '0.40': [0, 1], '1.5': [1, 2], '2.5': [2, 3], '4.0': [3, 4], '6.5': [5, 6] },
  H: { '0.25': [0, 1], '1.0': [1, 2], '1.5': [2, 3], '2.5': [3, 4], '4.0': [5, 6], '6.5': [7, 8] },
  J: { '0.15': [0, 1], '0.65': [1, 2], '1.0': [2, 3], '1.5': [3, 4], '2.5': [5, 6], '4.0': [7, 8], '6.5': [10, 11] },
  K: { '0.10': [0, 1], '0.40': [1, 2], '0.65': [2, 3], '1.0': [3, 4], '1.5': [5, 6], '2.5': [7, 8], '4.0': [10, 11], '6.5': [14, 15] },
  L: { '0.065': [0, 1], '0.25': [1, 2], '0.40': [2, 3], '0.65': [3, 4], '1.0': [5, 6], '1.5': [7, 8], '2.5': [10, 11], '4.0': [14, 15], '6.5': [21, 22] },
};
const AQL_OPTIONS = ['0.065', '0.10', '0.15', '0.25', '0.40', '0.65', '1.0', '1.5', '2.5', '4.0', '6.5'];
function aqlSuggest(lot, aql) {
  const s = String(lot == null ? '' : lot).trim();
  if (!/^\d+$/.test(s) || parseInt(s, 10) < 2) return { error: '批量需为不小于 2 的整数件数（计数抽样只支持整数件制批量）' };
  const n0 = parseInt(s, 10);
  const row = CODE_LETTERS.find((r) => n0 <= r[0]);
  const letter = row[1], n = row[2];
  const t = AQL_DEMO[letter];
  if (!t || !t[aql]) return { letter, n, unsupported: true };
  return { letter, n, ac: t[aql][0], re: t[aql][1] };
}

/* ---------------- 角色与权限（演示身份 = 待确认的示例配置，V3 目录 p3–4） ---------------- */
const ROLES = {
  insp: { name: '检验员', desc: '按已有方案开检、录数、拍照、签名提交，登记已确认的不符合', chip: 'chip-blue' },
  qe: { name: '质量工程师', desc: '编制标准与方案、维护基础资料，可连续开检录数，提出处置建议', chip: 'chip-brand' },
  ql: { name: '质量负责人', desc: '批准标准与方案、复核报告、批准处置与关闭、解除质量限制；不代录数', chip: 'chip-violet' },
  pm: { name: '生产主管', desc: '核对生产相关不符合，为 NCR 提出返工类处置建议（建议不等于批准）', chip: 'chip-amber' },
  wh: { name: '仓库执行人', desc: '只读查看与实物有关的质量事实和质量限制', chip: 'chip-gray' },
  admin: { name: '系统管理员', desc: '账号、角色与集成设置；不自动取得任何质量审批权', chip: 'chip-gray' },
};
const PERMS = {
  'bubble.sync': { label: '接收气泡同步 / 生成标准草稿', roles: ['qe'] },
  'std.edit': { label: '编制与提交检验标准', roles: ['qe'] },
  'std.approve': { label: '批准标准生效 / 停用', roles: ['ql'] },
  'plan.edit': { label: '编制检验方案与方案模板', roles: ['qe'] },
  'plan.approve': { label: '批准方案生效 / 停用', roles: ['ql'] },
  'order.create': { label: '登记生产工单', roles: ['pm', 'qe'] },
  'order.work': { label: '生产报工（合格数、不良数）', roles: ['pm'] },
  'order.setup': { label: '登记首件触发（开班 / 换型 / 换刀 / 修机后）', roles: ['pm', 'insp', 'qe'] },
  'order.release': { label: '工单质量放行（含让步放行）', roles: ['ql'] },
  'task.create': { label: '新建检验任务', roles: ['insp', 'qe'] },
  'task.measure': { label: '录入实测 / 拍照 / 设备导入', roles: ['insp', 'qe'] },
  'task.submit': { label: '签名提交检验轮次', roles: ['insp', 'qe'] },
  'task.retest': { label: '发起复检（新轮次）', roles: ['qe'] },
  'report.review': { label: '复核并签批检验报告', roles: ['ql'] },
  'ncr.create': { label: '登记不合格', roles: ['insp', 'qe', 'ql'] },
  'ncr.scope': { label: '确认不合格范围', roles: ['qe', 'ql'] },
  'ncr.suggest': { label: '提出处置建议', roles: ['qe', 'pm'] },
  'ncr.approve': { label: '批准处置 / 验证关闭 NCR', roles: ['ql'] },
  'ncr.execute': { label: '登记处置执行结果', roles: ['qe'] },
  'hold.create': { label: '建立质量限制', roles: ['qe', 'ql'] },
  'hold.release': { label: '解除质量限制', roles: ['ql'] },
  'md.edit': { label: '维护零部件 / 工序路线 / 检具方法', roles: ['qe'] },
  'scene.edit': { label: '配置检验场景与流程步骤', roles: ['qe', 'ql'] },
  'tpl.edit': { label: '维护报告模板', roles: ['qe'] },
  'sys.admin': { label: '用户角色与集成设置', roles: ['admin'] },
};

/* ---------------- 检验场景与可复用流程步骤库（五个场景代码固定，不做任意流程编排） ----------------
 * 执行顺序：生成报告（冻结）在前，报告复核在后——复核对象是已冻结的报告修订。 */
const STEP_LIB = {
  basis: { name: '确认依据', desc: '冻结场景、标准版本、方案修订三层快照；建单时不能改技术规则', icon: 'lock', locked: true },
  sampling: { name: '取样登记', desc: '按方案样本量生成样本；复检可选原样本子集或新取样本', icon: 'grid' },
  measure: { name: '实测录入', desc: '计量组逐值录入；计数组登记不良数与不良单位数', icon: 'edit', locked: true },
  import: { name: '设备导入', desc: 'CMM、电子量具、Excel 报文导入；格式错误与真实超差分开处理', icon: 'cpu' },
  photo: { name: '拍照取证', desc: '外观与不良项现场拍照；拍照要求按场景参数校验', icon: 'camera' },
  check: { name: '完整性检查', desc: '缺失不等于 0；缺失项须补测，或说明原因后以“证据不足”提交', icon: 'shield' },
  judge: { name: '系统判定', desc: '服务端十进制精确比较；计数组按 n、Ac、Re 判批', icon: 'check-square', locked: true },
  sign: { name: '电子签名', desc: '检验员手写签名，签名绑定本轮内容摘要', icon: 'pen' },
  report: { name: '生成报告', desc: '冻结报告修订，套用方案引用的报告模板', icon: 'file', locked: true },
  review: { name: '报告复核', desc: '按场景策略触发；复核人不得为本轮签名人，可签批或退回', icon: 'stamp' },
};
const STEP_ORDER = ['basis', 'sampling', 'measure', 'import', 'photo', 'check', 'judge', 'sign', 'report', 'review'];
const PHOTO_POLICY = { none: '不要求', onDefect: '不合格项必须拍照', appearance: '外观类特性必须拍照' };
const REVIEW_POLICY = { never: '不复核', onFail: '仅不合格时复核', always: '总是复核' };
const CTX_FIELDS = {
  supplier: { label: '供应商', type: 'supplier' }, receipt: { label: '收货单号', ph: '可空，如 IR2206108AA8LF' }, batch: { label: '批次号', ph: '如 20261116-A' },
  wo: { label: '工单号', ph: '可空，如 WO-2611-018' }, op: { label: '工序', type: 'op' }, machine: { label: '机台', ph: '如 CNC-03' }, trigger: { label: '首件原因', ph: '开工 / 开班 / 换型 / 换刀 / 修机后' },
  freq: { label: '巡检频次', ph: '如 每 2 小时' }, customer: { label: '客户', type: 'customer' }, shipment: { label: '发货单号', ph: '可空，如 DN-2611-007' },
};
const SCENE_META = {
  IQC: { icon: 'inbox', tint: 'bg-sky-50 text-sky-700' },
  FIRST: { icon: 'star', tint: 'bg-violet-50 text-violet-700' },
  IPQC: { icon: 'activity', tint: 'bg-amber-50 text-amber-700' },
  FQC: { icon: 'check-square', tint: 'bg-emerald-50 text-emerald-700' },
  OQC: { icon: 'truck', tint: 'bg-rose-50 text-rose-700' },
};

/* ---------------- 状态字典 ---------------- */
const STATUS = {
  task: { pending: ['待检', 'chip-gray', '#a1a1aa'], active: ['检验中', 'chip-blue', '#0ea5e9'], pass: ['合格', 'chip-green', '#10b981'], fail: ['不合格', 'chip-red', '#f43f5e'], insufficient: ['证据不足', 'chip-amber', '#f59e0b'] },
  std: { draft: ['草稿', 'chip-gray'], review: ['待审', 'chip-amber'], effective: ['生效', 'chip-green'], retired: ['已停用', 'chip-gray'] },
  plan: { draft: ['草稿', 'chip-gray'], review: ['待审', 'chip-amber'], effective: ['生效', 'chip-green'], retired: ['已停用', 'chip-gray'] },
  report: { preview: ['预览（不可签发）', 'chip-gray'], frozen: ['已冻结', 'chip-blue'], review: ['待复核', 'chip-amber'], approved: ['已批准', 'chip-green'], superseded: ['已替代', 'chip-gray'] },
  ncr: { registered: ['已登记', 'chip-gray'], scoped: ['范围确认', 'chip-blue'], disposing: ['处置中', 'chip-amber'], verifying: ['待验证', 'chip-violet'], closed: ['已关闭', 'chip-green'] },
  hold: { active: ['有效', 'chip-red'], released: ['已解除', 'chip-gray'] },
  result: { pass: ['符合', 'chip-green'], fail: ['不符合', 'chip-red'], incomplete: ['证据不足', 'chip-amber'], accept: ['接受', 'chip-green'], reject: ['拒收', 'chip-red'], continue: ['继续抽样', 'chip-blue'] },
};
const NCR_FLOW = [['registered', '已登记'], ['scoped', '范围确认'], ['disposing', '处置中（MRB）'], ['verifying', '待验证'], ['closed', '已关闭']];
const DISPOSITIONS = ['返工', '返修', '让步接收', '挑选', '报废', '退货'];
const HOLD_ACTIONS = { use: '使用', process: '继续加工', ship: '发运' };

/* ---------------- 演示数据：图纸（SVG 底图，坐标系 860×520） ---------------- */
function titleBlock(p) {
  return '<g font-size="10" fill="#475569"><rect x="520" y="372" width="308" height="114" fill="#fff" stroke="#94a3b8"/>' +
    '<line x1="520" y1="400" x2="828" y2="400" stroke="#cbd5e1"/><line x1="520" y1="428" x2="828" y2="428" stroke="#cbd5e1"/><line x1="520" y1="456" x2="828" y2="456" stroke="#cbd5e1"/><line x1="670" y1="372" x2="670" y2="486" stroke="#cbd5e1"/>' +
    '<text x="530" y="390">零件号 <tspan fill="#0f172a" font-weight="600">' + p.partNo + '</tspan></text><text x="680" y="390">名称 <tspan fill="#0f172a" font-weight="600">' + p.name + '</tspan></text>' +
    '<text x="530" y="418">图号 <tspan fill="#0f172a">' + p.dwg + '</tspan></text><text x="680" y="418">版本 <tspan fill="#075e63" font-weight="600">' + p.rev + '</tspan></text>' +
    '<text x="530" y="446">材料 <tspan fill="#0f172a">' + p.mat + '</tspan></text><text x="680" y="446">比例 <tspan fill="#0f172a">1:1</tspan></text>' +
    '<text x="530" y="474">未注公差 <tspan fill="#0f172a">GB/T 1804-m</tspan></text><text x="680" y="474">来源 <tspan fill="#0f172a">Worlder 气泡图</tspan></text></g>';
}
const FRAME = '<rect x="12" y="12" width="836" height="496" fill="#fff" stroke="#cbd5e1" stroke-width="1.2"/><rect x="20" y="20" width="820" height="480" fill="none" stroke="#e2e8f0" stroke-width=".8"/>';
const SVG_VALVE = FRAME +
  '<g stroke="#ef4444" stroke-width=".9" stroke-dasharray="14,5,3,5" opacity=".7"><line x1="70" y1="220" x2="580" y2="220"/><line x1="685" y1="95" x2="685" y2="345"/><line x1="590" y1="220" x2="810" y2="220"/></g>' +
  '<g fill="#f8fafc" stroke="#0f172a" stroke-width="1.6"><rect x="105" y="175" width="130" height="90"/><rect x="235" y="145" width="210" height="150"/><rect x="445" y="162" width="95" height="116"/><circle cx="685" cy="220" r="82"/></g>' +
  '<rect x="235" y="192" width="295" height="56" fill="#fff" stroke="#64748b" stroke-width="1.2" stroke-dasharray="6,4"/><circle cx="685" cy="220" r="52" fill="#fff" stroke="#0f172a" stroke-width="1.4"/><circle cx="685" cy="220" r="28" fill="none" stroke="#64748b" stroke-width="1" stroke-dasharray="5,3"/>' +
  '<g stroke="#2563eb" stroke-width=".9"><line x1="105" y1="175" x2="72" y2="175"/><line x1="105" y1="265" x2="72" y2="265"/><line x1="78" y1="175" x2="78" y2="265"/><line x1="105" y1="175" x2="105" y2="108"/><line x1="235" y1="145" x2="235" y2="108"/><line x1="105" y1="115" x2="235" y2="115"/><line x1="235" y1="108" x2="445" y2="108"/><line x1="445" y1="162" x2="445" y2="102"/><line x1="540" y1="162" x2="578" y2="162"/><line x1="540" y1="278" x2="578" y2="278"/><line x1="570" y1="162" x2="570" y2="278"/><line x1="340" y1="145" x2="365" y2="72"/><line x1="365" y1="72" x2="470" y2="72"/></g>' +
  '<g fill="#1e3a8a" font-size="11" font-family="ui-monospace,Menlo,monospace"><text x="26" y="290">Ø20.00±0.10</text><text x="132" y="108">12.00±0.05</text><text x="305" y="101">36.00±0.10</text><text x="478" y="300">25.05~25.10</text><text x="370" y="66">镀层厚度 ≥0.350</text></g>' +
  '<rect x="34" y="372" width="470" height="114" fill="#f8fafc" stroke="#cbd5e1"/><g font-size="11" fill="#334155"><text x="46" y="392" font-weight="600" fill="#0f172a">技术要求</text><text x="46" y="411">1. 轴向拉力 600 000~700 000 N；抗拉强度 2000~2285 N/mm²。</text><text x="46" y="429">2. 定子外观为关键特性(CTQ)：无气孔、粘砂、暗划。</text><text x="46" y="447">3. 转子外观为重要特性(CC)：无飞边、裂纹。</text><text x="46" y="465">4. 螺旋焊缝不得有划伤。</text></g>' +
  titleBlock({ partNo: '1.2020.01.1', name: '01系列阀芯', dwg: 'DWG-2026-011', rev: 'A3', mat: '40Cr 镀锌' });
const SVG_SHAFT = FRAME +
  '<g stroke="#ef4444" stroke-width=".9" stroke-dasharray="14,5,3,5" opacity=".7"><line x1="60" y1="215" x2="800" y2="215"/></g>' +
  '<g fill="#f8fafc" stroke="#0f172a" stroke-width="1.6"><rect x="90" y="175" width="130" height="80"/><rect x="220" y="150" width="270" height="130"/><rect x="490" y="180" width="160" height="70"/><rect x="650" y="192" width="110" height="46"/></g>' +
  '<g stroke="#0f172a" stroke-width="1.2" fill="none"><path d="M760 192 l8 8 v30 l-8 8"/><path d="M90 175 l-8 8 v64 l8 8"/></g>' +
  '<g stroke="#2563eb" stroke-width=".9"><line x1="90" y1="175" x2="90" y2="96"/><line x1="760" y1="192" x2="760" y2="96"/><line x1="90" y1="104" x2="760" y2="104"/><line x1="220" y1="150" x2="190" y2="150"/><line x1="220" y1="280" x2="190" y2="280"/><line x1="198" y1="150" x2="198" y2="280"/></g>' +
  '<g fill="#1e3a8a" font-size="11" font-family="ui-monospace,Menlo,monospace"><text x="380" y="97">48.00±0.15</text><text x="100" y="300">Ø18.00±0.08</text><text x="772" y="246">C0.5</text></g>' +
  '<g stroke="#0f172a" stroke-width="1" fill="#fff"><rect x="540" y="112" width="26" height="22"/><rect x="566" y="112" width="58" height="22"/><rect x="624" y="112" width="22" height="22"/></g><g font-size="12" fill="#0f172a"><text x="546" y="128">◎</text><text x="571" y="128">Ø0.025</text><text x="630" y="128">A</text></g><line x1="593" y1="134" x2="593" y2="180" stroke="#0f172a" stroke-width=".9"/>' +
  '<g stroke="#0f172a" stroke-width="1.2" fill="none"><path d="M330 150 l8 -14 l8 14 M338 136 l16 -18 h40"/></g><text x="360" y="114" font-size="11" fill="#1e3a8a">Ra 1.6</text>' +
  '<g fill="#0f172a"><path d="M150 262 l-10 16 h20z"/></g><text x="146" y="292" font-size="11" fill="#0f172a">A</text>' +
  '<rect x="34" y="372" width="470" height="114" fill="#f8fafc" stroke="#cbd5e1"/><g font-size="11" fill="#334155"><text x="46" y="392" font-weight="600" fill="#0f172a">技术要求</text><text x="46" y="411">1. 调质处理 HB 241~285。</text><text x="46" y="429">2. 主轴外径为关键特性(CTQ)，同轴度以 A 为基准。</text><text x="46" y="447">3. 未注倒角 C0.5，锐边倒钝。</text></g>' +
  titleBlock({ partNo: '1.2020.01.2', name: '01系列轴1-1', dwg: 'DWG-2026-018', rev: 'A', mat: '45# 调质' });
const SVG_DRILL = FRAME +
  '<g stroke="#ef4444" stroke-width=".9" stroke-dasharray="14,5,3,5" opacity=".7"><line x1="60" y1="210" x2="720" y2="210"/><line x1="760" y1="150" x2="760" y2="270"/></g>' +
  '<g fill="#f8fafc" stroke="#0f172a" stroke-width="1.6"><rect x="80" y="180" width="250" height="60"/><path d="M330 186 h300 l60 24 l-60 24 h-300z"/><circle cx="760" cy="210" r="42"/></g>' +
  '<g stroke="#64748b" stroke-width="1"><line x1="360" y1="186" x2="400" y2="234"/><line x1="420" y1="186" x2="460" y2="234"/><line x1="480" y1="186" x2="520" y2="234"/><line x1="540" y1="186" x2="580" y2="234"/><line x1="600" y1="186" x2="630" y2="222"/><path d="M740 190 q20 20 0 40 M780 190 q-20 20 0 40" fill="none"/></g>' +
  '<g stroke="#2563eb" stroke-width=".9"><line x1="80" y1="180" x2="80" y2="120"/><line x1="330" y1="180" x2="330" y2="120"/><line x1="80" y1="128" x2="330" y2="128"/><line x1="480" y1="186" x2="480" y2="140"/></g>' +
  '<g fill="#1e3a8a" font-size="11" font-family="ui-monospace,Menlo,monospace"><text x="150" y="121">M8×1.25-6g</text><text x="452" y="134">Ø10.00±0.04</text><text x="712" y="140">刃口外观</text></g>' +
  '<g stroke="#0f172a" stroke-width="1" fill="#fff"><rect x="610" y="270" width="26" height="22"/><rect x="636" y="270" width="54" height="22"/><rect x="690" y="270" width="20" height="22"/></g><g font-size="12" fill="#0f172a"><text x="616" y="286">↗</text><text x="641" y="286">0.020</text><text x="695" y="286">A</text></g>' +
  '<rect x="34" y="372" width="470" height="114" fill="#f8fafc" stroke="#cbd5e1"/><g font-size="11" fill="#334155"><text x="46" y="392" font-weight="600" fill="#0f172a">技术要求</text><text x="46" y="411">1. 刃部淬火 HRC 60~64。</text><text x="46" y="429">2. 刃口不允许崩刃、裂纹；螺纹用通止规检验。</text><text x="46" y="447">3. 端面跳动以柄部轴线 A 为基准。</text></g>' +
  titleBlock({ partNo: '20.0363.02', name: 'CP钻头组件', dwg: 'DWG-2026-092', rev: 'B', mat: 'W6Mo5Cr4V2' });

/* ---------------- 演示数据：特性（气泡）定义；cid 是稳定特性 ID，no 只是显示用的气泡号 ---------------- */
function mkItems(prefix, list) {
  return list.map((x) => Object.assign({ cid: prefix + '-' + pad2(x.no), kind: 'measure', sym: '', nominal: '', upper: '', lower: '', lsl: '', usl: '', unit: 'mm', cls: '一般', gauge: '', method: '' }, x));
}
const ITEMS_VALVE = mkItems('CH-011', [
  { no: 1, name: '1-1 轴直径', cat: '线性尺寸', sym: 'Ø', nominal: '20.00', upper: '+0.10', lower: '-0.10', lsl: '19.90', usl: '20.10', cls: 'CTQ', gauge: 'G03', x: 60, y: 150 },
  { no: 2, name: '1-1 轴长', cat: '线性尺寸', nominal: '12.00', upper: '+0.05', lower: '-0.05', lsl: '11.95', usl: '12.05', gauge: 'G02', x: 170, y: 86 },
  { no: 3, name: '1-2 轴长', cat: '线性尺寸', nominal: '36.00', upper: '+0.10', lower: '-0.10', lsl: '35.90', usl: '36.10', gauge: 'G03', x: 340, y: 82 },
  { no: 4, name: '3-1 支撑杆高', cat: '线性尺寸', lsl: '25.05', usl: '25.10', cls: 'CC', gauge: 'G03', x: 600, y: 270 },
  { no: 5, name: '镀层厚度', cat: '理化', lsl: '0.350', cls: 'CTQ', gauge: 'G11', x: 495, y: 50 },
  { no: 6, name: '轴向拉力', cat: '功能', lsl: '600000', usl: '700000', unit: 'N', cls: 'CTQ', gauge: 'G12', x: 470, y: 406 },
  { no: 7, name: '抗拉强度', cat: '理化', lsl: '2000', usl: '2285', unit: 'N/mm²', cls: 'CC', gauge: 'G12', x: 470, y: 436 },
  { no: 8, name: '定子外观（气孔/粘砂/暗划）', cat: '外观', kind: 'count', spec: '无气孔、粘砂、暗划', unit: '件', cls: 'CTQ', gauge: 'G10', x: 628, y: 128 },
  { no: 9, name: '转子外观（飞边/裂纹）', cat: '外观', kind: 'count', spec: '无飞边、裂纹', unit: '件', cls: 'CC', gauge: 'G10', x: 770, y: 140 },
  { no: 10, name: '螺旋焊缝划伤', cat: '外观', kind: 'count', spec: '不得有划伤', unit: '件', cls: 'CTQ', gauge: 'G10', x: 290, y: 272 },
]);
const ITEMS_SHAFT = mkItems('CH-018', [
  { no: 1, name: '主轴外径', cat: '线性尺寸', sym: 'Ø', nominal: '18.00', upper: '+0.08', lower: '-0.08', lsl: '17.92', usl: '18.08', cls: 'CTQ', gauge: 'G01', x: 170, y: 150 },
  { no: 2, name: '台阶总长', cat: '线性尺寸', nominal: '48.00', upper: '+0.15', lower: '-0.15', lsl: '47.85', usl: '48.15', cls: 'CC', gauge: 'G02', x: 470, y: 80 },
  { no: 3, name: '同轴度', cat: '形位公差', sym: '◎', usl: '0.025', cls: 'CTQ', gauge: 'G03', x: 670, y: 104 },
  { no: 4, name: '表面粗糙度 Ra', cat: '表面粗糙度', usl: '1.6', unit: 'μm', gauge: 'G07', x: 420, y: 112 },
  { no: 5, name: '倒角 C0.5', cat: '倒角', nominal: '0.5', upper: '+0.1', lower: '-0.1', lsl: '0.4', usl: '0.6', gauge: 'G04', x: 800, y: 262 },
]);
const ITEMS_DRILL = mkItems('CH-092', [
  { no: 1, name: '刃口直径', cat: '线性尺寸', sym: 'Ø', nominal: '10.00', upper: '+0.04', lower: '-0.04', lsl: '9.96', usl: '10.04', cls: 'CTQ', gauge: 'G03', x: 560, y: 140 },
  { no: 2, name: '刃部硬度', cat: '理化', lsl: '60', usl: '64', unit: 'HRC', cls: 'CTQ', gauge: 'G13', x: 300, y: 396 },
  { no: 3, name: '端面跳动', cat: '形位公差', sym: '↗', usl: '0.020', cls: 'CC', gauge: 'G03', x: 730, y: 320 },
  { no: 4, name: '螺纹 M8×1.25-6g', cat: '螺纹', kind: 'count', spec: '通规通过、止规不通过', unit: '件', gauge: 'G08', x: 280, y: 112 },
  { no: 5, name: '刃口外观（崩刃/裂纹）', cat: '外观', kind: 'count', spec: '不允许崩刃、裂纹', unit: '件', cls: 'CC', gauge: 'G10', x: 800, y: 150 },
]);

/** 方案 → 任务快照（场景定义、标准修订、方案修订三层冻结） */
function buildSnapshot(st, plan, sceneCode) {
  const std = st.standards.find((s) => s.id === plan.stdId);
  const scene = st.scenes.find((s) => s.code === sceneCode);
  const items = std.items.filter((it) => plan.assign[it.cid] && plan.assign[it.cid] !== '-').map((it) => Object.assign(clone(it), { group: plan.assign[it.cid] }));
  return {
    scene: clone(scene), plan: { id: plan.id, code: plan.code, name: plan.name, rev: plan.rev, reportTplId: plan.reportTplId },
    std: { id: std.id, code: std.code, rev: std.rev, drawingRev: std.drawingRev, hash: std.hash }, groups: clone(plan.groups), items, frozenAt: nowISO(),
  };
}
/** 新轮次：本轮样本数只属于轮次；复检 = 新轮次（parent 指向上一轮） */
function newRound(task, no, opts) {
  opts = opts || {};
  const mg = task.snap.groups.find((g) => g.type === 'measure');
  const n = mg ? mg.n : 0;
  const samples = opts.samples || Array.from({ length: n }, (_, i) => (no > 1 ? 'R' + no + '-' : 'S') + (i + 1));
  const vals = {}, cnt = {};
  task.snap.items.forEach((it) => { if (it.group === 'M') vals[it.cid] = samples.map(() => ''); if (it.group === 'C') cnt[it.cid] = { bad: '', note: '' }; });
  return { id: 'rd-' + task.id + '-' + no, no, parent: opts.parent || null, reason: opts.reason || '', sampleMode: opts.sampleMode || 'new', ncrId: opts.ncrId || '', samples, vals, cnt, dUnits: '', photos: [], imports: [], status: 'active', submittedAt: null, signer: null, result: null, missingReason: '' };
}

/* ---------------- 判定引擎（与服务端口径一致的浏览器模拟） ----------------
 * 计量组（measurement）：逐项给出 符合 / 不符合 / 缺失，结论只覆盖本轮被检样本与项目；
 * 计数组（single_count）：证据完整且 d ≤ Ac 才接受，d ≥ Re 拒收，其余继续抽样；禁止提前接受。 */
function evalRound(task, round) {
  const res = { byCid: {}, m: { ok: 0, ng: 0, missing: 0, total: 0 }, c: null, filled: 0, total: 0, overall: 'incomplete', missingCells: [] };
  const items = task.snap.items;
  items.forEach((it) => {
    if (it.group === 'M') {
      const vals = round.vals[it.cid] || [];
      let ng = 0, miss = 0; const cells = [];
      round.samples.forEach((s, i) => {
        const st = judgeValue(vals[i], it);
        cells.push(st);
        if (st === 'missing' || st === 'invalid') { miss++; res.missingCells.push({ it, i, s, st }); } else if (st !== 'ok') ng++;
      });
      res.total += round.samples.length; res.filled += round.samples.length - miss;
      const status = ng > 0 ? 'ng' : miss > 0 ? 'missing' : 'ok';
      res.byCid[it.cid] = { status, ng, miss, cells };
      res.m.total++; res.m[status === 'ok' ? 'ok' : status === 'ng' ? 'ng' : 'missing']++;
    } else if (it.group === 'C') {
      const raw = String((round.cnt[it.cid] || {}).bad == null ? '' : round.cnt[it.cid].bad).trim();
      const filled = /^\d+$/.test(raw);
      const bad = filled ? parseInt(raw, 10) : 0;
      res.total += 1;
      if (filled) res.filled += 1; else res.missingCells.push({ it, i: -1, s: '不良数', st: raw ? 'invalid' : 'missing' });
      res.byCid[it.cid] = { status: !filled ? 'missing' : bad > 0 ? 'ng' : 'ok', bad, filled };
    }
  });
  const cg = task.snap.groups.find((g) => g.type === 'count');
  const cItems = items.filter((i) => i.group === 'C');
  if (cg && cItems.length) {
    const bads = cItems.map((i) => res.byCid[i.cid].bad);
    const allFilled = cItems.every((i) => res.byCid[i.cid].filled);
    const total = sum(bads), maxb = Math.max.apply(null, [0].concat(bads));
    const dRaw = String(round.dUnits == null ? '' : round.dUnits).trim();
    let d = total, dInvalid = '';
    if (dRaw !== '') {
      if (!/^\d+$/.test(dRaw)) dInvalid = '不良单位数须为整数';
      else {
        d = parseInt(dRaw, 10);
        if (d < maxb) dInvalid = '不良单位数不能小于单项最大不良数 ' + maxb;
        else if (d > total) dInvalid = '不良单位数不能大于各项不良数之和 ' + total;
        else if (d > cg.n) dInvalid = '不良单位数不能大于样本量 n';
      }
    }
    let result;
    if (dInvalid) result = 'continue';
    else if (d >= cg.re && (allFilled || cg.earlyReject)) result = 'reject';
    else if (allFilled) result = d <= cg.ac ? 'accept' : 'reject';
    else result = 'continue';
    res.c = { n: cg.n, ac: cg.ac, re: cg.re, aql: cg.aql, d, total, maxb, allFilled, result, dInvalid, dAuto: dRaw === '' };
  }
  const mNg = res.m.ng > 0, cRej = !!res.c && res.c.result === 'reject';
  const mMiss = res.m.missing > 0, cCont = !!res.c && res.c.result === 'continue';
  res.overall = mNg || cRej ? 'fail' : mMiss || cCont ? 'incomplete' : 'pass';
  res.progress = res.total ? res.filled / res.total : 1;
  return res;
}
function summarizeEval(ev) {
  const byCid = {};
  Object.keys(ev.byCid).forEach((k) => { const v = ev.byCid[k]; byCid[k] = { status: v.status, ng: v.ng || 0, bad: v.bad || 0 }; });
  return { overall: ev.overall, m: clone(ev.m), c: ev.c ? clone(ev.c) : null, byCid };
}
/** 报告内容冻结：报告只从冻结内容渲染，不读取实时任务数据 */
function buildReport(st, task, round, code) {
  const part = st.parts.find((p) => p.id === task.partId);
  const content = {
    task: { id: task.id, code: task.code, scene: task.scene, sceneName: task.snap.scene.name, lot: task.lot, ctx: clone(task.ctx) },
    part: { partNo: part.partNo, name: part.name, drawingNo: part.drawingNo, drawingRev: task.snap.std.drawingRev, customer: part.customer },
    std: clone(task.snap.std), plan: clone(task.snap.plan), groups: clone(task.snap.groups), items: clone(task.snap.items),
    round: { id: round.id, no: round.no, parent: round.parent, reason: round.reason, samples: clone(round.samples), vals: clone(round.vals), cnt: clone(round.cnt), dUnits: round.dUnits, missingReason: round.missingReason, photoCount: round.photos.length, submittedAt: round.submittedAt },
    result: clone(round.result),
  };
  return { id: 'r' + task.id + '-' + round.no, code: code || ('RPT-' + task.code + (round.no > 1 ? '-R' + round.no : '')), taskId: task.id, roundId: round.id, rev: 1, state: 'frozen', templateId: task.snap.plan.reportTplId, hash: hashOf(content), content, sigs: [], opinions: [], createdAt: nowISO() };
}
/** 演示数据里的签名图（真实签名由签名板生成） */
function demoSignature(name) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="70"><text x="12" y="48" font-family="Snell Roundhand, STKaiti, KaiTi, cursive" font-size="34" fill="#0f2a6b" transform="rotate(-4 110 35)">' + name + '</text><path d="M10 58 q60 -10 190 -4" stroke="#0f2a6b" stroke-width="1.4" fill="none" opacity=".6"/></svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/* ---------------- 演示数据：生成 ---------------- */
function seed() {
  const users = [
    { id: 'u1', name: '李敏', role: 'insp', dept: '质量部 · 检验组' },
    { id: 'u2', name: '吴清阳', role: 'qe', dept: '质量部 · 质量工程' },
    { id: 'u3', name: '周岚', role: 'ql', dept: '质量部' },
    { id: 'u4', name: '张旭东', role: 'pm', dept: '生产部 · 金加工车间' },
    { id: 'u5', name: '陈默', role: 'wh', dept: '物流部 · 成品仓' },
    { id: 'u6', name: '王工', role: 'admin', dept: '信息部' },
    { id: 'u7', name: '刘志伟', role: 'insp', dept: '质量部 · 检验组' },
  ];
  const gauges = [
    { id: 'G01', name: '千分尺', kind: '检具', cats: ['线性尺寸'], precision: '0.05', items: [], src: '气泡软件', calDue: daysAgo(-120) },
    { id: 'G02', name: '卡尺', kind: '检具', cats: ['线性尺寸'], precision: '0.1', items: [], src: '气泡软件', calDue: daysAgo(-15) },
    { id: 'G03', name: '三次元', alias: 'CMM', kind: '检具', cats: ['形位公差', '线性尺寸'], items: ['位置度', '圆跳动', '线轮廓度', '平面度', '圆柱度', '面轮廓度', '垂直度', '平行度', '倾斜度', '同心度', '全跳动', '圆度', '对称度'], src: '气泡软件', calDue: daysAgo(-180), device: 'CMM-01' },
    { id: 'G04', name: '投影仪', kind: '检具', cats: ['角度尺寸', '倒角'], items: ['R 半径', '角度尺寸'], src: '气泡软件', calDue: daysAgo(-60) },
    { id: 'G05', name: '深度卡尺', kind: '检具', cats: ['线性尺寸'], items: ['沉头孔', '沉孔'], src: '气泡软件', calDue: daysAgo(-90) },
    { id: 'G07', name: '粗糙度仪', kind: '检具', cats: ['表面粗糙度'], items: ['Ra 粗糙度'], src: '气泡软件', calDue: daysAgo(-200) },
    { id: 'G08', name: '螺纹规', kind: '检具', cats: ['螺纹'], items: ['M 螺纹'], src: '气泡软件', calDue: daysAgo(-40) },
    { id: 'G10', name: '目视 / 放大镜', kind: '检验方法', cats: ['外观'], items: ['气孔', '划伤', '飞边', '裂纹'], src: 'QMS', calDue: null },
    { id: 'G11', name: 'X 射线膜厚仪', kind: '检具', cats: ['理化'], items: ['镀层厚度'], src: 'QMS', calDue: daysAgo(-30), device: 'THK-03' },
    { id: 'G12', name: '万能拉力试验机', kind: '检具', cats: ['功能', '理化'], items: ['拉力', '抗拉强度'], src: 'QMS', calDue: daysAgo(3) },
    { id: 'G13', name: '洛氏硬度计', kind: '检具', cats: ['理化'], items: ['HRC'], src: 'QMS', calDue: daysAgo(-75) },
  ];
  const routeTemplates = [
    { id: 'rt1', name: '轴类零件标准路线', rev: 2, desc: '车削 + 热处理外协 + 磨削，适用于轴、销类', updatedAt: daysAgo(12), ops: [
      { no: '10', name: '下料', wc: '锯床区', insp: [] },
      { no: '20', name: '粗车', wc: 'CNC-01', insp: [{ scene: 'FIRST' }, { scene: 'IPQC', freq: '每 2 小时' }] },
      { no: '30', name: '调质（外协）', wc: '外协', insp: [{ scene: 'IQC', note: '外协回厂' }] },
      { no: '40', name: '精车', wc: 'CNC-03', insp: [{ scene: 'FIRST' }, { scene: 'IPQC', freq: '每 2 小时' }] },
      { no: '50', name: '磨削', wc: '磨床-02', insp: [{ scene: 'IPQC', freq: '每 1 小时' }] },
      { no: '60', name: '终检入库', wc: '质检室', insp: [{ scene: 'FQC' }] },
      { no: '70', name: '包装出货', wc: '成品仓', insp: [{ scene: 'OQC' }] },
    ] },
    { id: 'rt2', name: '阀芯（含外协电镀）路线', rev: 1, desc: '来料、精车、电镀外协、装配、终检出货', updatedAt: daysAgo(30), ops: [
      { no: '10', name: '毛坯来料', wc: '来料仓', insp: [{ scene: 'IQC' }] },
      { no: '20', name: '精车', wc: 'CNC-02', insp: [{ scene: 'FIRST' }, { scene: 'IPQC', freq: '每 2 小时' }] },
      { no: '30', name: '电镀（外协）', wc: '外协', insp: [{ scene: 'IQC', note: '外协回厂' }] },
      { no: '40', name: '装配', wc: '装配线 A', insp: [{ scene: 'IPQC', freq: '每班 1 次' }] },
      { no: '50', name: '终检', wc: '质检室', insp: [{ scene: 'FQC' }] },
      { no: '60', name: '出货', wc: '成品仓', insp: [{ scene: 'OQC' }] },
    ] },
    { id: 'rt3', name: '刀具组件路线', rev: 1, desc: '外购刃具来料、组装、出货', updatedAt: daysAgo(45), ops: [
      { no: '10', name: '刃具来料', wc: '来料仓', insp: [{ scene: 'IQC' }] },
      { no: '20', name: '组装', wc: '装配线 B', insp: [{ scene: 'FIRST' }] },
      { no: '30', name: '终检', wc: '质检室', insp: [{ scene: 'FQC' }] },
      { no: '40', name: '出货', wc: '成品仓', insp: [{ scene: 'OQC' }] },
    ] },
  ];
  const routeOf = (tplId, rev) => { const t = routeTemplates.find((x) => x.id === tplId); return { templateId: t.id, templateRev: rev || t.rev, appliedAt: daysAgo(20), ops: clone(t.ops) }; };
  const parts = [
    { id: 'p1', partNo: '1.2020.01.1', name: '01系列阀芯', customer: '北辰动力（示例）', drawingNo: 'DWG-2026-011', drawingRev: 'A3', material: '40Cr 镀锌', svg: SVG_VALVE, route: routeOf('rt2') },
    { id: 'p2', partNo: '1.2020.01.2', name: '01系列轴1-1', customer: '北辰动力（示例）', drawingNo: 'DWG-2026-018', drawingRev: 'A', material: '45# 调质', svg: SVG_SHAFT, route: routeOf('rt1', 1) },
    { id: 'p3', partNo: '20.0363.02', name: 'CP钻头组件', customer: '锐驰装备（示例）', drawingNo: 'DWG-2026-092', drawingRev: 'B', material: 'W6Mo5Cr4V2', svg: SVG_DRILL, route: routeOf('rt3') },
  ];
  const mkStd = (id, code, partId, drawingRev, items, syncBatchId) => {
    const s = { id, code, partId, rev: 'A', drawingRev, status: 'effective', source: 'bubble', syncBatchId, items: clone(items), createdBy: 'u2', createdAt: daysAgo(20), submittedBy: 'u2', approvedBy: 'u3', approvedAt: daysAgo(18), parentId: null, note: '' };
    s.hash = hashOf(s.items);
    return s;
  };
  const standards = [
    mkStd('s1', 'STD-011', 'p1', 'A3', ITEMS_VALVE, 'SYNC-9081'),
    mkStd('s2', 'STD-018', 'p2', 'A', ITEMS_SHAFT, 'SYNC-9082'),
    mkStd('s3', 'STD-092', 'p3', 'B', ITEMS_DRILL, 'SYNC-9085'),
  ];
  const assignBy = (items, fn) => { const a = {}; items.forEach((it) => { a[it.cid] = fn(it); }); return a; };
  const plans = [
    { id: 'pl1', code: 'PL-011-IQC', name: '01系列阀芯 · 来料检验方案', partId: 'p1', rev: 2, status: 'effective', stdId: 's1', scenes: ['IQC'],
      groups: [{ key: 'M', type: 'measure', name: '计量组', n: 5 }, { key: 'C', type: 'count', name: '计数组', n: 125, ac: 3, re: 4, aql: '1.0', lotRef: 1241, earlyReject: true }],
      assign: assignBy(ITEMS_VALVE, (it) => (it.kind === 'count' ? 'C' : 'M')), reportTplId: 'rt-bubble', fromTpl: 'tp1', createdBy: 'u2', updatedAt: daysAgo(8), approvedBy: 'u3' },
    { id: 'pl2', code: 'PL-011-PRC', name: '01系列阀芯 · 首件与巡检方案', partId: 'p1', rev: 1, status: 'effective', stdId: 's1', scenes: ['FIRST', 'IPQC'],
      groups: [{ key: 'M', type: 'measure', name: '计量组', n: 3 }],
      assign: assignBy(ITEMS_VALVE, (it) => (it.no <= 4 ? 'M' : '-')), reportTplId: 'rt-ipqc-a', createdBy: 'u2', updatedAt: daysAgo(15), approvedBy: 'u3' },
    { id: 'pl3', code: 'PL-018-PRC', name: '01系列轴 · 首件、过程与完工方案', partId: 'p2', rev: 1, status: 'effective', stdId: 's2', scenes: ['FIRST', 'IPQC', 'FQC'],
      groups: [{ key: 'M', type: 'measure', name: '计量组', n: 3 }],
      assign: assignBy(ITEMS_SHAFT, () => 'M'), reportTplId: 'rt-fai', createdBy: 'u2', updatedAt: daysAgo(9), approvedBy: 'u3' },
    { id: 'pl4', code: 'PL-092-OUT', name: 'CP钻头组件 · 完工与出货方案', partId: 'p3', rev: 1, status: 'effective', stdId: 's3', scenes: ['FQC', 'OQC'],
      groups: [{ key: 'M', type: 'measure', name: '计量组', n: 5 }, { key: 'C', type: 'count', name: '计数组', n: 50, ac: 1, re: 2, aql: '1.0', lotRef: 500, earlyReject: true }],
      assign: assignBy(ITEMS_DRILL, (it) => (it.kind === 'count' ? 'C' : 'M')), reportTplId: 'rt-oqc', createdBy: 'u2', updatedAt: daysAgo(6), approvedBy: 'u3' },
  ];
  const planTemplates = [
    { id: 'tp1', code: 'TPL-01', name: '通用机加件 · 计量 n=5 + 外观 AQL 1.0', desc: '外观、螺纹类特性进计数组，其余进计量组；适用来料与完工检验', scenes: ['IQC', 'FQC'],
      groups: [{ key: 'M', type: 'measure', name: '计量组', n: 5 }, { key: 'C', type: 'count', name: '计数组', n: 125, ac: 3, re: 4, aql: '1.0', lotRef: 1241, earlyReject: true }],
      rules: { 外观: 'C', 螺纹: 'C', '*': 'M' }, ruleBy: 'cat', reportTplId: 'rt-bubble', usedBy: 1, updatedAt: daysAgo(40) },
    { id: 'tp2', code: 'TPL-02', name: '首件确认 · 关键特性 n=3', desc: '只把 CTQ、CC 特性放进计量组，用于开工、换型首件', scenes: ['FIRST'],
      groups: [{ key: 'M', type: 'measure', name: '计量组', n: 3 }], rules: { CTQ: 'M', CC: 'M', '*': '-' }, ruleBy: 'cls', reportTplId: 'rt-fai', usedBy: 0, updatedAt: daysAgo(22) },
  ];
  const scenes = [
    { code: 'IQC', name: '来料检验', en: 'IQC', ver: 2, desc: '采购件、外协回厂件的到货检验', ctx: ['supplier', 'receipt', 'batch'], steps: ['basis', 'sampling', 'measure', 'import', 'photo', 'check', 'judge', 'sign', 'report'], photo: 'onDefect', review: 'never', allowInsufficient: true, enabled: true },
    { code: 'FIRST', name: '生产首件', en: 'FAI', ver: 1, desc: '开工、换型、换刀后的首件确认；按方案取样，不强制一件', ctx: ['wo', 'op', 'machine'], steps: ['basis', 'sampling', 'measure', 'import', 'photo', 'check', 'judge', 'sign', 'report', 'review'], photo: 'appearance', review: 'always', allowInsufficient: true, enabled: true },
    { code: 'IPQC', name: '过程检验', en: 'IPQC', ver: 1, desc: '按工序与频次巡检，发现异常及时登记', ctx: ['wo', 'op', 'freq'], steps: ['basis', 'sampling', 'measure', 'photo', 'check', 'judge', 'sign', 'report'], photo: 'onDefect', review: 'never', allowInsufficient: true, enabled: true },
    { code: 'FQC', name: '完工检验', en: 'FQC', ver: 1, desc: '完工入库前检验', ctx: ['wo', 'batch'], steps: ['basis', 'sampling', 'measure', 'import', 'photo', 'check', 'judge', 'sign', 'report'], photo: 'appearance', review: 'never', allowInsufficient: true, enabled: true },
    { code: 'OQC', name: '出货检验', en: 'OQC', ver: 1, desc: '发货前检验；合格证明只在合同要求时附带', ctx: ['customer', 'shipment', 'batch'], steps: ['basis', 'sampling', 'measure', 'photo', 'check', 'judge', 'sign', 'report', 'review'], photo: 'appearance', review: 'always', allowInsufficient: true, enabled: true },
  ];
  const reportTemplates = [
    { id: 'rt-bubble', name: '气泡对照检验报告（QMS 内置）', src: 'QMS', file: '—', withDrawing: true, status: 'enabled', updatedAt: daysAgo(20) },
    { id: 'rt-iqc', name: '来料检验报告（QMS 内置）', src: 'QMS', file: '—', withDrawing: false, status: 'enabled', updatedAt: daysAgo(20) },
    { id: 'rt-fai', name: '首件检验报告（系统）', src: '气泡软件', file: '首件检验记录表2026.xlsx', withDrawing: false, status: 'enabled', updatedAt: '2026-10-14T05:48:00Z' },
    { id: 'rt-ipqc-a', name: '制程巡检报告-A班（系统）', src: '气泡软件', file: 'new制程巡检报告（填写样板）.xlsx', withDrawing: false, status: 'enabled', updatedAt: '2026-10-14T05:47:00Z' },
    { id: 'rt-ipqc-n', name: '制程巡检报告-夜班（系统）', src: '气泡软件', file: 'new制程巡检报告（填写样板）.xlsx', withDrawing: false, status: 'enabled', updatedAt: '2026-10-14T05:45:00Z' },
    { id: 'rt-oqc', name: '出货报告模版（系统）', src: '气泡软件', file: '出货报告模版1.xlsx', withDrawing: false, status: 'enabled', updatedAt: '2026-10-26T02:10:00Z' },
    { id: 'rt-all', name: '全制程检验模版（系统）', src: '气泡软件', file: '全制程检验模版.xlsx', withDrawing: false, status: 'enabled', updatedAt: '2026-10-14T05:40:00Z' },
  ];

  /* —— 任务、轮次与报告 —— */
  const S0 = { parts, standards, scenes };
  const tasks = [], reports = [];
  const nameOf = (uid) => users.find((u) => u.id === uid).name;
  const mkTask = (o) => {
    const plan = plans.find((p) => p.id === o.planId);
    const t = { id: o.id, code: o.code, scene: o.scene, partId: plan.partId, planId: plan.id, lot: o.lot || 0, ctx: o.ctx || {}, assignee: o.assignee || 'u1', due: o.due || hoursFromNow(6), status: 'pending', rounds: [], reportIds: [], createdAt: o.createdAt || daysAgo(0, 8), createdBy: 'u2' };
    t.snap = buildSnapshot(S0, plan, o.scene);
    t.rounds.push(newRound(t, 1));
    tasks.push(t);
    return t;
  };
  const fill = (t, vals, cnt, d) => {
    const r = t.rounds[t.rounds.length - 1];
    Object.keys(vals || {}).forEach((no) => { const it = t.snap.items.find((x) => x.no === +no); if (it && r.vals[it.cid]) vals[no].forEach((v, i) => { if (i < r.vals[it.cid].length) r.vals[it.cid][i] = v; }); });
    Object.keys(cnt || {}).forEach((no) => { const it = t.snap.items.find((x) => x.no === +no); if (it && r.cnt[it.cid]) r.cnt[it.cid].bad = cnt[no]; });
    if (d != null) r.dUnits = d;
    return r;
  };
  const submit = (t, signer, at, reviewer) => {
    const r = t.rounds[t.rounds.length - 1];
    const ev = evalRound(t, r);
    r.status = 'submitted'; r.submittedAt = at; r.result = summarizeEval(ev);
    t.status = ev.overall === 'fail' ? 'fail' : ev.overall === 'pass' ? 'pass' : 'insufficient';
    const rep = buildReport(S0, t, r);
    rep.createdAt = at;
    r.signer = { uid: signer, name: nameOf(signer), img: demoSignature(nameOf(signer)), at, hash: rep.hash };
    rep.sigs.push(Object.assign({ kind: '检验' }, r.signer));
    const sc = t.snap.scene;
    const needReview = sc.steps.includes('review') && (sc.review === 'always' || (sc.review === 'onFail' && t.status === 'fail'));
    rep.state = needReview ? 'review' : 'frozen';
    if (reviewer && needReview) { rep.state = 'approved'; rep.sigs.push({ kind: '复核', uid: reviewer, name: nameOf(reviewer), img: demoSignature(nameOf(reviewer)), at, hash: rep.hash }); }
    reports.push(rep); t.reportIds.push(rep.id);
    return rep;
  };
  const yesterday = new Date(Date.now() - 864e5), twoDaysAgo = new Date(Date.now() - 2 * 864e5);

  const t1 = mkTask({ id: 't1', code: 'IQC-' + dateCode() + '-001', scene: 'IQC', planId: 'pl1', lot: 1241, assignee: 'u1', due: hoursFromNow(2), ctx: { supplier: '华研精密（示例）', receipt: 'IR2206108AA8LF', batch: dateCode() + '-A' } });
  fill(t1, { 1: ['20.12', '20.00', '20.02', '20.01', ''], 2: ['11.98', '12.02', '11.99', '12.00', '12.01'], 3: ['36.02', '36.00', '36.02', '35.98', '36.01'], 4: ['25.05', '25.06', '25.06', '25.08', ''], 5: ['0.365', '0.359', '0.345', '', ''], 6: ['665002', '652623', '651452', '', ''], 7: ['2092', '2077', '2069', '', ''] }, { 8: '0', 9: '1' });
  t1.status = 'active';

  mkTask({ id: 't2', code: 'FAI-' + dateCode() + '-001', scene: 'FIRST', planId: 'pl3', assignee: 'u1', due: hoursFromNow(1), ctx: { wo: 'WO-2611-018', op: '40 精车', machine: 'CNC-03' } });

  const t3 = mkTask({ id: 't3', code: 'OQC-' + dateCode(yesterday) + '-002', scene: 'OQC', planId: 'pl4', lot: 500, assignee: 'u7', createdAt: daysAgo(1, 9), ctx: { customer: '锐驰装备（示例）', shipment: 'DN-2611-007', batch: dateCode(yesterday) + '-D1' } });
  fill(t3, { 1: ['10.00', '10.01', '9.99', '10.02', '10.00'], 2: ['61.8', '62.1', '62.0', '62.4', '61.9'], 3: ['0.011', '0.012', '0.009', '0.013', '0.010'] }, { 4: '0', 5: '0' }, '0');
  submit(t3, 'u7', daysAgo(1, 15, 20), 'u3');

  const t4 = mkTask({ id: 't4', code: 'IPQC-' + dateCode(yesterday) + '-004', scene: 'IPQC', planId: 'pl2', assignee: 'u1', createdAt: daysAgo(1, 10), ctx: { wo: 'WO-2611-011', op: '20 精车', freq: '每 2 小时' } });
  fill(t4, { 1: ['20.11', '20.09', '20.06'], 2: ['12.01', '12.00', '11.99'], 3: ['36.01', '36.03', '36.00'], 4: ['25.07', '25.06', '25.08'] });
  submit(t4, 'u1', daysAgo(1, 10, 40));

  mkTask({ id: 't5', code: 'FQC-' + dateCode() + '-003', scene: 'FQC', planId: 'pl4', lot: 500, assignee: 'u7', due: hoursFromNow(5), ctx: { wo: 'WO-2611-092', batch: dateCode() + '-F2' } });

  const t6 = mkTask({ id: 't6', code: 'IQC-' + dateCode(twoDaysAgo) + '-006', scene: 'IQC', planId: 'pl1', lot: 1241, assignee: 'u7', createdAt: daysAgo(2, 9), ctx: { supplier: '华研精密（示例）', receipt: 'IR2206100B71KQ', batch: dateCode(twoDaysAgo) + '-B' } });
  fill(t6, { 1: ['20.02', '20.00', '19.98', '20.03', '20.01'], 2: ['12.00', '12.01', '11.99', '12.02', '12.00'], 3: ['36.00', '36.02', '35.99', '36.01', '36.00'], 4: ['25.07', '25.08', '25.06', '25.07', '25.09'], 5: ['0.372', '0.368', '0.381', '0.366', '0.370'], 6: ['661000', '658200', '667400', '659900', '662300'], 7: ['2110', '2096', '2121', '2104', '2099'] }, { 8: '0', 9: '1', 10: '0' }, '1');
  submit(t6, 'u7', daysAgo(2, 14, 5));

  mkTask({ id: 't7', code: 'FAI-' + dateCode() + '-002', scene: 'FIRST', planId: 'pl2', assignee: 'u7', due: hoursFromNow(3), ctx: { wo: 'WO-2611-021', op: '20 精车', machine: 'CNC-02' } });

  /* —— NCR 与质量限制 —— */
  const ncrs = [
    { id: 'n3', code: 'NCR-2026-0013', title: '外协回厂包装破损 · 刃口磕碰', severity: '一般', status: 'registered', partId: 'p3', batch: dateCode() + '-R1', taskId: '', roundId: '', cids: ['CH-092-05'],
      desc: '收货时发现 2 箱外包装破损，抽查 10 件中 2 件刃口有磕碰痕迹。', qtySuspect: 200, qtyConfirmed: 0, createdBy: 'u1', createdAt: daysAgo(0, 9, 30), photos: [], disp: [], holds: [],
      log: [{ at: daysAgo(0, 9, 30), by: 'u1', text: '登记不合格（现场发现）' }] },
    { id: 'n1', code: 'NCR-2026-0012', title: '01系列阀芯 1-1 轴直径超上限（巡检）', severity: '一般', status: 'disposing', partId: 'p1', batch: 'WO-2611-011', taskId: 't4', roundId: t4.rounds[0].id, cids: ['CH-011-01'],
      desc: '过程巡检第 1 件实测 Ø20.11，超出上限 20.10；追溯本班已加工 120 件，隔离待挑选。', qtySuspect: 120, qtyConfirmed: 36, createdBy: 'u1', createdAt: daysAgo(1, 10, 45), photos: [],
      disp: [{ id: 'd1', qty: 30, action: '返工', reason: '刀补校正后重车外径', by: 'u4', approved: false, executed: false }, { id: 'd2', qty: 6, action: '报废', reason: '余量不足无法返工', by: 'u2', approved: false, executed: false }],
      holds: [{ id: 'h1', scopeType: '工单', scopeVal: 'WO-2611-011', actions: ['use', 'ship'], status: 'active', by: 'u2', at: daysAgo(1, 11) }],
      log: [{ at: daysAgo(1, 10, 45), by: 'u1', text: '登记不合格（来源：' + t4.code + ' 第 1 轮）' }, { at: daysAgo(1, 11), by: 'u2', text: '确认范围：可疑 120 件，确认不合格 36 件' }, { at: daysAgo(1, 11, 2), by: 'u2', text: '建立质量限制（工单 WO-2611-011）：禁止使用、发运' }, { at: daysAgo(1, 13), by: 'u4', text: '提出处置建议：返工 30 件（刀补校正后重车外径）' }, { at: daysAgo(1, 13, 20), by: 'u2', text: '提出处置建议：报废 6 件（余量不足无法返工）' }, { at: daysAgo(1, 13, 25), by: 'u2', text: '提交 MRB 评审：返工 30，报废 6' }] },
    { id: 'n2', code: 'NCR-2026-0009', title: '01系列轴 同轴度临界超差', severity: '轻微', status: 'closed', partId: 'p2', batch: '20261102-C', taskId: '', roundId: '', cids: ['CH-018-03'],
      desc: '同轴度实测 0.026，超出 0.025；客户书面同意让步接收本批。', qtySuspect: 1, qtyConfirmed: 1, createdBy: 'u2', createdAt: daysAgo(14), photos: [],
      disp: [{ id: 'd3', qty: 1, action: '让步接收', reason: '客户书面同意（附件 CC-2611-02）', by: 'u2', approved: true, approvedBy: 'u3', approvedAt: daysAgo(13), executed: true, executedBy: 'u2', executedAt: daysAgo(12, 15), evidence: '随货附让步单' }], holds: [],
      log: [{ at: daysAgo(14), by: 'u2', text: '登记不合格（现场发现）' }, { at: daysAgo(14, 10), by: 'u2', text: '确认范围：可疑 1 件，确认不合格 1 件' }, { at: daysAgo(13), by: 'u3', text: '批准处置：让步接收 1 件' }, { at: daysAgo(12, 15), by: 'u2', text: '登记执行：让步接收 1 件（随货附让步单）' }, { at: daysAgo(12, 16), by: 'u3', text: '验证通过并关闭：让步单已归档' }] },
  ];

  /* —— 气泡同步收件箱（来自 Worlder 气泡图的冻结结果） —— */
  const valveA4 = clone(ITEMS_VALVE);
  valveA4[3].lsl = '25.04';
  valveA4.push(Object.assign({}, valveA4[1], { cid: 'CH-011-11', no: 11, name: '倒角 C0.5', cat: '倒角', sym: '', nominal: '0.5', upper: '+0.1', lower: '-0.1', lsl: '0.4', usl: '0.6', gauge: '', cls: '一般', x: 128, y: 318 }));
  const syncInbox = [
    { id: 'sy1', syncBatchId: 'SYNC-9107', drawingNo: 'DWG-2026-011', drawingRev: 'A4', partId: 'p1', at: daysAgo(0, 8, 12), by: '气泡软件 · 吴清阳', items: valveA4, contentHash: hashOf(valveA4), status: 'pending', stdId: '' },
  ];

  const audit = [
    { at: daysAgo(0, 9, 30), uid: 'u1', act: 'NCR', obj: 'NCR-2026-0013', text: '登记不合格：外协回厂包装破损 · 刃口磕碰' },
    { at: daysAgo(0, 8, 12), uid: 'u2', act: '集成', obj: 'SYNC-9107', text: '收到气泡软件冻结结果 DWG-2026-011 Rev A4（11 个气泡）' },
    { at: daysAgo(1, 15, 20), uid: 'u3', act: '报告', obj: 'RPT-' + t3.code, text: '复核通过并签批' },
    { at: daysAgo(1, 11, 2), uid: 'u2', act: 'NCR', obj: 'NCR-2026-0012', text: '建立质量限制（工单 WO-2611-011）：禁止使用、发运' },
    { at: daysAgo(1, 10, 45), uid: 'u1', act: 'NCR', obj: 'NCR-2026-0012', text: '登记不合格：01系列阀芯 1-1 轴直径超上限（巡检）' },
    { at: daysAgo(1, 10, 40), uid: 'u1', act: '检验', obj: t4.code, text: '签名提交第 1 轮：不符合；报告 RPT-' + t4.code + ' 已冻结' },
    { at: daysAgo(8), uid: 'u3', act: '方案', obj: 'PL-011-IQC Rev 2', text: '批准生效（引用 STD-011 Rev A）' },
    { at: daysAgo(18), uid: 'u3', act: '标准', obj: 'STD-011 Rev A', text: '批准生效' },
    { at: daysAgo(20), uid: 'u2', act: '标准', obj: 'STD-011 Rev A', text: '由气泡同步 SYNC-9081 生成标准草稿' },
  ];

  return {
    v: 1, seq: 100, me: 'u2', users, gauges, routeTemplates, parts, standards, plans, planTemplates, scenes, reportTemplates, tasks, reports, ncrs, syncInbox, audit, rd: [],
    suppliers: ['华研精密（示例）', '东辰表面处理（示例）', '恒科五金（示例）'],
    customers: ['北辰动力（示例）', '锐驰装备（示例）'],
    settings: { bubbleBase: 'http://localhost:3080', allowedOrigins: 'http://localhost:3080, http://127.0.0.1:3080', handshakeTimeout: 6, company: '示例精密制造有限公司', bubbleV2: true },
    dwgImages: {}, syncSeq: 0,
    weekly: [[36, 2, 1], [41, 3, 0], [38, 1, 1], [44, 4, 1], [40, 2, 0], [47, 3, 2], [43, 2, 1], [45, 1, 0]],
    defectHistory: { 'CH-011-01': 19, 'CH-011-05': 12, 'CH-011-08': 8, 'CH-011-09': 5, 'CH-018-03': 2, 'CH-092-05': 3 },
  };
}

/* ---------------- 全局状态（localStorage 持久化） ---------------- */
const requestedCase = new URLSearchParams(location.search).get('exercise');
const liveHandoff = document.querySelector('meta[name="qms-handoff"]') !== null || new URLSearchParams(location.search).get('live') === '1';
const practiceCase = !liveHandoff && ['measure', 'approve', 'ship'].includes(requestedCase) ? requestedCase : null;
const practiceParams = new URLSearchParams(location.search);
const mobilePracticeHost = practiceCase && practiceParams.get('returnView') === 'mobile' && !practiceParams.has('practicePane') && window.matchMedia('(min-width: 721px) and (pointer: fine)').matches;
const LS_KEY = liveHandoff ? 'worlder-workorder-handoff-v1' : practiceCase ? 'worlder-tour-practice-v1-' + practiceCase : 'worlder-qms-proto-v1';
function demoStorage() { return liveHandoff || practiceCase ? sessionStorage : localStorage; }
function loadState() {
  try { const raw = demoStorage().getItem(LS_KEY); if (!raw) return null; const s = JSON.parse(raw); return s && s.v === 1 && Array.isArray(s.tasks) ? s : null; }
  catch (e) { return null; }
}
const S = reactive(loadState() || seed());
let saveTimer = null, quotaWarned = false;
function persistDemo() {
  clearTimeout(saveTimer); saveTimer = null;
  if (mobilePracticeHost) return true; // 只由内层实际操作页面保存练习进度。
  try { demoStorage().setItem(LS_KEY, JSON.stringify(S)); return true; }
  catch (e) { if (!quotaWarned) { quotaWarned = true; toast('本机存储不可用，本次改动仅保留在当前页面。', 'warn'); } return false; }
}
watch(() => S, () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistDemo, 400);
}, { deep: true });
// 离开页面时把刚输入的读数和建单结果一起落盘。
function flushPendingDemo() { if (saveTimer !== null) persistDemo(); }
window.addEventListener('pagehide', flushPendingDemo);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPendingDemo(); });
/* 升级旧的演示数据：自研气泡识别软件（04_气泡识别软件，node server.mjs）成为默认对接对象；原来的外部地址保留在白名单里，可在“集成设置”切回 */
if (!S.settings.bubbleV2) {
  if (S.settings.bubbleBase === 'https://223.106.198.62:3080') S.settings.bubbleBase = 'http://localhost:3080';
  const ol = String(S.settings.allowedOrigins || '').split(/[\s,;]+/).filter(Boolean);
  ['http://localhost:3080', 'http://127.0.0.1:3080'].forEach((o) => { if (ol.indexOf(o) < 0) ol.push(o); });
  S.settings.allowedOrigins = ol.join(', ');
  S.settings.bubbleV2 = true;
}
if (!S.dwgImages || typeof S.dwgImages !== 'object') S.dwgImages = {};
if (typeof S.syncSeq !== 'number') S.syncSeq = 0;
const INSPECT_POSITION_KEY = 'wqms-inspect-positions-v1' + (practiceCase ? '-' + practiceCase : '');
function resetDemo() { clearTimeout(saveTimer); saveTimer = null; try { demoStorage().removeItem(INSPECT_POSITION_KEY); demoStorage().removeItem(LS_KEY); } catch (e) { /* 忽略 */ } location.hash = practiceCase ? '#' + TOUR_CASES[practiceCase].path : '#/workbench'; location.reload(); }

/* ---------------- 界面状态 ---------------- */
const UI = reactive({
  route: { path: '/workbench', name: 'workbench', params: {}, query: {} },
  sidebar: true, mobileNav: false, extOpen: false, moreOpen: false,
  newTaskMode: 'wizard',
  palette: false, toasts: [], confirm: null, lightbox: null, roleMenu: false, notif: false,
  newTask: null, orderLot: null, newNcr: null, newOrder: false, release: null,
  work: null, setup: null, scan: false, // 报工 / 登记首件触发 / 扫码 弹窗
  flowAct: null, // 顶部流程条在检验页内点了哪一步：{ key, at }，由检验执行页接住并定位
  bubble: { route: 'drawings', status: 'idle', lastMsg: null, reloadKey: 0 },
});
try { UI.sidebar = demoStorage().getItem('wqms-sidebar') !== 'mini'; } catch (e) { /* 忽略 */ }
watch(() => UI.sidebar, (v) => { try { demoStorage().setItem('wqms-sidebar', v ? 'full' : 'mini'); } catch (e) { /* 忽略 */ } });

let toastSeq = 0;
function toast(msg, type) {
  const id = ++toastSeq;
  UI.toasts.push({ id, msg, type: type || 'info' });
  setTimeout(() => { const i = UI.toasts.findIndex((t) => t.id === id); if (i >= 0) UI.toasts.splice(i, 1); }, 3800);
}
function confirmBox(opts) { return new Promise((resolve) => { UI.confirm = Object.assign({ title: '确认操作', message: '', ok: '确定', cancel: '取消', danger: false }, opts, { resolve }); }); }

/* ---------------- 当前身份与权限 ---------------- */
const me = computed(() => S.users.find((u) => u.id === S.me) || S.users[0]);
function can(perm) { const p = PERMS[perm]; return !!p && p.roles.includes(me.value.role); }
function denyTip(perm) {
  const p = PERMS[perm]; if (!p) return '';
  return '当前身份“' + ROLES[me.value.role].name + '”无权限：' + p.label + '（需 ' + p.roles.map((r) => ROLES[r].name).join(' / ') + '）';
}
function userName(id) { const u = S.users.find((x) => x.id === id); return u ? u.name : (id || '—'); }
function logAudit(act, obj, text) { S.audit.unshift({ at: nowISO(), uid: S.me, act, obj, text }); }
function nextSeq() { S.seq += 1; return S.seq; }

/* ---------------- 查询助手 ---------------- */
const partOf = (id) => S.parts.find((p) => p.id === id) || {};
const stdOf = (id) => S.standards.find((s) => s.id === id) || null;
const planOf = (id) => S.plans.find((p) => p.id === id) || null;
const taskOf = (id) => S.tasks.find((t) => t.id === id) || null;
const sceneOf = (code) => S.scenes.find((s) => s.code === code) || {};
const gaugeOf = (id) => S.gauges.find((g) => g.id === id) || null;
const tplOf = (id) => S.reportTemplates.find((t) => t.id === id) || null;
function effectiveStd(partId) { return S.standards.filter((s) => s.partId === partId && s.status === 'effective').sort((a, b) => (a.rev < b.rev ? 1 : -1))[0] || null; }
function gaugeLabel(id) { const g = gaugeOf(id); return g ? g.name + (g.alias ? '（' + g.alias + '）' : '') : '未指定'; }
function recommendGauge(cat) { const g = S.gauges.find((x) => x.cats.includes(cat)); return g ? g.id : ''; }
function holdsActive() { const out = []; S.ncrs.forEach((n) => n.holds.forEach((x) => { if (x.status === 'active') out.push(Object.assign({ ncr: n }, x)); })); return out; }

/* ---------------- 路由（hash） ---------------- */
const ROUTES = [
  ['/demo', 'order-tour'], ['/demo/:device', 'order-tour'],
  ['/workbench', 'workbench'], ['/dashboard', 'dashboard'], ['/orders', 'orders'], ['/orders/:id', 'order'], ['/orders/:id/card', 'traveler'],
  ['/floor', 'floor'], ['/trace', 'trace'], ['/scan/:code', 'scan'], ['/bubble', 'bubble'], ['/standards', 'standards'], ['/standards/:id', 'standard'], ['/plans', 'plans'], ['/plans/:id', 'plan'],
  ['/tasks', 'tasks'], ['/tasks/:scene', 'tasks'], ['/inspect/:id', 'inspect'], ['/reports', 'reports'], ['/reports/:id', 'report'], ['/report-templates', 'rtpl'],
  ['/ncr', 'ncrs'], ['/ncr/:id', 'ncr'], ['/parts', 'parts'], ['/routes', 'routes'], ['/scenes', 'scenes'], ['/gauges', 'gauges'],
  ['/users', 'users'], ['/audit', 'audit'], ['/settings', 'settings'], ['/rd', 'rd'], ['/ext/:key', 'ext'],
];
function parseHash() {
  const raw = (location.hash || '#/workbench').slice(1);
  const cut = raw.indexOf('?');
  const path = cut >= 0 ? raw.slice(0, cut) : raw;
  const query = {};
  new URLSearchParams(cut >= 0 ? raw.slice(cut + 1) : '').forEach((v, k) => { query[k] = v; });
  const segs = path.split('/').filter(Boolean);
  for (const r of ROUTES) {
    const ps = r[0].split('/').filter(Boolean);
    if (ps.length !== segs.length) continue;
    const params = {}; let ok = true;
    ps.forEach((p, i) => { if (p[0] === ':') params[p.slice(1)] = decodeURIComponent(segs[i]); else if (p !== segs[i]) ok = false; });
    if (ok) return { path: '/' + segs.join('/'), name: r[1], params, query };
  }
  return { path: '/workbench', name: 'workbench', params: {}, query: {} };
}
function go(path) { if ('#' + path === location.hash) return; location.hash = '#' + path; }

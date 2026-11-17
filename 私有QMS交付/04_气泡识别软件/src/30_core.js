/* =====================================================================
 * 应用核心：状态、服务端接口、路由、提示框、与 QMS 的浏览器消息（PRD §7.1）
 * ===================================================================== */
const { createApp, reactive, ref, computed, watch, nextTick, onMounted, onBeforeUnmount, h, markRaw } = Vue;

const APP_VERSION = '0.1.0';
const API_BASE = '/api/v1';

const S = reactive({
  online: false, booted: false, bootError: '',
  drawings: [],
  settings: { qmsOrigins: [], defaultGeneralTol: 'm', ocrLangs: 'eng+chi_sim', renderWidth: 2200, ocrMode: 'auto', localUser: '本机用户' },
  server: { name: '', version: '', dataDir: '', qmsUrl: '' },
});
const UI = reactive({
  route: { path: '/drawings', name: 'drawings', params: {}, query: {} },
  toasts: [], confirm: null, upload: null, busy: null,
  embedded: window.parent !== window,
  qms: { origin: '', handshake: false, user: '', role: '', log: [] },
});

/* ---------------- 小工具 ---------------- */
const clone = (o) => JSON.parse(JSON.stringify(o));
const pad2 = (n) => String(n).padStart(2, '0');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function fmtTime(iso) { if (!iso) return '—'; const d = new Date(iso); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function fmtRel(iso) {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  if (s < 86400 * 7) return Math.floor(s / 86400) + ' 天前';
  return fmtTime(iso).slice(0, 10);
}
function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
function debounce(fn, ms) { let t = null; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.flush = (...a) => { clearTimeout(t); return fn(...a); }; f.cancel = () => clearTimeout(t); return f; }
function meName() { return UI.qms.user || S.settings.localUser || '本机用户'; }

/* ---------------- 服务端接口 ---------------- */
async function api(method, path, body) {
  let res;
  try {
    res = await fetch(API_BASE + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    S.online = false;
    throw new Error('连接不到气泡识别服务：请确认已用 node server.mjs 启动，并通过 http:// 地址打开本页面');
  }
  S.online = true;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  if (!res.ok) {
    const err = new Error((data && data.error && data.error.message) || '服务返回错误 HTTP ' + res.status);
    err.code = data && data.error ? data.error.code : ''; err.status = res.status;
    throw err;
  }
  return data;
}
async function refreshDrawings() { const r = await api('GET', '/drawings'); S.drawings = r.items || []; return S.drawings; }

/* ---------------- 提示与确认 ---------------- */
let toastSeq = 0;
function toast(msg, type) {
  const id = ++toastSeq;
  UI.toasts.push({ id, msg, type: type || 'info' });
  setTimeout(() => { const i = UI.toasts.findIndex((t) => t.id === id); if (i >= 0) UI.toasts.splice(i, 1); }, type === 'error' ? 6000 : 3800);
}
function confirmBox(o) { return new Promise((resolve) => { UI.confirm = Object.assign({ title: '确认', message: '', ok: '确定', cancel: '取消', danger: false }, o, { resolve }); }); }

/* ---------------- 路由（hash） ---------------- */
const ROUTES = [
  ['/drawings', 'drawings'], ['/annotate/:id/:rev', 'annotate'], ['/annotate/:id', 'annotate'],
  ['/compare', 'compare'], ['/compare/:id', 'compare'], ['/similar', 'similar'], ['/similar/:id', 'similar'],
  ['/tolerances', 'tolerances'], ['/settings', 'settings'],
];
/* QMS 顶部入口使用的页面名（兼容 Worlder 气泡图原来的路由名） */
const ROUTE_ALIAS = {
  'drawing-packages': '/drawings', 'drawing-management': '/drawings', 'drawing-datasets': '/drawings', drawings: '/drawings',
  'drawing-compare': '/compare', compare: '/compare', 'drawing-search': '/similar', similar: '/similar', tolerances: '/tolerances', settings: '/settings',
};
function parseHash() {
  const raw = (location.hash || '#/drawings').slice(1);
  const cut = raw.indexOf('?');
  let path = cut >= 0 ? raw.slice(0, cut) : raw;
  const query = {};
  new URLSearchParams(cut >= 0 ? raw.slice(cut + 1) : '').forEach((v, k) => { query[k] = v; });
  const alias = ROUTE_ALIAS[path.replace(/^\//, '')];
  if (alias) path = alias;
  const segs = path.split('/').filter(Boolean);
  for (const r of ROUTES) {
    const ps = r[0].split('/').filter(Boolean);
    if (ps.length !== segs.length) continue;
    const params = {}; let ok = true;
    ps.forEach((p, i) => { if (p[0] === ':') params[p.slice(1)] = decodeURIComponent(segs[i]); else if (p !== segs[i]) ok = false; });
    if (ok) return { path: '/' + segs.join('/'), name: r[1], params, query };
  }
  return { path: '/drawings', name: 'drawings', params: {}, query: {} };
}
function go(path) { if ('#' + path === location.hash) return; location.hash = '#' + path; }

/* ---------------- 与 QMS 的浏览器消息：只做通知，双方都校验来源 ---------------- */
function qmsAllowed(origin) { return (S.settings.qmsOrigins || []).indexOf(origin) >= 0; }
function logQms(dir, type, payload) {
  UI.qms.log.unshift({ dir, type, at: new Date().toISOString(), text: JSON.stringify(payload || {}).slice(0, 180) });
  if (UI.qms.log.length > 30) UI.qms.log.length = 30;
}
function postToQms(type, payload) {
  if (!UI.embedded) return false;
  const msg = { type, version: 1, requestId: 'rq-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), payload: payload || {} };
  const targets = UI.qms.origin ? [UI.qms.origin] : (S.settings.qmsOrigins || []);
  targets.forEach((o) => { try { window.parent.postMessage(msg, o); } catch (e) { /* 白名单里的地址格式不对时忽略 */ } });
  logQms('out', type, payload);
  return targets.length > 0;
}
function onQmsMessage(e) {
  if (!qmsAllowed(e.origin)) return;
  const d = e.data;
  if (!d || typeof d !== 'object' || typeof d.type !== 'string' || d.type.indexOf('qms.') !== 0) return;
  const p = d.payload && typeof d.payload === 'object' ? d.payload : d;
  UI.qms.origin = e.origin; UI.qms.handshake = true;
  logQms('in', d.type, p);
  if (d.type === 'qms.context') { UI.qms.user = String(p.user || ''); UI.qms.role = String(p.role || ''); }
  else if (d.type === 'qms.navigate' && typeof p.route === 'string') {
    const r = p.route.replace(/^#?\/?/, '');
    go(ROUTE_ALIAS[r] || '/' + r);
  }
}

/* ---------------- 图纸、版本、特性 ---------------- */
const REV_STATUS = { new: ['待识别', 'chip-gray'], review: ['待校核', 'chip-amber'], frozen: ['已冻结', 'chip-green'] };
const TOL_SOURCE = { explicit: ['图面标注', 'chip-gray'], limits: ['极限尺寸', 'chip-gray'], fit: ['配合查表', 'chip-blue'], general: ['未注公差', 'chip-amber'], single: ['单侧要求', 'chip-gray'], none: ['缺公差', 'chip-red'], manual: ['手工填写', 'chip-violet'] };
const CLS_META = { CTQ: ['CTQ 关键', 'chip-red'], CC: ['CC 重要', 'chip-amber'], 一般: ['一般', 'chip-gray'] };
const SRC_META = { vector: '矢量文字', ocr: 'OCR', manual: '手工', note: '技术要求' };

function revOf(d, revId) { return d && d.revisions ? d.revisions.find((r) => r.id === revId) || null : null; }
function latestRev(d) { return d && d.revisions && d.revisions.length ? d.revisions[d.revisions.length - 1] : null; }
function lastFrozenBefore(d, rev) {
  if (!d || !rev) return null;
  const i = d.revisions.findIndex((r) => r.id === rev.id);
  for (let k = i - 1; k >= 0; k--) if (d.revisions[k].status === 'frozen') return d.revisions[k];
  return null;
}
/** 特性 ID：CH-<图号末三位>-<四位序号>，同一图纸的所有版本共用一个序号池，删掉的号不再复用 */
function cidTail(drawingNo) { const t = String(drawingNo || '').replace(/[^A-Za-z0-9]/g, ''); return (t.slice(-3) || 'X').toUpperCase(); }
function maxCidSeq(d) {
  let m = 0;
  ((d && d.revisions) || []).forEach((r) => (r.chars || []).forEach((c) => { const x = /-(\d{4,})$/.exec(c.cid || ''); if (x) m = Math.max(m, parseInt(x[1], 10)); }));
  return Math.max(m, (d && d.cidSeq) || 0);
}
function cidMaker(d) { let seq = maxCidSeq(d); const tail = cidTail(d && d.drawingNo); return () => { seq += 1; return 'CH-' + tail + '-' + String(seq).padStart(4, '0'); }; }

/** 识别结果（mkSpec）→ 保存用的特性记录 */
function specToChar(spec, extra) {
  return Object.assign({
    cid: '', no: 0, name: spec.name || '', cat: spec.cat || '其他', kind: spec.kind || 'measure', sym: spec.sym || '',
    nominal: spec.nominal || '', upper: spec.upper || '', lower: spec.lower || '', lsl: spec.lsl || '', usl: spec.usl || '', unit: spec.unit || '',
    qty: spec.qty || 1, fit: spec.fit || '', spec: spec.spec || '', gdt: spec.gdt || null, cls: spec.cls || '一般',
    tolSource: spec.tolSource || 'none', tolNote: spec.tolNote || '', conf: spec.conf == null ? 1 : spec.conf, review: !!spec.review, notes: spec.notes || [],
    sourceText: spec.text || '', src: 'vector', page: 1, anchor: null, balloon: null, clip: '', status: 'auto', note: '',
  }, extra || {});
}
/** 规格字段改动后重算上下限（十进制精确） */
function recomputeLimits(c) {
  if (c.kind === 'count' || c.cat === '形位公差' || c.cat === '表面粗糙度') return c;
  if (DEC_RE.test(c.nominal || '') && (c.upper || c.lower)) {
    const up = DEC_RE.test(c.upper || '') ? c.upper : '0', lo = DEC_RE.test(c.lower || '') ? c.lower : '0';
    c.usl = decAdd(c.nominal, up); c.lsl = decAdd(c.nominal, lo);
    if (decCmp(c.lsl, c.usl) > 0) { const x = c.lsl; c.lsl = c.usl; c.usl = x; }
  }
  return c;
}
function needsReview(c) { return c.status !== 'confirmed' && (c.review || c.conf < 0.85 || c.tolSource === 'none' || c.tolSource === 'fit' || c.tolSource === 'general'); }

/* =====================================================================
 * 识别引擎 · 规格解析（纯计算）
 *   把一条图面标注解析成特性字段：
 *   “Ø20±0.1”“20 +0.1/-0.05”“Ø80h7”“19.95~20.05”“R5”“C0.5”“45°±30′”“M8×1.25-6g”“Ra1.6”“⊥ 0.02 A”“HB 241~285”……
 *   技术要求条目另用 parseNote()：硬度、强度等范围要求 → 理化 / 功能特性；“不得有划伤” → 外观（计数）特性。
 * ===================================================================== */

const CATS = ['线性尺寸', '角度尺寸', '形位公差', '螺纹', '表面粗糙度', '倒角', '外观', '理化', '功能', '焊接', '其他'];
const GD_SYMS = { '⏤': '直线度', '⏥': '平面度', '▱': '平面度', '○': '圆度', '◯': '圆度', '⌭': '圆柱度', '⌒': '线轮廓度', '⌓': '面轮廓度', '⟂': '垂直度', '⊥': '垂直度', '∠': '倾斜度', '∥': '平行度', '//': '平行度', '⌖': '位置度', '⊕': '位置度', '◎': '同轴度', '⌯': '对称度', '↗': '圆跳动', '⌰': '全跳动' };
const GD_CANON = { '▱': '⏥', '◯': '○', '⟂': '⊥', '//': '∥', '⊕': '⌖' };
const GD_NAMES = { 直线度: '⏤', 平面度: '⏥', 圆柱度: '⌭', 圆度: '○', 线轮廓度: '⌒', 面轮廓度: '⌓', 垂直度: '⊥', 倾斜度: '∠', 平行度: '∥', 位置度: '⌖', 同轴度: '◎', 同心度: '◎', 对称度: '⌯', 径向圆跳动: '↗', 端面圆跳动: '↗', 圆跳动: '↗', 径向跳动: '↗', 端面跳动: '↗', 全跳动: '⌰' };
/* 形位公差符号选项（界面下拉用） */
const GD_OPTIONS = ['⏤', '⏥', '○', '⌭', '⌒', '⌓', '⊥', '∠', '∥', '⌖', '◎', '⌯', '↗', '⌰'];
const SYM_NAMES = { Ø: '直径', R: '半径', SR: '球半径', SØ: '球径', '□': '方形边长', '': '尺寸' };
const HARD_RE = 'HRC|HRB|HRA|HBW|HBS|HB|HV\\d*|HS|HRN\\d*';

/** 统一写法：全角转半角、各种直径符号统一为 Ø、AutoCAD 控制码、正负号、乘号、度分秒 */
function normText(raw) {
  let t = String(raw == null ? '' : raw);
  t = t.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ');
  t = t.replace(/[º˚]/g, '°').replace(/〜/g, '~');
  t = t.replace(/%%[cC]/g, 'Ø').replace(/%%[pP]/g, '±').replace(/%%[dD]/g, '°');
  t = t.replace(/[⌀∅ΦφϕØø]/g, 'Ø');
  t = t.replace(/[‐‑‒–—−﹣]/g, '-');
  t = t.replace(/\+\s*\/?\s*-(?=\s*\.?\d)/g, '±');
  t = t.replace(/(?<=[\d)])\s*[xX×✕*]\s*(?=[\d.ØRMC□S])/g, '×');
  t = t.replace(/(\d)\s*['’]/g, '$1′').replace(/(\d)\s*["”]/g, '$1″');
  return t.replace(/\s+/g, ' ').trim();
}
/** .02 → 0.02；+.5 → +0.5 */
function normNum(s) {
  const t = String(s == null ? '' : s).replace(/\s+/g, '');
  return t.replace(/^([+-]?)\./, '$10.');
}

function mkSpec(o) {
  return Object.assign({
    ok: true, cat: '线性尺寸', kind: 'measure', sym: '', name: '', nominal: '', upper: '', lower: '', lsl: '', usl: '', unit: 'mm',
    qty: 1, fit: '', spec: '', gdt: null, tolSource: 'none', tolNote: '', conf: 0.9, cls: '', review: false, notes: [], text: '',
  }, o);
}
/** 名义值 + 上下偏差 → 上下限（十进制精确） */
function applyTol(r, nominal, up, lo) {
  let u = normNum(up), l = normNum(lo);
  if (decCmp(u, l) < 0) { const x = u; u = l; l = x; }
  r.nominal = normNum(nominal); r.upper = decSigned(u); r.lower = decSigned(l);
  r.usl = decAdd(r.nominal, u); r.lsl = decAdd(r.nominal, l);
  return r;
}

/** 尺寸数字后面的公差部分：±0.1 / +0.1/-0.05 / 0/-0.1 / H7 / g6(-0.007/-0.020) / +0.1 */
function parseTolRest(rest) {
  const s = String(rest || '').trim();
  if (!s) return { kind: 'none' };
  let m = /^±\s*(\d*\.?\d+)$/.exec(s);
  if (m) return { kind: 'pm', up: '+' + normNum(m[1]), lo: '-' + normNum(m[1]) };
  m = /^(js|JS|[a-hjkmnp-zA-HJKMNP-Z])\s?(\d{1,2})(?:\s*\/\s*(?:js|[a-hjkmnp-z])\s?\d{1,2})?(?:\s*\(\s*([^)]*?)\s*\))?$/.exec(s);
  if (m) {
    const inner = m[3] ? parseTolRest(m[3]) : null;
    return { kind: 'fit', fit: m[1] + m[2], dev: inner && (inner.kind === 'dev' || inner.kind === 'pm' || inner.kind === 'single') ? inner : null };
  }
  m = /^([+-]?\s*\d*\.?\d+)\s*(?:\/|\s|;)\s*([+-]?\s*\d*\.?\d+)$/.exec(s);
  if (m) {
    const a = normNum(m[1]), b = normNum(m[2]);
    const signed = /^[+-]/.test(a) || /^[+-]/.test(b) || decIsZero(a) || decIsZero(b);
    if (signed) return { kind: 'dev', up: decMax(a, b), lo: decMin(a, b) };
  }
  m = /^([+-]\s*\d*\.?\d+)$/.exec(s);
  if (m) { const v = normNum(m[1]); return decCmp(v, '0') > 0 ? { kind: 'single', up: v, lo: '0' } : { kind: 'single', up: '0', lo: v }; }
  return { kind: 'bad', rest: s };
}

/* ---------------- 各类标注 ---------------- */
function matchGdt(t, base) {
  let s = t.replace(/[|｜]/g, ' ').replace(/\s+/g, ' ').trim();
  let sym = '', name = '';
  const byName = Object.keys(GD_NAMES).find((k) => s.indexOf(k) === 0);
  if (byName) { name = byName.replace(/^(径向|端面)圆?/, '$1'); sym = GD_NAMES[byName]; s = s.slice(byName.length).trim(); }
  else {
    const k = ['//'].concat(Object.keys(GD_SYMS)).find((x) => s.indexOf(x) === 0);
    if (!k) return null;
    sym = GD_CANON[k] || k; name = GD_SYMS[k]; s = s.slice(k.length).trim();
  }
  const m = /^(Ø)?\s*(\d*\.?\d+)\s*(Ⓜ|Ⓛ|Ⓢ|Ⓟ|Ⓕ|Ⓣ|Ⓤ|\(M\)|\(L\))?\s*((?:[A-HJ-NPR-Z](?:\s*(?:Ⓜ|Ⓛ|\(M\)))?[\s-]*){0,3})$/.exec(s);
  if (!m) return null;
  const tol = normNum(m[2]);
  const datums = (m[4] || '').replace(/Ⓜ|Ⓛ|\(M\)/g, ' ').split(/[\s-]+/).filter(Boolean);
  return mkSpec(Object.assign(base, {
    cat: '形位公差', sym, usl: tol, nominal: '', tolSource: 'explicit', conf: 0.9,
    gdt: { sym, tol, dia: !!m[1], mod: m[3] || '', datums },
    name: name + ' ' + (m[1] ? 'Ø' : '') + tol + (datums.length ? ' ' + datums.join('|') : ''),
  }));
}

function matchRoughness(t, base) {
  const m = /^(?:表面粗糙度|粗糙度)?\s*(?:√|▽|⌵)?\s*(Ra|Rz|Ry|Rq|Rt|Rmax)\s*[=:]?\s*(\d*\.?\d+)(?:\s*[~-]\s*(\d*\.?\d+))?\s*(?:μm|µm|um)?$/i.exec(t);
  if (!m) return null;
  const p = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  const a = normNum(m[2]), b = m[3] ? normNum(m[3]) : '';
  return mkSpec(Object.assign(base, {
    cat: '表面粗糙度', unit: 'μm', lsl: b ? decMin(a, b) : '', usl: b ? decMax(a, b) : a, tolSource: 'explicit', conf: 0.92,
    name: '表面粗糙度 ' + p + (b ? decMin(a, b) + '~' + decMax(a, b) : a),
  }));
}

function matchThread(t, base) {
  let m = /^(M)\s?(\d+(?:\.\d+)?)(?:\s*×\s*(\d+(?:\.\d+)?))?(?:\s*-\s*(\d[A-Ha-h](?:\s?\d[A-Ha-h])?))?(?:\s*(LH|左旋))?(?:\s*-?\s*(?:深|DEEP|↧)\s*(\d+(?:\.\d+)?))?\s*(通孔|THRU|EQS|均布)?$/.exec(t);
  let label = '', internal = false;
  if (m) {
    label = 'M' + m[2] + (m[3] ? '×' + m[3] : '') + (m[4] ? '-' + m[4].replace(/\s/g, '') : '') + (m[5] ? ' LH' : '');
    internal = !!m[4] && /[A-H]/.test(m[4]);
    if (m[6]) { base.notes.push('深 ' + m[6]); label += ' 深' + m[6]; }
    if (m[7]) base.notes.push(m[7]);
  } else {
    m = /^(G|Rc|Rp|NPT|NPS|ZG)\s?(\d+\/\d+|\d+(?:\s\d+\/\d+)?)(?:\s*-?\s*([AB]))?$/.exec(t) || /^(R)\s?(\d+\/\d+)$/.exec(t);
    if (m) label = m[1] + m[2] + (m[3] ? '-' + m[3] : '');
    else {
      m = /^(\d+\/\d+|#\d+|\d+)\s*-\s*(\d+)\s*(UNC|UNF|UNEF|UN)(?:\s*-\s*(\d[AB]))?$/.exec(t);
      if (!m) return null;
      label = m[1] + '-' + m[2] + ' ' + m[3] + (m[4] ? '-' + m[4] : '');
      internal = !!m[4] && /B/.test(m[4]);
    }
  }
  return mkSpec(Object.assign(base, {
    cat: '螺纹', kind: 'count', unit: '件', tolSource: 'explicit', conf: 0.92, name: '螺纹 ' + label,
    spec: (internal ? '螺纹塞规' : '螺纹环规') + '检验：通规通过、止规止住',
  }));
}

function matchChamfer(t, base, ctx) {
  let m = /^(\d*\.?\d+)\s*×\s*(\d+(?:\.\d+)?)°$/.exec(t);
  let v, rest = '', label;
  if (m) { v = normNum(m[1]); label = v + '×' + m[2] + '°'; base.notes.push('倒角角度 ' + m[2] + '°'); }
  else {
    m = /^C\s?(\d*\.?\d+)\s*(.*)$/.exec(t);
    if (!m) return null;
    v = normNum(m[1]); rest = m[2]; label = 'C' + v;
  }
  const r = mkSpec(Object.assign(base, { cat: '倒角', name: '倒角 ' + label }));
  return finishTol(r, v, parseTolRest(rest), ctx, 'radius');
}

function matchAngle(t, base, ctx) {
  const m = /^(\d+(?:\.\d+)?\s*°(?:\s*\d+(?:\.\d+)?\s*′)?(?:\s*\d+(?:\.\d+)?\s*″)?)\s*(.*)$/.exec(t);
  if (!m) return null;
  const nom = angleToDeg(m[1].replace(/\s+/g, ''));
  if (!nom) return null;
  const r = mkSpec(Object.assign(base, { cat: '角度尺寸', unit: '°', name: '角度 ' + m[1].replace(/\s+/g, '') }));
  const rest = m[2].trim();
  let pm = /^±\s*(\d+(?:\.\d+)?\s*°?(?:\s*\d+(?:\.\d+)?\s*′)?(?:\s*\d+(?:\.\d+)?\s*″)?)$/.exec(rest);
  if (pm) {
    const d = angleToDeg(pm[1].replace(/\s+/g, ''));
    if (!d) return null;
    applyTol(r, nom.value, '+' + d.value, '-' + d.value);
    r.tolSource = 'explicit'; r.conf = 0.92;
    if (!d.exact || !nom.exact) { r.review = true; r.tolNote = '度分秒换算为十进制度时有舍入（保留 4 位小数）'; }
    return r;
  }
  const two = /^([+-]\s*[\d.°′″\s]+?)\s*\/\s*([+-]?\s*[\d.°′″\s]+)$/.exec(rest);
  if (two) {
    const a = angleToDeg(two[1].replace(/[+\s]/g, '').replace(/^-/, '')), b = angleToDeg(two[2].replace(/[+\s]/g, '').replace(/^-/, ''));
    if (!a || !b) return null;
    applyTol(r, nom.value, (/^\s*-/.test(two[1]) ? '-' : '+') + a.value, (/^\s*-/.test(two[2]) ? '-' : '+') + b.value);
    r.tolSource = 'explicit'; r.conf = 0.9;
    return r;
  }
  if (rest) { r.review = true; r.tolNote = '未能识别的公差写法：' + rest; r.nominal = nom.value; r.conf = 0.5; return r; }
  return finishTol(r, nom.value, { kind: 'none' }, ctx, 'angle');
}

function matchHardness(t, base) {
  let m = new RegExp('^(?:硬度\\s*)?(' + HARD_RE + ')\\s*(\\d+(?:\\.\\d+)?)\\s*(?:~|-|至|到)\\s*(\\d+(?:\\.\\d+)?)$', 'i').exec(t);
  let scale, a, b, op;
  if (m) { scale = m[1]; a = m[2]; b = m[3]; }
  else {
    m = new RegExp('^(?:硬度\\s*)?(\\d+(?:\\.\\d+)?)\\s*(?:~|-|至|到)\\s*(\\d+(?:\\.\\d+)?)\\s*(' + HARD_RE + ')$', 'i').exec(t);
    if (m) { scale = m[3]; a = m[1]; b = m[2]; }
    else {
      m = new RegExp('^(?:硬度\\s*)?(' + HARD_RE + ')\\s*(≥|>=|不小于|≤|<=|不大于)\\s*(\\d+(?:\\.\\d+)?)$', 'i').exec(t);
      if (!m) return null;
      scale = m[1]; op = m[2]; a = m[3];
    }
  }
  scale = scale.toUpperCase();
  const r = mkSpec(Object.assign(base, { cat: '理化', unit: scale, tolSource: 'explicit', conf: 0.9 }));
  if (op) { if (/≥|>=|不小于/.test(op)) r.lsl = normNum(a); else r.usl = normNum(a); r.name = '硬度 ' + scale + op + a; r.tolSource = 'single'; }
  else { r.lsl = decMin(a, b); r.usl = decMax(a, b); r.name = '硬度 ' + scale + r.lsl + '~' + r.usl; }
  return r;
}

function matchSingleSided(t, base) {
  let m = /^(?:([^\d≥≤<>]{1,12}?)\s*)?(≥|>=|≧|不小于|≤|<=|≦|不大于)\s*(\d*\.?\d+)\s*(mm|μm|µm|um|N|kN|MPa|N\/mm²|%)?$/.exec(t);
  let label = '', lower, v, unit = 'mm';
  if (m) { label = (m[1] || '').trim(); lower = /≥|>=|≧|不小于/.test(m[2]); v = normNum(m[3]); unit = m[4] ? m[4].replace('um', 'μm').replace('µm', 'μm') : 'mm'; }
  else {
    m = /^(\d*\.?\d+)\s*(mm)?\s*(max|MAX|min|MIN)\.?$/.exec(t);
    if (!m) return null;
    v = normNum(m[1]); lower = /min/i.test(m[3]);
  }
  const cat = /厚度|镀层|涂层|膜/.test(label) ? '理化' : /N|MPa|%/.test(unit) ? '理化' : label ? '其他' : '线性尺寸';
  const r = mkSpec(Object.assign(base, { cat, unit, tolSource: 'single', conf: label ? 0.8 : 0.72, review: !label }));
  if (lower) r.lsl = v; else r.usl = v;
  if (cat === '线性尺寸') r.nominal = v;
  r.name = (label || (cat === '线性尺寸' ? '尺寸' : '要求')) + ' ' + (lower ? '≥' : '≤') + v;
  return r;
}

/** 补公差：图面没写公差时按未注公差等级查 GB/T 1804 */
function finishTol(r, nominal, tol, ctx, kind) {
  const nom = normNum(nominal);
  if (tol.kind === 'pm' || tol.kind === 'dev') { applyTol(r, nom, tol.up, tol.lo); r.tolSource = 'explicit'; r.conf = tol.kind === 'pm' ? 0.95 : 0.93; return r; }
  if (tol.kind === 'single') { applyTol(r, nom, tol.up, tol.lo); r.tolSource = 'explicit'; r.conf = 0.8; r.review = true; r.tolNote = '只读到一个偏差，另一侧按 0 处理，请核对'; return r; }
  if (tol.kind === 'fit') {
    const f = isoFit(nom, tol.fit);
    r.fit = tol.fit;
    if (tol.dev) {
      applyTol(r, nom, tol.dev.up, tol.dev.lo); r.tolSource = 'explicit'; r.conf = 0.93;
      if (!f.error && (decCmp(r.upper, f.upper) !== 0 || decCmp(r.lower, f.lower) !== 0)) { r.review = true; r.tolNote = '括号内偏差与 ' + f.basis + '（' + f.upper + '/' + f.lower + '）不一致，请核对'; }
      return r;
    }
    if (f.error) { r.nominal = nom; r.tolSource = 'none'; r.review = true; r.conf = 0.5; r.tolNote = f.error; return r; }
    applyTol(r, nom, f.upper, f.lower); r.tolSource = 'fit'; r.conf = 0.88; r.review = true; r.tolNote = '按 ' + f.basis + ' 查表，需核对';
    return r;
  }
  if (tol.kind === 'bad') { r.nominal = nom; r.review = true; r.conf = 0.45; r.tolNote = '未能识别的公差写法：' + tol.rest; return r; }
  const cls = ctx && ctx.generalTol;
  const g = cls ? generalTol(nom, cls, kind) : null;
  if (g) {
    applyTol(r, nom, '+' + g.pm, '-' + g.pm); r.tolSource = 'general'; r.conf = 0.8; r.tolNote = '图面未注公差，按 ' + g.basis + ' 取 ' + g.text;
    if (!g.exact || kind === 'angle') r.review = true;
    return r;
  }
  r.nominal = nom; r.tolSource = 'none'; r.review = true; r.conf = 0.55;
  r.tolNote = cls ? '超出 GB/T 1804-' + cls + ' 的适用范围，请手工填写公差' : '图面没有公差，标题栏或技术要求里也没有未注公差等级';
  return r;
}

function matchDimension(t, base, ctx) {
  /* 极限尺寸：20.05/19.95、19.95~20.05 */
  let m = /^(S?Ø|S?R)?\s*(\d+(?:\.\d+)?)\s*(\/|~)\s*(?:S?Ø|S?R)?\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (m) {
    const a = m[2], b = m[4], sep = m[3];
    const decA = (a.split('.')[1] || '').length, decB = (b.split('.')[1] || '').length;
    const close = Math.abs(parseFloat(a) - parseFloat(b)) <= 0.2 * Math.max(parseFloat(a), parseFloat(b));
    if (decCmp(a, b) !== 0 && close && (sep === '~' || (decA > 0 && decB > 0 && Math.abs(decA - decB) <= 1))) {
      const sym = m[1] || '';
      return mkSpec(Object.assign(base, { sym, lsl: decMin(a, b), usl: decMax(a, b), tolSource: 'limits', conf: 0.92, name: SYM_NAMES[sym] + ' ' + sym + decMin(a, b) + '~' + decMax(a, b) }));
    }
  }
  m = /^(SØ|SR|Ø|R|□)?\s*(\d+(?:\.\d+)?|\.\d+)\s*(.*)$/.exec(t);
  if (!m) return null;
  const sym = m[1] || '';
  let rest = m[3].trim();
  /* 后缀：深度、通孔、均布、数量 */
  const tail = /(?:\s*(?:EQS|均布|THRU|通孔|深\s*\d+(?:\.\d+)?|↧\s*\d+(?:\.\d+)?|[(（]?\s*\d{1,3}\s*(?:处|个|孔)\s*[)）]?))+$/.exec(rest);
  if (tail) {
    const q = /(\d{1,3})\s*(?:处|个|孔)/.exec(tail[0]);
    if (q) base.qty = parseInt(q[1], 10);
    base.notes.push(tail[0].trim());
    rest = rest.slice(0, tail.index).trim();
  }
  const nominal = normNum(m[2]);
  const r = mkSpec(Object.assign(base, { sym, name: (base.qty > 1 ? base.qty + '×' : '') + SYM_NAMES[sym] + ' ' + sym + nominal }));
  finishTol(r, nominal, parseTolRest(rest), ctx, sym === 'R' || sym === 'SR' ? 'radius' : 'linear');
  if (!sym && r.tolSource === 'none' && (/^\d$/.test(nominal) || parseFloat(nominal) >= 10000)) r.conf = 0.3;
  return r;
}

/**
 * 解析一条图面标注。ctx.generalTol：未注公差等级（f / m / c / v）
 * 返回 mkSpec 结构；不是需要检验的特性时返回 { ok: false, reason }；完全不认识返回 null
 */
function parseSpec(raw, ctx) {
  let t = normText(raw);
  if (!t) return null;
  const text = t;
  let cls = '';
  if (/(?:^|[^A-Za-z])CTQ(?:$|[^A-Za-z])|★|◆|关键特性|关键尺寸/.test(t)) cls = 'CTQ';
  else if (/(?:^|[^A-Za-z])(?:CC|SC)(?:$|[^A-Za-z])|▲|重要特性/.test(t)) cls = 'CC';
  t = t.replace(/[(（[【]\s*(?:CTQ|CC|SC|关键特性|重要特性|关键|重要)\s*[)）\]】]/g, ' ').replace(/(?:^|\s)(?:CTQ|CC|SC)(?=\s|$)|[★◆▲]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/^[(（].+[)）]$/.test(t) || /(?:^|\s)REF\.?$|参考/.test(t)) return { ok: false, reason: '参考尺寸，不需要检验', text };
  if (/^[A-Z]$/.test(t)) return { ok: false, reason: '基准或视图标记', text };
  if (/^[A-Z]\s*-\s*[A-Z]$/.test(t) || /^(?:详图|局部放大|视图|剖视|SECTION|DETAIL|VIEW)/i.test(t)) return { ok: false, reason: '视图名称', text };
  if (/^\d+\s*:\s*\d+$/.test(t)) return { ok: false, reason: '比例', text };
  t = t.replace(/^∠\s*(?=\d+(?:\.\d+)?\s*°)/, '');
  const base = { text, cls, qty: 1, notes: [] };
  /* 倒角“0.5×45°”要先于数量前缀判断（“2×45°”是倒角，不是 2 处 45°） */
  const ch0 = /^(\d*\.?\d+)\s*×\s*(\d+(?:\.\d+)?)°$/.test(t) ? matchChamfer(t, base, ctx) : null;
  if (ch0) return ch0;
  let q = /^(\d{1,3})\s*×\s*(?=S?Ø|S?R\s?\d|M\s?\d|C\s?\d|□|\d)/.exec(t) || /^(\d{1,3})\s*-\s*(?=S?Ø|S?R\s?\d|M\s?\d|C\s?\d|□)/.exec(t);
  if (q) { base.qty = parseInt(q[1], 10); t = t.slice(q[0].length).trim(); }
  q = /\s+(\d{1,3})\s*×$/.exec(t);
  if (q) { base.qty = parseInt(q[1], 10); t = t.slice(0, q.index).trim(); }
  const r = matchGdt(t, base) || matchRoughness(t, base) || matchThread(t, base) || matchChamfer(t, base, ctx)
    || matchAngle(t, base, ctx) || matchHardness(t, base) || matchSingleSided(t, base) || matchDimension(t, base, ctx);
  if (r && r.qty > 1 && r.name.indexOf(r.qty + '×') !== 0) r.name = r.qty + '×' + r.name;
  return r;
}

/** 技术要求的一条：返回 { type: 'general-tol' | 'general-note' | 'cls-mark' | 'char' | 'text', ... } */
function parseNote(raw, ctx) {
  const t = normText(raw).replace(/^\s*\d{1,2}\s*[.、)）]\s*/, '').replace(/[。；;]$/, '').trim();
  if (!t) return null;
  const g = /(?:未注|一般|未标注)[^。;；]*?(?:GB\s*\/?\s*T\s*1804|ISO\s*2768)(?:\s*-\s*\d{4})?\s*(?:-\s*)?([fmcvFMCV])(?![a-z])/.exec(t);
  if (g) return { type: 'general-tol', cls: g[1].toLowerCase(), text: t };
  if (/^(?:未注|未标注)/.test(t)) return { type: 'general-note', text: t };
  const cls = /CTQ|关键/.test(t) ? 'CTQ' : /(?:^|[^A-Za-z])CC(?:$|[^A-Za-z])|重要/.test(t) ? 'CC' : '';
  const mark = /((?:S?Ø|R|M)\s?\d[\d.]*(?:\s?(?:js|JS|[a-zA-Z])\d{1,2})?(?:\s*±\s*\d*\.?\d+)?)[^。]*?(?:为|是)?\s*(?:关键特性|重要特性|CTQ|CC)/.exec(t);
  if (mark && cls) return { type: 'cls-mark', target: normText(mark[1]).replace(/\s+/g, ''), cls, text: t };
  const clean = t.replace(/[(（]\s*(?:CTQ|CC)\s*[)）]/g, '').trim();
  const hd = new RegExp('(' + HARD_RE + ')\\s*(\\d+(?:\\.\\d+)?)\\s*(?:~|-|至|到)\\s*(\\d+(?:\\.\\d+)?)', 'i').exec(clean)
    || new RegExp('(\\d+(?:\\.\\d+)?)\\s*(?:~|-|至|到)\\s*(\\d+(?:\\.\\d+)?)\\s*(' + HARD_RE + ')', 'i').exec(clean);
  if (hd) {
    const scaleFirst = isNaN(parseFloat(hd[1]));
    const scale = (scaleFirst ? hd[1] : hd[3]).toUpperCase(), a = scaleFirst ? hd[2] : hd[1], b = scaleFirst ? hd[3] : hd[2];
    const label = clean.slice(0, hd.index).replace(/[，,:：]$/, '').trim();
    return { type: 'char', spec: mkSpec({ cat: '理化', unit: scale, lsl: decMin(a, b), usl: decMax(a, b), tolSource: 'explicit', conf: 0.82, cls, text: t, name: (label ? label + ' ' : '硬度 ') + scale + decMin(a, b) + '~' + decMax(a, b) }) };
  }
  const rg = /([一-龥A-Za-z]{2,12})\s*[:：]?\s*(\d[\d ]*(?:\.\d+)?)\s*(?:~|-|至|到)\s*(\d[\d ]*(?:\.\d+)?)\s*(N\/mm²|N\/mm2|MPa|kN|N·m|Nm|N|bar|kPa|kg|g|%|mm|μm|um)?/.exec(clean);
  if (rg) {
    const a = rg[2].replace(/\s/g, ''), b = rg[3].replace(/\s/g, '');
    const unit = (rg[4] || '').replace('N/mm2', 'N/mm²').replace('um', 'μm');
    const cat = /强度|硬度|厚度|成分|含量|镀层|涂层|密度/.test(rg[1]) ? '理化' : /拉力|扭矩|压力|流量|泄漏|转速|功率|电阻|电压|力/.test(rg[1]) ? '功能' : '其他';
    return { type: 'char', spec: mkSpec({ cat, unit, lsl: decMin(a, b), usl: decMax(a, b), tolSource: 'explicit', conf: 0.8, cls, text: t, name: rg[1] }) };
  }
  const ss = /([一-龥]{2,10})\s*(≥|>=|不小于|≤|<=|不大于)\s*(\d*\.?\d+)\s*(mm|μm|um|N|MPa|%)?/.exec(clean);
  if (ss) {
    const v = normNum(ss[3]), lower = /≥|>=|不小于/.test(ss[2]);
    return { type: 'char', spec: mkSpec({ cat: /厚度|镀层|涂层|强度|硬度/.test(ss[1]) ? '理化' : '其他', unit: (ss[4] || 'mm').replace('um', 'μm'), lsl: lower ? v : '', usl: lower ? '' : v, tolSource: 'single', conf: 0.8, cls, text: t, name: ss[1] + ' ' + (lower ? '≥' : '≤') + v }) };
  }
  if (/无|不得|不允许|不应|应无|去毛刺|倒钝|外观|划伤|划痕|裂纹|气孔|锈|飞边|毛刺|砂眼|磕碰|变形|粘砂/.test(clean)) {
    const short = clean.replace(/^(?:表面|外观)[:：]?/, '').slice(0, 18);
    return { type: 'char', spec: mkSpec({ cat: '外观', kind: 'count', unit: '件', spec: clean, tolSource: 'explicit', conf: 0.78, cls, text: t, name: '外观：' + short }) };
  }
  return { type: 'text', text: t };
}

/** 显示用的规格：Ø20 ±0.10（19.90~20.10 mm） */
function specLine(c) {
  if (!c) return '';
  if (c.kind === 'count') return c.spec || '计数检验';
  const tol = c.upper || c.lower ? (c.upper && c.lower && decCmp(c.upper, decNeg(c.lower)) === 0 ? '±' + decAbs(c.upper) : (c.upper || '0') + '/' + (c.lower || '0')) : '';
  const head = c.cat === '形位公差' ? (c.sym || '') + ' ' + (c.gdt && c.gdt.dia ? 'Ø' : '') + (c.usl || '') + (c.gdt && c.gdt.datums && c.gdt.datums.length ? ' ' + c.gdt.datums.join('|') : '')
    : (c.sym && c.cat !== '形位公差' ? c.sym : '') + (c.nominal || '') + (c.fit ? ' ' + c.fit : '') + (tol ? ' ' + tol : '');
  const lim = c.lsl && c.usl ? c.lsl + '~' + c.usl : c.lsl ? '≥' + c.lsl : c.usl ? '≤' + c.usl : '';
  return (head.trim() || lim) + (lim && head.trim() ? '（' + lim + (c.unit ? ' ' + c.unit : '') + '）' : c.unit && lim ? ' ' + c.unit : '');
}

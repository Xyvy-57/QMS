/* =====================================================================
 * 识别引擎 · 换版映射、相似图纸、冻结校验与同步载荷（纯计算；服务端也加载本文件计算内容摘要）
 *   特性 ID（cid）是稳定身份，气泡号只是显示号。新版本图纸按“位置 + 类型 + 名义值 + 公差”与上一版逐项打分：
 *   沿用（规格不变）/ 变更（规格变了，ID 不变）/ 新增 / 删除 / 无法确认（须人工选定后才能冻结）
 * ===================================================================== */

const SPEC_FIELDS = [['cat', '类别'], ['kind', '判定方式'], ['sym', '符号'], ['nominal', '名义值'], ['upper', '上偏差'], ['lower', '下偏差'], ['lsl', '下限'], ['usl', '上限'], ['unit', '单位'], ['spec', '检验要求']];
const MAP_META = { same: ['沿用', 'chip-gray'], changed: ['变更', 'chip-amber'], added: ['新增', 'chip-green'], removed: ['删除', 'chip-red'], uncertain: ['无法确认', 'chip-violet'] };

/** 规格字段差异；上下限给出“放宽 / 收紧” */
function specDiff(a, b) {
  const out = [];
  SPEC_FIELDS.forEach(([f, label]) => {
    const x = String(a[f] == null ? '' : a[f]), y = String(b[f] == null ? '' : b[f]);
    const same = DEC_RE.test(x) && DEC_RE.test(y) ? decCmp(x, y) === 0 : x === y;
    if (same) return;
    let dir = '';
    if (f === 'lsl' || f === 'usl') {
      if (!x || !y) dir = x ? '取消限值' : '新增限值';
      else { const c = decCmp(y, x); dir = (f === 'lsl' ? c < 0 : c > 0) ? '放宽' : '收紧'; }
    }
    out.push({ f, label, a: x || '—', b: y || '—', dir });
  });
  return out;
}

function relCenter(c, pages) {
  const pg = (pages && pages[(c.page || 1) - 1]) || null;
  if (!pg || !c.anchor) return null;
  return { x: (c.anchor.x + c.anchor.w / 2) / pg.w, y: (c.anchor.y + c.anchor.h / 2) / pg.h, page: c.page || 1 };
}
function textSim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const n = a.length, m = b.length;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    for (let j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[m] / Math.max(n, m);
}
/** 新旧两个特性是同一个特性的可能性（0 ~ 约 1） */
function charSimilarity(o, n, oldPages, newPages) {
  if (o.cat !== n.cat) return 0;
  let s = 0;
  if ((o.sym || '') === (n.sym || '')) s += 0.12;
  if (o.nominal && n.nominal) {
    if (decCmp(o.nominal, n.nominal) === 0) s += 0.34;
    else { const d = Math.abs(parseFloat(o.nominal) - parseFloat(n.nominal)) / Math.max(1e-6, Math.abs(parseFloat(o.nominal))); if (d < 0.05) s += 0.12; }
  } else if (!o.nominal && !n.nominal) s += 0.12;
  if ((o.lsl || '') === (n.lsl || '') && (o.usl || '') === (n.usl || '')) s += 0.18;
  const pa = relCenter(o, oldPages), pb = relCenter(n, newPages);
  if (pa && pb && pa.page === pb.page) s += Math.max(0, 1 - Math.hypot(pa.x - pb.x, pa.y - pb.y) / 0.07) * 0.3;
  if (o.sourceText && n.sourceText) s += textSim(normText(o.sourceText), normText(n.sourceText)) * 0.08;
  return Math.round(s * 1000) / 1000;
}

/**
 * mapRevision(上一冻结版的特性, 新识别的特性, 旧页面尺寸, 新页面尺寸)
 *   → { items: [与 newChars 一一对应 { kind, oldCid, oldNo, score, changes, candidates }], removed: [旧特性摘要] }
 */
function mapRevision(oldChars, newChars, oldPages, newPages) {
  const pairs = [];
  newChars.forEach((n, i) => oldChars.forEach((o, j) => { const s = charSimilarity(o, n, oldPages, newPages); if (s >= 0.42) pairs.push({ i, j, s }); }));
  pairs.sort((a, b) => b.s - a.s);
  const byNew = new Map(), byOld = new Map();
  pairs.forEach((p) => { if (byNew.has(p.i) || byOld.has(p.j)) return; byNew.set(p.i, p); byOld.set(p.j, p); });
  const cand = (i) => pairs.filter((q) => q.i === i).slice(0, 3).map((q) => ({ cid: oldChars[q.j].cid, no: oldChars[q.j].no, name: oldChars[q.j].name, score: q.s }));
  const items = newChars.map((n, i) => {
    const p = byNew.get(i);
    if (!p) return { kind: 'added', oldCid: '', oldNo: null, score: 0, changes: [], candidates: cand(i) };
    const o = oldChars[p.j];
    const second = pairs.find((q) => q.i === i && q.j !== p.j);
    const ambiguous = p.s < 0.6 || (!!second && p.s - second.s < 0.08);
    const changes = specDiff(o, n);
    return { kind: ambiguous ? 'uncertain' : changes.length ? 'changed' : 'same', oldCid: o.cid, oldNo: o.no, score: p.s, changes, candidates: cand(i) };
  });
  const removed = oldChars.filter((o, j) => !byOld.has(j)).map((o) => ({ cid: o.cid, no: o.no, name: o.name, spec: specLine(o) }));
  return { items, removed };
}

/* ---------------- 相似图纸 ---------------- */
function featureSig(chars) { return Array.from(new Set(chars.map((c) => [c.cat, c.sym || '', c.nominal || '', c.lsl || '', c.usl || ''].join('|')))).sort(); }
function hamming(h1, h2) {
  let d = 0;
  const n = Math.min(h1.length, h2.length);
  for (let i = 0; i < n; i++) { let x = parseInt(h1[i], 16) ^ parseInt(h2[i], 16); while (x) { d += x & 1; x >>= 1; } }
  return d + Math.abs(h1.length - h2.length) * 4;
}
/** 两张图纸的相似度：65% 看特性组成（Jaccard），35% 看图面（差值哈希） */
function sigSimilarity(a, b) {
  const A = new Set((a && a.feats) || []), B = new Set((b && b.feats) || []);
  let inter = 0;
  A.forEach((x) => { if (B.has(x)) inter += 1; });
  const uni = A.size + B.size - inter;
  const jac = uni ? inter / uni : 0;
  const img = a && b && a.dhash && b.dhash ? 1 - hamming(a.dhash, b.dhash) / 64 : 0;
  return { score: Math.round((0.65 * jac + 0.35 * Math.max(0, img)) * 1000) / 1000, jac, img, common: inter };
}

/* ---------------- 冻结校验 ---------------- */
function freezeProblems(chars, mapping) {
  const out = [];
  if (!chars.length) out.push('还没有任何特性');
  const seenCid = new Set(), seenNo = new Set();
  chars.forEach((c) => {
    const tag = '#' + c.no + ' ' + (c.name || '');
    if (!c.cid) out.push(tag + '：缺少特性 ID');
    if (seenCid.has(c.cid)) out.push(tag + '：特性 ID 重复'); seenCid.add(c.cid);
    if (seenNo.has(c.no)) out.push(tag + '：气泡号重复'); seenNo.add(c.no);
    if (!c.name) out.push(tag + '：缺少特性名称');
    if (CATS.indexOf(c.cat) < 0) out.push(tag + '：类别不对');
    if (c.kind === 'measure' && !c.lsl && !c.usl) out.push(tag + '：计量特性至少要有上限或下限');
    if (c.kind === 'count' && !c.spec) out.push(tag + '：计数特性要写检验要求');
    if (c.lsl && c.usl && decCmp(c.lsl, c.usl) > 0) out.push(tag + '：下限大于上限');
    if (c.status !== 'confirmed') out.push(tag + '：还没有校核确认');
  });
  if (mapping && mapping.items) mapping.items.forEach((m, i) => { if (m.kind === 'uncertain' && chars[i]) out.push('#' + chars[i].no + '：换版映射“无法确认”，请选定对应的旧特性或标为新增'); });
  return out;
}

/* ---------------- 同步载荷（PRD §7.2） ---------------- */
function round4(x) { return Math.round(x * 10000) / 10000; }
function toBalloon(c, pages) {
  const pg = (pages && pages[(c.page || 1) - 1]) || { w: 1, h: 1 };
  const b = c.balloon || { x: 0, y: 0 }, a = c.anchor || { x: 0, y: 0, w: 0, h: 0 };
  return {
    balloonNo: String(c.no), characteristicId: c.cid, itemName: c.name, category: c.cat, kind: c.kind || 'measure',
    gdtSymbol: c.sym || '', nominal: c.nominal || '', upperTol: c.upper || '', lowerTol: c.lower || '', lsl: c.lsl || '', usl: c.usl || '', unit: c.unit || '',
    specialClass: c.cls === 'CTQ' ? 'CTQ' : c.cls === 'CC' ? 'CC' : 'NORMAL', spec: c.spec || '', qty: c.qty || 1, fit: c.fit || '', tolSource: c.tolSource || '',
    sourceText: c.sourceText || '',
    coord: { page: c.page || 1, x: Math.round(b.x), y: Math.round(b.y), xr: round4(b.x / pg.w), yr: round4(b.y / pg.h), bbox: [Math.round(a.x), Math.round(a.y), Math.round(a.w), Math.round(a.h)] },
  };
}
/** 内容摘要的计算口径：只覆盖规格字段（不含气泡位置），按特性 ID 排序。QMS 用同一口径复核 */
function canonicalSync(p) {
  const head = [p.drawingNo || '', p.drawingRev || '', p.partNo || ''];
  const rows = (p.balloons || []).map((b) => [b.characteristicId || '', String(b.balloonNo == null ? '' : b.balloonNo), b.itemName || '', b.category || '', b.kind || '', b.gdtSymbol || '', b.nominal || '', b.upperTol || '', b.lowerTol || '', b.lsl || '', b.usl || '', b.unit || '', b.specialClass || '', b.spec || ''])
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return JSON.stringify([head, rows]);
}

/** 版本号递增：A → B，A3 → A4，Z → AA，01 → 02，空 → A */
function nextRevLabel(rev) {
  const r = String(rev || '').trim();
  if (!r) return 'A';
  const m = /^(.*?)(\d+)$/.exec(r);
  if (m) return m[1] + String(parseInt(m[2], 10) + 1).padStart(m[2].length, '0');
  if (/^[A-Z]+$/.test(r)) {
    const chars = r.split('');
    let i = chars.length - 1;
    while (i >= 0) { if (chars[i] === 'Z') { chars[i] = 'A'; i -= 1; } else { chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1); return chars.join(''); } }
    return 'A' + chars.join('');
  }
  return r + '-1';
}

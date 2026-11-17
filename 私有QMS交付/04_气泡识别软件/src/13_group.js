/* =====================================================================
 * 识别引擎 · 文字归并与图面分区（纯计算）
 *   输入：一页图纸上的文字片段 token = { str, x, y, w, h, angle, src, conf }
 *         (x, y) 为基线起点（页面像素，y 向下），w 为沿文字方向的宽度，h 为字高，angle 为弧度（0 = 从左到右，-π/2 = 从下往上）
 *   输出：标题栏信息、技术要求、候选特性（带图面位置）、未采用的文字
 * ===================================================================== */

const TITLE_KEY_RE = /图号|图样代号|零件号|零件编号|物料号|物料编码|料号|名称|材料|材质|比例|重量|设计|制图|校对|审核|批准|工艺|标准化|日期|共\s*\d*\s*张|第\s*\d*\s*张|版本|版次|阶段标记|未注公差|DRAWING\s*NO|DWG\.?\s*NO|PART\s*NO|TITLE|MATERIAL|SCALE|REVISION|DRAWN|CHECKED|APPROVED|SHEET/i;
const TITLE_FIELDS = [
  ['drawingNo', /^(?:图号|图样代号|DRAWING\s*NO\.?|DWG\.?\s*NO\.?)\s*[:：]?\s*(.*)$/i],
  ['partNo', /^(?:零件号|零件编号|物料号|物料编码|料号|PART\s*NO\.?)\s*[:：]?\s*(.*)$/i],
  ['name', /^(?:名称|零件名称|图名|TITLE|PART\s*NAME)\s*[:：]?\s*(.*)$/i],
  ['material', /^(?:材料|材质|MATERIAL)\s*[:：]?\s*(.*)$/i],
  ['rev', /^(?:版本|版次|REV(?:ISION)?\.?)\s*[:：]?\s*(.*)$/i],
  ['scale', /^(?:比例|SCALE)\s*[:：]?\s*(.*)$/i],
];
const NOTES_HEAD_RE = /^(?:技术要求|技术条件|TECHNICAL\s+REQUIREMENTS?|NOTES?)\s*[:：]?$/i;
const NUM_ITEM_RE = /^\s*\d{1,2}\s*[.、)）]/;
const GDT_START_RE = /^(?:\/\/|[⏤⏥▱○◯⌭⌒⌓⟂⊥∠∥⌖⊕◎⌯↗⌰])/;

/* ---------------- 几何 ---------------- */
function tokFrame(a) { return { c: Math.cos(a), s: Math.sin(a) }; }
/** 旋转文字框的外接矩形（含 22% 字高的下伸部分） */
function tokBox(k) {
  const { c, s } = tokFrame(k.angle || 0);
  const ax = c * k.w, ay = s * k.w, ux = s * k.h, uy = -c * k.h, dx = -s * k.h * 0.22, dy = c * k.h * 0.22;
  const xs = [k.x + dx, k.x + ax + dx, k.x + ux, k.x + ax + ux], ys = [k.y + dy, k.y + ay + dy, k.y + uy, k.y + ay + uy];
  const x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys);
  return { x: x0, y: y0, w: Math.max.apply(null, xs) - x0, h: Math.max.apply(null, ys) - y0 };
}
function boxUnion(a, b) { if (!a) return Object.assign({}, b); const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; }
function boxCenter(b) { return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }
function boxInside(p, b, pad) { pad = pad || 0; return p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad; }
function boxIoU(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x || y2 <= y) return 0;
  const i = (x2 - x) * (y2 - y);
  return i / (a.w * a.h + b.w * b.h - i);
}
function median(arr) { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }

/* ---------------- 文字归并 ---------------- */
/** 把同一方向、同一基线、间距很小的文字片段拼成一条标注；识别叠放在尺寸数字右侧的上下偏差 */
function groupTokens(tokens) {
  const toks = tokens.map((k, i) => Object.assign({ id: i, angle: 0, conf: 1, src: 'vector' }, k, { str: String(k.str || '').trim() }))
    .filter((k) => k.str && k.w > 0 && k.h > 0);
  const buckets = new Map();
  toks.forEach((k) => {
    const deg = Math.round((k.angle * 180) / Math.PI / 3) * 3;
    const key = ((deg % 360) + 360) % 360;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(k);
  });
  const lines = [];
  buckets.forEach((list, key) => {
    const a = (key > 180 ? key - 360 : key) * Math.PI / 180;
    const { c, s } = tokFrame(a);
    list.forEach((k) => { k.s0 = k.x * c + k.y * s; k.s1 = k.s0 + k.w; k.b = -k.x * s + k.y * c; k.box = tokBox(k); });
    /* 1. 叠放公差：主数字右侧、字号更小、上下各一的两个带符号数字 */
    const used = new Set();
    const mains = list.filter((k) => /(?:^|[ØR□\s])\d+(?:\.\d+)?$|[A-Za-z]\d{1,2}$/.test(k.str)).sort((p, q) => p.s0 - q.s0);
    mains.forEach((m) => {
      if (used.has(m.id)) return;
      const near = list.filter((t) => t !== m && !used.has(t.id) && t.h <= m.h * 0.88 && /^[+-]?\s*\d*\.?\d+$/.test(t.str)
        && t.s0 >= m.s1 - m.h * 0.35 && t.s0 <= m.s1 + m.h * 1.3 && t.b >= m.b - m.h * 1.1 && t.b <= m.b + m.h * 0.55);
      if (near.length < 2) return;
      near.sort((p, q) => p.b - q.b);
      const up = near[0], lo = near[near.length - 1];
      if (lo.b - up.b < m.h * 0.28) return;
      used.add(up.id); used.add(lo.id);
      m.str = m.str + ' ' + up.str.replace(/\s+/g, '') + '/' + lo.str.replace(/\s+/g, '');
      m.s1 = Math.max(m.s1, up.s1, lo.s1);
      m.box = boxUnion(boxUnion(m.box, up.box), lo.box);
      m.stacked = true;
    });
    /* 2. 同基线、间距小于约一个字宽的片段拼成一行 */
    /* 按文字方向从前往后扫：每个片段接到基线一致、紧挨着的那一行后面 */
    const rest = list.filter((k) => !used.has(k.id)).sort((p, q) => p.s0 - q.s0);
    const open = [];
    rest.forEach((k) => {
      let best = null, bestGap = Infinity;
      open.forEach((ln) => {
        const hh = Math.max(k.h, ln.h);
        if (Math.abs(k.b - ln.b) > hh * 0.42) return;
        const gap = k.s0 - ln.s1;
        const limit = GDT_START_RE.test(ln.text) ? hh * 2.6 : hh * 0.95;
        if (gap < -hh * 0.6 || gap > limit) return;
        if (gap < bestGap) { bestGap = gap; best = ln; }
      });
      if (best) {
        best.text += (bestGap > best.h * 0.18 ? ' ' : '') + k.str;
        best.s1 = Math.max(best.s1, k.s1); best.h = Math.max(best.h, k.h);
        best.box = boxUnion(best.box, k.box); best.conf = Math.min(best.conf, k.conf); best.parts.push(k);
      } else {
        const ln = { text: k.str, s0: k.s0, s1: k.s1, b: k.b, h: k.h, angle: a, box: Object.assign({}, k.box), conf: k.conf, src: k.src, parts: [k], stacked: !!k.stacked };
        open.push(ln); lines.push(ln);
      }
    });
  });
  return lines.map((ln) => ({ text: ln.text.replace(/\s+/g, ' ').trim(), box: ln.box, angle: ln.angle, h: ln.h, conf: ln.conf, src: ln.src, stacked: ln.stacked || ln.parts.some((p) => p.stacked) }));
}

/* ---------------- 标题栏 ---------------- */
function findTitleBlock(lines, page) {
  const keys = lines.filter((l) => TITLE_KEY_RE.test(l.text) && Math.abs(l.angle) < 0.1);
  if (keys.length < 2) return null;
  /* 标题栏一般在右下角：取右下象限里的关键字，没有再用全部 */
  const br = keys.filter((l) => { const c = boxCenter(l.box); return c.x > page.w * 0.45 && c.y > page.h * 0.55; });
  const use = br.length >= 2 ? br : keys;
  let box = null;
  use.forEach((l) => { box = boxUnion(box, l.box); });
  const hh = median(use.map((l) => l.h)) || 10;
  if (br.length >= 2) {
    const maxX = Math.max.apply(null, lines.map((l) => l.box.x + l.box.w));
    const maxY = Math.max.apply(null, lines.map((l) => l.box.y + l.box.h));
    box = { x: box.x - hh * 1.5, y: box.y - hh * 1.5, w: Math.max(maxX, box.x + box.w) - box.x + hh * 1.5, h: Math.max(maxY, box.y + box.h) - box.y + hh * 1.5 };
  } else box = { x: box.x - hh * 2, y: box.y - hh * 2, w: box.w + hh * 4, h: box.h + hh * 4 };
  return box;
}
function cleanCode(v) { const m = /^[A-Za-z0-9][\w.\-\/]*/.exec(String(v || '').trim()); return m ? m[0] : ''; }
function readTitle(titleLines) {
  const out = { drawingNo: '', partNo: '', name: '', material: '', rev: '', scale: '', generalTol: '' };
  titleLines.forEach((l) => {
    const g = /(?:GB\s*\/?\s*T\s*1804|ISO\s*2768)(?:\s*-\s*\d{4})?\s*-?\s*([fmcvFMCV])(?![a-z])/.exec(l.text);
    if (g && !out.generalTol) out.generalTol = g[1].toLowerCase();
  });
  TITLE_FIELDS.forEach(([field, re]) => {
    if (out[field]) return;
    for (const l of titleLines) {
      const m = re.exec(l.text);
      if (!m) continue;
      let v = m[1].trim();
      if (!v) {
        const c = boxCenter(l.box);
        const right = titleLines.filter((o) => o !== l && !TITLE_KEY_RE.test(o.text.slice(0, 4)) && Math.abs(boxCenter(o.box).y - c.y) < Math.max(l.h, o.h) * 0.7 && o.box.x >= l.box.x + l.box.w - 2 && o.box.x - (l.box.x + l.box.w) < l.h * 14)
          .sort((p, q) => p.box.x - q.box.x);
        v = right.length ? right[0].text.trim() : '';
      }
      if (!v) continue;
      if (field === 'drawingNo' || field === 'partNo') v = cleanCode(v);
      else if (field === 'rev') { const r = /^[A-Z]{0,2}\d{0,2}/.exec(v); v = r ? r[0] : ''; }
      else if (field === 'scale') { const r = /^\d+\s*:\s*\d+/.exec(v); v = r ? r[0].replace(/\s/g, '') : ''; }
      else v = v.split(/\s{2,}/)[0].slice(0, 24);
      if (v) { out[field] = v; break; }
    }
  });
  return out;
}

/* ---------------- 技术要求 ---------------- */
function findNotes(lines, titleBox) {
  const head = lines.find((l) => NOTES_HEAD_RE.test(l.text) && Math.abs(l.angle) < 0.1);
  if (!head) return { head: null, items: [] };
  const hh = head.h;
  const cand = lines.filter((l) => l !== head && Math.abs(l.angle) < 0.1 && l.box.y > head.box.y + hh * 0.3 && l.box.x >= head.box.x - hh * 3 && l.box.x <= head.box.x + hh * 40
    && !(titleBox && boxInside(boxCenter(l.box), titleBox))).sort((a, b) => a.box.y - b.box.y);
  const items = [];
  let lastY = head.box.y + head.box.h;
  for (const l of cand) {
    if (l.box.y - lastY > hh * 2.6) break;
    lastY = l.box.y + l.box.h;
    if (NUM_ITEM_RE.test(l.text) || !items.length) items.push({ text: l.text, box: Object.assign({}, l.box), lines: [l] });
    else { const it = items[items.length - 1]; it.text += l.text; it.box = boxUnion(it.box, l.box); it.lines.push(l); }
  }
  return { head, items };
}

/* ---------------- 整页分析 ---------------- */
/**
 * analyzePage(tokens, { w, h, page }, { generalTol }) →
 *   { title, generalTol, chars: [{ spec, anchor, sourceText, src, conf, page }], notes: [文本], unused: [{ text, box, reason }] }
 */
function analyzePage(tokens, page, opts) {
  opts = opts || {};
  const lines = groupTokens(tokens);
  const titleBox = findTitleBlock(lines, page);
  const titleLines = titleBox ? lines.filter((l) => boxInside(boxCenter(l.box), titleBox)) : [];
  const title = readTitle(titleLines);
  const notes = findNotes(lines, titleBox);
  const noteLines = new Set();
  if (notes.head) noteLines.add(notes.head);
  notes.items.forEach((it) => it.lines.forEach((l) => noteLines.add(l)));
  const ctx = { generalTol: opts.forceGeneralTol || title.generalTol || '' };
  const parsedNotes = notes.items.map((it) => ({ it, r: parseNote(it.text, ctx) }));
  parsedNotes.forEach(({ r }) => { if (r && r.type === 'general-tol' && !ctx.generalTol) ctx.generalTol = r.cls; });
  if (!ctx.generalTol && opts.generalTol) { ctx.generalTol = opts.generalTol; ctx.assumed = true; }
  if (opts.forceGeneralTol) ctx.assumed = false;

  const chars = [], unused = [];
  const edge = Math.max(page.w, page.h) * 0.045;
  lines.forEach((l) => {
    if (noteLines.has(l) || titleLines.indexOf(l) >= 0) return;
    const c = boxCenter(l.box);
    const nearEdge = c.x < edge || c.y < edge || c.x > page.w - edge || c.y > page.h - edge;
    if (nearEdge && /^(?:[A-HJ-NP-Z]|\d{1,2})$/.test(l.text)) { unused.push({ text: l.text, box: l.box, reason: '图框分区编号' }); return; }
    const r = parseSpec(l.text, ctx);
    if (!r) { unused.push({ text: l.text, box: l.box, reason: '不是可识别的标注' }); return; }
    if (!r.ok) { unused.push({ text: l.text, box: l.box, reason: r.reason }); return; }
    if (r.conf < 0.4) { unused.push({ text: l.text, box: l.box, reason: '可信度太低（可能是编号或噪声）' }); return; }
    if (ctx.assumed && r.tolSource === 'general') { r.review = true; r.tolNote += '（图纸上没写未注公差等级，按设置里的默认等级）'; }
    chars.push({ spec: r, anchor: l.box, sourceText: l.text, src: l.src, conf: Math.round(r.conf * Math.min(1, l.conf) * 100) / 100, page: page.page || 1 });
  });
  parsedNotes.forEach(({ it, r }) => {
    if (!r) return;
    if (r.type === 'char') chars.push({ spec: r.spec, anchor: it.box, sourceText: it.text, src: it.lines[0].src, conf: Math.round(r.spec.conf * Math.min(1, it.lines[0].conf) * 100) / 100, page: page.page || 1, fromNote: true });
    else if (r.type === 'text') unused.push({ text: it.text, box: it.box, reason: '技术要求（无可检验的数值）' });
  });
  /* 技术要求里“Ø30h6 为关键特性(CTQ)”：把等级标到对应尺寸上 */
  parsedNotes.forEach(({ r }) => {
    if (!r || r.type !== 'cls-mark') return;
    chars.forEach((c) => { if (!c.fromNote && normText(c.sourceText).replace(/\s+/g, '').indexOf(r.target) === 0) c.spec.cls = r.cls; });
  });
  /* 去重：矢量 PDF 有时为加粗效果重复绘制同一段文字 */
  const out = [];
  chars.forEach((c) => { if (!out.some((o) => o.sourceText === c.sourceText && boxIoU(o.anchor, c.anchor) > 0.5)) out.push(c); });
  return { title, generalTol: ctx.generalTol || '', generalTolAssumed: !!ctx.assumed, chars: out, notes: notes.items.map((it) => it.text), unused };
}

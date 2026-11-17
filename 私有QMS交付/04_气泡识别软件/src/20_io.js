/* =====================================================================
 * 浏览器端读图：PDF（pdf.js）、PNG/JPG、SVG；本地 OCR（tesseract.js，离线语言包）
 *   页面渲染、文字提取、框选识别、原图截取、带气泡图纸绘制、生成 PDF、差值哈希
 * ===================================================================== */
const VENDOR = '/vendor';
const IO = { pdfjs: null, tess: null, worker: null, workerLangs: '', onProgress: null };
const scriptCache = {};
function loadScript(src) {
  if (!scriptCache[src]) {
    scriptCache[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { delete scriptCache[src]; reject(new Error('加载失败：' + src + '（请确认用 node server.mjs 启动，且 vendor 目录完整）')); };
      document.head.appendChild(s);
    });
  }
  return scriptCache[src];
}
async function ensurePdfjs() {
  if (IO.pdfjs) return IO.pdfjs;
  await loadScript(VENDOR + '/pdfjs/pdf.min.js');
  const lib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
  if (!lib) throw new Error('pdf.js 没有加载成功');
  lib.GlobalWorkerOptions.workerSrc = VENDOR + '/pdfjs/pdf.worker.min.js';
  IO.pdfjs = lib;
  return lib;
}
async function ensureTesseract() {
  if (IO.tess) return IO.tess;
  await loadScript(VENDOR + '/tesseract/tesseract.min.js');
  if (!window.Tesseract) throw new Error('tesseract.js 没有加载成功');
  IO.tess = window.Tesseract;
  return IO.tess;
}
/** OCR 工作线程：首次创建时加载识别核心和语言包（本机 vendor 目录，离线可用），之后复用 */
async function getOcrWorker(langs, onProgress) {
  const T = await ensureTesseract();
  IO.onProgress = onProgress || null;
  if (IO.worker && IO.workerLangs === langs) return IO.worker;
  if (IO.worker) { try { await IO.worker.terminate(); } catch (e) { /* 忽略 */ } IO.worker = null; }
  const abs = (p) => new URL(p, location.href).href;
  IO.worker = await T.createWorker(langs.split('+'), 1, {
    workerPath: abs(VENDOR + '/tesseract/worker.min.js'),
    corePath: abs(VENDOR + '/tesseract/core'),
    langPath: abs(VENDOR + '/tesseract/lang'),
    gzip: true,
    logger: (m) => { if (IO.onProgress) IO.onProgress(m); },
  });
  IO.workerLangs = langs;
  return IO.worker;
}

/* ---------------- 文件 ---------------- */
function detectKind(name, bytes) {
  const b = new Uint8Array(bytes.slice(0, 16));
  const head = String.fromCharCode.apply(null, Array.from(b));
  if (head.indexOf('%PDF') === 0) return 'pdf';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image';
  const text = new TextDecoder().decode(new Uint8Array(bytes.slice(0, 512))).trim();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text) || /\.svg$/i.test(name)) return 'svg';
  if (/\.(png|jpe?g)$/i.test(name)) return 'image';
  if (/\.pdf$/i.test(name)) return 'pdf';
  return '';
}
const KIND_MIME = { pdf: 'application/pdf', image: 'image/png', svg: 'image/svg+xml' };
async function readFileInfo(file) {
  const bytes = await file.arrayBuffer();
  const kind = detectKind(file.name, bytes);
  if (!kind) throw new Error('不支持的文件格式：' + file.name + '（支持 PDF、PNG、JPG、SVG）');
  return { name: file.name, type: file.type || KIND_MIME[kind], size: file.size, kind, bytes, sha256: sha256Hex(new Uint8Array(bytes)) };
}
function bytesToBase64(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
function canvasToBytes(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? b.arrayBuffer().then((x) => resolve(new Uint8Array(x)), reject) : reject(new Error('图片编码失败'))), type || 'image/jpeg', quality == null ? 0.88 : quality));
}
function loadImg(src) {
  return new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error('图片无法打开')); im.src = src; });
}
function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }

/* ---------------- SVG：去掉脚本和外链，按页面像素尺寸渲染 ---------------- */
function sanitizeSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new Error('SVG 文件无法解析');
  Array.from(svg.querySelectorAll('script, foreignObject, iframe, object, embed, audio, video')).forEach((n) => n.remove());
  Array.from(svg.querySelectorAll('*')).concat([svg]).forEach((el) => {
    Array.from(el.attributes).forEach((a) => {
      const n = a.name.toLowerCase(), v = String(a.value || '').trim().toLowerCase();
      if (n.indexOf('on') === 0) el.removeAttribute(a.name);
      else if ((n === 'href' || n === 'xlink:href') && !(v.indexOf('#') === 0 || v.indexOf('data:image/') === 0)) el.removeAttribute(a.name);
    });
  });
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(parseFloat);
  let w = vb.length === 4 ? vb[2] : parseFloat(svg.getAttribute('width')) || 1000;
  let h = vb.length === 4 ? vb[3] : parseFloat(svg.getAttribute('height')) || 700;
  if (vb.length !== 4) svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  return { text: new XMLSerializer().serializeToString(svg), w, h };
}
function svgSized(text, W, H) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  doc.documentElement.setAttribute('width', String(W));
  doc.documentElement.setAttribute('height', String(H));
  return new XMLSerializer().serializeToString(doc.documentElement);
}

/* ---------------- 打开与渲染 ---------------- */
async function openDocument(info) {
  if (info.kind === 'pdf') {
    const lib = await ensurePdfjs();
    const pdf = await lib.getDocument({ data: new Uint8Array(info.bytes.slice(0)), cMapUrl: VENDOR + '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: VENDOR + '/pdfjs/standard_fonts/', isEvalSupported: false }).promise;
    return { kind: 'pdf', numPages: pdf.numPages, pdf };
  }
  if (info.kind === 'image') {
    const url = URL.createObjectURL(new Blob([info.bytes], { type: info.type || 'image/png' }));
    try { const img = await loadImg(url); return { kind: 'image', numPages: 1, img, w: img.naturalWidth, h: img.naturalHeight }; }
    finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
  }
  const s = sanitizeSvg(new TextDecoder().decode(new Uint8Array(info.bytes)));
  return { kind: 'svg', numPages: 1, svgText: s.text, w: s.w, h: s.h };
}
/** 渲染第 n 页：返回 { canvas, w, h }（页面像素坐标系，识别、气泡都用这个坐标） */
async function renderPage(doc, n, targetW) {
  targetW = targetW || 2200;
  if (doc.kind === 'pdf') {
    const page = await doc.pdf.getPage(n);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: targetW / vp1.width });
    const canvas = newCanvas(vp.width, vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return { canvas, w: canvas.width, h: canvas.height, page, vp };
  }
  if (doc.kind === 'image') {
    const k = Math.min(1, targetW / doc.w);
    const canvas = newCanvas(doc.w * k, doc.h * k);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(doc.img, 0, 0, canvas.width, canvas.height);
    return { canvas, w: canvas.width, h: canvas.height };
  }
  const W = Math.round(targetW), H = Math.round((targetW * doc.h) / doc.w);
  const url = URL.createObjectURL(new Blob([svgSized(doc.svgText, W, H)], { type: 'image/svg+xml' }));
  try {
    const img = await loadImg(url);
    const canvas = newCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    return { canvas, w: W, h: H };
  } finally { URL.revokeObjectURL(url); }
}

/* ---------------- 文字提取（矢量） ---------------- */
async function extractPdfTokens(pg) {
  const lib = IO.pdfjs;
  const tc = await pg.page.getTextContent();
  const out = [];
  tc.items.forEach((it) => {
    if (!it.str || !it.str.trim()) return;
    const m = lib.Util.transform(pg.vp.transform, it.transform);
    const h = Math.hypot(m[2], m[3]);
    let w = (it.width || 0) * pg.vp.scale;
    if (!(w > 0)) w = it.str.length * h * 0.55;
    out.push({ str: it.str, x: m[4], y: m[5], w, h, angle: Math.atan2(m[1], m[0]), src: 'vector', conf: 1 });
  });
  return out;
}
/** SVG 文字：放进隐藏容器按页面像素尺寸排版，用浏览器的文字度量取得基线起点、宽度、字高和旋转角 */
function extractSvgTokens(doc, W, H) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:' + W + 'px;height:' + H + 'px;overflow:hidden;visibility:hidden;pointer-events:none;z-index:-1';
  host.innerHTML = svgSized(doc.svgText, W, H);
  document.body.appendChild(host);
  const out = [];
  try {
    const svg = host.querySelector('svg');
    const root = svg.getBoundingClientRect();
    const els = [];
    svg.querySelectorAll('text').forEach((t) => {
      const kids = Array.from(t.children).filter((c) => c.tagName.toLowerCase() === 'tspan');
      const positioned = kids.length && kids.every((c) => c.hasAttribute('x') || c.hasAttribute('y'));
      if (positioned) kids.forEach((c) => els.push(c)); else els.push(t);
    });
    els.forEach((el) => {
      const str = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!str || !el.getNumberOfChars()) return;
      const m = el.getScreenCTM();
      if (!m) return;
      const p = el.getStartPositionOfChar(0);
      const sx = m.a * p.x + m.c * p.y + m.e - root.left, sy = m.b * p.x + m.d * p.y + m.f - root.top;
      const k = Math.hypot(m.a, m.b);
      const fs = parseFloat(getComputedStyle(el).fontSize) || 12;
      out.push({ str, x: sx, y: sy, w: el.getComputedTextLength() * k, h: fs * k, angle: Math.atan2(m.b, m.a), src: 'vector', conf: 1 });
    });
  } finally { host.remove(); }
  return out;
}

/* ---------------- OCR ---------------- */
function scaleCanvas(src, k) {
  if (Math.abs(k - 1) < 0.01) return src;
  const c = newCanvas(src.width * k, src.height * k);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
function rotateCW(src) {
  const c = newCanvas(src.height, src.width);
  const ctx = c.getContext('2d');
  ctx.translate(src.height, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(src, 0, 0);
  return c;
}
function ocrWords(data) {
  const out = [];
  ((data && data.blocks) || []).forEach((bl) => (bl.paragraphs || []).forEach((p) => (p.lines || []).forEach((ln) => (ln.words || []).forEach((w) => out.push(w)))));
  return out;
}
/** 识别结果 → token；rot = 90 表示在顺时针旋转 90° 的图上识别的（原图上是从下往上读的竖排文字） */
function wordsToTokens(words, k, rot, H0, offset) {
  const ox = (offset && offset.x) || 0, oy = (offset && offset.y) || 0;
  const out = [];
  words.forEach((wd) => {
    const text = String(wd.text || '').trim();
    const conf = (wd.confidence || 0) / 100;
    if (!text || conf < 0.35 || !/[0-9A-Za-z一-龥Ø±°⊥∥◎⌖↗○]/.test(text)) return;
    const b = wd.bbox, hb = b.y1 - b.y0;
    if (hb < 4) return;
    const base = b.y1 - hb * 0.18;
    if (!rot) out.push({ str: text, x: b.x0 / k + ox, y: base / k + oy, w: (b.x1 - b.x0) / k, h: (hb * 0.82) / k, angle: 0, src: 'ocr', conf });
    else out.push({ str: text, x: base / k + ox, y: (H0 - b.x0) / k + oy, w: (b.x1 - b.x0) / k, h: (hb * 0.82) / k, angle: -Math.PI / 2, src: 'ocr', conf });
  });
  return out;
}
/** 整页 OCR：横排一遍，旋转 90° 再识别一遍竖排尺寸；两遍重叠的取可信度高的 */
async function ocrCanvas(src, opts, onProgress) {
  opts = opts || {};
  const k = opts.scale || Math.min(2, Math.max(1, 3000 / src.width));
  const c0 = scaleCanvas(src, k);
  const worker = await getOcrWorker(opts.langs || 'eng', onProgress);
  await worker.setParameters({ tessedit_pageseg_mode: String(opts.psm || 11), preserve_interword_spaces: '1' });
  const out0 = { blocks: true, text: false, hocr: false, tsv: false };
  const r0 = await worker.recognize(c0, {}, out0);
  const t0 = wordsToTokens(ocrWords(r0.data), k, 0, c0.height, opts.offset);
  if (opts.rotate === false) return t0;
  const r1 = await worker.recognize(rotateCW(c0), {}, out0);
  const t1 = wordsToTokens(ocrWords(r1.data), k, 90, c0.height, opts.offset).filter((t) => {
    const bt = tokBox(t);
    return !t0.some((s) => boxIoU(bt, tokBox(s)) > 0.2 && s.conf >= t.conf);
  });
  const keep0 = t0.filter((s) => { const bs = tokBox(s); return !t1.some((t) => boxIoU(bs, tokBox(t)) > 0.2 && t.conf > s.conf); });
  return keep0.concat(t1);
}
/** 框选识别（扫描件）：截取框内区域放大后识别，横竖各试一次，取能解析成规格且可信度高的一组 */
async function ocrRegion(src, rect, opts) {
  opts = opts || {};
  const pad = 4;
  const x = Math.max(0, Math.floor(rect.x - pad)), y = Math.max(0, Math.floor(rect.y - pad));
  const w = Math.min(src.width - x, Math.ceil(rect.w + pad * 2)), h = Math.min(src.height - y, Math.ceil(rect.h + pad * 2));
  if (w < 4 || h < 4) return [];
  const crop = newCanvas(w, h);
  crop.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h);
  const k = Math.min(4, Math.max(1.5, 900 / Math.max(w, h)));
  const worker = await getOcrWorker(opts.langs || 'eng', null);
  await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
  const c0 = scaleCanvas(crop, k);
  const out0 = { blocks: true, text: false, hocr: false, tsv: false };
  const a = wordsToTokens(ocrWords((await worker.recognize(c0, {}, out0)).data), k, 0, c0.height, { x, y });
  const b = wordsToTokens(ocrWords((await worker.recognize(rotateCW(c0), {}, out0)).data), k, 90, c0.height, { x, y });
  const score = (toks) => { const t = toks.map((q) => q.str).join(' '); const r = parseSpec(t, opts.ctx || {}); return (r && r.ok ? r.conf : 0) + toks.reduce((s, q) => s + q.conf, 0) / Math.max(1, toks.length) * 0.3; };
  return score(b) > score(a) ? b : a;
}

/* ---------------- 截取、绘制与导出 ---------------- */
function cropDataUrl(canvas, rect, pad, maxW) {
  pad = pad == null ? 6 : pad; maxW = maxW || 360;
  const x = Math.max(0, Math.floor(rect.x - pad)), y = Math.max(0, Math.floor(rect.y - pad));
  const w = Math.min(canvas.width - x, Math.ceil(rect.w + pad * 2)), h = Math.min(canvas.height - y, Math.ceil(rect.h + pad * 2));
  if (w <= 0 || h <= 0) return '';
  const k = Math.min(1, maxW / w);
  const c = newCanvas(w * k, h * k);
  c.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}
const CLS_STROKE = { CTQ: '#e11d48', CC: '#d97706' };
/** 在页面图上画气泡和引线（冻结时生成“带气泡图纸”，打印检验记录表也用它） */
function drawBallooned(base, chars, opts) {
  opts = opts || {};
  const c = newCanvas(base.width, base.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(base, 0, 0);
  const r = opts.r || balloonRadius(base.width);
  chars.forEach((ch) => {
    if (!ch.balloon) return;
    const stroke = CLS_STROKE[ch.cls] || '#1f63e0';
    const ln = ch.anchor ? leaderLine(ch.balloon.x, ch.balloon.y, r, ch.anchor) : null;
    ctx.lineWidth = Math.max(1.5, r * 0.11); ctx.strokeStyle = stroke;
    if (ln) { ctx.beginPath(); ctx.moveTo(ln.x1, ln.y1); ctx.lineTo(ln.x2, ln.y2); ctx.stroke(); ctx.beginPath(); ctx.arc(ln.x2, ln.y2, Math.max(2, r * 0.14), 0, Math.PI * 2); ctx.fillStyle = stroke; ctx.fill(); }
    ctx.beginPath(); ctx.arc(ch.balloon.x, ch.balloon.y, r, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.16); ctx.stroke();
    ctx.fillStyle = stroke; ctx.font = '700 ' + Math.round(r * (String(ch.no).length > 2 ? 0.8 : 1.0)) + 'px -apple-system, "PingFang SC", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(ch.no), ch.balloon.x, ch.balloon.y + 1);
  });
  return c;
}
/** 极简 PDF：每页一张 JPEG（DCTDecode），用于“带气泡图纸” */
function makePdf(pages) {
  const enc = new TextEncoder();
  const chunks = [], offsets = [];
  let len = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
  push('%PDF-1.4\n');
  const n = pages.length, pageIds = pages.map((_, i) => 3 + i * 3);
  const obj = (id, body) => { offsets[id] = len; push(id + ' 0 obj\n'); push(body); push('\nendobj\n'); };
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [' + pageIds.map((id) => id + ' 0 R').join(' ') + '] /Count ' + n + ' >>');
  pages.forEach((p, i) => {
    const id = pageIds[i], W = (p.w * 72 / 150).toFixed(2), H = (p.h * 72 / 150).toFixed(2);
    obj(id, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /XObject << /Im0 ' + (id + 1) + ' 0 R >> >> /Contents ' + (id + 2) + ' 0 R >>');
    offsets[id + 1] = len;
    push((id + 1) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpeg.length + ' >>\nstream\n');
    push(p.jpeg); push('\nendstream\nendobj\n');
    const content = 'q ' + W + ' 0 0 ' + H + ' 0 0 cm /Im0 Do Q';
    obj(id + 2, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
  });
  const total = 3 + n * 3, xref = len;
  let x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
  for (let i = 1; i < total; i++) x += String(offsets[i] || 0).padStart(10, '0') + ' 00000 n \n';
  push(x + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  const out = new Uint8Array(len);
  let o = 0;
  chunks.forEach((b) => { out.set(b, o); o += b.length; });
  return out;
}
/** 差值哈希（9×8 灰度，64 位）：用来比较两张图纸的图面是否相似 */
function dHashCanvas(src) {
  const c = newCanvas(9, 8);
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0, 9, 8);
  const d = ctx.getImageData(0, 0, 9, 8).data;
  const g = (x, y) => { const i = (y * 9 + x) * 4; return d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; };
  let hex = '';
  for (let y = 0; y < 8; y++) {
    let v = 0;
    for (let x = 0; x < 8; x++) v = (v << 1) | (g(x, y) > g(x + 1, y) ? 1 : 0);
    hex += v.toString(16).padStart(2, '0');
  }
  return hex;
}
function downloadBlob(name, data, type) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------------- 识别整份图纸 ---------------- */
function usefulTokenCount(tokens) { return tokens.filter((t) => /\d/.test(t.str)).length; }
/**
 * recognizeDocument(doc, { renderW, langs, generalTol, ocr: 'auto' | 'always' | 'never' }, onStep)
 *   → { pages: [{ page, w, h, canvas, tokens }], chars, unused, notes, title, generalTol, generalTolAssumed, textSource }
 */
async function recognizeDocument(doc, opts, onStep) {
  opts = opts || {};
  const step = onStep || (() => {});
  const pages = [], chars = [], unused = [], notes = [];
  let title = null, generalTol = '', assumed = false, textSource = doc.kind === 'image' ? 'ocr' : 'vector';
  for (let n = 1; n <= doc.numPages; n++) {
    step({ step: 'render', page: n, total: doc.numPages });
    const pg = await renderPage(doc, n, opts.renderW || 2200);
    let tokens = [];
    if (doc.kind === 'pdf') tokens = await extractPdfTokens(pg);
    else if (doc.kind === 'svg') tokens = extractSvgTokens(doc, pg.w, pg.h);
    const needOcr = opts.ocr === 'always' || (opts.ocr !== 'never' && usefulTokenCount(tokens) < 3);
    if (needOcr) {
      textSource = 'ocr';
      step({ step: 'ocr', page: n, total: doc.numPages, progress: 0, status: '准备识别引擎' });
      tokens = await ocrCanvas(pg.canvas, { langs: opts.langs || 'eng+chi_sim' }, (m) => step({ step: 'ocr', page: n, total: doc.numPages, progress: m.progress || 0, status: m.status || '' }));
    }
    step({ step: 'parse', page: n, total: doc.numPages });
    const res = analyzePage(tokens, { w: pg.w, h: pg.h, page: n }, { generalTol: generalTol || opts.generalTol || '' });
    if (!title || (!title.drawingNo && res.title.drawingNo)) title = res.title;
    if (res.generalTol && !generalTol) { generalTol = res.generalTol; assumed = res.generalTolAssumed; }
    res.chars.forEach((c) => { c.clip = cropDataUrl(pg.canvas, c.anchor); });
    chars.push.apply(chars, res.chars);
    res.unused.forEach((u) => unused.push(Object.assign({ page: n }, u)));
    notes.push.apply(notes, res.notes);
    pages.push({ page: n, w: pg.w, h: pg.h, canvas: pg.canvas, tokens });
  }
  return { pages, chars, unused, notes, title: title || {}, generalTol, generalTolAssumed: assumed, textSource };
}

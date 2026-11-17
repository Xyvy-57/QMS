/* =====================================================================
 * 识别流程：识别结果 → 特性记录（分配稳定 ID、换版映射、摆放气泡、编号）→ 上传页面图并保存
 *   上传对话框和标注工作台的“重新识别”共用这里的函数
 * ===================================================================== */

/* 识别过的文档留在内存里（框选识别、重新渲染要用），刷新页面后按需从服务端重新加载 */
const DOC_CACHE = {};
function cacheDoc(revId, entry) { DOC_CACHE[revId] = markRaw(entry); }

/** 页面文字压缩存储：[文字, x, y, 宽, 字高, 角度, 可信度, 来源] */
function packTokens(tokens) { return tokens.map((t) => [t.str, Math.round(t.x * 10) / 10, Math.round(t.y * 10) / 10, Math.round(t.w * 10) / 10, Math.round(t.h * 10) / 10, Math.round(t.angle * 1000) / 1000, Math.round((t.conf == null ? 1 : t.conf) * 100) / 100, t.src === 'ocr' ? 1 : 0]); }
function unpackTokens(rows) { return (rows || []).map((r) => ({ str: r[0], x: r[1], y: r[2], w: r[3], h: r[4], angle: r[5], conf: r[6], src: r[7] ? 'ocr' : 'vector' })); }

/**
 * buildChars(drawing, base, rec)：
 *   rec = recognizeDocument() 的结果；base = 上一冻结版本（没有则为 null）
 *   返回 { chars, mapping }；映射到旧特性的沿用旧 ID、旧气泡号、旧名称和等级，气泡相对标注的位置也沿用
 */
function buildChars(drawing, base, rec) {
  const nextCid = cidMaker(drawing);
  const pages = rec.pages.map((p) => ({ w: p.w, h: p.h }));
  const chars = rec.chars.map((c) => specToChar(c.spec, { page: c.page, anchor: c.anchor, sourceText: c.sourceText, src: c.fromNote ? 'note' : c.src, conf: c.conf, clip: c.clip || '' }));
  let mapping = null;
  if (base && base.chars && base.chars.length) {
    const m = mapRevision(base.chars, chars, base.pages, pages);
    mapping = { baseRevId: base.id, baseRev: base.rev, items: [], removed: m.removed };
    let maxNo = Math.max(0, ...base.chars.map((x) => x.no || 0));
    m.items.forEach((it, i) => {
      const c = chars[i];
      const o = it.oldCid ? base.chars.find((x) => x.cid === it.oldCid) : null;
      if (o && it.kind !== 'uncertain') {
        c.cid = o.cid; c.no = o.no; c.name = o.name || c.name;
        if (c.cls === '一般' && o.cls && o.cls !== '一般') c.cls = o.cls;
        if (o.balloon && o.anchor && c.anchor) {
          const dx = (c.anchor.x + c.anchor.w / 2) - (o.anchor.x + o.anchor.w / 2), dy = (c.anchor.y + c.anchor.h / 2) - (o.anchor.y + o.anchor.h / 2);
          c.balloon = { x: Math.round(o.balloon.x + dx), y: Math.round(o.balloon.y + dy) };
        }
      }
      mapping.items.push({ cid: '', kind: it.kind, oldCid: it.oldCid, oldNo: it.oldNo, score: it.score, changes: it.changes, candidates: it.candidates });
    });
    readingOrder(chars.filter((c) => !c.cid), pages).forEach((c) => { c.cid = nextCid(); c.no = ++maxNo; });
    mapping.items.forEach((mi, i) => { mi.cid = chars[i].cid; });
  } else {
    readingOrder(chars, pages).forEach((c, i) => { c.cid = nextCid(); c.no = i + 1; });
  }
  const obstacles = {};
  rec.unused.forEach((u) => { (obstacles[u.page] = obstacles[u.page] || []).push(u.box); });
  placeBalloons(chars, pages, { obstacles });
  return { chars, mapping };
}

/** 页面图转 JPEG 上传，返回页面元数据（含文字，供框选识别使用） */
async function uploadPages(drawingId, revId, rec, onStep) {
  const out = [];
  for (const p of rec.pages) {
    if (onStep) onStep({ step: 'upload', page: p.page, total: rec.pages.length });
    const jpeg = await canvasToBytes(p.canvas, 'image/jpeg', 0.88);
    const r = await api('POST', '/drawings/' + drawingId + '/revisions/' + revId + '/pages', { page: p.page, w: p.w, h: p.h, base64: bytesToBase64(jpeg) });
    out.push({ page: p.page, w: p.w, h: p.h, image: r.url, tokens: packTokens(p.tokens) });
  }
  return out;
}

/** 识别结果整体保存到某个版本 */
async function saveRecognition(drawing, rev, rec, built, onStep) {
  const pages = await uploadPages(drawing.id, rev.id, rec, onStep);
  const sig = { feats: featureSig(built.chars), dhash: rec.pages[0] ? dHashCanvas(rec.pages[0].canvas) : '' };
  if (onStep) onStep({ step: 'save' });
  const saved = await api('PUT', '/drawings/' + drawing.id + '/revisions/' + rev.id, {
    expectedVersion: rev.version,
    patch: {
      status: 'review', textSource: rec.textSource, pages, chars: built.chars, mapping: built.mapping, sig,
      unused: rec.unused.map((u) => ({ page: u.page, text: u.text, box: u.box, reason: u.reason })), notes: rec.notes,
      title: rec.title, generalTol: rec.generalTol, generalTolAssumed: rec.generalTolAssumed, recognizedAt: new Date().toISOString(),
    },
  });
  cacheDoc(rev.id, { doc: rec.doc || null, canvases: rec.pages.map((p) => p.canvas) });
  return saved;
}

/** 打开一个已保存版本的原始文件（刷新页面后重新识别、框选识别时用） */
async function loadRevisionDoc(rev) {
  const hit = DOC_CACHE[rev.id];
  if (hit && hit.doc) return hit.doc;
  if (!rev.file || !rev.file.url) throw new Error('这个版本没有原始文件');
  const res = await fetch(rev.file.url);
  if (!res.ok) throw new Error('原始文件下载失败（HTTP ' + res.status + '）');
  const bytes = await res.arrayBuffer();
  const doc = await openDocument({ kind: rev.file.kind || detectKind(rev.file.name || '', bytes), bytes, name: rev.file.name, type: rev.file.type });
  DOC_CACHE[rev.id] = markRaw(Object.assign({}, hit || {}, { doc }));
  return doc;
}
/** 某一页的页面图画布（从缓存或服务端页面图加载） */
async function pageCanvas(rev, pageNo) {
  const hit = DOC_CACHE[rev.id];
  if (hit && hit.canvases && hit.canvases[pageNo - 1]) return hit.canvases[pageNo - 1];
  const pg = (rev.pages || [])[pageNo - 1];
  if (!pg) throw new Error('页面不存在');
  const img = await loadImg(pg.image);
  const c = newCanvas(pg.w, pg.h);
  c.getContext('2d').drawImage(img, 0, 0, pg.w, pg.h);
  const entry = Object.assign({ canvases: [] }, hit || {});
  entry.canvases = entry.canvases.slice(); entry.canvases[pageNo - 1] = c;
  DOC_CACHE[rev.id] = markRaw(entry);
  return c;
}

/** 改了未注公差等级后，用已提取的文字重新解析（不用再跑 OCR） */
function reanalyze(rec, forceGeneralTol) {
  const chars = [], unused = [], notes = [];
  let gt = '', assumed = false;
  rec.pages.forEach((p) => {
    const res = analyzePage(p.tokens, { w: p.w, h: p.h, page: p.page }, { forceGeneralTol, generalTol: gt || S.settings.defaultGeneralTol || '' });
    if (res.generalTol && !gt) { gt = res.generalTol; assumed = res.generalTolAssumed; }
    res.chars.forEach((c) => { c.clip = cropDataUrl(p.canvas, c.anchor); });
    chars.push.apply(chars, res.chars);
    res.unused.forEach((u) => unused.push(Object.assign({ page: p.page }, u)));
    notes.push.apply(notes, res.notes);
  });
  return Object.assign({}, rec, { chars, unused, notes, generalTol: gt, generalTolAssumed: assumed });
}

/** 识别进度的文字 */
function stepText(s) {
  if (!s) return '';
  const pg = s.total > 1 ? '第 ' + s.page + '/' + s.total + ' 页：' : '';
  if (s.step === 'read') return '读取文件';
  if (s.step === 'render') return pg + '渲染页面';
  if (s.step === 'ocr') {
    const st = String(s.status || '');
    const label = /loading tesseract core/.test(st) ? '加载识别引擎' : /loading language/.test(st) ? '加载语言包' : /initializ/.test(st) ? '初始化识别引擎' : /recognizing/.test(st) ? '识别文字' : st || '识别文字';
    return pg + 'OCR · ' + label + (s.progress ? ' ' + Math.round(s.progress * 100) + '%' : '');
  }
  if (s.step === 'parse') return pg + '解析标注';
  if (s.step === 'upload') return '上传页面图 ' + s.page + '/' + s.total;
  if (s.step === 'save') return '保存识别结果';
  return s.step;
}

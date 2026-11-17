/* =====================================================================
 * 与自研气泡识别软件对接（PRD §7）
 *   浏览器消息只做通知：收到 worlder.balloon.frozen 或轮询到新批次后，按批次号拉取权威数据，核对内容摘要（SHA-256），
 *   把 PRD §7.2 的 balloons[] 转成 QMS 的特性字段；图纸页面图下载后压缩存进 QMS（S.dwgImages），检验页显示真实图纸。
 *   原型里由 QMS 页面代为拉取；正式系统改由 QMS 后端拉取并存私有对象存储。
 * ===================================================================== */

const SYNC_CATS = ['线性尺寸', '角度尺寸', '形位公差', '螺纹', '表面粗糙度', '倒角', '外观', '理化', '功能', '焊接', '其他'];
function bubbleBase() { return String(S.settings.bubbleBase || '').replace(/\/+$/, ''); }
function bubbleOrigin() { try { return new URL(bubbleBase()).origin; } catch (e) { return ''; } }

/* ---------------- 内容摘要：与气泡软件 src/15_map.js 的 canonicalSync 同一口径 ---------------- */
function canonicalSyncQms(p) {
  const head = [p.drawingNo || '', p.drawingRev || '', p.partNo || ''];
  const rows = (p.balloons || []).map((b) => [b.characteristicId || '', String(b.balloonNo == null ? '' : b.balloonNo), b.itemName || '', b.category || '', b.kind || '', b.gdtSymbol || '', b.nominal || '', b.upperTol || '', b.lowerTol || '', b.lsl || '', b.usl || '', b.unit || '', b.specialClass || '', b.spec || ''])
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return JSON.stringify([head, rows]);
}
const SHA_K32 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
/** SHA-256（纯 JS；内网 http 地址上浏览器没有 crypto.subtle 也能核对摘要） */
function sha256HexQms(text) {
  const bytes = new TextEncoder().encode(text);
  const l = bytes.length, nBlocks = (l + 9 + 63) >> 6, m = new Uint8Array(nBlocks * 64);
  m.set(bytes); m[l] = 0x80;
  const dv = new DataView(m.buffer), bits = l * 8;
  dv.setUint32(m.length - 4, bits >>> 0); dv.setUint32(m.length - 8, Math.floor(bits / 0x100000000));
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let off = 0; off < m.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      w[i] = (w[i - 16] + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w[i - 7] + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + SHA_K32[i] + w[i]) | 0;
      const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

/* ---------------- 图纸页面图：缩放进查看器的 860×520 坐标系 ---------------- */
function dwgPlacement(w, h) { const s = Math.min(860 / w, 520 / h); return { s, ox: (860 - w * s) / 2, oy: (520 - h * s) / 2, w, h }; }
/** 下载页面图并压缩成 JPEG 存进 QMS（长边 ≤ 1600 像素）；跨域图片要求气泡服务返回 CORS 许可 */
function storeDrawingImage(ref, url, w, h) {
  return new Promise((resolve) => {
    if (!url) { resolve(false); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        S.dwgImages[ref] = Object.assign({ img: c.toDataURL('image/jpeg', 0.8), at: nowISO() }, dwgPlacement(w || img.naturalWidth, h || img.naturalHeight));
        resolve(true);
      } catch (e) { S.dwgImages[ref] = Object.assign({ img: url, at: nowISO(), remote: true }, dwgPlacement(w || img.naturalWidth, h || img.naturalHeight)); resolve(true); }
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
}
function dwgSvg(ref) {
  const d = ref && S.dwgImages[ref];
  if (!d) return '';
  return '<rect x="0" y="0" width="860" height="520" fill="#fff"/><image href="' + d.img + '" x="' + d.ox.toFixed(1) + '" y="' + d.oy.toFixed(1) + '" width="' + (d.w * d.s).toFixed(1) + '" height="' + (d.h * d.s).toFixed(1) + '" preserveAspectRatio="none"/>' +
    '<rect x="' + d.ox.toFixed(1) + '" y="' + d.oy.toFixed(1) + '" width="' + (d.w * d.s).toFixed(1) + '" height="' + (d.h * d.s).toFixed(1) + '" fill="none" stroke="#e4e4e7"/>';
}
/** 标准 / 零件 / 同步记录的底图：有同步来的真实图纸就用真实图纸，否则用示例 SVG */
function svgOf(x) { if (!x) return ''; const s = x.drawingRef ? dwgSvg(x.drawingRef) : ''; return s || x.svg || (x.partId ? (partOf(x.partId).svg || '') : ''); }
function stdSvg(stdId) { const s = stdOf(stdId); return s ? svgOf(s) || svgOf(partOf(s.partId)) : ''; }

/* ---------------- PRD §7.2 balloons[] → QMS 特性 ---------------- */
function balloonsToItems(p) {
  const pages = (p.drawing && p.drawing.pages) || [];
  return (p.balloons || []).map((b) => {
    const co = b.coord || {}, pg = pages[(co.page || 1) - 1] || pages[0] || null;
    let x = co.x || 0, y = co.y || 0;
    if (pg) { const pl = dwgPlacement(pg.width, pg.height); x = pl.ox + (co.xr != null ? co.xr * pg.width : x) * pl.s; y = pl.oy + (co.yr != null ? co.yr * pg.height : y) * pl.s; }
    const cat = SYNC_CATS.indexOf(b.category) >= 0 ? b.category : '其他';
    const kind = b.kind === 'count' || b.kind === 'measure' ? b.kind : cat === '外观' ? 'count' : 'measure';
    return {
      cid: String(b.characteristicId || ''), no: parseInt(b.balloonNo, 10) || b.balloonNo, name: b.itemName || '', cat, kind,
      sym: b.gdtSymbol || '', nominal: b.nominal || '', upper: b.upperTol || '', lower: b.lowerTol || '', lsl: b.lsl || '', usl: b.usl || '',
      unit: kind === 'count' ? '件' : b.unit || 'mm', cls: b.specialClass === 'CTQ' ? 'CTQ' : b.specialClass === 'CC' ? 'CC' : '一般',
      spec: b.spec || '', gauge: '', method: '', qty: b.qty || 1, sourceText: b.sourceText || '', tolSource: b.tolSource || '',
      x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, page: co.page || 1,
    };
  });
}

/** 按批次号拉取冻结结果：核对摘要 → 转换特性 → 保存图纸页面图 → 收件箱记录变为“待处理” */
async function fetchSyncBatch(rec) {
  const base = bubbleBase();
  if (!base) { rec.error = '没有配置气泡识别服务地址'; return false; }
  rec.fetching = true; rec.error = '';
  try {
    const res = await fetch(base + '/api/v1/open/balloon-sync/' + encodeURIComponent(rec.syncBatchId), { credentials: 'omit' });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error && data.error.message) || 'HTTP ' + res.status);
    const calc = 'sha256:' + sha256HexQms(canonicalSyncQms(data));
    if (data.contentHash !== calc) throw new Error('内容摘要不一致（收到 ' + String(data.contentHash).slice(0, 19) + '…，复算 ' + calc.slice(0, 19) + '…），已拒收');
    if (rec.notifiedHash && rec.notifiedHash !== data.contentHash) throw new Error('浏览器通知里的摘要与接口返回的不一致，已拒收');
    const ref = rec.syncBatchId;
    const pg = data.drawing && data.drawing.pages && data.drawing.pages[0];
    const stored = pg ? await storeDrawingImage(ref, pg.imageUrl, pg.width, pg.height) : false;
    Object.assign(rec, {
      drawingNo: data.drawingNo, drawingRev: data.drawingRev || rec.drawingRev, items: balloonsToItems(data), contentHash: data.contentHash,
      drawingRef: stored ? ref : '', annotatedFileUrl: data.annotatedFileUrl || '', frozenBy: data.frozenBy || '', frozenAt: data.frozenAt || '',
      partHint: { partNo: data.partNo || '', name: data.drawingName || '', material: data.material || '', drawingNo: data.drawingNo, drawingRev: data.drawingRev },
      status: rec.status === 'fetching' ? 'pending' : rec.status, fetchedAt: nowISO(), verified: true,
    });
    if (!rec.partId) { const part = S.parts.find((x) => x.drawingNo === data.drawingNo || (data.partNo && x.partNo === data.partNo)); if (part) rec.partId = part.id; }
    logAudit('集成', rec.syncBatchId, '按批次号拉取气泡同步结果：' + rec.items.length + ' 个气泡，内容摘要核对一致（' + data.contentHash.slice(0, 19) + '…）');
    return true;
  } catch (e) {
    rec.error = String(e.message || e).indexOf('Failed to fetch') >= 0 ? '连接不到气泡识别服务（' + base + '）：请确认已启动 node server.mjs' : String(e.message || e);
    return false;
  } finally { rec.fetching = false; }
}

/** 轮询新冻结批次（气泡软件单独打开、没有内嵌时也能收到） */
let pollBusy = false;
async function pollBubble() {
  const base = bubbleBase();
  if (!base || pollBusy || /223\.106\.198\.62/.test(base)) return 0;
  pollBusy = true;
  try {
    const res = await fetch(base + '/api/v1/open/balloon-sync?after=' + (S.syncSeq || 0), { credentials: 'omit' });
    if (!res.ok) return 0;
    const data = await res.json();
    let n = 0;
    for (const it of data.items || []) {
      if (it.seq > (S.syncSeq || 0)) S.syncSeq = it.seq;
      if (S.syncInbox.some((x) => x.syncBatchId === it.syncBatchId)) continue;
      const rec = ingestSync({ syncBatchId: it.syncBatchId, drawingNo: it.drawingNo, drawingRev: it.drawingRev, contentHash: it.contentHash, balloonCount: it.balloonCount }, 'poll');
      if (rec) { n += 1; await fetchSyncBatch(rec); }
    }
    return n;
  } catch (e) { return 0; } finally { pollBusy = false; }
}

/** 图号在 QMS 里还没有零件：按图纸标题栏信息新建零件（工序路线之后可在“零部件”里应用模板） */
function createPartFromSync(rec) {
  const h = rec.partHint || {};
  const partNo = (h.partNo || rec.drawingNo).trim();
  if (S.parts.some((x) => x.partNo === partNo)) throw new Error('零件号 ' + partNo + ' 已存在，但图号不同：请在“零部件”里核对');
  const part = { id: 'p' + nextSeq(), partNo, name: h.name || rec.drawingNo, customer: S.customers[0] || '', drawingNo: rec.drawingNo, drawingRev: rec.drawingRev, material: h.material || '', route: null, drawingRef: rec.drawingRef || '' };
  part.svg = blankDrawing(part);
  S.parts.push(part);
  rec.partId = part.id;
  logAudit('零部件', part.partNo, '按气泡同步 ' + rec.syncBatchId + ' 的图纸信息新建零件 ' + part.name);
  return S.parts.find((x) => x.id === part.id);
}

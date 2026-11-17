#!/usr/bin/env node
/**
 * 自研气泡识别软件 · 服务端（只用 Node.js 自带模块，不依赖第三方包）
 *
 *   node server.mjs                 # 气泡识别 http://localhost:3080，QMS 原型 http://localhost:5180
 *
 * 可选参数（也可用环境变量）：
 *   --port 3080        BUBBLE_PORT   气泡识别服务端口
 *   --qms-port 5180    QMS_PORT      托管 QMS 原型的端口（0 = 不托管）
 *   --qms <目录>       QMS_DIR       QMS 原型目录（默认 ../03_前端原型）
 *   --data <目录>      BUBBLE_DATA   数据目录（默认 ./data）
 *   --host 127.0.0.1   BUBBLE_HOST   监听地址；内网部署改为 0.0.0.0，并在“设置与对接”里加上 QMS 的内网地址
 *
 * 接口（PRD §7）：
 *   GET  /api/v1/open/balloon-sync/{syncBatchId}   冻结结果（权威数据，带内容摘要）
 *   GET  /api/v1/open/balloon-sync?after={seq}      新冻结批次列表（QMS 轮询用）
 *   其余 /api/v1/drawings… 为气泡软件自己的页面使用
 */
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, statSync, createReadStream, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] != null && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const HOST = arg('host', process.env.BUBBLE_HOST || '127.0.0.1');
const PORT = parseInt(arg('port', process.env.BUBBLE_PORT || '3080'), 10);
const QMS_PORT = parseInt(arg('qms-port', process.env.QMS_PORT || '5180'), 10);
const QMS_DIR = resolve(arg('qms', process.env.QMS_DIR || join(root, '..', '03_前端原型')));
const DATA = resolve(arg('data', process.env.BUBBLE_DATA || join(root, 'data')));
const FILES = join(DATA, 'files');
const VERSION = '0.1.0';
mkdirSync(FILES, { recursive: true });

/* 与前端同一份识别引擎：冻结校验、同步载荷、内容摘要口径只有一处定义 */
const ENGINE = ['10_dec.js', '11_tol.js', '12_parse.js', '13_group.js', '14_layout.js', '15_map.js', '16_sha.js'];
const E = new Function(ENGINE.map((f) => readFileSync(join(root, 'src', f), 'utf8')).join('\n;\n') + '\nreturn { canonicalSync, toBalloon, freezeProblems };')();
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/* ---------------- 数据（data/db.json + data/files/） ---------------- */
const DB_FILE = join(DATA, 'db.json');
const localOrigins = QMS_PORT ? ['http://localhost:' + QMS_PORT, 'http://127.0.0.1:' + QMS_PORT] : [];
const DEFAULT_SETTINGS = { qmsOrigins: localOrigins.slice(), defaultGeneralTol: 'm', ocrLangs: 'eng+chi_sim', ocrMode: 'auto', renderWidth: 2200, localUser: '本机用户' };
function loadDb() {
  if (existsSync(DB_FILE)) {
    try {
      const j = JSON.parse(readFileSync(DB_FILE, 'utf8'));
      const db0 = Object.assign({ seq: 0, batchSeq: 0, drawings: [], batches: [] }, j);
      db0.settings = Object.assign({}, DEFAULT_SETTINGS, j.settings || {});
      return db0;
    } catch (e) { console.error('数据文件损坏，已改名备份后重新开始：' + e.message); try { renameSync(DB_FILE, DB_FILE + '.broken-' + Date.now()); } catch (e2) { /* 忽略 */ } }
  }
  return { seq: 0, batchSeq: 0, drawings: [], batches: [], settings: Object.assign({}, DEFAULT_SETTINGS) };
}
const db = loadDb();
localOrigins.forEach((o) => { if (db.settings.qmsOrigins.indexOf(o) < 0) db.settings.qmsOrigins.push(o); });
function persist() { const tmp = DB_FILE + '.tmp'; writeFileSync(tmp, JSON.stringify(db)); renameSync(tmp, DB_FILE); }
persist();
const newId = (p) => p + (++db.seq).toString(36) + randomBytes(2).toString('hex');
const now = () => new Date().toISOString();
const dateCode = () => { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); };

/* ---------------- HTTP 小工具 ---------------- */
class HttpError extends Error { constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details || null; } }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.gz': 'application/octet-stream', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
function send(res, status, body, headers) { res.writeHead(status, Object.assign({ 'X-Content-Type-Options': 'nosniff' }, headers || {})); res.end(body); }
function json(res, status, obj, headers) { send(res, status, JSON.stringify(obj), Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {})); }
function fail(res, err, headers) {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  json(res, status, { error: { code: err.code || 'INTERNAL', message: err.message || '服务内部错误', details: err.details || null, retryable: status >= 500 || status === 429 }, request_id: 'req_' + randomBytes(6).toString('hex') }, headers);
}
function readBody(req, limit) {
  return new Promise((resolveP, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', '上传内容超过 ' + Math.round(limit / 1048576) + ' MB')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolveP({});
      try { resolveP(JSON.parse(raw)); } catch (e) { reject(new HttpError(400, 'BAD_JSON', '请求内容不是合法的 JSON')); }
    });
    req.on('error', reject);
  });
}
function allowedOrigin(req) { const o = req.headers.origin; return o && db.settings.qmsOrigins.indexOf(o) >= 0 ? o : ''; }
function corsHeaders(req) { const o = allowedOrigin(req); return o ? { 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } : { Vary: 'Origin' }; }
function frameHeaders() { return { 'Content-Security-Policy': "frame-ancestors 'self' " + db.settings.qmsOrigins.join(' ') }; }
function serveFile(res, file, headers) {
  let st;
  try { st = statSync(file); } catch (e) { return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' }); }
  if (!st.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  res.writeHead(200, Object.assign({ 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' }, headers || {}));
  createReadStream(file).pipe(res);
}
function safeJoin(base, rel) {
  const full = normalize(join(base, decodeURIComponent(rel)));
  return full === base || full.startsWith(base + sep) ? full : null;
}

/* ---------------- 业务 ---------------- */
const REV_RE = /^[A-Za-z0-9.\-]{1,8}$/;
function findDrawing(id) { const d = db.drawings.find((x) => x.id === id); if (!d) throw new HttpError(404, 'NOT_FOUND', '图纸不存在'); return d; }
function findRev(d, rid) { const r = d.revisions.find((x) => x.id === rid); if (!r) throw new HttpError(404, 'NOT_FOUND', '版本不存在'); return r; }
function fileUrl(name) { return '/api/v1/files/' + name; }
function saveFile(name, base64) {
  if (typeof base64 !== 'string' || !base64) throw new HttpError(422, 'VALIDATION_FAILED', '缺少文件内容');
  const buf = Buffer.from(base64, 'base64');
  writeFileSync(join(FILES, name), buf);
  return buf;
}
function dropFiles(prefix) { readdirSync(FILES).filter((f) => f.indexOf(prefix) === 0).forEach((f) => { try { unlinkSync(join(FILES, f)); } catch (e) { /* 忽略 */ } }); }
function summary(d) {
  const r = d.revisions[d.revisions.length - 1] || null;
  return {
    id: d.id, drawingNo: d.drawingNo, name: d.name, partNo: d.partNo, material: d.material, revCount: d.revisions.length, createdAt: d.createdAt, updatedAt: d.updatedAt,
    latest: r ? { id: r.id, rev: r.rev, status: r.status, charCount: (r.chars || []).length, confirmedCount: (r.chars || []).filter((c) => c.status === 'confirmed').length, updatedAt: r.updatedAt, thumb: r.pages && r.pages[0] ? r.pages[0].image : '', syncBatchId: r.sync ? r.sync.syncBatchId : '', fetchedAt: r.sync ? r.sync.fetchedAt || '' : '' } : null,
    sig: (r && r.sig) || null,
  };
}
function maxSeq(d) { let m = d.cidSeq || 0; d.revisions.forEach((r) => (r.chars || []).forEach((c) => { const x = /-(\d{4,})$/.exec(c.cid || ''); if (x) m = Math.max(m, parseInt(x[1], 10)); })); return m; }
function batchItem(b) { const p = b.payload; return { syncBatchId: b.syncBatchId, seq: b.seq, drawingNo: p.drawingNo, drawingRev: p.drawingRev, partNo: p.partNo, contentHash: b.contentHash, balloonCount: p.balloons.length, frozenAt: p.frozenAt }; }
function absUrl(req, u) { return u ? 'http://' + (req.headers.host || HOST + ':' + PORT) + u : ''; }

const PATCH_KEYS = ['status', 'textSource', 'pages', 'chars', 'mapping', 'sig', 'unused', 'notes', 'title', 'generalTol', 'generalTolAssumed', 'recognizedAt'];

async function api(req, res, url) {
  const p = url.pathname.replace(/\/+$/, '');
  const m = req.method;
  const seg = p.split('/').slice(3); // /api/v1/...
  const isOpen = seg[0] === 'open' || seg[0] === 'files';
  const extra = isOpen ? corsHeaders(req) : {};
  if (m === 'OPTIONS') return send(res, 204, '', extra);
  try {
    if (seg[0] === 'health' && m === 'GET') return json(res, 200, { ok: true, name: 'worlder-bubble', version: VERSION, time: now(), dataDir: DATA, qmsUrl: QMS_PORT ? 'http://localhost:' + QMS_PORT : '' }, corsHeaders(req));
    if (seg[0] === 'settings') {
      if (m === 'GET') return json(res, 200, db.settings);
      if (m === 'PUT') {
        const b = await readBody(req, 1 << 20), s = db.settings;
        if (b.qmsOrigins !== undefined) {
          if (!Array.isArray(b.qmsOrigins) || b.qmsOrigins.some((o) => typeof o !== 'string' || !/^https?:\/\/[^/\s]+$/.test(o))) throw new HttpError(422, 'VALIDATION_FAILED', 'QMS 地址格式不对，应为 http(s)://主机:端口');
          s.qmsOrigins = Array.from(new Set(b.qmsOrigins));
        }
        if (b.defaultGeneralTol !== undefined) { if (['', 'f', 'm', 'c', 'v'].indexOf(b.defaultGeneralTol) < 0) throw new HttpError(422, 'VALIDATION_FAILED', '未注公差等级只能是 f / m / c / v'); s.defaultGeneralTol = b.defaultGeneralTol; }
        if (b.ocrLangs !== undefined) { if (['eng', 'eng+chi_sim'].indexOf(b.ocrLangs) < 0) throw new HttpError(422, 'VALIDATION_FAILED', '不支持的 OCR 语言'); s.ocrLangs = b.ocrLangs; }
        if (b.ocrMode !== undefined) { if (['auto', 'always', 'never'].indexOf(b.ocrMode) < 0) throw new HttpError(422, 'VALIDATION_FAILED', '不支持的 OCR 模式'); s.ocrMode = b.ocrMode; }
        if (b.renderWidth !== undefined) s.renderWidth = Math.max(1200, Math.min(4000, parseInt(b.renderWidth, 10) || 2200));
        if (b.localUser !== undefined) s.localUser = String(b.localUser).slice(0, 40) || '本机用户';
        persist();
        return json(res, 200, s);
      }
    }
    if (seg[0] === 'drawings') {
      if (seg.length === 1 && m === 'GET') return json(res, 200, { items: db.drawings.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map(summary) });
      if (seg.length === 1 && m === 'POST') {
        const b = await readBody(req, 1 << 20);
        const no = String(b.drawingNo || '').trim();
        if (!no || no.length > 64) throw new HttpError(422, 'VALIDATION_FAILED', '图号必填，且不超过 64 个字符');
        if (db.drawings.some((d) => d.drawingNo.toLowerCase() === no.toLowerCase())) throw new HttpError(409, 'DUPLICATE', '图号 ' + no + ' 已存在：请作为它的新版本上传');
        const d = { id: newId('d'), drawingNo: no, name: String(b.name || '').slice(0, 60), partNo: String(b.partNo || '').slice(0, 64), material: String(b.material || '').slice(0, 60), generalTol: b.generalTol || '', cidSeq: 0, revisions: [], createdAt: now(), updatedAt: now() };
        db.drawings.push(d); persist();
        return json(res, 201, summary(d));
      }
      const d = findDrawing(seg[1]);
      if (seg.length === 2) {
        if (m === 'GET') return json(res, 200, d);
        if (m === 'PATCH') {
          const b = await readBody(req, 1 << 20);
          ['name', 'partNo', 'material'].forEach((k) => { if (b[k] !== undefined) d[k] = String(b[k]).slice(0, 64); });
          d.updatedAt = now(); persist();
          return json(res, 200, summary(d));
        }
        if (m === 'DELETE') {
          if (d.revisions.some((r) => r.status === 'frozen')) throw new HttpError(409, 'INVALID_STATE', '这张图纸有已冻结的版本，不能删除（冻结结果可能已被 QMS 引用）');
          d.revisions.forEach((r) => dropFiles(r.id + '-'));
          db.drawings.splice(db.drawings.indexOf(d), 1); persist();
          return json(res, 200, { ok: true });
        }
      }
      if (seg[2] === 'revisions') {
        if (seg.length === 3 && m === 'POST') {
          const b = await readBody(req, 80 << 20);
          const label = String(b.rev || '').trim();
          if (!REV_RE.test(label)) throw new HttpError(422, 'VALIDATION_FAILED', '版本号只能用字母、数字、点和横线，不超过 8 位');
          if (d.revisions.some((r) => r.rev === label)) throw new HttpError(409, 'DUPLICATE', 'Rev ' + label + ' 已存在');
          if (d.revisions.some((r) => r.status !== 'frozen')) throw new HttpError(409, 'INVALID_STATE', '还有没冻结的版本，请先冻结或删除');
          const f = b.file || {};
          const id = newId('r');
          const ext = { pdf: '.pdf', svg: '.svg', image: /jpe?g/i.test(f.type || f.name || '') ? '.jpg' : '.png' }[f.kind] || '';
          if (!ext) throw new HttpError(422, 'VALIDATION_FAILED', '只支持 PDF、PNG、JPG、SVG');
          const name = id + '-orig' + ext;
          const buf = saveFile(name, f.base64);
          const hash = sha256(buf);
          if (f.sha256 && f.sha256 !== hash) { unlinkSync(join(FILES, name)); throw new HttpError(422, 'VALIDATION_FAILED', '文件摘要与上传内容不一致，请重新上传'); }
          const rev = { id, rev: label, status: 'new', version: 1, file: { name: String(f.name || name).slice(0, 120), type: f.type || MIME[ext], kind: f.kind, size: buf.length, sha256: hash, url: fileUrl(name) }, pages: [], chars: [], unused: [], notes: [], mapping: null, sig: null, createdAt: now(), updatedAt: now() };
          d.revisions.push(rev); d.updatedAt = now(); persist();
          return json(res, 201, rev);
        }
        const r = findRev(d, seg[3]);
        if (seg.length === 4 && m === 'PUT') {
          const b = await readBody(req, 40 << 20);
          if (r.status === 'frozen') throw new HttpError(409, 'INVALID_STATE', '这个版本已冻结，不能修改；修改请上传新版本');
          if (b.expectedVersion !== r.version) throw new HttpError(409, 'VERSION_CONFLICT', '这个版本已在别处被修改，请刷新后重试', { expectedVersion: b.expectedVersion, currentVersion: r.version });
          const patch = b.patch || {};
          if (patch.chars !== undefined && (!Array.isArray(patch.chars) || patch.chars.some((c) => !c || typeof c.cid !== 'string' || !c.cid))) throw new HttpError(422, 'VALIDATION_FAILED', '特性数据不完整（缺少特性 ID）');
          if (patch.status !== undefined && ['new', 'review'].indexOf(patch.status) < 0) throw new HttpError(422, 'VALIDATION_FAILED', '只能通过冻结接口改为已冻结');
          PATCH_KEYS.forEach((k) => { if (patch[k] !== undefined) r[k] = patch[k]; });
          r.version += 1; r.updatedAt = now(); d.updatedAt = r.updatedAt; d.cidSeq = maxSeq(d);
          persist();
          return json(res, 200, { id: r.id, version: r.version, updatedAt: r.updatedAt, status: r.status });
        }
        if (seg.length === 4 && m === 'DELETE') {
          if (r.status === 'frozen') throw new HttpError(409, 'INVALID_STATE', '已冻结的版本不能删除');
          dropFiles(r.id + '-');
          d.revisions.splice(d.revisions.indexOf(r), 1);
          if (!d.revisions.length) db.drawings.splice(db.drawings.indexOf(d), 1);
          else d.updatedAt = now();
          persist();
          return json(res, 200, { ok: true });
        }
        if (seg[4] === 'pages' && m === 'POST') {
          const b = await readBody(req, 40 << 20);
          const n = parseInt(b.page, 10);
          if (!(n >= 1 && n <= 50)) throw new HttpError(422, 'VALIDATION_FAILED', '页码不对');
          const name = r.id + '-p' + n + '.jpg';
          saveFile(name, b.base64);
          return json(res, 201, { url: fileUrl(name) });
        }
        if (seg[4] === 'freeze' && m === 'POST') {
          const b = await readBody(req, 120 << 20);
          if (r.status === 'frozen') throw new HttpError(409, 'INVALID_STATE', '这个版本已经冻结过了');
          if (b.expectedVersion !== r.version) throw new HttpError(409, 'VERSION_CONFLICT', '这个版本已在别处被修改，请刷新后重试', { expectedVersion: b.expectedVersion, currentVersion: r.version });
          const problems = E.freezeProblems(r.chars || [], r.mapping);
          if (problems.length) throw new HttpError(422, 'VALIDATION_FAILED', '还不能冻结：' + problems.slice(0, 3).join('；') + (problems.length > 3 ? ' 等 ' + problems.length + ' 项' : ''), { problems });
          const frozenAt = now(), frozenBy = String(b.frozenBy || '本机用户').slice(0, 40);
          db.batchSeq = (db.batchSeq || 0) + 1;
          const syncBatchId = 'SYNC-' + dateCode() + '-' + String(db.batchSeq).padStart(4, '0');
          let annotated = '';
          if (b.annotatedPdfBase64) { annotated = r.id + '-ballooned.pdf'; saveFile(annotated, b.annotatedPdfBase64); }
          const ballooned = {};
          (b.balloonedPages || []).forEach((x) => { const n = parseInt(x.page, 10); if (n >= 1 && n <= 50 && x.base64) { const nm = r.id + '-b' + n + '.jpg'; saveFile(nm, x.base64); ballooned[n] = fileUrl(nm); } });
          const balloons = (r.chars || []).slice().sort((x, y) => x.no - y.no).map((c) => E.toBalloon(c, r.pages));
          const payload = { syncBatchId, partNo: d.partNo, drawingNo: d.drawingNo, drawingRev: r.rev, drawingName: d.name, material: d.material, generalTol: r.generalTol || '', frozenAt, frozenBy, sourceFileSha256: r.file ? r.file.sha256 : '', balloons };
          const contentHash = 'sha256:' + sha256(E.canonicalSync(payload));
          payload.contentHash = contentHash;
          db.batches.push({ syncBatchId, seq: db.batchSeq, drawingId: d.id, revId: r.id, payload, contentHash, createdAt: frozenAt, fetchedAt: '', fetchCount: 0, annotatedFile: annotated ? fileUrl(annotated) : '', pages: (r.pages || []).map((pg) => ({ page: pg.page, w: pg.w, h: pg.h, image: pg.image, ballooned: ballooned[pg.page] || '' })) });
          Object.assign(r, { status: 'frozen', frozenAt, frozenBy, annotatedFileUrl: annotated ? fileUrl(annotated) : '', sync: { syncBatchId, contentHash, frozenAt, fetchedAt: '' } });
          r.version += 1; r.updatedAt = frozenAt; d.updatedAt = frozenAt; d.cidSeq = maxSeq(d);
          persist();
          return json(res, 200, { syncBatchId, contentHash, frozenAt, balloonCount: balloons.length, annotatedFileUrl: r.annotatedFileUrl });
        }
      }
    }
    if (seg[0] === 'open' && seg[1] === 'balloon-sync' && m === 'GET') {
      if (seg.length === 2) {
        const after = parseInt(url.searchParams.get('after') || '0', 10) || 0;
        const items = db.batches.filter((b) => b.seq > after).map(batchItem);
        return json(res, 200, { items, lastSeq: db.batchSeq || 0 }, extra);
      }
      const b = db.batches.find((x) => x.syncBatchId === decodeURIComponent(seg[2]));
      if (!b) throw new HttpError(404, 'NOT_FOUND', '同步批次 ' + seg[2] + ' 不存在');
      if (!b.fetchedAt) b.fetchedAt = now();
      b.fetchCount = (b.fetchCount || 0) + 1;
      const d = db.drawings.find((x) => x.id === b.drawingId);
      const r = d && d.revisions.find((x) => x.id === b.revId);
      if (r && r.sync && !r.sync.fetchedAt) { r.sync.fetchedAt = b.fetchedAt; r.sync.fetchedBy = req.headers.origin || ''; }
      persist();
      return json(res, 200, Object.assign({}, b.payload, {
        annotatedFileUrl: absUrl(req, b.annotatedFile),
        drawing: { pages: b.pages.map((pg) => ({ page: pg.page, width: pg.w, height: pg.h, imageUrl: absUrl(req, pg.image), balloonedUrl: absUrl(req, pg.ballooned) })) },
      }), extra);
    }
    if (seg[0] === 'files' && seg.length === 2 && m === 'GET') {
      if (!/^[\w.\-]+$/.test(seg[1])) throw new HttpError(400, 'BAD_REQUEST', '文件名不对');
      return serveFile(res, join(FILES, seg[1]), Object.assign({ 'Cache-Control': 'private, max-age=31536000, immutable' }, extra));
    }
    if (seg[0] === 'export' && m === 'GET') return send(res, 200, JSON.stringify(db, null, 1), { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="bubble-data-' + dateCode() + '.json"' });
    if (seg[0] === 'reset' && m === 'POST') {
      const b = await readBody(req, 1 << 16);
      if (b.confirm !== 'RESET') throw new HttpError(422, 'VALIDATION_FAILED', '需要确认');
      readdirSync(FILES).forEach((f) => { try { unlinkSync(join(FILES, f)); } catch (e) { /* 忽略 */ } });
      Object.assign(db, { drawings: [], batches: [] });
      persist();
      return json(res, 200, { ok: true });
    }
    throw new HttpError(404, 'NOT_FOUND', '没有这个接口：' + m + ' ' + p);
  } catch (err) { return fail(res, err, extra); }
}

/* ---------------- 气泡识别服务（页面 + 接口） ---------------- */
const bubble = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p.indexOf('/api/v1/') === 0 || p === '/api/v1') return api(req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  if (p === '/' || p === '/index.html' || p === '/dev.html') {
    const built = join(root, 'dist', 'bubble.html');
    const file = p === '/' && existsSync(built) ? built : join(root, 'index.html');
    return serveFile(res, file, frameHeaders());
  }
  if (p === '/favicon.ico') return send(res, 204, '');
  const top = p.split('/')[1];
  if (['vendor', 'samples', 'src', 'styles'].indexOf(top) < 0) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  const file = safeJoin(root, p.slice(1));
  if (!file) return send(res, 403, 'Forbidden');
  return serveFile(res, file);
});

/* ---------------- 托管 QMS 原型（单独端口 = 单独的来源，和正式环境一样走白名单） ---------------- */
const qms = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  if (p === '/') {
    const built = join(QMS_DIR, 'qms_pro_qms.html');
    return serveFile(res, existsSync(built) ? built : join(QMS_DIR, 'index.html'));
  }
  if (p.split('/').some((s) => s === 'node_modules' || s.indexOf('.') === 0)) return send(res, 404, 'Not found');
  const file = safeJoin(QMS_DIR, p.slice(1));
  if (!file) return send(res, 403, 'Forbidden');
  return serveFile(res, file);
});

bubble.listen(PORT, HOST, () => {
  const show = HOST === '0.0.0.0' ? 'localhost' : HOST === '127.0.0.1' ? 'localhost' : HOST;
  console.log('Worlder 气泡识别服务已启动');
  console.log('  气泡识别：http://' + show + ':' + PORT + (existsSync(join(root, 'dist', 'bubble.html')) ? '' : '   （未构建，使用 index.html 开发入口）'));
  if (QMS_PORT && existsSync(QMS_DIR)) {
    qms.listen(QMS_PORT, HOST, () => {
      console.log('  QMS 原型：http://' + show + ':' + QMS_PORT + '   （' + (existsSync(join(QMS_DIR, 'qms_pro_qms.html')) ? 'qms_pro_qms.html' : 'index.html') + '）');
      console.log('  数据目录：' + DATA);
      console.log('按 Ctrl+C 停止');
    });
    qms.on('error', (e) => console.error('QMS 端口 ' + QMS_PORT + ' 启动失败：' + e.message));
  } else {
    console.log('  数据目录：' + DATA);
    if (QMS_PORT) console.log('  （没有找到 QMS 原型目录 ' + QMS_DIR + '，只启动气泡识别服务）');
  }
});
bubble.on('error', (e) => { console.error('端口 ' + PORT + ' 启动失败：' + e.message); process.exit(1); });

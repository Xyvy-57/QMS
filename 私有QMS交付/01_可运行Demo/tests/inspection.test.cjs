const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
function setup() {
  const callbacks = {}, nodes = {}, messages = [], canvases = [], downloads = [];
  const page = { addEventListener(type, callback) { callbacks[type] = callback; } };
  nodes.page = page;
  const fakeContext = { scale() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, clearRect() {}, fillRect() {}, drawImage() {} };
  function canvas() { const c = { width: 0, height: 0, events: {}, parentElement: { classList: { add() {}, remove() {} } }, getBoundingClientRect: () => ({ width: 500, height: 195, left: 0, top: 0 }), getContext: () => fakeContext, addEventListener(type, cb) { this.events[type] = cb; }, setPointerCapture() {}, toDataURL: type => type === 'image/jpeg' ? 'data:image/jpeg;base64,PHOTO' : png }; canvases.push(c); return c; }
  const context = {
    console, Date, Math, Blob, atob, AbortController, URLSearchParams, devicePixelRatio: 2,
    setTimeout: cb => { cb(); return 0; }, clearTimeout() {},
    history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {} },
    URL: { createObjectURL(blob) { downloads.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '#182128' }),
    document: {
      documentElement: {}, body: { classList: { add() {}, remove() {} }, appendChild() {} },
      getElementById: id => nodes[id] || null,
      querySelectorAll: () => [], querySelector: () => null,
      createElement: tag => tag === 'canvas' ? canvas() : { click() {}, remove() {}, appendChild() {} }
    }
  };
  context.window = context;
  context.UI = { e: v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), icon: () => '', badge: (v, tone) => `<span class="tag ${tone}">${String(v)}</span>`, toast: m => messages.push(m), close() {}, modal() {}, drawer() {} };
  context.App = { go(route, params) { context.lastNavigation = { route, params }; }, render() {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/inspection.js'), 'utf8'), context);
  const plan = context.QMS.db.plans.find(p => p.status === 'published');
  const task = context.QMS.createTask({ standardId: plan.standardId, planId: plan.id, scenario: plan.scenario, batch: 'TEST-BATCH', quantity: 100, inspector: '测试检验员', reviewRequired: false });
  const round = context.QMS.getRound(task);
  function click(action, extra = {}) { callbacks.click({ target: { closest: () => ({ dataset: { inspectionAction: action, ...extra } }) } }); }
  function fill() { for (const item of task.standardSnapshot.items) round.measurements[item.id] = Array.from({ length: round.itemSampleCounts?.[item.id] || round.sampleCount }, () => item.kind === 'attribute' ? 'pass' : String(item.nominal)); }
  function complete() { fill(); round.signatures.inspector = { name: '测试检验员', signedAt: context.QMS.now(), dataUrl: png }; const result = context.QMS.completeRound(task.id); assert.equal(result.ok, true, result.error); return result.report; }
  return { c: context, task, round, plan, callbacks, nodes, messages, canvases, downloads, canvas, click, fill, complete };
}
test('five scenario entries share working task lists', () => {
  const { c } = setup();
  for (const scenario of ['IQC', 'FIRST', 'IPQC', 'FQC', 'OQC']) assert.match(c.InspectionPage.render({ scenario }), /新建检验任务/);
});
test('variable per-characteristic sampling leaves unrequired cells without inputs', () => {
  const { c, task, round } = setup();
  const item = task.standardSnapshot.items[0]; round.sampleCount = 4; round.itemSampleCounts[item.id] = 1;
  const html = c.InspectionPage.render({ taskId: task.id });
  const row = html.split(`data-item-row="${item.id}"`)[1].split('</tr>')[0];
  assert.equal((row.match(/data-sample=/g) || []).length, 1);
  assert.equal((row.match(/本项方案未要求此样本/g) || []).length, 3);
});
test('report keeps completed photos, signatures and values after source changes', () => {
  const { c, task, round, complete } = setup();
  round.photos.push({ id: 'p1', name: '检验现场.png', dataUrl: png });
  const report = complete(); const before = c.ReportPage.render({ reportId: report.id });
  task.batch = 'CHANGED'; task.standardSnapshot.name = 'CHANGED'; round.photos = []; round.signatures = {}; round.measurements = {};
  const after = c.ReportPage.render({ reportId: report.id });
  assert.equal(after, before); assert.match(after, /TEST-BATCH/); assert.match(after, /检验现场.png/); assert.match(after, /未作批判定/); assert.doesNotMatch(after, /CHANGED/);
});
test('handwriting uses high-DPI canvas and changes to measurements invalidate signatures', () => {
  const s = setup(), { c, task, round, nodes, canvas, click, callbacks } = s;
  c.InspectionPage.render({ taskId: task.id }); c.InspectionPage.bind({ taskId: task.id });
  const buttons = {}; const form = { elements: { signer: { value: '测试检验员' } }, querySelector: selector => buttons[selector] ||= {} };
  nodes['inspection-sign-form'] = form; nodes['inspection-sign-canvas'] = canvas(); nodes['inspection-sign-region'] = { innerHTML: '' };
  click('sign', { signature: 'inspector' }); const pad = nodes['inspection-sign-canvas'];
  assert.equal(pad.width, 1000); assert.equal(pad.height, 390);
  pad.events.pointerdown({ pointerId: 1, clientX: 20, clientY: 20, preventDefault() {} }); pad.events.pointermove({ clientX: 50, clientY: 40, preventDefault() {} }); pad.events.pointerup();
  form.onsubmit({ preventDefault() {} }); assert.equal(round.signatures.inspector.name, '测试检验员'); assert.equal(round.signatures.inspector.dataUrl, png); assert.match(nodes['inspection-sign-region'].innerHTML, /tag green.*?已签名/); assert.match(nodes['inspection-sign-region'].innerHTML, /未要求签名/);
  const item = task.standardSnapshot.items[0], input = { dataset: { itemId: item.id, sample: '0' }, value: String(item.nominal), closest() { return this; } };
  callbacks.input({ target: input }); assert.deepEqual(Object.keys(round.signatures), []);
});
test('CSV escapes spreadsheet formulas and retains snapshot scope', async () => {
  const s = setup(), { c, downloads, click, complete } = s; const report = complete();
  report.taskSnapshot.batch = '=HYPERLINK("bad")'; c.ReportPage.bind({ reportId: report.id }); click('report-csv');
  const csv = await downloads.at(-1).text(); assert.match(csv, /'\=HYPERLINK/); assert.match(csv, /未作批判定/); assert.match(csv, /CSV 不包含图片或手写笔迹/);
});
test('record content is escaped in task and report views', () => {
  const { c, task, complete } = setup(); task.standardSnapshot.name = '<img src=x onerror=alert(1)>'; task.batch = '<script>bad()</script>';
  const work = c.InspectionPage.render({ taskId: task.id }); assert.match(work, /&lt;img/); assert.doesNotMatch(work, /<script>bad/);
  const report = complete(); const html = c.ReportPage.render({ reportId: report.id }); assert.match(html, /&lt;script&gt;bad/);
});
test('photo compression caps long edge and prevents completion while decoding', async () => {
  const s = setup(), { c, task, round, callbacks, nodes, click, fill, canvases, messages } = s; fill(); round.signatures.inspector = { name: '测试检验员', dataUrl: png };
  const pendingImages = []; c.Image = class { constructor() { this.naturalWidth = 4000; this.naturalHeight = 3000; pendingImages.push(this); } set src(v) {} };
  nodes['inspection-photo-region'] = { innerHTML: '' }; nodes['inspection-sign-region'] = { innerHTML: '' };
  c.InspectionPage.render({ taskId: task.id }); c.InspectionPage.bind({ taskId: task.id });
  callbacks.change({ target: { id: 'inspection-photos', files: [{ type: 'image/jpeg', name: '现场.jpg', size: 1000 }] } });
  click('complete'); assert.equal(round.status, 'draft'); assert.ok(messages.some(m => m.includes('照片仍在处理中')));
  pendingImages[0].onload(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(canvases.at(-1).width, 1280); assert.equal(canvases.at(-1).height, 960); assert.equal(round.photos.length, 1); assert.deepEqual(Object.keys(round.signatures), []);
});

/* =====================================================================
 * 标注工作台：左边图纸（拖动气泡、框选识别、点放气泡），右边特性清单与编辑；换版映射；冻结并同步给 QMS；导出
 * ===================================================================== */

const EDIT_SPEC_FIELDS = ['cat', 'kind', 'sym', 'nominal', 'upper', 'lower', 'lsl', 'usl', 'unit', 'spec', 'fit'];
const TOOLS = [
  { key: 'select', label: '选择', icon: 'pointer', kbd: 'V', tip: '点气泡选中，拖动气泡调整位置' },
  { key: 'hand', label: '平移', icon: 'hand', kbd: 'H', tip: '拖动图纸（任何工具下按住空格也可以）' },
  { key: 'box', label: '框选识别', icon: 'box-select', kbd: 'R', tip: '框住一个标注，只识别框里的文字并加一个气泡' },
  { key: 'place', label: '加气泡', icon: 'balloon', kbd: 'B', tip: '在图上点一下放气泡，再手工填写规格' },
];

function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function charsCsv(chars) {
  const head = ['气泡号', '特性ID', '名称', '类别', '判定方式', '符号', '名义值', '上偏差', '下偏差', '下限', '上限', '单位', '特殊特性', '数量', '检验要求', '公差来源', '图面原文', '页码', '校核'];
  const rows = chars.slice().sort((a, b) => a.no - b.no).map((c) => [c.no, c.cid, c.name, c.cat, c.kind === 'count' ? '计数' : '计量', c.sym, c.nominal, c.upper, c.lower, c.lsl, c.usl, c.unit, c.cls, c.qty, c.spec, (TOL_SOURCE[c.tolSource] || ['—'])[0], c.sourceText, c.page, c.status === 'confirmed' ? '已确认' : '待核对']);
  return String.fromCharCode(0xfeff) + [head].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

COMPONENTS['page-annotate'] = {
  setup() {
    const st = reactive({
      loading: true, error: '', drawing: null, rev: null, page: 1, tool: 'select', sel: null, filter: 'all', tab: 'chars', boxes: false, colorBy: 'status', q: '',
      saving: false, dirty: false, savedAt: null, recog: null, pending: null, pendingText: '', rectBusy: false, freeze: null, exportMenu: false,
    });
    const chars = ref([]);
    let undoStack = [];

    const frozen = computed(() => !!st.rev && st.rev.status === 'frozen');
    const pages = computed(() => (st.rev && st.rev.pages) || []);
    const pageMeta = computed(() => pages.value[st.page - 1] || null);
    const pageChars = computed(() => chars.value.filter((c) => (c.page || 1) === st.page));
    const selChar = computed(() => chars.value.find((c) => c.cid === st.sel) || null);
    const mapping = computed(() => (st.rev && st.rev.mapping) || null);
    const mapOf = (cid) => (mapping.value ? mapping.value.items.find((m) => m.cid === cid) || null : null);
    const counts = computed(() => ({ total: chars.value.length, confirmed: chars.value.filter((c) => c.status === 'confirmed').length, review: chars.value.filter(needsReview).length }));
    const listed = computed(() => {
      const k = st.q.trim().toLowerCase();
      return chars.value.filter((c) => (st.filter === 'all' || (st.filter === 'review' ? c.status !== 'confirmed' : c.status === 'confirmed'))
        && (!k || (c.no + ' ' + c.name + ' ' + c.sourceText + ' ' + c.cid).toLowerCase().includes(k))).sort((a, b) => a.no - b.no);
    });
    const unusedOnPage = computed(() => ((st.rev && st.rev.unused) || []).filter((u) => (u.page || 1) === st.page));
    const ctx = computed(() => ({ generalTol: (st.rev && st.rev.generalTol) || S.settings.defaultGeneralTol || '' }));
    const baseRev = computed(() => (mapping.value && st.drawing ? revOf(st.drawing, mapping.value.baseRevId) : null));
    const mapCounts = computed(() => {
      const o = { same: 0, changed: 0, added: 0, uncertain: 0, removed: mapping.value ? mapping.value.removed.length : 0 };
      if (mapping.value) mapping.value.items.forEach((m) => { o[m.kind] = (o[m.kind] || 0) + 1; });
      return o;
    });
    const fetched = computed(() => !!(st.rev && st.rev.sync && st.rev.sync.fetchedAt));
    const flow = computed(() => {
      const r = st.rev;
      if (!r) return [];
      const all = counts.value.total && counts.value.confirmed === counts.value.total;
      return [
        { key: 'upload', label: '上传', state: 'done' },
        { key: 'recognize', label: '识别', state: r.status === 'new' ? 'current' : 'done', badge: r.status === 'new' ? '' : (r.textSource === 'ocr' ? 'OCR' : '矢量') },
        { key: 'review', label: '校核', state: frozen.value || all ? 'done' : r.status === 'new' ? 'todo' : 'current', badge: counts.value.total ? counts.value.confirmed + '/' + counts.value.total : '' },
        { key: 'freeze', label: '冻结', state: frozen.value ? 'done' : all ? 'current' : 'todo' },
        { key: 'sync', label: 'QMS 同步', state: fetched.value ? 'done' : frozen.value ? 'current' : 'todo', badge: fetched.value ? '已拉取' : frozen.value ? '等待 QMS' : '' },
      ];
    });
    const hint = computed(() => {
      const r = st.rev;
      if (!r) return null;
      if (r.status === 'new') return { text: '这个版本还没有识别结果', btn: '开始识别', act: 'recognize' };
      if (frozen.value) return fetched.value ? { text: '已冻结，QMS 已于 ' + fmtTime(r.sync.fetchedAt) + ' 拉取。修改要上传新版本。', btn: '', act: '' } : { text: '已冻结，等待 QMS 拉取（在 QMS 的“气泡识别”页面会自动收到）', btn: '', act: '' };
      const unc = mapCounts.value.uncertain;
      if (unc) return { text: '换版映射有 ' + unc + ' 项无法确认：先选定对应的旧特性', btn: '去处理', act: 'mapping' };
      const left = counts.value.total - counts.value.confirmed;
      if (left) {
        const first = chars.value.filter((c) => c.status !== 'confirmed').sort((a, b) => a.no - b.no)[0];
        return { text: '还有 ' + left + ' 项没校核' + (counts.value.review ? '（其中 ' + counts.value.review + ' 项需要重点核对）' : '') + '：从 #' + first.no + ' 开始', btn: '核对 #' + first.no, act: 'next' };
      }
      return { text: '全部 ' + counts.value.total + ' 项已校核，可以冻结并同步给 QMS', btn: '冻结并同步', act: 'freeze' };
    });

    /* —— 加载与保存 —— */
    const load = async () => {
      st.loading = true; st.error = '';
      try {
        const d = await api('GET', '/drawings/' + UI.route.params.id);
        const r = (UI.route.params.rev && revOf(d, UI.route.params.rev)) || latestRev(d);
        if (!r) throw new Error('这张图纸还没有版本');
        st.drawing = d; st.rev = r; st.page = 1; st.sel = null; st.pending = null;
        chars.value = clone(r.chars || []);
        undoStack = [];
        st.tab = r.mapping && r.mapping.items.some((m) => m.kind === 'uncertain') ? 'mapping' : 'chars';
      } catch (e) { st.error = e.message || String(e); }
      st.loading = false;
    };
    onMounted(load);
    watch(() => UI.route.params.rev, (v, o) => { if (v && v !== o && UI.route.name === 'annotate') load(); });
    const doSave = async () => {
      if (!st.rev || frozen.value || !st.dirty) return;
      st.saving = true;
      try {
        const r = await api('PUT', '/drawings/' + st.drawing.id + '/revisions/' + st.rev.id, { expectedVersion: st.rev.version, patch: { chars: chars.value, mapping: st.rev.mapping, sig: { feats: featureSig(chars.value), dhash: (st.rev.sig && st.rev.sig.dhash) || '' } } });
        st.rev.version = r.version; st.rev.updatedAt = r.updatedAt; st.dirty = false; st.savedAt = new Date().toISOString();
      } catch (e) {
        if (e.code === 'VERSION_CONFLICT') { toast('这张图纸在别的窗口里被修改过，已重新加载最新内容', 'warn'); await load(); }
        else toast('保存失败：' + e.message, 'error');
      }
      st.saving = false;
    };
    const save = debounce(doSave, 700);
    onBeforeUnmount(() => { if (st.dirty) save.flush(); });
    const touch = () => { st.dirty = true; save(); };
    const snapshot = () => { undoStack.push(JSON.stringify({ chars: chars.value, mapping: st.rev.mapping })); if (undoStack.length > 40) undoStack.shift(); };
    const undo = () => {
      if (frozen.value || !undoStack.length) { toast('没有可以撤销的操作', 'info'); return; }
      const x = JSON.parse(undoStack.pop());
      chars.value = x.chars; st.rev.mapping = x.mapping; touch(); toast('已撤销', 'info');
    };

    /* —— 编辑 —— */
    const select = (cid) => { st.sel = cid; st.pending = null; const c = chars.value.find((x) => x.cid === cid); if (c && (c.page || 1) !== st.page) st.page = c.page || 1; nextTick(() => { const el = document.querySelector('[data-row="' + cid + '"]'); if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }); };
    const setField = (c, f, v) => {
      if (frozen.value) return;
      snapshot();
      c[f] = v;
      if (['nominal', 'upper', 'lower'].indexOf(f) >= 0) { recomputeLimits(c); c.tolSource = 'manual'; c.tolNote = '手工修改'; }
      if (['lsl', 'usl'].indexOf(f) >= 0) { c.tolSource = 'manual'; c.tolNote = '手工修改'; }
      if (f === 'kind' && v === 'count') { c.unit = '件'; if (!c.spec) c.spec = c.cat === '螺纹' ? '螺纹量规检验：通规通过、止规止住' : '按图纸要求目视检验'; }
      if (EDIT_SPEC_FIELDS.indexOf(f) >= 0) c.status = 'auto';
      const m = mapOf(c.cid);
      if (m && baseRev.value && (m.kind === 'same' || m.kind === 'changed')) { const o = baseRev.value.chars.find((x) => x.cid === m.oldCid); if (o) { m.changes = specDiff(o, c); m.kind = m.changes.length ? 'changed' : 'same'; } }
      touch();
    };
    const applyText = (c, text) => {
      const r = parseSpec(text, ctx.value);
      if (!r || !r.ok) { toast(r && r.reason ? '这段文字是' + r.reason : '没能解析这段文字，请直接填写各字段', 'warn'); return; }
      snapshot();
      Object.assign(c, { name: r.name, cat: r.cat, kind: r.kind, sym: r.sym, nominal: r.nominal, upper: r.upper, lower: r.lower, lsl: r.lsl, usl: r.usl, unit: r.unit, qty: r.qty, fit: r.fit, spec: r.spec, gdt: r.gdt, tolSource: r.tolSource, tolNote: r.tolNote, review: r.review, conf: r.conf, sourceText: text, status: 'auto' });
      if (r.cls && c.cls === '一般') c.cls = r.cls;
      if (chars.value.indexOf(c) >= 0) touch();
    };
    const confirm1 = (c) => { if (frozen.value) return; snapshot(); c.status = c.status === 'confirmed' ? 'auto' : 'confirmed'; touch(); if (c.status === 'confirmed' && st.sel === c.cid) nextUnconfirmed(c); };
    const nextUnconfirmed = (after) => {
      const list = chars.value.filter((x) => x.status !== 'confirmed').sort((a, b) => a.no - b.no);
      const nx = list.find((x) => x.no > (after ? after.no : 0)) || list[0];
      if (nx) select(nx.cid);
    };
    const confirmSafe = () => {
      const list = chars.value.filter((c) => c.status !== 'confirmed' && !needsReview(c));
      if (!list.length) { toast('没有可以直接确认的项：剩下的都需要逐项核对', 'info'); return; }
      snapshot(); list.forEach((c) => { c.status = 'confirmed'; }); touch();
      toast('已确认 ' + list.length + ' 项高可信度的特性', 'success');
    };
    const confirmAll = async () => {
      const left = chars.value.filter((c) => c.status !== 'confirmed');
      if (!left.length) return;
      const risky = left.filter(needsReview).length;
      if (risky && !(await confirmBox({ title: '全部确认？', message: '还有 ' + risky + ' 项标着“需核对”（公差来自查表、未注公差或识别可信度低）。确认表示你已经逐项核对过。', ok: '全部确认' }))) return;
      snapshot(); left.forEach((c) => { c.status = 'confirmed'; }); touch();
    };
    const remove = (c) => {
      if (frozen.value) return;
      snapshot();
      chars.value.splice(chars.value.indexOf(c), 1);
      if (st.rev.mapping) {
        const i = st.rev.mapping.items.findIndex((m) => m.cid === c.cid);
        if (i >= 0) { const m = st.rev.mapping.items.splice(i, 1)[0]; if (m.oldCid && baseRev.value) { const o = baseRev.value.chars.find((x) => x.cid === m.oldCid); if (o && !st.rev.mapping.removed.some((x) => x.cid === o.cid)) st.rev.mapping.removed.push({ cid: o.cid, no: o.no, name: o.name, spec: specLine(o) }); } }
      }
      if (st.sel === c.cid) st.sel = null;
      touch(); toast('已删除 #' + c.no + '（可以按 ⌘Z / Ctrl+Z 撤销）', 'info');
    };
    const renumberAll = () => { if (frozen.value) return; snapshot(); renumber(chars.value, pages.value); touch(); toast('已按阅读顺序重新编号（特性 ID 不变）', 'success'); };
    const relayout = () => { if (frozen.value) return; snapshot(); placeBalloons(chars.value, pages.value, { all: true, obstacles: groupObstacles() }); touch(); toast('已重新摆放全部气泡', 'success'); };
    const groupObstacles = () => { const o = {}; ((st.rev && st.rev.unused) || []).forEach((u) => { (o[u.page || 1] = o[u.page || 1] || []).push(u.box); }); return o; };
    const onMove = (cid, x, y) => { const c = chars.value.find((q) => q.cid === cid); if (!c || frozen.value) return; snapshot(); c.balloon = { x, y }; touch(); };

    /* —— 新增：框选识别 / 点放 —— */
    const nextCid = () => {
      const all = st.drawing.revisions.filter((r) => r.id !== st.rev.id).reduce((a, r) => a.concat(r.chars || []), []).concat(chars.value);
      return cidMaker({ drawingNo: st.drawing.drawingNo, revisions: [{ chars: all }], cidSeq: st.drawing.cidSeq })();
    };
    const onRect = async (rect) => {
      if (frozen.value) return;
      st.rectBusy = true;
      try {
        const pm = pageMeta.value;
        const toks = unpackTokens(pm && pm.tokens).filter((t) => boxInside(boxCenter(tokBox(t)), rect, 2));
        let text = '', anchor = rect, src = 'vector', conf = 1;
        if (toks.length) {
          const lines = groupTokens(toks);
          text = lines.map((l) => l.text).join(' ');
          anchor = lines.reduce((b, l) => boxUnion(b, l.box), null) || rect;
          src = toks[0].src; conf = Math.min.apply(null, toks.map((t) => (t.conf == null ? 1 : t.conf)));
        }
        let r = text ? parseSpec(text, ctx.value) : null;
        if ((!r || !r.ok) && (st.rev.textSource === 'ocr' || !toks.length)) {
          const canvas = await pageCanvas(st.rev, st.page);
          const t2 = await ocrRegion(canvas, rect, { langs: S.settings.ocrLangs || 'eng+chi_sim', ctx: ctx.value });
          if (t2.length) {
            const l2 = groupTokens(t2);
            text = l2.map((l) => l.text).join(' '); anchor = l2.reduce((b, l) => boxUnion(b, l.box), null) || rect; src = 'ocr';
            conf = t2.reduce((s, t) => s + t.conf, 0) / t2.length;
            r = parseSpec(text, ctx.value);
          }
        }
        const canvas = await pageCanvas(st.rev, st.page);
        const spec = r && r.ok ? r : mkSpec({ name: '', cat: '线性尺寸', text, conf: 0.4, review: true, tolNote: text ? '没能解析“' + text + '”，请手工填写' : '框里没有读到文字，请手工填写' });
        st.pending = specToChar(spec, { page: st.page, anchor, sourceText: text, src: text ? src : 'manual', conf: Math.round(spec.conf * Math.min(1, conf) * 100) / 100, clip: cropDataUrl(canvas, anchor) });
        st.pendingText = text; st.sel = null;
      } catch (e) { toast('框选识别失败：' + e.message, 'error'); }
      st.rectBusy = false;
    };
    const onPlace = async (p) => {
      if (frozen.value) return;
      let clip = '';
      try { clip = cropDataUrl(await pageCanvas(st.rev, st.page), { x: p.x - 60, y: p.y - 40, w: 120, h: 80 }); } catch (e) { /* 没有页面图时不截取 */ }
      st.pending = specToChar(mkSpec({ name: '', cat: '线性尺寸', conf: 1, tolSource: 'manual' }), { page: st.page, anchor: { x: p.x - 14, y: p.y - 14, w: 28, h: 28 }, balloon: { x: Math.round(p.x), y: Math.round(p.y) }, src: 'manual', clip, tolSource: 'manual' });
      st.pendingText = ''; st.sel = null;
    };
    const addPending = () => {
      const c = st.pending;
      if (!c) return;
      if (!c.name.trim()) { toast('请填写特性名称（或在上面的规格文字里填写后点“解析”）', 'error'); return; }
      snapshot();
      c.cid = nextCid(); c.no = Math.max(0, ...chars.value.map((x) => x.no || 0)) + 1;
      if (!c.balloon) placeBalloons([c], pages.value, { obstacles: { [c.page]: chars.value.filter((x) => x.page === c.page).map((x) => x.anchor).concat(chars.value.filter((x) => x.page === c.page && x.balloon).map((x) => ({ x: x.balloon.x - 14, y: x.balloon.y - 14, w: 28, h: 28 }))) } });
      chars.value.push(c);
      if (st.rev.mapping) st.rev.mapping.items.push({ cid: c.cid, kind: 'added', oldCid: '', oldNo: null, score: 0, changes: [], candidates: [] });
      st.pending = null; touch(); select(c.cid);
      toast('已添加 #' + c.no + ' ' + c.name, 'success');
    };
    const fromUnused = async (u) => {
      st.page = u.page || 1;
      st.pendingText = u.text;
      let clip = '';
      try { clip = cropDataUrl(await pageCanvas(st.rev, st.page), u.box); } catch (e) { /* 忽略 */ }
      const r = parseSpec(u.text, ctx.value);
      st.pending = specToChar(r && r.ok ? r : mkSpec({ name: '', text: u.text, conf: 0.4, review: true }), { page: st.page, anchor: u.box, sourceText: u.text, src: 'manual', clip });
      st.tab = 'chars';
    };

    /* —— 换版映射 —— */
    const resolveMap = (m, choice) => {
      const c = chars.value.find((x) => x.cid === m.cid);
      if (!c || !mapping.value) return;
      snapshot();
      const removed = mapping.value.removed;
      if (m.oldCid && m.kind !== 'added' && !removed.some((x) => x.cid === m.oldCid) && !mapping.value.items.some((x) => x !== m && x.oldCid === m.oldCid && x.kind !== 'added' && x.kind !== 'uncertain')) {
        const o0 = baseRev.value && baseRev.value.chars.find((x) => x.cid === m.oldCid);
        if (o0 && choice !== m.oldCid) removed.push({ cid: o0.cid, no: o0.no, name: o0.name, spec: specLine(o0) });
      }
      if (choice === 'new') {
        if (baseRev.value && baseRev.value.chars.some((x) => x.cid === c.cid)) { c.cid = nextCid(); c.no = Math.max(0, ...chars.value.map((x) => x.no || 0)) + 1; }
        Object.assign(m, { cid: c.cid, kind: 'added', oldCid: '', oldNo: null, changes: [] });
      } else {
        const o = baseRev.value && baseRev.value.chars.find((x) => x.cid === choice);
        if (!o) return;
        if (chars.value.some((x) => x !== c && x.cid === o.cid)) { toast('旧特性 #' + o.no + ' 已经对应到另一个新特性了', 'error'); return; }
        c.cid = o.cid; c.no = o.no;
        const ch = specDiff(o, c);
        Object.assign(m, { cid: o.cid, kind: ch.length ? 'changed' : 'same', oldCid: o.cid, oldNo: o.no, changes: ch });
        const ri = removed.findIndex((x) => x.cid === o.cid);
        if (ri >= 0) removed.splice(ri, 1);
      }
      if (st.sel && !chars.value.some((x) => x.cid === st.sel)) st.sel = c.cid;
      touch();
    };

    /* —— 识别 / 重新识别 —— */
    const recognize = async () => {
      if (st.rev.status !== 'new' && !(await confirmBox({ title: '重新识别？', message: '会用原始文件重新识别，替换当前的特性清单（已经做的校核和手工调整会丢失）。', ok: '重新识别', danger: true }))) return;
      st.recog = { step: { step: 'read' } };
      try {
        const doc = await loadRevisionDoc(st.rev);
        const rec = await recognizeDocument(doc, { renderW: S.settings.renderWidth || 2200, langs: S.settings.ocrLangs || 'eng+chi_sim', generalTol: S.settings.defaultGeneralTol || '', ocr: S.settings.ocrMode || 'auto' }, (s) => { st.recog.step = s; });
        rec.doc = doc;
        const base = lastFrozenBefore(st.drawing, st.rev);
        const d2 = Object.assign({}, st.drawing, { revisions: st.drawing.revisions.filter((r) => r.id !== st.rev.id) });
        const built = buildChars(d2, base, rec);
        await saveRecognition(st.drawing, st.rev, rec, built, (s) => { st.recog.step = s; });
        st.recog = null;
        toast('识别完成：' + built.chars.length + ' 个特性', 'success');
        await load();
      } catch (e) { console.error(e); st.recog = null; toast('识别失败：' + e.message, 'error'); }
    };
    const removeRev = async () => {
      if (!(await confirmBox({ title: '删除 Rev ' + st.rev.rev + '？', message: '这个版本还没有冻结，删除后可以重新上传。原始文件和识别结果一起删除。', ok: '删除', danger: true }))) return;
      try {
        await api('DELETE', '/drawings/' + st.drawing.id + '/revisions/' + st.rev.id);
        await refreshDrawings();
        toast('已删除 Rev ' + st.rev.rev, 'success');
        const d = S.drawings.find((x) => x.id === st.drawing.id);
        go(d ? '/annotate/' + d.id : '/drawings');
        if (d) load();
      } catch (e) { toast(e.message, 'error'); }
    };

    /* —— 冻结 —— */
    const openFreeze = async () => { await save.flush(); st.freeze = { problems: freezeProblems(chars.value, st.rev.mapping), running: false, step: '' }; };
    const closeFreeze = () => { if (st.freeze && !st.freeze.running) st.freeze = null; };
    const ballooned = async () => {
      const out = [];
      for (const pg of pages.value) {
        const canvas = await pageCanvas(st.rev, pg.page);
        out.push({ page: pg.page, canvas: drawBallooned(canvas, chars.value.filter((c) => (c.page || 1) === pg.page)) });
      }
      return out;
    };
    const doFreeze = async () => {
      const f = st.freeze;
      if (!f || f.problems.length) return;
      f.running = true;
      try {
        f.step = '生成带气泡图纸';
        const imgs = await ballooned();
        const pagesOut = [];
        for (const p of imgs) pagesOut.push({ page: p.page, w: p.canvas.width, h: p.canvas.height, jpeg: await canvasToBytes(p.canvas, 'image/jpeg', 0.9) });
        const pdf = makePdf(pagesOut);
        f.step = '冻结并计算内容摘要';
        const res = await api('POST', '/drawings/' + st.drawing.id + '/revisions/' + st.rev.id + '/freeze', {
          expectedVersion: st.rev.version, frozenBy: meName(), annotatedPdfBase64: bytesToBase64(pdf),
          balloonedPages: pagesOut.map((p) => ({ page: p.page, base64: bytesToBase64(p.jpeg) })),
        });
        const sent = postToQms('worlder.balloon.frozen', { syncBatchId: res.syncBatchId, drawingNo: st.drawing.drawingNo, drawingRev: st.rev.rev, partNo: st.drawing.partNo, contentHash: res.contentHash, balloonCount: res.balloonCount, frozenAt: res.frozenAt });
        st.freeze = null;
        toast('已冻结，同步批次 ' + res.syncBatchId + (sent ? '，已通知 QMS' : '：QMS 打开“气泡识别”页面时会自动拉取'), 'success');
        await refreshDrawings();
        await load();
      } catch (e) { console.error(e); f.running = false; toast('冻结失败：' + e.message, 'error'); }
    };

    /* —— 导出 —— */
    const fileBase = () => st.drawing.drawingNo + '_Rev' + st.rev.rev;
    const exportCsv = () => { st.exportMenu = false; downloadBlob(fileBase() + '_特性清单.csv', charsCsv(chars.value), 'text/csv;charset=utf-8'); };
    const exportJson = () => {
      st.exportMenu = false;
      const p = { drawingNo: st.drawing.drawingNo, drawingRev: st.rev.rev, partNo: st.drawing.partNo, balloons: chars.value.slice().sort((a, b) => a.no - b.no).map((c) => toBalloon(c, pages.value)) };
      downloadBlob(fileBase() + '_气泡.json', JSON.stringify(p, null, 2), 'application/json');
    };
    const exportPdf = async () => {
      st.exportMenu = false;
      if (frozen.value && st.rev.annotatedFileUrl) { window.open(st.rev.annotatedFileUrl, '_blank', 'noopener'); return; }
      try {
        const imgs = await ballooned();
        const pagesOut = [];
        for (const p of imgs) pagesOut.push({ page: p.page, w: p.canvas.width, h: p.canvas.height, jpeg: await canvasToBytes(p.canvas, 'image/jpeg', 0.9) });
        downloadBlob(fileBase() + '_带气泡图纸.pdf', makePdf(pagesOut), 'application/pdf');
      } catch (e) { toast('导出失败：' + e.message, 'error'); }
    };
    const printSheet = async () => {
      st.exportMenu = false;
      try {
        const imgs = await ballooned();
        UI.print = { title: st.drawing.drawingNo + ' ' + (st.drawing.name || '') + ' · Rev ' + st.rev.rev, sub: '零件号 ' + (st.drawing.partNo || '—') + ' · 材料 ' + (st.drawing.material || '—') + ' · 未注公差 ' + (st.rev.generalTol ? 'GB/T 1804-' + st.rev.generalTol : '—'), images: imgs.map((p) => p.canvas.toDataURL('image/jpeg', 0.9)), rows: chars.value.slice().sort((a, b) => a.no - b.no) };
      } catch (e) { toast('生成检验记录表失败：' + e.message, 'error'); }
    };

    /* —— 键盘 —— */
    const onKey = (e) => {
      if (UI.route.name !== 'annotate' || UI.upload || UI.confirm || st.freeze) return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) { if (e.key === 'Escape') document.activeElement.blur(); return; }
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); undo(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = TOOLS.find((x) => x.kbd.toLowerCase() === k);
      if (t) { st.tool = t.key; return; }
      if (e.key === 'Escape') { st.pending = null; st.sel = null; return; }
      const c = selChar.value;
      if (!c) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(c); }
      else if (e.key === 'Enter') { e.preventDefault(); confirm1(c); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const i = listed.value.indexOf(c), j = i + (e.key === 'ArrowDown' ? 1 : -1);
        if (listed.value[j]) select(listed.value[j].cid);
      }
    };
    onMounted(() => window.addEventListener('keydown', onKey));
    onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
    const doHint = () => {
      const a = hint.value && hint.value.act;
      if (a === 'recognize') recognize();
      else if (a === 'mapping') st.tab = 'mapping';
      else if (a === 'next') { st.tab = 'chars'; st.filter = 'all'; nextUnconfirmed(null); }
      else if (a === 'freeze') openFreeze();
    };
    const pickFlow = (k) => {
      if (k === 'recognize' && st.rev.status === 'new') recognize();
      else if (k === 'review') { st.tab = 'chars'; st.filter = 'review'; nextUnconfirmed(null); }
      else if (k === 'freeze' && !frozen.value) openFreeze();
      else if (k === 'upload') go('/drawings');
    };
    const colorKey = computed(() => (st.colorBy === 'map' && mapping.value ? (c) => { const m = mapOf(c.cid); return m ? m.kind : 'auto'; } : null));
    const switchRev = (id) => go('/annotate/' + st.drawing.id + '/' + id);
    return {
      st, chars, frozen, pages, pageMeta, pageChars, selChar, mapping, mapOf, counts, listed, unusedOnPage, baseRev, mapCounts, fetched, flow, hint, colorKey,
      select, setField, applyText, confirm1, confirmSafe, confirmAll, remove, renumberAll, relayout, onMove, onRect, onPlace, addPending, fromUnused, resolveMap,
      recognize, removeRev, openFreeze, closeFreeze, doFreeze, exportCsv, exportJson, exportPdf, printSheet, undo, doHint, pickFlow, switchRev, stepText, TOOLS, CATS, GD_OPTIONS, MAP_META,
    };
  },
  template: `
<div v-if="st.loading" class="space-y-4"><div class="skeleton h-10 w-1/3"></div><div class="skeleton h-[560px]"></div></div>
<div v-else-if="st.error" class="card"><empty icon="alert" title="打不开这张图纸" :desc="st.error"><button class="btn-secondary" @click="go('/drawings')">返回图纸库</button></empty></div>
<div v-else class="flex flex-col gap-3 min-h-[640px]" :style="{ height: 'calc(100vh - ' + (UI.embedded ? 72 : 90) + 'px)' }">
  <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
    <button class="btn-icon" @click="go('/drawings')" title="返回图纸库"><ic name="chevron-left" :size="18"/></button>
    <div class="min-w-0">
      <div class="flex items-center gap-2 flex-wrap"><h1 class="text-[18px] font-semibold tracking-tight truncate">{{ st.drawing.name || '未命名图纸' }}</h1><span class="font-mono text-[12.5px] text-ink-3">{{ st.drawing.drawingNo }}</span>
        <select class="input-sm !w-auto font-mono !h-7" :value="st.rev.id" @change="switchRev($event.target.value)" title="切换版本"><option v-for="r in st.drawing.revisions" :key="r.id" :value="r.id">Rev {{ r.rev }} · {{ REV_STATUS[r.status][0] }}</option></select>
        <span :class="REV_STATUS[st.rev.status][1]">{{ REV_STATUS[st.rev.status][0] }}</span>
        <span v-if="st.rev.generalTol" class="chip-gray" title="未注公差等级">GB/T 1804-{{ st.rev.generalTol }}</span>
      </div>
    </div>
    <div class="flex-1 min-w-[280px]"><flow-steps :steps="flow" @pick="pickFlow"/></div>
    <div class="flex items-center gap-2">
      <span v-if="!frozen" class="text-[11px] text-ink-4 hidden xl:inline">{{ st.saving ? '保存中…' : st.dirty ? '有未保存的修改' : st.savedAt ? '已自动保存' : '' }}</span>
      <div class="relative">
        <button class="btn-secondary" @click="st.exportMenu = !st.exportMenu"><ic name="download" :size="15"/>导出</button>
        <div v-if="st.exportMenu" class="fixed inset-0 z-20" @click="st.exportMenu = false"></div>
        <transition name="pop"><div v-if="st.exportMenu" class="absolute right-0 mt-2 w-56 card shadow-pop p-1.5 z-30">
          <button class="w-full text-left px-3 py-2 rounded-xl hover:bg-black/[0.04] text-[13px] flex items-center gap-2" @click="exportPdf"><ic name="file" :size="15"/>带气泡图纸（PDF）</button>
          <button class="w-full text-left px-3 py-2 rounded-xl hover:bg-black/[0.04] text-[13px] flex items-center gap-2" @click="exportCsv"><ic name="list" :size="15"/>特性清单（Excel 可打开的 CSV）</button>
          <button class="w-full text-left px-3 py-2 rounded-xl hover:bg-black/[0.04] text-[13px] flex items-center gap-2" @click="exportJson"><ic name="copy" :size="15"/>气泡数据（JSON）</button>
          <button class="w-full text-left px-3 py-2 rounded-xl hover:bg-black/[0.04] text-[13px] flex items-center gap-2" @click="printSheet"><ic name="printer" :size="15"/>打印检验记录表</button>
        </div></transition>
      </div>
      <button v-if="!frozen && st.rev.status !== 'new'" class="btn-primary" :disabled="!counts.total" @click="openFreeze" data-test="freeze"><ic name="lock" :size="15"/>冻结并同步</button>
    </div>
  </div>

  <div v-if="hint" class="rounded-2xl px-4 py-2.5 flex flex-wrap items-center gap-3 ring-1 ring-inset" :class="frozen ? 'bg-emerald-50/70 ring-emerald-600/15' : 'bg-brand-50/70 ring-brand-500/25'">
    <span class="w-7 h-7 rounded-full flex items-center justify-center shrink-0" :class="frozen ? 'bg-emerald-500 text-white' : 'bg-brand-600 text-white'"><ic :name="frozen ? 'lock' : 'arrow-right'" :size="14" stroke="2.2"/></span>
    <span class="text-[13px] font-medium flex-1 min-w-[200px]">{{ hint.text }}</span>
    <template v-if="frozen && st.rev.sync"><span class="text-[11.5px] text-ink-3 font-mono">{{ st.rev.sync.syncBatchId }} · 摘要 {{ String(st.rev.sync.contentHash || '').slice(7, 19) }}</span></template>
    <button v-if="hint.btn" class="btn-primary btn-sm" @click="doHint">{{ hint.btn }}<ic name="arrow-right" :size="13"/></button>
    <button v-if="frozen" class="btn-secondary btn-sm" @click="UI.upload = null; go('/drawings')">上传新版本请到图纸库</button>
  </div>

  <div class="flex-1 flex gap-3 min-h-0">
    <div class="flex-1 card overflow-hidden relative min-w-0">
      <page-viewer v-if="pageMeta" :src="pageMeta.image" :w="pageMeta.w" :h="pageMeta.h" :chars="pageChars" :selected="st.sel" :tool="frozen ? 'hand' : st.tool" :boxes="st.boxes" :readonly="frozen" :extra="unusedOnPage" :color-key="colorKey"
        @select="select" @deselect="st.sel = null" @move="onMove" @rect="onRect" @place="onPlace"/>
      <div v-else class="absolute inset-0 flex items-center justify-center">
        <div v-if="st.recog" class="w-80 text-center"><progress-bar :value="st.recog.step && st.recog.step.progress ? st.recog.step.progress : -1"/><p class="text-xs text-ink-3 mt-2">{{ stepText(st.recog.step) }}</p></div>
        <empty v-else icon="scan" title="还没有识别结果" desc="用上传时保存的原始文件开始识别"><button class="btn-primary" @click="recognize"><ic name="play" :size="15"/>开始识别</button></empty>
      </div>
      <div v-if="pageMeta" class="absolute left-3 top-3 flex flex-wrap items-center gap-1.5" @pointerdown.stop>
        <div v-if="!frozen" class="flex items-center gap-0.5 p-1 rounded-xl glass shadow-soft ring-1 ring-black/5">
          <button v-for="t in TOOLS" :key="t.key" type="button" class="h-8 px-2.5 rounded-lg text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors" :class="st.tool === t.key ? 'bg-brand-600 text-white' : 'text-ink-2 hover:bg-black/[0.05]'" :title="t.tip + '（' + t.kbd + '）'" @click="st.tool = t.key" :data-tool="t.key"><ic :name="t.icon" :size="15"/><span class="hidden 2xl:inline">{{ t.label }}</span></button>
        </div>
        <button type="button" class="h-9 px-3 rounded-xl glass shadow-soft ring-1 ring-black/5 text-[12px] font-medium inline-flex items-center gap-1.5" :class="st.boxes ? 'text-brand-700' : 'text-ink-2'" @click="st.boxes = !st.boxes"><ic :name="st.boxes ? 'eye' : 'eye-off'" :size="15"/>识别框</button>
        <button v-if="mapping" type="button" class="h-9 px-3 rounded-xl glass shadow-soft ring-1 ring-black/5 text-[12px] font-medium inline-flex items-center gap-1.5" :class="st.colorBy === 'map' ? 'text-brand-700' : 'text-ink-2'" @click="st.colorBy = st.colorBy === 'map' ? 'status' : 'map'"><ic name="diff" :size="15"/>{{ st.colorBy === 'map' ? '按换版着色' : '按校核着色' }}</button>
        <div v-if="pages.length > 1" class="flex items-center gap-0.5 p-1 rounded-xl glass shadow-soft ring-1 ring-black/5"><button v-for="p in pages" :key="p.page" class="h-7 px-2.5 rounded-lg text-[12px]" :class="st.page === p.page ? 'bg-black/80 text-white' : 'hover:bg-black/[0.05]'" @click="st.page = p.page">第 {{ p.page }} 页</button></div>
      </div>
      <div v-if="st.rectBusy" class="absolute left-1/2 top-4 -translate-x-1/2 px-3 py-2 rounded-xl glass-dark text-white text-xs shadow-pop flex items-center gap-2"><ic name="refresh" :size="13" class="animate-spin"/>正在识别框里的文字…</div>
      <div v-if="!frozen && pageMeta && (st.tool === 'box' || st.tool === 'place')" class="absolute left-3 bottom-3 px-3 py-2 rounded-xl glass shadow-soft ring-1 ring-black/5 text-[11.5px] text-ink-2">{{ st.tool === 'box' ? '在图上拖一个框，框住一个标注' : '在要放气泡的位置点一下' }}，按 Esc 取消</div>
    </div>

    <aside class="w-[430px] shrink-0 card flex flex-col overflow-hidden max-lg:hidden">
      <div class="px-4 pt-3.5 pb-3 border-b border-black/[0.06] space-y-2.5">
        <seg v-model="st.tab" size="sm" :options="[{ value: 'chars', label: '特性', count: counts.total }, { value: 'unused', label: '未采用文字', count: (st.rev.unused || []).length }].concat(mapping ? [{ value: 'mapping', label: '换版映射', count: mapCounts.uncertain || null }] : [])"/>
        <template v-if="st.tab === 'chars'">
          <div class="flex items-center gap-2">
            <seg v-model="st.filter" size="sm" :options="[{ value: 'all', label: '全部' }, { value: 'review', label: '待校核', count: counts.total - counts.confirmed }, { value: 'done', label: '已确认', count: counts.confirmed }]"/>
            <input v-model="st.q" class="input-sm flex-1 min-w-0" placeholder="搜索">
          </div>
          <div v-if="!frozen" class="flex flex-wrap items-center gap-1.5">
            <button class="btn-soft btn-xs" @click="confirmSafe" title="只确认识别可信度高、公差直接来自图面的项"><ic name="check-all" :size="13"/>确认高可信度</button>
            <button class="btn-ghost btn-xs" @click="confirmAll">全部确认</button>
            <button class="btn-ghost btn-xs" @click="renumberAll" title="按阅读顺序重新编号"><ic name="hash" :size="13"/>重新编号</button>
            <button class="btn-ghost btn-xs" @click="relayout" title="重新摆放全部气泡"><ic name="wand" :size="13"/>摆放气泡</button>
            <button class="btn-ghost btn-xs" @click="undo" title="撤销（⌘Z / Ctrl+Z）"><ic name="undo" :size="13"/></button>
          </div>
        </template>
      </div>

      <div v-if="st.tab === 'chars'" class="flex-1 overflow-y-auto">
        <button v-for="c in listed" :key="c.cid" :data-row="c.cid" type="button" class="w-full text-left px-4 py-2.5 border-b border-black/[0.04] flex items-start gap-3 transition-colors" :class="st.sel === c.cid ? 'bg-brand-50/70' : 'hover:bg-black/[0.02]'" @click="select(c.cid)">
          <bubble-no :c="c"/>
          <span class="flex-1 min-w-0">
            <span class="flex items-center gap-1.5"><span class="font-medium text-[13px] truncate">{{ c.name || '（未命名）' }}</span><span v-if="c.cls !== '一般'" :class="CLS_META[c.cls][1]">{{ c.cls }}</span></span>
            <span class="block text-[11.5px] font-mono text-ink-3 truncate mt-0.5">{{ specLine(c) }}</span>
            <span class="flex flex-wrap items-center gap-1 mt-1"><span class="chip-gray">{{ c.cat }}</span><span v-if="c.tolSource !== 'explicit'" :class="TOL_SOURCE[c.tolSource] ? TOL_SOURCE[c.tolSource][1] : 'chip-gray'">{{ TOL_SOURCE[c.tolSource] ? TOL_SOURCE[c.tolSource][0] : c.tolSource }}</span><span v-if="mapOf(c.cid)" :class="MAP_META[mapOf(c.cid).kind][1]">{{ MAP_META[mapOf(c.cid).kind][0] }}</span><span v-if="c.conf < 0.85" class="chip-amber">可信度 {{ Math.round(c.conf * 100) }}%</span></span>
          </span>
          <span v-if="!frozen" class="shrink-0 w-7 h-7 rounded-full flex items-center justify-center ring-1 ring-inset transition-colors" :class="c.status === 'confirmed' ? 'bg-emerald-500 text-white ring-emerald-500' : 'bg-white text-ink-4 ring-black/15 hover:text-emerald-600 hover:ring-emerald-500'" :title="c.status === 'confirmed' ? '取消确认' : '确认（Enter）'" @click.stop="confirm1(c)" :data-confirm="c.cid"><ic name="check" :size="14" stroke="2.4"/></span>
        </button>
        <empty v-if="!listed.length" icon="list" :title="counts.total ? '没有符合条件的特性' : '还没有特性'" :desc="counts.total ? '' : '用左上角的“框选识别”或“加气泡”添加'"/>
      </div>

      <div v-if="st.tab === 'unused'" class="flex-1 overflow-y-auto">
        <p class="px-4 py-2.5 text-[11.5px] text-ink-4 leading-relaxed border-b border-black/[0.04]">这些文字没有自动变成特性（标题栏、图框编号、视图名称、参考尺寸等）。漏识别的可以点“转为特性”。</p>
        <div v-for="(u,i) in (st.rev.unused || [])" :key="i" class="px-4 py-2.5 border-b border-black/[0.04] flex items-center gap-3">
          <span class="flex-1 min-w-0"><span class="block font-mono text-[12.5px] truncate">{{ u.text }}</span><span class="block text-[11px] text-ink-4">第 {{ u.page || 1 }} 页 · {{ u.reason }}</span></span>
          <button v-if="!frozen" class="btn-secondary btn-xs" @click="fromUnused(u)">转为特性</button>
        </div>
        <empty v-if="!(st.rev.unused || []).length" icon="check" title="没有未采用的文字"/>
      </div>

      <div v-if="st.tab === 'mapping' && mapping" class="flex-1 overflow-y-auto">
        <div class="px-4 py-3 border-b border-black/[0.04]">
          <div class="text-[12px] text-ink-3">与 Rev {{ mapping.baseRev }} 对比（按特性 ID）：</div>
          <div class="flex flex-wrap gap-1.5 mt-2"><span class="chip-gray">沿用 {{ mapCounts.same }}</span><span class="chip-amber">变更 {{ mapCounts.changed }}</span><span class="chip-green">新增 {{ mapCounts.added }}</span><span class="chip-red">删除 {{ mapCounts.removed }}</span><span v-if="mapCounts.uncertain" class="chip-violet">无法确认 {{ mapCounts.uncertain }}</span></div>
        </div>
        <div v-for="m in mapping.items.filter(x => x.kind !== 'same')" :key="m.cid" class="px-4 py-3 border-b border-black/[0.04]" :class="m.kind === 'uncertain' ? 'bg-violet-50/50' : ''">
          <div class="flex items-center gap-2"><span :class="MAP_META[m.kind][1]">{{ MAP_META[m.kind][0] }}</span><button class="link text-[13px] font-medium truncate" @click="select(m.cid); st.tab = 'chars'">#{{ (chars.find(c => c.cid === m.cid) || {}).no }} {{ (chars.find(c => c.cid === m.cid) || {}).name }}</button></div>
          <div v-for="ch in m.changes" :key="ch.f" class="text-[11.5px] text-ink-2 mt-1">{{ ch.label }}：<span class="line-through text-ink-4">{{ ch.a }}</span> → <b>{{ ch.b }}</b> <span v-if="ch.dir" :class="ch.dir === '放宽' || ch.dir === '取消限值' ? 'chip-amber' : 'chip-blue'">{{ ch.dir }}</span></div>
          <div v-if="m.kind === 'uncertain' && !frozen" class="mt-2">
            <label class="label">对应 Rev {{ mapping.baseRev }} 的哪个特性？</label>
            <select class="input-sm" @change="resolveMap(m, $event.target.value)"><option value="" disabled selected>请选择</option><option v-for="cd in m.candidates" :key="cd.cid" :value="cd.cid">#{{ cd.no }} {{ cd.name }}（相似度 {{ Math.round(cd.score * 100) }}%）</option><option value="new">都不是，作为新增特性</option></select>
          </div>
        </div>
        <div v-if="mapping.removed.length" class="px-4 py-3">
          <div class="text-[12px] font-medium text-rose-700 mb-1.5">Rev {{ mapping.baseRev }} 有、这一版没有（删除）</div>
          <div v-for="x in mapping.removed" :key="x.cid" class="text-[12px] text-ink-2 py-0.5">#{{ x.no }} {{ x.name }} <span class="font-mono text-ink-4">{{ x.spec }}</span></div>
        </div>
      </div>

      <div v-if="st.pending || selChar" class="border-t border-black/[0.08] bg-[#fbfbfd] max-h-[56%] overflow-y-auto">
        <char-editor v-if="st.pending" :c="st.pending" :pending="true" :text="st.pendingText" :ctx-general="st.rev.generalTol" @apply="applyText(st.pending, $event)" @set="(f, v) => { st.pending[f] = v; if (['nominal','upper','lower'].indexOf(f) >= 0) recomputeLimits(st.pending); }" @add="addPending" @cancel="st.pending = null"/>
        <char-editor v-else :c="selChar" :readonly="frozen" :map="mapOf(selChar.cid)" @apply="applyText(selChar, $event)" @set="(f, v) => setField(selChar, f, v)" @confirm="confirm1(selChar)" @remove="remove(selChar)" @cancel="st.sel = null"/>
      </div>
      <div v-if="!frozen && st.rev.status !== 'frozen'" class="px-4 py-2 border-t border-black/[0.06] flex items-center justify-between text-[11px] text-ink-4">
        <span>V 选择 · H 平移 · R 框选 · B 加气泡 · Enter 确认 · ↑↓ 切换</span>
        <span class="flex items-center gap-2"><button class="link" @click="recognize">重新识别</button><button class="link !text-rose-600" @click="removeRev">删除此版本</button></span>
      </div>
    </aside>
  </div>

  <modal :open="!!st.freeze" @close="closeFreeze" title="冻结并同步给 QMS" :sub="st.drawing.drawingNo + ' Rev ' + st.rev.rev + ' · ' + counts.total + ' 个特性'" width="max-w-xl">
    <template v-if="st.freeze">
      <div v-if="st.freeze.problems.length" class="rounded-2xl bg-rose-50 text-rose-800 px-4 py-3 text-[12.5px]">
        <div class="font-semibold mb-1">还不能冻结，先处理这些问题：</div>
        <div v-for="p in st.freeze.problems.slice(0, 12)" :key="p" class="py-0.5">· {{ p }}</div>
        <div v-if="st.freeze.problems.length > 12" class="py-0.5">…… 共 {{ st.freeze.problems.length }} 项</div>
      </div>
      <div v-else class="space-y-3 text-[13px] leading-relaxed">
        <div class="rounded-2xl bg-emerald-50 text-emerald-900 px-4 py-3">全部 {{ counts.total }} 个特性已校核<span v-if="mapping">；与 Rev {{ mapping.baseRev }} 相比：沿用 {{ mapCounts.same }}、变更 {{ mapCounts.changed }}、新增 {{ mapCounts.added }}、删除 {{ mapCounts.removed }}</span>。</div>
        <p class="text-ink-2">冻结后这个版本不能再修改；服务端生成同步批次号和内容摘要（SHA-256），QMS 按批次号拉取、核对摘要后进入收件箱。<b>冻结不等于标准生效</b>：QMS 里还要生成标准草稿并审核批准。</p>
        <kv k="冻结人" :v="meName()"/>
      </div>
    </template>
    <template #footer>
      <button class="btn-secondary" :disabled="st.freeze && st.freeze.running" @click="st.freeze = null">取消</button>
      <button class="btn-primary" :disabled="!st.freeze || st.freeze.problems.length > 0 || st.freeze.running" @click="doFreeze" data-test="freeze-confirm"><ic :name="st.freeze && st.freeze.running ? 'refresh' : 'lock'" :size="15" :class="st.freeze && st.freeze.running ? 'animate-spin' : ''"/>{{ st.freeze && st.freeze.running ? st.freeze.step : '冻结并同步' }}</button>
    </template>
  </modal>
</div>`,
};

/* ---------------- 特性编辑区 ---------------- */
COMPONENTS['char-editor'] = {
  props: { c: Object, pending: Boolean, readonly: Boolean, map: Object, text: String, ctxGeneral: String },
  emits: ['set', 'apply', 'add', 'confirm', 'remove', 'cancel'],
  data() { return { t: this.text || (this.c && this.c.sourceText) || '' }; },
  watch: { c() { this.t = this.text || (this.c && this.c.sourceText) || ''; }, text(v) { if (v) this.t = v; } },
  methods: {
    up(f, e) { this.$emit('set', f, e && e.target ? e.target.value : e); },
  },
  template: `
<div v-if="c" class="p-4 space-y-3">
  <div class="flex items-start gap-3">
    <bubble-no v-if="!pending" :c="c" :size="28"/><span v-else class="w-7 h-7 rounded-full bg-brand-600 text-white flex items-center justify-center shrink-0"><ic name="plus" :size="15" stroke="2.4"/></span>
    <div class="flex-1 min-w-0">
      <div class="font-semibold text-[14px] truncate">{{ pending ? '新增特性' : c.name || '（未命名）' }}</div>
      <div class="text-[11px] text-ink-4 font-mono mt-0.5">{{ pending ? '添加后分配特性 ID' : c.cid }} · {{ SRC_META[c.src] || c.src }}<span v-if="c.conf < 1"> · 可信度 {{ Math.round(c.conf * 100) }}%</span></div>
    </div>
    <button class="btn-icon" @click="$emit('cancel')" title="关闭"><ic name="x" :size="16"/></button>
  </div>
  <div v-if="c.clip" class="rounded-xl bg-white ring-1 ring-black/[0.06] p-2 flex items-center justify-center"><img :src="c.clip" class="max-h-24 max-w-full" alt="原图截取"></div>
  <div v-if="c.tolNote" class="rounded-xl px-3 py-2 text-[11.5px] leading-relaxed" :class="c.tolSource === 'none' || c.review ? 'bg-amber-50 text-amber-900' : 'bg-black/[0.03] text-ink-2'">{{ c.tolNote }}</div>
  <div v-if="map && map.changes && map.changes.length" class="rounded-xl bg-amber-50/70 px-3 py-2 text-[11.5px] text-amber-900"><div v-for="ch in map.changes" :key="ch.f">{{ ch.label }}：{{ ch.a }} → <b>{{ ch.b }}</b> {{ ch.dir }}</div></div>
  <div v-if="!readonly">
    <label class="label">规格文字（改了以后点“解析”自动填写下面各项）</label>
    <div class="flex gap-2"><input v-model="t" class="input-sm font-mono flex-1" placeholder="如 Ø20±0.1、M8×1.25-6g、⊥0.02 A、Ra1.6" @keydown.enter.prevent="$emit('apply', t)"><button class="btn-secondary btn-sm" @click="$emit('apply', t)"><ic name="wand" :size="13"/>解析</button></div>
  </div>
  <div class="grid grid-cols-2 gap-2.5">
    <div class="col-span-2"><label class="label">名称</label><input :value="c.name" @change="up('name', $event)" class="input-sm" :disabled="readonly" data-field="name"></div>
    <div><label class="label">类别</label><select :value="c.cat" @change="up('cat', $event)" class="input-sm" :disabled="readonly"><option v-for="x in CATS" :key="x">{{ x }}</option></select></div>
    <div><label class="label">判定方式</label><select :value="c.kind" @change="up('kind', $event)" class="input-sm" :disabled="readonly"><option value="measure">计量（实测值）</option><option value="count">计数（合格 / 不合格）</option></select></div>
    <template v-if="c.kind === 'measure'">
      <div><label class="label">符号</label><select :value="c.sym" @change="up('sym', $event)" class="input-sm" :disabled="readonly"><option value="">无</option><option>Ø</option><option>R</option><option>SR</option><option>SØ</option><option>□</option><option v-for="g in GD_OPTIONS" :key="g">{{ g }}</option></select></div>
      <div><label class="label">单位</label><input :value="c.unit" @change="up('unit', $event)" class="input-sm" :disabled="readonly"></div>
      <div><label class="label">名义值</label><input :value="c.nominal" @change="up('nominal', $event)" class="input-sm font-mono" :disabled="readonly" inputmode="decimal"></div>
      <div><label class="label">配合代号</label><input :value="c.fit" @change="up('fit', $event)" class="input-sm font-mono" :disabled="readonly" placeholder="如 H7"></div>
      <div><label class="label">上偏差</label><input :value="c.upper" @change="up('upper', $event)" class="input-sm font-mono" :disabled="readonly" placeholder="+0.10"></div>
      <div><label class="label">下偏差</label><input :value="c.lower" @change="up('lower', $event)" class="input-sm font-mono" :disabled="readonly" placeholder="-0.10"></div>
      <div><label class="label">下限 LSL</label><input :value="c.lsl" @change="up('lsl', $event)" class="input-sm font-mono" :disabled="readonly" data-field="lsl"></div>
      <div><label class="label">上限 USL</label><input :value="c.usl" @change="up('usl', $event)" class="input-sm font-mono" :disabled="readonly" data-field="usl"></div>
    </template>
    <div v-else class="col-span-2"><label class="label">检验要求</label><input :value="c.spec" @change="up('spec', $event)" class="input-sm" :disabled="readonly"></div>
    <div><label class="label">特殊特性</label><select :value="c.cls" @change="up('cls', $event)" class="input-sm" :disabled="readonly"><option value="一般">一般</option><option value="CC">CC 重要</option><option value="CTQ">CTQ 关键</option></select></div>
    <div><label class="label">数量</label><input :value="c.qty" @change="up('qty', $event)" class="input-sm" :disabled="readonly" inputmode="numeric"></div>
    <div class="col-span-2"><label class="label">备注</label><input :value="c.note" @change="up('note', $event)" class="input-sm" :disabled="readonly" placeholder="可选"></div>
  </div>
  <div v-if="c.sourceText && !pending" class="text-[11px] text-ink-4">图面原文：<span class="font-mono text-ink-3">{{ c.sourceText }}</span></div>
  <div v-if="!readonly" class="flex items-center gap-2 pt-1">
    <template v-if="pending"><button class="btn-primary btn-sm" @click="$emit('add')" data-test="add-char"><ic name="plus" :size="14"/>添加这个特性</button><button class="btn-ghost btn-sm" @click="$emit('cancel')">取消</button></template>
    <template v-else>
      <button class="btn-sm" :class="c.status === 'confirmed' ? 'btn-secondary' : 'btn-success'" @click="$emit('confirm')"><ic name="check" :size="14"/>{{ c.status === 'confirmed' ? '取消确认' : '确认，下一个' }}</button>
      <button class="btn-ghost btn-sm !text-rose-600 ml-auto" @click="$emit('remove')"><ic name="trash" :size="14"/>删除</button>
    </template>
  </div>
</div>`,
};

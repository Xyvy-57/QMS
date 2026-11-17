/* =====================================================================
 * 图纸库：图纸列表、上传（拖进来即识别）、示例图纸；上传对话框：识别 → 确认图纸信息 → 保存
 * ===================================================================== */

const SAMPLES = [
  { file: 'flange_A.svg', label: '法兰盘 DWG-2026-101 Rev A', desc: '矢量图纸：配合公差、叠放偏差、形位公差、粗糙度、技术要求' },
  { file: 'shaft_A.svg', label: '传动轴 DWG-2026-102 Rev A', desc: '矢量图纸：竖排直径、螺纹、键槽、跳动、关键特性' },
  { file: 'shaft_B.svg', label: '传动轴 DWG-2026-102 Rev B（换版）', desc: '先上传 Rev A 并冻结，再上传本图演示换版映射' },
  { file: 'bracket.svg', label: '支架 DWG-2026-103 · 扫描件', desc: '转成图片后走本机 OCR，演示扫描图纸识别', scan: true },
];
async function sampleFile(s) {
  const res = await fetch('/samples/' + s.file);
  if (!res.ok) throw new Error('示例图纸下载失败：' + s.file);
  const blob = await res.blob();
  if (!s.scan) return new File([blob], s.file, { type: 'image/svg+xml' });
  /* 模拟扫描件：渲染成位图、轻微模糊和灰底，再当作 PNG 上传 */
  const doc = await openDocument({ kind: 'svg', bytes: await blob.arrayBuffer(), name: s.file });
  const pg = await renderPage(doc, 1, 2400);
  const c = newCanvas(pg.w, pg.h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f3ef'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.filter = 'blur(0.6px) contrast(1.05)';
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(pg.canvas, 0, 0);
  const bytes = await canvasToBytes(c, 'image/png');
  return new File([bytes], s.file.replace(/\.svg$/, '_scan.png'), { type: 'image/png' });
}

/* ---------------- 上传对话框（全局，由 UI.upload 打开） ---------------- */
COMPONENTS['upload-dialog'] = {
  setup() {
    const st = reactive({ phase: 'idle', step: null, error: '', info: null, rec: null, form: { drawingNo: '', name: '', partNo: '', material: '', rev: '', generalTol: '' }, target: null, saving: false });
    const open = computed(() => !!UI.upload);
    const existing = computed(() => {
      const no = st.form.drawingNo.trim().toLowerCase();
      if (UI.upload && UI.upload.drawingId) return S.drawings.find((d) => d.id === UI.upload.drawingId) || null;
      return no ? S.drawings.find((d) => d.drawingNo.toLowerCase() === no) || null : null;
    });
    const stats = computed(() => {
      const r = st.rec; if (!r) return null;
      const chars = r.chars.map((c) => specToChar(c.spec, { conf: c.conf }));
      return { total: chars.length, review: chars.filter(needsReview).length, pages: r.pages.length, source: r.textSource === 'ocr' ? '本机 OCR' : '矢量文字' };
    });
    const run = async (file) => {
      Object.assign(st, { phase: 'work', step: { step: 'read' }, error: '', info: null, rec: null, saving: false });
      try {
        const info = await readFileInfo(file);
        st.info = { name: info.name, size: info.size, kind: info.kind, sha256: info.sha256 };
        const doc = await openDocument(info);
        const rec = await recognizeDocument(doc, { renderW: S.settings.renderWidth || 2200, langs: S.settings.ocrLangs || 'eng+chi_sim', generalTol: S.settings.defaultGeneralTol || '', ocr: S.settings.ocrMode || 'auto' }, (s) => { st.step = s; });
        rec.doc = doc; rec.info = info;
        st.rec = markRaw(rec);
        const t = rec.title || {};
        const pre = UI.upload && UI.upload.drawingId ? S.drawings.find((d) => d.id === UI.upload.drawingId) : null;
        const no = (pre && pre.drawingNo) || t.drawingNo || info.name.replace(/\.[^.]+$/, '').replace(/_scan$/, '');
        const ex = S.drawings.find((d) => d.drawingNo.toLowerCase() === no.toLowerCase()) || pre;
        Object.assign(st.form, {
          drawingNo: no, name: t.name || (ex && ex.name) || '', partNo: t.partNo || (ex && ex.partNo) || '', material: t.material || (ex && ex.material) || '',
          rev: t.rev && !(ex && ex.revisions && ex.revisions.some((r) => r.rev === t.rev)) ? t.rev : ex && ex.latest ? nextRevLabel(ex.latest.rev) : t.rev || 'A',
          generalTol: rec.generalTol || '',
        });
        if (ex && ex.latest && t.rev && ex.latest.rev === t.rev) st.form.rev = nextRevLabel(t.rev);
        if (pre && t.drawingNo && t.drawingNo !== pre.drawingNo) toast('标题栏里的图号是 ' + t.drawingNo + '，与所选图纸 ' + pre.drawingNo + ' 不一致，请核对', 'warn');
        st.phase = 'confirm';
      } catch (e) { console.error(e); st.error = e.message || String(e); st.phase = 'error'; }
    };
    watch(() => UI.upload, (v) => { if (v && v.files && v.files.length) run(v.files[0]); else Object.assign(st, { phase: 'idle', rec: null, info: null }); });
    const changeTol = (v) => { st.form.generalTol = v; if (st.rec) st.rec = markRaw(Object.assign(reanalyze(st.rec, v), { doc: st.rec.doc, info: st.rec.info })); };
    const close = () => { if (st.saving) return; UI.upload = null; };
    const save = async () => {
      const f = st.form;
      if (!f.drawingNo.trim()) { toast('请填写图号', 'error'); return; }
      if (!f.rev.trim()) { toast('请填写版本', 'error'); return; }
      st.saving = true;
      try {
        let d = existing.value;
        if (!d) d = await api('POST', '/drawings', { drawingNo: f.drawingNo.trim(), name: f.name.trim(), partNo: f.partNo.trim(), material: f.material.trim(), generalTol: f.generalTol || '' });
        const full = await api('GET', '/drawings/' + d.id);
        if (full.revisions.some((r) => r.rev === f.rev.trim())) throw new Error('图纸 ' + full.drawingNo + ' 已经有 Rev ' + f.rev.trim() + '，请换一个版本号');
        const unfrozen = full.revisions.find((r) => r.status !== 'frozen');
        if (unfrozen) throw new Error('图纸 ' + full.drawingNo + ' 的 Rev ' + unfrozen.rev + ' 还没有冻结：请先在标注工作台冻结它，再上传新版本');
        st.step = { step: 'save' };
        const info = st.rec.info;
        const rev = await api('POST', '/drawings/' + d.id + '/revisions', { rev: f.rev.trim(), file: { name: info.name, type: info.type, size: info.size, kind: info.kind, sha256: info.sha256, base64: bytesToBase64(new Uint8Array(info.bytes)) } });
        const base = [...full.revisions].reverse().find((r) => r.status === 'frozen') || null;
        const rec = Object.assign({}, st.rec, { title: Object.assign({}, st.rec.title, { drawingNo: f.drawingNo.trim(), name: f.name.trim(), partNo: f.partNo.trim(), material: f.material.trim(), rev: f.rev.trim() }) });
        const built = buildChars(full, base, rec);
        await saveRecognition(full, rev, rec, built, (s) => { st.step = s; });
        if (full.name !== f.name.trim() || full.partNo !== f.partNo.trim() || full.material !== f.material.trim()) await api('PATCH', '/drawings/' + d.id, { name: f.name.trim(), partNo: f.partNo.trim(), material: f.material.trim() });
        await refreshDrawings();
        const msg = '已识别 ' + built.chars.length + ' 个特性' + (built.mapping ? '，并与 Rev ' + base.rev + ' 做了换版映射' : '') + '：请逐项校核后冻结';
        st.saving = false; UI.upload = null;
        toast(msg, 'success');
        go('/annotate/' + d.id + '/' + rev.id);
      } catch (e) { console.error(e); st.saving = false; toast(e.message || String(e), 'error'); }
    };
    return { st, open, existing, stats, close, save, changeTol, stepText, GBT1804_CLASSES };
  },
  template: `
<modal :open="open" @close="close" title="上传图纸" :sub="st.info ? st.info.name + ' · ' + fmtSize(st.info.size) : '支持 PDF、PNG、JPG、SVG'" width="max-w-2xl">
  <div v-if="st.phase === 'work'" class="py-6">
    <div class="flex items-center gap-3"><span class="w-10 h-10 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center"><ic name="scan" :size="20"/></span>
      <div class="flex-1 min-w-0"><div class="font-semibold">正在识别</div><div class="text-xs text-ink-3 mt-0.5">{{ stepText(st.step) }}</div></div></div>
    <div class="mt-4"><progress-bar :value="st.step && st.step.step === 'ocr' && st.step.progress ? st.step.progress : -1"/></div>
    <p class="text-[11.5px] text-ink-4 mt-3 leading-relaxed">识别在本机浏览器里完成，图纸不会发到外网。扫描件第一次识别要加载约 8 MB 的识别引擎和语言包，之后会快很多。</p>
  </div>
  <div v-else-if="st.phase === 'error'" class="py-4">
    <div class="rounded-2xl bg-rose-50 text-rose-800 px-4 py-3 text-[13px]"><div class="font-semibold">识别失败</div><div class="mt-1 leading-relaxed">{{ st.error }}</div></div>
  </div>
  <div v-else-if="st.phase === 'confirm'" class="space-y-5">
    <div v-if="stats" class="grid grid-cols-3 gap-3">
      <div class="rounded-2xl bg-[#f7f7f9] p-3.5"><div class="text-[11px] text-ink-4">识别出的特性</div><div class="text-[22px] font-semibold tabular mt-1">{{ stats.total }}</div></div>
      <div class="rounded-2xl p-3.5" :class="stats.review ? 'bg-amber-50' : 'bg-emerald-50'"><div class="text-[11px] text-ink-4">需要核对</div><div class="text-[22px] font-semibold tabular mt-1" :class="stats.review ? 'text-amber-700' : 'text-emerald-700'">{{ stats.review }}</div></div>
      <div class="rounded-2xl bg-[#f7f7f9] p-3.5"><div class="text-[11px] text-ink-4">文字来源</div><div class="text-[15px] font-semibold mt-2">{{ stats.source }} · {{ stats.pages }} 页</div></div>
    </div>
    <div>
      <div class="flex items-center justify-between mb-2"><h4 class="section-title !text-[14px]">图纸信息</h4><span class="text-[11px] text-ink-4">已从标题栏读出，请核对</span></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">图号 *</label><input v-model="st.form.drawingNo" class="input font-mono" :disabled="!!(UI.upload && UI.upload.drawingId)"></div>
        <div><label class="label">版本 *</label><input v-model="st.form.rev" class="input font-mono w-32"></div>
        <div><label class="label">名称</label><input v-model="st.form.name" class="input"></div>
        <div><label class="label">零件号</label><input v-model="st.form.partNo" class="input font-mono"></div>
        <div><label class="label">材料</label><input v-model="st.form.material" class="input"></div>
        <div><label class="label">未注公差等级（GB/T 1804）</label>
          <select :value="st.form.generalTol" @change="changeTol($event.target.value)" class="input"><option value="">图纸未注明</option><option v-for="(l,k) in GBT1804_CLASSES" :key="k" :value="k">{{ l }}</option></select></div>
      </div>
      <p v-if="st.rec && st.rec.generalTolAssumed" class="text-[11.5px] text-amber-700 mt-2">图纸上没有写未注公差等级，暂按设置里的默认等级（{{ S.settings.defaultGeneralTol }}）处理，相关特性会标“需核对”。</p>
    </div>
    <div class="rounded-2xl px-4 py-3 text-[12.5px] leading-relaxed" :class="existing ? 'bg-brand-50/70 text-brand-900' : 'bg-[#f7f7f9] text-ink-2'">
      <template v-if="existing">将作为 <b class="font-mono">{{ existing.drawingNo }}</b> 的新版本 <b>Rev {{ st.form.rev }}</b> 保存。<span v-if="existing.latest && existing.latest.status === 'frozen'">保存后会自动与已冻结的 Rev {{ existing.latest.rev }} 做特性映射：沿用的特性保持原特性 ID。</span><span v-else-if="existing.latest" class="text-amber-700">注意：Rev {{ existing.latest.rev }} 还没有冻结。</span></template>
      <template v-else>这是一张新图纸，保存后进入标注工作台逐项校核。</template>
    </div>
  </div>
  <template #footer>
    <button class="btn-secondary" @click="close" :disabled="st.saving">取消</button>
    <button v-if="st.phase === 'confirm'" class="btn-primary" :disabled="st.saving" @click="save"><ic :name="st.saving ? 'refresh' : 'check'" :size="15" :class="st.saving ? 'animate-spin' : ''"/>{{ st.saving ? stepText(st.step) : '保存并开始校核' }}</button>
  </template>
</modal>`,
};

/* ---------------- 图纸库 ---------------- */
COMPONENTS['page-drawings'] = {
  setup() {
    const q = ref(''), filter = ref(UI.route.query.status || 'all');
    const fileInput = ref(null), over = ref(false), sampleMenu = ref(false), loading = ref(true);
    const load = async () => { try { await refreshDrawings(); } catch (e) { toast(e.message, 'error'); } loading.value = false; };
    onMounted(load);
    const statusOf = (d) => (d.latest ? d.latest.status : 'new');
    const synced = (d) => !!(d.latest && d.latest.fetchedAt);
    const counts = computed(() => {
      const ds = S.drawings;
      return { all: ds.length, review: ds.filter((d) => statusOf(d) === 'review' || statusOf(d) === 'new').length, frozen: ds.filter((d) => statusOf(d) === 'frozen' && !synced(d)).length, synced: ds.filter(synced).length };
    });
    const rows = computed(() => {
      const k = q.value.trim().toLowerCase();
      return S.drawings.filter((d) => (!k || (d.drawingNo + ' ' + d.name + ' ' + d.partNo + ' ' + d.material).toLowerCase().includes(k))
        && (filter.value === 'all' || (filter.value === 'review' ? ['review', 'new'].includes(statusOf(d)) : filter.value === 'frozen' ? statusOf(d) === 'frozen' && !synced(d) : synced(d))));
    });
    const flow = computed(() => [
      { key: 'upload', label: '上传图纸', state: S.drawings.length ? 'done' : 'current', hint: '拖进来或点“上传图纸”' },
      { key: 'review', label: '识别与校核', state: counts.value.review ? 'current' : S.drawings.length ? 'done' : 'todo', badge: counts.value.review ? counts.value.review + ' 张待校核' : '' },
      { key: 'frozen', label: '冻结', state: counts.value.frozen ? 'current' : counts.value.synced ? 'done' : 'todo', badge: counts.value.frozen ? counts.value.frozen + ' 张待 QMS 拉取' : '' },
      { key: 'synced', label: 'QMS 生成标准', state: counts.value.synced ? 'done' : 'todo', badge: counts.value.synced ? counts.value.synced + ' 张已同步' : '' },
    ]);
    const pickFlow = (k) => { if (k === 'upload') { if (fileInput.value) fileInput.value.click(); return; } filter.value = k; };
    const pick = () => { if (fileInput.value) fileInput.value.click(); };
    const onFiles = (fl) => { const files = Array.from(fl || []).filter(Boolean); if (!files.length) return; if (files.length > 1) toast('一次处理一个文件，先处理 ' + files[0].name, 'info'); UI.upload = { files: [files[0]] }; };
    const onPick = (e) => { onFiles(e.target.files); e.target.value = ''; };
    const onDrop = (e) => { over.value = false; onFiles(e.dataTransfer && e.dataTransfer.files); };
    const useSample = async (s) => { sampleMenu.value = false; try { UI.upload = { files: [await sampleFile(s)] }; } catch (e) { toast(e.message, 'error'); } };
    const newRev = (d) => { UI.upload = null; nextTick(() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.pdf,.png,.jpg,.jpeg,.svg'; inp.onchange = () => { if (inp.files && inp.files[0]) UI.upload = { files: [inp.files[0]], drawingId: d.id }; }; inp.click(); }); };
    const open = (d) => go('/annotate/' + d.id + (d.latest ? '/' + d.latest.id : ''));
    const remove = async (d) => {
      if (!(await confirmBox({ title: '删除图纸 ' + d.drawingNo + '？', message: '只能删除还没有冻结过的图纸。删除后原始文件和识别结果一起删除，不能恢复。', ok: '删除', danger: true }))) return;
      try { await api('DELETE', '/drawings/' + d.id); await refreshDrawings(); toast('已删除 ' + d.drawingNo, 'success'); } catch (e) { toast(e.message, 'error'); }
    };
    const actionOf = (d) => { const s = statusOf(d); return s === 'frozen' ? '查看' : s === 'new' ? '开始识别' : '继续校核'; };
    return { q, filter, rows, counts, flow, pickFlow, fileInput, over, sampleMenu, loading, pick, onPick, onDrop, useSample, newRev, open, remove, actionOf, statusOf, synced, SAMPLES };
  },
  template: `
<div class="space-y-5" @dragover.prevent="over = true" @dragleave.self="over = false" @drop.prevent="onDrop">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div><h1 class="page-title">图纸库</h1><p class="text-xs text-ink-3 mt-1">把图纸拖进来就开始识别。识别结果要逐项校核、冻结后，QMS 才会收到。</p></div>
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative"><ic name="search" :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"/><input v-model="q" class="input !h-[38px] pl-9 w-56" placeholder="搜索图号 / 名称 / 零件号"></div>
      <div class="relative">
        <button class="btn-secondary" @click="sampleMenu = !sampleMenu"><ic name="sparkles" :size="15"/>示例图纸</button>
        <div v-if="sampleMenu" class="fixed inset-0 z-20" @click="sampleMenu = false"></div>
        <transition name="pop"><div v-if="sampleMenu" class="absolute right-0 mt-2 w-[340px] card shadow-pop p-1.5 z-30">
          <button v-for="s in SAMPLES" :key="s.file" :data-sample="s.file" class="w-full text-left px-3 py-2.5 rounded-xl hover:bg-black/[0.04] transition-colors" @click="useSample(s)"><div class="text-[13px] font-medium">{{ s.label }}</div><div class="text-[11px] text-ink-4 mt-0.5">{{ s.desc }}</div></button>
        </div></transition>
      </div>
      <button class="btn-primary" @click="pick"><ic name="upload" :size="15"/>上传图纸</button>
      <input ref="fileInput" type="file" class="hidden" accept=".pdf,.png,.jpg,.jpeg,.svg,application/pdf,image/png,image/jpeg,image/svg+xml" @change="onPick" data-test="file-input">
    </div>
  </div>

  <div class="card px-4 py-3"><flow-steps :steps="flow" @pick="pickFlow"/></div>

  <div v-if="!loading && !S.drawings.length" class="dropzone card border-2 border-dashed border-black/10 py-16 text-center" :class="over ? 'is-over' : ''">
    <div class="w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mx-auto"><ic name="upload" :size="26"/></div>
    <div class="font-semibold text-[15px] mt-4">把图纸拖到这里</div>
    <p class="text-xs text-ink-3 mt-1.5">PDF、PNG、JPG、SVG。CAD 导出的 PDF 直接读文字；扫描件用本机 OCR。</p>
    <div class="flex items-center justify-center gap-2 mt-5"><button class="btn-primary" @click="pick"><ic name="upload" :size="15"/>选择文件</button><button class="btn-secondary" @click="useSample(SAMPLES[0])"><ic name="sparkles" :size="15"/>用示例图纸试试</button></div>
  </div>

  <div v-else class="card overflow-hidden" :class="over ? 'ring-2 ring-brand-500' : ''">
    <div class="overflow-x-auto"><table class="tbl">
      <thead><tr><th>图纸</th><th>图号</th><th>零件号 / 材料</th><th>当前版本</th><th>状态</th><th>特性</th><th>更新</th><th></th></tr></thead>
      <tbody>
        <tr v-for="d in rows" :key="d.id" class="row-link" @click="open(d)" :data-drawing="d.drawingNo">
          <td><div class="flex items-center gap-3"><div class="w-16 h-11 rounded-lg bg-[#f2f2f5] overflow-hidden ring-1 ring-black/5 shrink-0"><img v-if="d.latest && d.latest.thumb" :src="d.latest.thumb" class="w-full h-full object-cover" alt="" loading="lazy"></div><div class="font-medium">{{ d.name || '未命名' }}</div></div></td>
          <td class="font-mono text-[12.5px]">{{ d.drawingNo }}</td>
          <td><div class="font-mono text-[12px]">{{ d.partNo || '—' }}</div><div class="text-[11px] text-ink-4">{{ d.material || '—' }}</div></td>
          <td><span class="font-mono font-semibold text-brand-700">Rev {{ d.latest ? d.latest.rev : '—' }}</span><span v-if="d.revCount > 1" class="text-[11px] text-ink-4 ml-1.5">共 {{ d.revCount }} 版</span></td>
          <td><span :class="REV_STATUS[statusOf(d)][1]">{{ REV_STATUS[statusOf(d)][0] }}</span><span v-if="synced(d)" class="chip-blue ml-1">QMS 已拉取</span></td>
          <td class="tabular text-[12.5px]"><template v-if="d.latest">{{ d.latest.confirmedCount }} / {{ d.latest.charCount }} 已确认</template></td>
          <td class="text-xs text-ink-3">{{ fmtRel(d.updatedAt) }}</td>
          <td class="text-right" @click.stop>
            <button class="btn-primary btn-xs" @click="open(d)">{{ actionOf(d) }}<ic name="arrow-right" :size="12"/></button>
            <button v-if="statusOf(d) === 'frozen'" class="btn-secondary btn-xs ml-1" @click="newRev(d)" title="上传这张图纸的新版本"><ic name="upload" :size="12"/>新版本</button>
            <button v-if="statusOf(d) !== 'frozen' && d.revCount <= 1" class="btn-icon h-7 w-7 ml-1" @click="remove(d)" title="删除"><ic name="trash" :size="14"/></button>
          </td>
        </tr>
      </tbody>
    </table></div>
    <empty v-if="!rows.length && S.drawings.length" icon="search" title="没有符合条件的图纸"/>
    <div v-if="loading" class="p-6 space-y-3"><div class="skeleton h-10"></div><div class="skeleton h-10"></div><div class="skeleton h-10 w-2/3"></div></div>
  </div>
</div>`,
};

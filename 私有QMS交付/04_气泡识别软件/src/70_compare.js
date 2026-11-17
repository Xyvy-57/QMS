/* =====================================================================
 * 图纸对比：两个版本的特性映射（沿用 / 变更 / 新增 / 删除）+ 图面并排 / 叠加对比
 * 相似图纸：按特性组成和图面相似度查找，便于复用检验方案
 * ===================================================================== */

/** 两张页面图叠加：旧版红、新版蓝，重合处为深灰 */
async function overlayImages(urlA, urlB, w, h) {
  const [a, b] = await Promise.all([loadImg(urlA), loadImg(urlB)]);
  const W = Math.min(1600, w), H = Math.round((W * h) / w);
  const ca = newCanvas(W, H), cb = newCanvas(W, H), out = newCanvas(W, H);
  ca.getContext('2d').drawImage(a, 0, 0, W, H); cb.getContext('2d').drawImage(b, 0, 0, W, H);
  const da = ca.getContext('2d').getImageData(0, 0, W, H).data, db = cb.getContext('2d').getImageData(0, 0, W, H).data;
  const octx = out.getContext('2d'), img = octx.createImageData(W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const ka = 1 - (da[i] * 0.299 + da[i + 1] * 0.587 + da[i + 2] * 0.114) / 255, kb = 1 - (db[i] * 0.299 + db[i + 1] * 0.587 + db[i + 2] * 0.114) / 255;
    const ia = ka > 0.25, ib = kb > 0.25;
    if (ia && ib) { d[i] = 60; d[i + 1] = 60; d[i + 2] = 66; d[i + 3] = 255; }
    else if (ia) { d[i] = 225; d[i + 1] = 29; d[i + 2] = 72; d[i + 3] = 255; }
    else if (ib) { d[i] = 31; d[i + 1] = 99; d[i + 2] = 224; d[i + 3] = 255; }
    else { d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255; }
  }
  octx.putImageData(img, 0, 0);
  return out.toDataURL('image/png');
}

COMPONENTS['page-compare'] = {
  setup() {
    const st = reactive({ drawingId: UI.route.params.id || '', drawing: null, a: UI.route.query.a || '', b: UI.route.query.b || '', mode: 'table', filter: 'diff', overlay: '', overlayBusy: false, loading: false });
    const candidates = computed(() => S.drawings.filter((d) => d.revCount > 1));
    const load = async () => {
      if (!S.drawings.length) { try { await refreshDrawings(); } catch (e) { toast(e.message, 'error'); return; } }
      if (!st.drawingId && candidates.value[0]) st.drawingId = candidates.value[0].id;
      if (!st.drawingId) return;
      st.loading = true;
      try {
        const d = await api('GET', '/drawings/' + st.drawingId);
        st.drawing = d;
        const revs = d.revisions;
        if (!revOf(d, st.b)) st.b = revs.length ? revs[revs.length - 1].id : '';
        if (!revOf(d, st.a) || st.a === st.b) { const i = revs.findIndex((r) => r.id === st.b); st.a = i > 0 ? revs[i - 1].id : ''; }
      } catch (e) { toast(e.message, 'error'); }
      st.loading = false; st.overlay = '';
    };
    onMounted(load);
    watch(() => st.drawingId, (v, o) => { if (v !== o) { st.a = ''; st.b = ''; load(); } });
    watch(() => [st.a, st.b], () => { st.overlay = ''; });
    const revA = computed(() => (st.drawing ? revOf(st.drawing, st.a) : null));
    const revB = computed(() => (st.drawing ? revOf(st.drawing, st.b) : null));
    const result = computed(() => {
      const A = revA.value, B = revB.value;
      if (!A || !B) return null;
      if (B.mapping && B.mapping.baseRevId === A.id) {
        return { items: B.mapping.items.map((m) => ({ m, c: (B.chars || []).find((x) => x.cid === m.cid) })).filter((x) => x.c), removed: B.mapping.removed, stored: true };
      }
      /* 不相邻的两个版本：直接按特性 ID 比对（同一 ID 即同一特性） */
      const items = (B.chars || []).map((c) => {
        const o = (A.chars || []).find((x) => x.cid === c.cid);
        if (!o) return { m: { cid: c.cid, kind: 'added', changes: [] }, c };
        const ch = specDiff(o, c);
        return { m: { cid: c.cid, kind: ch.length ? 'changed' : 'same', oldCid: o.cid, oldNo: o.no, changes: ch }, c };
      });
      const removed = (A.chars || []).filter((o) => !(B.chars || []).some((c) => c.cid === o.cid)).map((o) => ({ cid: o.cid, no: o.no, name: o.name, spec: specLine(o) }));
      return { items, removed, stored: false };
    });
    const summary = computed(() => {
      const r = result.value, o = { same: 0, changed: 0, added: 0, uncertain: 0, removed: r ? r.removed.length : 0 };
      if (r) r.items.forEach((x) => { o[x.m.kind] = (o[x.m.kind] || 0) + 1; });
      return o;
    });
    const rows = computed(() => (result.value ? result.value.items.filter((x) => st.filter === 'all' || x.m.kind !== 'same').sort((p, q) => p.c.no - q.c.no) : []));
    const colorKey = computed(() => {
      const map = {};
      if (result.value) result.value.items.forEach((x) => { map[x.c.cid] = x.m.kind; });
      return (c) => map[c.cid] || 'same';
    });
    const removedChars = computed(() => (revA.value && result.value ? (revA.value.chars || []).filter((o) => result.value.removed.some((x) => x.cid === o.cid)) : []));
    const makeOverlay = async () => {
      const A = revA.value, B = revB.value;
      if (!A || !B || !A.pages[0] || !B.pages[0]) return;
      st.overlayBusy = true;
      try { st.overlay = await overlayImages(A.pages[0].image, B.pages[0].image, B.pages[0].w, B.pages[0].h); }
      catch (e) { toast('生成叠加图失败：' + e.message, 'error'); }
      st.overlayBusy = false;
    };
    watch(() => st.mode, (m) => { if (m === 'overlay' && !st.overlay) makeOverlay(); });
    return { st, candidates, revA, revB, result, summary, rows, colorKey, removedChars, makeOverlay, MAP_META };
  },
  template: `
<div class="space-y-4">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div><h1 class="page-title">图纸对比</h1><p class="text-xs text-ink-3 mt-1">按特性 ID 比较两个版本：哪些沿用、哪些规格变了、哪些是新增或删除。图面可以并排或叠加看。</p></div>
    <div class="flex flex-wrap items-center gap-2">
      <select v-model="st.drawingId" class="input !w-64"><option value="" disabled>选择图纸</option><option v-for="d in S.drawings" :key="d.id" :value="d.id" :disabled="d.revCount < 2">{{ d.drawingNo }} {{ d.name }}{{ d.revCount < 2 ? '（只有 1 个版本）' : '' }}</option></select>
      <template v-if="st.drawing">
        <select v-model="st.a" class="input !w-36 font-mono"><option v-for="r in st.drawing.revisions" :key="r.id" :value="r.id" :disabled="r.id === st.b">旧 Rev {{ r.rev }}</option></select>
        <ic name="arrow-right" :size="15" class="text-ink-4"/>
        <select v-model="st.b" class="input !w-36 font-mono"><option v-for="r in st.drawing.revisions" :key="r.id" :value="r.id" :disabled="r.id === st.a">新 Rev {{ r.rev }}</option></select>
      </template>
    </div>
  </div>

  <div v-if="!candidates.length && !st.loading" class="card"><empty icon="compare" title="还没有可以对比的图纸" desc="同一张图纸上传两个版本后就可以对比。可以在图纸库用示例：先上传“传动轴 Rev A”并冻结，再上传“Rev B”。"><button class="btn-secondary" @click="go('/drawings')">去图纸库</button></empty></div>

  <template v-else-if="result">
    <div class="flex flex-wrap items-center gap-2">
      <span class="chip-gray">沿用 {{ summary.same }}</span><span class="chip-amber">变更 {{ summary.changed }}</span><span class="chip-green">新增 {{ summary.added }}</span><span class="chip-red">删除 {{ summary.removed }}</span><span v-if="summary.uncertain" class="chip-violet">无法确认 {{ summary.uncertain }}</span>
      <span class="text-[11px] text-ink-4">{{ result.stored ? '映射结果来自新版本识别时的换版映射' : '两个版本不相邻，按特性 ID 直接比较' }}</span>
      <div class="flex-1"></div>
      <seg v-model="st.mode" size="sm" :options="[{ value: 'table', label: '特性对比', icon: 'list' }, { value: 'side', label: '并排', icon: 'compare' }, { value: 'overlay', label: '叠加', icon: 'layers' }]"/>
    </div>

    <div v-if="st.mode === 'table'" class="card overflow-hidden">
      <div class="px-4 pt-3 pb-2 flex items-center justify-between"><seg v-model="st.filter" size="sm" :options="[{ value: 'diff', label: '只看差异' }, { value: 'all', label: '全部' }]"/></div>
      <div class="overflow-x-auto"><table class="tbl">
        <thead><tr><th>新气泡</th><th>特性</th><th>结果</th><th>旧气泡</th><th>变化明细</th><th>新规格</th></tr></thead>
        <tbody>
          <tr v-for="x in rows" :key="x.c.cid">
            <td><bubble-no :c="x.c"/></td>
            <td><div class="font-medium">{{ x.c.name }}</div><div class="text-[11px] text-ink-4 font-mono">{{ x.c.cid }}</div></td>
            <td><span :class="MAP_META[x.m.kind][1]">{{ MAP_META[x.m.kind][0] }}</span></td>
            <td class="tabular">{{ x.m.oldNo ? '#' + x.m.oldNo : '—' }}</td>
            <td class="text-[12px] whitespace-normal min-w-[240px]"><div v-for="ch in x.m.changes" :key="ch.f">{{ ch.label }}：<span class="line-through text-ink-4">{{ ch.a }}</span> → <b>{{ ch.b }}</b> <span v-if="ch.dir" :class="ch.dir === '放宽' || ch.dir === '取消限值' ? 'chip-amber' : 'chip-blue'">{{ ch.dir }}</span></div><span v-if="!x.m.changes || !x.m.changes.length" class="text-ink-5">—</span></td>
            <td class="font-mono text-[12px]">{{ specLine(x.c) }}</td>
          </tr>
          <tr v-for="x in result.removed" :key="'r' + x.cid" class="bg-rose-50/40">
            <td class="text-ink-4">—</td><td><div class="font-medium line-through text-ink-3">{{ x.name }}</div><div class="text-[11px] text-ink-4 font-mono">{{ x.cid }}</div></td>
            <td><span class="chip-red">删除</span></td><td class="tabular">#{{ x.no }}</td><td class="text-[12px] text-ink-3">新版本没有这个特性</td><td class="font-mono text-[12px] text-ink-4">{{ x.spec }}</td>
          </tr>
        </tbody>
      </table></div>
      <empty v-if="!rows.length && !result.removed.length" icon="check" title="两个版本的特性规格完全一致"/>
    </div>

    <div v-else-if="st.mode === 'side'" class="grid grid-cols-1 xl:grid-cols-2 gap-3">
      <div v-for="(r,i) in [revA, revB]" :key="i" class="card overflow-hidden">
        <div class="px-4 py-2.5 border-b border-black/[0.06] flex items-center gap-2"><span class="font-mono font-semibold">{{ i === 0 ? '旧' : '新' }} Rev {{ r.rev }}</span><span :class="REV_STATUS[r.status][1]">{{ REV_STATUS[r.status][0] }}</span><span class="text-[11px] text-ink-4 ml-auto">{{ (r.chars || []).length }} 个特性</span></div>
        <div class="h-[560px]"><page-viewer v-if="r.pages && r.pages[0]" :src="r.pages[0].image" :w="r.pages[0].w" :h="r.pages[0].h" :chars="i === 0 ? removedChars : (r.chars || []).filter(c => (c.page || 1) === 1)" tool="hand" readonly :color-key="i === 0 ? (c) => 'removed' : colorKey"/></div>
      </div>
    </div>

    <div v-else class="card overflow-hidden">
      <div class="px-4 py-2.5 border-b border-black/[0.06] flex flex-wrap items-center gap-4 text-[12px] text-ink-2">
        <span class="inline-flex items-center gap-1.5"><span class="legend-dot bg-rose-600"></span>只在 Rev {{ revA.rev }} 里有（删掉的线条）</span>
        <span class="inline-flex items-center gap-1.5"><span class="legend-dot bg-brand-600"></span>只在 Rev {{ revB.rev }} 里有（新加的线条）</span>
        <span class="inline-flex items-center gap-1.5"><span class="legend-dot bg-zinc-700"></span>两版相同</span>
        <span class="text-ink-4 ml-auto">两版图面要按同一图框对齐才准确</span>
      </div>
      <div class="h-[600px] relative">
        <page-viewer v-if="st.overlay" :src="st.overlay" :w="revB.pages[0].w" :h="revB.pages[0].h" :chars="(revB.chars || []).filter(c => (c.page || 1) === 1)" tool="hand" readonly :color-key="colorKey"/>
        <div v-else class="absolute inset-0 flex items-center justify-center"><div class="w-64 text-center"><progress-bar/><p class="text-xs text-ink-4 mt-2">正在生成叠加图…</p></div></div>
      </div>
    </div>
  </template>
</div>`,
};

/* ---------------- 相似图纸 ---------------- */
COMPONENTS['page-similar'] = {
  setup() {
    const sel = ref(UI.route.params.id || '');
    onMounted(async () => { if (!S.drawings.length) { try { await refreshDrawings(); } catch (e) { toast(e.message, 'error'); } } if (!sel.value && S.drawings[0]) sel.value = S.drawings[0].id; });
    const me0 = computed(() => S.drawings.find((d) => d.id === sel.value) || null);
    const rows = computed(() => {
      const a = me0.value;
      if (!a || !a.sig) return [];
      return S.drawings.filter((d) => d.id !== a.id && d.sig).map((d) => Object.assign({ d }, sigSimilarity(a.sig, d.sig))).sort((p, q) => q.score - p.score);
    });
    return { sel, me0, rows };
  },
  template: `
<div class="space-y-4">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div><h1 class="page-title">相似图纸</h1><p class="text-xs text-ink-3 mt-1">按特性组成（65%）和图面外观（35%）找相似的图纸。相似图纸的检验方案通常可以直接复用。</p></div>
    <select v-model="sel" class="input !w-72"><option value="" disabled>选择一张图纸</option><option v-for="d in S.drawings" :key="d.id" :value="d.id">{{ d.drawingNo }} {{ d.name }}</option></select>
  </div>
  <div v-if="me0" class="card p-4 flex items-center gap-4">
    <div class="w-28 h-20 rounded-xl overflow-hidden bg-[#f2f2f5] ring-1 ring-black/5 shrink-0"><img v-if="me0.latest && me0.latest.thumb" :src="me0.latest.thumb" class="w-full h-full object-cover" alt=""></div>
    <div class="min-w-0"><div class="font-semibold">{{ me0.name }}</div><div class="text-xs text-ink-3 font-mono mt-0.5">{{ me0.drawingNo }} · Rev {{ me0.latest ? me0.latest.rev : '—' }}</div><div class="text-xs text-ink-4 mt-1">{{ me0.sig ? me0.sig.feats.length + ' 种特性规格' : '还没有识别结果' }}</div></div>
  </div>
  <div class="card overflow-hidden">
    <div class="overflow-x-auto"><table class="tbl">
      <thead><tr><th>图纸</th><th>图号</th><th class="min-w-[180px]">相似度</th><th>相同的特性规格</th><th>图面</th><th></th></tr></thead>
      <tbody>
        <tr v-for="x in rows" :key="x.d.id" class="row-link" @click="go('/annotate/' + x.d.id)">
          <td><div class="flex items-center gap-3"><div class="w-14 h-10 rounded-lg overflow-hidden bg-[#f2f2f5] ring-1 ring-black/5 shrink-0"><img v-if="x.d.latest && x.d.latest.thumb" :src="x.d.latest.thumb" class="w-full h-full object-cover" alt="" loading="lazy"></div><span class="font-medium">{{ x.d.name }}</span></div></td>
          <td class="font-mono text-[12.5px]">{{ x.d.drawingNo }}</td>
          <td><div class="flex items-center gap-2"><div class="flex-1 h-1.5 rounded-full bg-black/[0.07] overflow-hidden"><div class="h-full rounded-full bg-brand-500" :style="{ width: Math.round(x.score * 100) + '%' }"></div></div><span class="text-[12px] tabular w-10 text-right">{{ Math.round(x.score * 100) }}%</span></div></td>
          <td class="tabular">{{ x.common }} 种</td>
          <td class="tabular text-[12px] text-ink-3">{{ Math.round(x.img * 100) }}%</td>
          <td class="text-right"><button class="btn-secondary btn-xs" @click.stop="go('/annotate/' + x.d.id)">打开</button></td>
        </tr>
      </tbody>
    </table></div>
    <empty v-if="!rows.length" icon="search" title="没有可比较的图纸" desc="至少要有两张已识别的图纸"/>
  </div>
</div>`,
};

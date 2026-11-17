/* =====================================================================
 * 页面 D：基础资料 —— 零部件 / 工序路线与模板 / 检验场景与流程步骤 / 检具与检验方法
 * 这里集中体现“每道工序、每个流程都能复用”：
 *   · 流程步骤库 → 五类检验场景 = 固定步骤的有序组合 + 参数（不做任意 BPM）
 *   · 工序路线模板 → 应用到零件后生成独立副本（模板后续修改不回写）
 *   · 工序上的检验点 → 直接带着工序发起检验任务
 * ===================================================================== */

const GAUGE_CATS = ['线性尺寸', '角度尺寸', '形位公差', '螺纹', '表面粗糙度', '倒角', '外观', '理化', '功能', '焊接'];

function blankDrawing(p) {
  return FRAME + '<text x="430" y="210" text-anchor="middle" font-size="16" fill="#94a3b8">图纸待从气泡软件同步</text><text x="430" y="236" text-anchor="middle" font-size="11" fill="#cbd5e1">在“气泡识别工作台”完成标注并冻结后，气泡会显示在这里</text>' + titleBlock({ partNo: p.partNo, name: p.name, dwg: p.drawingNo, rev: p.drawingRev, mat: p.material || '—' });
}
function routePoints(ops) { return sum((ops || []).map((o) => o.insp.length)); }
function applyRouteTo(part, tpl) {
  part.route = { templateId: tpl.id, templateRev: tpl.rev, appliedAt: nowISO(), ops: clone(tpl.ops) };
  logAudit('工序路线', part.partNo, '应用模板「' + tpl.name + '」Rev ' + tpl.rev + '，生成独立路线副本（' + tpl.ops.length + ' 道工序、' + routePoints(tpl.ops) + ' 个检验点）');
}

/* ---------------- 零部件 ---------------- */
COMPONENTS['page-parts'] = {
  setup() {
    const sel = ref(UI.route.query.id && S.parts.some((x) => x.id === UI.route.query.id) ? UI.route.query.id : S.parts[0].id);
    const p = computed(() => S.parts.find((x) => x.id === sel.value) || S.parts[0]);
    const std = computed(() => effectiveStd(p.value.id));
    const plans = computed(() => S.plans.filter((x) => x.partId === p.value.id && x.status !== 'retired'));
    const tasks = computed(() => S.tasks.filter((t) => t.partId === p.value.id).slice(0, 5));
    const openNcr = computed(() => S.ncrs.filter((n) => n.partId === p.value.id && n.status !== 'closed').length);
    const tpl = computed(() => (p.value.route ? S.routeTemplates.find((t) => t.id === p.value.route.templateId) || null : null));
    const stale = computed(() => !!tpl.value && tpl.value.rev > p.value.route.templateRev);
    const points = computed(() => { const out = []; (p.value.route ? p.value.route.ops : []).forEach((op) => op.insp.forEach((b) => out.push({ op, b, ok: plansFor(p.value.id, b.scene).length > 0 }))); return out; });
    const startTask = (x) => { UI.newTask = { scene: x.b.scene, partId: p.value.id, ctx: { op: x.op.no + ' ' + x.op.name, freq: x.b.freq || '' } }; };
    const ap = reactive({ open: false, tplId: '' });
    const openApply = () => { ap.tplId = (tpl.value || S.routeTemplates[0] || {}).id || ''; ap.open = true; };
    const doApply = () => { const t = S.routeTemplates.find((x) => x.id === ap.tplId); if (!t) return; applyRouteTo(p.value, t); ap.open = false; toast('已应用模板「' + t.name + '」Rev ' + t.rev + '，零件得到独立的路线副本', 'success'); };
    const nw = reactive({ open: false, partNo: '', name: '', customer: '', drawingNo: '', drawingRev: 'A', material: '', tplId: '' });
    const openNew = () => { Object.assign(nw, { open: true, partNo: '', name: '', customer: S.customers[0] || '', drawingNo: '', drawingRev: 'A', material: '', tplId: '' }); };
    const saveNew = () => {
      if (!nw.partNo.trim() || !nw.name.trim() || !nw.drawingNo.trim()) { toast('零件号、名称、图号为必填', 'error'); return; }
      if (S.parts.some((x) => x.partNo === nw.partNo.trim())) { toast('零件号已存在', 'error'); return; }
      const part = { id: 'p' + nextSeq(), partNo: nw.partNo.trim(), name: nw.name.trim(), customer: nw.customer, drawingNo: nw.drawingNo.trim(), drawingRev: nw.drawingRev.trim() || 'A', material: nw.material.trim(), route: null };
      part.svg = blankDrawing(part);
      S.parts.push(part);
      logAudit('零部件', part.partNo, '新建零件 ' + part.name);
      const t = S.routeTemplates.find((x) => x.id === nw.tplId);
      if (t) applyRouteTo(S.parts[S.parts.length - 1], t);
      sel.value = part.id; nw.open = false; toast('零件已创建。下一步：在气泡识别工作台同步图纸气泡，生成检验标准', 'success');
    };
    return { sel, p, std, plans, tasks, openNcr, tpl, stale, points, startTask, ap, openApply, doApply, nw, openNew, saveNew };
  },
  template: `
<div class="space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div><h1 class="page-title">零部件</h1><p class="text-xs text-ink-3 mt-1">一物一档：图纸版本、检验标准、检验方案、工序路线与质量记录都挂在零件上。没有 ERP / PLM 时由获授权的工程人员在这里维护。</p></div>
    <g-btn perm="md.edit" cls="btn-primary" icon="plus" @click="openNew">新建零件</g-btn>
  </div>
  <div class="grid grid-cols-1 xl:grid-cols-12 gap-5">
    <div class="xl:col-span-3 space-y-2">
      <button v-for="x in S.parts" :key="x.id" @click="sel = x.id" class="w-full text-left rounded-2xl px-4 py-3 transition-all duration-300 ease-apple ring-1 ring-inset" :class="x.id === sel ? 'bg-white ring-brand-500 shadow-soft' : 'bg-white/60 ring-black/[0.06] hover:bg-white'">
        <div class="flex items-center justify-between gap-2"><span class="font-medium">{{ x.name }}</span><ic v-if="x.id === sel" name="chevron-right" :size="14" class="text-brand-600"/></div>
        <div class="text-[11px] text-ink-4 font-mono mt-0.5">{{ x.partNo }} · {{ x.drawingNo }} Rev {{ x.drawingRev }}</div>
      </button>
    </div>

    <div class="xl:col-span-9 space-y-5">
      <div class="card p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div><div class="text-[11px] font-mono text-ink-4">{{ p.partNo }}</div><h2 class="text-[19px] font-semibold tracking-tight">{{ p.name }}</h2></div>
          <button class="btn-secondary btn-sm" @click="go('/bubble')"><ic name="target" :size="14"/>在气泡软件中打开图纸</button>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-5 gap-x-6 gap-y-3 mt-4">
          <kv k="客户" :v="p.customer"/><kv k="图号" :v="p.drawingNo" mono/><kv k="图纸版本" :v="p.drawingRev" mono/><kv k="材料" :v="p.material"/>
          <kv k="未关闭 NCR"><span :class="openNcr ? 'text-rose-600 font-semibold' : ''">{{ openNcr }}</span></kv>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
          <div class="h-[260px] rounded-xl ring-1 ring-black/[0.06] overflow-hidden"><drawing-viewer :svg="std ? stdSvg(std.id) : svgOf(p)" :items="std ? std.items : []" mini/></div>
          <div class="space-y-4">
            <div><div class="label">检验标准</div>
              <button v-if="std" class="w-full flex items-center justify-between gap-3 rounded-xl ring-1 ring-black/[0.06] px-3.5 py-2.5 text-left hover:bg-black/[0.02] transition-colors" @click="go('/standards/' + std.id)"><span><span class="font-medium">{{ std.code }} Rev {{ std.rev }}</span><span class="text-[11px] text-ink-4 ml-2">{{ std.items.length }} 项特性 · 图纸 Rev {{ std.drawingRev }}</span></span><st k="std" :v="std.status"/></button>
              <div v-else class="rounded-xl bg-amber-50 text-amber-800 px-3.5 py-2.5 text-[12.5px]">还没有生效的检验标准。<button class="link" @click="go('/bubble')">去同步气泡</button></div></div>
            <div><div class="label">检验方案</div>
              <div class="space-y-1.5">
                <button v-for="pl in plans" :key="pl.id" class="w-full flex items-center justify-between gap-3 rounded-xl ring-1 ring-black/[0.06] px-3.5 py-2 text-left hover:bg-black/[0.02] transition-colors" @click="go('/plans/' + pl.id)">
                  <span class="min-w-0"><span class="font-medium">{{ pl.code }} Rev {{ pl.rev }}</span><span class="flex flex-wrap gap-1 mt-1"><span v-for="c in pl.scenes" :key="c" class="chip" :class="SCENE_META[c].tint">{{ sceneOf(c).name }}</span></span></span><st k="plan" :v="pl.status"/></button>
                <div v-if="!plans.length" class="text-xs text-ink-4">还没有检验方案</div>
              </div></div>
          </div>
        </div>
      </div>

      <div class="card p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div><h2 class="section-title">工序路线</h2>
            <p v-if="p.route" class="text-xs text-ink-3 mt-1">来自模板「{{ tpl ? tpl.name : '已删除的模板' }}」Rev {{ p.route.templateRev }}，应用于 {{ fmtDate(p.route.appliedAt) }}。这是零件自己的独立副本，模板后续修改不会回写。</p>
            <p v-else class="text-xs text-ink-3 mt-1">还没有工序路线。可以从模板一键生成。</p></div>
          <g-btn perm="md.edit" cls="btn-secondary btn-sm" icon="layers" @click="openApply">{{ p.route ? '重新应用模板' : '应用路线模板' }}</g-btn>
        </div>
        <div v-if="stale" class="mt-3 rounded-xl bg-amber-50 text-amber-800 px-3.5 py-2.5 text-[12.5px]">模板已更新到 Rev {{ tpl.rev }}，本零件仍使用 Rev {{ p.route.templateRev }} 的副本。是否采用新版由你决定，不会自动覆盖。</div>
        <div v-if="p.route" class="mt-4"><route-flow :ops="p.route.ops"/></div>

        <div v-if="points.length" class="mt-5">
          <div class="label">工序检验点（点击即可带着工序发起检验，五类检验共用同一执行流程）</div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div v-for="(x,i) in points" :key="i" class="flex items-center gap-3 rounded-xl ring-1 ring-black/[0.06] px-3.5 py-2.5">
              <span class="text-[10px] font-mono font-semibold text-brand-600 bg-brand-50 rounded-md px-1.5 py-0.5 shrink-0">{{ x.op.no }}</span>
              <span class="flex-1 min-w-0"><span class="font-medium text-[12.5px]">{{ x.op.name }}</span><span class="chip ml-2" :class="SCENE_META[x.b.scene].tint">{{ sceneOf(x.b.scene).name }}{{ x.b.freq ? ' · ' + x.b.freq : '' }}</span><span v-if="x.b.note" class="text-[11px] text-ink-4 ml-1.5">{{ x.b.note }}</span></span>
              <g-btn perm="task.create" cls="btn-soft btn-xs" icon="play" :when="x.ok" why="该零件没有适用于此场景的生效方案" @click="startTask(x)">发起</g-btn>
            </div>
          </div>
        </div>
      </div>

      <div class="card overflow-hidden">
        <div class="px-5 pt-4 pb-3 flex items-center justify-between"><h2 class="section-title">最近检验任务</h2><button class="link text-xs" @click="go('/tasks')">全部任务</button></div>
        <table class="tbl"><tbody>
          <tr v-for="t in tasks" :key="t.id" class="row-link" @click="go('/inspect/' + t.id)">
            <td class="font-mono text-[12.5px] font-medium">{{ t.code }}</td><td><span class="chip" :class="SCENE_META[t.scene].tint">{{ sceneOf(t.scene).name }}</span></td><td class="text-[12px] text-ink-2 w-full max-w-0 min-w-[160px]"><div class="truncate" :title="ctxText(t)">{{ ctxText(t) || '—' }}</div></td><td><st k="task" :v="t.status" dot/></td><td class="text-xs text-ink-3">{{ fmtRel(t.createdAt) }}</td>
          </tr>
        </tbody></table>
        <empty v-if="!tasks.length" icon="list" title="该零件还没有检验任务"/>
      </div>
    </div>
  </div>

  <modal :open="ap.open" @close="ap.open = false" title="应用工序路线模板" :sub="p.partNo + ' ' + p.name + ' · 将生成独立的路线副本' + (p.route ? '，替换当前路线' : '')" width="max-w-3xl">
    <div class="space-y-2.5">
      <button v-for="t in S.routeTemplates" :key="t.id" type="button" @click="ap.tplId = t.id" class="w-full text-left rounded-2xl p-4 ring-1 ring-inset transition-all duration-200" :class="ap.tplId === t.id ? 'ring-brand-500 bg-brand-50/40' : 'ring-black/[0.07] hover:bg-black/[0.015]'">
        <div class="flex items-center justify-between gap-3"><span class="font-medium">{{ t.name }} <span class="text-[11px] text-ink-4 font-normal">Rev {{ t.rev }}</span></span><span class="text-[11px] text-ink-4">{{ t.ops.length }} 道工序</span></div>
        <div class="mt-3"><route-flow :ops="t.ops" compact/></div>
      </button>
    </div>
    <template #footer><button class="btn-secondary" @click="ap.open = false">取消</button><button class="btn-primary" :disabled="!ap.tplId" @click="doApply">应用</button></template>
  </modal>

  <modal :open="nw.open" @close="nw.open = false" title="新建零件" sub="先建立零件与图号；图纸与气泡在气泡识别工作台同步" width="max-w-xl">
    <div class="grid grid-cols-2 gap-4">
      <div><label class="label">零件号</label><input v-model="nw.partNo" class="input" placeholder="如 1.2020.01.3"></div>
      <div><label class="label">名称</label><input v-model="nw.name" class="input"></div>
      <div><label class="label">图号</label><input v-model="nw.drawingNo" class="input" placeholder="如 DWG-2026-120"></div>
      <div><label class="label">图纸版本</label><input v-model="nw.drawingRev" class="input"></div>
      <div><label class="label">客户</label><select v-model="nw.customer" class="input"><option v-for="c in S.customers" :key="c">{{ c }}</option></select></div>
      <div><label class="label">材料</label><input v-model="nw.material" class="input"></div>
      <div class="col-span-2"><label class="label">工序路线模板（可稍后再选）</label><select v-model="nw.tplId" class="input"><option value="">暂不应用</option><option v-for="t in S.routeTemplates" :key="t.id" :value="t.id">{{ t.name }}（Rev {{ t.rev }}，{{ t.ops.length }} 道工序）</option></select></div>
    </div>
    <template #footer><button class="btn-secondary" @click="nw.open = false">取消</button><button class="btn-primary" @click="saveNew">创建</button></template>
  </modal>
</div>`,
};

/* ---------------- 工序路线与模板 ---------------- */
COMPONENTS['page-routes'] = {
  setup() {
    const tab = ref('tpl');
    const users = (t) => S.parts.filter((p) => p.route && p.route.templateId === t.id);
    const ed = reactive({ open: false, id: '', name: '', desc: '', ops: [] });
    const drag = ref(-1);
    const keyed = (ops) => clone(ops).map((o, i) => Object.assign(o, { _k: 'k' + i + '-' + nextSeq() }));
    const openEdit = (t) => { Object.assign(ed, { open: true, id: t.id, name: t.name, desc: t.desc || '', ops: keyed(t.ops) }); };
    const openNew = () => { Object.assign(ed, { open: true, id: '', name: '', desc: '', ops: keyed([{ no: '10', name: '', wc: '', insp: [] }]) }); };
    const copyTpl = (t) => { Object.assign(ed, { open: true, id: '', name: t.name + '（副本）', desc: t.desc || '', ops: keyed(t.ops) }); };
    const addOp = () => { const last = ed.ops[ed.ops.length - 1]; const no = last && /^\d+$/.test(last.no) ? String(parseInt(last.no, 10) + 10) : String((ed.ops.length + 1) * 10); ed.ops.push({ no, name: '', wc: '', insp: [], _k: 'k-' + nextSeq() }); };
    const removeOp = (i) => { ed.ops.splice(i, 1); };
    const hasInsp = (op, c) => op.insp.some((b) => b.scene === c);
    const toggleInsp = (op, c) => { const i = op.insp.findIndex((b) => b.scene === c); if (i >= 0) op.insp.splice(i, 1); else op.insp.push(c === 'IPQC' ? { scene: c, freq: '每 2 小时' } : { scene: c }); };
    const ipqc = (op) => op.insp.find((b) => b.scene === 'IPQC') || null;
    const onDragStart = (i, e) => { drag.value = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); };
    const onDragOver = (i) => { if (drag.value < 0 || drag.value === i) return; const x = ed.ops.splice(drag.value, 1)[0]; ed.ops.splice(i, 0, x); drag.value = i; };
    const onDragEnd = () => { drag.value = -1; };
    const save = () => {
      if (!ed.name.trim()) { toast('请填写模板名称', 'error'); return; }
      if (!ed.ops.length) { toast('至少需要一道工序', 'error'); return; }
      if (ed.ops.some((o) => !String(o.no).trim() || !String(o.name).trim())) { toast('每道工序都需要工序号和名称', 'error'); return; }
      if (new Set(ed.ops.map((o) => String(o.no).trim())).size !== ed.ops.length) { toast('工序号不能重复', 'error'); return; }
      const ops = ed.ops.map((o) => ({ no: String(o.no).trim(), name: String(o.name).trim(), wc: String(o.wc || '').trim(), insp: clone(o.insp) }));
      const t = ed.id ? S.routeTemplates.find((x) => x.id === ed.id) : null;
      if (t) {
        Object.assign(t, { name: ed.name.trim(), desc: ed.desc.trim(), ops, rev: t.rev + 1, updatedAt: nowISO() });
        logAudit('工序路线模板', t.name, '修订为 Rev ' + t.rev + '（已应用的零件路线不受影响）');
        toast('模板已修订为 Rev ' + t.rev + '。已应用的零件保留原副本，可在零件上选择是否重新应用', 'success');
      } else {
        S.routeTemplates.push({ id: 'rt' + nextSeq(), name: ed.name.trim(), rev: 1, desc: ed.desc.trim(), updatedAt: nowISO(), ops });
        logAudit('工序路线模板', ed.name.trim(), '新建模板'); toast('模板已创建', 'success');
      }
      ed.open = false;
    };
    const ap = reactive({ open: false, tpl: null, picks: [] });
    const openApply = (t) => { ap.tpl = t; ap.picks = []; ap.open = true; };
    const togglePick = (id) => { const i = ap.picks.indexOf(id); if (i >= 0) ap.picks.splice(i, 1); else ap.picks.push(id); };
    const doApply = () => { ap.picks.forEach((id) => applyRouteTo(S.parts.find((p) => p.id === id), ap.tpl)); toast('已应用到 ' + ap.picks.length + ' 个零件，各自生成独立副本', 'success'); ap.open = false; };
    return { tab, users, ed, drag, openEdit, openNew, copyTpl, addOp, removeOp, hasInsp, toggleInsp, ipqc, onDragStart, onDragOver, onDragEnd, save, ap, openApply, togglePick, doApply, routePoints };
  },
  template: `
<div class="space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div><h1 class="page-title">工序路线与模板</h1><p class="text-xs text-ink-3 mt-1">把常用的工序排布和每道工序的检验点做成模板，一次编排、多个零件复用。模板应用到零件后生成独立副本，模板再修订也不会回写。与气泡软件的“工序管理 / 工序模板”对应。</p></div>
    <div class="flex items-center gap-2"><seg v-model="tab" :options="[{ value: 'tpl', label: '路线模板', count: S.routeTemplates.length }, { value: 'parts', label: '零件路线', count: S.parts.filter(p => p.route).length }]"/><g-btn perm="md.edit" cls="btn-primary" icon="plus" @click="openNew">新建模板</g-btn></div>
  </div>

  <div v-if="tab === 'tpl'" class="space-y-4">
    <div v-for="t in S.routeTemplates" :key="t.id" class="card p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div><div class="flex items-center gap-2"><h2 class="section-title">{{ t.name }}</h2><span class="chip-gray">Rev {{ t.rev }}</span></div><p class="text-xs text-ink-3 mt-1">{{ t.desc }} · {{ t.ops.length }} 道工序 · {{ routePoints(t.ops) }} 个检验点 · 更新于 {{ fmtDate(t.updatedAt) }}</p></div>
        <div class="flex items-center gap-1.5"><g-btn perm="md.edit" cls="btn-ghost btn-sm" icon="copy" @click="copyTpl(t)">复制</g-btn><g-btn perm="md.edit" cls="btn-ghost btn-sm" icon="edit" @click="openEdit(t)">修订</g-btn><g-btn perm="md.edit" cls="btn-soft btn-sm" icon="layers" @click="openApply(t)">应用到零件</g-btn></div>
      </div>
      <div class="mt-4"><route-flow :ops="t.ops"/></div>
      <div class="mt-4 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-3"><span>使用中的零件：</span>
        <button v-for="p in users(t)" :key="p.id" class="chip-gray hover:bg-black/10 transition-colors" @click="go('/parts?id=' + p.id)">{{ p.name }} · 副本 Rev {{ p.route.templateRev }}<span v-if="p.route.templateRev < t.rev" class="text-amber-700 ml-1">可更新</span></button>
        <span v-if="!users(t).length" class="text-ink-4">暂无</span></div>
    </div>
  </div>

  <div v-else class="card overflow-hidden">
    <table class="tbl">
      <thead><tr><th>零件</th><th>路线来源</th><th>工序</th><th>检验点</th><th>应用时间</th><th></th></tr></thead>
      <tbody>
        <tr v-for="p in S.parts" :key="p.id" class="row-link" @click="go('/parts?id=' + p.id)">
          <td><div class="font-medium">{{ p.name }}</div><div class="text-[11px] text-ink-4 font-mono">{{ p.partNo }}</div></td>
          <td class="text-[12.5px]"><template v-if="p.route">{{ (S.routeTemplates.find(t => t.id === p.route.templateId) || {}).name || '已删除的模板' }} <span class="text-ink-4">Rev {{ p.route.templateRev }}</span></template><span v-else class="text-ink-4">未设置</span></td>
          <td class="tabular">{{ p.route ? p.route.ops.length : '—' }}</td><td class="tabular">{{ p.route ? routePoints(p.route.ops) : '—' }}</td>
          <td class="text-xs text-ink-3">{{ p.route ? fmtDate(p.route.appliedAt) : '—' }}</td><td><ic name="chevron-right" :size="14" class="text-ink-5"/></td>
        </tr>
      </tbody>
    </table>
  </div>

  <drawer :open="ed.open" @close="ed.open = false" :title="ed.id ? '修订路线模板' : '新建路线模板'" sub="拖动左侧手柄调整工序顺序；在每道工序上点选要绑定的检验场景" width="max-w-3xl">
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div><label class="label">模板名称</label><input v-model="ed.name" class="input" placeholder="如 轴类零件标准路线"></div>
      <div><label class="label">说明</label><input v-model="ed.desc" class="input" placeholder="适用范围"></div>
    </div>
    <div class="label mt-5">工序</div>
    <transition-group name="list" tag="div" class="space-y-2 relative">
      <div v-for="(op,i) in ed.ops" :key="op._k" class="rounded-2xl ring-1 ring-black/[0.07] bg-white p-3 transition-shadow" :class="drag === i ? 'shadow-lift ring-brand-400' : ''" @dragover.prevent="onDragOver(i)">
        <div class="flex items-center gap-2">
          <span class="cursor-grab text-ink-5 hover:text-ink-3 px-0.5" draggable="true" @dragstart="onDragStart(i, $event)" @dragend="onDragEnd" title="拖动排序"><ic name="grip" :size="16"/></span>
          <input v-model="op.no" class="input !h-8 !w-16 font-mono text-center" placeholder="序号">
          <input v-model="op.name" class="input !h-8 flex-1" placeholder="工序名称">
          <input v-model="op.wc" class="input !h-8 !w-32" placeholder="工作中心">
          <button class="btn-icon" @click="removeOp(i)" title="删除工序"><ic name="trash" :size="14"/></button>
        </div>
        <div class="flex flex-wrap items-center gap-1.5 mt-2.5 pl-7">
          <span class="text-[11px] text-ink-4 mr-1">检验点</span>
          <button v-for="sc in S.scenes" :key="sc.code" type="button" @click="toggleInsp(op, sc.code)" class="h-7 px-2.5 rounded-full text-[11px] font-medium ring-1 ring-inset transition-all duration-200" :class="hasInsp(op, sc.code) ? SCENE_META[sc.code].tint + ' ring-black/10' : 'bg-white text-ink-4 ring-black/10 hover:text-ink-2'">{{ sc.name }}</button>
          <input v-if="ipqc(op)" v-model="ipqc(op).freq" class="input !h-7 !w-28 !text-[11px] ml-1" placeholder="巡检频次">
        </div>
      </div>
    </transition-group>
    <button class="btn-ghost btn-sm mt-3" @click="addOp"><ic name="plus" :size="14"/>添加工序</button>
    <template #footer><span class="mr-auto text-[11.5px] text-ink-4">{{ ed.id ? '保存后版本号 +1；已应用的零件路线不受影响' : '' }}</span><button class="btn-secondary" @click="ed.open = false">取消</button><button class="btn-primary" @click="save">保存</button></template>
  </drawer>

  <modal :open="ap.open" @close="ap.open = false" :title="ap.tpl ? '应用「' + ap.tpl.name + '」到零件' : ''" sub="每个零件得到独立副本；已有路线的零件会被替换" width="max-w-lg">
    <div class="space-y-1.5">
      <label v-for="p in S.parts" :key="p.id" class="flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-inset cursor-pointer transition-colors" :class="ap.picks.includes(p.id) ? 'ring-brand-500 bg-brand-50/40' : 'ring-black/[0.07] hover:bg-black/[0.015]'">
        <input type="checkbox" :checked="ap.picks.includes(p.id)" @change="togglePick(p.id)" class="w-4 h-4 accent-brand-600">
        <span class="flex-1"><span class="font-medium">{{ p.name }}</span><span class="text-[11px] text-ink-4 ml-2 font-mono">{{ p.partNo }}</span></span>
        <span class="text-[11px] text-ink-4">{{ p.route ? '已有路线，将替换' : '尚无路线' }}</span>
      </label>
    </div>
    <template #footer><button class="btn-secondary" @click="ap.open = false">取消</button><button class="btn-primary" :disabled="!ap.picks.length" @click="doApply">应用到 {{ ap.picks.length }} 个零件</button></template>
  </modal>
</div>`,
};

/* ---------------- 检验场景与流程步骤（可复用步骤库） ---------------- */
COMPONENTS['page-scenes'] = {
  setup() {
    const ed = reactive({ open: false, d: null });
    const fields = (s) => ({ steps: s.steps, photo: s.photo, review: s.review, allowInsufficient: !!s.allowInsufficient, desc: s.desc });
    const openEdit = (s) => { ed.d = clone(s); ed.open = true; };
    const changed = computed(() => !!ed.d && JSON.stringify(fields(ed.d)) !== JSON.stringify(fields(sceneOf(ed.d.code))));
    const toggleStep = (k) => {
      const d = ed.d; if (STEP_LIB[k].locked) return;
      const i = d.steps.indexOf(k); if (i >= 0) d.steps.splice(i, 1); else d.steps.push(k);
      d.steps.sort((a, b) => STEP_ORDER.indexOf(a) - STEP_ORDER.indexOf(b));
      if (!d.steps.includes('review')) d.review = 'never'; else if (d.review === 'never') d.review = 'always';
      if (!d.steps.includes('photo')) d.photo = 'none'; else if (!d.photo || d.photo === 'none') d.photo = 'onDefect';
    };
    const copyFrom = (code) => { if (!code) return; const s = sceneOf(code); Object.assign(ed.d, { steps: clone(s.steps), photo: s.photo, review: s.review, allowInsufficient: s.allowInsufficient }); toast('已复用「' + s.name + '」的流程步骤与参数，发布后生效', 'info'); };
    const publish = () => {
      const s = S.scenes.find((x) => x.code === ed.d.code);
      Object.assign(s, { steps: clone(ed.d.steps), photo: ed.d.photo, review: ed.d.review, allowInsufficient: !!ed.d.allowInsufficient, desc: ed.d.desc, ver: s.ver + 1 });
      logAudit('检验场景', s.name, '发布流程定义 v' + s.ver + '：' + s.steps.map((k) => STEP_LIB[k].name).join(' → '));
      ed.open = false; toast(s.name + ' 流程定义已发布为 v' + s.ver + '。在途任务按建单时冻结的版本继续执行', 'success');
    };
    const toggleEnabled = (s) => { s.enabled = !s.enabled; logAudit('检验场景', s.name, s.enabled ? '启用' : '停用（只阻止新建任务，在途任务不受影响）'); };
    const inflight = (s) => S.tasks.filter((t) => t.scene === s.code && (t.status === 'pending' || t.status === 'active') && t.snap.scene.ver !== s.ver).length;
    const planCount = (s) => S.plans.filter((p) => p.status === 'effective' && p.scenes.includes(s.code)).length;
    return { ed, openEdit, changed, toggleStep, copyFrom, publish, toggleEnabled, inflight, planCount };
  },
  template: `
<div class="space-y-6">
  <div><h1 class="page-title">检验场景与流程</h1><p class="text-xs text-ink-3 mt-1">五类检验场景的代码固定（IQC / 生产首件 / IPQC / FQC / OQC）。每个场景的执行流程由下面这套可复用的步骤拼成：只能启用、停用固定步骤并调整参数，不做任意流程编排。场景定义带版本，任务建单时冻结。</p></div>

  <div class="card p-5">
    <div class="flex items-center justify-between mb-3"><h2 class="section-title">流程步骤库</h2><span class="text-xs text-ink-4">{{ STEP_ORDER.length }} 个可复用步骤 · 带锁的为必选</span></div>
    <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5">
      <div v-for="(k,i) in STEP_ORDER" :key="k" class="rounded-2xl bg-[#f7f7f9] p-3.5 transition-all duration-300 ease-apple hover:bg-white hover:shadow-lift hover:-translate-y-0.5">
        <div class="flex items-center justify-between"><span class="w-8 h-8 rounded-xl bg-white text-brand-600 flex items-center justify-center shadow-soft"><ic :name="STEP_LIB[k].icon" :size="15"/></span><span class="text-[10px] font-mono text-ink-5">{{ i + 1 }}</span></div>
        <div class="font-medium mt-2.5 flex items-center gap-1">{{ STEP_LIB[k].name }}<ic v-if="STEP_LIB[k].locked" name="lock" :size="11" class="text-ink-4"/></div>
        <p class="text-[11px] text-ink-4 mt-1 leading-relaxed">{{ STEP_LIB[k].desc }}</p>
      </div>
    </div>
  </div>

  <div class="card overflow-hidden">
    <div class="px-5 pt-4 pb-3"><h2 class="section-title">步骤 × 场景</h2><p class="text-xs text-ink-3 mt-0.5">同一个步骤在多个场景里复用；差异只来自是否启用和参数。</p></div>
    <div class="overflow-x-auto"><table class="tbl">
      <thead><tr><th>步骤</th><th v-for="s in S.scenes" :key="s.code" class="text-center"><span class="chip" :class="SCENE_META[s.code].tint">{{ s.name }}</span></th></tr></thead>
      <tbody>
        <tr v-for="k in STEP_ORDER" :key="k"><td class="font-medium"><span class="inline-flex items-center gap-2"><ic :name="STEP_LIB[k].icon" :size="14" class="text-ink-3"/>{{ STEP_LIB[k].name }}</span></td>
          <td v-for="s in S.scenes" :key="s.code" class="text-center"><span v-if="s.steps.includes(k)" class="inline-flex w-5 h-5 rounded-full bg-emerald-500 text-white items-center justify-center"><ic name="check" :size="12" stroke="2.8"/></span><span v-else class="text-ink-5">—</span></td></tr>
        <tr><td class="text-ink-3">拍照要求</td><td v-for="s in S.scenes" :key="s.code" class="text-center text-[11.5px] text-ink-2">{{ PHOTO_POLICY[s.photo || 'none'] }}</td></tr>
        <tr><td class="text-ink-3">报告复核</td><td v-for="s in S.scenes" :key="s.code" class="text-center text-[11.5px] text-ink-2">{{ REVIEW_POLICY[s.review || 'never'] }}</td></tr>
      </tbody>
    </table></div>
  </div>

  <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
    <div v-for="s in S.scenes" :key="s.code" class="card p-5" :class="s.enabled ? '' : 'opacity-60'">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex items-center gap-3"><span class="w-10 h-10 rounded-2xl flex items-center justify-center" :class="SCENE_META[s.code].tint"><ic :name="SCENE_META[s.code].icon" :size="18"/></span>
          <div><div class="flex items-center gap-2"><h2 class="section-title">{{ s.name }}</h2><span class="text-[11px] font-mono text-ink-4">{{ s.en }}</span><span class="chip-gray">定义 v{{ s.ver }}</span><span v-if="!s.enabled" class="chip-gray">已停用</span></div><p class="text-xs text-ink-3 mt-0.5">{{ s.desc }}</p></div></div>
        <div class="flex items-center gap-1.5"><g-btn perm="scene.edit" cls="btn-ghost btn-sm" @click="toggleEnabled(s)">{{ s.enabled ? '停用' : '启用' }}</g-btn><g-btn perm="scene.edit" cls="btn-secondary btn-sm" icon="sliders" @click="openEdit(s)">配置流程</g-btn></div>
      </div>
      <div class="mt-4"><scene-pipeline :steps="s.steps" small/></div>
      <div class="flex flex-wrap items-center gap-1.5 mt-3"><span class="text-[11px] text-ink-4">建单字段</span><span v-for="k in s.ctx" :key="k" class="chip-gray">{{ CTX_FIELDS[k].label }}</span></div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[12px] text-ink-3"><span>{{ planCount(s) }} 个生效方案适用</span><span v-if="inflight(s)" class="text-amber-700">{{ inflight(s) }} 个在途任务仍按旧版本执行</span><button class="link" @click="go('/tasks/' + s.code)">查看任务</button></div>
    </div>
  </div>

  <drawer :open="ed.open" @close="ed.open = false" :title="ed.d ? '配置流程 · ' + ed.d.name : ''" sub="启用或停用固定步骤、调整参数；发布后生成新的定义版本，只影响之后新建的任务" width="max-w-2xl">
    <template v-if="ed.d">
      <div class="flex flex-wrap items-end gap-3 mb-5">
        <div class="flex-1 min-w-[200px]"><label class="label">说明</label><input v-model="ed.d.desc" class="input"></div>
        <div><label class="label">复用其它场景的流程</label><select class="input w-44" @change="copyFrom($event.target.value); $event.target.value = ''"><option value="">选择来源场景…</option><option v-for="s in S.scenes.filter(x => x.code !== ed.d.code)" :key="s.code" :value="s.code">{{ s.name }}</option></select></div>
      </div>
      <div class="label">流程步骤</div>
      <div class="space-y-1.5">
        <label v-for="k in STEP_ORDER" :key="k" class="flex items-center gap-3 rounded-xl px-3.5 py-2.5 ring-1 ring-inset transition-all duration-200" :class="[ed.d.steps.includes(k) ? 'ring-brand-500/60 bg-brand-50/30' : 'ring-black/[0.07]', STEP_LIB[k].locked ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-black/[0.015]']">
          <input type="checkbox" :checked="ed.d.steps.includes(k)" :disabled="STEP_LIB[k].locked" @change="toggleStep(k)" class="w-4 h-4 accent-brand-600">
          <ic :name="STEP_LIB[k].icon" :size="15" class="text-ink-3"/>
          <span class="flex-1 min-w-0"><span class="font-medium text-[13px]">{{ STEP_LIB[k].name }}</span><span v-if="STEP_LIB[k].locked" class="chip-gray ml-2">必选</span><span class="block text-[11px] text-ink-4 truncate">{{ STEP_LIB[k].desc }}</span></span>
        </label>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
        <div><label class="label">拍照要求</label><select v-model="ed.d.photo" class="input" :disabled="!ed.d.steps.includes('photo')"><option v-for="(l,k) in PHOTO_POLICY" :key="k" :value="k">{{ l }}</option></select></div>
        <div><label class="label">报告复核</label><select v-model="ed.d.review" class="input" :disabled="!ed.d.steps.includes('review')"><option v-for="(l,k) in REVIEW_POLICY" :key="k" :value="k">{{ l }}</option></select></div>
      </div>
      <label class="flex items-center gap-2 mt-4 text-[13px] cursor-pointer"><input type="checkbox" v-model="ed.d.allowInsufficient" class="w-4 h-4 accent-brand-600">存在缺失项时，允许填写原因后以“证据不足”提交</label>
      <div class="mt-5"><div class="label">发布后的流程</div><scene-pipeline :steps="ed.d.steps"/></div>
      <p class="text-[11.5px] text-ink-4 mt-3 leading-relaxed">普通合格检验完成即可，不加额外放行审批；复核只在这里显式开启后才会出现，复核人不得为本轮签名人。</p>
    </template>
    <template #footer><button class="btn-secondary" @click="ed.open = false">取消</button><button class="btn-primary" :disabled="!changed" @click="publish">发布为新版本</button></template>
  </drawer>
</div>`,
};

/* ---------------- 检具与检验方法 ---------------- */
COMPONENTS['page-gauges'] = {
  setup() {
    const cat = ref(''), kind = ref(''), q = ref('');
    const catCount = (c) => S.gauges.filter((g) => g.cats.includes(c)).length;
    const cats = computed(() => GAUGE_CATS.filter((c) => catCount(c) > 0 || c === cat.value));
    const rows = computed(() => { const k = q.value.trim().toLowerCase(); return S.gauges.filter((g) => (!cat.value || g.cats.includes(cat.value)) && (!kind.value || g.kind === kind.value) && (!k || (g.name + ' ' + (g.alias || '') + ' ' + g.items.join(' ')).toLowerCase().includes(k))); });
    const usedBy = (g) => { let n = 0; S.standards.filter((s) => s.status === 'effective').forEach((s) => s.items.forEach((i) => { if (i.gauge === g.id) n++; })); return n; };
    const cal = (g) => {
      if (!g.calDue) return ['无需校准', 'chip-gray'];
      const d = (new Date(g.calDue).getTime() - Date.now()) / 864e5;
      if (d < 0) return ['校准已过期 ' + Math.ceil(-d) + ' 天', 'chip-red'];
      if (d <= 30) return [Math.ceil(d) + ' 天后到期', 'chip-amber'];
      return ['有效至 ' + fmtDate(g.calDue), 'chip-green'];
    };
    const recs = computed(() => GAUGE_CATS.map((c) => ({ c, g: gaugeOf(recommendGauge(c)) })).filter((x) => x.g));
    const showRec = ref(false);
    const ed = reactive({ open: false, id: '', name: '', alias: '', kind: '检具', precision: '', cats: [], items: '' });
    const openNew = () => { Object.assign(ed, { open: true, id: '', name: '', alias: '', kind: '检具', precision: '', cats: cat.value ? [cat.value] : [], items: '' }); };
    const openEdit = (g) => { Object.assign(ed, { open: true, id: g.id, name: g.name, alias: g.alias || '', kind: g.kind, precision: g.precision || '', cats: g.cats.slice(), items: g.items.join('、') }); };
    const toggleCat = (c) => { const i = ed.cats.indexOf(c); if (i >= 0) ed.cats.splice(i, 1); else ed.cats.push(c); };
    const save = () => {
      if (!ed.name.trim()) { toast('请填写名称', 'error'); return; }
      if (!ed.cats.length) { toast('至少选择一个适用公差类型', 'error'); return; }
      const items = ed.items.split(/[、,，;；\s]+/).map((x) => x.trim()).filter(Boolean);
      const g = ed.id ? gaugeOf(ed.id) : null;
      if (g) { Object.assign(g, { name: ed.name.trim(), alias: ed.alias.trim(), kind: ed.kind, precision: ed.precision.trim(), cats: ed.cats.slice(), items }); logAudit('检具方法', g.name, '修改'); }
      else { const id = 'G' + nextSeq(); S.gauges.push({ id, name: ed.name.trim(), alias: ed.alias.trim(), kind: ed.kind, precision: ed.precision.trim(), cats: ed.cats.slice(), items, src: 'QMS', calDue: null }); logAudit('检具方法', ed.name.trim(), '新建检验手段'); }
      ed.open = false; toast('已保存', 'success');
    };
    const remove = async (g) => {
      const n = usedBy(g);
      if (n) { toast('该检验手段被 ' + n + ' 个生效特性引用，不能删除（已被引用的对象禁止硬删除）', 'error'); return; }
      if (await confirmBox({ title: '删除「' + g.name + '」？', message: '未被任何生效标准引用，可以删除。', ok: '删除', danger: true })) { S.gauges.splice(S.gauges.indexOf(g), 1); logAudit('检具方法', g.name, '删除'); }
    };
    const openBubble = () => { UI.bubble.route = 'gauges'; go('/bubble'); };
    return { cat, kind, q, cats, catCount, rows, usedBy, cal, recs, showRec, ed, openNew, openEdit, toggleCat, save, remove, openBubble, GAUGE_CATS };
  },
  template: `
<div class="space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div><h1 class="page-title">检具与检验方法</h1><p class="text-xs text-ink-3 mt-1">维护检验标准里可选的检验手段，并按适用公差类型给出默认推荐。与气泡软件的“检具与检验方法”保持同一套数据；校准计划与记录在“量具与校准”模块（规划中）。</p></div>
    <div class="flex items-center gap-2"><button class="btn-ghost" @click="showRec = true"><ic name="settings" :size="15"/>默认推荐设置</button><button class="btn-secondary" @click="openBubble"><ic name="external" :size="15"/>在气泡软件中查看</button><g-btn perm="md.edit" cls="btn-primary" icon="plus" @click="openNew">新建检验手段</g-btn></div>
  </div>
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
    <aside class="lg:col-span-3 card p-3 self-start">
      <div class="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-ink-4">适用公差类型</div>
      <button class="w-full flex items-center justify-between h-9 px-2.5 rounded-xl text-[13px] transition-colors" :class="!cat ? 'bg-brand-50 text-brand-700 font-medium' : 'hover:bg-black/[0.04] text-ink-2'" @click="cat = ''"><span>全部</span><span class="tabular text-[11px]">{{ S.gauges.length }}</span></button>
      <button v-for="c in cats" :key="c" class="w-full flex items-center justify-between h-9 px-2.5 rounded-xl text-[13px] transition-colors" :class="cat === c ? 'bg-brand-50 text-brand-700 font-medium' : 'hover:bg-black/[0.04] text-ink-2'" @click="cat = c"><span>{{ c }}</span><span class="tabular text-[11px]">{{ catCount(c) }}</span></button>
      <div class="h-px bg-black/[0.06] my-2"></div>
      <div class="px-2.5 pt-1 pb-1 text-[11px] font-medium text-ink-4">类别</div>
      <button v-for="k in ['', '检具', '检验方法']" :key="k" class="w-full flex items-center justify-between h-9 px-2.5 rounded-xl text-[13px] transition-colors" :class="kind === k ? 'bg-brand-50 text-brand-700 font-medium' : 'hover:bg-black/[0.04] text-ink-2'" @click="kind = k"><span>{{ k || '全部' }}</span><span class="tabular text-[11px]">{{ S.gauges.filter(g => !k || g.kind === k).length }}</span></button>
    </aside>
    <div class="lg:col-span-9 space-y-3">
      <div class="relative"><ic name="search" :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"/><input v-model="q" class="input pl-9" placeholder="搜索名称、别名或检测项"></div>
      <div class="card divide-y divide-black/[0.05]">
        <div v-for="g in rows" :key="g.id" class="flex flex-wrap items-start gap-4 px-5 py-4 transition-colors hover:bg-black/[0.015]">
          <span class="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0"><ic :name="g.kind === '检具' ? 'gauge' : 'eye'" :size="18"/></span>
          <div class="w-[190px] shrink-0"><div class="flex flex-wrap items-center gap-1.5"><span class="font-semibold text-[14px]">{{ g.name }}</span><span class="chip-brand">{{ g.kind }}</span><span class="chip-gray">{{ g.src === 'QMS' ? 'QMS' : '气泡软件' }}</span></div><div v-if="g.alias" class="text-[11px] text-ink-4 mt-0.5">别名：{{ g.alias }}</div><div v-if="g.device" class="text-[11px] text-ink-4 mt-0.5">设备通道 {{ g.device }}</div></div>
          <div class="flex-1 min-w-[220px] space-y-1.5 text-[12px]">
            <div v-if="g.precision" class="flex gap-3"><span class="text-ink-4 w-14 shrink-0">量程与精度</span><span class="chip-gray">精度 {{ g.precision }}</span></div>
            <div v-if="g.items.length" class="flex gap-3"><span class="text-ink-4 w-14 shrink-0">检测项</span><span class="flex flex-wrap gap-1"><span v-for="i in g.items" :key="i" class="chip-brand">{{ i }}</span></span></div>
            <div class="flex gap-3"><span class="text-ink-4 w-14 shrink-0">公差类别</span><span class="flex flex-wrap gap-1"><span v-for="c in g.cats" :key="c" class="chip-gray">{{ c }}</span></span></div>
          </div>
          <div class="w-[150px] shrink-0 text-[12px]"><span :class="cal(g)[1]">{{ cal(g)[0] }}</span><div class="text-[11px] text-ink-4 mt-1.5">被 {{ usedBy(g) }} 个生效特性引用</div></div>
          <div class="flex items-center gap-1"><g-btn perm="md.edit" cls="btn-ghost btn-sm" icon="edit" @click="openEdit(g)">编辑</g-btn><g-btn perm="md.edit" cls="btn-ghost btn-sm" icon="trash" @click="remove(g)">删除</g-btn></div>
        </div>
        <empty v-if="!rows.length" icon="gauge" title="没有符合条件的检验手段"/>
      </div>
    </div>
  </div>

  <modal :open="showRec" @close="showRec = false" title="默认推荐设置" sub="气泡同步生成标准草稿时，按特性类别自动带出推荐的检验手段；编制人可以改" width="max-w-lg">
    <table class="tbl"><thead><tr><th>特性类别</th><th>默认推荐</th></tr></thead><tbody><tr v-for="x in recs" :key="x.c"><td>{{ x.c }}</td><td class="font-medium">{{ x.g.name }}{{ x.g.alias ? '（' + x.g.alias + '）' : '' }}</td></tr></tbody></table>
    <p class="text-[11.5px] text-ink-4 mt-3">原型按“第一个适用该类别的检验手段”推荐；正式系统中这张对照表可编辑，并以气泡软件或 QMS 其中一方为权威源（待确认）。</p>
    <template #footer><button class="btn-secondary" @click="showRec = false">关闭</button></template>
  </modal>

  <modal :open="ed.open" @close="ed.open = false" :title="ed.id ? '编辑检验手段' : '新建检验手段'" width="max-w-xl">
    <div class="grid grid-cols-2 gap-4">
      <div><label class="label">名称</label><input v-model="ed.name" class="input" placeholder="如 高度规"></div>
      <div><label class="label">别名</label><input v-model="ed.alias" class="input" placeholder="可空"></div>
      <div><label class="label">类别</label><select v-model="ed.kind" class="input"><option>检具</option><option>检验方法</option></select></div>
      <div><label class="label">精度</label><input v-model="ed.precision" class="input" placeholder="如 0.01"></div>
    </div>
    <label class="label mt-4">适用公差类型</label>
    <div class="flex flex-wrap gap-1.5"><button v-for="c in GAUGE_CATS" :key="c" type="button" @click="toggleCat(c)" class="h-8 px-3 rounded-full text-xs font-medium ring-1 ring-inset transition-all duration-200" :class="ed.cats.includes(c) ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-ink-3 ring-black/10 hover:ring-brand-400'">{{ c }}</button></div>
    <label class="label mt-4">检测项（用顿号或逗号分隔）</label>
    <input v-model="ed.items" class="input" placeholder="如 平面度、垂直度">
    <template #footer><button class="btn-secondary" @click="ed.open = false">取消</button><button class="btn-primary" @click="save">保存</button></template>
  </modal>
</div>`,
};

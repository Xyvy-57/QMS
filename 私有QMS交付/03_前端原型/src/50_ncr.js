/* =====================================================================
 * 页面 C：不合格处置（NCR）与质量限制（Hold）
 *   规则要点：NCR 只管“本次处置”；NCR 不自动冻结整批，质量限制须明确范围与受限动作；
 *   处置建议 ≠ 批准；处置数量合计须等于确认不合格数量（一批多去向）；返工类处置后复检走检验新轮次；
 *   NCR、质量限制各自关闭，互不替代。
 * ===================================================================== */

const NCR_REWORK = ['返工', '返修', '挑选'];
const HOLD_SCOPES = ['批次', '工单', '收货单', '发货单', '序列号范围'];
const SEVERITIES = ['轻微', '一般', '严重'];
const SEV_CHIP = { 轻微: 'chip-gray', 一般: 'chip-amber', 严重: 'chip-red' };

function ncrLog(n, text) { n.log.push({ at: nowISO(), by: S.me, text }); logAudit('NCR', n.code, text); }
function ncrLines(n) { return n.disp.filter((d) => !d.rejected); }
function ncrAllocated(n) { return sum(ncrLines(n).map((d) => d.qty)); }
function ncrRemaining(n) { return Math.max(0, (n.qtyConfirmed || 0) - ncrAllocated(n)); }
function ncrItems(n) {
  const all = [];
  S.standards.filter((s) => s.partId === n.partId).forEach((s) => s.items.forEach((i) => { if (!all.some((x) => x.cid === i.cid)) all.push(i); }));
  return (n.cids || []).map((cid) => all.find((i) => i.cid === cid)).filter(Boolean);
}
/** 该 NCR 关联的复检轮次（返工后复检，A09） */
function ncrRetests(n) {
  const t = n.taskId ? taskOf(n.taskId) : null;
  return t ? t.rounds.filter((r) => r.ncrId === n.id) : [];
}
function lineState(d) { return d.rejected ? ['已退回', 'chip-gray'] : d.executed ? ['已执行', 'chip-green'] : d.approved ? ['已批准，待执行', 'chip-blue'] : ['建议，待批准', 'chip-amber']; }

/* ---------------- 登记不合格（全局弹窗，由 UI.newNcr 打开） ---------------- */
COMPONENTS['new-ncr-modal'] = {
  setup() {
    const f = reactive({ title: '', partId: '', batch: '', severity: '一般', qtySuspect: '', cids: [], desc: '', photos: [], taskId: '', roundId: '' });
    const open = computed(() => !!UI.newNcr);
    watch(() => UI.newNcr, (v) => {
      if (!v) return;
      Object.assign(f, { title: v.title || '', partId: v.partId || S.parts[0].id, batch: v.batch || '', severity: v.severity || '一般', qtySuspect: v.qtySuspect == null ? '' : String(v.qtySuspect), cids: (v.cids || []).slice(), desc: v.desc || '', photos: (v.photos || []).map((p) => ({ id: p.id, url: p.url })), taskId: v.taskId || '', roundId: v.roundId || '' });
    });
    const task = computed(() => (f.taskId ? taskOf(f.taskId) : null));
    const items = computed(() => { const s = effectiveStd(f.partId) || S.standards.find((x) => x.partId === f.partId); return s ? s.items : []; });
    const toggle = (cid) => { const i = f.cids.indexOf(cid); if (i >= 0) f.cids.splice(i, 1); else f.cids.push(cid); };
    const onPart = () => { f.cids = []; };
    const addPhotos = (urls) => urls.forEach((u) => f.photos.push({ id: 'ph' + nextSeq(), url: u }));
    const removePhoto = (id) => { const i = f.photos.findIndex((p) => p.id === id); if (i >= 0) f.photos.splice(i, 1); };
    const close = () => { UI.newNcr = null; };
    const save = () => {
      try {
        if (f.qtySuspect !== '' && !/^\d+$/.test(String(f.qtySuspect).trim())) throw new Error('可疑数量须为整数');
        const n = createNcr({ title: f.title, partId: f.partId, batch: f.batch, severity: f.severity, qtySuspect: f.qtySuspect, cids: f.cids, desc: f.desc, photos: f.photos, taskId: f.taskId, roundId: f.roundId });
        close(); toast('已登记 ' + n.code + '。NCR 不会自动冻结整批，如需限制使用或发运请建立质量限制', 'success'); go('/ncr/' + n.id);
      } catch (e) { toast(e.message, 'error'); }
    };
    return { f, open, task, items, toggle, onPart, addPhotos, removePhoto, close, save, SEVERITIES };
  },
  template: `
<modal :open="open" @close="close" title="登记不合格" sub="只登记已确认的不符合事实；范围、处置与质量限制在后续步骤分别确认" width="max-w-2xl">
  <div class="space-y-4">
    <div v-if="task" class="rounded-xl bg-brand-50 text-brand-800 px-3.5 py-2.5 text-[12.5px] flex items-center gap-2"><ic name="link" :size="14"/>来源：{{ sceneOf(task.scene).name }} {{ task.code }}，不合格特性与描述已自动带入，可修改。</div>
    <div><label class="label">标题</label><input v-model="f.title" class="input" placeholder="例如：01系列阀芯 1-1 轴直径超上限"></div>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div><label class="label">零件</label><select v-model="f.partId" class="input" :disabled="!!task" @change="onPart"><option v-for="p in S.parts" :key="p.id" :value="p.id">{{ p.partNo }} {{ p.name }}</option></select></div>
      <div><label class="label">批次 / 工单（可空）</label><input v-model="f.batch" class="input" placeholder="如 20261116-A"></div>
      <div><label class="label">严重度</label><select v-model="f.severity" class="input"><option v-for="s in SEVERITIES" :key="s">{{ s }}</option></select></div>
    </div>
    <div><label class="label">不合格特性（按气泡特性选择，可多选）</label>
      <div class="flex flex-wrap gap-1.5"><button v-for="it in items" :key="it.cid" type="button" @click="toggle(it.cid)" class="h-8 px-2.5 rounded-full text-xs font-medium ring-1 ring-inset transition-all duration-200" :class="f.cids.includes(it.cid) ? 'bg-rose-600 text-white ring-rose-600' : 'bg-white text-ink-3 ring-black/10 hover:ring-rose-400'">#{{ it.no }} {{ it.name }}</button><span v-if="!items.length" class="text-xs text-ink-4">该零件还没有检验标准，可只填写描述</span></div></div>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div><label class="label">可疑数量（件，可空）</label><input v-model.trim="f.qtySuspect" class="input" inputmode="numeric" placeholder="范围确认时可再调整"></div>
      <div class="sm:col-span-2"><label class="label">描述</label><textarea v-model="f.desc" rows="4" class="textarea" placeholder="发生了什么、在哪里发现、实测值与要求"></textarea></div>
    </div>
    <div><label class="label">现场照片</label><photo-strip :photos="f.photos" @add="addPhotos" @remove="removePhoto"/></div>
  </div>
  <template #footer><button class="btn-secondary" @click="close">取消</button><g-btn perm="ncr.create" cls="btn-primary" icon="check" @click="save">登记</g-btn></template>
</modal>`,
};

/* ---------------- NCR 列表 + 质量限制台账 ---------------- */
COMPONENTS['page-ncrs'] = {
  setup() {
    const tab = ref(UI.route.query.tab === 'holds' ? 'holds' : 'ncr');
    const status = ref('open'), q = ref('');
    const opts = computed(() => [{ value: 'open', label: '未关闭', count: S.ncrs.filter((n) => n.status !== 'closed').length }, { value: 'all', label: '全部', count: S.ncrs.length }].concat(NCR_FLOW.map((x) => ({ value: x[0], label: STATUS.ncr[x[0]][0], count: S.ncrs.filter((n) => n.status === x[0]).length }))));
    const rows = computed(() => {
      const k = q.value.trim().toLowerCase();
      return S.ncrs.filter((n) => (status.value === 'all' || (status.value === 'open' ? n.status !== 'closed' : n.status === status.value)) && (!k || (n.code + ' ' + n.title + ' ' + partOf(n.partId).name + ' ' + n.batch).toLowerCase().includes(k)));
    });
    const holds = computed(() => { const out = []; S.ncrs.forEach((n) => n.holds.forEach((h) => out.push(Object.assign({ ncr: n }, h)))); return out.sort((a, b) => (a.status === b.status ? (a.at < b.at ? 1 : -1) : a.status === 'active' ? -1 : 1)); });
    const activeHolds = (n) => n.holds.filter((h) => h.status === 'active').length;
    /* 受限检查：按“请求的动作 × 对象范围”的交集判断 */
    const chk = reactive({ scope: '', action: 'ship' });
    const chkResult = computed(() => {
      const v = chk.scope.trim().toLowerCase(); if (!v) return null;
      const same = holds.value.filter((h) => h.status === 'active' && String(h.scopeVal).toLowerCase() === v);
      const hit = same.filter((h) => h.actions.includes(chk.action));
      const other = same.filter((h) => !h.actions.includes(chk.action));
      return { hit, other };
    });
    /* 从流程条的“发货前核对”进来时，直接把光标放进受限检查的输入框 */
    onMounted(() => { if (UI.route.query.check) { const el = document.getElementById('hold-check-input'); if (el) el.focus(); } });
    return { tab, status, q, opts, rows, holds, activeHolds, chk, chkResult, SEV_CHIP };
  },
  template: `
<div class="space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div><h1 class="page-title">不合格处置</h1><p class="text-xs text-ink-3 mt-1">记录不合格的范围、处置和验证。要限制使用或发运时，另外建立质量限制。</p></div>
    <div class="flex items-center gap-2"><seg v-model="tab" :options="[{ value: 'ncr', label: 'NCR', count: S.ncrs.length }, { value: 'holds', label: '质量限制台账', count: holds.filter(h => h.status === 'active').length }]"/><g-btn perm="ncr.create" cls="btn-primary" icon="plus" @click="UI.newNcr = {}">登记不合格</g-btn></div>
  </div>

  <template v-if="tab === 'ncr'">
    <div class="flex flex-wrap items-center gap-2"><seg v-model="status" :options="opts"/>
      <div class="relative"><ic name="search" :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"/><input v-model="q" class="input !h-[38px] pl-9 w-56" placeholder="搜索编号 / 标题 / 零件 / 批次"></div></div>
    <div class="card overflow-hidden">
      <div class="overflow-x-auto"><table class="tbl">
        <thead><tr><th>NCR</th><th>零件 / 批次</th><th>来源</th><th>严重度</th><th>可疑 / 确认不合格</th><th>处置进度</th><th>有效限制</th><th>状态</th><th>登记</th><th></th></tr></thead>
        <tbody>
          <tr v-for="n in rows" :key="n.id" class="row-link" @click="go('/ncr/' + n.id)">
            <td class="max-w-[280px]"><div class="font-medium font-mono text-[12.5px]">{{ n.code }}</div><div class="text-[12px] text-ink-2 truncate">{{ n.title }}</div></td>
            <td><div>{{ partOf(n.partId).name }}</div><div class="text-[11px] text-ink-4">{{ n.batch || '—' }}</div></td>
            <td class="text-[12px]"><span v-if="n.taskId && taskOf(n.taskId)" class="font-mono">{{ taskOf(n.taskId).code }}</span><span v-else class="text-ink-4">现场发现</span></td>
            <td><span :class="SEV_CHIP[n.severity] || 'chip-gray'">{{ n.severity }}</span></td>
            <td class="tabular">{{ n.qtySuspect || '—' }} / <b>{{ n.qtyConfirmed || '—' }}</b></td>
            <td class="text-[12px] tabular">{{ n.disp.filter(d => d.executed).length }} / {{ n.disp.filter(d => !d.rejected).length }} 行已执行</td>
            <td><span v-if="activeHolds(n)" class="chip-red"><ic name="lock" :size="11"/>{{ activeHolds(n) }}</span><span v-else class="text-ink-5">—</span></td>
            <td><st k="ncr" :v="n.status"/></td>
            <td class="text-xs text-ink-3 whitespace-nowrap">{{ userName(n.createdBy) }} · {{ fmtRel(n.createdAt) }}</td>
            <td><ic name="chevron-right" :size="14" class="text-ink-5"/></td>
          </tr>
        </tbody>
      </table></div>
      <empty v-if="!rows.length" icon="alert" title="没有符合条件的 NCR"/>
    </div>
  </template>

  <template v-else>
    <div class="card p-5">
      <h2 class="section-title">受限检查</h2>
      <p class="text-xs text-ink-3 mt-1">是否受限按“请求的动作 × 对象范围”的交集判断；同一范围上存在其它受限动作时，作为相关风险单独提示，不等同于本动作受限。</p>
      <div class="flex flex-wrap items-end gap-3 mt-3">
        <div><label class="label">对象范围（批次 / 工单 / 单号）</label><input id="hold-check-input" v-model="chk.scope" class="input w-64" placeholder="如 WO-2611-011"></div>
        <div><label class="label">请求的动作</label><select v-model="chk.action" class="input w-40"><option v-for="(l,k) in HOLD_ACTIONS" :key="k" :value="k">{{ l }}</option></select></div>
        <div v-if="chkResult" class="flex-1 min-w-[240px] rounded-xl px-3.5 py-2.5 text-[12.5px]" :class="chkResult.hit.length ? 'bg-rose-50 text-rose-900' : 'bg-emerald-50 text-emerald-900'">
          <div class="font-semibold flex items-center gap-1.5"><ic :name="chkResult.hit.length ? 'lock' : 'check'" :size="14"/>{{ chkResult.hit.length ? '受限：该范围禁止' + HOLD_ACTIONS[chk.action] : '不受限：该范围可以' + HOLD_ACTIONS[chk.action] }}</div>
          <div v-if="chkResult.hit.length" class="mt-0.5">依据：<span v-for="h in chkResult.hit" :key="h.id" class="mr-2 font-mono">{{ h.ncr.code }}</span></div>
          <div v-if="chkResult.other.length" class="mt-0.5 opacity-90">相关风险：同一范围上另有受限动作（{{ chkResult.other.map(h => h.actions.map(a => HOLD_ACTIONS[a]).join('、')).join('；') }}）。</div>
        </div>
      </div>
    </div>
    <div class="card overflow-hidden">
      <div class="overflow-x-auto"><table class="tbl">
        <thead><tr><th>范围</th><th>受限动作</th><th>状态</th><th>来源 NCR</th><th>建立</th><th>解除</th></tr></thead>
        <tbody>
          <tr v-for="h in holds" :key="h.id" class="row-link" @click="go('/ncr/' + h.ncr.id)">
            <td><span class="chip-gray mr-1.5">{{ h.scopeType }}</span><span class="font-mono font-medium">{{ h.scopeVal }}</span></td>
            <td><span v-for="a in h.actions" :key="a" class="chip-red mr-1">禁止{{ HOLD_ACTIONS[a] }}</span></td>
            <td><st k="hold" :v="h.status"/></td>
            <td><div class="font-mono text-[12.5px]">{{ h.ncr.code }}</div><div class="text-[11px] text-ink-4 truncate max-w-[240px]">{{ h.ncr.title }}</div></td>
            <td class="text-xs text-ink-3 whitespace-nowrap">{{ userName(h.by) }} · {{ fmtTime(h.at) }}</td>
            <td class="text-xs text-ink-3"><template v-if="h.status === 'released'">{{ userName(h.releasedBy) }} · {{ fmtTime(h.releasedAt) }}<div class="text-[11px] text-ink-4 max-w-[240px] truncate">{{ h.releaseNote }}</div></template><span v-else class="text-ink-5">—</span></td>
          </tr>
        </tbody>
      </table></div>
      <empty v-if="!holds.length" icon="lock" title="没有质量限制" desc="在 NCR 详情中按需建立：必须写明范围和受限动作"/>
    </div>
  </template>
</div>`,
};

/* ---------------- NCR 详情 ---------------- */
COMPONENTS['page-ncr'] = {
  setup() {
    const n = computed(() => S.ncrs.find((x) => x.id === UI.route.params.id) || null);
    const task = computed(() => (n.value && n.value.taskId ? taskOf(n.value.taskId) : null));
    const items = computed(() => (n.value ? ncrItems(n.value) : []));
    const stepIdx = computed(() => (n.value ? (n.value.status === 'closed' ? NCR_FLOW.length : NCR_FLOW.findIndex((x) => x[0] === n.value.status)) : 0));
    const lines = computed(() => (n.value ? n.value.disp : []));
    const allocated = computed(() => (n.value ? ncrAllocated(n.value) : 0));
    const remaining = computed(() => (n.value ? ncrRemaining(n.value) : 0));
    const retests = computed(() => (n.value ? ncrRetests(n.value) : []));
    const hasRework = computed(() => !!n.value && ncrLines(n.value).some((d) => NCR_REWORK.includes(d.action)));
    const retestPassed = computed(() => retests.value.some((r) => r.status === 'submitted' && r.result && r.result.overall === 'pass'));
    const activeHolds = computed(() => (n.value ? n.value.holds.filter((h) => h.status === 'active') : []));
    const noConcession = computed(() => items.value.filter((i) => i.noConcession));
    const open = computed(() => !!n.value && n.value.status !== 'closed');

    /* —— 范围确认 —— */
    const sc = reactive({ open: false, suspect: '', confirmed: '', hold: false, scopeType: '批次', scopeVal: '', actions: ['use', 'ship'] });
    const openScope = () => { const x = n.value; Object.assign(sc, { open: true, suspect: String(x.qtySuspect || ''), confirmed: String(x.qtyConfirmed || ''), hold: x.status === 'registered' && !x.holds.length, scopeType: '批次', scopeVal: x.batch || '', actions: ['use', 'ship'] }); };
    const saveScope = () => {
      const x = n.value, s = parseInt(sc.suspect, 10), c = parseInt(sc.confirmed, 10);
      if (!/^\d+$/.test(sc.suspect.trim()) || !/^\d+$/.test(sc.confirmed.trim())) { toast('数量须为整数', 'error'); return; }
      if (c < 1) { toast('确认不合格数量至少为 1', 'error'); return; }
      if (c > s) { toast('确认不合格数量不能大于可疑数量', 'error'); return; }
      if (c < ncrAllocated(x)) { toast('确认不合格数量不能小于已分配的处置数量 ' + ncrAllocated(x), 'error'); return; }
      if (sc.hold && (!sc.scopeVal.trim() || !sc.actions.length)) { toast('建立质量限制需要写明范围和至少一个受限动作', 'error'); return; }
      x.qtySuspect = s; x.qtyConfirmed = c;
      if (x.status === 'registered') x.status = 'scoped';
      ncrLog(x, '确认范围：可疑 ' + s + ' 件，确认不合格 ' + c + ' 件');
      if (sc.hold) addHold(x, sc.scopeType, sc.scopeVal.trim(), sc.actions.slice());
      sc.open = false; toast('范围已确认，可以提出处置建议', 'success');
    };

    /* —— 质量限制 —— */
    const addHold = (x, scopeType, scopeVal, actions) => {
      x.holds.push({ id: 'h' + nextSeq(), scopeType, scopeVal, actions, status: 'active', by: S.me, at: nowISO() });
      ncrLog(x, '建立质量限制（' + scopeType + ' ' + scopeVal + '）：禁止' + actions.map((a) => HOLD_ACTIONS[a]).join('、'));
    };
    const hd = reactive({ open: false, scopeType: '批次', scopeVal: '', actions: ['ship'] });
    const openHold = () => { Object.assign(hd, { open: true, scopeType: '批次', scopeVal: n.value.batch || '', actions: ['ship'] }); };
    const saveHold = () => {
      if (!hd.scopeVal.trim() || !hd.actions.length) { toast('请写明范围，并至少选择一个受限动作', 'error'); return; }
      addHold(n.value, hd.scopeType, hd.scopeVal.trim(), hd.actions.slice()); hd.open = false; toast('质量限制已建立，只限制所选范围与动作', 'success');
    };
    const rl = reactive({ open: false, id: '', note: '' });
    const openRelease = (h) => { Object.assign(rl, { open: true, id: h.id, note: '' }); };
    const saveRelease = () => {
      const h = n.value.holds.find((x) => x.id === rl.id);
      if (!h || !rl.note.trim()) { toast('请填写解除依据', 'error'); return; }
      Object.assign(h, { status: 'released', releasedBy: S.me, releasedAt: nowISO(), releaseNote: rl.note.trim() });
      ncrLog(n.value, '解除质量限制（' + h.scopeType + ' ' + h.scopeVal + '）：' + rl.note.trim() + '。只解除这一项，其它限制不受影响');
      rl.open = false; toast('已解除该项质量限制', 'success');
    };
    const toggleIn = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); };

    /* —— 处置行（MRB） —— */
    const dp = reactive({ open: false, action: '返工', qty: '', reason: '' });
    const actionChoices = computed(() => (me.value.role === 'pm' ? NCR_REWORK : DISPOSITIONS));
    const openDisp = () => { Object.assign(dp, { open: true, action: actionChoices.value[0], qty: String(remaining.value || ''), reason: '' }); };
    const saveDisp = () => {
      const x = n.value, q = parseInt(dp.qty, 10);
      if (!/^\d+$/.test(String(dp.qty).trim()) || q < 1) { toast('数量须为正整数', 'error'); return; }
      if (q > remaining.value) { toast('数量超出待分配数量 ' + remaining.value, 'error'); return; }
      if (!dp.reason.trim()) { toast('请填写处置理由或依据', 'error'); return; }
      if (dp.action === '让步接收' && noConcession.value.length) { toast('涉及不可让步特性（' + noConcession.value.map((i) => '#' + i.no).join('、') + '），不能提出让步接收', 'error'); return; }
      x.disp.push({ id: 'd' + nextSeq(), qty: q, action: dp.action, reason: dp.reason.trim(), by: S.me, approved: false, executed: false });
      ncrLog(x, '提出处置建议：' + dp.action + ' ' + q + ' 件（' + dp.reason.trim() + '）');
      dp.open = false;
    };
    const removeLine = (d) => { const x = n.value; x.disp.splice(x.disp.indexOf(d), 1); ncrLog(x, '撤回处置建议：' + d.action + ' ' + d.qty + ' 件'); };
    const submitMrb = () => { const x = n.value; x.status = 'disposing'; ncrLog(x, '提交 MRB 评审：' + ncrLines(x).map((d) => d.action + ' ' + d.qty).join('，')); toast('已提交 MRB 评审，等待质量负责人逐行批准', 'success'); };
    const approveLine = (d) => {
      const x = n.value;
      if (d.action === '让步接收' && noConcession.value.length) { toast('涉及不可让步特性，不能批准让步接收', 'error'); return; }
      Object.assign(d, { approved: true, approvedBy: S.me, approvedAt: nowISO() });
      ncrLog(x, '批准处置：' + d.action + ' ' + d.qty + ' 件');
      if (ncrLines(x).every((l) => l.approved)) toast('全部处置行已批准，等待登记执行结果', 'success');
    };
    const rj = reactive({ open: false, id: '', note: '' });
    const openReject = (d) => { Object.assign(rj, { open: true, id: d.id, note: '' }); };
    const saveReject = () => {
      const x = n.value, d = x.disp.find((l) => l.id === rj.id);
      if (!d || !rj.note.trim()) { toast('请填写退回原因', 'error'); return; }
      Object.assign(d, { rejected: true, rejectNote: rj.note.trim() });
      x.status = 'scoped';
      ncrLog(x, '退回处置建议（' + d.action + ' ' + d.qty + ' 件）：' + rj.note.trim() + '。请重新提出处置建议');
      rj.open = false;
    };
    const ex = reactive({ open: false, id: '', evidence: '' });
    const openExec = (d) => { Object.assign(ex, { open: true, id: d.id, evidence: '' }); };
    const saveExec = () => {
      const x = n.value, d = x.disp.find((l) => l.id === ex.id);
      if (!d || !ex.evidence.trim()) { toast('请填写执行结果与凭据', 'error'); return; }
      Object.assign(d, { executed: true, executedBy: S.me, executedAt: nowISO(), evidence: ex.evidence.trim() });
      ncrLog(x, '登记执行：' + d.action + ' ' + d.qty + ' 件（' + ex.evidence.trim() + '）');
      ex.open = false;
      const ls = ncrLines(x);
      if (ls.length && ls.every((l) => l.executed) && ncrRemaining(x) === 0) { x.status = 'verifying'; ncrLog(x, '全部处置已执行，进入待验证'); toast('全部处置已执行，等待验证关闭', 'success'); }
    };
    const goRetest = () => go('/inspect/' + n.value.taskId + '?retest=1&ncr=' + n.value.id);

    /* —— 验证关闭 / 重开 —— */
    const vf = reactive({ open: false, note: '' });
    const needRetest = computed(() => hasRework.value && !!task.value);
    const closeBlock = computed(() => (needRetest.value && !retestPassed.value ? '存在返工类处置：需要有一轮关联本 NCR 且结论为“符合”的复检，才能验证关闭' : ''));
    const openVerify = () => { Object.assign(vf, { open: true, note: '' }); };
    const saveVerify = () => {
      const x = n.value;
      if (closeBlock.value) { toast(closeBlock.value, 'error'); return; }
      if (!vf.note.trim()) { toast('请填写验证结论', 'error'); return; }
      x.status = 'closed'; x.closedAt = nowISO(); x.closedBy = S.me;
      ncrLog(x, '验证通过并关闭：' + vf.note.trim() + (activeHolds.value.length ? '（仍有 ' + activeHolds.value.length + ' 条质量限制有效，需单独解除）' : ''));
      vf.open = false; toast('NCR 已关闭' + (activeHolds.value.length ? '；质量限制不会自动解除' : ''), 'success');
    };
    const reopen = async () => {
      if (!(await confirmBox({ title: '重开 NCR？', message: '重开后回到“范围确认”，可以调整范围并追加处置行；已有记录全部保留。', ok: '重开' }))) return;
      n.value.status = 'scoped'; ncrLog(n.value, '重开 NCR');
    };
    const addPhotos = (urls) => { urls.forEach((u) => n.value.photos.push({ id: 'ph' + nextSeq(), url: u })); };
    const removePhoto = (id) => { const i = n.value.photos.findIndex((p) => p.id === id); if (i >= 0) n.value.photos.splice(i, 1); };
    const retestText = (r) => (r.status === 'active' ? '进行中' : { pass: '符合', fail: '不符合', incomplete: '证据不足' }[r.result.overall]);
    return { n, task, items, stepIdx, lines, allocated, remaining, retests, hasRework, retestPassed, activeHolds, noConcession, open, sc, openScope, saveScope, hd, openHold, saveHold, rl, openRelease, saveRelease, toggleIn, dp, actionChoices, openDisp, saveDisp, removeLine, submitMrb, approveLine, rj, openReject, saveReject, ex, openExec, saveExec, goRetest, vf, needRetest, closeBlock, openVerify, saveVerify, reopen, addPhotos, removePhoto, retestText, lineState, SEV_CHIP, HOLD_SCOPES, NCR_REWORK };
  },
  template: `
<div v-if="n" class="space-y-5">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <button class="text-xs text-ink-3 hover:text-ink inline-flex items-center gap-1 mb-2" @click="go('/ncr')"><ic name="chevron-left" :size="13"/>不合格处置</button>
      <div class="flex flex-wrap items-center gap-2"><h1 class="page-title font-mono">{{ n.code }}</h1><st k="ncr" :v="n.status"/><span :class="SEV_CHIP[n.severity] || 'chip-gray'">{{ n.severity }}</span><span v-if="activeHolds.length" class="chip-red"><ic name="lock" :size="11"/>{{ activeHolds.length }} 条质量限制有效</span></div>
      <p class="text-[13px] text-ink-2 mt-1">{{ n.title }}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <g-btn v-if="n.status === 'registered'" perm="ncr.scope" cls="btn-primary" icon="target" @click="openScope">确认范围</g-btn>
      <g-btn v-if="n.status === 'scoped'" perm="ncr.scope" cls="btn-ghost" @click="openScope">调整范围</g-btn>
      <g-btn v-if="n.status === 'scoped'" perm="ncr.suggest" cls="btn-primary" icon="arrow-right" :when="remaining === 0 && allocated > 0" :why="'处置数量合计须等于确认不合格数量（还差 ' + remaining + ' 件未分配）'" @click="submitMrb">提交 MRB 评审</g-btn>
      <g-btn v-if="n.status === 'verifying'" perm="ncr.approve" cls="btn-success" icon="shield" :when="!closeBlock" :why="closeBlock" @click="openVerify">验证并关闭</g-btn>
      <g-btn v-if="n.status === 'closed'" perm="ncr.approve" cls="btn-secondary" icon="rotate-ccw" @click="reopen">重开</g-btn>
    </div>
  </div>
  <div class="card px-5 py-4"><stepper :steps="NCR_FLOW.map(x => x[1])" :current="stepIdx"/></div>
  <next-step v-bind="nextOf('ncr', n)"/>

  <div class="grid grid-cols-1 xl:grid-cols-3 gap-5">
    <div class="xl:col-span-2 space-y-5">
      <div class="card p-5 space-y-4">
        <h2 class="section-title">不符合事实</h2>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
          <kv k="零件" :v="partOf(n.partId).partNo + ' ' + partOf(n.partId).name"/>
          <kv k="批次 / 工单" :v="n.batch" mono/>
          <kv k="来源"><button v-if="task" class="link font-mono" @click="go('/inspect/' + task.id)">{{ task.code }}</button><span v-else>现场发现</span></kv>
          <kv k="登记" :v="userName(n.createdBy) + ' · ' + fmtTime(n.createdAt)"/>
        </div>
        <div v-if="items.length"><div class="label">不合格特性</div><div class="flex flex-wrap gap-1.5"><span v-for="it in items" :key="it.cid" class="chip-red">#{{ it.no }} {{ it.name }}<span class="font-mono opacity-80 ml-1">{{ specText(it) }}</span><span v-if="it.noConcession" class="ml-1 font-semibold">· 不可让步</span></span></div></div>
        <div><div class="label">描述</div><p class="text-[13px] text-ink-2 whitespace-pre-line leading-relaxed">{{ n.desc || '—' }}</p></div>
        <div><div class="label">现场照片</div><photo-strip :photos="n.photos" :readonly="!open || !can('ncr.create')" size="w-[72px] h-[72px]" @add="addPhotos" @remove="removePhoto"/><span v-if="!n.photos.length && (!open || !can('ncr.create'))" class="text-xs text-ink-4">没有照片</span></div>
      </div>

      <div class="card overflow-hidden">
        <div class="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
          <div><h2 class="section-title">范围与处置（MRB）</h2><p class="text-xs text-ink-3 mt-0.5">一批可以有多个去向：各处置行数量合计须等于确认不合格数量。处置建议不等于批准。</p></div>
          <g-btn v-if="n.status === 'scoped'" perm="ncr.suggest" cls="btn-soft btn-sm" icon="plus" :when="remaining > 0" why="确认不合格数量已全部分配" @click="openDisp">添加处置行</g-btn>
        </div>
        <div class="grid grid-cols-3 gap-3 px-5 pb-4">
          <div class="rounded-xl bg-[#f7f7f9] px-4 py-3"><div class="text-[11px] text-ink-4">可疑数量</div><div class="text-xl font-semibold tabular mt-0.5">{{ n.qtySuspect || '—' }}</div></div>
          <div class="rounded-xl bg-rose-50 px-4 py-3"><div class="text-[11px] text-rose-700/80">确认不合格</div><div class="text-xl font-semibold tabular mt-0.5 text-rose-700">{{ n.qtyConfirmed || '—' }}</div></div>
          <div class="rounded-xl px-4 py-3" :class="n.qtyConfirmed && remaining === 0 ? 'bg-emerald-50' : 'bg-amber-50'"><div class="text-[11px] text-ink-4">已分配处置 / 待分配</div><div class="text-xl font-semibold tabular mt-0.5">{{ allocated }} <span class="text-[13px] font-normal text-ink-3">/ {{ remaining }}</span></div></div>
        </div>
        <div class="overflow-x-auto border-t border-black/[0.05]"><table class="tbl">
          <thead><tr><th>处置方式</th><th>数量</th><th>理由 / 依据</th><th>建议人</th><th>状态</th><th>执行结果</th><th class="text-right">操作</th></tr></thead>
          <tbody>
            <tr v-for="d in lines" :key="d.id" :class="d.rejected ? 'opacity-55' : ''">
              <td><span class="font-medium">{{ d.action }}</span><span v-if="NCR_REWORK.includes(d.action)" class="chip-gray ml-1.5">需复检</span></td>
              <td class="tabular font-semibold">{{ d.qty }}</td>
              <td class="text-[12px] text-ink-2 whitespace-normal min-w-[180px] max-w-[260px]">{{ d.reason }}<div v-if="d.rejected" class="text-rose-600 mt-0.5">退回原因：{{ d.rejectNote }}</div></td>
              <td class="text-[12px] whitespace-nowrap"><span class="inline-flex items-center gap-1.5"><avatar :uid="d.by" :size="18"/>{{ userName(d.by) }}</span></td>
              <td class="whitespace-nowrap"><span :class="lineState(d)[1]">{{ lineState(d)[0] }}</span><div v-if="d.approved" class="text-[11px] text-ink-4 mt-0.5">批准：{{ userName(d.approvedBy) }}</div></td>
              <td class="text-[12px] text-ink-2 whitespace-normal min-w-[140px] max-w-[240px]">{{ d.evidence || '—' }}<div v-if="d.executed" class="text-[11px] text-ink-4">{{ userName(d.executedBy) }}</div></td>
              <td class="text-right whitespace-nowrap">
                <template v-if="!d.rejected && open">
                  <g-btn v-if="n.status === 'scoped' && !d.approved" perm="ncr.suggest" cls="btn-ghost btn-xs" @click="removeLine(d)">撤回</g-btn>
                  <template v-if="n.status === 'disposing' && !d.approved"><g-btn perm="ncr.approve" cls="btn-ghost btn-xs" @click="openReject(d)">退回</g-btn><g-btn perm="ncr.approve" cls="btn-success btn-xs" icon="check" @click="approveLine(d)">批准</g-btn></template>
                  <g-btn v-if="n.status === 'disposing' && d.approved && !d.executed" perm="ncr.execute" cls="btn-soft btn-xs" @click="openExec(d)">登记执行</g-btn>
                </template>
              </td>
            </tr>
          </tbody>
        </table></div>
        <empty v-if="!lines.length" icon="wrench" :title="n.status === 'registered' ? '请先确认范围' : '还没有处置行'" :desc="n.status === 'registered' ? '确认可疑数量与不合格数量后，再提出处置建议' : '质量工程师或生产主管可以提出处置建议，质量负责人逐行批准'"/>
      </div>

      <div v-if="hasRework || retests.length" class="card p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div><h2 class="section-title">处置后复检</h2><p class="text-xs text-ink-3 mt-0.5">返工、返修、挑选后的复检进入原检验任务的新轮次；原不符合记录永久保留。</p></div>
          <g-btn v-if="task && open" perm="task.retest" cls="btn-secondary btn-sm" icon="rotate-ccw" :when="task.rounds[task.rounds.length - 1].status === 'submitted'" why="该任务已有进行中的轮次" @click="goRetest">发起复检</g-btn>
        </div>
        <div v-if="!task" class="mt-3 rounded-xl bg-[#f7f7f9] px-3.5 py-2.5 text-[12px] text-ink-3">本 NCR 为现场发现，没有关联的检验任务；验证时请在验证结论中写明复检或确认方式。</div>
        <div v-for="r in retests" :key="r.id" class="mt-3 flex flex-wrap items-center gap-3 rounded-xl ring-1 ring-black/[0.06] px-3.5 py-2.5 text-[12.5px]">
          <span class="font-medium">{{ task.code }} · 第 {{ r.no }} 轮（复检）</span><span :class="r.status === 'active' ? 'chip-blue' : r.result.overall === 'pass' ? 'chip-green' : r.result.overall === 'fail' ? 'chip-red' : 'chip-amber'">{{ retestText(r) }}</span><span class="text-ink-4 text-[12px]">{{ r.reason }}</span>
          <button class="link ml-auto text-xs" @click="go('/inspect/' + task.id)">打开检验任务</button>
        </div>
        <div v-if="task && !retests.length" class="mt-3 text-[12px] text-ink-4">尚未发起关联本 NCR 的复检。</div>
      </div>
    </div>

    <div class="space-y-5">
      <div class="card p-5">
        <div class="flex items-center justify-between gap-3"><h2 class="section-title">质量限制</h2><g-btn v-if="open" perm="hold.create" cls="btn-soft btn-sm" icon="lock" @click="openHold">建立</g-btn></div>
        <p class="text-xs text-ink-3 mt-1">限制必须写明范围和受限动作；解除一项只影响这一项。NCR 关闭不会自动解除限制。</p>
        <div class="mt-3 space-y-2.5">
          <div v-for="h in n.holds" :key="h.id" class="rounded-xl ring-1 ring-inset px-3.5 py-3" :class="h.status === 'active' ? 'bg-rose-50/60 ring-rose-600/15' : 'bg-[#f7f7f9] ring-black/[0.05]'">
            <div class="flex items-center justify-between gap-2"><span class="text-[12.5px]"><span class="chip-gray mr-1.5">{{ h.scopeType }}</span><span class="font-mono font-medium">{{ h.scopeVal }}</span></span><st k="hold" :v="h.status"/></div>
            <div class="flex flex-wrap gap-1 mt-2"><span v-for="a in h.actions" :key="a" :class="h.status === 'active' ? 'chip-red' : 'chip-gray'">禁止{{ HOLD_ACTIONS[a] }}</span></div>
            <div class="text-[11px] text-ink-4 mt-2">{{ userName(h.by) }} 建立于 {{ fmtTime(h.at) }}</div>
            <div v-if="h.status === 'released'" class="text-[11px] text-ink-3 mt-1">{{ userName(h.releasedBy) }} 解除于 {{ fmtTime(h.releasedAt) }}：{{ h.releaseNote }}</div>
            <div v-if="h.status === 'active'" class="mt-2.5"><g-btn perm="hold.release" cls="btn-secondary btn-xs" @click="openRelease(h)">解除这一项</g-btn></div>
          </div>
          <div v-if="!n.holds.length" class="text-xs text-ink-4 py-2">没有质量限制。同批其它实物不会因为这张 NCR 被自动冻结。</div>
        </div>
      </div>

      <div class="card p-5">
        <h2 class="section-title mb-3">处理记录</h2>
        <ol class="relative border-l border-black/[0.08] ml-2 space-y-3.5">
          <li v-for="(l,i) in n.log.slice().reverse()" :key="i" class="pl-4 relative">
            <span class="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-white ring-2" :class="i === 0 ? 'ring-brand-500' : 'ring-black/20'"></span>
            <div class="text-[12.5px] leading-relaxed"><span class="font-medium">{{ userName(l.by) }}</span> <span class="text-ink-2">{{ l.text }}</span></div>
            <div class="text-[11px] text-ink-4 mt-0.5">{{ fmtTime(l.at) }}</div>
          </li>
        </ol>
      </div>

      <div class="card p-5">
        <h2 class="section-title">后续改进</h2>
        <p class="text-xs text-ink-3 mt-1 leading-relaxed">CAPA / 8D 不是每张 NCR 的必附单据：按严重度、重复发生、客户要求或过程失控触发。该模块在二期建设，入口已预留。</p>
        <button class="btn-secondary btn-sm mt-3" @click="go('/ext/capa')"><ic name="wrench" :size="14"/>发起 CAPA / 8D（规划中）</button>
      </div>
    </div>
  </div>

  <modal :open="sc.open" @close="sc.open = false" :title="n.status === 'registered' ? '确认不合格范围' : '调整范围'" sub="先分清“可疑范围”和“已确认不合格”，再决定处置；确认不合格数量是处置行数量合计的依据" width="max-w-xl">
    <div class="grid grid-cols-2 gap-4">
      <div><label class="label">可疑数量（件）</label><input v-model.trim="sc.suspect" class="input" inputmode="numeric"></div>
      <div><label class="label">确认不合格数量（件）</label><input v-model.trim="sc.confirmed" class="input" inputmode="numeric"></div>
    </div>
    <label class="flex items-center gap-2 mt-5 text-[13px] font-medium cursor-pointer"><input type="checkbox" v-model="sc.hold" class="w-4 h-4 accent-brand-600">同时建立质量限制（NCR 本身不冻结任何实物）</label>
    <div v-if="sc.hold" class="mt-3 rounded-2xl bg-[#f7f7f9] p-4 space-y-3">
      <div class="grid grid-cols-3 gap-3"><div><label class="label">范围类型</label><select v-model="sc.scopeType" class="input"><option v-for="s in HOLD_SCOPES" :key="s">{{ s }}</option></select></div><div class="col-span-2"><label class="label">范围</label><input v-model="sc.scopeVal" class="input" placeholder="如 WO-2611-011"></div></div>
      <div><label class="label">受限动作</label><div class="flex flex-wrap gap-1.5"><button v-for="(l,k) in HOLD_ACTIONS" :key="k" type="button" @click="toggleIn(sc.actions, k)" class="h-8 px-3 rounded-full text-xs font-medium ring-1 ring-inset transition-all duration-200" :class="sc.actions.includes(k) ? 'bg-rose-600 text-white ring-rose-600' : 'bg-white text-ink-3 ring-black/10'">禁止{{ l }}</button></div></div>
    </div>
    <template #footer><button class="btn-secondary" @click="sc.open = false">取消</button><button class="btn-primary" @click="saveScope">确认</button></template>
  </modal>

  <modal :open="hd.open" @close="hd.open = false" title="建立质量限制" sub="只限制写明的范围和动作；是否受限按“请求的动作 × 对象范围”的交集判断" width="max-w-lg">
    <div class="grid grid-cols-3 gap-3"><div><label class="label">范围类型</label><select v-model="hd.scopeType" class="input"><option v-for="s in HOLD_SCOPES" :key="s">{{ s }}</option></select></div><div class="col-span-2"><label class="label">范围</label><input v-model="hd.scopeVal" class="input" placeholder="批次号 / 工单号 / 单号"></div></div>
    <label class="label mt-4">受限动作</label>
    <div class="flex flex-wrap gap-1.5"><button v-for="(l,k) in HOLD_ACTIONS" :key="k" type="button" @click="toggleIn(hd.actions, k)" class="h-8 px-3 rounded-full text-xs font-medium ring-1 ring-inset transition-all duration-200" :class="hd.actions.includes(k) ? 'bg-rose-600 text-white ring-rose-600' : 'bg-white text-ink-3 ring-black/10'">禁止{{ l }}</button></div>
    <template #footer><button class="btn-secondary" @click="hd.open = false">取消</button><button class="btn-primary" @click="saveHold">建立</button></template>
  </modal>

  <modal :open="rl.open" @close="rl.open = false" title="解除质量限制" sub="只解除这一项；需写明解除依据（如复检报告编号、处置完成凭据）" width="max-w-lg">
    <textarea v-model="rl.note" rows="3" class="textarea" placeholder="解除依据"></textarea>
    <template #footer><button class="btn-secondary" @click="rl.open = false">取消</button><button class="btn-primary" :disabled="!rl.note.trim()" @click="saveRelease">确认解除</button></template>
  </modal>

  <modal :open="dp.open" @close="dp.open = false" title="添加处置行" :sub="'待分配 ' + remaining + ' 件 · 当前身份可提出：' + actionChoices.join(' / ')" width="max-w-lg">
    <div class="grid grid-cols-2 gap-4">
      <div><label class="label">处置方式</label><select v-model="dp.action" class="input"><option v-for="a in actionChoices" :key="a">{{ a }}</option></select></div>
      <div><label class="label">数量（件）</label><input v-model.trim="dp.qty" class="input" inputmode="numeric"></div>
    </div>
    <label class="label mt-4">理由 / 依据</label>
    <textarea v-model="dp.reason" rows="3" class="textarea" placeholder="例如：刀补校正后重车外径；或客户书面同意让步（附件编号）"></textarea>
    <div v-if="dp.action === '让步接收' && noConcession.length" class="mt-3 rounded-xl bg-rose-50 text-rose-800 px-3.5 py-2.5 text-[12.5px]">涉及不可让步特性（{{ noConcession.map(i => '#' + i.no + ' ' + i.name).join('、') }}），不能让步接收。</div>
    <div v-if="NCR_REWORK.includes(dp.action)" class="mt-3 text-[11.5px] text-ink-4">返工、返修、挑选完成后需在原检验任务发起复检（新轮次）。</div>
    <template #footer><button class="btn-secondary" @click="dp.open = false">取消</button><button class="btn-primary" @click="saveDisp">添加</button></template>
  </modal>

  <modal :open="rj.open" @close="rj.open = false" title="退回处置建议" sub="该行标记为已退回，NCR 回到“范围确认”，由建议人重新提出" width="max-w-lg">
    <textarea v-model="rj.note" rows="3" class="textarea" placeholder="退回原因"></textarea>
    <template #footer><button class="btn-secondary" @click="rj.open = false">取消</button><button class="btn-primary" :disabled="!rj.note.trim()" @click="saveReject">确认退回</button></template>
  </modal>

  <modal :open="ex.open" @close="ex.open = false" title="登记处置执行结果" sub="批准不等于已执行：这里记录实际执行的结果与凭据" width="max-w-lg">
    <textarea v-model="ex.evidence" rows="3" class="textarea" placeholder="例如：30 件已返工，返工记录 RW-2611-03；或 6 件已报废，报废单 SC-2611-12"></textarea>
    <template #footer><button class="btn-secondary" @click="ex.open = false">取消</button><button class="btn-primary" :disabled="!ex.evidence.trim()" @click="saveExec">登记</button></template>
  </modal>

  <modal :open="vf.open" @close="vf.open = false" title="验证并关闭 NCR" sub="验证的是处置已按批准执行且结果有效；关闭 NCR 不会自动解除质量限制" width="max-w-lg">
    <div class="space-y-2 text-[12.5px]">
      <div class="flex items-center gap-2"><ic name="check" :size="14" class="text-emerald-600"/>处置行全部执行：{{ lines.filter(d => !d.rejected).length }} 行，合计 {{ allocated }} 件</div>
      <div v-if="needRetest" class="flex items-center gap-2"><ic :name="retestPassed ? 'check' : 'alert'" :size="14" :class="retestPassed ? 'text-emerald-600' : 'text-rose-600'"/>返工后复检：{{ retestPassed ? '已有结论为“符合”的复检轮次' : '尚无结论为“符合”的复检轮次' }}</div>
      <div v-if="activeHolds.length" class="flex items-center gap-2"><ic name="lock" :size="14" class="text-amber-600"/>仍有 {{ activeHolds.length }} 条质量限制有效，关闭后需单独解除</div>
    </div>
    <label class="label mt-4">验证结论</label>
    <textarea v-model="vf.note" rows="3" class="textarea" placeholder="例如：返工 30 件复检符合（第 2 轮），报废 6 件已核销"></textarea>
    <template #footer><button class="btn-secondary" @click="vf.open = false">取消</button><button class="btn-success" :disabled="!!closeBlock || !vf.note.trim()" @click="saveVerify"><ic name="shield" :size="15"/>验证通过并关闭</button></template>
  </modal>
</div>
<empty v-else icon="alert" title="NCR 不存在或已删除"><button class="btn-secondary" @click="go('/ncr')">返回列表</button></empty>`,
};

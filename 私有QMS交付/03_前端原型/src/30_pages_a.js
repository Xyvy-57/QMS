/* =====================================================================
 * 页面 A：质量工作台 / 气泡识别工作台（iframe 内嵌）/ 检验标准 / 检验方案
 * ===================================================================== */

/* ---------------- 待办（按当前身份生成） ---------------- */
function buildTodos() {
  const r = me.value.role, uid = me.value.id, out = [];
  const push = (o) => out.push(o);
  if (r === 'insp' || r === 'qe') {
    S.tasks.filter((t) => (t.status === 'pending' || t.status === 'active') && (t.assignee === uid || r === 'qe')).forEach((t) => push({ icon: SCENE_META[t.scene].icon, tone: t.status === 'active' ? 'blue' : 'gray', title: (t.status === 'active' ? '继续检验 ' : '开始检验 ') + t.code, sub: sceneOf(t.scene).name + ' · ' + partOf(t.partId).name + (t.assignee === uid ? ' · 指派给我' : ' · ' + userName(t.assignee)), to: '/inspect/' + t.id, due: t.due }));
  }
  if (r === 'insp' || r === 'qe') {
    S.reports.filter((x) => x.state === 'frozen' && x.opinions && x.opinions.length && x.sigs.some((s) => s.kind === '检验' && (s.uid === uid || r === 'qe'))).forEach((x) => push({ icon: 'file', tone: 'amber', title: '报告被退回 ' + x.code, sub: x.opinions[x.opinions.length - 1].text, to: '/reports/' + x.id }));
  }
  if (r === 'qe') {
    S.syncInbox.filter((x) => x.status === 'pending').forEach((x) => push({ icon: 'target', tone: 'brand', title: '气泡同步待处理 ' + x.syncBatchId, sub: x.drawingNo + ' Rev ' + x.drawingRev + ' · ' + x.items.length + ' 个气泡', to: '/bubble' }));
    S.standards.filter((s) => s.status === 'draft').forEach((s) => push({ icon: 'ruler', tone: 'gray', title: '标准草稿待提交 ' + s.code + ' Rev ' + s.rev, sub: partOf(s.partId).name + (s.returnNote ? ' · 已退回：' + s.returnNote : ''), to: '/standards/' + s.id }));
    S.plans.filter((p) => p.status === 'draft').forEach((p) => push({ icon: 'clipboard', tone: 'gray', title: '方案草稿待提交 ' + p.code + ' Rev ' + p.rev, sub: p.name, to: '/plans/' + p.id }));
    S.ncrs.filter((n) => n.status === 'registered').forEach((n) => push({ icon: 'alert', tone: 'red', title: '确认不合格范围 ' + n.code, sub: n.title, to: '/ncr/' + n.id }));
    S.ncrs.filter((n) => n.status === 'scoped').forEach((n) => push({ icon: 'alert', tone: 'amber', title: '提出处置建议 ' + n.code, sub: n.title, to: '/ncr/' + n.id }));
    S.ncrs.filter((n) => n.status === 'disposing' && n.disp.some((d) => d.approved && !d.executed && !d.rejected)).forEach((n) => push({ icon: 'check', tone: 'amber', title: '登记处置执行 ' + n.code, sub: n.title, to: '/ncr/' + n.id }));
  }
  if (r === 'ql') {
    S.standards.filter((s) => s.status === 'review').forEach((s) => push({ icon: 'ruler', tone: 'amber', title: '审批检验标准 ' + s.code + ' Rev ' + s.rev, sub: partOf(s.partId).name + ' · 提交人 ' + userName(s.submittedBy || s.createdBy), to: '/standards/' + s.id }));
    S.plans.filter((p) => p.status === 'review').forEach((p) => push({ icon: 'clipboard', tone: 'amber', title: '审批检验方案 ' + p.code + ' Rev ' + p.rev, sub: p.name, to: '/plans/' + p.id }));
    S.reports.filter((x) => x.state === 'review').forEach((x) => push({ icon: 'stamp', tone: 'amber', title: '复核报告 ' + x.code, sub: x.content.task.sceneName + ' · ' + x.content.part.name, to: '/reports/' + x.id }));
    S.ncrs.filter((n) => n.status === 'disposing' && n.disp.some((d) => !d.approved && !d.rejected)).forEach((n) => push({ icon: 'alert', tone: 'red', title: '批准处置 ' + n.code, sub: n.title, to: '/ncr/' + n.id }));
    S.ncrs.filter((n) => n.status === 'verifying').forEach((n) => push({ icon: 'shield', tone: 'violet', title: '验证并关闭 ' + n.code, sub: n.title, to: '/ncr/' + n.id }));
  }
  if (r === 'pm') S.ncrs.filter((n) => n.status === 'scoped').forEach((n) => push({ icon: 'wrench', tone: 'amber', title: '核对范围并提出返工建议 ' + n.code, sub: n.title, to: '/ncr/' + n.id }));
  if (r === 'wh' || r === 'ql' || r === 'pm') holdsActive().forEach((x) => push({ icon: 'lock', tone: 'red', title: '质量限制有效：' + x.scopeType + ' ' + x.scopeVal, sub: '禁止' + x.actions.map((a) => HOLD_ACTIONS[a]).join('、') + ' · 来源 ' + x.ncr.code, to: '/ncr/' + x.ncr.id }));
  if (r === 'admin') push({ icon: 'settings', tone: 'gray', title: '检查气泡服务集成状态', sub: S.settings.bubbleBase, to: '/settings' });
  return out;
}
const TONE = { blue: 'bg-sky-50 text-sky-600', gray: 'bg-black/[0.04] text-ink-3', brand: 'bg-brand-50 text-brand-600', red: 'bg-rose-50 text-rose-600', amber: 'bg-amber-50 text-amber-600', violet: 'bg-violet-50 text-violet-600', green: 'bg-emerald-50 text-emerald-600' };

/* ---------------- 特性差异（按稳定特性 ID 比对，气泡号只是显示号） ---------------- */
const DIFF_FIELDS = [['name', '名称'], ['cat', '类别'], ['nominal', '名义值'], ['lsl', '下限'], ['usl', '上限'], ['unit', '单位'], ['kind', '判定类型']];
function tolDir(f, a, b) {
  if (f !== 'lsl' && f !== 'usl') return '';
  if (!a || !b) return a ? '放宽（取消限值）' : '收紧（新增限值）';
  const c = cmpDec(b, a);
  if (c === 0 || c == null) return '';
  return (f === 'lsl' ? c < 0 : c > 0) ? '放宽' : '收紧';
}
function diffItems(oldItems, newItems) {
  const o = new Map((oldItems || []).map((i) => [i.cid, i])), n = new Map(newItems.map((i) => [i.cid, i]));
  const rows = [];
  newItems.forEach((ni) => {
    const oi = o.get(ni.cid);
    if (!oi) { rows.push({ type: 'added', it: ni, changes: [] }); return; }
    const ch = DIFF_FIELDS.filter((x) => String(oi[x[0]] || '') !== String(ni[x[0]] || '')).map((x) => ({ f: x[0], l: x[1], a: oi[x[0]] || '—', b: ni[x[0]] || '—', dir: tolDir(x[0], oi[x[0]], ni[x[0]]) }));
    rows.push({ type: ch.length ? 'changed' : 'same', it: ni, old: oi, changes: ch });
  });
  (oldItems || []).forEach((oi) => { if (!n.has(oi.cid)) rows.push({ type: 'removed', it: oi, changes: [] }); });
  return rows;
}
function diffSummary(rows) { return { added: rows.filter((r) => r.type === 'added').length, changed: rows.filter((r) => r.type === 'changed').length, removed: rows.filter((r) => r.type === 'removed').length, same: rows.filter((r) => r.type === 'same').length }; }
const DIFF_META = { added: ['新增', 'chip-green'], changed: ['变更', 'chip-amber'], removed: ['删除', 'chip-red'], same: ['不变', 'chip-gray'] };

function latestRevOfCode(code) { return S.standards.filter((s) => s.code === code).map((s) => s.rev).sort().pop() || '@'; }
/** 由气泡同步生成标准草稿：识别结果不等于已批准标准，草稿须人工核对并审核 */
function createDraftFromSync(sync) {
  if (!sync.partId || !partOf(sync.partId).id) throw new Error('未匹配到零件：请先在“基础资料 › 零部件”中建立图号 ' + sync.drawingNo + ' 对应的零件');
  const prev = effectiveStd(sync.partId) || S.standards.filter((s) => s.partId === sync.partId).slice(-1)[0] || null;
  const items = sync.items.map((si) => {
    const pi = prev ? prev.items.find((x) => x.cid === si.cid) : null;
    return Object.assign(clone(si), { gauge: (pi && pi.gauge) || si.gauge || recommendGauge(si.cat), method: pi ? pi.method || '' : '', cls: (pi && pi.cls) || si.cls || '一般', noConcession: pi ? !!pi.noConcession : false, note: pi ? pi.note || '' : '' });
  });
  const code = prev ? prev.code : 'STD-' + partOf(sync.partId).drawingNo.slice(-3);
  const std = { id: 's' + nextSeq(), code, partId: sync.partId, rev: prev ? nextRev(latestRevOfCode(code)) : 'A', drawingRev: sync.drawingRev, status: 'draft', source: 'bubble', syncBatchId: sync.syncBatchId, contentHash: sync.contentHash || '', drawingRef: sync.drawingRef || '', items, createdBy: S.me, createdAt: nowISO(), parentId: prev ? prev.id : null, note: '' };
  std.hash = hashOf(std.items);
  S.standards.unshift(std);
  sync.status = 'drafted'; sync.stdId = std.id;
  const p = partOf(sync.partId);
  if (sync.drawingRef) p.drawingRef = sync.drawingRef;
  else if (p.svg && p.svg.indexOf('图纸待从气泡软件同步') >= 0) p.svg = p.svg.replace('图纸待从气泡软件同步', '已同步气泡（底图以气泡软件为准）');
  logAudit('标准', std.code + ' Rev ' + std.rev, '由气泡同步 ' + sync.syncBatchId + ' 生成标准草稿（' + items.length + ' 项特性）');
  return std;
}
/** 演示：模拟 Worlder 气泡图冻结标注后推送的结果 */
function demoSyncPayloads() {
  const shaft = clone(ITEMS_SHAFT); shaft[2].usl = '0.020'; shaft[3].usl = '0.8';
  shaft.push(Object.assign(clone(shaft[0]), { cid: 'CH-018-06', no: 6, name: '键槽宽', cat: '线性尺寸', sym: '', nominal: '5.00', upper: '+0.03', lower: '0', lsl: '5.00', usl: '5.03', cls: 'CC', gauge: '', x: 330, y: 300 }));
  const drill = clone(ITEMS_DRILL).filter((x) => x.no !== 4);
  Object.assign(drill[0], { lsl: '9.97', usl: '10.03', upper: '+0.03', lower: '-0.03' });
  return [
    { label: '01系列轴1-1 · DWG-2026-018 Rev B（新增 1、收紧 2）', partId: 'p2', drawingNo: 'DWG-2026-018', drawingRev: 'B', items: shaft },
    { label: 'CP钻头组件 · DWG-2026-092 Rev C（删除 1、收紧 1）', partId: 'p3', drawingNo: 'DWG-2026-092', drawingRev: 'C', items: drill },
  ];
}
/**
 * 收到同步结果：进入同步收件箱。
 *   带完整气泡的（离线演示数据、PRD §7.2 balloons[]）直接“待处理”；浏览器消息只带通知的，标记“待拉取”并立即按批次号拉取（32_bubble.js）
 */
function ingestSync(payload, origin) {
  if (!payload || !payload.drawingNo) { toast('收到无效的同步消息（缺少 drawingNo），已忽略', 'warn'); return null; }
  if (payload.syncBatchId && S.syncInbox.some((x) => x.syncBatchId === payload.syncBatchId)) { if (origin !== 'poll') toast('同步批次 ' + payload.syncBatchId + ' 已在收件箱中（按批次号幂等）', 'info'); return null; }
  const part = S.parts.find((p) => p.drawingNo === payload.drawingNo || p.id === payload.partId);
  const items = Array.isArray(payload.balloons) ? balloonsToItems(payload) : Array.isArray(payload.items) ? clone(payload.items) : [];
  const notice = !items.length;
  const rec = {
    id: 'sy' + nextSeq(), syncBatchId: payload.syncBatchId || 'SYNC-' + (9100 + S.seq), drawingNo: payload.drawingNo, drawingRev: payload.drawingRev || '?', partId: part ? part.id : '', at: nowISO(),
    by: (origin === 'demo' ? '离线演示数据' : origin === 'poll' ? '气泡软件（轮询）' : '气泡软件') + ' · ' + me.value.name, items, contentHash: notice ? '' : payload.contentHash || hashOf(items),
    notifiedHash: notice ? payload.contentHash || '' : '', status: notice ? 'fetching' : 'pending', stdId: '', error: '', fetching: false, drawingRef: '', partHint: null,
  };
  S.syncInbox.unshift(rec);
  logAudit('集成', rec.syncBatchId, '收到气泡软件冻结结果 ' + rec.drawingNo + ' Rev ' + rec.drawingRev + (notice ? '（仅通知，按批次号拉取权威数据）' : '（' + items.length + ' 个气泡）'));
  if (origin !== 'poll') toast('收到气泡同步 ' + rec.syncBatchId + '：' + rec.drawingNo + ' Rev ' + rec.drawingRev, 'success');
  const live = S.syncInbox.find((x) => x.id === rec.id);
  if (notice && origin === 'bubble') fetchSyncBatch(live).then((ok) => { if (ok) toast('已拉取 ' + live.syncBatchId + '：' + live.items.length + ' 个气泡，内容摘要一致', 'success'); });
  return live;
}

/* =====================================================================
 * 质量工作台
 * ===================================================================== */
/* 数据看板（原来的首页）：指标、主链数量和图表。任务驱动的首页“我的工作”在 48_guide.js。 */
COMPONENTS['page-dashboard'] = {
  setup() {
    const h0 = new Date().getHours();
    const greet = h0 < 6 ? '夜深了' : h0 < 11 ? '早上好' : h0 < 14 ? '中午好' : h0 < 18 ? '下午好' : '晚上好';
    const today = fmtDate(nowISO());
    const todos = computed(() => buildTodos());
    const kpi = computed(() => [
      { label: '待检任务', v: S.tasks.filter((t) => t.status === 'pending').length, icon: 'inbox', to: '/tasks?status=pending', tone: 'gray' },
      { label: '检验中', v: S.tasks.filter((t) => t.status === 'active').length, icon: 'activity', to: '/tasks?status=active', tone: 'blue' },
      { label: '待复核报告', v: S.reports.filter((r) => r.state === 'review').length, icon: 'stamp', to: '/reports?state=review', tone: 'amber' },
      { label: '未关闭 NCR', v: S.ncrs.filter((n) => n.status !== 'closed').length, icon: 'alert', to: '/ncr', tone: 'red' },
      { label: '有效质量限制', v: holdsActive().length, icon: 'lock', to: '/ncr?tab=holds', tone: 'violet' },
    ]);
    const chain = computed(() => [
      { label: '气泡同步', sub: '待处理', v: S.syncInbox.filter((x) => x.status === 'pending').length, to: '/bubble', icon: 'target' },
      { label: '检验标准', sub: '生效', v: S.standards.filter((s) => s.status === 'effective').length, to: '/standards', icon: 'ruler' },
      { label: '检验方案', sub: '生效', v: S.plans.filter((p) => p.status === 'effective').length, to: '/plans', icon: 'clipboard' },
      { label: '检验任务', sub: '进行中', v: S.tasks.filter((t) => t.status === 'pending' || t.status === 'active').length, to: '/tasks', icon: 'list' },
      { label: '检验报告', sub: '待复核', v: S.reports.filter((r) => r.state === 'review').length, to: '/reports', icon: 'file' },
      { label: '不合格处置', sub: '未关闭', v: S.ncrs.filter((n) => n.status !== 'closed').length, to: '/ncr', icon: 'alert' },
    ]);
    const weekly = computed(() => {
      const labels = S.weekly.map((_, i) => (i === S.weekly.length - 1 ? '本周' : '前 ' + (S.weekly.length - 1 - i) + ' 周'));
      const done = S.tasks.filter((t) => ['pass', 'fail', 'insufficient'].includes(t.status));
      const rows = S.weekly.map((w, i) => (i === S.weekly.length - 1 ? [w[0] + done.filter((t) => t.status === 'pass').length, w[1] + done.filter((t) => t.status === 'fail').length, w[2] + done.filter((t) => t.status === 'insufficient').length] : w));
      const rate = rows.map((r) => (r[0] + r[1] ? +(r[0] / (r[0] + r[1]) * 100).toFixed(1) : null));
      return {
        type: 'bar',
        data: { labels, datasets: [
          { label: '合格批', data: rows.map((r) => r[0]), backgroundColor: '#34d399', borderRadius: 6, stack: 's', maxBarThickness: 26 },
          { label: '不合格批', data: rows.map((r) => r[1]), backgroundColor: '#fb7185', borderRadius: 6, stack: 's', maxBarThickness: 26 },
          { label: '证据不足', data: rows.map((r) => r[2]), backgroundColor: '#fbbf24', borderRadius: 6, stack: 's', maxBarThickness: 26 },
          { type: 'line', label: '批合格率 %', data: rate, yAxisID: 'y1', borderColor: '#1f63e0', backgroundColor: '#1f63e0', tension: 0.35, pointRadius: 3, borderWidth: 2 },
        ] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, padding: 14 } } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid: { color: 'rgba(0,0,0,.05)' }, ticks: { precision: 0 } }, y1: { position: 'right', min: 80, max: 100, grid: { display: false } } } },
      };
    });
    const pareto = computed(() => {
      const m = Object.assign({}, S.defectHistory);
      S.tasks.forEach((t) => t.rounds.forEach((r) => { if (r.result) Object.keys(r.result.byCid).forEach((cid) => { const v = r.result.byCid[cid]; if (v.status === 'ng') m[cid] = (m[cid] || 0) + Math.max(1, v.ng || v.bad || 1); }); }));
      const all = []; S.standards.forEach((s) => s.items.forEach((i) => { if (!all.some((x) => x.cid === i.cid)) all.push(i); }));
      const rows = Object.keys(m).map((cid) => { const it = all.find((x) => x.cid === cid); return { l: it ? '#' + it.no + ' ' + it.name.replace(/（.*）/, '') : cid, v: m[cid] }; }).sort((a, b) => b.v - a.v).slice(0, 6);
      const total = sum(rows.map((r) => r.v)) || 1; let acc = 0;
      return {
        type: 'bar',
        data: { labels: rows.map((r) => r.l), datasets: [
          { label: '不合格次数', data: rows.map((r) => r.v), backgroundColor: rows.map((_, i) => (i === 0 ? '#f43f5e' : i === 1 ? '#fb7185' : '#fda4af')), borderRadius: 6, maxBarThickness: 30 },
          { type: 'line', label: '累计占比 %', data: rows.map((r) => { acc += r.v; return +(acc / total * 100).toFixed(1); }), yAxisID: 'y1', borderColor: '#1d1d1f', backgroundColor: '#1d1d1f', pointRadius: 3, borderWidth: 1.6, tension: 0.3 },
        ] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, padding: 14 } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 10.5 } } }, y: { grid: { color: 'rgba(0,0,0,.05)' }, ticks: { precision: 0 } }, y1: { position: 'right', min: 0, max: 100, grid: { display: false } } } },
      };
    });
    const recent = computed(() => S.audit.slice(0, 8));
    return { greet, today, todos, kpi, chain, weekly, pareto, recent, TONE };
  },
  template: `
<div class="space-y-6">
  <div class="flex flex-wrap items-end justify-between gap-4">
    <div><h1 class="page-title">数据看板</h1><p class="text-xs text-ink-3 mt-1">{{ today }} · {{ S.settings.company }} · 点任意数字可以进到对应的清单</p></div>
    <button class="btn-secondary" @click="go('/workbench')"><ic name="home" :size="15"/>回到我的工作</button>
  </div>

  <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
    <button v-for="k in kpi" :key="k.label" class="card card-hover p-4 text-left" @click="go(k.to)">
      <div class="flex items-center justify-between"><span class="text-xs text-ink-3">{{ k.label }}</span><span class="w-7 h-7 rounded-lg flex items-center justify-center" :class="TONE[k.tone]"><ic :name="k.icon" :size="15"/></span></div>
      <div class="text-[30px] font-semibold tracking-tight mt-2 leading-none"><count-up :value="k.v"/></div>
    </button>
  </div>

  <div class="card p-5">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-4"><h2 class="section-title">质量主链</h2><span class="text-xs text-ink-4">图纸气泡 → 标准 → 方案 → 检验 → 报告 → 不合格处置</span></div>
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      <button v-for="(c,i) in chain" :key="c.label" @click="go(c.to)" class="group relative rounded-2xl bg-[#f7f7f9] hover:bg-brand-50 p-4 text-left transition-all duration-300 ease-apple hover:-translate-y-0.5">
        <div class="flex items-center gap-2 text-ink-3 group-hover:text-brand-700 transition-colors"><ic :name="c.icon" :size="15"/><span class="text-xs font-medium">{{ c.label }}</span></div>
        <div class="mt-2 flex items-baseline gap-1"><span class="text-2xl font-semibold tabular">{{ c.v }}</span><span class="text-[11px] text-ink-4">{{ c.sub }}</span></div>
        <ic v-if="i < chain.length - 1" name="chevron-right" :size="14" class="hidden lg:block absolute -right-[11px] top-1/2 -translate-y-1/2 text-ink-5 z-[1]"/>
      </button>
    </div>
  </div>

  <div class="grid grid-cols-1 xl:grid-cols-5 gap-6">
    <div class="card xl:col-span-2 flex flex-col">
      <div class="flex items-center justify-between px-5 pt-5 pb-3"><h2 class="section-title">我的待办</h2><span class="chip-gray">{{ todos.length }}</span></div>
      <div class="flex-1 overflow-y-auto max-h-[420px] px-2 pb-2">
        <empty v-if="!todos.length" icon="check" title="暂无待办" desc="切换右上角的演示身份，可以看到不同岗位的待办"/>
        <button v-for="t in todos" :key="t.title + t.to" @click="go(t.to)" class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-black/[0.035] text-left transition-colors">
          <span class="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" :class="TONE[t.tone]"><ic :name="t.icon" :size="15"/></span>
          <span class="flex-1 min-w-0"><span class="block font-medium truncate">{{ t.title }}</span><span class="block text-xs text-ink-4 truncate">{{ t.sub }}</span></span>
          <span v-if="t.due" class="text-[11px] shrink-0" :class="new Date(t.due) < new Date() ? 'text-rose-600 font-medium' : 'text-ink-4'">{{ fmtRel(t.due) }}</span>
          <ic name="chevron-right" :size="14" class="text-ink-5 shrink-0"/>
        </button>
      </div>
    </div>
    <div class="card p-5 xl:col-span-3">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2"><h2 class="section-title">近 8 周检验批结论</h2><span class="text-[11px] text-ink-4">批合格率 = 合格批 ÷（合格批 + 不合格批），不含证据不足</span></div>
      <chart-box :config="weekly" :height="300"/>
    </div>
  </div>

  <div class="grid grid-cols-1 xl:grid-cols-5 gap-6">
    <div class="card p-5 xl:col-span-3">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2"><h2 class="section-title">不合格特性排列图</h2><span class="text-[11px] text-ink-4">按稳定特性 ID 汇总，换图后仍可追溯</span></div>
      <chart-box :config="pareto" :height="280"/>
    </div>
    <div class="card p-5 xl:col-span-2">
      <div class="flex items-center justify-between mb-3"><h2 class="section-title">最近动态</h2><button class="link text-xs" @click="go('/audit')">全部日志</button></div>
      <ol class="relative border-l border-black/[0.08] ml-2 space-y-4">
        <li v-for="(a,i) in recent" :key="i" class="pl-4 relative">
          <span class="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-white ring-2" :class="i === 0 ? 'ring-brand-500' : 'ring-black/20'"></span>
          <div class="text-[12.5px] leading-relaxed"><span class="font-medium">{{ userName(a.uid) }}</span> <span class="text-ink-3">{{ a.text }}</span></div>
          <div class="text-[11px] text-ink-4 mt-0.5">{{ a.act }} · {{ a.obj }} · {{ fmtRel(a.at) }}</div>
        </li>
      </ol>
    </div>
  </div>
</div>`,
};

/* =====================================================================
 * 气泡识别工作台：iframe 内嵌 Worlder 气泡图 + 同步收件箱
 * ===================================================================== */
/* 顶部入口：前一组切换内嵌的气泡软件页面；后一组（工序、质检单、检具、报告模板）在 QMS 里维护，直接跳到 QMS 页面，避免两套数据 */
const BUBBLE_ROUTES = [
  { g: '气泡软件', items: [['drawings', '图纸库与标注'], ['compare', '图纸对比'], ['similar', '相似图纸'], ['tolerances', '公差标准'], ['settings', '设置与对接']] },
  { g: '在 QMS 里', items: [['qms:/routes', '工序路线'], ['qms:/tasks', '质检单'], ['qms:/gauges', '检具与方法'], ['qms:/report-templates', '报告模板']] },
];
let handshakeTimer = null;
COMPONENTS['page-bubble'] = {
  setup() {
    const frame = ref(null);
    const loaded = ref(false);
    const panel = ref(true);
    const help = ref(true);
    const viewing = ref(null);
    const demoMenu = ref(false);
    const src = computed(() => S.settings.bubbleBase.replace(/\/$/, '') + '/#/' + UI.bubble.route);
    const inbox = computed(() => S.syncInbox);
    const pendingCount = computed(() => S.syncInbox.filter((x) => x.status === 'pending').length);
    const demos = demoSyncPayloads();
    const arm = () => {
      UI.bubble.status = 'loading';
      clearTimeout(handshakeTimer);
      handshakeTimer = setTimeout(() => { if (UI.bubble.status !== 'handshake') UI.bubble.status = 'nohandshake'; }, (S.settings.handshakeTimeout || 6) * 1000);
    };
    /* 只改 hash 不会重新加载 iframe，所以切换子页面不需要重新握手 */
    const navTo = (r) => {
      if (r.indexOf('qms:') === 0) { go(r.slice(4)); return; }
      UI.bubble.route = r;
      if (UI.bubble.status === 'handshake' && frame.value && frame.value.contentWindow) {
        try { frame.value.contentWindow.postMessage({ type: 'qms.navigate', version: 1, payload: { route: r }, route: r }, new URL(S.settings.bubbleBase).origin); } catch (e) { /* 地址无效时忽略 */ }
      }
    };
    const routeActive = (r) => UI.bubble.route === r || UI.bubble.route.indexOf(r + '/') === 0 || (r === 'drawings' && UI.bubble.route.indexOf('annotate') === 0);
    const reload = () => { loaded.value = false; help.value = true; UI.bubble.reloadKey++; arm(); };
    /* 先探测气泡服务在不在（no-cors：只看连不连得上），不在时显示启动说明，而不是浏览器的“拒绝连接”页面 */
    const svc = reactive({ state: 'checking', file: location.protocol === 'file:' });
    const probe = async () => {
      const base = bubbleBase();
      if (!base) { svc.state = 'offline'; return; }
      try {
        await fetch(base + '/api/v1/health', { mode: 'no-cors', cache: 'no-store' });
        const prev = svc.state; svc.state = 'online';
        if (prev === 'offline') reload();
      } catch (e) { svc.state = 'offline'; }
    };
    const startDir = (() => { const m = /^(.*)\/03_前端原型\//.exec(decodeURIComponent(location.pathname)); return m ? m[1] + '/04_气泡识别软件' : '私有QMS交付/04_气泡识别软件'; })();
    const startCmd = 'cd "' + startDir + '" && node server.mjs';
    const copyCmd = async () => { try { await navigator.clipboard.writeText(startCmd); toast('已复制，粘贴到“终端”里回车', 'success'); } catch (e) { toast('复制失败，请手动选中复制', 'warn'); } };
    let pollTimer = null, probeTimer = null;
    onMounted(() => { arm(); probe(); probeTimer = setInterval(() => { if (svc.state !== 'online') probe(); }, 3000); pollBubble(); pollTimer = setInterval(pollBubble, 5000); });
    onBeforeUnmount(() => { clearTimeout(handshakeTimer); clearInterval(pollTimer); clearInterval(probeTimer); });
    const refetch = async (x) => { if (await fetchSyncBatch(x)) toast('已拉取 ' + x.syncBatchId + '：' + x.items.length + ' 个气泡，内容摘要一致', 'success'); else toast('拉取失败：' + x.error, 'error'); };
    const newPart = (x) => { try { const p = createPartFromSync(x); toast('已新建零件 ' + p.partNo + ' ' + p.name + '：接着生成标准草稿', 'success'); } catch (e) { toast(e.message, 'error'); } };
    const isLocal = computed(() => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(bubbleBase()));
    const prevOf = (x) => effectiveStd(x.partId);
    const diffOf = (x) => { const prev = prevOf(x); return diffItems(prev ? prev.items : [], x.items); };
    const summaryOf = (x) => diffSummary(diffOf(x));
    const draft = (x) => {
      try {
        const s = createDraftFromSync(x);
        viewing.value = null;
        toast('已生成标准草稿 ' + s.code + ' Rev ' + s.rev + '：请核对质量属性后提交审核', 'success');
        go('/standards/' + s.id);
      } catch (e) { toast(e.message, 'error'); }
    };
    const ignore = async (x) => { if (await confirmBox({ title: '忽略这次同步？', message: '忽略后不会生成标准草稿，记录保留在收件箱中便于追溯。', ok: '忽略' })) { x.status = 'ignored'; logAudit('集成', x.syncBatchId, '忽略气泡同步'); } };
    const pushDemo = (d) => { demoMenu.value = false; ingestSync({ syncBatchId: 'SYNC-' + (9110 + (nextSeq() % 800)), drawingNo: d.drawingNo, drawingRev: d.drawingRev, partId: d.partId, items: d.items }, 'demo'); panel.value = true; };
    const openNew = () => window.open(src.value, '_blank', 'noopener');
    const viewDiff = computed(() => (viewing.value ? diffOf(viewing.value) : []));
    const viewMap = computed(() => { const m = {}; viewDiff.value.forEach((r) => { if (r.type !== 'same') m[r.it.cid] = r.type; }); return m; });
    const viewItems = computed(() => (viewing.value ? viewing.value.items.concat(viewDiff.value.filter((r) => r.type === 'removed').map((r) => r.it)) : []));
    return { frame, loaded, panel, help, src, inbox, pendingCount, demos, demoMenu, navTo, routeActive, reload, refetch, newPart, isLocal, svc, probe, startCmd, copyCmd, summaryOf, prevOf, draft, ignore, pushDemo, openNew, viewing, viewDiff, viewMap, viewItems, BUBBLE_ROUTES, DIFF_META };
  },
  template: `
<div class="flex flex-col gap-4 h-[calc(100vh-112px-var(--flow-h))] min-h-[620px]">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="min-w-0">
      <div class="flex items-center gap-2">
        <h1 class="page-title">气泡识别工作台</h1>
        <span v-if="UI.bubble.status === 'handshake'" class="chip-green"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>已握手</span>
        <span v-else-if="UI.bubble.status === 'loading'" class="chip-blue"><ic name="refresh" :size="11" class="animate-spin"/>连接中</span>
        <span v-else class="chip-amber"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>未收到握手</span>
      </div>
      <p class="text-xs text-ink-3 mt-1">在下面的气泡软件里上传图纸、校核、冻结 → 右侧收件箱自动收到并核对摘要 → 点“生成标准草稿”。</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative">
        <button class="btn-ghost" @click="demoMenu = !demoMenu" title="气泡软件没启动时演示用"><ic name="sparkles" :size="15"/>离线演示数据</button>
        <div v-if="demoMenu" class="fixed inset-0 z-20" @click="demoMenu = false"></div>
        <transition name="pop"><div v-if="demoMenu" class="absolute right-0 mt-2 w-80 card shadow-pop p-1.5 z-30">
          <div class="px-3 py-2 text-[11px] text-ink-4">没有启动气泡软件时，用预置的冻结结果演示后面的流程</div>
          <button v-for="d in demos" :key="d.label" class="w-full text-left px-3 py-2 rounded-xl hover:bg-black/[0.04] text-[13px] transition-colors" @click="pushDemo(d)">{{ d.label }}</button>
        </div></transition>
      </div>
      <button class="btn-secondary" @click="reload"><ic name="refresh" :size="15"/>刷新</button>
      <button class="btn-secondary" @click="openNew"><ic name="external" :size="15"/>新窗口打开</button>
      <button class="btn-ghost" @click="panel = !panel"><ic name="inbox" :size="15"/>收件箱<span v-if="pendingCount" class="chip-red">{{ pendingCount }}</span></button>
    </div>
  </div>

  <div class="flex items-center gap-1 overflow-x-auto pb-1 -mt-1">
    <template v-for="(grp,gi) in BUBBLE_ROUTES" :key="grp.g">
      <span class="text-[11px] text-ink-4 px-2 shrink-0">{{ grp.g }}</span>
      <button v-for="r in grp.items" :key="r[0]" @click="navTo(r[0])" class="shrink-0 h-8 px-3 rounded-lg text-[12.5px] font-medium transition-all duration-200 inline-flex items-center gap-1" :class="routeActive(r[0]) ? 'bg-brand-600 text-white shadow-[0_2px_8px_rgba(31,99,224,.3)]' : 'text-ink-2 hover:bg-black/[0.05]'">{{ r[1] }}<ic v-if="r[0].indexOf('qms:') === 0" name="arrow-right" :size="11" class="opacity-50"/></button>
      <span v-if="gi < BUBBLE_ROUTES.length - 1" class="w-px h-4 bg-black/10 mx-1 shrink-0"></span>
    </template>
  </div>

  <div class="flex-1 flex gap-4 min-h-0">
    <div class="flex-1 card overflow-hidden relative min-w-0">
      <iframe ref="frame" :key="UI.bubble.reloadKey" :src="src" @load="loaded = true" class="w-full h-full border-0 bg-white" title="Worlder 气泡图" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals" allow="clipboard-read; clipboard-write; fullscreen" referrerpolicy="no-referrer"></iframe>
      <transition name="fade">
        <div v-if="!loaded" class="absolute inset-0 bg-white p-6 space-y-4">
          <div class="flex items-center gap-3"><div class="skeleton h-9 w-40"></div><div class="skeleton h-9 flex-1"></div><div class="skeleton h-9 w-28"></div></div>
          <div class="flex gap-4 h-[calc(100%-56px)]"><div class="skeleton w-56 h-full"></div><div class="flex-1 space-y-3"><div class="skeleton h-10"></div><div class="skeleton h-12"></div><div class="skeleton h-12"></div><div class="skeleton h-12"></div><div class="skeleton h-12 w-2/3"></div></div></div>
        </div>
      </transition>
      <div v-if="svc.file || svc.state === 'offline'" class="absolute inset-0 z-10 bg-white flex items-center justify-center p-6 overflow-y-auto">
        <div class="max-w-xl w-full">
          <div class="flex items-start gap-3">
            <span class="w-11 h-11 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0"><ic name="info" :size="20"/></span>
            <div>
              <div class="font-semibold text-[16px]">{{ svc.file ? '请换成 http://localhost:5180 打开 QMS' : '气泡识别服务还没有启动' }}</div>
              <p class="text-[12.5px] text-ink-3 mt-1 leading-relaxed" v-if="svc.file">现在这个页面是直接双击 HTML 文件打开的（地址栏是 file://）。为了安全，气泡软件只允许被白名单里的 QMS 地址内嵌、同步结果也只发给白名单地址，所以这里接不上。</p>
              <p class="text-[12.5px] text-ink-3 mt-1 leading-relaxed" v-else>QMS 里内嵌的气泡软件由本机服务提供，服务启动后这里会自动连上。</p>
            </div>
          </div>
          <div v-if="svc.state !== 'online'" class="mt-5">
            <div class="text-[13px] font-medium">① 打开“终端”，粘贴这一行并回车（之后这个终端窗口不要关）：</div>
            <div class="mt-2 rounded-xl bg-[#1d1d1f] text-white font-mono text-[12px] px-3.5 py-3 flex items-center gap-3"><span class="flex-1 select-all break-all leading-relaxed">{{ startCmd }}</span><button class="shrink-0 h-7 px-2.5 rounded-lg bg-white/15 hover:bg-white/25 text-[11.5px]" @click="copyCmd">复制</button></div>
            <div class="text-[13px] font-medium mt-4">② 服务启动后，浏览器会自动打开 http://localhost:5180 ，在那里点左侧“气泡识别”。</div>
          </div>
          <div v-else class="mt-5 text-[13px]">气泡识别服务已经在运行，直接换成下面的地址打开即可。</div>
          <div class="flex flex-wrap items-center gap-2 mt-5">
            <a v-if="svc.file" class="btn-primary" href="http://localhost:5180/#/bubble"><ic name="external" :size="15"/>打开 http://localhost:5180</a>
            <button v-else class="btn-primary" @click="probe"><ic name="refresh" :size="15"/>重新连接</button>
            <span class="text-[11.5px] text-ink-4">{{ svc.state === 'checking' ? '正在检测…' : svc.state === 'offline' ? '每 3 秒自动检测一次' : '' }}</span>
          </div>
          <p v-if="svc.file" class="text-[11.5px] text-ink-4 mt-4 leading-relaxed">提示：两个地址的演示数据分开保存在浏览器里，换地址后看到的是一份新的演示数据。</p>
        </div>
      </div>
      <transition name="fade">
        <div v-if="UI.bubble.status === 'nohandshake' && help && !svc.file && svc.state === 'online'" class="absolute left-4 right-4 top-4 card shadow-lift p-4 max-w-2xl">
          <div class="flex items-start gap-3">
            <span class="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0"><ic name="info" :size="16"/></span>
            <div class="flex-1 text-[12.5px] leading-relaxed">
              <div class="font-semibold text-[13.5px]">{{ S.settings.handshakeTimeout }} 秒内没有收到气泡服务的握手消息</div>
              <p class="text-ink-3 mt-1">如果下方已经显示气泡软件页面，说明页面可以访问，只是对方还没有接入消息通知；冻结结果仍会通过同步接口轮询送达。如果显示空白或报错，常见原因是：</p>
              <ol class="mt-2 space-y-1 text-ink-2 list-decimal pl-4">
                <li v-if="isLocal"><b>本机气泡软件没有启动</b>：在 <span class="font-mono">04_气泡识别软件</span> 目录执行 <span class="kbd">node server.mjs</span>，并用它打印的 QMS 地址（http://localhost:5180）打开本系统；直接双击 HTML 文件打开时来源是 file://，不在白名单里。</li>
                <li><b>来源不在白名单</b>：QMS 的“集成设置”和气泡软件的“设置与对接”要互相写上对方的地址。</li>
                <li v-if="!isLocal"><b>自签名证书</b>：先点“新窗口打开”，在浏览器里信任证书后回到本页点“刷新”。</li>
                <li v-if="!isLocal"><b>禁止被内嵌</b>：气泡服务需要在响应头里放行 QMS 域名（frame-ancestors）。</li>
              </ol>
              <button class="link text-xs mt-2" @click="go('/settings')">查看集成设置与对接清单</button>
            </div>
            <button class="btn-icon" @click="help = false" aria-label="关闭提示"><ic name="x" :size="16"/></button>
          </div>
        </div>
      </transition>
    </div>

    <transition name="fade">
    <aside v-if="panel" class="w-[360px] shrink-0 card flex flex-col overflow-hidden max-lg:hidden">
      <div class="px-4 pt-4 pb-3 border-b border-black/[0.06]">
        <div class="flex items-center justify-between"><h2 class="section-title">同步收件箱</h2><span class="text-[11px] text-ink-4">按批次号幂等</span></div>
        <p class="text-[11.5px] text-ink-4 mt-1 leading-relaxed">气泡软件冻结标注后推送到这里。识别结果不等于已批准的标准：需要生成草稿、核对并审核。</p>
      </div>
      <div class="flex-1 overflow-y-auto p-3 space-y-2.5">
        <empty v-if="!inbox.length" icon="inbox" title="暂无同步" desc="在气泡软件里冻结标注结果，或点击“模拟气泡推送”"/>
        <div v-for="x in inbox" :key="x.id" class="rounded-2xl border p-3.5 transition-all duration-300" :class="x.status === 'pending' ? 'border-brand-200 bg-brand-50/40' : 'border-black/[0.06] bg-white'">
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono text-[11.5px] text-ink-3">{{ x.syncBatchId }}</span>
            <span v-if="x.status === 'pending'" class="chip-brand">待处理</span><span v-else-if="x.status === 'drafted'" class="chip-green">已生成草稿</span><span v-else-if="x.status === 'fetching'" class="chip-amber">待后端拉取</span><span v-else class="chip-gray">已忽略</span>
          </div>
          <div class="font-medium mt-1.5">{{ partOf(x.partId).name || (x.partHint && x.partHint.name) || '未匹配零件' }} · {{ x.drawingNo }} <span class="text-brand-700">Rev {{ x.drawingRev }}</span></div>
          <div class="text-[11px] text-ink-4 mt-0.5">{{ x.items.length }} 个气泡 · {{ fmtRel(x.at) }}<template v-if="x.contentHash"> · 摘要 {{ x.contentHash.replace('sha256:', '').slice(0, 8) }}</template><span v-if="x.verified" class="text-emerald-700"> · 已核对</span></div>
          <div v-if="x.status === 'fetching'" class="mt-2 rounded-xl bg-amber-50 px-2.5 py-2 text-[11.5px] text-amber-900 leading-relaxed">
            <template v-if="x.fetching">正在按批次号拉取冻结结果…</template>
            <template v-else-if="x.error">{{ x.error }}</template>
            <template v-else>收到冻结通知，等待按批次号拉取</template>
            <button v-if="!x.fetching" class="link ml-1" @click="refetch(x)">重新拉取</button>
          </div>
          <div v-if="x.status === 'pending' && !x.partId" class="mt-2 rounded-xl bg-brand-50/70 px-2.5 py-2 text-[11.5px] text-brand-900 leading-relaxed">
            QMS 里还没有图号 {{ x.drawingNo }} 的零件。<span v-if="x.partHint && x.partHint.partNo">标题栏零件号 {{ x.partHint.partNo }}。</span>
            <g-btn perm="md.edit" cls="btn-soft btn-xs ml-1" icon="plus" @click="newPart(x)">按图纸信息新建零件</g-btn>
          </div>
          <div v-if="x.items.length" class="flex flex-wrap items-center gap-1 mt-2">
            <span v-if="prevOf(x)" class="text-[11px] text-ink-4">对比 {{ prevOf(x).code }} Rev {{ prevOf(x).rev }}：</span>
            <span v-if="summaryOf(x).added" class="chip-green">新增 {{ summaryOf(x).added }}</span><span v-if="summaryOf(x).changed" class="chip-amber">变更 {{ summaryOf(x).changed }}</span><span v-if="summaryOf(x).removed" class="chip-red">删除 {{ summaryOf(x).removed }}</span><span class="chip-gray">不变 {{ summaryOf(x).same }}</span>
          </div>
          <div class="flex items-center gap-1.5 mt-3">
            <button class="btn-secondary btn-sm" :disabled="!x.items.length" @click="viewing = x"><ic name="diff" :size="14"/>查看差异</button>
            <g-btn v-if="x.status === 'pending'" perm="bubble.sync" cls="btn-primary btn-sm" icon="ruler" :when="!!x.partId" why="先新建或匹配零件" @click="draft(x)">生成标准草稿</g-btn>
            <button v-if="x.status === 'drafted'" class="btn-soft btn-sm" @click="go('/standards/' + x.stdId)">查看标准</button>
            <button v-if="x.status === 'pending'" class="btn-ghost btn-sm ml-auto" @click="ignore(x)">忽略</button>
          </div>
        </div>
      </div>
    </aside>
    </transition>
  </div>

  <drawer :open="!!viewing" @close="viewing = null" width="max-w-4xl" :title="viewing ? '同步差异 · ' + viewing.drawingNo + ' Rev ' + viewing.drawingRev : ''" sub="按稳定特性 ID 与当前生效标准比对；差异本身不产生任何采用决定">
    <template v-if="viewing">
      <div class="h-[300px] mb-4"><drawing-viewer :svg="svgOf(viewing)" :items="viewItems" :diff="viewMap"/></div>
      <table class="tbl">
        <thead><tr><th>气泡</th><th>特性</th><th>差异</th><th>变化明细</th></tr></thead>
        <tbody>
          <tr v-for="r in viewDiff" :key="r.it.cid" :class="r.type === 'same' ? 'opacity-60' : ''">
            <td class="font-mono font-semibold">#{{ r.it.no }}</td>
            <td><div class="font-medium">{{ r.it.name }}</div><div class="text-[11px] text-ink-4 font-mono">{{ r.it.cid }}</div></td>
            <td><span :class="DIFF_META[r.type][1]">{{ DIFF_META[r.type][0] }}</span></td>
            <td class="text-[12px] whitespace-normal min-w-[220px]"><template v-if="r.type === 'added'">{{ specText(r.it) }} {{ r.it.kind === 'count' ? '' : r.it.unit }}</template><template v-else-if="r.type === 'removed'">原规格 {{ specText(r.it) }}</template>
              <div v-for="c in r.changes" :key="c.f">{{ c.l }}：<span class="line-through text-ink-4">{{ c.a }}</span> → <b>{{ c.b }}</b> <span v-if="c.dir" :class="c.dir.indexOf('放宽') === 0 ? 'chip-amber' : 'chip-blue'">{{ c.dir }}</span></div>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
    <template #footer><button class="btn-secondary" @click="viewing = null">关闭</button><g-btn v-if="viewing && viewing.status === 'pending'" perm="bubble.sync" cls="btn-primary" icon="ruler" @click="draft(viewing)">生成标准草稿</g-btn></template>
  </drawer>
</div>`,
};

/* =====================================================================
 * 检验标准（列表 + 详情）
 * ===================================================================== */
const ITEM_CATS = ['线性尺寸', '角度尺寸', '形位公差', '螺纹', '表面粗糙度', '倒角', '外观', '理化', '功能', '焊接', '其他'];
COMPONENTS['page-standards'] = {
  setup() {
    const status = ref('all'), part = ref(''), q = ref('');
    const opts = computed(() => [{ value: 'all', label: '全部', count: S.standards.length }].concat(['draft', 'review', 'effective', 'retired'].map((k) => ({ value: k, label: STATUS.std[k][0], count: S.standards.filter((s) => s.status === k).length }))));
    const rows = computed(() => { const k = q.value.trim().toLowerCase(); return S.standards.filter((s) => (status.value === 'all' || s.status === status.value) && (!part.value || s.partId === part.value) && (!k || (s.code + ' ' + partOf(s.partId).name + ' ' + partOf(s.partId).partNo).toLowerCase().includes(k))); });
    const refs = (s) => S.plans.filter((p) => p.stdId === s.id && p.status !== 'retired').length;
    const showNew = ref(false), newPart = ref(S.parts[0] ? S.parts[0].id : '');
    const createManual = () => {
      const p = partOf(newPart.value); if (!p.id) return;
      const prev = S.standards.filter((s) => s.partId === p.id)[0] || null;
      const code = prev ? prev.code : 'STD-' + p.drawingNo.slice(-3);
      const items = prev ? clone(prev.items) : [{ cid: 'CH-M' + nextSeq(), no: 1, name: '新特性', cat: '线性尺寸', kind: 'measure', sym: '', nominal: '', upper: '', lower: '', lsl: '', usl: '', unit: 'mm', cls: '一般', gauge: recommendGauge('线性尺寸'), method: '', x: 120, y: 120 }];
      const s = { id: 's' + nextSeq(), code, partId: p.id, rev: prev ? nextRev(latestRevOfCode(code)) : 'A', drawingRev: p.drawingRev, status: 'draft', source: 'manual', syncBatchId: '', items, createdBy: S.me, createdAt: nowISO(), parentId: prev ? prev.id : null, note: '' };
      s.hash = hashOf(s.items); S.standards.unshift(s); showNew.value = false;
      logAudit('标准', s.code + ' Rev ' + s.rev, '手工新建标准草稿'); go('/standards/' + s.id);
    };
    return { status, part, q, opts, rows, refs, showNew, newPart, createManual };
  },
  template: `
<div class="space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div><h1 class="page-title">检验标准</h1><p class="text-xs text-ink-3 mt-1">每个零件的检验要求。提交后不能改，要改就新建修订。</p></div>
    <div class="flex gap-2"><button class="btn-secondary" @click="go('/bubble')"><ic name="target" :size="15"/>从气泡同步</button><g-btn perm="std.edit" cls="btn-primary" icon="plus" @click="showNew = true">手工新建</g-btn></div>
  </div>
  <div class="flex flex-wrap items-center gap-2">
    <seg v-model="status" :options="opts"/>
    <select v-model="part" class="input !w-auto !h-[38px]"><option value="">全部零件</option><option v-for="p in S.parts" :key="p.id" :value="p.id">{{ p.partNo }} {{ p.name }}</option></select>
    <div class="relative"><ic name="search" :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"/><input v-model="q" class="input !h-[38px] pl-9 w-56" placeholder="搜索编号 / 零件"></div>
  </div>
  <div class="card overflow-hidden">
    <div class="overflow-x-auto"><table class="tbl">
      <thead><tr><th>标准编号</th><th>零件</th><th>图纸版本</th><th>来源</th><th>特性</th><th>状态</th><th>被方案引用</th><th>更新</th><th></th></tr></thead>
      <tbody>
        <tr v-for="s in rows" :key="s.id" class="row-link" @click="go('/standards/' + s.id)">
          <td><div class="font-medium">{{ s.code }} <span class="text-brand-700">Rev {{ s.rev }}</span></div><div class="text-[11px] text-ink-4 font-mono">摘要 {{ s.hash.slice(0, 10) }}</div></td>
          <td><div>{{ partOf(s.partId).name }}</div><div class="text-[11px] text-ink-4">{{ partOf(s.partId).partNo }}</div></td>
          <td class="font-mono text-[12.5px]">{{ partOf(s.partId).drawingNo }} · {{ s.drawingRev }}</td>
          <td><span v-if="s.source === 'bubble'" class="chip-brand"><ic name="target" :size="11"/>气泡同步 {{ s.syncBatchId }}</span><span v-else class="chip-gray"><ic name="edit" :size="11"/>手工录入</span></td>
          <td class="whitespace-nowrap"><span class="tabular">{{ s.items.length }}</span> <span class="text-[11px] text-rose-600">CTQ {{ s.items.filter(i => i.cls === 'CTQ').length }}</span> <span class="text-[11px] text-amber-600">CC {{ s.items.filter(i => i.cls === 'CC').length }}</span></td>
          <td><st k="std" :v="s.status"/></td>
          <td class="tabular">{{ refs(s) }}</td>
          <td class="text-ink-3 text-xs whitespace-nowrap">{{ fmtRel(s.approvedAt || s.createdAt) }}</td>
          <td><ic name="chevron-right" :size="14" class="text-ink-5"/></td>
        </tr>
      </tbody>
    </table></div>
    <empty v-if="!rows.length" icon="ruler" title="没有符合条件的标准"/>
  </div>
  <modal :open="showNew" @close="showNew = false" title="手工新建检验标准" sub="没有图纸或气泡服务不可用时使用；如果该零件已有标准，会以最新修订为起点复制">
    <label class="label">零件</label>
    <select v-model="newPart" class="input"><option v-for="p in S.parts" :key="p.id" :value="p.id">{{ p.partNo }} {{ p.name }}（{{ p.drawingNo }} {{ p.drawingRev }}）</option></select>
    <template #footer><button class="btn-secondary" @click="showNew = false">取消</button><button class="btn-primary" @click="createManual">创建草稿</button></template>
  </modal>
</div>`,
};

COMPONENTS['page-standard'] = {
  setup() {
    const s = computed(() => stdOf(UI.route.params.id));
    const tab = ref('items');
    const sel = ref(null);
    const cmpId = ref('');
    const returning = ref(false), returnNote = ref('');
    const editable = computed(() => !!s.value && s.value.status === 'draft' && can('std.edit'));
    const manual = computed(() => !!s.value && s.value.source === 'manual');
    const siblings = computed(() => (s.value ? S.standards.filter((x) => x.code === s.value.code && x.id !== s.value.id) : []));
    watch(s, (v) => { if (v) { const p = v.parentId ? stdOf(v.parentId) : siblings.value[0]; cmpId.value = p ? p.id : ''; } }, { immediate: true });
    const cmp = computed(() => stdOf(cmpId.value));
    const diffRows = computed(() => (s.value && cmp.value ? diffItems(cmp.value.items, s.value.items) : []));
    const diffMap = computed(() => { const m = {}; diffRows.value.forEach((r) => { if (r.type !== 'same') m[r.it.cid] = r.type; }); return m; });
    const diffChanged = computed(() => diffRows.value.filter((r) => r.type !== 'same'));
    const diffViewItems = computed(() => (s.value ? s.value.items.concat(diffRows.value.filter((r) => r.type === 'removed').map((r) => r.it)) : []));
    const refsPlans = computed(() => (s.value ? S.plans.filter((p) => { const x = stdOf(p.stdId); return !!x && x.code === s.value.code; }) : []));
    const stepIdx = computed(() => (s.value ? { draft: 0, review: 1, effective: 2, retired: 3 }[s.value.status] : 0));
    const gaugesFor = (cat) => S.gauges.filter((g) => g.cats.includes(cat)).concat(S.gauges.filter((g) => !g.cats.includes(cat)));
    const pickRow = (cid) => { sel.value = cid; nextTick(() => { const el = document.getElementById('srow-' + cid); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }); };
    const badge = (it) => (it.cls === 'CTQ' ? 'bg-rose-50 text-rose-700 ring-rose-300' : it.cls === 'CC' ? 'bg-amber-50 text-amber-700 ring-amber-300' : 'bg-brand-50 text-brand-700 ring-brand-300');
    const validate = () => {
      const errs = [], ids = new Set();
      if (!s.value.items.length) errs.push('标准里没有任何特性');
      s.value.items.forEach((it) => {
        if (ids.has(it.cid)) errs.push('#' + it.no + ' 特性 ID 重复'); ids.add(it.cid);
        if (!String(it.name || '').trim()) errs.push('#' + it.no + ' 缺少特性名称');
        if (it.kind !== 'count' && !it.lsl && !it.usl) errs.push('#' + it.no + ' ' + it.name + '：计量特性至少需要一个规格限');
        if (it.lsl && !NUM_RE.test(it.lsl)) errs.push('#' + it.no + ' 下限不是有效数字');
        if (it.usl && !NUM_RE.test(it.usl)) errs.push('#' + it.no + ' 上限不是有效数字');
        if (it.lsl && it.usl && NUM_RE.test(it.lsl) && NUM_RE.test(it.usl) && cmpDec(it.lsl, it.usl) > 0) errs.push('#' + it.no + ' 下限大于上限');
      });
      return errs;
    };
    const submit = () => {
      const errs = validate();
      if (errs.length) { toast('提交前校验未通过：' + errs[0] + (errs.length > 1 ? '（共 ' + errs.length + ' 项）' : ''), 'error'); return; }
      Object.assign(s.value, { hash: hashOf(s.value.items), status: 'review', submittedBy: S.me, submittedAt: nowISO(), returnNote: '' });
      logAudit('标准', s.value.code + ' Rev ' + s.value.rev, '提交审核，内容摘要 ' + s.value.hash); toast('已提交审核，内容已锁定', 'success');
    };
    const approve = async () => {
      if (s.value.submittedBy === S.me) { toast('提交人不得批准本人提交的修订', 'error'); return; }
      if (!(await confirmBox({ title: '批准 ' + s.value.code + ' Rev ' + s.value.rev + ' 生效？', message: '同编号的旧生效修订会变为“已停用”。\n已引用旧修订的方案不会被自动更换；在途任务按建单时的快照继续执行。', ok: '批准生效' }))) return;
      S.standards.filter((x) => x.code === s.value.code && x.status === 'effective').forEach((x) => { x.status = 'retired'; x.retiredAt = nowISO(); });
      Object.assign(s.value, { status: 'effective', approvedBy: S.me, approvedAt: nowISO() });
      const p = partOf(s.value.partId); if (p.id) p.drawingRev = s.value.drawingRev;
      logAudit('标准', s.value.code + ' Rev ' + s.value.rev, '批准生效');
      toast('已生效。仍引用旧修订的方案，请在“引用方案”里逐个决定是否采用', 'success');
      tab.value = 'plans';
    };
    const doReturn = () => { s.value.status = 'draft'; s.value.returnNote = returnNote.value.trim() || '请修改后重新提交'; logAudit('标准', s.value.code + ' Rev ' + s.value.rev, '退回：' + s.value.returnNote); returning.value = false; returnNote.value = ''; toast('已退回编制人', 'info'); };
    const newRev = () => {
      const n = clone(s.value);
      Object.assign(n, { id: 's' + nextSeq(), rev: nextRev(latestRevOfCode(s.value.code)), status: 'draft', parentId: s.value.id, createdBy: S.me, createdAt: nowISO(), approvedBy: '', approvedAt: '', submittedBy: '', submittedAt: '', returnNote: '' });
      n.hash = hashOf(n.items); S.standards.unshift(n);
      logAudit('标准', n.code + ' Rev ' + n.rev, '复制为新修订（父修订 Rev ' + s.value.rev + '）'); toast('已创建新修订草稿', 'success'); go('/standards/' + n.id);
    };
    const retire = async () => { if (await confirmBox({ title: '停用该标准修订？', message: '停用只阻止新方案引用；在途任务和历史报告不受影响。', ok: '停用', danger: true })) { s.value.status = 'retired'; s.value.retiredAt = nowISO(); logAudit('标准', s.value.code + ' Rev ' + s.value.rev, '停用'); } };
    const remove = async () => {
      if (S.plans.some((p) => p.stdId === s.value.id)) { toast('该修订已被方案引用，不能删除', 'error'); return; }
      if (!(await confirmBox({ title: '删除草稿？', message: '只有未被引用的草稿可以删除。', ok: '删除', danger: true }))) return;
      const x = s.value; S.syncInbox.forEach((y) => { if (y.stdId === x.id) { y.status = 'pending'; y.stdId = ''; } });
      logAudit('标准', x.code + ' Rev ' + x.rev, '删除草稿'); S.standards.splice(S.standards.indexOf(x), 1); go('/standards');
    };
    const addItem = () => { const no = Math.max.apply(null, [0].concat(s.value.items.map((i) => i.no))) + 1; s.value.items.push({ cid: 'CH-M' + nextSeq(), no, name: '新特性', cat: '线性尺寸', kind: 'measure', sym: '', nominal: '', upper: '', lower: '', lsl: '', usl: '', unit: 'mm', cls: '一般', gauge: recommendGauge('线性尺寸'), method: '', x: 100 + (no * 53) % 640, y: 330 }); };
    const delItem = (it) => { s.value.items.splice(s.value.items.indexOf(it), 1); };
    const openInBubble = () => { UI.bubble.route = 'drawing-packages'; go('/bubble'); };
    return { s, tab, sel, cmpId, cmp, siblings, diffRows, diffMap, diffChanged, diffViewItems, refsPlans, stepIdx, editable, manual, gaugesFor, pickRow, badge, submit, approve, returning, returnNote, doReturn, newRev, retire, remove, addItem, delItem, openInBubble, DIFF_META, ITEM_CATS };
  },
  template: `
<div v-if="s" class="space-y-5">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div>
      <button class="text-xs text-ink-3 hover:text-ink inline-flex items-center gap-1 mb-2" @click="go('/standards')"><ic name="chevron-left" :size="13"/>检验标准</button>
      <div class="flex flex-wrap items-center gap-2"><h1 class="page-title">{{ s.code }} <span class="text-brand-700">Rev {{ s.rev }}</span></h1><st k="std" :v="s.status"/>
        <span v-if="s.source === 'bubble'" class="chip-brand"><ic name="target" :size="11"/>气泡同步 {{ s.syncBatchId }}</span><span v-else class="chip-gray">手工录入</span></div>
      <p class="text-xs text-ink-3 mt-1">{{ partOf(s.partId).partNo }} {{ partOf(s.partId).name }} · 图纸 {{ partOf(s.partId).drawingNo }} Rev {{ s.drawingRev }} · 内容摘要 <span class="font-mono">{{ s.hash }}</span></p>
    </div>
    <div class="flex flex-wrap gap-2">
      <button v-if="s.source === 'bubble'" class="btn-ghost" @click="openInBubble"><ic name="external" :size="15"/>在气泡软件中打开</button>
      <template v-if="s.status === 'draft'"><g-btn perm="std.edit" cls="btn-ghost" icon="trash" @click="remove">删除草稿</g-btn><g-btn perm="std.edit" cls="btn-primary" icon="arrow-right" @click="submit">提交审核</g-btn></template>
      <template v-if="s.status === 'review'"><g-btn perm="std.approve" cls="btn-secondary" @click="returning = true">退回</g-btn><g-btn perm="std.approve" cls="btn-success" icon="check" :when="s.submittedBy !== S.me" why="提交人不得批准本人提交的修订" @click="approve">批准生效</g-btn></template>
      <template v-if="s.status === 'effective'"><g-btn perm="std.approve" cls="btn-ghost" @click="retire">停用</g-btn><g-btn perm="std.edit" cls="btn-primary" icon="copy" @click="newRev">新建修订</g-btn></template>
    </div>
  </div>
  <next-step v-bind="nextOf('std', s)"/>
  <div v-if="s.returnNote && s.status === 'draft'" class="rounded-2xl bg-amber-50 text-amber-800 px-4 py-3 text-[12.5px] flex items-center gap-2"><ic name="info" :size="15"/>审核退回意见：{{ s.returnNote }}</div>
  <div v-if="s.status === 'draft' && s.source === 'bubble'" class="rounded-2xl bg-brand-50 text-brand-800 px-4 py-3 text-[12.5px] flex items-start gap-2 leading-relaxed"><ic name="lock" :size="15" class="mt-0.5"/><span>名义值、公差、单位和气泡号来自气泡软件，在这里只读；需要修改时回到气泡软件修订并重新冻结同步，避免两边各有一套公差。这里维护质量属性：特殊特性等级、检具与方法、是否不可让步。</span></div>

  <seg v-model="tab" :options="[{ value: 'items', label: '特性清单', count: s.items.length }, { value: 'diff', label: '修订对比' }, { value: 'plans', label: '引用方案', count: refsPlans.length }]"/>

  <div v-if="tab === 'items'" class="grid grid-cols-1 2xl:grid-cols-12 gap-5">
    <div class="card p-3 2xl:col-span-5 h-[420px] 2xl:h-[640px] 2xl:sticky 2xl:top-[calc(72px+var(--flow-h))]"><drawing-viewer :svg="stdSvg(s.id)" :items="s.items" :selected="sel" focus-on-select @select="pickRow"/></div>
    <div class="card overflow-hidden 2xl:col-span-7">
      <div class="overflow-auto max-h-[640px]"><table class="tbl">
        <thead><tr><th>气泡</th><th>特性</th><th>类别 / 判定</th><th>规格</th><th>等级</th><th>检具 / 方法</th><th v-if="editable">不可让步</th><th v-if="editable && manual"></th></tr></thead>
        <tbody>
          <tr v-for="it in s.items" :key="it.cid" :id="'srow-' + it.cid" :class="sel === it.cid ? 'bg-amber-50/70' : 'hover:bg-black/[0.02]'" @click="sel = it.cid">
            <td><span class="balloon-badge" :class="badge(it)">{{ it.no }}</span></td>
            <td class="min-w-[150px]"><input v-if="editable && manual" v-model="it.name" class="input !h-8"><template v-else><div class="font-medium">{{ it.name }}</div><div class="text-[11px] text-ink-4 font-mono">{{ it.cid }}</div></template></td>
            <td class="min-w-[120px]"><template v-if="editable && manual"><select v-model="it.cat" class="input !h-8 mb-1"><option v-for="c in ITEM_CATS" :key="c">{{ c }}</option></select><select v-model="it.kind" class="input !h-8"><option value="measure">计量</option><option value="count">计数</option></select></template>
              <template v-else><div>{{ it.cat }}</div><div class="text-[11px] text-ink-4">{{ it.kind === 'count' ? '计数' : '计量' }}</div></template></td>
            <td class="min-w-[180px]"><div v-if="editable && manual && it.kind !== 'count'" class="flex items-center gap-1"><input v-model.trim="it.lsl" class="input !h-8 !px-2 font-mono !w-[74px]" placeholder="下限"><span class="text-ink-4">~</span><input v-model.trim="it.usl" class="input !h-8 !px-2 font-mono !w-[74px]" placeholder="上限"><input v-model.trim="it.unit" class="input !h-8 !px-2 !w-14" placeholder="单位"></div>
              <input v-else-if="editable && manual" v-model="it.spec" class="input !h-8" placeholder="判定要求，如 无裂纹">
              <template v-else><div class="font-mono text-[12.5px]">{{ specText(it) }} <span class="text-ink-4">{{ it.kind === 'count' ? '' : it.unit }}</span></div><div v-if="it.kind !== 'count'" class="text-[11px] text-ink-4 font-mono">下限 {{ it.lsl || '—' }} · 上限 {{ it.usl || '—' }}</div></template></td>
            <td><select v-if="editable" v-model="it.cls" class="input !h-8 !w-[84px]"><option>CTQ</option><option>CC</option><option>一般</option></select><span v-else :class="it.cls === 'CTQ' ? 'chip-red' : it.cls === 'CC' ? 'chip-amber' : 'chip-gray'">{{ it.cls }}</span></td>
            <td class="min-w-[160px]"><select v-if="editable" v-model="it.gauge" class="input !h-8"><option value="">未指定</option><option v-for="g in gaugesFor(it.cat)" :key="g.id" :value="g.id">{{ g.name }}{{ g.alias ? '（' + g.alias + '）' : '' }}{{ g.cats.includes(it.cat) ? ' · 推荐' : '' }}</option></select><span v-else>{{ gaugeLabel(it.gauge) }}<span v-if="it.noConcession" class="chip-red ml-1.5">不可让步</span></span></td>
            <td v-if="editable" class="text-center"><input type="checkbox" v-model="it.noConcession" class="w-4 h-4 accent-brand-600"></td>
            <td v-if="editable && manual"><button class="btn-icon" @click.stop="delItem(it)" aria-label="删除特性"><ic name="trash" :size="14"/></button></td>
          </tr>
        </tbody>
      </table></div>
      <div v-if="editable && manual" class="p-3 border-t border-black/[0.05]"><button class="btn-ghost btn-sm" @click="addItem"><ic name="plus" :size="14"/>添加特性</button></div>
    </div>
  </div>

  <div v-if="tab === 'diff'" class="space-y-4">
    <div class="flex flex-wrap items-center gap-2 text-[13px]"><span class="text-ink-3">对比基准</span>
      <select v-model="cmpId" class="input !w-auto"><option value="">请选择</option><option v-for="x in siblings" :key="x.id" :value="x.id">{{ x.code }} Rev {{ x.rev }}（{{ STATUS.std[x.status][0] }}）</option></select>
      <span class="text-ink-4 text-xs">→ 当前 Rev {{ s.rev }}</span></div>
    <empty v-if="!cmp" icon="diff" title="没有可对比的修订" desc="该标准只有一个修订，或还没有选择对比基准"/>
    <div v-else class="grid grid-cols-1 xl:grid-cols-12 gap-5">
      <div class="card p-3 xl:col-span-5 h-[380px]"><drawing-viewer :svg="stdSvg(s.id)" :items="diffViewItems" :diff="diffMap"/></div>
      <div class="card overflow-hidden xl:col-span-7"><table class="tbl"><thead><tr><th>气泡</th><th>特性</th><th>差异</th><th>明细</th></tr></thead><tbody>
        <tr v-for="r in diffChanged" :key="r.it.cid"><td class="font-mono font-semibold">#{{ r.it.no }}</td><td>{{ r.it.name }}</td><td><span :class="DIFF_META[r.type][1]">{{ DIFF_META[r.type][0] }}</span></td>
          <td class="text-[12px] whitespace-normal min-w-[220px]"><template v-if="r.type === 'added'">{{ specText(r.it) }} {{ r.it.kind === 'count' ? '' : r.it.unit }}</template><template v-else-if="r.type === 'removed'">原规格 {{ specText(r.it) }}</template><div v-for="c in r.changes" :key="c.f">{{ c.l }}：<span class="line-through text-ink-4">{{ c.a }}</span> → <b>{{ c.b }}</b> <span v-if="c.dir" :class="c.dir.indexOf('放宽') === 0 ? 'chip-amber' : 'chip-blue'">{{ c.dir }}</span></div></td></tr>
        <tr v-if="!diffChanged.length"><td colspan="4" class="text-center text-ink-4 py-8">两个修订的特性内容一致（质量属性的调整不计入图纸差异）</td></tr>
      </tbody></table></div>
    </div>
  </div>

  <div v-if="tab === 'plans'" class="card overflow-hidden">
    <table class="tbl"><thead><tr><th>方案</th><th>引用修订</th><th>状态</th><th>提示</th><th></th></tr></thead><tbody>
      <tr v-for="p in refsPlans" :key="p.id" class="row-link" @click="go('/plans/' + p.id)">
        <td><div class="font-medium">{{ p.code }} Rev {{ p.rev }}</div><div class="text-[11px] text-ink-4">{{ p.name }}</div></td>
        <td>{{ stdOf(p.stdId).code }} Rev {{ stdOf(p.stdId).rev }}</td><td><st k="plan" :v="p.status"/></td>
        <td><span v-if="effectiveStd(p.partId) && effectiveStd(p.partId).id !== p.stdId && p.status !== 'retired'" class="chip-amber">仍引用旧修订，可在方案里“采用新标准版本”</span><span v-else class="text-ink-4 text-xs">{{ p.status === 'retired' ? '方案已停用' : '已引用当前生效修订' }}</span></td>
        <td><ic name="chevron-right" :size="14" class="text-ink-5"/></td>
      </tr>
    </tbody></table>
    <empty v-if="!refsPlans.length" icon="clipboard" title="还没有方案引用这个标准"/>
  </div>

  <modal :open="returning" @close="returning = false" title="退回标准修订" sub="退回后回到草稿，保留退回意见">
    <textarea v-model="returnNote" rows="4" class="textarea" placeholder="退回原因，例如：#4 的检具应改为三次元"></textarea>
    <template #footer><button class="btn-secondary" @click="returning = false">取消</button><button class="btn-primary" @click="doReturn">确认退回</button></template>
  </modal>
</div>
<empty v-else icon="ruler" title="标准不存在或已删除"><button class="btn-secondary" @click="go('/standards')">返回列表</button></empty>`,
};

/* =====================================================================
 * 检验方案（列表 / 方案模板 / 详情）
 * ===================================================================== */
/** 模板规则 → 特性分配：模板只存规则，不存具体特性，所以能跨零件复用 */
function applyTemplateRules(tpl, items) {
  const a = {}, hasC = tpl.groups.some((x) => x.type === 'count'), hasM = tpl.groups.some((x) => x.type === 'measure');
  items.forEach((it) => {
    const key = tpl.ruleBy === 'cls' ? it.cls : it.cat;
    let g = tpl.rules[key] != null ? tpl.rules[key] : tpl.rules['*'];
    if (it.kind === 'count' && g === 'M') g = hasC ? 'C' : '-';
    if (g === 'C' && !hasC) g = it.kind === 'count' ? '-' : (hasM ? 'M' : '-');
    if (g === 'M' && !hasM) g = '-';
    a[it.cid] = g || '-';
  });
  return a;
}
function planCodeFor(part, scenes) { return 'PL-' + part.drawingNo.slice(-3) + '-' + (scenes.length === 1 ? scenes[0] : 'MIX') + '-' + pad2(nextSeq() % 100); }
function groupText(g) { return g.type === 'measure' ? '计量组 n=' + g.n : '计数组 n=' + g.n + ' · Ac ' + g.ac + ' / Re ' + g.re; }

COMPONENTS['page-plans'] = {
  setup() {
    const tab = ref(UI.route.query.tab === 'tpl' ? 'tpl' : 'plans');
    const status = ref('all'), scene = ref('');
    const rows = computed(() => S.plans.filter((p) => (status.value === 'all' || p.status === status.value) && (!scene.value || p.scenes.includes(scene.value))));
    const opts = computed(() => [{ value: 'all', label: '全部', count: S.plans.length }].concat(['draft', 'review', 'effective', 'retired'].map((k) => ({ value: k, label: STATUS.plan[k][0], count: S.plans.filter((p) => p.status === k).length }))));
    const stale = (p) => { const e = effectiveStd(p.partId); return p.status !== 'retired' && !!e && e.id !== p.stdId; };
    const tplName = (p) => { const t = S.planTemplates.find((x) => x.id === p.fromTpl); return t ? t.code : ''; };
    const fromTpl = ref(null), tplPart = ref(S.parts[0] ? S.parts[0].id : '');
    const tplPartOk = computed(() => !!effectiveStd(tplPart.value));
    const preview = computed(() => {
      if (!fromTpl.value || !tplPartOk.value) return null;
      const a = Object.values(applyTemplateRules(fromTpl.value, effectiveStd(tplPart.value).items));
      return { M: a.filter((x) => x === 'M').length, C: a.filter((x) => x === 'C').length, N: a.filter((x) => x === '-').length };
    });
    const createFromTpl = () => {
      const t = fromTpl.value, part = partOf(tplPart.value), std = effectiveStd(part.id);
      const p = { id: 'pl' + nextSeq(), code: planCodeFor(part, t.scenes), name: part.name + ' · ' + t.scenes.map((x) => sceneOf(x).name).join('/') + '方案', partId: part.id, rev: 1, status: 'draft', stdId: std.id, scenes: clone(t.scenes), groups: clone(t.groups), assign: applyTemplateRules(t, std.items), reportTplId: t.reportTplId, fromTpl: t.id, createdBy: S.me, updatedAt: nowISO() };
      S.plans.unshift(p); t.usedBy = (t.usedBy || 0) + 1; fromTpl.value = null;
      logAudit('方案', p.code + ' Rev 1', '从模板 ' + t.code + ' 新建（引用 ' + std.code + ' Rev ' + std.rev + '）');
      toast('已按模板规则生成方案草稿，请核对特性分配', 'success'); go('/plans/' + p.id);
    };
    return { tab, status, scene, rows, opts, stale, tplName, fromTpl, tplPart, tplPartOk, preview, createFromTpl, groupText };
  },
  template: `
<div class="space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div><h1 class="page-title">检验方案</h1><p class="text-xs text-ink-3 mt-1">规定检哪些特性、抽多少件。开检以后规则不能临时改。</p></div>
    <seg v-model="tab" :options="[{ value: 'plans', label: '方案', count: S.plans.length }, { value: 'tpl', label: '方案模板', count: S.planTemplates.length }]"/>
  </div>
  <template v-if="tab === 'plans'">
    <div class="flex flex-wrap items-center gap-2"><seg v-model="status" :options="opts"/>
      <select v-model="scene" class="input !w-auto !h-[38px]"><option value="">全部场景</option><option v-for="sc in S.scenes" :key="sc.code" :value="sc.code">{{ sc.name }}</option></select>
      <span class="text-xs text-ink-4">新方案请到“方案模板”里从模板生成，或在已有方案上“新建修订”</span></div>
    <div class="card overflow-hidden"><div class="overflow-x-auto"><table class="tbl">
      <thead><tr><th>方案</th><th>零件</th><th>引用标准</th><th>适用场景</th><th>抽样组</th><th>报告模板</th><th>状态</th><th></th></tr></thead>
      <tbody><tr v-for="p in rows" :key="p.id" class="row-link" @click="go('/plans/' + p.id)">
        <td><div class="font-medium">{{ p.code }} <span class="text-brand-700">Rev {{ p.rev }}</span></div><div class="text-[11px] text-ink-4">{{ p.name }}<span v-if="tplName(p)"> · 来自模板 {{ tplName(p) }}</span></div></td>
        <td>{{ partOf(p.partId).name }}</td>
        <td><div class="whitespace-nowrap">{{ stdOf(p.stdId).code }} Rev {{ stdOf(p.stdId).rev }}</div><span v-if="stale(p)" class="chip-amber mt-1">有新标准版本</span></td>
        <td><div class="flex flex-wrap gap-1"><span v-for="c in p.scenes" :key="c" class="chip" :class="SCENE_META[c].tint">{{ sceneOf(c).name }}</span></div></td>
        <td class="text-[12px] whitespace-nowrap"><div v-for="g in p.groups" :key="g.key">{{ groupText(g) }}</div></td>
        <td class="text-[12px] text-ink-3">{{ (tplOf(p.reportTplId) || {}).name }}</td>
        <td><st k="plan" :v="p.status"/></td>
        <td><ic name="chevron-right" :size="14" class="text-ink-5"/></td>
      </tr></tbody>
    </table></div><empty v-if="!rows.length" icon="clipboard" title="没有符合条件的方案"/></div>
  </template>
  <template v-else>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div v-for="t in S.planTemplates" :key="t.id" class="card card-hover p-5">
        <div class="flex items-start justify-between gap-3"><div><div class="text-[11px] font-mono text-ink-4">{{ t.code }}</div><div class="font-semibold text-[15px] mt-0.5">{{ t.name }}</div></div><span class="chip-gray">已被 {{ t.usedBy || 0 }} 个方案使用</span></div>
        <p class="text-xs text-ink-3 mt-2">{{ t.desc }}</p>
        <div class="flex flex-wrap gap-1 mt-3"><span v-for="c in t.scenes" :key="c" class="chip" :class="SCENE_META[c].tint">{{ sceneOf(c).name }}</span><span v-for="g in t.groups" :key="g.key" class="chip-gray">{{ groupText(g) }}</span></div>
        <div class="mt-3 text-[12px] text-ink-2 bg-[#f7f7f9] rounded-xl px-3 py-2 leading-relaxed">分配规则（按{{ t.ruleBy === 'cls' ? '特殊特性等级' : '特性类别' }}）：<span v-for="(v,k) in t.rules" :key="k" class="mr-2 whitespace-nowrap">{{ k === '*' ? '其它' : k }} → <b>{{ v === 'M' ? '计量组' : v === 'C' ? '计数组' : '不检' }}</b></span></div>
        <div class="flex justify-end mt-4"><g-btn perm="plan.edit" cls="btn-primary btn-sm" icon="copy" @click="fromTpl = t">从模板新建方案</g-btn></div>
      </div>
    </div>
    <p class="text-[11.5px] text-ink-4">模板只保存规则（适用场景、抽样组、按类别的分配规则、报告模板），不保存具体特性，所以可以跨零件复用。在任意方案详情里点“另存为模板”可以新增模板。</p>
  </template>
  <modal :open="!!fromTpl" @close="fromTpl = null" :title="fromTpl ? '从模板新建：' + fromTpl.name : ''" sub="模板只是编制起点：生成后是独立的方案修订，模板以后再改也不会回写">
    <label class="label">零件（需要已有生效标准）</label>
    <select v-model="tplPart" class="input"><option v-for="p in S.parts" :key="p.id" :value="p.id">{{ p.partNo }} {{ p.name }}{{ effectiveStd(p.id) ? '（' + effectiveStd(p.id).code + ' Rev ' + effectiveStd(p.id).rev + '）' : '（无生效标准）' }}</option></select>
    <div v-if="!tplPartOk" class="mt-3 text-xs text-rose-600">该零件没有生效的检验标准，请先在气泡识别工作台同步并审核。</div>
    <div v-if="preview" class="mt-4 grid grid-cols-3 gap-2 text-center"><div class="rounded-xl bg-brand-50 py-3"><div class="text-xl font-semibold tabular">{{ preview.M }}</div><div class="text-[11px] text-ink-3">进计量组</div></div><div class="rounded-xl bg-amber-50 py-3"><div class="text-xl font-semibold tabular">{{ preview.C }}</div><div class="text-[11px] text-ink-3">进计数组</div></div><div class="rounded-xl bg-black/[0.04] py-3"><div class="text-xl font-semibold tabular">{{ preview.N }}</div><div class="text-[11px] text-ink-3">不检</div></div></div>
    <template #footer><button class="btn-secondary" @click="fromTpl = null">取消</button><button class="btn-primary" :disabled="!tplPartOk" @click="createFromTpl">生成方案草稿</button></template>
  </modal>
</div>`,
};

COMPONENTS['page-plan'] = {
  setup() {
    const p = computed(() => planOf(UI.route.params.id));
    const std = computed(() => (p.value ? stdOf(p.value.stdId) : null));
    const editable = computed(() => !!p.value && p.value.status === 'draft' && can('plan.edit'));
    const stepIdx = computed(() => (p.value ? { draft: 0, review: 1, effective: 2, retired: 3 }[p.value.status] : 0));
    const latest = computed(() => (p.value ? effectiveStd(p.value.partId) : null));
    const stale = computed(() => !!latest.value && !!std.value && latest.value.id !== std.value.id && p.value.status !== 'retired');
    const stdChoices = computed(() => (p.value ? S.standards.filter((s) => s.partId === p.value.partId && (s.status === 'effective' || s.id === p.value.stdId)) : []));
    const cg = computed(() => (p.value ? p.value.groups.find((g) => g.type === 'count') || null : null));
    const mg = computed(() => (p.value ? p.value.groups.find((g) => g.type === 'measure') || null : null));
    const counts = computed(() => { const a = p.value ? Object.values(p.value.assign) : []; return { M: a.filter((x) => x === 'M').length, C: a.filter((x) => x === 'C').length, N: a.filter((x) => x === '-').length }; });
    const itemsView = computed(() => (std.value ? std.value.items : []));
    const viewStatus = computed(() => { const m = {}; if (p.value) itemsView.value.forEach((i) => { m[i.cid] = p.value.assign[i.cid] === '-' || p.value.assign[i.cid] == null ? 'missing' : null; }); return m; });
    const helper = reactive({ lot: 1241, aql: '1.0' });
    const sug = computed(() => aqlSuggest(helper.lot, helper.aql));
    const sel = ref(null);
    const returning = ref(false), returnNote = ref('');
    const applySug = () => { const x = sug.value; if (!x || x.unsupported || x.error) return; Object.assign(cg.value, { n: x.n, ac: x.ac, re: x.re, aql: helper.aql, lotRef: parseInt(helper.lot, 10) }); toast('已按演示规则填入 n=' + x.n + '、Ac ' + x.ac + ' / Re ' + x.re, 'success'); };
    const addCount = () => { p.value.groups.push({ key: 'C', type: 'count', name: '计数组', n: 50, ac: 1, re: 2, aql: '1.0', lotRef: 500, earlyReject: true }); itemsView.value.forEach((it) => { if (it.kind === 'count') p.value.assign[it.cid] = 'C'; }); };
    const removeCount = () => { p.value.groups = p.value.groups.filter((g) => g.type !== 'count'); Object.keys(p.value.assign).forEach((k) => { if (p.value.assign[k] === 'C') p.value.assign[k] = '-'; }); };
    const toggleScene = (c) => { if (!editable.value) return; const i = p.value.scenes.indexOf(c); if (i >= 0) p.value.scenes.splice(i, 1); else p.value.scenes.push(c); };
    const defaultGroup = (it, plan) => (it.kind === 'count' ? (plan.groups.some((g) => g.type === 'count') ? 'C' : '-') : (plan.groups.some((g) => g.type === 'measure') ? 'M' : '-'));
    const changeStd = (id) => { const ns = stdOf(id); if (!ns) return; const a = {}; ns.items.forEach((it) => { a[it.cid] = p.value.assign[it.cid] != null ? p.value.assign[it.cid] : defaultGroup(it, p.value); }); p.value.stdId = id; p.value.assign = a; };
    const validate = () => {
      const e = [];
      if (!String(p.value.name || '').trim()) e.push('请填写方案名称');
      if (!p.value.scenes.length) e.push('至少选择一个适用场景');
      if (!counts.value.M && !counts.value.C) e.push('至少分配一个检验特性');
      if (!std.value || std.value.status !== 'effective') e.push('只能引用生效的标准修订');
      if (mg.value && !(Number.isInteger(mg.value.n) && mg.value.n >= 1)) e.push('计量组样本量须为不小于 1 的整数');
      if (cg.value) {
        if (!(Number.isInteger(cg.value.n) && cg.value.n >= 1)) e.push('计数组样本量须为不小于 1 的整数');
        if (!(Number.isInteger(cg.value.ac) && cg.value.ac >= 0)) e.push('Ac 须为不小于 0 的整数');
        if (cg.value.re !== cg.value.ac + 1) e.push('一次抽样须满足 Re = Ac + 1');
      }
      return e;
    };
    const submit = () => { const e = validate(); if (e.length) { toast('提交校验未通过：' + e[0] + (e.length > 1 ? '（共 ' + e.length + ' 项）' : ''), 'error'); return; } Object.assign(p.value, { status: 'review', submittedBy: S.me, returnNote: '', updatedAt: nowISO() }); logAudit('方案', p.value.code + ' Rev ' + p.value.rev, '提交审核'); toast('方案已提交审核，内容已锁定', 'success'); };
    const approve = async () => {
      if (p.value.submittedBy === S.me) { toast('提交人不得批准本人提交的修订', 'error'); return; }
      if (!(await confirmBox({ title: '批准方案生效？', message: '同编号的旧修订会停用；已建任务保持建单时的快照，不受影响。', ok: '批准生效' }))) return;
      S.plans.filter((x) => x.code === p.value.code && x.status === 'effective').forEach((x) => { x.status = 'retired'; });
      Object.assign(p.value, { status: 'effective', approvedBy: S.me, updatedAt: nowISO() });
      logAudit('方案', p.value.code + ' Rev ' + p.value.rev, '批准生效（引用 ' + std.value.code + ' Rev ' + std.value.rev + '）'); toast('方案已生效，可以用来新建检验任务', 'success');
    };
    const doReturn = () => { p.value.status = 'draft'; p.value.returnNote = returnNote.value.trim() || '请修改后重新提交'; logAudit('方案', p.value.code + ' Rev ' + p.value.rev, '退回：' + p.value.returnNote); returning.value = false; returnNote.value = ''; toast('已退回编制人', 'info'); };
    const newRev = (adopt) => {
      const n = clone(p.value);
      const maxRev = Math.max.apply(null, S.plans.filter((x) => x.code === p.value.code).map((x) => x.rev));
      Object.assign(n, { id: 'pl' + nextSeq(), rev: maxRev + 1, status: 'draft', createdBy: S.me, updatedAt: nowISO(), approvedBy: '', submittedBy: '', returnNote: '', adoptNote: '', parentId: p.value.id });
      let msg = '复制为新修订 Rev ' + n.rev;
      if (adopt && latest.value) {
        const d = diffSummary(diffItems(std.value.items, latest.value.items));
        const a = {}; latest.value.items.forEach((it) => { a[it.cid] = n.assign[it.cid] != null ? n.assign[it.cid] : defaultGroup(it, n); });
        n.stdId = latest.value.id; n.assign = a;
        n.adoptNote = '采用 ' + latest.value.code + ' Rev ' + latest.value.rev + '：新增 ' + d.added + ' 项按默认规则分配，删除 ' + d.removed + ' 项已移除，变更 ' + d.changed + ' 项沿用原分配';
        msg = n.adoptNote;
      }
      S.plans.unshift(n); logAudit('方案', n.code + ' Rev ' + n.rev, msg); toast(msg, 'success'); go('/plans/' + n.id);
    };
    const saveTpl = () => {
      const rules = {};
      std.value.items.forEach((it) => { if (rules[it.cat] == null) rules[it.cat] = p.value.assign[it.cid] || '-'; });
      rules['*'] = mg.value ? 'M' : '-';
      const t = { id: 'tp' + nextSeq(), code: 'TPL-' + pad2(S.planTemplates.length + 1), name: p.value.name.replace(/^[^·]*·\s*/, '') + '（模板）', desc: '由 ' + p.value.code + ' Rev ' + p.value.rev + ' 另存，按特性类别分配', scenes: clone(p.value.scenes), groups: clone(p.value.groups), rules, ruleBy: 'cat', reportTplId: p.value.reportTplId, usedBy: 0, updatedAt: nowISO() };
      S.planTemplates.push(t); logAudit('方案模板', t.code, '由 ' + p.value.code + ' Rev ' + p.value.rev + ' 另存为模板'); toast('已另存为方案模板 ' + t.code + '，可以在其它零件上复用', 'success');
    };
    const retire = async () => { if (await confirmBox({ title: '停用方案？', message: '停用只阻止新建任务采用；在途任务按原快照继续执行。', ok: '停用', danger: true })) { p.value.status = 'retired'; logAudit('方案', p.value.code + ' Rev ' + p.value.rev, '停用'); } };
    const remove = async () => {
      if (S.tasks.some((t) => t.planId === p.value.id)) { toast('该修订已被检验任务采用，不能删除', 'error'); return; }
      if (!(await confirmBox({ title: '删除方案草稿？', message: '只有未被采用的草稿可以删除。', ok: '删除', danger: true }))) return;
      const x = p.value; logAudit('方案', x.code + ' Rev ' + x.rev, '删除草稿'); S.plans.splice(S.plans.indexOf(x), 1); go('/plans');
    };
    const optionsFor = (it) => (it.kind === 'count' ? [['C', '计数组'], ['-', '不检']] : [['M', '计量组'], ['-', '不检']]).filter((o) => (o[0] !== 'C' || !!cg.value) && (o[0] !== 'M' || !!mg.value));
    return { p, std, editable, stepIdx, latest, stale, stdChoices, cg, mg, counts, itemsView, viewStatus, helper, sug, applySug, addCount, removeCount, toggleScene, changeStd, submit, approve, returning, returnNote, doReturn, newRev, saveTpl, retire, remove, optionsFor, sel };
  },
  template: `
<div v-if="p && std" class="space-y-5">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div>
      <button class="text-xs text-ink-3 hover:text-ink inline-flex items-center gap-1 mb-2" @click="go('/plans')"><ic name="chevron-left" :size="13"/>检验方案</button>
      <div class="flex flex-wrap items-center gap-2"><h1 class="page-title">{{ p.code }} <span class="text-brand-700">Rev {{ p.rev }}</span></h1><st k="plan" :v="p.status"/></div>
      <p class="text-xs text-ink-3 mt-1">{{ p.name }} · {{ partOf(p.partId).partNo }}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <g-btn perm="plan.edit" cls="btn-ghost" icon="layers" @click="saveTpl">另存为模板</g-btn>
      <template v-if="p.status === 'draft'"><g-btn perm="plan.edit" cls="btn-ghost" icon="trash" @click="remove">删除草稿</g-btn><g-btn perm="plan.edit" cls="btn-primary" icon="arrow-right" @click="submit">提交审核</g-btn></template>
      <template v-if="p.status === 'review'"><g-btn perm="plan.approve" cls="btn-secondary" @click="returning = true">退回</g-btn><g-btn perm="plan.approve" cls="btn-success" icon="check" :when="p.submittedBy !== S.me" why="提交人不得批准本人提交的修订" @click="approve">批准生效</g-btn></template>
      <template v-if="p.status === 'effective'"><g-btn perm="plan.approve" cls="btn-ghost" @click="retire">停用</g-btn><g-btn perm="plan.edit" cls="btn-secondary" icon="copy" @click="newRev(false)">新建修订</g-btn></template>
    </div>
  </div>
  <next-step v-bind="nextOf('plan', p)"/>
  <div v-if="stale" class="rounded-2xl bg-amber-50 text-amber-800 px-4 py-3 text-[12.5px] flex flex-wrap items-center gap-3">
    <ic name="info" :size="15"/><span class="flex-1 min-w-[240px]">零件已有新的生效标准 {{ latest.code }} Rev {{ latest.rev }}，本方案仍引用 Rev {{ std.rev }}。新标准不会自动更换方案引用，由你决定是否采用。</span>
    <g-btn perm="plan.edit" cls="btn-primary btn-sm" icon="diff" @click="newRev(true)">采用新标准版本（生成新修订）</g-btn>
  </div>
  <div v-if="p.adoptNote && p.status === 'draft'" class="rounded-2xl bg-brand-50 text-brand-800 px-4 py-3 text-[12.5px]">换版说明：{{ p.adoptNote }}。请核对下方的特性分配。</div>
  <div v-if="p.returnNote && p.status === 'draft'" class="rounded-2xl bg-amber-50 text-amber-800 px-4 py-3 text-[12.5px]">审核退回意见：{{ p.returnNote }}</div>

  <div class="grid grid-cols-1 xl:grid-cols-3 gap-5">
    <div class="card p-5 space-y-4">
      <h2 class="section-title">基本信息</h2>
      <div><label class="label">方案名称</label><input v-model="p.name" class="input" :disabled="!editable"></div>
      <div><label class="label">引用标准修订（只能选生效修订）</label>
        <select :value="p.stdId" @change="changeStd($event.target.value)" class="input" :disabled="!editable"><option v-for="s in stdChoices" :key="s.id" :value="s.id">{{ s.code }} Rev {{ s.rev }}（{{ STATUS.std[s.status][0] }}）</option></select></div>
      <div><label class="label">适用检验场景</label>
        <div class="flex flex-wrap gap-1.5"><button v-for="sc in S.scenes" :key="sc.code" type="button" @click="toggleScene(sc.code)" class="h-8 px-3 rounded-full text-xs font-medium ring-1 ring-inset transition-all duration-200" :class="[p.scenes.includes(sc.code) ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-ink-3 ring-black/10', editable ? 'hover:ring-brand-400' : 'cursor-default']">{{ sc.name }}</button></div></div>
      <div><label class="label">报告模板</label><select v-model="p.reportTplId" class="input" :disabled="!editable"><option v-for="t in S.reportTemplates" :key="t.id" :value="t.id">{{ t.name }}</option></select></div>
      <div class="rounded-xl bg-[#f7f7f9] p-3 text-[12px] text-ink-3 leading-relaxed">执行时套用所选场景的流程步骤（基础资料 › 检验场景与流程）。建单时冻结“场景定义 + 标准修订 + 方案修订”三层快照。</div>
    </div>

    <div class="card p-5 space-y-4 xl:col-span-2">
      <div class="flex items-center justify-between gap-3"><h2 class="section-title">抽样组</h2>
        <div class="flex gap-2"><button v-if="editable && !cg" class="btn-soft btn-sm" @click="addCount"><ic name="plus" :size="14"/>添加计数组</button><button v-if="editable && cg" class="btn-ghost btn-sm" @click="removeCount">移除计数组</button></div></div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div v-if="mg" class="rounded-2xl ring-1 ring-black/[0.07] p-4">
          <span class="chip-brand">计量组 · 逐值实测</span>
          <p class="text-[11.5px] text-ink-4 mt-2 leading-relaxed">逐个样本录入实测值；结论只覆盖本轮实际被检的样本与项目，不构成整批接受。</p>
          <label class="label mt-3">每轮样本量 n</label><input type="number" min="1" v-model.number="mg.n" class="input w-32" :disabled="!editable">
        </div>
        <div v-if="cg" class="rounded-2xl ring-1 ring-black/[0.07] p-4">
          <div class="flex items-center gap-2"><span class="chip-amber">计数组 · 一次抽样判批</span></div>
          <div class="grid grid-cols-3 gap-2 mt-3"><div><label class="label">样本量 n</label><input type="number" min="1" v-model.number="cg.n" class="input" :disabled="!editable"></div><div><label class="label">Ac</label><input type="number" min="0" v-model.number="cg.ac" class="input" :disabled="!editable"></div><div><label class="label">Re</label><input type="number" min="1" v-model.number="cg.re" class="input" :disabled="!editable"></div></div>
          <label class="flex items-center gap-2 mt-3 text-[12.5px]"><input type="checkbox" v-model="cg.earlyReject" :disabled="!editable" class="w-4 h-4 accent-brand-600">不良数达到 Re 时允许提前拒收（任何时候都不能提前接受）</label>
          <div v-if="editable" class="mt-3 rounded-xl bg-[#f7f7f9] p-3">
            <div class="text-[11.5px] font-medium text-ink-2 mb-2">按 GB/T 2828.1 推荐（一般检验水平 II · 正常检验 · 一次抽样，演示子集）</div>
            <div class="flex flex-wrap items-end gap-2"><div><label class="label">批量</label><input type="number" v-model="helper.lot" class="input !h-8 w-24"></div><div><label class="label">AQL</label><select v-model="helper.aql" class="input !h-8 w-24"><option v-for="a in AQL_OPTIONS" :key="a">{{ a }}</option></select></div>
              <button class="btn-secondary btn-sm" :disabled="!sug || sug.unsupported || !!sug.error" @click="applySug">填入</button></div>
            <div class="text-[12px] mt-2 leading-relaxed"><span v-if="sug.error" class="text-rose-600">{{ sug.error }}</span><span v-else-if="sug.unsupported" class="text-amber-700">字码 {{ sug.letter }}（n={{ sug.n }}）与 AQL {{ helper.aql }} 的组合需要查企业授权的抽样表，原型不推算。</span><span v-else>字码 <b>{{ sug.letter }}</b> → n=<b>{{ sug.n }}</b>，Ac <b>{{ sug.ac }}</b> / Re <b>{{ sug.re }}</b></span></div>
          </div>
        </div>
      </div>
      <p class="text-[11.5px] text-ink-4">抽样规则写在方案里，开检时继承，不能临时修改。正式使用前须导入企业授权的抽样标准版本。</p>
    </div>
  </div>

  <div class="card overflow-hidden">
    <div class="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-3"><h2 class="section-title">特性分配</h2><div class="flex gap-1.5"><span class="chip-brand">计量 {{ counts.M }}</span><span class="chip-amber">计数 {{ counts.C }}</span><span class="chip-gray">不检 {{ counts.N }}</span></div></div>
    <div class="grid grid-cols-1 xl:grid-cols-12">
      <div class="xl:col-span-5 p-3 h-[360px]"><drawing-viewer :svg="stdSvg(p.stdId) || svgOf(partOf(p.partId))" :items="itemsView" :selected="sel" :status="viewStatus" @select="sel = $event"/></div>
      <div class="xl:col-span-7 overflow-auto max-h-[380px]"><table class="tbl"><thead><tr><th>气泡</th><th>特性</th><th>规格</th><th>检具</th><th>分配到</th></tr></thead><tbody>
        <tr v-for="it in itemsView" :key="it.cid" :class="sel === it.cid ? 'bg-amber-50/70' : ''" @click="sel = it.cid">
          <td class="font-mono font-semibold">#{{ it.no }}</td><td><div class="font-medium">{{ it.name }}</div><div class="text-[11px] text-ink-4">{{ it.cat }} · {{ it.cls }}</div></td>
          <td class="font-mono text-[12px]">{{ specText(it) }}</td><td class="text-[12px] text-ink-3">{{ gaugeLabel(it.gauge) }}</td>
          <td><select v-model="p.assign[it.cid]" class="input !h-8 !w-[130px]" :disabled="!editable"><option v-for="o in optionsFor(it)" :key="o[0]" :value="o[0]">{{ o[1] }}</option></select></td>
        </tr></tbody></table></div>
    </div>
  </div>

  <div class="card p-5">
    <h2 class="section-title mb-3">执行预览：所选场景的流程步骤</h2>
    <div class="space-y-3"><div v-for="c in p.scenes" :key="c" class="flex flex-col md:flex-row md:items-center gap-2"><span class="chip w-fit shrink-0" :class="SCENE_META[c].tint">{{ sceneOf(c).name }} · v{{ sceneOf(c).ver }}</span><scene-pipeline :steps="sceneOf(c).steps" small/></div>
      <empty v-if="!p.scenes.length" icon="layers" title="还没有选择适用场景"/></div>
  </div>

  <modal :open="returning" @close="returning = false" title="退回方案" sub="退回后回到草稿，保留意见">
    <textarea v-model="returnNote" rows="4" class="textarea" placeholder="退回原因"></textarea>
    <template #footer><button class="btn-secondary" @click="returning = false">取消</button><button class="btn-primary" @click="doReturn">确认退回</button></template>
  </modal>
</div>
<empty v-else icon="clipboard" title="方案不存在或已删除"><button class="btn-secondary" @click="go('/plans')">返回列表</button></empty>`,
};

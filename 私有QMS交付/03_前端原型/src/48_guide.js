/* =====================================================================
 * 引导层：让使用者一眼知道“现在该点哪里”
 *   · 下一步提示条：每个对象页面都说清下一步做什么、该谁做；不是自己的事时可一键切换身份继续演示
 *   · 我的工作（首页）：四步主线 + 待办清单，每条待办都带一个明确的动作按钮
 *   · 生产工单：工单 → 工序 → 检验点，点一下检验点就开检（一条主线，颜色表示结果）
 *   · 新建检验向导：选零件 → 选检验点 → 确认开始
 * ===================================================================== */

/* ---------------- 下一步提示条 ---------------- */
COMPONENTS['next-step'] = {
  props: { text: String, perm: String, hint: String, done: Boolean, to: String, toLabel: String, run: Function },
  computed: {
    mine() { return !this.perm || can(this.perm); },
    roles() { return this.perm && PERMS[this.perm] ? PERMS[this.perm].roles.map((r) => ROLES[r].name).join(' / ') : ''; },
    other() { if (this.done || this.mine || !this.perm || !PERMS[this.perm]) return null; return S.users.find((u) => PERMS[this.perm].roles.includes(u.role)) || null; },
    canJump() { return (!!this.to || !!this.run) && (this.done || this.mine); },
  },
  methods: {
    swap() { if (this.other) switchUser(this.other.id); },
    jump() { if (this.run) this.run(); else if (this.to) go(this.to); },
  },
  template:
    '<div v-if="text" class="rounded-2xl px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 ring-1 ring-inset transition-colors duration-300" :class="done ? \'bg-emerald-50/70 ring-emerald-600/15\' : mine ? \'bg-brand-50/70 ring-brand-500/30\' : \'bg-white ring-black/[0.08]\'">' +
    '<span class="w-8 h-8 rounded-full flex items-center justify-center shrink-0" :class="done ? \'bg-emerald-500 text-white\' : mine ? \'bg-brand-600 text-white\' : \'bg-black/[0.06] text-ink-3\'"><ic :name="done ? \'check\' : mine ? \'arrow-right\' : \'user\'" :size="15" stroke="2.2"/></span>' +
    '<div class="flex-1 min-w-[220px]">' +
    '<div class="text-[11px] font-medium" :class="done ? \'text-emerald-700\' : mine ? \'text-brand-700\' : \'text-ink-4\'">{{ done ? \'已完成\' : mine ? \'下一步 · 该你操作\' : \'下一步 · 等待\' + roles + \'操作\' }}</div>' +
    '<div class="text-[13.5px] font-medium mt-0.5">{{ text }}</div>' +
    '<div v-if="hint && mine && !done" class="text-xs text-ink-3 mt-0.5">按钮位置：{{ hint }}</div>' +
    '</div>' +
    '<button v-if="canJump" type="button" :class="done ? \'btn-secondary btn-sm\' : \'btn-primary btn-sm\'" @click="jump">{{ toLabel || \'前往\' }}<ic name="arrow-right" :size="13"/></button>' +
    '<button v-if="other" type="button" class="btn-secondary btn-sm" @click="swap" title="演示用：切换身份后继续这一步"><avatar :uid="other.id" :size="18"/>切换为{{ other.name }}继续</button>' +
    '</div>',
};

/** 各对象在当前状态下的“下一步”：返回 next-step 组件的属性 */
function nextOf(kind, x) {
  if (!x) return {};
  if (kind === 'std') {
    if (x.status === 'draft') return { text: '核对每个特性的检具和等级，然后提交审核', perm: 'std.edit', hint: '右上角“提交审核”' };
    if (x.status === 'review') return { text: '审核后批准生效，或退回修改（提交人本人不能批准）', perm: 'std.approve', hint: '右上角“批准生效”' };
    if (x.status === 'effective') {
      const stale = S.plans.filter((p) => p.partId === x.partId && p.status !== 'retired' && p.stdId !== x.id);
      if (stale.length) return { text: '有 ' + stale.length + ' 个方案还在用旧版本，逐个决定是否采用这个新版本', perm: 'plan.edit', to: '/plans/' + stale[0].id, toLabel: '打开方案 ' + stale[0].code };
      if (!S.plans.some((p) => p.stdId === x.id && p.status !== 'retired')) return { text: '标准已生效，接下来为这个零件编制检验方案', perm: 'plan.edit', to: '/plans?tab=tpl', toLabel: '从模板生成方案' };
      return { done: true, text: '标准已生效并被方案引用，可以直接开检验' };
    }
    return { done: true, text: '这个修订已停用，只用于追溯' };
  }
  if (kind === 'plan') {
    if (x.status === 'draft') return { text: '确认适用场景、抽样组和特性分配，然后提交审核', perm: 'plan.edit', hint: '右上角“提交审核”' };
    if (x.status === 'review') return { text: '审核后批准生效，或退回修改（提交人本人不能批准）', perm: 'plan.approve', hint: '右上角“批准生效”' };
    if (x.status === 'effective') {
      const e = effectiveStd(x.partId);
      if (e && e.id !== x.stdId) return { text: '零件已有新的标准版本，决定是否采用', perm: 'plan.edit', hint: '下面黄色提示条里的“采用新标准版本”' };
      return { text: '方案已生效，可以用它开检验', perm: 'task.create', toLabel: '新建检验', run: () => { UI.newTask = { partId: x.partId, scene: x.scenes[0] }; } };
    }
    return { done: true, text: '这个方案已停用，只用于追溯' };
  }
  if (kind === 'report') {
    const res = x.content.result.overall;
    if (x.state === 'review') return { text: '核对报告内容后手写签批，或写意见退回（复核人不能是本轮签名人）', perm: 'report.review', hint: '右上角“复核签批”' };
    if (x.state === 'frozen' && x.opinions && x.opinions.length) return { text: '报告被退回：按意见处理后重新提请复核', perm: 'task.submit', hint: '右上角“重新提请复核”' };
    if (res !== 'pass' && taskOf(x.taskId) && !ncrsOfTask(x.taskId).length) return res === 'fail' ? { text: '结论是不符合：到检验任务里登记不合格并安排处置', perm: 'ncr.create', to: '/inspect/' + x.taskId, toLabel: '打开检验任务' } : { text: '证据不足：到检验任务里发起补测轮次', perm: 'task.retest', to: '/inspect/' + x.taskId, toLabel: '打开检验任务' };
    return { done: true, text: x.state === 'approved' ? '报告已批准，可以打印或导出 PDF' : '报告已冻结，可以打印或导出 PDF' };
  }
  if (kind === 'ncr') {
    const remaining = ncrRemaining(x), lines = ncrLines(x);
    if (x.status === 'registered') return { text: '确认可疑数量和不合格数量（需要时同时建立质量限制）', perm: 'ncr.scope', hint: '右上角“确认范围”' };
    if (x.status === 'scoped') return remaining > 0 || !lines.length ? { text: '添加处置行，直到数量合计等于确认不合格数量（还差 ' + remaining + ' 件）', perm: 'ncr.suggest', hint: '“范围与处置”卡片右上角的“添加处置行”' } : { text: '处置数量已经分配完，提交 MRB 评审', perm: 'ncr.suggest', hint: '右上角“提交 MRB 评审”' };
    if (x.status === 'disposing') return lines.some((d) => !d.approved) ? { text: '逐行批准或退回处置建议', perm: 'ncr.approve', hint: '处置行右侧的“批准”' } : { text: '登记每一行的实际执行结果', perm: 'ncr.execute', hint: '处置行右侧的“登记执行”' };
    if (x.status === 'verifying') {
      const task = x.taskId ? taskOf(x.taskId) : null, rework = lines.some((d) => NCR_REWORK.includes(d.action)), rts = ncrRetests(x);
      if (task && rework && !rts.some((r) => r.status === 'submitted' && r.result && r.result.overall === 'pass')) {
        if (rts.some((r) => r.status === 'active')) return { text: '完成复检并提交（结论要是“符合”才能关闭）', perm: 'task.measure', to: '/inspect/' + task.id, toLabel: '打开检验任务' };
        return { text: '返工后要复检：在原检验任务发起复检', perm: 'task.retest', hint: '“处置后复检”卡片里的“发起复检”' };
      }
      return { text: '核对处置结果，验证并关闭', perm: 'ncr.approve', hint: '右上角“验证并关闭”' };
    }
    const holds = x.holds.filter((h) => h.status === 'active').length;
    return holds ? { text: 'NCR 已关闭，但还有 ' + holds + ' 条质量限制有效，需要单独解除', perm: 'hold.release', hint: '右侧“质量限制”里的“解除这一项”' } : { done: true, text: '已验证关闭' };
  }
  if (kind === 'task') {
    const r = x.rounds[x.rounds.length - 1];
    if (!r || r.status === 'active') return {};
    const rep = S.reports.find((y) => y.taskId === x.id && y.roundId === r.id) || null;
    if (rep && rep.state === 'review') return { text: '报告 ' + rep.code + ' 等待复核签批', perm: 'report.review', to: '/reports/' + rep.id, toLabel: '打开报告' };
    const ns = ncrsOfTask(x.id), openN = ns.find((n) => n.status !== 'closed');
    if (openN) { const nx = nextOf('ncr', openN); return { text: openN.code + '：' + nx.text, perm: nx.perm, to: '/ncr/' + openN.id, toLabel: '打开 ' + openN.code }; }
    if (x.status === 'fail') return ns.length ? { text: '不合格已处置关闭；需要的话可以发起复检', perm: 'task.retest', hint: '右上角“发起复检”' } : { text: '结论是不符合：登记不合格，安排处置', perm: 'ncr.create', hint: '右上角“登记不合格”' };
    if (x.status === 'insufficient') return { text: '有读数缺失：补测要另开一个轮次', perm: 'task.retest', hint: '右上角“发起复检”' };
    if (r.result && r.result.c && r.result.c.d > 0 && !ns.length) return { text: '批接受，但发现了 ' + r.result.c.d + ' 件不良：这些不良件仍要登记处置', perm: 'ncr.create', hint: '右上角“登记不合格”' };
    return { done: true, text: '这张检验已完成' + (rep ? '，报告 ' + rep.code + (rep.state === 'approved' ? ' 已批准' : ' 已冻结') : ''), to: rep ? '/reports/' + rep.id : '', toLabel: '查看报告' };
  }
  return {};
}

/* ---------------- 生产工单：工单 → 工序 → 检验点 ---------------- */
function seedOrders() {
  const seen = {}, out = [];
  S.tasks.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).forEach((t) => {
    const wo = t.ctx && t.ctx.wo;
    if (!wo || seen[wo]) return;
    seen[wo] = true;
    out.push({ id: 'o' + (out.length + 1), wo, partId: t.partId, qty: t.lot || 200, createdAt: t.createdAt, createdBy: t.createdBy || 'u2' });
  });
  return out.reverse();
}
if (!Array.isArray(S.orders)) S.orders = seedOrders();

const ORDER_STATE = { none: ['未开始', 'chip-gray'], active: ['检验中', 'chip-blue'], pass: ['全部合格', 'chip-green'], fail: ['有不合格', 'chip-red'] };
const POINT_TEXT = { none: '开始', pending: '待检', active: '继续', pass: '合格', fail: '不合格', insufficient: '证据不足' };
const POINT_CLS = {
  none: 'bg-white text-ink-2 ring-black/15 hover:ring-brand-500 hover:text-brand-700 hover:bg-brand-50/50',
  pending: 'bg-sky-50 text-sky-700 ring-sky-600/25 hover:bg-sky-100',
  active: 'bg-sky-600 text-white ring-sky-600 hover:bg-sky-700',
  pass: 'bg-emerald-50 text-emerald-700 ring-emerald-600/25 hover:bg-emerald-100',
  fail: 'bg-rose-50 text-rose-700 ring-rose-600/30 hover:bg-rose-100',
  insufficient: 'bg-amber-50 text-amber-700 ring-amber-600/30 hover:bg-amber-100',
};
function opKeyOf(op) { return op.no + ' ' + op.name; }
/** 一张工单在工序路线上的全部检验点，以及每个检验点对应的检验任务 */
function orderPoints(o) {
  const part = partOf(o.partId), out = [];
  const ops = part.route ? part.route.ops : [];
  ops.forEach((op) => op.insp.forEach((b) => {
    const key = opKeyOf(op);
    const first = ops.find((y) => y.insp.some((z) => z.scene === b.scene));
    const tasks = S.tasks.filter((t) => t.partId === o.partId && t.ctx && t.ctx.wo === o.wo && t.scene === b.scene && (t.ctx.op ? t.ctx.op === key : !!first && first.no === op.no)).sort((a, c) => (a.createdAt < c.createdAt ? 1 : -1));
    out.push({ opNo: op.no, b, key, tasks, last: tasks[0] || null, status: tasks[0] ? tasks[0].status : 'none', hasPlan: plansFor(o.partId, b.scene).length > 0 });
  }));
  return out;
}
function orderSummary(o) {
  const pts = orderPoints(o);
  const done = pts.filter((p) => p.status === 'pass' || p.status === 'fail' || p.status === 'insufficient').length;
  const state = pts.some((p) => p.status === 'fail') ? 'fail' : pts.some((p) => p.status === 'active' || p.status === 'pending' || p.status === 'insufficient') ? 'active' : done && done === pts.length ? 'pass' : done ? 'active' : 'none';
  return { pts, done, total: pts.length, state };
}
/** 在工单的某个检验点上开检：只有一个可用方案时直接开单，否则打开向导补充信息 */
function startPoint(o, x) {
  const plans = plansFor(o.partId, x.b.scene);
  const ctx = { wo: o.wo, op: x.key };
  if (x.b.freq) ctx.freq = x.b.freq;
  const cg = plans.length === 1 ? plans[0].groups.find((g) => g.type === 'count') : null;
  if (plans.length === 1 && (!cg || o.qty >= 1)) {
    try {
      const t = createTask({ scene: x.b.scene, planId: plans[0].id, lot: cg ? String(o.qty) : '', ctx });
      toast('已开单 ' + t.code + '，开始检验', 'success');
      go('/inspect/' + t.id);
    } catch (e) { toast(e.message, 'error'); }
    return;
  }
  UI.newTask = { scene: x.b.scene, partId: o.partId, ctx, lot: o.qty || '' };
}

COMPONENTS['page-orders'] = {
  setup() {
    const q = ref(UI.route.query.wo || '');
    const rows = computed(() => {
      const k = q.value.trim().toLowerCase();
      return S.orders.filter((o) => !k || (o.wo + ' ' + partOf(o.partId).name + ' ' + partOf(o.partId).partNo).toLowerCase().includes(k)).map((o) => {
        const part = partOf(o.partId);
        return Object.assign({ o, part, ops: part.route ? part.route.ops : [] }, orderSummary(o));
      });
    });
    const ptsOf = (r, op) => r.pts.filter((p) => p.opNo === op.no);
    const clickPoint = (o, x) => {
      if (x.last) { go('/inspect/' + x.last.id); return; }
      if (!x.hasPlan) { toast('这个零件还没有适用于“' + sceneOf(x.b.scene).name + '”的生效方案，请先编制检验方案', 'warn'); return; }
      if (!can('task.create')) { toast(denyTip('task.create'), 'warn'); return; }
      startPoint(o, x);
    };
    const again = (o, x) => { if (!can('task.create')) { toast(denyTip('task.create'), 'warn'); return; } startPoint(o, x); };
    const canAgain = (x) => x.b.scene === 'IPQC' && !!x.last && x.last.status !== 'pending' && x.last.status !== 'active';
    const partsWithRoute = computed(() => S.parts.filter((p) => p.route && p.route.ops.length));
    const nw = reactive({ open: false, wo: '', partId: '', qty: '' });
    const openNew = () => { Object.assign(nw, { open: true, wo: 'WO-' + dateCode().slice(2, 6) + '-' + String(100 + (nextSeq() % 900)), partId: partsWithRoute.value[0] ? partsWithRoute.value[0].id : '', qty: '200' }); };
    const saveNew = () => {
      const wo = nw.wo.trim();
      if (!wo) { toast('请填写工单号', 'error'); return; }
      if (S.orders.some((o) => o.wo === wo)) { toast('工单号已存在', 'error'); return; }
      if (!nw.partId) { toast('请选择零件（需要先有工序路线）', 'error'); return; }
      if (!/^[1-9]\d*$/.test(String(nw.qty).trim())) { toast('计划数量须为正整数', 'error'); return; }
      S.orders.unshift({ id: 'o' + nextSeq(), wo, partId: nw.partId, qty: parseInt(nw.qty, 10), createdAt: nowISO(), createdBy: S.me });
      logAudit('生产工单', wo, '登记生产工单：' + partOf(nw.partId).name + ' × ' + nw.qty);
      nw.open = false; q.value = ''; toast('工单已登记：点工序上的检验点就能开检', 'success');
    };
    return { q, rows, ptsOf, clickPoint, again, canAgain, partsWithRoute, nw, openNew, saveNew, ORDER_STATE, POINT_TEXT, POINT_CLS };
  },
  template: `
<div class="space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div><h1 class="page-title">生产工单</h1><p class="text-xs text-ink-3 mt-1">一张工单一条工序路线。点工序上的检验点就能开检，颜色表示结果。</p></div>
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative"><ic name="search" :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"/><input v-model="q" class="input !h-[38px] pl-9 w-56" placeholder="搜索工单号 / 零件"></div>
      <g-btn perm="task.create" cls="btn-primary" icon="plus" @click="openNew">登记工单</g-btn>
    </div>
  </div>
  <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-ink-3">
    <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-white ring-1 ring-black/25"></span>还没检，点了就开始</span>
    <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-sky-500"></span>检验中，点了继续</span>
    <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>合格</span>
    <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-rose-500"></span>不合格</span>
    <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span>证据不足</span>
  </div>

  <div v-for="r in rows" :key="r.o.id" class="card p-5">
    <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
      <div class="min-w-0">
        <div class="flex items-center gap-2"><span class="font-mono font-semibold text-[15px]">{{ r.o.wo }}</span><span :class="ORDER_STATE[r.state][1]">{{ ORDER_STATE[r.state][0] }}</span></div>
        <div class="text-xs text-ink-3 mt-0.5">{{ r.part.name }} · {{ r.part.partNo }} · 计划 {{ r.o.qty }} 件</div>
      </div>
      <div class="flex items-center gap-2.5 ml-auto w-60 max-w-full">
        <div class="flex-1 h-2 rounded-full bg-black/[0.07] overflow-hidden"><div class="h-full rounded-full bg-emerald-500 transition-all duration-700 ease-apple" :style="{ width: (r.total ? r.done / r.total * 100 : 0) + '%' }"></div></div>
        <span class="text-[11.5px] tabular text-ink-3 whitespace-nowrap">已检 {{ r.done }} / {{ r.total }}</span>
      </div>
    </div>
    <div class="flex items-stretch overflow-x-auto mt-4 pb-1">
      <template v-for="(op,i) in r.ops" :key="op.no">
        <div class="shrink-0 w-[172px] rounded-2xl bg-[#f7f7f9] p-3">
          <div class="flex items-center gap-1.5"><span class="text-[10px] font-mono font-semibold text-brand-600 bg-white rounded-md px-1.5 py-0.5">{{ op.no }}</span><span class="font-medium text-[12.5px] truncate">{{ op.name }}</span></div>
          <div class="text-[11px] text-ink-4 mt-0.5 truncate">{{ op.wc || '—' }}</div>
          <div class="mt-2.5 space-y-1.5">
            <div v-for="x in ptsOf(r, op)" :key="x.b.scene" class="flex items-center gap-1">
              <button type="button" class="flex-1 min-w-0 h-8 px-2.5 rounded-lg ring-1 ring-inset text-[11.5px] font-medium flex items-center justify-between gap-1 transition-all duration-200 active:scale-[0.97]" :class="x.status === 'none' && !x.hasPlan ? 'bg-black/[0.03] text-ink-5 ring-black/[0.06]' : POINT_CLS[x.status]" @click="clickPoint(r.o, x)" :title="x.last ? x.last.code : (x.hasPlan ? '点一下开始检验' : '还没有适用的检验方案')">
                <span class="truncate">{{ sceneOf(x.b.scene).name }}{{ x.tasks.length > 1 ? ' ×' + x.tasks.length : '' }}</span>
                <span class="shrink-0 inline-flex items-center gap-0.5">{{ POINT_TEXT[x.status] }}<ic name="chevron-right" :size="11"/></span>
              </button>
              <button v-if="canAgain(x)" type="button" class="shrink-0 h-8 w-8 rounded-lg ring-1 ring-inset ring-black/15 bg-white text-ink-3 hover:text-brand-700 hover:ring-brand-500 flex items-center justify-center transition-all duration-200" @click="again(r.o, x)" title="再巡检一次"><ic name="plus" :size="13"/></button>
            </div>
            <div v-if="!ptsOf(r, op).length" class="h-8 flex items-center text-[11px] text-ink-5">无检验点</div>
          </div>
        </div>
        <div v-if="i < r.ops.length - 1" class="shrink-0 w-5 flex items-center justify-center text-ink-5"><ic name="chevron-right" :size="13"/></div>
      </template>
      <div v-if="!r.ops.length" class="text-xs text-ink-4 py-3">这个零件还没有工序路线。<button class="link" @click="go('/parts?id=' + r.part.id)">去设置</button></div>
    </div>
  </div>
  <div v-if="!rows.length" class="card"><empty icon="factory" title="没有工单" desc="登记一张生产工单，系统按零件的工序路线列出要检的检验点"><g-btn perm="task.create" cls="btn-primary btn-sm" icon="plus" @click="openNew">登记工单</g-btn></empty></div>

  <modal :open="nw.open" @close="nw.open = false" title="登记生产工单" sub="没有 ERP / MES 时在这里登记；工单号只用来把各道工序的检验串在一起" width="max-w-md">
    <div class="space-y-4">
      <div><label class="label">工单号</label><input v-model="nw.wo" class="input font-mono"></div>
      <div><label class="label">零件</label><select v-model="nw.partId" class="input"><option v-for="p in partsWithRoute" :key="p.id" :value="p.id">{{ p.partNo }} {{ p.name }}</option></select></div>
      <div><label class="label">计划数量（件）</label><input v-model.trim="nw.qty" class="input w-40" inputmode="numeric"></div>
    </div>
    <template #footer><button class="btn-secondary" @click="nw.open = false">取消</button><button class="btn-primary" @click="saveNew">登记</button></template>
  </modal>
</div>`,
};

/* ---------------- 新建检验向导：选零件 → 选检验点 → 确认开始 ---------------- */
COMPONENTS['new-inspect-wizard'] = {
  setup() {
    const w = reactive({ step: 1, partId: '', scene: '', op: '', freq: '', planId: '', lot: '', ctx: {}, assignee: '' });
    const open = computed(() => !!UI.newTask && UI.newTaskMode !== 'form');
    const part = computed(() => partOf(w.partId));
    const scene = computed(() => sceneOf(w.scene));
    const partList = computed(() => S.parts.map((p) => ({ p, scenes: S.scenes.filter((sc) => sc.enabled && plansFor(p.id, sc.code).length) })));
    const opGroups = computed(() => (part.value.route ? part.value.route.ops : []).map((op) => ({ op, pts: op.insp.map((b) => ({ b, key: opKeyOf(op), ok: !!sceneOf(b.scene).enabled && plansFor(w.partId, b.scene).length > 0 })) })));
    const hasPoints = computed(() => opGroups.value.some((g) => g.pts.length));
    const freeScenes = computed(() => S.scenes.filter((sc) => sc.enabled && plansFor(w.partId, sc.code).length));
    const plans = computed(() => (w.partId && w.scene ? plansFor(w.partId, w.scene) : []));
    const plan = computed(() => planOf(w.planId));
    const std = computed(() => (plan.value ? stdOf(plan.value.stdId) : null));
    const cg = computed(() => (plan.value ? plan.value.groups.find((g) => g.type === 'count') || null : null));
    const itemCount = computed(() => (plan.value ? Object.values(plan.value.assign).filter((a) => a !== '-').length : 0));
    const fields = computed(() => (scene.value.ctx || []).filter((k) => k !== 'op' && k !== 'freq').map((k) => Object.assign({ key: k }, CTX_FIELDS[k])));
    const people = computed(() => S.users.filter((u) => u.role === 'insp' || u.role === 'qe'));
    const subs = ['先选要检的零件', '这次检的是哪道工序、哪种检验', '确认信息后开始检验'];

    const toConfirm = () => {
      if (!plans.value.some((p) => p.id === w.planId)) w.planId = plans.value[0] ? plans.value[0].id : '';
      const keys = scene.value.ctx || [];
      if (keys.includes('supplier') && !w.ctx.supplier) w.ctx.supplier = S.suppliers[0];
      if (keys.includes('customer') && !w.ctx.customer) w.ctx.customer = S.customers.includes(part.value.customer) ? part.value.customer : S.customers[0];
      if (keys.includes('batch') && !w.ctx.batch) w.ctx.batch = dateCode() + '-' + String.fromCharCode(65 + (S.seq % 26));
      if (cg.value && !String(w.lot).trim()) w.lot = String(cg.value.lotRef || '');
      w.step = 3;
    };
    const pickPoint = (x) => { if (!x.ok) { toast('这个检验点还没有适用的生效方案，请先编制检验方案', 'warn'); return; } w.scene = x.b.scene; w.op = x.key; w.freq = x.b.freq || ''; w.planId = ''; w.lot = ''; toConfirm(); };
    const pickScene = (sc) => { w.scene = sc.code; w.op = ''; w.freq = ''; w.planId = ''; w.lot = ''; toConfirm(); };
    const pickPart = (p) => {
      w.partId = p.id; w.op = ''; w.freq = ''; w.planId = ''; w.lot = '';
      if (w.scene) {
        const pts = [];
        opGroups.value.forEach((g) => g.pts.forEach((x) => { if (x.b.scene === w.scene && x.ok) pts.push(x); }));
        if (pts.length === 1) { pickPoint(pts[0]); return; }
        if (!pts.length && plansFor(p.id, w.scene).length) { toConfirm(); return; }
      }
      w.step = 2;
    };
    watch(() => UI.newTask, (v) => {
      if (!v) return;
      const ctx = Object.assign({}, v.ctx || {});
      Object.assign(w, { step: 1, partId: v.partId || '', scene: v.scene || '', op: ctx.op || '', freq: ctx.freq || '', planId: v.planId || '', lot: v.lot ? String(v.lot) : '' });
      delete ctx.op; delete ctx.freq;
      w.ctx = ctx;
      w.assignee = me.value.role === 'insp' ? S.me : (S.users.find((u) => u.role === 'insp') || me.value).id;
      if (w.partId && w.scene && plansFor(w.partId, w.scene).length) toConfirm();
      else if (w.partId) w.step = 2;
    });
    const close = () => { UI.newTask = null; };
    const back = () => { if (w.step > 1) w.step -= 1; };
    const create = () => {
      try {
        const ctx = {};
        Object.keys(w.ctx).forEach((k) => { const v = String(w.ctx[k] == null ? '' : w.ctx[k]).trim(); if (v) ctx[k] = v; });
        if (w.op) ctx.op = w.op;
        if (w.freq) ctx.freq = w.freq;
        const t = createTask({ scene: w.scene, planId: w.planId, lot: w.lot, ctx, assignee: w.assignee });
        if (ctx.wo && !S.orders.some((o) => o.wo === ctx.wo)) S.orders.unshift({ id: 'o' + nextSeq(), wo: ctx.wo, partId: t.partId, qty: t.lot || 0, createdAt: nowISO(), createdBy: S.me });
        close();
        toast('已开单 ' + t.code + '，开始检验', 'success');
        go('/inspect/' + t.id);
      } catch (e) { toast(e.message, 'error'); }
    };
    const toForm = () => {
      const ctx = Object.assign({}, w.ctx);
      if (w.op) ctx.op = w.op;
      if (w.freq) ctx.freq = w.freq;
      UI.newTaskMode = 'form';
      UI.newTask = { scene: w.scene || 'IQC', partId: w.partId, planId: w.planId, ctx };
    };
    return { w, open, part, scene, partList, opGroups, hasPoints, freeScenes, plans, plan, std, cg, itemCount, fields, people, subs, pickPart, pickPoint, pickScene, close, back, create, toForm };
  },
  template: `
<modal :open="open" @close="close" title="新建检验" :sub="subs[w.step - 1]" width="max-w-3xl">
  <div class="mb-5"><stepper :steps="['选零件', '选检验点', '确认开始']" :current="w.step - 1"/></div>

  <div v-if="w.step === 1" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <button v-for="x in partList" :key="x.p.id" type="button" :disabled="!x.scenes.length" @click="pickPart(x.p)" class="text-left rounded-2xl p-4 ring-1 ring-inset transition-all duration-300 ease-apple" :class="x.scenes.length ? 'ring-black/[0.09] hover:ring-brand-500 hover:bg-brand-50/40 hover:-translate-y-0.5 hover:shadow-lift' : 'ring-black/[0.05] opacity-50 cursor-not-allowed'">
      <div class="flex items-center justify-between gap-2"><span class="font-semibold text-[14.5px]">{{ x.p.name }}</span><ic name="chevron-right" :size="15" class="text-ink-4"/></div>
      <div class="text-[11px] text-ink-4 font-mono mt-0.5">{{ x.p.partNo }} · {{ x.p.drawingNo }} Rev {{ x.p.drawingRev }}</div>
      <div class="flex flex-wrap gap-1 mt-2.5"><span v-for="sc in x.scenes" :key="sc.code" class="chip" :class="SCENE_META[sc.code].tint">{{ sc.name }}</span><span v-if="!x.scenes.length" class="text-[11px] text-ink-4">还没有生效的检验方案</span></div>
    </button>
  </div>

  <div v-if="w.step === 2">
    <div class="text-[13px] text-ink-3 mb-4">零件：<b class="text-ink">{{ part.name }}</b><span class="font-mono text-[11.5px] ml-2">{{ part.partNo }}</span></div>
    <template v-if="hasPoints">
      <div class="label">按工序选：点要检的检验点</div>
      <div class="flex items-stretch overflow-x-auto pb-2">
        <template v-for="(g,i) in opGroups" :key="g.op.no">
          <div class="shrink-0 w-[160px] rounded-2xl bg-[#f7f7f9] p-3">
            <div class="flex items-center gap-1.5"><span class="text-[10px] font-mono font-semibold text-brand-600 bg-white rounded-md px-1.5 py-0.5">{{ g.op.no }}</span><span class="font-medium text-[12.5px] truncate">{{ g.op.name }}</span></div>
            <div class="mt-2.5 space-y-1.5">
              <button v-for="x in g.pts" :key="x.b.scene" type="button" @click="pickPoint(x)" class="w-full h-8 px-2.5 rounded-lg ring-1 ring-inset text-[11.5px] font-medium flex items-center justify-between gap-1 transition-all duration-200 active:scale-[0.97]" :class="x.ok ? 'bg-white text-ink-2 ring-black/15 hover:ring-brand-500 hover:text-brand-700 hover:bg-brand-50/50' : 'bg-black/[0.03] text-ink-5 ring-black/[0.06]'" :title="x.ok ? '' : '还没有适用的检验方案'">
                <span class="truncate">{{ sceneOf(x.b.scene).name }}{{ x.b.freq ? ' · ' + x.b.freq : '' }}</span><ic name="chevron-right" :size="11" class="shrink-0"/>
              </button>
              <div v-if="!g.pts.length" class="h-8 flex items-center text-[11px] text-ink-5">无检验点</div>
            </div>
          </div>
          <div v-if="i < opGroups.length - 1" class="shrink-0 w-5 flex items-center justify-center text-ink-5"><ic name="chevron-right" :size="13"/></div>
        </template>
      </div>
    </template>
    <div class="label mt-4">{{ hasPoints ? '或者不挂工序，直接选检验类型' : '选检验类型' }}</div>
    <div class="flex flex-wrap gap-2">
      <button v-for="sc in freeScenes" :key="sc.code" type="button" @click="pickScene(sc)" class="h-9 px-3.5 rounded-xl ring-1 ring-inset ring-black/[0.12] bg-white text-[13px] font-medium inline-flex items-center gap-2 hover:ring-brand-500 hover:text-brand-700 transition-all duration-200 active:scale-[0.97]"><ic :name="SCENE_META[sc.code].icon" :size="15"/>{{ sc.name }}</button>
      <span v-if="!freeScenes.length" class="text-xs text-ink-4">这个零件还没有生效的检验方案。</span>
    </div>
  </div>

  <div v-if="w.step === 3" class="space-y-4">
    <div class="rounded-2xl bg-[#f7f7f9] p-4">
      <div class="flex flex-wrap items-center gap-2"><span class="font-semibold text-[14.5px]">{{ part.name }}</span><span class="chip" :class="SCENE_META[w.scene] ? SCENE_META[w.scene].tint : 'chip-gray'">{{ scene.name }}</span><span v-if="w.op" class="chip-gray">工序 {{ w.op }}</span><span v-if="w.freq" class="chip-gray">{{ w.freq }}</span></div>
      <div v-if="plan && std" class="text-xs text-ink-3 mt-2 leading-relaxed">按方案 {{ plan.code }} Rev {{ plan.rev }}（标准 {{ std.code }} Rev {{ std.rev }}）检验 {{ itemCount }} 项特性：<span v-for="g in plan.groups" :key="g.key" class="mr-2">{{ g.type === 'measure' ? '计量 ' + g.n + ' 件' : '计数抽 ' + g.n + ' 件' }}</span>。开检后依据不能再改。</div>
      <div v-else class="text-xs text-rose-600 mt-2">没有可用的检验方案，请返回上一步重新选择。</div>
    </div>
    <div v-if="plans.length > 1"><label class="label">有多个可用方案，选一个</label><select v-model="w.planId" class="input"><option v-for="p in plans" :key="p.id" :value="p.id">{{ p.code }} Rev {{ p.rev }} · {{ p.name }}</option></select></div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div v-if="cg"><label class="label">批量（件）</label><input v-model.trim="w.lot" class="input" inputmode="numeric" placeholder="整数件数"></div>
      <div v-for="fd in fields" :key="fd.key">
        <label class="label">{{ fd.label }}</label>
        <select v-if="fd.type === 'supplier'" v-model="w.ctx[fd.key]" class="input"><option v-for="s in S.suppliers" :key="s">{{ s }}</option></select>
        <select v-else-if="fd.type === 'customer'" v-model="w.ctx[fd.key]" class="input"><option v-for="s in S.customers" :key="s">{{ s }}</option></select>
        <input v-else v-model="w.ctx[fd.key]" class="input" :placeholder="fd.ph || ''">
      </div>
      <div><label class="label">检验员</label><select v-model="w.assignee" class="input"><option v-for="u in people" :key="u.id" :value="u.id">{{ u.name }}（{{ ROLES[u.role].name }}）</option></select></div>
    </div>
  </div>

  <template #footer>
    <button class="btn-ghost mr-auto" @click="toForm">用完整表单</button>
    <button v-if="w.step > 1" class="btn-secondary" @click="back">上一步</button>
    <button class="btn-secondary" @click="close">取消</button>
    <g-btn v-if="w.step === 3" perm="task.create" cls="btn-primary" icon="play" :when="!!plan" why="没有可用的检验方案" @click="create">开始检验</g-btn>
  </template>
</modal>`,
};

/* ---------------- 身份流程条：每种身份一条自己的工作流程，从左到右，每一步都能点 ----------------
 * 每一步给出：名称、一句说明、现在等着处理的数量 n、点击后去哪 to。
 * 有待办时优先打开第一件待办；没有待办时打开对应的清单页。 */
/** 一张检验任务现在卡在哪一步：new 还没开始 / measure 录数 / photo 差照片 / sign 等签名 / done 已提交 */
function taskStage(t) {
  const r = t.rounds[t.rounds.length - 1];
  if (!r || r.status === 'submitted') return 'done';
  const ev = evalRound(t, r);
  if (!ev.filled && !r.photos.length) return 'new';
  if (ev.progress < 1) return 'measure';
  if (photoViolations(t, r, ev).length) return 'photo';
  return 'sign';
}
function roleFlow(role) {
  const uid = S.me;
  const isOpen = (t) => t.status === 'pending' || t.status === 'active';
  const pick = (arr, fn, fallback) => (arr.length ? fn(arr[0]) : fallback);
  const tk = (t) => '/inspect/' + t.id, nc = (n) => '/ncr/' + n.id, sd = (s) => '/standards/' + s.id, pl = (p) => '/plans/' + p.id, rp = (r) => '/reports/' + r.id;
  const openNcr = S.ncrs.filter((n) => n.status !== 'closed');
  const returned = S.reports.filter((r) => r.state === 'frozen' && r.opinions && r.opinions.length);

  if (role === 'insp') {
    const st = { new: [], measure: [], photo: [], sign: [] };
    S.tasks.filter((t) => isOpen(t) && t.assignee === uid).forEach((t) => { const k = taskStage(t); if (st[k]) st[k].push(t); });
    const follow = S.tasks.filter((t) => t.assignee === uid && !isOpen(t) && ((t.status === 'fail' && !ncrsOfTask(t.id).length) || returned.some((r) => r.taskId === t.id)));
    return [
      { key: 'take', name: '接任务', hint: '指派给我、还没开始的检验', n: st.new.length, unit: '张', to: pick(st.new, tk, '/tasks?status=pending') },
      { key: 'measure', name: '录数据', hint: '逐项录入实测值，超差会标红', n: st.measure.length, unit: '张', to: pick(st.measure, tk, '/tasks?status=active') },
      { key: 'photo', name: '拍照取证', hint: '数据录完了，还差现场照片', n: st.photo.length, unit: '张', to: pick(st.photo, tk, '/tasks?status=active') },
      { key: 'sign', name: '签名提交', hint: '都齐了，等我手写签名', n: st.sign.length, unit: '张', to: pick(st.sign, tk, '/tasks?status=active') },
      { key: 'result', name: '看结果', hint: '不合格要登记，报告被退回要处理', n: follow.length, unit: '张', to: pick(follow, tk, '/reports') },
    ];
  }
  if (role === 'qe') {
    const sync = S.syncInbox.filter((x) => x.status === 'pending');
    const stdD = S.standards.filter((s) => s.status === 'draft');
    const planD = S.plans.filter((p) => p.status === 'draft').concat(S.plans.filter((p) => { const e = effectiveStd(p.partId); return p.status === 'effective' && !!e && e.id !== p.stdId; }));
    const ncrMine = openNcr.filter((n) => ['ncr.scope', 'ncr.suggest', 'ncr.execute', 'task.retest'].includes(nextOf('ncr', n).perm));
    return [
      { key: 'sync', name: '收气泡', hint: '气泡软件冻结后发来的同步结果', n: sync.length, unit: '条', to: '/bubble' },
      { key: 'std', name: '定标准', hint: '核对检具和等级，提交审核', n: stdD.length, unit: '份草稿', to: pick(stdD, sd, '/standards') },
      { key: 'plan', name: '编方案', hint: '抽样和特性分配；有新标准时决定是否采用', n: planD.length, unit: '份待处理', to: pick(planD, pl, '/plans') },
      { key: 'run', name: '开检验', hint: '按生产工单的工序开检，或直接新建', n: S.tasks.filter(isOpen).length, unit: '张在检', to: '/orders' },
      { key: 'ncr', name: '处置不合格', hint: '确认范围、提处置建议、登记执行、发起复检', n: ncrMine.length, unit: '张', to: pick(ncrMine, nc, '/ncr') },
      { key: 'report', name: '看报告', hint: '被退回的报告处理后重新提请复核', n: returned.length, unit: '份被退回', to: pick(returned, rp, '/reports') },
    ];
  }
  if (role === 'ql') {
    const stdR = S.standards.filter((s) => s.status === 'review'), planR = S.plans.filter((p) => p.status === 'review'), repR = S.reports.filter((r) => r.state === 'review');
    const mrb = openNcr.filter((n) => n.status === 'disposing' && n.disp.some((d) => !d.approved && !d.rejected));
    const closing = openNcr.filter((n) => n.status === 'verifying' && nextOf('ncr', n).perm === 'ncr.approve').concat(S.ncrs.filter((n) => n.status === 'closed' && n.holds.some((h) => h.status === 'active')));
    return [
      { key: 'std', name: '审标准', hint: '批准检验标准生效，或退回修改', n: stdR.length, unit: '份待审', to: pick(stdR, sd, '/standards') },
      { key: 'plan', name: '审方案', hint: '批准检验方案生效，或退回修改', n: planR.length, unit: '份待审', to: pick(planR, pl, '/plans') },
      { key: 'report', name: '复核报告', hint: '核对后手写签批，或写意见退回', n: repR.length, unit: '份待复核', to: pick(repR, rp, '/reports') },
      { key: 'mrb', name: '批准处置', hint: '逐行批准或退回不合格的处置建议', n: mrb.length, unit: '张', to: pick(mrb, nc, '/ncr') },
      { key: 'close', name: '验证关闭', hint: '验证处置结果、关闭 NCR、解除质量限制', n: closing.length, unit: '张', to: pick(closing, nc, '/ncr') },
      { key: 'data', name: '看数据', hint: '批结论趋势和不合格特性排列图', n: 0, unit: '', to: '/dashboard' },
    ];
  }
  if (role === 'pm') {
    const bad = S.orders.filter((o) => orderSummary(o).state === 'fail');
    const toCheck = openNcr.filter((n) => n.status === 'registered'), toSuggest = openNcr.filter((n) => n.status === 'scoped'), follow = openNcr.filter((n) => n.status === 'disposing' || n.status === 'verifying');
    return [
      { key: 'orders', name: '看工单', hint: '每张工单各道工序的检验结果', n: bad.length, unit: '张有不合格', to: pick(bad, (o) => '/orders?wo=' + encodeURIComponent(o.wo), '/orders') },
      { key: 'check', name: '核对不合格', hint: '新登记的不合格，核对涉及的范围', n: toCheck.length, unit: '张', to: pick(toCheck, nc, '/ncr') },
      { key: 'suggest', name: '提返工建议', hint: '范围已确认，可以提返工、返修或挑选', n: toSuggest.length, unit: '张', to: pick(toSuggest, nc, '/ncr') },
      { key: 'follow', name: '跟进处置', hint: '等待批准、执行或复检的处置', n: follow.length, unit: '张', to: pick(follow, nc, '/ncr') },
      { key: 'data', name: '看数据', hint: '批结论趋势和不合格特性排列图', n: 0, unit: '', to: '/dashboard' },
    ];
  }
  if (role === 'wh') {
    return [
      { key: 'holds', name: '看质量限制', hint: '哪些批次、工单现在不能使用或发运', n: holdsActive().length, unit: '条有效', to: '/ncr?tab=holds' },
      { key: 'check', name: '发货前核对', hint: '输入批次或工单号，查这个动作是否受限', n: 0, unit: '', to: '/ncr?tab=holds&check=1' },
      { key: 'report', name: '查报告', hint: '需要随货的检验报告', n: 0, unit: '', to: '/reports' },
    ];
  }
  return [
    { key: 'users', name: '管账号', hint: '账号、身份与权限矩阵', n: 0, unit: '', to: '/users' },
    { key: 'settings', name: '接气泡服务', hint: '内嵌地址、消息白名单和对接清单', n: UI.bubble.status === 'handshake' ? 0 : 1, unit: '项待确认', to: '/settings' },
    { key: 'audit', name: '查日志', hint: '谁在什么时候做了什么', n: 0, unit: '', to: '/audit' },
  ];
}
/** 当前页面属于流程里的哪一步（用来高亮“你在这里”） */
function flowCurrent(role, r) {
  const n = r.name, id = r.params.id;
  if (role === 'insp') {
    if (n === 'inspect') { const t = taskOf(id); if (!t) return ''; const st = taskStage(t); return st === 'done' ? 'result' : st === 'new' ? 'measure' : st; }
    if (n === 'tasks' || n === 'orders') return 'take';
    if (n === 'reports' || n === 'report' || n === 'ncrs' || n === 'ncr') return 'result';
    return '';
  }
  if (role === 'qe') return ({ bubble: 'sync', standards: 'std', standard: 'std', plans: 'plan', plan: 'plan', orders: 'run', tasks: 'run', inspect: 'run', ncrs: 'ncr', ncr: 'ncr', reports: 'report', report: 'report' })[n] || '';
  if (role === 'ql') {
    if (n === 'ncr') { const x = S.ncrs.find((y) => y.id === id); return x && (x.status === 'verifying' || x.status === 'closed') ? 'close' : 'mrb'; }
    return ({ standards: 'std', standard: 'std', plans: 'plan', plan: 'plan', reports: 'report', report: 'report', ncrs: 'mrb', dashboard: 'data' })[n] || '';
  }
  if (role === 'pm') {
    if (n === 'ncr') { const x = S.ncrs.find((y) => y.id === id); return !x ? '' : x.status === 'registered' ? 'check' : x.status === 'scoped' ? 'suggest' : 'follow'; }
    return ({ orders: 'orders', ncrs: 'check', dashboard: 'data' })[n] || '';
  }
  if (role === 'wh') return n === 'ncrs' ? (r.query.check ? 'check' : 'holds') : n === 'ncr' ? 'holds' : n === 'reports' || n === 'report' ? 'report' : '';
  return ({ users: 'users', settings: 'settings', audit: 'audit' })[n] || '';
}
const FLOW_PILL = {
  current: 'bg-brand-600 text-white ring-brand-600 shadow-[0_4px_14px_rgba(31,99,224,.3)]',
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 hover:bg-emerald-100',
  todo: 'bg-white text-ink ring-brand-500/50 hover:bg-brand-50',
  idle: 'bg-white/70 text-ink-3 ring-black/[0.08] hover:bg-white hover:text-ink',
};
const FLOW_DOT = { current: 'bg-white/25 text-white', done: 'bg-emerald-500 text-white', todo: 'bg-brand-50 text-brand-700', idle: 'bg-black/[0.05] text-ink-4' };

COMPONENTS['role-flow'] = {
  props: { mode: { type: String, default: 'bar' } },
  setup() {
    const role = computed(() => me.value.role);
    /* 流程条挂在每个页面顶部：这里出错只影响流程条本身，不拖垮页面；错误带 [QMS] 前缀，自动化测试会把它记为失败 */
    const guard = (fn, fallback) => { try { return fn(); } catch (e) { console.error('[QMS] 身份流程条计算出错', e); return fallback; } };
    const steps = computed(() => guard(() => roleFlow(role.value), []));
    const curIdx = computed(() => { const k = guard(() => flowCurrent(role.value, UI.route), ''); return steps.value.findIndex((s) => s.key === k); });
    /* 检验员在一张检验里是真正的线性流程：流程条变成这张检验的进度，当前步骤之前的都算完成 */
    const linear = computed(() => role.value === 'insp' && UI.route.name === 'inspect' && curIdx.value >= 0);
    const state = (s, i) => (i === curIdx.value ? 'current' : linear.value && i < curIdx.value ? 'done' : s.n > 0 ? 'todo' : 'idle');
    /* 这张检验当前步骤做到哪了：录了几个读数、还差几项照片 */
    const prog = computed(() => guard(() => {
      if (!linear.value) return {};
      const t = taskOf(UI.route.params.id), r = t ? t.rounds[t.rounds.length - 1] : null;
      if (!r || r.status !== 'active') return {};
      const ev = evalRound(t, r), lack = photoViolations(t, r, ev).length;
      return { measure: ev.filled + ' / ' + ev.total, photo: lack ? '差 ' + lack + ' 项' : '' };
    }, {}));
    /* 数量角标是“我名下还有几件”，在一张检验里只看这一张，不显示 */
    const badge = (s) => (!linear.value && s.n > 0 ? String(s.n) : '');
    const openStep = (s) => {
      UI.notif = false; UI.roleMenu = false;
      /* 在一张检验里点步骤：留在当前页面，定位到对应的操作 */
      if (linear.value && s.key !== 'take') { UI.flowAct = { key: s.key, at: Date.now() }; return; }
      go(s.to);
    };
    return { role, steps, curIdx, linear, state, prog, badge, openStep, FLOW_PILL, FLOW_DOT };
  },
  template: `
<div v-if="mode === 'bar'" class="no-scrollbar flex items-center h-[46px] px-3 sm:px-6 lg:px-8 mx-auto max-w-[1680px] overflow-x-auto" role="navigation" aria-label="我的工作流程">
  <span class="shrink-0 inline-flex items-center gap-1.5 text-[11.5px] text-ink-3 mr-3"><avatar :uid="S.me" :size="20"/>{{ linear ? '这张检验的进度' : ROLES[role].name + '的流程' }}</span>
  <template v-for="(s,i) in steps" :key="s.key">
    <button type="button" @click="openStep(s)" :data-step="s.key" :aria-current="state(s, i) === 'current' ? 'step' : null" :title="s.hint + (badge(s) ? '（' + s.n + ' ' + (s.unit || '项') + '）' : '')" class="shrink-0 inline-flex items-center gap-1.5 h-8 pl-1 pr-2.5 rounded-full text-[12.5px] font-medium ring-1 ring-inset transition-all duration-300 ease-apple active:scale-[0.97]" :class="FLOW_PILL[state(s, i)]">
      <span class="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold transition-colors duration-300" :class="FLOW_DOT[state(s, i)]"><ic v-if="state(s, i) === 'done'" name="check" :size="12" stroke="2.6"/><template v-else>{{ i + 1 }}</template></span>
      <span class="whitespace-nowrap">{{ s.name }}</span>
      <span v-if="state(s, i) === 'current' && prog[s.key]" class="text-[11px] font-normal tabular opacity-80 whitespace-nowrap">{{ prog[s.key] }}</span>
      <span v-if="badge(s)" class="min-w-[18px] h-[18px] px-1 rounded-full text-[10.5px] font-semibold flex items-center justify-center tabular" :class="state(s, i) === 'current' ? 'bg-white text-brand-700' : 'bg-rose-500 text-white'">{{ badge(s) }}</span>
    </button>
    <span v-if="i < steps.length - 1" class="flex-1 min-w-[10px] max-w-[28px] h-[2px] mx-0.5 rounded-full transition-colors duration-500" :class="linear && i < curIdx ? 'bg-emerald-400' : 'bg-black/10'"></span>
  </template>
</div>
<div v-else class="card p-5">
  <div class="flex flex-wrap items-center justify-between gap-2 mb-4"><h2 class="section-title">{{ ROLES[role].name }}的工作流程</h2><span class="text-xs text-ink-4">从左到右。数字是这一步现在等你处理的数量，点一下就过去</span></div>
  <div class="flex items-stretch overflow-x-auto pb-1">
    <template v-for="(s,i) in steps" :key="s.key">
      <button type="button" @click="openStep(s)" :data-step="s.key" class="flex-1 basis-0 min-w-[150px] max-w-[260px] text-left rounded-2xl p-4 ring-1 ring-inset transition-all duration-300 ease-apple hover:-translate-y-0.5 hover:shadow-lift active:scale-[0.98]" :class="s.n > 0 ? 'bg-brand-50/60 ring-brand-500/50' : 'bg-[#f7f7f9] ring-transparent hover:bg-white hover:ring-black/[0.08]'">
        <div class="flex items-center gap-2"><span class="w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-semibold shrink-0" :class="s.n > 0 ? 'bg-brand-600 text-white' : 'bg-white text-ink-3 shadow-soft'">{{ i + 1 }}</span><span class="font-semibold text-[14.5px] whitespace-nowrap">{{ s.name }}</span></div>
        <p class="text-xs text-ink-3 mt-2.5 leading-relaxed min-h-[38px]">{{ s.hint }}</p>
        <div class="flex items-end justify-between gap-2 mt-2">
          <span class="flex items-baseline gap-1 min-w-0"><template v-if="s.unit"><span class="text-[22px] font-semibold tabular leading-none" :class="s.n > 0 ? 'text-brand-700' : 'text-ink-5'">{{ s.n }}</span><span class="text-[11px] text-ink-4 truncate">{{ s.unit }}</span></template></span>
          <span class="shrink-0 inline-flex items-center gap-1 text-[12px] font-medium" :class="s.n > 0 ? 'text-brand-700' : 'text-ink-4'">{{ s.n > 0 ? '去处理' : '打开' }}<ic name="arrow-right" :size="13"/></span>
        </div>
      </button>
      <div v-if="i < steps.length - 1" class="shrink-0 w-6 flex items-center justify-center text-ink-5"><ic name="chevron-right" :size="15"/></div>
    </template>
  </div>
</div>`,
};

/* ---------------- 我的工作（首页）：身份流程 + 待办 ---------------- */
COMPONENTS['page-workbench'] = {
  setup() {
    const h0 = new Date().getHours();
    const greet = h0 < 6 ? '夜深了' : h0 < 11 ? '早上好' : h0 < 14 ? '中午好' : h0 < 18 ? '下午好' : '晚上好';
    const today = fmtDate(nowISO());
    const todos = computed(() => buildTodos());
    const kw = ref('');
    const btnOf = (t) => {
      if (t.title.indexOf('开始检验') === 0) return '开始检验';
      if (t.title.indexOf('继续检验') === 0) return '继续检验';
      if (t.title.indexOf('质量限制有效') === 0) return '查看';
      if (/审批|复核|批准|验证/.test(t.title)) return '去审批';
      return '去处理';
    };
    const find = () => {
      const k = kw.value.trim().toLowerCase();
      if (!k) return;
      const t = S.tasks.find((x) => x.code.toLowerCase() === k);
      if (t) { go('/inspect/' + t.id); return; }
      const o = S.orders.find((x) => x.wo.toLowerCase() === k) || S.orders.find((x) => x.wo.toLowerCase().includes(k));
      if (o) { go('/orders?wo=' + encodeURIComponent(o.wo)); return; }
      if (S.tasks.some((x) => (x.code + ' ' + ctxText(x)).toLowerCase().includes(k))) { go('/tasks?q=' + encodeURIComponent(kw.value.trim())); return; }
      toast('没有找到“' + kw.value.trim() + '”对应的工单、批次或检验任务', 'warn');
    };
    const recent = computed(() => S.tasks.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 5));
    return { greet, today, todos, kw, btnOf, find, recent, TONE };
  },
  template: `
<div class="space-y-6">
  <div class="flex flex-wrap items-end justify-between gap-4">
    <div>
      <p class="text-[13px] text-ink-3">{{ today }}</p>
      <h1 class="text-[28px] font-semibold tracking-tight mt-1">{{ greet }}，{{ who().name }}</h1>
      <p class="text-[13px] text-ink-3 mt-1.5">你现在是<span class="mx-1.5" :class="ROLES[who().role].chip">{{ ROLES[who().role].name }}</span>，有 <b class="text-ink">{{ todos.length }}</b> 件事等你处理。</p>
    </div>
    <form class="flex items-center gap-2" @submit.prevent="find">
      <div class="relative"><ic name="search" :size="16" class="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4"/><input v-model="kw" class="input !h-10 !pl-10 w-72 max-w-full" placeholder="输入工单号、批次号或检验单号"></div>
      <button type="submit" class="btn-secondary !h-10">查找</button>
    </form>
  </div>

  <role-flow mode="cards"/>

  <div class="card overflow-hidden">
    <div class="flex items-center justify-between px-5 pt-4 pb-3"><h2 class="section-title">等你处理</h2><span class="chip-gray">{{ todos.length }}</span></div>
    <div v-for="t in todos" :key="t.title + t.to" class="flex items-center gap-3.5 px-5 py-3.5 border-t border-black/[0.05] hover:bg-black/[0.015] transition-colors cursor-pointer" @click="go(t.to)">
      <span class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" :class="TONE[t.tone]"><ic :name="t.icon" :size="16"/></span>
      <span class="flex-1 min-w-0"><span class="block font-medium text-[13.5px] truncate">{{ t.title }}</span><span class="block text-xs text-ink-4 truncate mt-0.5">{{ t.sub }}</span></span>
      <span v-if="t.due" class="text-[11.5px] shrink-0 hidden sm:inline" :class="new Date(t.due) < new Date() ? 'text-rose-600 font-medium' : 'text-ink-4'">{{ fmtRel(t.due) }}到期</span>
      <span class="btn-primary btn-sm shrink-0">{{ btnOf(t) }}<ic name="arrow-right" :size="13"/></span>
    </div>
    <empty v-if="!todos.length" icon="check" title="现在没有等你处理的事" desc="可以新建一张检验，或者切换右上角的身份看看其他岗位的待办"><g-btn perm="task.create" cls="btn-primary btn-sm" icon="plus" @click="UI.newTask = {}">新建检验</g-btn></empty>
  </div>

  <div class="card overflow-hidden">
    <div class="flex items-center justify-between px-5 pt-4 pb-3"><h2 class="section-title">最近的检验</h2><button class="link text-xs" @click="go('/tasks')">全部检验任务</button></div>
    <div v-for="t in recent" :key="t.id" class="flex items-center gap-3 px-5 py-3 border-t border-black/[0.05] hover:bg-black/[0.015] transition-colors cursor-pointer" @click="go('/inspect/' + t.id)">
      <span class="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" :class="SCENE_META[t.scene].tint"><ic :name="SCENE_META[t.scene].icon" :size="15"/></span>
      <span class="flex-1 min-w-0"><span class="block font-mono text-[12.5px] font-medium truncate">{{ t.code }}</span><span class="block text-xs text-ink-4 truncate">{{ sceneOf(t.scene).name }} · {{ partOf(t.partId).name }}{{ ctxText(t) ? ' · ' + ctxText(t) : '' }}</span></span>
      <st k="task" :v="t.status" dot/>
      <ic name="chevron-right" :size="14" class="text-ink-5 shrink-0"/>
    </div>
  </div>
</div>`,
};

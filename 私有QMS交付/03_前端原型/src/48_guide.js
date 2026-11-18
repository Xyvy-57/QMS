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
    /* 已经办完的不再显示（状态标签已经说明了），只在还有事要做时出现 */
    '<div v-if="text && !done" class="rounded-2xl px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 ring-1 ring-inset transition-colors duration-300" :class="done ? \'bg-emerald-50/70 ring-emerald-600/15\' : mine ? \'bg-brand-50/70 ring-brand-500/30\' : \'bg-white ring-black/[0.08]\'">' +
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
    out.push({ id: 'o' + (out.length + 1), wo, partId: t.partId, qty: t.lot || 200, due: new Date(new Date(t.createdAt).getTime() + (5 + out.length * 2) * 86400e3).toISOString(), inLots: [], outLot: '', createdAt: t.createdAt, createdBy: t.createdBy || 'u4' });
  });
  return out.reverse();
}
if (!Array.isArray(S.orders)) S.orders = seedOrders();
/* 生产主线升级：补齐交期和批次；演示数据里把两批来料检验挂到阀芯的两张工单上 */
if (!S.ordersV2) {
  S.orders.forEach((o) => {
    if (!Array.isArray(o.inLots)) o.inLots = [];
    if (o.outLot == null) o.outLot = '';
    if (!o.due) o.due = new Date(new Date(o.createdAt || nowISO()).getTime() + 7 * 86400e3).toISOString();
  });
  const lotOf = (id) => { const t = S.tasks.find((x) => x.id === id); return t && t.ctx && t.ctx.batch ? t : null; };
  [['WO-2611-011', 't6'], ['WO-2611-021', 't1']].forEach(([wo, tid]) => {
    const o = S.orders.find((x) => x.wo === wo), t = lotOf(tid);
    if (o && t && t.partId === o.partId && !o.inLots.length) o.inLots = [t.ctx.batch];
  });
  S.ordersV2 = true;
}

function opKeyOf(op) { return op.no + ' ' + op.name; }
/** 一张工单在工序路线上的全部检验点，以及每个检验点对应的检验任务。
 *  任务属于这张工单：写了工单号，或者来料 / 成品批次登记在工单上（来料、完工、出货检验常按批次开单，不写工单号）；
 *  没写工序的任务算在这类检验第一次出现的工序上 */
function orderPoints(o) {
  const part = partOf(o.partId), out = [];
  const ops = part.route ? part.route.ops : [];
  const lots = (o.inLots || []).concat(o.outLot ? [o.outLot] : []);
  const mine = (t) => t.ctx.wo === o.wo || (!t.ctx.wo && !!t.ctx.batch && lots.indexOf(t.ctx.batch) >= 0);
  ops.forEach((op) => op.insp.forEach((b) => {
    const key = opKeyOf(op);
    const first = ops.find((y) => y.insp.some((z) => z.scene === b.scene));
    const tasks = S.tasks.filter((t) => t.partId === o.partId && t.ctx && t.scene === b.scene && mine(t) && (t.ctx.op ? t.ctx.op === key : !!first && first.no === op.no)).sort((a, c) => (a.createdAt < c.createdAt ? 1 : -1));
    out.push({ opNo: op.no, b, key, tasks, last: tasks[0] || null, status: tasks[0] ? tasks[0].status : 'none', hasPlan: plansFor(o.partId, b.scene).length > 0 });
  }));
  return out;
}
/** 在工单的某个检验点上开检：只有一个可用方案时直接开单，否则打开向导补充信息。
 *  extra 可带 { machine, trigger, setupId }：首件带上机台和触发原因；没带时首件取这道工序上还没做的那条首件要求 */
function startPoint(o, x, extra) {
  const plans = plansFor(o.partId, x.b.scene);
  const ctx = { wo: o.wo, op: x.key };
  if (x.b.freq) ctx.freq = x.b.freq;
  if (extra) Object.keys(extra).forEach((k) => { if (extra[k]) ctx[k] = extra[k]; });
  if (!ctx.machine && (x.b.scene === 'FIRST' || x.b.scene === 'IPQC')) {
    const reqs = faiReqs(o).filter((r) => r.key === x.key);
    /* 首件：先给还没做的机台，其次给首件不合格、要重做的机台；巡检：给首件已经合格的机台 */
    const r = x.b.scene === 'FIRST'
      ? reqs.find((y) => !y.task) || reqs.find((y) => y.state === 'blocked') || reqs[0] || null
      : reqs.find((y) => y.state === 'done') || reqs[0] || null;
    const op = opByKey(partOf(o.partId), x.key);
    if (r && r.machine) ctx.machine = r.machine;
    else if (op && machineOf(op.wc)) ctx.machine = op.wc;
    if (x.b.scene === 'FIRST' && r && !ctx.trigger) { ctx.trigger = r.trigger; if (r.ev) ctx.setupId = r.ev.id; }
  }
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

/* 工单列表：一行一张工单，只说现在到哪一步、是什么状态；点一行进工单（参照黑湖小工单的工单列表） */
COMPONENTS['page-orders'] = {
  setup() {
    const f = ref(['mine', 'active', 'blocked', 'released'].indexOf(UI.route.query.f) >= 0 ? UI.route.query.f : 'active');
    const q = ref(UI.route.query.q || UI.route.query.wo || '');
    const all = computed(() => S.orders.map(mainlineOf));
    const mineOf = (m) => m.mine.length > 0 && m.state !== 'released';
    const opts = computed(() => [
      { value: 'active', label: '在制', count: all.value.filter((m) => m.state !== 'released').length },
      { value: 'mine', label: '轮到我', count: all.value.filter(mineOf).length },
      { value: 'blocked', label: '有问题', count: all.value.filter((m) => m.state === 'blocked').length },
      { value: 'released', label: '已放行', count: all.value.filter((m) => m.state === 'released').length },
    ]);
    const rows = computed(() => {
      const k = q.value.trim().toLowerCase();
      return all.value.filter((m) => (f.value === 'mine' ? mineOf(m) : f.value === 'blocked' ? m.state === 'blocked' : f.value === 'released' ? m.state === 'released' : m.state !== 'released')
        && (!k || (m.o.wo + ' ' + (m.part.name || '') + ' ' + (m.part.partNo || '') + ' ' + (m.o.inLots || []).join(' ') + ' ' + (m.o.outLot || '')).toLowerCase().includes(k)))
        .sort((a, b) => (mineOf(b) - mineOf(a)) || ((b.state === 'blocked') - (a.state === 'blocked')) || String(a.o.due || '9').localeCompare(String(b.o.due || '9')));
    });
    const statusOf = (m) => (m.state === 'released'
      ? (m.shipHolds.length ? ['已放行 · 禁止发运，暂不能发货', 'chip-red'] : orderShipped(m.o) ? ['已发货', 'chip-violet'] : ['已放行，可以发货', 'chip-green'])
      : m.state === 'blocked' ? ['有问题', 'chip-red'] : ['进行中', 'chip-blue']);
    const nowText = (m) => (m.state === 'released' ? m.stages[m.stages.length - 1].text : '第 ' + m.current.no + ' / ' + m.stages.length + ' 步 ' + m.current.label + '：' + m.current.text);
    const overdue = (m) => !!m.o.due && !m.o.releasedAt && new Date(m.o.due) < new Date();
    return { f, q, opts, rows, statusOf, nowText, overdue, mineOf, pctText };
  },
  template: `
<div class="space-y-4">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div><h1 class="page-title">工单</h1><p class="text-xs text-ink-3 mt-1">每张工单从技术准备走到质量放行。点一行进工单，报工和检验都在里面。</p></div>
    <g-btn v-if="can('order.create')" perm="order.create" cls="btn-primary" icon="plus" @click="UI.newOrder = true">登记工单</g-btn>
  </div>
  <div class="flex flex-wrap items-center gap-2">
    <seg v-model="f" :options="opts"/>
    <div class="relative"><ic name="search" :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"/><input v-model="q" class="input !h-[38px] pl-9 w-60" placeholder="工单号 / 零件 / 批次"></div>
  </div>
  <div class="card overflow-hidden">
    <div class="overflow-x-auto"><table class="tbl">
      <thead><tr><th>工单</th><th>零件</th><th class="text-right">数量</th><th>交期</th><th>现在到哪一步</th><th>状态</th></tr></thead>
      <tbody>
        <tr v-for="m in rows" :key="m.o.id" class="row-link" :data-order="m.o.wo" @click="go('/orders/' + m.o.id)">
          <td class="whitespace-nowrap"><span class="font-mono font-semibold">{{ m.o.wo }}</span><span v-if="mineOf(m)" class="chip-amber ml-1.5">轮到你</span></td>
          <td>{{ m.part.name || '未知零件' }}</td>
          <td class="text-right tabular whitespace-nowrap">{{ m.qty.input ? m.qty.stocked + ' / ' + m.qty.input : '—' }}<span class="text-ink-4 text-[11.5px]"> · 计划 {{ m.o.qty }}</span></td>
          <td class="whitespace-nowrap" :class="overdue(m) ? 'text-rose-600 font-medium' : ''">{{ m.o.due ? fmtDate(m.o.due) : '—' }}<span v-if="m.dueSoon && !overdue(m)" class="chip-amber ml-1.5">交期临近</span></td>
          <td class="max-w-[380px] truncate text-[12.5px]" :title="nowText(m)">{{ nowText(m) }}</td>
          <td class="whitespace-nowrap"><span :class="statusOf(m)[1]">{{ statusOf(m)[0] }}</span></td>
        </tr>
      </tbody>
    </table></div>
    <empty v-if="!rows.length" icon="factory" title="没有符合条件的工单" desc="登记一张生产工单，主线就从“技术准备”开始"/>
  </div>
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
  /* 待办行：一句话说清做什么、在哪，一个按钮。id 相同的只出现一次（同一张检验单不会在两步里重复） */
  const taskSub = (t) => [sceneOf(t.scene).name, partOf(t.partId).name, ctxText(t)].filter(Boolean).join(' · ');
  const tItem = (verb, btn) => (t) => ({ id: 't' + t.id, title: verb + ' ' + t.code, sub: taskSub(t), btn, to: tk(t), due: t.due });
  const nItem = (verb) => (n) => ({ id: 'n' + n.id, title: (verb ? verb + ' ' : '') + n.code + '：' + n.title, sub: '下一步：' + (nextOf('ncr', n).text || '查看'), btn: '打开', to: nc(n), tone: 'amber' });
  const rItem = (r) => ({ id: 'r' + r.id, title: '报告被退回：' + r.code, sub: '意见：' + ((r.opinions[r.opinions.length - 1] || {}).text || ''), btn: '处理', to: rp(r), tone: 'amber' });
  const oItem = (m, s, btn, run) => ({ id: 'o' + m.o.id, title: m.o.wo + ' · ' + (s ? s.label + '：' + s.text : ''), sub: [m.part.name, m.o.qty + ' 件', m.o.due ? '交期 ' + fmtDate(m.o.due) : ''].filter(Boolean).join(' · '), btn, to: '/orders/' + m.o.id, run, tone: m.state === 'blocked' ? 'red' : 'blue' });
  const step = (key, name, hint, items, to, extra) => Object.assign({ key, name, hint, items, n: items.length, to: items.length && items[0].to ? items[0].to : to }, extra || {});

  if (role === 'insp') {
    const st = { new: [], measure: [], photo: [], sign: [] };
    S.tasks.filter((t) => isOpen(t) && t.assignee === uid).forEach((t) => { const k = taskStage(t); if (st[k]) st[k].push(t); });
    const follow = S.tasks.filter((t) => t.assignee === uid && !isOpen(t) && ((t.status === 'fail' && !ncrsOfTask(t.id).length) || returned.some((r) => r.taskId === t.id)));
    /* 现场到点：只放“该开新检验”的（首件待检、巡检到点）；已经开出来的检验单在后面几步里，各步数量加起来就是全部 */
    const floor = floorItems().filter((i) => i.urgent && floorMine(i) && !i.act.to).map((i) => ({
      id: 'f' + i.id, title: i.title + (i.machine ? ' · ' + i.machine : ''), sub: [i.wo, i.partName, i.op ? '工序 ' + i.op : ''].filter(Boolean).join(' · '), btn: i.act.label, run: () => floorAct(i), tone: i.tone === 'gray' ? 'blue' : i.tone,
    }));
    return [
      step('floor', '现场到点', '首件、巡检按紧急程度排好', floor, '/floor'),
      step('take', '接任务', '指派给我、还没开始的检验', st.new.map(tItem('开始检验', '开始')), '/tasks?status=pending'),
      step('measure', '录数据', '逐项录入实测值，超差会标红', st.measure.map(tItem('继续录数据', '继续')), '/tasks?status=active'),
      step('photo', '拍照取证', '数据录完了，还差现场照片', st.photo.map(tItem('补拍照片', '去拍照')), '/tasks?status=active'),
      step('sign', '签名提交', '都齐了，等我手写签名', st.sign.map(tItem('签名提交', '去签名')), '/tasks?status=active'),
      step('result', '看结果', '不合格要登记，报告被退回要处理', follow.map((t) => { const r = returned.find((x) => x.taskId === t.id); return r ? rItem(r) : Object.assign(tItem('登记不合格', '去登记')(t), { tone: 'red' }); }), '/reports'),
    ];
  }
  if (role === 'qe') {
    const sync = S.syncInbox.filter((x) => x.status === 'pending');
    const stdD = S.standards.filter((s) => s.status === 'draft');
    const planD = S.plans.filter((p) => p.status === 'draft').concat(S.plans.filter((p) => { const e = effectiveStd(p.partId); return p.status === 'effective' && !!e && e.id !== p.stdId; }));
    const ncrMine = openNcr.filter((n) => ['ncr.scope', 'ncr.suggest', 'ncr.execute', 'task.retest'].includes(nextOf('ncr', n).perm));
    const run = S.orders.map(mainlineOf).filter((m) => m.mine.length && m.state !== 'released');
    return [
      step('sync', '收气泡', '气泡软件冻结后发来的同步结果', sync.map((x) => ({ id: 's' + x.id, title: '气泡同步 ' + x.syncBatchId + ' 待生成标准草稿', sub: '图号 ' + x.drawingNo + ' Rev ' + x.drawingRev, btn: '处理', to: '/bubble' })), '/bubble'),
      step('std', '定标准', '核对检具和等级，提交审核', stdD.map((s) => ({ id: 'sd' + s.id, title: '核对标准草稿 ' + s.code + ' Rev ' + s.rev, sub: partOf(s.partId).name, btn: '核对', to: sd(s) })), '/standards'),
      step('plan', '编方案', '抽样和特性分配；有新标准时决定是否采用', planD.map((p) => ({ id: 'pl' + p.id, title: (p.status === 'draft' ? '完成方案草稿 ' : '有新标准版本：') + p.code, sub: p.name, btn: '打开', to: pl(p) })), '/plans'),
      step('run', '盯工单', '工单上缺标准、缺方案、该开检的地方', run.map((m) => oItem(m, m.mine[0], m.mine[0].act ? m.mine[0].act.label : '打开', () => runStageAct(m.o, m.mine[0]))), '/orders'),
      step('ncr', '处置不合格', '确认范围、提处置建议、登记执行、发起复检', ncrMine.map(nItem('')), '/ncr'),
      step('report', '看报告', '被退回的报告处理后重新提请复核', returned.map(rItem), '/reports'),
    ];
  }
  if (role === 'ql') {
    const stdR = S.standards.filter((s) => s.status === 'review'), planR = S.plans.filter((p) => p.status === 'review'), repR = S.reports.filter((r) => r.state === 'review');
    const mrb = openNcr.filter((n) => n.status === 'disposing' && n.disp.some((d) => !d.approved && !d.rejected));
    const closing = openNcr.filter((n) => n.status === 'verifying' && nextOf('ncr', n).perm === 'ncr.approve').concat(S.ncrs.filter((n) => n.status === 'closed' && n.holds.some((h) => h.status === 'active')));
    const ready = S.orders.map(mainlineOf).filter((m) => m.state !== 'released' && m.stages[m.stages.length - 1].state === 'active');
    return [
      step('std', '审标准', '批准检验标准生效，或退回修改', stdR.map((s) => ({ id: 'sd' + s.id, title: '审批标准 ' + s.code + ' Rev ' + s.rev, sub: partOf(s.partId).name, btn: '去审批', to: sd(s) })), '/standards'),
      step('plan', '审方案', '批准检验方案生效，或退回修改', planR.map((p) => ({ id: 'pl' + p.id, title: '审批方案 ' + p.code + ' Rev ' + p.rev, sub: p.name, btn: '去审批', to: pl(p) })), '/plans'),
      step('report', '复核报告', '核对后手写签批，或写意见退回', repR.map((r) => ({ id: 'r' + r.id, title: '复核报告 ' + r.code, sub: r.content.part.name + ' · ' + r.content.task.sceneName, btn: '去复核', to: rp(r) })), '/reports'),
      step('mrb', '批准处置', '逐行批准或退回不合格的处置建议', mrb.map(nItem('批准处置')), '/ncr'),
      step('close', '验证关闭', '验证处置结果、关闭 NCR、解除质量限制', closing.map(nItem('')), '/ncr'),
      step('release', '质量放行', '检验走完、不合格已关闭的工单，核对后放行', ready.map((m) => oItem(m, m.stages[m.stages.length - 1], '质量放行', () => { UI.release = m.o.id; })), '/orders'),
      step('data', '看数据', '批结论趋势和不合格特性排列图', [], '/dashboard'),
    ];
  }
  if (role === 'pm') {
    const bad = S.orders.map(mainlineOf).filter((m) => m.state === 'blocked');
    const toCheck = openNcr.filter((n) => n.status === 'registered'), toSuggest = openNcr.filter((n) => n.status === 'scoped'), follow = openNcr.filter((n) => n.status === 'disposing' || n.status === 'verifying');
    return [
      step('orders', '看工单', '哪张工单卡住了、卡在谁手上', bad.map((m) => oItem(m, m.current, '打开')), '/orders?f=blocked'),
      step('work', '报工', '在做的工单本班还没报工', workDue().map((o) => ({ id: 'w' + o.id, title: '报工 ' + o.wo, sub: partOf(o.partId).name + ' · 本班还没报工', btn: '报工', run: () => { UI.work = { orderId: o.id }; } })), '/orders'),
      step('check', '核对不合格', '新登记的不合格，核对涉及的范围', toCheck.map(nItem('')), '/ncr'),
      step('suggest', '提返工建议', '范围已确认，可以提返工、返修或挑选', toSuggest.map(nItem('')), '/ncr'),
      step('follow', '跟进处置', '等待批准、执行或复检的处置', follow.map(nItem('')), '/ncr'),
      step('data', '看数据', '批结论趋势和不合格特性排列图', [], '/dashboard'),
    ];
  }
  if (role === 'wh') {
    const ship = S.orders.filter((o) => o.releasedAt && !orderShipped(o) && !orderShipHolds(o).length);
    return [
      step('holds', '看质量限制', '哪些批次、工单现在不能使用或发运', holdsActive().map((h) => ({ id: 'h' + h.id, title: h.scopeType + ' ' + h.scopeVal + ' 禁止' + h.actions.map((a) => HOLD_ACTIONS[a]).join('、'), sub: '依据 ' + h.ncr.code + ' · ' + h.ncr.title, btn: '查看', to: '/ncr/' + h.ncr.id, tone: 'red' })), '/ncr?tab=holds'),
      step('check', '发货前核对', '输入批次或工单号，查这个动作是否受限', [], '/ncr?tab=holds&check=1'),
      step('ship', '可发货的工单', '已质量放行、还没发货、没有禁止发运的限制', ship.map((o) => ({ id: 'sh' + o.id, title: '可以发货：' + o.wo, sub: partOf(o.partId).name + (o.outLot ? ' · 成品批次 ' + o.outLot : ''), btn: '查看', to: '/orders/' + o.id, tone: 'green' })), '/orders?f=released'),
      step('report', '查报告', '需要随货的检验报告', [], '/reports'),
    ];
  }
  return [
    step('users', '管账号', '账号、身份与权限矩阵', [], '/users'),
    step('settings', '接气泡服务', '内嵌地址、消息白名单和对接清单', [], '/settings', { n: UI.bubble.status === 'handshake' ? 0 : 1 }),
    step('audit', '查日志', '谁在什么时候做了什么', [], '/audit'),
  ];
}
/** 当前身份的全部待办（首页列表、侧栏角标共用）：按流程从左到右，同一件事只出现一次 */
function myTodos() {
  const seen = new Set(), out = [];
  roleFlow(me.value.role).forEach((s) => (s.items || []).forEach((it) => { if (!seen.has(it.id)) { seen.add(it.id); out.push(Object.assign({ step: s.key, stepName: s.name }, it)); } }));
  return out;
}
/** 待办行左侧的色条 */
const TODO_BAR = { red: 'bg-rose-500', amber: 'bg-amber-400', blue: 'bg-brand-500', green: 'bg-emerald-500', gray: 'bg-black/15' };

/* ---------------- 首页：我的待办（参照黑湖小工单：进来就是一张要做的事的清单，一行一个按钮） ----------------
 * 上面一排是当前身份的工作流程（从左到右），点一步只看这一步的事；没有清单的步骤（看数据、查日志）点了直接打开对应页面。
 * 右上角：查找（工单号、批次号、检验单号、发货单号）和扫码。 */
COMPONENTS['page-workbench'] = {
  setup() {
    const h0 = new Date().getHours();
    const greet = h0 < 6 ? '夜深了' : h0 < 11 ? '早上好' : h0 < 14 ? '中午好' : h0 < 18 ? '下午好' : '晚上好';
    const steps = computed(() => roleFlow(me.value.role));
    const all = computed(() => myTodos());
    const sel = ref(UI.route.query.step || '');
    watch(() => S.me, () => { sel.value = ''; });
    const list = computed(() => (sel.value ? all.value.filter((i) => i.step === sel.value) : all.value));
    const pickStep = (s) => { if (s.items && s.items.length) { sel.value = sel.value === s.key ? '' : s.key; return; } go(s.to); };
    const doItem = (it) => { if (it.run) it.run(); else if (it.to) go(it.to); };
    const kw = ref('');
    const find = () => {
      const k = kw.value.trim();
      if (!k) return;
      const t = scanTarget(k);
      if (t) { go(t.to); return; }
      const lc = k.toLowerCase();
      if (S.orders.some((o) => o.wo.toLowerCase().includes(lc))) { go('/orders?q=' + encodeURIComponent(k)); return; }
      if (S.tasks.some((x) => (x.code + ' ' + ctxText(x)).toLowerCase().includes(lc))) { go('/tasks?q=' + encodeURIComponent(k)); return; }
      toast('没有找到“' + k + '”对应的工单、批次或检验单', 'warn');
    };
    return { greet, today: fmtDate(nowISO()), steps, all, sel, list, pickStep, doItem, kw, find, TODO_BAR };
  },
  template: `
<div class="space-y-5 max-w-4xl">
  <div class="flex flex-wrap items-end justify-between gap-4">
    <div>
      <p class="text-[13px] text-ink-3">{{ today }} · {{ greet }}，{{ who().name }}<span class="ml-1.5" :class="ROLES[who().role].chip">{{ ROLES[who().role].name }}</span></p>
      <h1 class="text-[24px] font-semibold tracking-tight mt-1">{{ all.length ? '现在有 ' + all.length + ' 件事要做' : '现在没有要做的事' }}</h1>
    </div>
    <form class="flex items-center gap-2" @submit.prevent="find">
      <div class="relative"><ic name="search" :size="16" class="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4"/><input v-model="kw" class="input !h-10 !pl-10 w-64 max-w-full" placeholder="工单号、批次号、检验单号"></div>
      <button type="submit" class="btn-secondary !h-10">查找</button>
    </form>
  </div>

  <div class="flex flex-wrap items-center gap-1.5" role="navigation" aria-label="我的工作流程">
    <button type="button" data-all class="h-8 px-3 rounded-full text-[12.5px] font-medium ring-1 ring-inset transition-colors" :class="!sel ? 'bg-ink text-white ring-ink' : 'bg-white text-ink-2 ring-black/10 hover:bg-black/[0.03]'" @click="sel = ''">全部 {{ all.length }}</button>
    <template v-for="(s,i) in steps" :key="s.key">
      <ic name="chevron-right" :size="13" class="text-ink-5"/>
      <button type="button" :data-step="s.key" :title="s.hint" class="h-8 pl-1 pr-3 rounded-full inline-flex items-center gap-1.5 text-[12.5px] font-medium ring-1 ring-inset transition-colors" :class="sel === s.key ? 'bg-brand-600 text-white ring-brand-600' : s.n ? 'bg-white text-ink ring-brand-500/40 hover:bg-brand-50' : 'bg-white/60 text-ink-4 ring-black/[0.06] hover:text-ink'" @click="pickStep(s)">
        <span class="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold" :class="sel === s.key ? 'bg-white/25' : s.n ? 'bg-brand-50 text-brand-700' : 'bg-black/[0.04]'">{{ s.n || i + 1 }}</span>{{ s.name }}
      </button>
    </template>
  </div>

  <div class="card overflow-hidden">
    <div v-for="it in list" :key="it.id" class="flex items-center gap-3 pl-3 pr-4 sm:pr-5 py-3.5 border-t border-black/[0.05] first:border-t-0" data-todo>
      <span class="w-1 self-stretch rounded-full shrink-0" :class="TODO_BAR[it.tone || 'blue']"></span>
      <div class="flex-1 min-w-0 cursor-pointer" @click="doItem(it)">
        <div class="font-medium text-[14px] truncate">{{ it.title }}</div>
        <div class="text-[12px] text-ink-3 truncate mt-0.5"><span v-if="!sel" class="text-ink-4">{{ it.stepName }} · </span>{{ it.sub }}<template v-if="it.due"> · <span :class="new Date(it.due) < new Date() ? 'text-rose-600' : ''">{{ fmtRel(it.due) }}到期</span></template></div>
      </div>
      <button type="button" class="btn-primary btn-sm shrink-0" @click="doItem(it)">{{ it.btn }}</button>
    </div>
    <empty v-if="!list.length" icon="check" :title="sel ? '这一步没有要做的事' : '现在没有要做的事'" desc="新的检验、不合格、审批会出现在这里"><button v-if="sel" type="button" class="btn-secondary btn-sm" @click="sel = ''">看全部</button><button v-else type="button" class="btn-secondary btn-sm" @click="go('/orders')">看全部工单</button></empty>
  </div>
</div>`,
};

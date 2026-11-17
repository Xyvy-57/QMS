/* =====================================================================
 * 生产现场页面
 *   · 现场看板（/floor）：按产线、机台排好的待检队列——巡检超时最急，其次是等首件的机台；机台卡片上报工、登记换型换刀
 *   · 批次追溯（/trace）：发货单 / 成品批次 / 客户 → 工单 → 来料批次 → 供应商，反过来也行；一键加质量限制
 *   · 工单流转卡（/orders/:id/card）：A4 打印，二维码扫进这张工单上“我”该做的检验
 *   · 扫码（/scan/:code、全局扫码弹窗、扫码枪）
 *   · 全局弹窗：报工（UI.work）、登记首件触发（UI.setup）、扫码（UI.scan）
 * ===================================================================== */

/* ---------------- 现场待检队列 ---------------- */
const FLOOR_TONE = { red: 'bg-rose-500', amber: 'bg-amber-400', blue: 'bg-brand-500', gray: 'bg-black/15' };
/**
 * 现场待检：每一项带 { kind, title, note, machine, line, wo, op, score, urgent, act }，按 score 从高到低排
 *   ipqc-late 巡检超时（400+）> fai 等首件（300+）> fai-fail 首件不合格（260）> 进行中的检验（180–220）> 快到点的巡检（150）> 之后的巡检
 */
function floorItems() {
  const now = Date.now(), items = [];
  const mins = (iso) => (iso ? Math.max(0, (now - new Date(iso).getTime()) / 60e3) : 0);
  S.orders.forEach((o) => {
    if (o.releasedAt) return;
    const ml = mainlineOf(o), part = ml.part;
    if (!part.id) return;
    const fs = ml.stages.find((s) => s.key === 'FIRST');
    const reqs = fs && fs.refs.reqs ? fs.refs.reqs : [];
    reqs.forEach((r) => {
      const base = { id: o.id + '|F|' + r.key + '|' + r.machine, o, wo: o.wo, partName: part.name, op: r.key, machine: r.machine, line: r.line || lineOfMachine(r.machine) || '其他' };
      const t = r.task;
      /* 等得越久越靠前，但封顶 90 分：始终排在巡检超时（400 起）后面 */
      if (!t) items.push(Object.assign(base, { kind: 'fai', tone: 'amber', urgent: true, title: faiLabel(r) + '待检', note: '首件合格前这台机台不该批量生产', since: r.at, score: 300 + Math.min(90, mins(r.at)), roles: permRoles('task.create'), act: { label: '开首件', req: r } }));
      else if (t.status === 'pending' || t.status === 'active') items.push(Object.assign(base, { kind: 'fai-open', tone: 'blue', urgent: true, title: faiLabel(r) + '检验中 ' + t.code, since: t.createdAt, score: 220, uid: t.assignee, act: { label: t.status === 'pending' ? '开始检验' : '继续检验', to: '/inspect/' + t.id } }));
      else if (r.state === 'blocked') items.push(Object.assign(base, { kind: 'fai-fail', tone: 'red', urgent: true, title: faiLabel(r) + (t.status === 'fail' ? '不合格 ' : '证据不足 ') + t.code, note: '停机处理：登记不合格或发起补测', since: lastDoneAt(t), score: 260, roles: permRoles('ncr.create'), act: { label: '打开', to: '/inspect/' + t.id } }));
    });
    const is = ml.stages.find((s) => s.key === 'IPQC');
    const fqc = ml.stages.find((s) => s.key === 'FQC');
    if (is && !(fqc && fqc.state === 'done')) {
      is.refs.points.forEach((x) => {
        const op = opByKey(part, x.key);
        if (!op || !opRunning(o, op, ml.qty)) return;
        const fr = reqs.filter((r) => r.key === x.key);
        if (fr.some((r) => r.state !== 'done')) return; /* 首件还没合格：先做首件，不排巡检 */
        const machine = fr.length ? fr[0].machine : op.wc || '';
        const base = { id: o.id + '|P|' + x.key, o, wo: o.wo, partName: part.name, op: x.key, machine, line: lineOfMachine(machine) || '其他' };
        const open = x.tasks.find((t) => t.status === 'pending' || t.status === 'active');
        if (open) { items.push(Object.assign(base, { kind: 'ipqc-open', tone: 'blue', urgent: true, title: '巡检中 ' + open.code, since: open.createdAt, score: 210, uid: open.assignee, act: { label: open.status === 'pending' ? '开始检验' : '继续检验', to: '/inspect/' + open.id } })); return; }
        /* 上次巡检不合格：先按不合格处置，复检合格后再恢复按频次巡检 */
        if (x.last && (x.last.status === 'fail' || x.last.status === 'insufficient')) {
          items.push(Object.assign(base, { kind: 'ipqc-fail', tone: 'red', urgent: true, title: '巡检' + (x.last.status === 'fail' ? '不合格 ' : '证据不足 ') + x.last.code, note: '先处置，复检合格后恢复巡检', since: lastDoneAt(x.last), score: 250, roles: permRoles('ncr.create').concat(permRoles('task.retest')), act: { label: '打开', to: '/inspect/' + x.last.id } }));
          return;
        }
        const h = freqHours(x.b.freq);
        if (!h) return;
        const firstWork = (liveWork(o).find((w) => w.op === x.key) || {}).at || '';
        const from = ipqcFrom(x, fr) || firstWork;
        if (!from) return; /* 这道工序还没开始生产 */
        const due = new Date(from).getTime() + h * 3600e3, late = due < now, soon = !late && due - now < 30 * 60e3;
        items.push(Object.assign(base, {
          kind: late ? 'ipqc-late' : 'ipqc-next', tone: late ? 'red' : soon ? 'amber' : 'gray', urgent: late || soon,
          title: late ? '巡检超时 ' + waitText(new Date(due).toISOString()) : (x.last ? '下次巡检 ' : '首次巡检 ') + fmtHM(new Date(due)),
          note: x.b.freq + (x.last ? '，上次 ' + fmtHM(new Date(from)) + ' ' + STATUS.task[x.last.status][0] : ''), due: new Date(due).toISOString(),
          score: late ? 400 + (now - due) / 60e3 : soon ? 150 : 100 - (due - now) / 3600e3, roles: permRoles('task.create'), act: { label: '去巡检', point: x, machine },
        }));
      });
    }
    /* 已经开单的来料、完工、出货检验 */
    S.tasks.filter((t) => (t.status === 'pending' || t.status === 'active') && (t.scene === 'IQC' || t.scene === 'FQC' || t.scene === 'OQC') && orderOfTask(t) === o).forEach((t) => {
      items.push({ id: o.id + '|T|' + t.id, o, wo: o.wo, partName: part.name, op: (t.ctx && t.ctx.op) || '', machine: '', line: '检验室', kind: 'task-open', tone: 'blue', urgent: false, title: sceneOf(t.scene).name + ' ' + t.code, note: ctxText(t), since: t.createdAt, score: 180, uid: t.assignee, act: { label: t.status === 'pending' ? '开始检验' : '继续检验', to: '/inspect/' + t.id } });
    });
  });
  return items.sort((a, b) => b.score - a.score);
}
/** 这一项是不是当前身份能做的：指派了人的看人，没指派的看权限 */
function floorMine(i) { return i.uid ? i.uid === S.me : (i.roles || []).indexOf(me.value.role) >= 0; }
/** 队列上的按钮 */
async function floorAct(i) {
  const a = i.act;
  if (a.to) { go(a.to); return; }
  if (!can('task.create')) { toast(denyTip('task.create'), 'warn'); return; }
  if (a.req) {
    if (!plansFor(i.o.partId, 'FIRST').length) { toast('还没有生效的首件检验方案，请先编制方案', 'warn'); return; }
    const x = orderPoints(i.o).find((p) => p.b.scene === 'FIRST' && p.key === a.req.key);
    if (x) startPoint(i.o, x, { machine: a.req.machine, trigger: a.req.trigger, setupId: a.req.ev ? a.req.ev.id : '' });
    return;
  }
  if (a.point) {
    if (!plansFor(i.o.partId, 'IPQC').length) { toast('还没有生效的过程巡检方案，请先编制方案', 'warn'); return; }
    if (!(await gateConfirm(i.o, 'IPQC', a.point))) return;
    startPoint(i.o, a.point, { machine: a.machine });
  }
}
/** 每台机台上在做的工单与工序（来自首件要求和报工），新的在前 */
function machineJobs() {
  const map = {};
  const add = (m, o, op, at) => {
    if (!m) return;
    const arr = map[m] || (map[m] = []);
    const x = arr.find((j) => j.o === o && j.op === op);
    if (x) { if ((at || '') > x.at) x.at = at || ''; } else arr.push({ o, op, at: at || '' });
  };
  S.orders.forEach((o) => {
    if (o.releasedAt) return;
    const part = partOf(o.partId);
    if (!part.id) return;
    const q = orderQty(o);
    /* 报工之后又登记了“下机”的机台，不再算在做这道工序 */
    const offAfter = (m, op, at) => (o.setups || []).some((e) => e.machine === m && e.op === op && e.trigger === '下机' && e.at >= at);
    faiReqs(o, q).forEach((r) => { const op = opByKey(part, r.key); if (op && opRunning(o, op, q)) add(r.machine, o, r.key, (r.task && r.task.createdAt) || r.at); });
    liveWork(o).forEach((w) => { const op = opByKey(part, w.op); if (w.machine && op && opRunning(o, op, q) && !offAfter(w.machine, w.op, w.at)) add(w.machine, o, w.op, w.at); });
  });
  Object.keys(map).forEach((k) => map[k].sort((a, b) => (a.at < b.at ? 1 : -1)));
  return map;
}
/** 生产主管的“报工”待办：已经开始生产、终检工序还没报完，这一班还没报过工的工单（来料、出货这类不报工的工序不算） */
function workDue() {
  const shIso = shiftAt().start.toISOString();
  return S.orders.filter((o) => {
    if (o.releasedAt) return false;
    if (!partOf(o.partId).id) return false;
    const q = orderQty(o), work = liveWork(o);
    const started = work.length > 0 || faiReqs(o, q).some((r) => r.task && r.task.status === 'pass');
    if (!started) return false;
    if (S.tasks.some((t) => t.scene === 'FQC' && t.status === 'pass' && orderOfTask(t) === o)) return false;
    const fin = q.rows.find((r) => r.key === q.fqcKey);
    if (q.input && fin && fin.processed >= fin.arriving) return false;
    return !work.some((w) => w.at >= shIso);
  });
}
/** 本班做了什么 */
function shiftStats(sh) {
  const a = sh.start.toISOString(), b = sh.end.toISOString();
  const inShift = (iso) => !!iso && iso >= a && iso < b;
  const done = S.tasks.filter((t) => t.status !== 'pending' && t.status !== 'active' && inShift(lastDoneAt(t)));
  const works = [];
  S.orders.forEach((o) => liveWork(o).forEach((w) => { if (inShift(w.at)) works.push(w); }));
  return { fai: done.filter((t) => t.scene === 'FIRST').length, ipqc: done.filter((t) => t.scene === 'IPQC').length, ncr: S.ncrs.filter((n) => inShift(n.createdAt)).length, good: sum(works.map((w) => w.good || 0)), bad: sum(works.map((w) => w.bad || 0)) };
}

COMPONENTS['page-floor'] = {
  setup() {
    const line = ref(UI.route.query.line || '');
    const onlyMine = ref(me.value.role === 'insp');
    /* 每分钟刷新一次：巡检到点、等待时长随时间变化 */
    const tick = ref(0);
    let timer = null;
    onMounted(() => { timer = setInterval(() => { tick.value++; }, 60e3); });
    onBeforeUnmount(() => clearInterval(timer));
    const sh = computed(() => { tick.value; return shiftAt(); }); // eslint-disable-line no-unused-expressions
    const all = computed(() => { tick.value; return floorItems(); }); // eslint-disable-line no-unused-expressions
    const items = computed(() => all.value.filter((i) => (!line.value || i.line === line.value) && (!onlyMine.value || floorMine(i))));
    const lines = computed(() => { const out = machineLines(); all.value.forEach((i) => { if (i.line && out.indexOf(i.line) < 0) out.push(i.line); }); return out; });
    const lineOpts = computed(() => [{ value: '', label: '全部', count: all.value.filter((i) => i.urgent).length }].concat(lines.value.map((l) => ({ value: l, label: l, count: all.value.filter((i) => i.line === l && i.urgent).length }))));
    const jobs = computed(() => { tick.value; return machineJobs(); }); // eslint-disable-line no-unused-expressions
    const machines = computed(() => (S.machines || []).filter((m) => !line.value || m.line === line.value).map((m) => {
      const its = all.value.filter((i) => i.machine === m.code);
      const js = jobs.value[m.code] || [];
      const st = its.some((i) => i.kind === 'fai-fail') ? ['首件不合格', 'chip-red'] : its.some((i) => i.kind === 'ipqc-fail') ? ['巡检不合格', 'chip-red'] : its.some((i) => i.kind === 'ipqc-late') ? ['巡检超时', 'chip-red'] : its.some((i) => i.kind === 'fai') ? ['待首件', 'chip-amber'] : its.some((i) => i.kind === 'fai-open') ? ['首件检验中', 'chip-blue'] : js.length ? ['生产中', 'chip-green'] : ['空闲', 'chip-gray'];
      const next = its.filter((i) => i.kind === 'ipqc-next').sort((a, b) => (a.due < b.due ? -1 : 1))[0] || null;
      return { m, st, jobs: js, next };
    }));
    const grouped = computed(() => {
      const g = [];
      machines.value.forEach((x) => { let e = g.find((y) => y.line === x.m.line); if (!e) { e = { line: x.m.line, list: [] }; g.push(e); } e.list.push(x); });
      return g;
    });
    const stats = computed(() => shiftStats(sh.value));
    /* 本班还没报工的工单（生产主管流程条“报工”的那几张），直接在这里报 */
    const due = computed(() => { tick.value; return workDue(); }); // eslint-disable-line no-unused-expressions
    const left = computed(() => { const ms = Math.max(0, sh.value.end.getTime() - Date.now()); const hh = Math.floor(ms / 3600e3), mm = Math.floor((ms % 3600e3) / 60e3); return (hh > 0 ? hh + ' 小时 ' : '') + mm + ' 分'; });
    const act = (i) => floorAct(i);
    const report = (x) => { const j = x.jobs[0]; UI.work = j ? { orderId: j.o.id, op: j.op, machine: x.m.code } : { machine: x.m.code }; };
    const setup = (x) => { const j = x.jobs[0]; UI.setup = j ? { orderId: j.o.id, op: j.op, machine: x.m.code } : { machine: x.m.code }; };
    const when = (i) => (i.due ? '' : i.since ? '已等 ' + waitText(i.since) : '');
    return { line, onlyMine, sh, items, lineOpts, grouped, stats, due, left, act, report, setup, when, shiftText, FLOOR_TONE };
  },
  template: `
<div class="space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="page-title">现场看板</h1>
      <p class="text-xs text-ink-3 mt-1">按产线、机台排好的待检队列：巡检超时最急，其次是等首件的机台。首件没合格的机台不该批量生产。</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <span class="chip-blue">{{ shiftText(sh) }} · 还剩 {{ left }}</span>
      <g-btn v-if="can('order.work')" perm="order.work" cls="btn-secondary" icon="edit" @click="UI.work = {}">报工</g-btn>
      <g-btn perm="order.setup" cls="btn-secondary" icon="plus" @click="UI.setup = {}">登记换型 / 换刀</g-btn>
      <button type="button" class="btn-secondary" @click="UI.scan = true"><ic name="scan" :size="15"/>扫码</button>
    </div>
  </div>
  <div class="flex flex-wrap items-center gap-3">
    <seg v-model="line" :options="lineOpts"/>
    <label class="inline-flex items-center gap-2 text-[13px] cursor-pointer select-none"><input type="checkbox" v-model="onlyMine" class="w-4 h-4 accent-brand-600">只看我能做的</label>
  </div>
  <div class="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
    <div class="xl:col-span-7 card overflow-hidden">
      <div class="px-5 pt-4 pb-3 flex items-center justify-between"><h2 class="section-title">待检队列</h2><span class="text-[11.5px] text-ink-4">{{ items.length }} 项 · 按紧急程度排序</span></div>
      <div v-for="i in items" :key="i.id" class="flex items-center gap-3 px-5 py-3 border-t border-black/[0.05]" :data-kind="i.kind">
        <span class="w-1.5 self-stretch rounded-full shrink-0" :class="FLOOR_TONE[i.tone]"></span>
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5"><span class="font-semibold text-[13.5px]" :class="i.tone === 'red' ? 'text-rose-700' : 'text-ink'">{{ i.title }}</span><span v-if="i.machine" class="chip-gray">{{ i.machine }}</span></div>
          <div class="text-[12px] text-ink-3 mt-0.5 truncate"><button type="button" class="link font-mono" @click="go('/orders/' + i.o.id)">{{ i.wo }}</button> · {{ i.partName }}<template v-if="i.op"> · 工序 {{ i.op }}</template><template v-if="i.note"> · {{ i.note }}</template><template v-if="when(i)"> · {{ when(i) }}</template></div>
        </div>
        <button type="button" class="btn-sm shrink-0" :class="i.urgent ? 'btn-primary' : 'btn-secondary'" @click="act(i)">{{ i.act.label }}<ic name="arrow-right" :size="13"/></button>
      </div>
      <empty v-if="!items.length" icon="check" :title="onlyMine ? '现在没有你要做的检验' : '现场没有待检'" desc="首件、巡检到点后会出现在这里"/>
    </div>
    <div class="xl:col-span-5 space-y-5">
      <div v-if="due.length && can('order.work')" class="card p-5" data-panel="work-due">
        <div class="flex items-center justify-between gap-2"><h2 class="section-title">本班待报工</h2><span class="text-[11.5px] text-ink-4">已经开始生产、还有工序没报完、这一班还没报过工</span></div>
        <div v-for="o in due" :key="o.id" class="flex items-center gap-3 mt-2.5 text-[13px]"><button type="button" class="link font-mono" @click="go('/orders/' + o.id)">{{ o.wo }}</button><span class="text-ink-3 truncate flex-1">{{ partOf(o.partId).name }}</span><g-btn perm="order.work" cls="btn-primary btn-xs" @click="UI.work = { orderId: o.id }">报工</g-btn></div>
      </div>
      <div class="card p-5">
        <div class="flex items-center justify-between"><h2 class="section-title">本班</h2><span class="text-[11.5px] text-ink-4">{{ shiftText(sh) }}</span></div>
        <div class="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-3">
          <div class="rounded-xl bg-[#f7f7f9] px-3 py-2"><div class="text-[11px] text-ink-4">首件完成</div><div class="text-[17px] font-semibold tabular">{{ stats.fai }}</div></div>
          <div class="rounded-xl bg-[#f7f7f9] px-3 py-2"><div class="text-[11px] text-ink-4">巡检完成</div><div class="text-[17px] font-semibold tabular">{{ stats.ipqc }}</div></div>
          <div class="rounded-xl bg-[#f7f7f9] px-3 py-2"><div class="text-[11px] text-ink-4">新不合格</div><div class="text-[17px] font-semibold tabular" :class="stats.ncr ? 'text-rose-600' : ''">{{ stats.ncr }}</div></div>
          <div class="rounded-xl bg-[#f7f7f9] px-3 py-2"><div class="text-[11px] text-ink-4">报工合格</div><div class="text-[17px] font-semibold tabular">{{ stats.good }}</div></div>
          <div class="rounded-xl bg-[#f7f7f9] px-3 py-2"><div class="text-[11px] text-ink-4">报工不良</div><div class="text-[17px] font-semibold tabular" :class="stats.bad ? 'text-rose-600' : ''">{{ stats.bad }}</div></div>
        </div>
      </div>
      <div v-for="g in grouped" :key="g.line" class="card p-5">
        <h2 class="section-title">{{ g.line }}</h2>
        <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div v-for="x in g.list" :key="x.m.code" class="rounded-2xl ring-1 ring-inset ring-black/[0.06] p-3.5" :data-machine="x.m.code">
            <div class="flex items-start justify-between gap-2"><div class="min-w-0"><div class="font-semibold text-[13.5px]">{{ x.m.code }}</div><div class="text-[11px] text-ink-4 truncate">{{ x.m.name }}</div></div><span :class="x.st[1]">{{ x.st[0] }}</span></div>
            <div class="text-[12px] text-ink-3 mt-2 min-h-[18px] truncate"><template v-if="x.jobs.length"><button type="button" class="link font-mono" @click="go('/orders/' + x.jobs[0].o.id)">{{ x.jobs[0].o.wo }}</button> · 工序 {{ x.jobs[0].op }}<span v-if="x.jobs.length > 1" class="text-ink-4">（另有 {{ x.jobs.length - 1 }} 项）</span></template><span v-else class="text-ink-5">没有在做的工单</span></div>
            <div v-if="x.next" class="text-[11.5px] text-ink-4 mt-0.5">{{ x.next.title }}</div>
            <div class="flex flex-wrap gap-1.5 mt-2.5"><g-btn perm="order.work" cls="btn-ghost btn-xs" @click="report(x)">报工</g-btn><g-btn perm="order.setup" cls="btn-ghost btn-xs" @click="setup(x)">换型 / 换刀</g-btn></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>`,
};

/* ---------------- 批次追溯 ---------------- */
COMPONENTS['page-trace'] = {
  setup() {
    const q = ref(UI.route.query.q || '');
    const cur = ref(UI.route.query.q || '');
    const tr = computed(() => (cur.value ? traceOf(cur.value) : null));
    const run = (v) => { if (typeof v === 'string') q.value = v; cur.value = String(q.value || '').trim(); };
    const examples = computed(() => {
      const out = [];
      const ship = S.tasks.find((t) => t.scene === 'OQC' && t.ctx && t.ctx.shipment && t.status === 'pass' && S.orders.some((o) => o.outLot && o.outLot === t.ctx.batch));
      if (ship) out.push({ v: ship.ctx.shipment, label: '发货单 ' + ship.ctx.shipment, hint: '客户投诉，往回查' });
      /* 往后查的示例：优先用有未关闭不合格的来料批次（来料出了问题，查它用在哪） */
      const inUse = (l) => S.orders.some((o) => !o.releasedAt && (o.inLots || []).indexOf(l.lot) >= 0);
      const lot = (S.lots || []).find((l) => inUse(l) && S.ncrs.some((n) => n.batch === l.lot && n.status !== 'closed')) || (S.lots || []).find(inUse);
      if (lot) out.push({ v: lot.lot, label: '来料批次 ' + lot.lot, hint: '来料有问题，往后查' });
      const sup = (S.lots || []).find((l) => l.supplier);
      if (sup) out.push({ v: sup.supplier, label: '供应商 ' + sup.supplier, hint: '这家的批次都用在哪' });
      return out;
    });
    const lotsInfo = computed(() => (tr.value ? tr.value.lots.map(lotInfo) : []));
    const rows = computed(() => (tr.value ? tr.value.orders.map((o) => ({ o, ml: mainlineOf(o), ships: orderShipments(o), shipped: orderShipped(o), held: orderShipHolds(o).length > 0 })) : []));
    const sibs = computed(() => (tr.value ? (tr.value.siblings || []).map((o) => ({ o, ml: mainlineOf(o), shipped: orderShipped(o) })) : []));
    const usedBy = (lot) => S.orders.filter((o) => (o.inLots || []).indexOf(lot) >= 0).map((o) => o.wo).join('、');
    const summary = computed(() => {
      const t = tr.value;
      if (!t || t.kind === 'none') return '';
      const sups = lotsInfo.value.map((l) => l.supplier).filter((x, i, a) => x && a.indexOf(x) === i);
      if (t.direction === 'back') return '从' + t.kind + ' ' + t.q + ' 往回查：' + rows.value.length + ' 张工单 → ' + t.lots.length + ' 个来料批次 → ' + (sups.length ? sups.join('、') : '供应商未登记') + (sibs.value.length ? '。同批来料还用在 ' + sibs.value.length + ' 张工单，一起评估。' : '');
      if (t.direction === 'forward') return '从' + t.kind + ' ' + t.q + ' 往后查：用在 ' + rows.value.length + ' 张工单，其中 ' + rows.value.filter((r) => !r.o.releasedAt).length + ' 张在制、' + rows.value.filter((r) => r.shipped).length + ' 张已发货。';
      return t.kind + ' ' + t.q + '：投入 ' + t.lots.length + ' 个来料批次' + (rows.value[0] && rows.value[0].o.outLot ? '，成品批次 ' + rows.value[0].o.outLot : '');
    });
    const scopes = computed(() => traceHoldScopes(tr.value));
    const hd = reactive({ open: false, list: [], why: '' });
    const openHold = () => { hd.list = scopes.value.map((s) => Object.assign({}, s)); hd.why = ''; hd.open = true; };
    const saveHold = () => {
      try {
        const n = traceHold(tr.value, hd.list.filter((s) => s.on), hd.why);
        hd.open = false;
        toast('已登记 ' + n.code + '，建立 ' + n.holds.length + ' 条质量限制', 'success');
        go('/ncr/' + n.id);
      } catch (e) { toast(e.message, 'error'); }
    };
    return { q, cur, tr, run, examples, lotsInfo, rows, sibs, usedBy, summary, scopes, hd, openHold, saveHold, ORDER_ML_STATE, pctText, yieldTone };
  },
  template: `
<div class="space-y-5">
  <div><h1 class="page-title">批次追溯</h1><p class="text-xs text-ink-3 mt-1">客户投诉：输入发货单号或成品批次，往回查到工单、来料批次和供应商。来料有问题：输入来料批次，往后查到用了它的工单和发出去的货，一键加质量限制。</p></div>
  <form class="flex flex-wrap items-center gap-2" @submit.prevent="run()">
    <div class="relative"><ic name="search" :size="16" class="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4"/><input v-model="q" class="input !h-10 !pl-10 w-80 max-w-full font-mono" placeholder="发货单 / 成品批次 / 客户 / 工单 / 来料批次 / 供应商"></div>
    <button type="submit" class="btn-primary !h-10">追溯</button>
    <button v-for="e in examples" :key="e.v" type="button" class="chip-gray hover:bg-black/[0.08] transition-colors" :title="e.hint" @click="run(e.v)">{{ e.label }}</button>
  </form>

  <div v-if="tr && tr.kind === 'none'" class="card"><empty icon="search" :title="'没有找到“' + tr.q + '”'" desc="可以输入发货单号、成品批次、客户名、工单号、来料批次、收货单号、供应商名或检验单号"/></div>

  <template v-if="tr && tr.kind !== 'none'">
    <div class="rounded-2xl bg-brand-50/70 ring-1 ring-inset ring-brand-500/20 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span class="chip-blue">{{ tr.direction === 'back' ? '往回查' : tr.direction === 'forward' ? '往后查' : '前后都查' }}</span>
      <span class="text-[13px] flex-1 min-w-[240px]">{{ summary }}</span>
      <g-btn v-if="scopes.length" perm="hold.create" cls="btn-danger btn-sm" icon="lock" @click="openHold">一键加质量限制</g-btn>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
      <div class="card p-4 space-y-3">
        <div class="flex items-center gap-2"><span class="w-6 h-6 rounded-lg bg-sky-50 text-sky-700 flex items-center justify-center"><ic name="inbox" :size="13"/></span><span class="section-title !text-[14px]">来料批次 · 供应商</span></div>
        <div v-for="l in lotsInfo" :key="l.lot" class="rounded-xl ring-1 ring-inset ring-black/[0.06] p-3">
          <div class="flex items-center justify-between gap-2"><span class="font-mono font-semibold text-[13px]">{{ l.lot }}</span><span v-if="l.holds.length" class="chip-red"><ic name="lock" :size="11"/>已限制</span></div>
          <div class="text-[12px] text-ink-3 mt-1">{{ l.item || '物料' }} · <b class="font-medium text-ink-2">{{ l.supplier || '供应商未登记' }}</b><template v-if="l.receipt"> · 收货单 <span class="font-mono">{{ l.receipt }}</span></template></div>
          <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]"><template v-if="l.iqc.length"><span class="text-ink-4">来料检验</span><button v-for="t in l.iqc" :key="t.id" type="button" class="link font-mono" @click="go('/inspect/' + t.id)">{{ t.code }}</button><st k="task" :v="l.iqc[0].status" dot/></template><span v-else class="text-amber-700">没有来料检验记录</span></div>
          <div v-if="l.ncrs.length" class="mt-1 text-[12px]"><span class="text-ink-4 mr-1">不合格</span><button v-for="n in l.ncrs" :key="n.id" type="button" class="link font-mono mr-2" @click="go('/ncr/' + n.id)">{{ n.code }}</button></div>
          <div class="text-[11.5px] text-ink-4 mt-1">用在 {{ usedBy(l.lot) || '—' }}</div>
        </div>
        <div v-if="!lotsInfo.length" class="text-[12px] text-ink-4">工单上没有登记投入的物料批次</div>
      </div>

      <div class="card p-4 space-y-3">
        <div class="flex items-center gap-2"><span class="w-6 h-6 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center"><ic name="factory" :size="13"/></span><span class="section-title !text-[14px]">生产工单</span></div>
        <div v-for="r in rows" :key="r.o.id" class="rounded-xl ring-1 ring-inset ring-black/[0.06] p-3">
          <div class="flex items-center justify-between gap-2"><button type="button" class="link font-mono font-semibold" @click="go('/orders/' + r.o.id)">{{ r.o.wo }}</button><span :class="ORDER_ML_STATE[r.ml.state][1]">{{ ORDER_ML_STATE[r.ml.state][0] }}</span></div>
          <div class="text-[12px] text-ink-3 mt-1">{{ r.ml.part.name }} · 投产 {{ r.o.qtyIn || '—' }} / 计划 {{ r.o.qty }} 件 · 直通率 <b :class="yieldTone(r.ml.qty.rty)">{{ pctText(r.ml.qty.rty) }}</b></div>
          <div v-if="r.ml.state !== 'released' && r.ml.current" class="text-[11.5px] text-ink-4 mt-1 truncate">当前：{{ r.ml.current.label }} · {{ r.ml.current.text }}</div>
          <div v-if="r.ml.holds.length" class="mt-1"><span class="chip-red"><ic name="lock" :size="11"/>{{ r.ml.holds.length }} 条质量限制</span></div>
        </div>
        <div v-if="!rows.length" class="text-[12px] text-ink-4">没有工单用到</div>
        <template v-if="sibs.length">
          <div class="label !mt-4">同批来料还用在</div>
          <div v-for="r in sibs" :key="'s' + r.o.id" class="flex items-center justify-between gap-2 text-[12.5px]"><button type="button" class="link font-mono" @click="go('/orders/' + r.o.id)">{{ r.o.wo }}</button><span :class="ORDER_ML_STATE[r.ml.state][1]">{{ r.shipped ? '已发货' : ORDER_ML_STATE[r.ml.state][0] }}</span></div>
        </template>
      </div>

      <div class="card p-4 space-y-3">
        <div class="flex items-center gap-2"><span class="w-6 h-6 rounded-lg bg-rose-50 text-rose-700 flex items-center justify-center"><ic name="truck" :size="13"/></span><span class="section-title !text-[14px]">成品批次 · 出货</span></div>
        <div v-for="r in rows" :key="'out' + r.o.id" class="rounded-xl ring-1 ring-inset ring-black/[0.06] p-3">
          <div class="flex items-center justify-between gap-2"><span class="font-mono font-semibold text-[13px]">{{ r.o.outLot || '成品批次未登记' }}</span><span class="flex items-center gap-1"><span v-if="r.held" class="chip-red"><ic name="lock" :size="11"/>禁止发运</span><span :class="r.shipped ? 'chip-violet' : r.o.releasedAt ? 'chip-green' : 'chip-gray'">{{ r.shipped ? '已发货' : r.o.releasedAt ? '已放行未发货' : '未放行' }}</span></span></div>
          <div class="text-[11.5px] text-ink-4 mt-0.5">{{ r.o.wo }}</div>
          <div v-for="t in r.ships" :key="t.id" class="text-[12px] text-ink-3 mt-1"><button type="button" class="link font-mono" @click="go('/inspect/' + t.id)">{{ t.code }}</button> · {{ t.ctx.customer || '客户' }}<template v-if="t.ctx.shipment"> · 发货单 <span class="font-mono">{{ t.ctx.shipment }}</span></template> · <st k="task" :v="t.status"/></div>
          <div v-if="!r.ships.length" class="text-[12px] text-ink-4 mt-1">还没有出货检验</div>
        </div>
      </div>
    </div>
  </template>

  <modal :open="hd.open" @close="hd.open = false" title="一键加质量限制" sub="质量限制要挂在不合格单上：会先登记一张 NCR，再把勾选的范围逐条建立限制。已经有同样限制的范围不重复列出；已经发出去的货限制不了，要另行通知客户" width="max-w-lg">
    <div class="space-y-2">
      <label v-for="s in hd.list" :key="s.key" class="flex items-start gap-2.5 rounded-xl ring-1 ring-inset ring-black/[0.06] px-3 py-2.5 cursor-pointer" :class="s.on ? 'bg-rose-50/60' : ''">
        <input type="checkbox" v-model="s.on" class="w-4 h-4 mt-0.5 accent-rose-600">
        <span class="text-[13px]"><span class="font-medium">{{ s.label }}</span><span class="block text-[12px] text-ink-3 mt-0.5"><span v-for="a in s.actions" :key="a" class="chip-red mr-1">禁止{{ HOLD_ACTIONS[a] }}</span></span></span>
      </label>
    </div>
    <label class="label mt-4">原因（可空）</label>
    <input v-model="hd.why" class="input" placeholder="例如：客户投诉刃口崩刃，怀疑来料硬度不足">
    <template #footer><button class="btn-secondary" @click="hd.open = false">取消</button><g-btn perm="hold.create" cls="btn-danger" icon="lock" :when="hd.list.some(s => s.on)" why="至少勾选一个范围" @click="saveHold">登记并限制</g-btn></template>
  </modal>
</div>`,
};

/* ---------------- 工单流转卡（A4 打印） ---------------- */
COMPONENTS['page-traveler'] = {
  setup() {
    const o = computed(() => S.orders.find((x) => x.id === UI.route.params.id || x.wo === UI.route.params.id) || null);
    const part = computed(() => (o.value ? partOf(o.value.partId) : {}));
    const url = computed(() => (o.value ? scanUrl(o.value.wo) : ''));
    const local = computed(() => scanBaseLocal());
    const ops = computed(() => opsOf(part.value));
    const qc = (op) => op.insp.map((b) => (ML_SCENE[b.scene] || sceneOf(b.scene).name) + (b.freq ? '（' + b.freq + '）' : '') + (b.note ? '（' + b.note + '）' : '')).join('、') || '—';
    const print = () => window.print();
    const printedAt = fmtTime(nowISO());
    return { o, part, url, local, ops, qc, print, printedAt };
  },
  template: `
<div v-if="o" class="space-y-4">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <button class="text-xs text-ink-3 hover:text-ink inline-flex items-center gap-1 mb-2" @click="go('/orders/' + o.id)"><ic name="chevron-left" :size="13"/>{{ o.wo }}</button>
      <h1 class="page-title">工单流转卡</h1>
      <p class="text-xs text-ink-3 mt-1">随工件流转。检验员用平板或手机扫右上角的二维码，直接进到这张工单上自己要做的检验；扫码枪扫工单号也可以。</p>
    </div>
    <button type="button" class="btn-primary" @click="print"><ic name="printer" :size="15"/>打印流转卡</button>
  </div>
  <div v-if="local" class="rounded-2xl bg-amber-50 ring-1 ring-inset ring-amber-500/25 px-4 py-3 text-[12.5px] text-amber-900 leading-relaxed">
    二维码里的地址是 <span class="font-mono break-all">{{ url }}</span>，只有这台电脑自己能打开。要让平板、手机扫码：气泡服务用 <span class="font-mono">node server.mjs --host 0.0.0.0</span> 启动（终端会显示局域网地址），再到“集成设置 › 生产现场”填写扫码地址。
    原型的演示数据保存在各自设备的浏览器里，平板上看到的是平板自己的演示数据；正式系统数据在服务器上，扫码后看到的是同一份。
  </div>
  <div class="overflow-x-auto pb-2"><div class="print-area"><div class="a4">
    <div class="flex items-start justify-between gap-6">
      <div class="min-w-0">
        <div class="text-[12px] text-zinc-500">{{ S.settings.company }}</div>
        <div class="text-[22px] font-bold tracking-tight mt-1">生产工单流转卡</div>
        <div class="font-mono text-[28px] font-bold mt-2 leading-none">{{ o.wo }}</div>
        <div class="text-[12px] text-zinc-500 mt-2">{{ part.partNo }} · {{ part.name }}</div>
      </div>
      <div class="text-center shrink-0"><qr-code :text="url" :size="124"/><div class="text-[10px] text-zinc-500 mt-1">扫码进入当前检验</div></div>
    </div>
    <table class="mt-5">
      <tbody>
        <tr><th style="width:96px">零件号</th><td>{{ part.partNo }}</td><th style="width:96px">名称</th><td>{{ part.name }}</td></tr>
        <tr><th>图号 / 版本</th><td>{{ part.drawingNo }} Rev {{ part.drawingRev }}</td><th>材料</th><td>{{ part.material }}</td></tr>
        <tr><th>客户</th><td>{{ part.customer }}</td><th>计划数量</th><td>{{ o.qty }} 件</td></tr>
        <tr><th>交期</th><td>{{ fmtDate(o.due) }}</td><th>投入物料批次</th><td class="font-mono">{{ (o.inLots || []).join('、') || '—' }}</td></tr>
      </tbody>
    </table>
    <table class="mt-4">
      <thead><tr><th style="width:48px">工序</th><th>工序名称</th><th>机台 / 工作中心</th><th>质量控制点</th><th style="width:56px">合格数</th><th style="width:56px">不良数</th><th style="width:60px">操作者</th><th style="width:60px">日期</th><th style="width:60px">检验员</th></tr></thead>
      <tbody><tr v-for="op in ops" :key="op.no"><td class="font-mono">{{ op.no }}</td><td>{{ op.name }}</td><td>{{ op.wc }}</td><td>{{ qc(op) }}</td><td></td><td></td><td></td><td></td><td></td></tr></tbody>
    </table>
    <div class="mt-4 text-[11px] text-zinc-600 leading-relaxed">
      <div>1. 每道工序完工后在系统里报工（合格数、不良数），本卡手写留底。</div>
      <div>2. 开工、开班、换型、换刀、修机后要做首件，首件合格前不得批量生产。</div>
      <div>3. 不合格品隔离标识，等待处置，不得混入合格品。</div>
    </div>
    <div class="mt-6 flex items-center justify-between gap-4 text-[10.5px] text-zinc-400"><span class="truncate">二维码内容：{{ url }}</span><span class="shrink-0">打印于 {{ printedAt }} · Worlder QMS</span></div>
  </div></div></div>
</div>
<empty v-else icon="factory" title="工单不存在"><button class="btn-secondary" @click="go('/workbench')">回到生产主线</button></empty>`,
};

/* ---------------- 扫码 ---------------- */
COMPONENTS['page-scan'] = {
  setup() {
    const code = computed(() => UI.route.params.code || '');
    const target = computed(() => scanTarget(code.value));
    /* 打开后马上替换成目标页面（替换历史记录，返回键不会又回到扫码页） */
    onMounted(() => { if (target.value) { toast('扫码：' + target.value.label, 'success'); location.replace('#' + target.value.to); } });
    return { code, target };
  },
  template: `
<div class="card max-w-xl mx-auto"><empty :icon="target ? 'check' : 'alert'" :title="target ? '正在打开' + target.label : '没有找到“' + code + '”'" :desc="target ? '' : '可以是工单号、检验单号、NCR 编号、报告编号或批次号'"><button type="button" class="btn-secondary" @click="UI.scan = true"><ic name="scan" :size="15"/>重新扫码</button></empty></div>`,
};

COMPONENTS['scan-modal'] = {
  setup() {
    const code = ref(''), err = ref('');
    const cam = reactive({ on: false, starting: false, msg: '' });
    const video = ref(null);
    const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window && typeof navigator !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    let stream = null, timer = null, det = null;
    const open = computed(() => !!UI.scan);
    const stopCam = () => { cam.on = false; clearTimeout(timer); if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
    watch(open, (v) => {
      if (!v) { stopCam(); return; }
      code.value = typeof UI.scan === 'string' ? UI.scan : ''; err.value = ''; cam.msg = '';
      nextTick(() => { const el = document.getElementById('scan-input'); if (el) el.focus(); });
    });
    const close = () => { UI.scan = false; };
    const submit = () => {
      const t = scanTarget(code.value);
      if (!t) { err.value = String(code.value || '').trim() ? '没有找到“' + String(code.value).trim() + '”对应的工单、检验单、NCR、报告或批次' : '请扫码或输入编号'; return; }
      close(); toast('扫码：' + t.label, 'success'); go(t.to);
    };
    const loop = async () => {
      if (!cam.on || !video.value) return;
      try { const r = await det.detect(video.value); if (r && r.length) { code.value = r[0].rawValue; stopCam(); submit(); return; } } catch (e) { /* 这一帧没识别出来，继续 */ }
      timer = setTimeout(loop, 250);
    };
    /* 摄像头正在打开时（等授权、等出画面）再点不重复打开；打开到一半弹窗被关了，就把这一路摄像头关掉 */
    const startCam = async () => {
      if (cam.on || cam.starting) return;
      cam.starting = true; cam.msg = '';
      try {
        det = new window.BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39'] });
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!open.value) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        cam.on = true;
        await nextTick();
        video.value.srcObject = stream;
        await video.value.play();
        loop();
      } catch (e) { stopCam(); cam.msg = '打不开摄像头：' + ((e && e.message) || e) + '（浏览器只在 https 或 localhost 下允许使用摄像头）'; }
      finally { cam.starting = false; }
    };
    onBeforeUnmount(stopCam);
    return { code, err, cam, video, supported, open, close, submit, startCam, stopCam };
  },
  template: `
<modal :open="open" @close="close" title="扫码" sub="扫流转卡上的二维码，或用扫码枪扫工单号、检验单号、批次号" width="max-w-md">
  <form class="space-y-3" @submit.prevent="submit">
    <div class="relative"><ic name="scan" :size="16" class="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4"/><input id="scan-input" v-model="code" class="input !h-11 !pl-10 font-mono" placeholder="扫码枪对准这里扫，或手动输入编号" autocomplete="off"></div>
    <p v-if="err" class="text-[12.5px] text-rose-600">{{ err }}</p>
    <div v-if="supported">
      <button v-if="!cam.on" type="button" class="btn-secondary w-full" :disabled="cam.starting" @click="startCam"><ic name="camera" :size="15"/>{{ cam.starting ? '正在打开摄像头…' : '用摄像头扫' }}</button>
      <div v-show="cam.on" class="rounded-2xl overflow-hidden bg-black aspect-video relative"><video ref="video" class="w-full h-full object-cover" muted playsinline></video><button type="button" class="absolute top-2 right-2 btn-secondary btn-xs" @click="stopCam">关闭摄像头</button></div>
    </div>
    <p v-if="cam.msg" class="text-[12px] text-amber-700">{{ cam.msg }}</p>
    <p class="text-[11.5px] text-ink-4 leading-relaxed">在任何页面直接用扫码枪扫也可以：光标不在输入框里时，系统能认出扫码枪的快速输入。手机、平板用相机扫流转卡上的二维码，会直接打开对应页面。</p>
  </form>
  <template #footer><button type="button" class="btn-secondary" @click="close">取消</button><button type="button" class="btn-primary" @click="submit"><ic name="arrow-right" :size="15"/>打开</button></template>
</modal>`,
};

/* 扫码枪：光标不在输入框时，连续快速输入（字符间隔不到 80ms）并以回车结束，就当作一次扫码 */
(function listenScanGun() {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  let buf = '', last = 0;
  /* 只有能打字的地方才让给输入：复选框、单选框、按钮获得焦点时照样识别扫码 */
  const typing = (tg) => {
    const tag = tg && tg.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT' || (tg && tg.isContentEditable)) return true;
    return tag === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|color|file|image)$/i.test(tg.type || '');
  };
  window.addEventListener('keydown', (e) => {
    if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) { buf = ''; return; }
    const now = Date.now();
    if (now - last > 80) buf = '';
    last = now;
    if (e.key === 'Enter') {
      const code = buf;
      buf = '';
      if (code.length < 4) return;
      const t = scanTarget(code);
      e.preventDefault();
      if (t) { toast('扫码：' + t.label, 'success'); go(t.to); } else toast('扫码“' + code + '”没有找到对应的单据', 'warn');
      return;
    }
    if (e.key && e.key.length === 1) buf += e.key;
  });
})();

/** 机台在工序上的默认值：工作中心是机台时取它（或同线第一台），否则把工作中心名带上 */
function defaultMachine(op) { const ms = machinesForOp(op); return ms.length ? ms[0].code : op && op.wc ? op.wc : ''; }
/**
 * 报工弹窗打开时的内容。v = { orderId?, op?, machine? }：
 *   工单：给了就用；没给按机台找在做的工单；再没有取第一张在制工单
 *   工序：给了就用；按机台给的，取这台机台在做的工序；否则接着最近一次报工往下报（那道没报满就还是它）；
 *         一次都没报过的，取第一道在机台上做的工序
 */
function workForm(v) {
  v = v || {};
  const open = S.orders.filter((o) => !o.releasedAt);
  let oid = v.orderId && open.some((o) => o.id === v.orderId) ? v.orderId : '';
  const jobs = v.machine ? machineJobs()[v.machine] || [] : [];
  if (!oid && jobs.length) oid = jobs[0].o.id;
  if (!oid && open.length) oid = open[0].id;
  const f = { orderId: oid, op: '', machine: '', good: '', bad: '', reason: '', qtyIn: '' };
  const o = S.orders.find((x) => x.id === oid) || null;
  if (!o) return f;
  const part = partOf(o.partId), q = orderQty(o), target = q.input || o.qty || 0, rows = q.rows;
  const job = jobs.find((j) => j.o === o);
  let last = -1;
  rows.forEach((x, i) => { if (x.processed > 0) last = i; });
  const r = last >= 0 ? (rows[last].processed < target ? rows[last] : rows[last + 1] || rows[last])
    : rows.find((x) => !!machineOf(x.op.wc) || x.op.insp.some((b) => b.scene === 'FIRST')) || rows[0];
  f.op = v.op && opByKey(part, v.op) ? v.op : job && opByKey(part, job.op) ? job.op : r ? r.key : '';
  /* 机台：给了就用；否则取这张工单这道工序实际在做的机台；都没有才取工序默认机台 */
  f.machine = v.machine || runningMachine(o, f.op) || defaultMachine(opByKey(part, f.op));
  if (!o.qtyIn) f.qtyIn = String(o.qty || '');
  return f;
}
/** 换了工单或工序时的机台：原来选的机台这道工序也能用就留着（例如从机台卡片打开），否则取实际在做的机台或默认机台 */
function keepMachine(o, opKey, keep) {
  const op = o ? opByKey(partOf(o.partId), opKey) : null;
  if (keep && machinesForOp(op).some((m) => m.code === keep)) return keep;
  return (o && runningMachine(o, opKey)) || defaultMachine(op);
}
/** 登记首件触发弹窗打开时的内容。v = { orderId?, op?, machine?, trigger? }：只列有首件检验点的在制工单和工序 */
function setupForm(v) {
  v = v || {};
  const list = S.orders.filter((o) => !o.releasedAt && firstOpsOf(partOf(o.partId)).length);
  let oid = v.orderId && list.some((o) => o.id === v.orderId) ? v.orderId : '';
  if (!oid && v.machine) { const j = (machineJobs()[v.machine] || []).find((x) => list.indexOf(x.o) >= 0 && firstOpsOf(partOf(x.o.partId)).some((p) => opKeyOf(p) === x.op)); if (j) oid = j.o.id; }
  if (!oid && list.length) oid = list[0].id;
  const f = { orderId: oid, op: '', machine: '', trigger: v.trigger || '换刀', note: '' };
  const o = S.orders.find((x) => x.id === oid) || null;
  if (!o) return f;
  const fops = firstOpsOf(partOf(o.partId));
  f.op = v.op && fops.some((x) => opKeyOf(x) === v.op) ? v.op : fops[0] ? opKeyOf(fops[0]) : '';
  f.machine = v.machine || runningMachine(o, f.op) || defaultMachine(fops.find((x) => opKeyOf(x) === f.op) || null);
  return f;
}

/* ---------------- 报工（全局弹窗，由 UI.work = { orderId?, op?, machine? } 打开） ---------------- */
COMPONENTS['work-modal'] = {
  setup() {
    const f = reactive(workForm(null));
    const open = computed(() => !!UI.work);
    const orders = computed(() => S.orders.filter((o) => !o.releasedAt));
    const o = computed(() => S.orders.find((x) => x.id === f.orderId) || null);
    const part = computed(() => (o.value ? partOf(o.value.partId) : {}));
    const ops = computed(() => opsOf(part.value));
    const op = computed(() => opByKey(part.value, f.op));
    const machines = computed(() => machinesForOp(op.value));
    const q = computed(() => (o.value ? orderQty(o.value) : null));
    const row = computed(() => (q.value ? q.value.rows.find((r) => r.key === f.op) || null : null));
    /* 班次在每次打开时重新算（弹窗一直挂着，不重新算会停在第一次打开时的班次） */
    const sh = ref(shiftAt());
    watch(() => UI.work, (v) => { if (v) { sh.value = shiftAt(); Object.assign(f, workForm(v)); } });
    /* 事件里直接取选中的值，不依赖 v-model 与 change 事件的先后；换工单、换工序时尽量保留原来选的机台 */
    const onOrder = (e) => { if (e && e.target) f.orderId = e.target.value; const keep = f.machine; Object.assign(f, workForm({ orderId: f.orderId })); f.machine = keepMachine(o.value, f.op, keep); };
    const onOp = (e) => { if (e && e.target) f.op = e.target.value; f.machine = keepMachine(o.value, f.op, f.machine); };
    const close = () => { UI.work = null; };
    const hasBad = computed(() => /^\d+$/.test(String(f.bad).trim()) && parseInt(f.bad, 10) > 0);
    const save = () => {
      try {
        if (!o.value) throw new Error('请选择工单');
        const r = reportWork(o.value, f);
        close();
        toast('已报工：工序 ' + r.w.op + ' 合格 ' + r.w.good + ' 件' + (r.n ? '；不良 ' + r.w.bad + ' 件已登记 ' + r.n.code + '，等质量确认范围和处置' : ''), 'success');
      } catch (e) { toast(e.message, 'error'); }
    };
    return { f, open, orders, o, ops, machines, q, row, sh, hasBad, onOrder, onOp, close, save, shiftText };
  },
  template: `
<modal :open="open" @close="close" title="报工" :sub="shiftText(sh) + '。合格数和不良数分开报；有不良时系统自动登记 NCR，范围和处置由质量确认'" width="max-w-lg">
  <div class="space-y-4">
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div><label class="label">工单</label><select v-model="f.orderId" class="input" @change="onOrder"><option v-for="x in orders" :key="x.id" :value="x.id">{{ x.wo }} · {{ partOf(x.partId).name }}</option></select></div>
      <div><label class="label">工序</label><select v-model="f.op" class="input" @change="onOp"><option v-for="p in ops" :key="p.no" :value="p.no + ' ' + p.name">{{ p.no }} {{ p.name }}</option></select></div>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div><label class="label">机台</label><select v-if="machines.length" v-model="f.machine" class="input"><option v-for="m in machines" :key="m.code" :value="m.code">{{ m.code }} · {{ m.name }}</option></select><input v-else v-model="f.machine" class="input" placeholder="工作中心（可空）"></div>
      <div v-if="o && !o.qtyIn"><label class="label">投产数量（第一次报工时确认）</label><input v-model.trim="f.qtyIn" class="input" inputmode="numeric"></div>
      <div v-else-if="q"><label class="label">投产</label><div class="h-10 flex items-center text-[13px] text-ink-2">{{ q.input }} 件<span v-if="row" class="text-ink-4 ml-2">本工序已报 {{ row.processed }} 件</span></div></div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">合格数（件）</label><input v-model.trim="f.good" class="input !text-[16px] font-semibold" inputmode="numeric" placeholder="0"></div>
      <div><label class="label">不良数（件）</label><input v-model.trim="f.bad" class="input !text-[16px] font-semibold" inputmode="numeric" placeholder="0"></div>
    </div>
    <p v-if="row && row.badInsp" class="rounded-xl bg-amber-50 text-amber-800 px-3.5 py-2.5 text-[12px] leading-relaxed">本工序检验已经判了不良 {{ row.badInsp }} 件，已从合格数里扣掉。这些件报工时按加工数报进合格，不要再报成不良，否则会重复登记一张不合格单（重复的可以由质量确认为 0 件关闭）。</p>
    <div v-if="hasBad"><label class="label">不良现象（必填）</label><textarea v-model="f.reason" rows="2" class="textarea" placeholder="例如：外径超上限 0.02；表面划伤"></textarea><p class="text-[11px] text-ink-4 mt-1">提交后自动登记 NCR。不良品先隔离标识，等质量确认范围和处置；返工、报废、让步的数量会回写到工单。</p></div>
  </div>
  <template #footer><button class="btn-secondary" @click="close">取消</button><g-btn perm="order.work" cls="btn-primary" icon="check" @click="save">报工</g-btn></template>
</modal>`,
};

/* ---------------- 登记首件触发（全局弹窗，由 UI.setup = { orderId?, op?, machine? } 打开） ---------------- */
COMPONENTS['setup-modal'] = {
  setup() {
    const f = reactive(setupForm(null));
    const open = computed(() => !!UI.setup);
    const orders = computed(() => S.orders.filter((o) => !o.releasedAt && firstOpsOf(partOf(o.partId)).length));
    const o = computed(() => S.orders.find((x) => x.id === f.orderId) || null);
    const fops = computed(() => (o.value ? firstOpsOf(partOf(o.value.partId)) : []));
    const op = computed(() => fops.value.find((x) => opKeyOf(x) === f.op) || null);
    const machines = computed(() => machinesForOp(op.value));
    const reqs = computed(() => (o.value ? faiReqs(o.value).filter((r) => r.key === f.op) : []));
    watch(() => UI.setup, (v) => { if (v) Object.assign(f, setupForm(v)); });
    /* 换工单、换工序时保留原来选的机台（例如从机台卡片打开、换型到另一张工单），这道工序用不了才换成实际在做的或默认机台 */
    const onOrder = (e) => { if (e && e.target) f.orderId = e.target.value; const t = f.trigger, note = f.note, keep = f.machine; Object.assign(f, setupForm({ orderId: f.orderId, trigger: t })); f.note = note; f.machine = keepMachine(o.value, f.op, keep); };
    const onOp = (e) => { if (e && e.target) f.op = e.target.value; f.machine = keepMachine(o.value, f.op, f.machine); };
    const trigHint = computed(() => (f.trigger === '下机' ? '这台机台不再做这张工单，不再要求首件。' : (FAI_TRIGGERS.find((t) => t.key === f.trigger) || {}).hint || ''));
    const close = () => { UI.setup = null; };
    const save = () => {
      try {
        if (!o.value) throw new Error('请选择工单');
        const e = addSetup(o.value, f);
        close();
        toast(e.trigger === '下机' ? e.machine + ' 已下机' : '已登记 ' + e.machine + ' ' + e.trigger + '：检验员在现场看板上会看到“' + (FAI_LABEL[e.trigger] || '首件') + '待检”', 'success');
      } catch (err) { toast(err.message, 'error'); }
    };
    return { f, open, orders, o, fops, machines, reqs, trigHint, onOrder, onOp, close, save, FAI_TRIGGERS, faiLabel };
  },
  template: `
<modal :open="open" @close="close" title="登记首件触发" sub="开班、换型、换刀、修机后都要重新做首件。登记后这台机台的首件要求重新打开，检验员在现场看板上马上能看到" width="max-w-lg">
  <div class="space-y-4">
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div><label class="label">工单</label><select v-model="f.orderId" class="input" @change="onOrder"><option v-for="x in orders" :key="x.id" :value="x.id">{{ x.wo }} · {{ partOf(x.partId).name }}</option></select></div>
      <div><label class="label">工序（有首件检验点的）</label><select v-model="f.op" class="input" @change="onOp"><option v-for="p in fops" :key="p.no" :value="p.no + ' ' + p.name">{{ p.no }} {{ p.name }}</option></select></div>
    </div>
    <div><label class="label">机台</label><select v-if="machines.length" v-model="f.machine" class="input"><option v-for="m in machines" :key="m.code" :value="m.code">{{ m.code }} · {{ m.name }}</option></select><input v-else v-model="f.machine" class="input" placeholder="机台编号"></div>
    <div><label class="label">原因</label>
      <div class="flex flex-wrap gap-1.5">
        <button v-for="t in FAI_TRIGGERS" :key="t.key" type="button" :title="t.hint" @click="f.trigger = t.key" class="h-8 px-3 rounded-full text-xs font-medium ring-1 ring-inset transition-all duration-200" :class="f.trigger === t.key ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-ink-2 ring-black/10 hover:ring-brand-400'">{{ t.key }}</button>
        <button type="button" title="这台机台不再做这张工单" @click="f.trigger = '下机'" class="h-8 px-3 rounded-full text-xs font-medium ring-1 ring-inset transition-all duration-200" :class="f.trigger === '下机' ? 'bg-ink text-white ring-ink' : 'bg-white text-ink-3 ring-black/10'">下机</button>
      </div>
      <p class="text-[11.5px] text-ink-4 mt-1.5">{{ trigHint }}</p>
    </div>
    <div><label class="label">备注（可空）</label><input v-model="f.note" class="input" placeholder="例如：T03 外圆刀片磨损更换"></div>
    <div v-if="reqs.length" class="rounded-xl bg-[#f7f7f9] px-3.5 py-2.5 text-[12px] text-ink-3 space-y-0.5"><div class="font-medium text-ink-2">这道工序现在的首件要求</div><div v-for="r in reqs" :key="r.machine">{{ r.machine || '默认机台' }} · {{ faiLabel(r) }} · {{ r.task ? r.task.code + ' ' + STATUS.task[r.task.status][0] : '还没做' }}</div></div>
  </div>
  <template #footer><button class="btn-secondary" @click="close">取消</button><g-btn perm="order.setup" cls="btn-primary" icon="check" @click="save">登记</g-btn></template>
</modal>`,
};

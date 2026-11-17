/* =====================================================================
 * 页面 B：检验任务（总览 / 五类场景入口）· 新建任务 · 检验执行（五类检验共用同一执行引擎）
 * ===================================================================== */

/* ---------------- 新建检验任务（全局抽屉，由 UI.newTask 打开） ----------------
 * UI.newTask = { scene, partId?, planId?, ctx? }；零件工序路线上的检验点可带着工序直接发起 */
COMPONENTS['new-task-drawer'] = {
  setup() {
    const f = reactive({ scene: 'IQC', partId: '', planId: '', lot: '', ctx: {}, assignee: '', due: '' });
    /* 完整表单：默认用三步向导（48_guide.js），在向导里点“用完整表单”才打开这里 */
    const open = computed(() => !!UI.newTask && UI.newTaskMode === 'form');
    const scene = computed(() => sceneOf(f.scene));
    const sceneOpts = computed(() => S.scenes.filter((s) => s.enabled).map((s) => ({ value: s.code, label: s.name })));
    const parts = computed(() => S.parts.filter((p) => plansFor(p.id, f.scene).length));
    const plans = computed(() => plansFor(f.partId, f.scene));
    const plan = computed(() => planOf(f.planId));
    const part = computed(() => partOf(f.partId));
    const std = computed(() => (plan.value ? stdOf(plan.value.stdId) : null));
    const cg = computed(() => (plan.value ? plan.value.groups.find((g) => g.type === 'count') : null));
    const itemCount = computed(() => (plan.value ? Object.values(plan.value.assign).filter((a) => a !== '-').length : 0));
    const ops = computed(() => (part.value.route ? part.value.route.ops.filter((o) => o.insp.some((b) => b.scene === f.scene)) : []));
    const people = computed(() => S.users.filter((u) => u.role === 'insp' || u.role === 'qe'));
    const fields = computed(() => (scene.value.ctx || []).map((k) => Object.assign({ key: k }, CTX_FIELDS[k])));

    const fillDefaults = () => {
      if (!parts.value.some((p) => p.id === f.partId)) f.partId = parts.value[0] ? parts.value[0].id : '';
      if (!plans.value.some((p) => p.id === f.planId)) f.planId = plans.value[0] ? plans.value[0].id : '';
      const c = f.ctx, keys = scene.value.ctx || [];
      if (keys.includes('supplier') && !c.supplier) c.supplier = S.suppliers[0];
      if (keys.includes('customer') && !c.customer) c.customer = S.customers.includes(part.value.customer) ? part.value.customer : S.customers[0];
      if (keys.includes('op') && !c.op && ops.value[0]) c.op = ops.value[0].no + ' ' + ops.value[0].name;
      if (keys.includes('freq') && !c.freq) {
        const o = ops.value.find((x) => x.no + ' ' + x.name === c.op);
        const b = o && o.insp.find((x) => x.scene === f.scene);
        c.freq = (b && b.freq) || '每 2 小时';
      }
      if (keys.includes('batch') && !c.batch) c.batch = dateCode() + '-' + String.fromCharCode(65 + (S.seq % 26));
      if (cg.value && !f.lot) f.lot = String(cg.value.lotRef || '');
    };
    watch(() => UI.newTask, (v) => {
      if (!v) return;
      f.scene = v.scene || 'IQC'; f.partId = v.partId || ''; f.planId = v.planId || ''; f.lot = ''; f.due = '';
      f.ctx = Object.assign({}, v.ctx || {});
      f.assignee = me.value.role === 'insp' ? S.me : (S.users.find((u) => u.role === 'insp') || me.value).id;
      fillDefaults();
    });
    /* 事件处理里显式取值，不依赖 v-model 与事件监听的先后顺序 */
    const onScene = (v) => { if (typeof v === 'string') f.scene = v; f.ctx = {}; f.lot = ''; f.planId = ''; fillDefaults(); };
    const onPart = (e) => { if (e && e.target) f.partId = e.target.value; f.planId = ''; f.lot = ''; f.ctx.op = ''; f.ctx.freq = ''; fillDefaults(); };
    const onPlan = (e) => { if (e && e.target) f.planId = e.target.value; f.lot = ''; fillDefaults(); };

    const lotHint = computed(() => {
      if (!cg.value || !String(f.lot).trim()) return null;
      const s = aqlSuggest(f.lot, cg.value.aql);
      if (s.error) return { tone: 'text-rose-600', text: s.error };
      if (s.unsupported) return { tone: 'text-amber-700', text: '批量 ' + f.lot + ' 对应字码 ' + s.letter + '（n=' + s.n + '），与 AQL ' + cg.value.aql + ' 的组合需查企业授权抽样表。本任务仍按方案设定执行。' };
      if (s.n !== cg.value.n || s.ac !== cg.value.ac) return { tone: 'text-amber-700', text: '按演示规则，批量 ' + f.lot + ' 对应字码 ' + s.letter + '：n=' + s.n + '、Ac ' + s.ac + ' / Re ' + s.re + '，与方案设定（n=' + cg.value.n + '、Ac ' + cg.value.ac + ' / Re ' + cg.value.re + '）不同。开检时不能临时改规则，如需调整请修订方案。' };
      return { tone: 'text-emerald-700', text: '批量与方案抽样设定一致：字码 ' + s.letter + '，n=' + s.n + '，Ac ' + s.ac + ' / Re ' + s.re + '。' };
    });
    const close = () => { UI.newTask = null; UI.newTaskMode = 'wizard'; };
    const create = () => {
      try {
        const ctx = {};
        (scene.value.ctx || []).forEach((k) => { const v = String(f.ctx[k] || '').trim(); if (v) ctx[k] = v; });
        const t = createTask({ scene: f.scene, planId: f.planId, lot: f.lot, ctx, assignee: f.assignee, due: f.due ? new Date(f.due).toISOString() : '' });
        close();
        toast('已创建 ' + t.code + '，检验依据已冻结', 'success');
        go('/inspect/' + t.id);
      } catch (e) { toast(e.message, 'error'); }
    };
    return { f, open, scene, sceneOpts, parts, plans, plan, std, cg, itemCount, ops, people, fields, lotHint, onScene, onPart, onPlan, close, create };
  },
  template: `
<drawer :open="open" @close="close" title="新建检验任务" sub="选择场景与方案后，系统冻结“场景定义 + 标准修订 + 方案修订”三层快照；建单时不能改技术规则" width="max-w-xl">
  <div class="space-y-5">
    <div><label class="label">检验场景（五类检验共用同一执行引擎）</label><seg v-model="f.scene" :options="sceneOpts" @update:modelValue="onScene"/>
      <p class="text-[11.5px] text-ink-4 mt-2">{{ scene.desc }}</p></div>

    <empty v-if="!parts.length" icon="clipboard" title="该场景下没有生效的检验方案" desc="请先在“检验方案”中为零件编制并批准适用于该场景的方案"><button class="btn-secondary btn-sm" @click="close(); go('/plans')">前往检验方案</button></empty>
    <template v-else>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label class="label">零件</label><select v-model="f.partId" class="input" @change="onPart"><option v-for="p in parts" :key="p.id" :value="p.id">{{ p.partNo }} {{ p.name }}</option></select></div>
        <div><label class="label">检验方案（仅生效修订）</label><select v-model="f.planId" class="input" @change="onPlan"><option v-for="p in plans" :key="p.id" :value="p.id">{{ p.code }} Rev {{ p.rev }}</option></select></div>
      </div>

      <div v-if="plan && std" class="rounded-2xl bg-[#f7f7f9] p-4 space-y-3">
        <div class="flex items-center gap-1.5 text-[12px] font-medium"><ic name="lock" :size="13"/>将冻结的检验依据</div>
        <div class="grid grid-cols-3 gap-3 text-[12px]">
          <kv k="场景定义" :v="scene.name + ' v' + scene.ver"/><kv k="检验标准" :v="std.code + ' Rev ' + std.rev"/><kv k="检验方案" :v="plan.code + ' Rev ' + plan.rev"/>
        </div>
        <div class="flex flex-wrap gap-1.5"><span class="chip-gray">{{ itemCount }} 项特性</span><span v-for="g in plan.groups" :key="g.key" :class="g.type === 'measure' ? 'chip-brand' : 'chip-amber'">{{ g.type === 'measure' ? '计量组 n=' + g.n : '计数组 n=' + g.n + ' · Ac ' + g.ac + ' / Re ' + g.re }}</span><span class="chip-gray">拍照：{{ PHOTO_POLICY[scene.photo || 'none'] }}</span><span class="chip-gray">复核：{{ REVIEW_POLICY[scene.review || 'never'] }}</span></div>
        <scene-pipeline :steps="scene.steps" small/>
      </div>

      <div v-if="cg"><label class="label">批量（件，整数）</label><input v-model.trim="f.lot" class="input w-40" inputmode="numeric" placeholder="如 1241">
        <p v-if="lotHint" class="text-[11.5px] mt-1.5 leading-relaxed" :class="lotHint.tone">{{ lotHint.text }}</p></div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div v-for="fd in fields" :key="fd.key">
          <label class="label">{{ fd.label }}</label>
          <select v-if="fd.type === 'supplier'" v-model="f.ctx[fd.key]" class="input"><option v-for="s in S.suppliers" :key="s">{{ s }}</option></select>
          <select v-else-if="fd.type === 'customer'" v-model="f.ctx[fd.key]" class="input"><option v-for="s in S.customers" :key="s">{{ s }}</option></select>
          <select v-else-if="fd.type === 'op' && ops.length" v-model="f.ctx[fd.key]" class="input"><option v-for="o in ops" :key="o.no" :value="o.no + ' ' + o.name">{{ o.no }} {{ o.name }}（{{ o.wc }}）</option></select>
          <input v-else v-model="f.ctx[fd.key]" class="input" :placeholder="fd.ph || (fd.type === 'op' ? '零件工序路线上没有绑定该场景的工序，可手填' : '')">
        </div>
      </div>
      <p class="text-[11.5px] text-ink-4 -mt-2">外部单号均为可空引用：没有 ERP / MES / WMS 也能正常建单与闭环。</p>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label class="label">检验员</label><select v-model="f.assignee" class="input"><option v-for="u in people" :key="u.id" :value="u.id">{{ u.name }}（{{ ROLES[u.role].name }}）</option></select></div>
        <div><label class="label">截止时间（可空，默认 8 小时后）</label><input type="datetime-local" v-model="f.due" class="input"></div>
      </div>
    </template>
  </div>
  <template #footer><button class="btn-ghost mr-auto" @click="UI.newTaskMode = 'wizard'">改用三步向导</button><button class="btn-secondary" @click="close">取消</button><g-btn perm="task.create" cls="btn-primary" icon="check" :when="!!plan" why="请先选择检验方案" @click="create">创建并开始检验</g-btn></template>
</drawer>`,
};

/* ---------------- 检验任务列表（总览 / 单场景） ---------------- */
COMPONENTS['page-tasks'] = {
  setup() {
    const code = computed(() => UI.route.params.scene || '');
    const sc = computed(() => (code.value ? sceneOf(code.value) : null));
    const status = ref(UI.route.query.status || 'all');
    const q = ref(UI.route.query.q || '');
    const mine = ref(false);
    const base = computed(() => S.tasks.filter((t) => !code.value || t.scene === code.value));
    const opts = computed(() => [{ value: 'all', label: '全部', count: base.value.length }].concat(['pending', 'active', 'pass', 'fail', 'insufficient'].map((k) => ({ value: k, label: STATUS.task[k][0], dot: STATUS.task[k][2], count: base.value.filter((t) => t.status === k).length }))));
    const rows = computed(() => {
      const k = q.value.trim().toLowerCase();
      return base.value.filter((t) => (status.value === 'all' || t.status === status.value) && (!mine.value || t.assignee === S.me) && (!k || (t.code + ' ' + partOf(t.partId).name + ' ' + partOf(t.partId).partNo + ' ' + ctxText(t)).toLowerCase().includes(k)));
    });
    const pct = (t) => Math.round(taskProgress(t) * 100);
    const overdue = (t) => (t.status === 'pending' || t.status === 'active') && new Date(t.due) < new Date();
    const sceneStat = (c) => ({ open: S.tasks.filter((t) => t.scene === c && (t.status === 'pending' || t.status === 'active')).length, total: S.tasks.filter((t) => t.scene === c).length });
    const barColor = (t) => STATUS.task[t.status][2];
    /* 五类检验用页签切换（数字是进行中的任务数） */
    const sceneOpts = computed(() => [{ value: 'ALL', label: '全部', count: S.tasks.filter((t) => t.status === 'pending' || t.status === 'active').length }].concat(S.scenes.map((s) => ({ value: s.code, label: s.name, count: sceneStat(s.code).open }))));
    const pickScene = (v) => go(v === 'ALL' ? '/tasks' : '/tasks/' + v);
    return { code, sc, status, q, mine, opts, rows, pct, overdue, sceneStat, barColor, sceneOpts, pickScene };
  },
  template: `
<div class="space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div><h1 class="page-title">检验任务</h1>
      <p class="text-xs text-ink-3 mt-1">{{ sc ? sc.desc : '点一行进入检验。用下面的页签按检验类型筛选。' }}</p></div>
    <g-btn perm="task.create" cls="btn-primary" icon="plus" @click="UI.newTask = code ? { scene: code } : {}">新建检验</g-btn>
  </div>

  <seg :modelValue="code || 'ALL'" :options="sceneOpts" @update:modelValue="pickScene"/>

  <div v-if="sc" class="card px-5 py-4 flex flex-col lg:flex-row lg:items-center gap-3">
    <div class="shrink-0 text-[12px] text-ink-3"><span class="font-medium text-ink">本场景流程</span>（定义 v{{ sc.ver }}）</div>
    <div class="flex-1 min-w-0"><scene-pipeline :steps="sc.steps" small/></div>
    <div class="flex flex-wrap items-center gap-1.5 shrink-0"><span class="chip-gray">拍照：{{ PHOTO_POLICY[sc.photo || 'none'] }}</span><span class="chip-gray">复核：{{ REVIEW_POLICY[sc.review || 'never'] }}</span><button class="link text-xs ml-1" @click="go('/scenes')">流程配置</button></div>
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <seg v-model="status" :options="opts"/>
    <div class="relative"><ic name="search" :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"/><input v-model="q" class="input !h-[38px] pl-9 w-60" placeholder="搜索任务编号 / 零件 / 批次 / 工单"></div>
    <label class="inline-flex items-center gap-2 text-[12.5px] text-ink-2 cursor-pointer select-none"><input type="checkbox" v-model="mine" class="w-4 h-4 accent-brand-600">只看指派给我的</label>
  </div>

  <div class="card overflow-hidden">
    <div class="overflow-x-auto"><table class="tbl">
      <thead><tr><th>任务编号</th><th v-if="!sc">场景</th><th>零件</th><th>批次 / 工单 / 工序</th><th>依据（快照）</th><th class="min-w-[120px]">录入进度</th><th>状态</th><th>检验员</th><th>截止</th><th></th></tr></thead>
      <tbody>
        <tr v-for="t in rows" :key="t.id" class="row-link" @click="go('/inspect/' + t.id)">
          <td><div class="font-medium font-mono text-[12.5px]">{{ t.code }}</div><div class="text-[11px] text-ink-4">{{ fmtRel(t.createdAt) }}创建<span v-if="t.rounds.length > 1"> · 第 {{ t.rounds.length }} 轮</span></div></td>
          <td v-if="!sc"><span class="chip" :class="SCENE_META[t.scene].tint">{{ sceneOf(t.scene).name }}</span></td>
          <td><div>{{ partOf(t.partId).name }}</div><div class="text-[11px] text-ink-4">{{ partOf(t.partId).partNo }}</div></td>
          <td class="text-[12px] text-ink-2 w-full max-w-0 min-w-[180px]"><div class="truncate" :title="ctxText(t)">{{ ctxText(t) || '—' }}</div><div v-if="t.lot" class="text-[11px] text-ink-4">批量 {{ t.lot }} 件</div></td>
          <td class="text-[12px]"><div>{{ t.snap.plan.code }} Rev {{ t.snap.plan.rev }}</div><div class="text-[11px] text-ink-4">{{ t.snap.std.code }} Rev {{ t.snap.std.rev }}</div></td>
          <td><div class="flex items-center gap-2"><div class="flex-1 h-1.5 rounded-full bg-black/[0.07] overflow-hidden"><div class="h-full rounded-full transition-all duration-700 ease-apple" :style="{ width: pct(t) + '%', background: barColor(t) }"></div></div><span class="text-[11px] tabular text-ink-3 w-8 text-right">{{ pct(t) }}%</span></div></td>
          <td><st k="task" :v="t.status" dot/></td>
          <td><span class="inline-flex items-center gap-1.5"><avatar :uid="t.assignee" :size="20"/>{{ userName(t.assignee) }}</span></td>
          <td class="text-xs whitespace-nowrap" :class="overdue(t) ? 'text-rose-600 font-medium' : 'text-ink-3'">{{ t.status === 'pending' || t.status === 'active' ? fmtRel(t.due) : '—' }}</td>
          <td class="text-right"><span v-if="t.status === 'pending' || t.status === 'active'" class="btn-primary btn-xs">{{ t.status === 'pending' ? '开始检验' : '继续检验' }}<ic name="arrow-right" :size="12"/></span><span v-else class="btn-secondary btn-xs">查看</span></td>
        </tr>
      </tbody>
    </table></div>
    <empty v-if="!rows.length" icon="list" title="没有符合条件的检验任务" desc="可以调整筛选条件，或新建一个任务"/>
  </div>
</div>`,
};

/* ---------------- 检验执行（五类检验共用） ---------------- */
COMPONENTS['page-inspect'] = {
  setup() {
    const t = computed(() => taskOf(UI.route.params.id));
    const ridx = ref(0);
    watch(() => (t.value ? t.value.rounds.length : 0), (n) => { ridx.value = Math.max(0, n - 1); }, { immediate: true });
    const round = computed(() => (t.value ? t.value.rounds[Math.min(ridx.value, t.value.rounds.length - 1)] : null));
    const ev = computed(() => (t.value && round.value ? evalRound(t.value, round.value) : null));
    const scene = computed(() => (t.value ? t.value.snap.scene : { steps: [], ctx: [] }));
    const part = computed(() => (t.value ? partOf(t.value.partId) : {}));
    const mItems = computed(() => (t.value ? t.value.snap.items.filter((i) => i.group === 'M') : []));
    const cItems = computed(() => (t.value ? t.value.snap.items.filter((i) => i.group === 'C') : []));
    const cg = computed(() => (t.value ? t.value.snap.groups.find((g) => g.type === 'count') : null));
    const isLast = computed(() => !!t.value && ridx.value >= t.value.rounds.length - 1);
    const active = computed(() => !!round.value && round.value.status === 'active');
    const editable = computed(() => active.value && can('task.measure'));
    const tab = ref('M');
    watch(t, (v) => { if (v) tab.value = v.snap.items.some((i) => i.group === 'M') ? 'M' : 'C'; }, { immediate: true });
    const tabOpts = computed(() => {
      const o = [];
      if (mItems.value.length) o.push({ value: 'M', label: '计量组', count: mItems.value.length });
      if (cItems.value.length) o.push({ value: 'C', label: '计数组', count: cItems.value.length });
      o.push({ value: 'P', label: '照片', count: round.value ? round.value.photos.length : 0 });
      return o;
    });
    const mode = ref(window.innerWidth < 900 ? 'card' : 'grid');
    const cardIdx = ref(0);
    const cardItem = computed(() => mItems.value[Math.min(cardIdx.value, mItems.value.length - 1)] || null);
    const sel = ref(null);
    const selItem = computed(() => (t.value && sel.value ? t.value.snap.items.find((i) => i.cid === sel.value) || null : null));
    const statusMap = computed(() => { const m = {}; if (ev.value) Object.keys(ev.value.byCid).forEach((cid) => { m[cid] = ev.value.byCid[cid].status; }); return m; });
    const pv = computed(() => (ev.value && active.value ? photoViolations(t.value, round.value, ev.value) : []));
    const pvSet = computed(() => new Set(pv.value.map((i) => i.cid)));
    const rep = computed(() => (t.value && round.value ? S.reports.find((x) => x.taskId === t.value.id && x.roundId === round.value.id) || null : null));
    const ncrs = computed(() => (t.value ? ncrsOfTask(t.value.id) : []));
    const ngCids = computed(() => (ev.value ? Object.keys(ev.value.byCid).filter((cid) => ev.value.byCid[cid].status === 'ng') : []));
    const roundOpts = computed(() => (t.value ? t.value.rounds.map((r, i) => ({ value: i, label: '第 ' + r.no + ' 轮' + (r.parent ? '（复检）' : '') + ' · ' + (r.status === 'active' ? '进行中' : STATUS.result[r.result.overall === 'pass' ? 'pass' : r.result.overall === 'fail' ? 'fail' : 'incomplete'][0]) })) : []));

    const touch = () => { if (t.value && t.value.status === 'pending') { t.value.status = 'active'; logAudit('检验', t.value.code, '开始检验'); } };
    const pick = (cid) => {
      sel.value = cid;
      const it = t.value.snap.items.find((i) => i.cid === cid); if (!it) return;
      if (tab.value !== 'P') tab.value = it.group;
      if (it.group === 'M') cardIdx.value = Math.max(0, mItems.value.indexOf(it));
      nextTick(() => { const el = document.getElementById('irow-' + cid); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
    };
    const cardGo = (d) => { cardIdx.value = Math.min(mItems.value.length - 1, Math.max(0, cardIdx.value + d)); if (cardItem.value) sel.value = cardItem.value.cid; };

    /* —— 录入格：判定着色、键盘导航、Excel 多格粘贴 —— */
    const cellCls = (it, i) => {
      const st = ev.value.byCid[it.cid].cells[i];
      if (st === 'high' || st === 'low') return 'cell-ng';
      if (st === 'invalid') return 'cell-bad';
      if (st === 'ok') return inWarnBand(round.value.vals[it.cid][i], it) ? 'cell-warn' : 'cell-ok';
      return '';
    };
    const cntCls = (it) => { const raw = String(round.value.cnt[it.cid].bad == null ? '' : round.value.cnt[it.cid].bad).trim(); if (!raw) return ''; if (!/^\d+$/.test(raw)) return 'cell-bad'; return parseInt(raw, 10) > 0 ? 'cell-ng' : 'cell-ok'; };
    const badgeCls = (it) => { const st = statusMap.value[it.cid]; return st === 'ng' ? 'bg-rose-500 text-white ring-rose-200' : st === 'ok' ? 'bg-emerald-500 text-white ring-emerald-200' : it.cls === 'CTQ' ? 'bg-rose-50 text-rose-700 ring-rose-300' : it.cls === 'CC' ? 'bg-amber-50 text-amber-700 ring-amber-300' : 'bg-brand-50 text-brand-700 ring-brand-300'; };
    const rowStat = (it) => {
      const xs = (round.value.vals[it.cid] || []).map((v) => String(v == null ? '' : v).trim()).filter((v) => NUM_RE.test(v));
      if (!xs.length) return null;
      const nums = xs.map(parseFloat), dec = Math.max.apply(null, xs.map((x) => (x.split('.')[1] || '').length));
      return { mean: (sum(nums) / nums.length).toFixed(Math.min(6, dec + 1)), range: (Math.max.apply(null, nums) - Math.min.apply(null, nums)).toFixed(dec) };
    };
    const focusCell = (r, c) => { const el = document.querySelector('input[data-r="' + r + '"][data-c="' + c + '"]'); if (el) { el.focus(); el.select(); return true; } return false; };
    const onCellKey = (e, r, c) => {
      if (e.isComposing) return;
      const el = e.target, n = round.value.samples.length;
      if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); if (!focusCell(r + 1, c) && e.key === 'Enter') focusCell(0, c + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); focusCell(r - 1, c); }
      else if (e.key === 'ArrowRight' && el.selectionStart === el.value.length && c + 1 < n) { e.preventDefault(); focusCell(r, c + 1); }
      else if (e.key === 'ArrowLeft' && el.selectionEnd === 0 && c > 0) { e.preventDefault(); focusCell(r, c - 1); }
    };
    const onPaste = (e, r, c) => {
      const text = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\r/g, '');
      if (!/[\t\n]/.test(text.trim())) return;
      e.preventDefault();
      let n = 0;
      text.split('\n').filter((ln) => ln.length).forEach((ln, dr) => {
        const it = mItems.value[r + dr]; if (!it) return;
        ln.split('\t').forEach((v, dc) => { if (c + dc < round.value.samples.length) { round.value.vals[it.cid][c + dc] = v.trim(); n++; } });
      });
      touch(); toast('已粘贴 ' + n + ' 个读数，系统已重新判定', 'success');
    };

    /* —— 照片 —— */
    const photoFor = ref(null);
    const photoItem = computed(() => (photoFor.value && t.value ? t.value.snap.items.find((i) => i.cid === photoFor.value) || null : null));
    const photosOf = (cid) => (round.value ? round.value.photos.filter((p) => p.cid === cid) : []);
    const addPhotos = (cid, urls) => { urls.forEach((u) => round.value.photos.push({ id: 'ph' + nextSeq(), url: u, cid, at: nowISO(), by: S.me })); touch(); toast('已添加 ' + urls.length + ' 张照片', 'success'); };
    const removePhoto = (id) => { const i = round.value.photos.findIndex((p) => p.id === id); if (i >= 0) round.value.photos.splice(i, 1); };
    const photoRows = computed(() => (t.value ? t.value.snap.items.filter((i) => photosOf(i.cid).length || pvSet.value.has(i.cid)) : []));

    /* —— 设备导入（POST /api/v1/iot/gage-measurements 的界面模拟） —— */
    const imp = reactive({ open: false, text: '', result: null });
    const fmtLike = (refStr, x) => x.toFixed((String(refStr).split('.')[1] || '').length);
    const demoVal = (it, i, n) => {
      const l = it.lsl ? parseFloat(it.lsl) : null, u = it.usl ? parseFloat(it.usl) : null, refStr = it.usl || it.lsl;
      let x;
      if (l != null && u != null) x = (l + u) / 2 + (u - l) * 0.16 * ((i - (n - 1) / 2) / Math.max(1, n - 1));
      else if (l != null) x = l * (1.03 + i * 0.004);
      else x = u * (0.55 + i * 0.05);
      return fmtLike(refStr, x);
    };
    const genDemoImport = () => {
      const r = round.value, n = r.samples.length, ms = [];
      mItems.value.forEach((it, k) => r.samples.forEach((s, i) => {
        let v = demoVal(it, i, n);
        if (k === 0 && i === Math.min(1, n - 1)) v = it.usl ? fmtLike(it.usl, parseFloat(it.usl) * 1.004 + 0.02) : fmtLike(it.lsl, parseFloat(it.lsl) * 0.97);
        ms.push({ balloonNo: it.no, characteristicId: it.cid, sampleIndex: i + 1, value: v, measuredAt: nowISO() });
      }));
      if (mItems.value[1]) ms[n] = Object.assign({}, ms[n], { value: ms[n].value.replace('.', ',') });
      ms.push({ balloonNo: 99, sampleIndex: 1, value: '1.00', measuredAt: nowISO() });
      imp.text = JSON.stringify({ deviceCode: 'CMM-01', deviceType: 'CMM', inspectionTaskNo: t.value.code, roundNo: r.no, idempotencyKey: 'CMM-01-' + t.value.code + '-R' + r.no + '-' + (r.imports.length + 1), measurements: ms }, null, 1);
      imp.result = null;
    };
    const parseImport = () => {
      const text = imp.text.trim();
      if (!text) { toast('请粘贴设备报文，或点击“生成演示报文”', 'warn'); return; }
      let rows = [], key = '', device = '';
      try { const j = JSON.parse(text); rows = Array.isArray(j) ? j : (j.measurements || []); key = j.idempotencyKey || ''; device = j.deviceCode || ''; }
      catch (e) { rows = text.split(/\n+/).map((ln) => ln.split(/[,\t;]/).map((x) => x.trim())).filter((a) => a.length >= 3 && /^\d+$/.test(a[0])).map((a) => ({ balloonNo: a[0], sampleIndex: a[1], value: a[2] })); }
      const r = round.value;
      key = key || 'H-' + hashOf(text);
      const out = { key, device: device || '未注明设备', dup: r.imports.some((x) => x.key === key), ok: [], oot: [], fmt: [], unknown: 0, overwrite: 0 };
      rows.forEach((m) => {
        const it = t.value.snap.items.find((x) => x.group === 'M' && (m.characteristicId ? x.cid === m.characteristicId : x.no === parseInt(m.balloonNo, 10)));
        const si = parseInt(m.sampleIndex, 10) - 1, v = String(m.value == null ? '' : m.value).trim();
        if (!it || !(si >= 0 && si < r.samples.length)) { out.unknown++; return; }
        const st = judgeValue(v, it);
        if (st === 'invalid' || st === 'missing') { out.fmt.push({ it, si, v }); return; }
        const cur = String(r.vals[it.cid][si] || '').trim();
        if (cur && cur !== v) out.overwrite++;
        (st === 'ok' ? out.ok : out.oot).push({ it, si, v });
      });
      imp.result = out;
    };
    const applyImport = () => {
      const o = imp.result, r = round.value;
      if (!o || o.dup) return;
      o.ok.concat(o.oot).forEach((x) => { r.vals[x.it.cid][x.si] = x.v; });
      const applied = o.ok.length + o.oot.length;
      r.imports.push({ id: 'im' + nextSeq(), key: o.key, device: o.device, at: nowISO(), by: S.me, applied, oot: o.oot.length, fmt: o.fmt.length, unknown: o.unknown });
      touch();
      logAudit('检验', t.value.code, '设备导入 ' + applied + ' 个读数（真实超差 ' + o.oot.length + ' 已入账，格式异常 ' + o.fmt.length + '，无法匹配 ' + o.unknown + '）');
      toast('已导入 ' + applied + ' 个读数' + (o.oot.length ? '，其中 ' + o.oot.length + ' 个真实超差已入账' : ''), o.oot.length ? 'warn' : 'success');
      imp.open = false; imp.text = ''; imp.result = null;
    };

    /* —— 签名提交 —— */
    const sub = reactive({ open: false, reason: '', sig: '' });
    const needSign = computed(() => scene.value.steps.includes('sign'));
    const blockers = computed(() => {
      const b = []; if (!ev.value) return b;
      if (ev.value.c && ev.value.c.dInvalid) b.push('计数组：' + ev.value.c.dInvalid);
      pv.value.forEach((it) => b.push('#' + it.no + ' ' + it.name + ' 需要拍照（' + PHOTO_POLICY[scene.value.photo] + '）'));
      if (ev.value.overall === 'incomplete' && !scene.value.allowInsufficient) b.push('存在缺失项，当前场景不允许以“证据不足”提交');
      return b;
    });
    const missingText = computed(() => {
      if (!ev.value) return '';
      const cells = ev.value.missingCells;
      return cells.slice(0, 8).map((c) => '#' + c.it.no + ' ' + c.s + (c.st === 'invalid' ? '（格式无效）' : '')).join('、') + (cells.length > 8 ? ' 等' : '');
    });
    const overallKey = computed(() => (ev.value ? ev.value.overall : 'incomplete'));
    const cText = computed(() => {
      const c = ev.value && ev.value.c; if (!c) return '';
      if (c.dInvalid) return c.dInvalid + '。';
      if (c.result === 'accept') return 'd = ' + c.d + ' ≤ Ac ' + c.ac + '：批接受。' + (c.d > 0 ? '已发现的 ' + c.d + ' 件不良仍须单独处置（登记 NCR），不因批接受而消除。' : '');
      if (c.result === 'reject') return 'd = ' + c.d + ' ≥ Re ' + c.re + '：批拒收' + (c.allFilled ? '。' : '（已达到 Re，方案允许提前拒收）。');
      return '尚有计数项未录入，且 d = ' + c.d + ' < Re ' + c.re + '：继续抽样检验，禁止提前接受。';
    });
    const cTone = computed(() => { const c = ev.value && ev.value.c; if (!c) return ''; return c.result === 'accept' ? 'bg-emerald-50 text-emerald-900 ring-emerald-600/15' : c.result === 'reject' ? 'bg-rose-50 text-rose-900 ring-rose-600/15' : 'bg-sky-50 text-sky-900 ring-sky-600/15'; });
    const submitLabel = computed(() => (overallKey.value === 'incomplete' ? '以“证据不足”提交' : '确认提交'));
    const canSubmit = computed(() => !blockers.value.length && (!needSign.value || !!sub.sig) && (overallKey.value !== 'incomplete' || !!sub.reason.trim()));
    const openSubmit = () => { sub.reason = round.value.missingReason || ''; sub.sig = ''; sub.open = true; };
    const doSubmit = () => {
      try {
        const r = submitRound(t.value, round.value, { sigImg: sub.sig, missingReason: sub.reason });
        sub.open = false;
        toast('第 ' + round.value.no + ' 轮已提交，报告 ' + r.code + (r.state === 'review' ? ' 进入待复核' : ' 已冻结'), t.value.status === 'pass' ? 'success' : 'warn');
      } catch (e) { toast(e.message, 'error'); }
    };

    /* —— 结论横幅（已提交轮次） —— */
    const resultLabel = computed(() => { const r = round.value; if (!r || !r.result) return ''; return { pass: '符合', fail: '不符合', incomplete: '证据不足' }[r.result.overall]; });
    const bannerCls = computed(() => { const r = round.value; if (!r || !r.result) return ''; return { pass: 'bg-emerald-50 text-emerald-900', fail: 'bg-rose-50 text-rose-900', incomplete: 'bg-amber-50 text-amber-900' }[r.result.overall]; });
    const bannerIcon = computed(() => { const r = round.value; if (!r || !r.result) return 'info'; return { pass: 'check', fail: 'alert', incomplete: 'info' }[r.result.overall]; });
    const resultDesc = computed(() => {
      const r = round.value; if (!r || !r.result) return '';
      const res = r.result, out = [];
      const ng = t.value.snap.items.filter((i) => res.byCid[i.cid] && res.byCid[i.cid].status === 'ng').map((i) => '#' + i.no + ' ' + i.name);
      if (res.m.total) out.push('计量组 ' + res.m.total + ' 项：符合 ' + res.m.ok + '，不符合 ' + res.m.ng + '，缺失 ' + res.m.missing + '。');
      if (res.c) out.push('计数组 n=' + res.c.n + '：不良单位数 d=' + res.c.d + '（Ac ' + res.c.ac + ' / Re ' + res.c.re + '）→ ' + STATUS.result[res.c.result][0] + '。');
      if (ng.length) out.push('不符合项：' + ng.join('、') + '。');
      if (res.overall === 'pass') out.push(res.c ? (res.c.d > 0 ? '批接受不消除已发现的不良，' + res.c.d + ' 件不良仍须单独处置。' : '') : '结论仅覆盖本轮被检样本与项目，不构成整批接受或放行。');
      if (res.overall === 'incomplete') out.push('缺失原因：' + (r.missingReason || '未填写') + '。缺失不等于合格，可发起补测轮次。');
      if (res.overall === 'fail') out.push('原不符合记录永久保留；返工或挑选后请发起复检（新轮次）。');
      return out.join(' ');
    });

    /* —— 登记不合格 / 复检 / 报告预览 —— */
    const openNcr = () => {
      const r = round.value, items = t.value.snap.items.filter((i) => ngCids.value.includes(i.cid));
      const lines = items.map((it) => {
        if (it.group === 'C') return '#' + it.no + ' ' + it.name + '：不良 ' + (r.cnt[it.cid].bad || 0) + ' 件' + (r.cnt[it.cid].note ? '（' + r.cnt[it.cid].note + '）' : '');
        const bad = r.samples.map((s, i) => ({ s, v: r.vals[it.cid][i], st: judgeValue(r.vals[it.cid][i], it) })).filter((x) => x.st === 'high' || x.st === 'low');
        return '#' + it.no + ' ' + it.name + '（' + specText(it) + '）：' + bad.map((x) => x.s + ' = ' + x.v + (x.st === 'high' ? ' 超上限' : ' 低于下限')).join('，');
      });
      UI.newNcr = {
        taskId: t.value.id, roundId: r.id, partId: t.value.partId, cids: ngCids.value.slice(), batch: t.value.ctx.batch || t.value.ctx.wo || '',
        title: part.value.name + ' ' + (items[0] ? items[0].name : '') + (items.length > 1 ? ' 等 ' + items.length + ' 项' : '') + '不符合',
        desc: scene.value.name + ' ' + t.value.code + ' 第 ' + r.no + ' 轮发现：\n' + lines.join('\n'), qtySuspect: t.value.lot || '',
        photos: r.photos.filter((p) => ngCids.value.includes(p.cid)).map((p) => ({ id: p.id, url: p.url })),
      };
    };
    const rt = reactive({ open: false, reason: '', mode: 'new', picks: [], ncrId: '' });
    const lastRound = computed(() => (t.value ? t.value.rounds[t.value.rounds.length - 1] : null));
    const nMeasure = computed(() => { const g = t.value ? t.value.snap.groups.find((x) => x.type === 'measure') : null; return g ? g.n : 0; });
    const openRetest = () => {
      const q = UI.route.query, n = q.ncr ? S.ncrs.find((x) => x.id === q.ncr || x.code === q.ncr) : null;
      rt.reason = n ? n.code + ' 处置后复检' : ''; rt.ncrId = n ? n.id : ''; rt.mode = 'new'; rt.picks = []; rt.open = true;
    };
    const togglePick = (s) => { const i = rt.picks.indexOf(s); if (i >= 0) rt.picks.splice(i, 1); else rt.picks.push(s); };
    const doRetest = () => {
      try {
        const r = createRetestRound(t.value, { reason: rt.reason, sampleMode: rt.mode, samples: rt.picks.slice(), ncrId: rt.ncrId });
        rt.open = false; toast('已发起第 ' + r.no + ' 轮复检，原轮次记录保留', 'success');
      } catch (e) { toast(e.message, 'error'); }
    };
    const pvw = ref(null);
    const openPreview = () => {
      const tmp = Object.assign(clone(round.value), { result: summarizeEval(ev.value), submittedAt: null });
      const r = buildReport(S, t.value, tmp, '预览');
      r.state = 'preview'; pvw.value = r;
    };

    /* —— 下一步引导：永远只告诉使用者一件该做的事，点按钮就跳到对应位置 —— */
    const showInfo = ref(false);
    const nextAct = computed(() => {
      const e = ev.value, r = round.value;
      if (!e || !r || r.status !== 'active') return { kind: 'none', text: '', btn: '', perm: 'task.measure', icon: 'check' };
      const m = e.missingCells[0];
      if (m && m.i >= 0) return { kind: 'cell', text: '录入 #' + m.it.no + ' ' + m.it.name + ' 的样本 ' + m.s, btn: '去录入', perm: 'task.measure', icon: 'edit', cid: m.it.cid, i: m.i };
      if (m) return { kind: 'count', text: '登记 #' + m.it.no + ' ' + m.it.name + ' 的不良数（没有不良填 0）', btn: '去登记', perm: 'task.measure', icon: 'edit', cid: m.it.cid };
      if (pv.value.length) return { kind: 'photo', text: '给 #' + pv.value[0].no + ' ' + pv.value[0].name + ' 拍照', btn: '去拍照', perm: 'task.measure', icon: 'camera', cid: pv.value[0].cid };
      return { kind: 'submit', text: '数据已录完，检查后签名提交', btn: '签名提交', perm: 'task.submit', icon: 'pen' };
    });
    const doNext = () => {
      const a = nextAct.value;
      if (a.kind === 'cell') {
        const r = mItems.value.findIndex((x) => x.cid === a.cid);
        tab.value = 'M'; sel.value = a.cid; cardIdx.value = Math.max(0, r);
        nextTick(() => {
          if (mode.value === 'grid') { focusCell(r, a.i); return; }
          const el = document.querySelector('[data-card-cell="' + a.i + '"]'); if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        });
      } else if (a.kind === 'count') {
        tab.value = 'C'; sel.value = a.cid;
        nextTick(() => { const el = document.querySelector('[data-cnt="' + a.cid + '"]'); if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } });
      } else if (a.kind === 'photo') { photoFor.value = a.cid; }
      else if (a.kind === 'submit') openSubmit();
    };
    /* 顶部“这张检验的进度”流程条：点某一步时留在本页，定位到对应的操作 */
    watch(() => UI.flowAct, (a) => {
      if (!a || !t.value || !t.value.rounds.length) return;
      ridx.value = t.value.rounds.length - 1;
      const live = active.value, n = nextAct.value;
      if (a.key === 'measure') {
        if (live && (n.kind === 'cell' || n.kind === 'count')) doNext();
        else { tab.value = mItems.value.length ? 'M' : 'C'; toast(live ? '读数已经录完，可以继续拍照或签名提交' : '这一轮已经提交，数据只能查看', 'info'); }
      } else if (a.key === 'photo') {
        if (live && pv.value.length) photoFor.value = pv.value[0].cid; else tab.value = 'P';
      } else if (a.key === 'sign') {
        if (!live) toast('这一轮已经签名提交', 'info');
        else if (!can('task.submit')) toast(denyTip('task.submit'), 'warn');
        else openSubmit();
      } else if (a.key === 'result') {
        if (rep.value) go('/reports/' + rep.value.id); else toast('签名提交后才有结论和报告', 'info');
      }
    });

    const pipe = computed(() => {
      const st = {}, r = round.value, e = ev.value;
      if (!r || !e) return st;
      const steps = scene.value.steps, has = (k) => steps.includes(k);
      st.basis = 'done'; if (has('sampling')) st.sampling = 'done';
      if (r.status === 'submitted') {
        steps.forEach((k) => { st[k] = 'done'; });
        if (has('import') && !r.imports.length) st.import = null;
        if (has('photo') && !r.photos.length) st.photo = null;
        if (has('review')) st.review = rep.value && rep.value.state === 'approved' ? 'done' : rep.value && rep.value.state === 'review' ? 'active' : null;
        return st;
      }
      st.measure = e.progress >= 1 ? 'done' : 'active';
      if (has('import') && r.imports.length) st.import = 'done';
      if (has('photo')) st.photo = pv.value.length ? 'warn' : r.photos.length ? 'done' : null;
      if (e.progress >= 1) st.check = pv.value.length ? 'warn' : 'active';
      return st;
    });

    onMounted(() => {
      if (UI.route.query.retest === '1' && t.value && lastRound.value && lastRound.value.status === 'submitted' && can('task.retest')) openRetest();
    });
    return { t, ridx, round, ev, scene, part, mItems, cItems, cg, isLast, active, editable, tab, tabOpts, mode, cardIdx, cardItem, sel, selItem, statusMap, pv, pvSet, rep, ncrs, ngCids, roundOpts, touch, pick, cardGo, cellCls, cntCls, badgeCls, rowStat, onCellKey, onPaste, photoFor, photoItem, photosOf, addPhotos, removePhoto, photoRows, imp, genDemoImport, parseImport, applyImport, sub, needSign, blockers, missingText, overallKey, cText, cTone, submitLabel, canSubmit, openSubmit, doSubmit, resultLabel, bannerCls, bannerIcon, resultDesc, openNcr, rt, lastRound, nMeasure, openRetest, togglePick, doRetest, pvw, openPreview, pipe, showInfo, nextAct, doNext };
  },
  template: `
<div v-if="t && round && ev" class="space-y-4 pb-6">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <button class="text-xs text-ink-3 hover:text-ink inline-flex items-center gap-1 mb-2" @click="go('/tasks/' + t.scene)"><ic name="chevron-left" :size="13"/>{{ scene.name }}</button>
      <div class="flex flex-wrap items-center gap-2"><h1 class="page-title font-mono">{{ t.code }}</h1><span class="chip" :class="SCENE_META[t.scene].tint">{{ scene.name }}</span><st k="task" :v="t.status" dot/></div>
      <p class="text-xs text-ink-3 mt-1">{{ part.partNo }} {{ part.name }} · {{ ctxText(t) || '无外部单据（独立运行）' }}<button class="link ml-2 inline-flex items-center gap-0.5" @click="showInfo = !showInfo">{{ showInfo ? '收起' : '检验依据与流程' }}<ic name="chevron-down" :size="12" class="transition-transform duration-300" :class="showInfo ? 'rotate-180' : ''"/></button></p>
    </div>
    <div class="flex flex-wrap gap-2">
      <template v-if="active && isLast">
        <button class="btn-ghost" @click="openPreview"><ic name="eye" :size="15"/>预览报告</button>
        <g-btn v-if="scene.steps.includes('import') && mItems.length" perm="task.measure" cls="btn-secondary" icon="cpu" @click="imp.open = true">设备导入</g-btn>
        <g-btn perm="task.submit" cls="btn-primary" icon="pen" @click="openSubmit">签名提交</g-btn>
      </template>
      <template v-else>
        <button v-if="rep" class="btn-secondary" @click="go('/reports/' + rep.id)"><ic name="file" :size="15"/>查看报告</button>
        <g-btn v-if="isLast && ngCids.length" perm="ncr.create" cls="btn-secondary" icon="alert" @click="openNcr">登记不合格</g-btn>
        <g-btn v-if="isLast && t.status !== 'pass'" perm="task.retest" cls="btn-primary" icon="rotate-ccw" @click="openRetest">发起复检</g-btn>
      </template>
    </div>
  </div>

  <div v-show="showInfo" class="card p-5 space-y-4">
    <div class="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-x-6 gap-y-3">
      <kv k="零件" :v="part.partNo + ' ' + part.name"/>
      <kv k="图纸" :v="part.drawingNo + ' Rev ' + t.snap.std.drawingRev" mono/>
      <kv v-if="t.lot" k="批量" :v="t.lot + ' 件'"/>
      <kv v-for="k in scene.ctx.filter(x => t.ctx[x])" :key="k" :k="CTX_FIELDS[k].label" :v="t.ctx[k]"/>
      <kv k="检验员"><span class="inline-flex items-center gap-1.5"><avatar :uid="t.assignee" :size="18"/>{{ userName(t.assignee) }}</span></kv>
      <kv k="截止" :v="fmtTime(t.due)"/>
    </div>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl bg-[#f7f7f9] px-3.5 py-2.5 text-[12px] text-ink-2">
      <span class="inline-flex items-center gap-1.5 font-medium text-ink"><ic name="lock" :size="13"/>检验依据快照（建单时冻结，执行中不可改）</span>
      <span>场景 {{ scene.name }} v{{ scene.ver }}</span>
      <span>标准 <button class="link" @click="go('/standards/' + t.snap.std.id)">{{ t.snap.std.code }} Rev {{ t.snap.std.rev }}</button></span>
      <span>方案 <button class="link" @click="go('/plans/' + t.snap.plan.id)">{{ t.snap.plan.code }} Rev {{ t.snap.plan.rev }}</button></span>
      <span v-for="g in t.snap.groups" :key="g.key">{{ g.type === 'measure' ? '计量组 n=' + g.n : '计数组 n=' + g.n + ' · Ac ' + g.ac + ' / Re ' + g.re }}</span>
      <span>拍照：{{ PHOTO_POLICY[scene.photo || 'none'] }}</span><span>复核：{{ REVIEW_POLICY[scene.review || 'never'] }}</span>
    </div>
    <scene-pipeline :steps="scene.steps" :states="pipe"/>
  </div>

  <div v-if="t.rounds.length > 1" class="flex flex-wrap items-center gap-3">
    <seg v-model="ridx" :options="roundOpts"/>
    <span v-if="round.parent" class="text-xs text-ink-3">复检原因：{{ round.reason }} · {{ round.sampleMode === 'subset' ? '原样本子集' : '新取样本' }}。原轮次的不符合记录保留，不被覆盖。</span>
  </div>

  <next-step v-if="!active && isLast" v-bind="nextOf('task', t)"/>

  <div v-if="!active" class="rounded-2xl px-5 py-4 flex flex-wrap items-start gap-4" :class="bannerCls">
    <span class="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 bg-white/70"><ic :name="bannerIcon" :size="20"/></span>
    <div class="flex-1 min-w-[240px]">
      <div class="font-semibold text-[15px]">第 {{ round.no }} 轮结论：{{ resultLabel }}</div>
      <p class="text-[12.5px] mt-1 leading-relaxed opacity-90">{{ resultDesc }}</p>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[12px]">
        <span v-if="round.signer" class="inline-flex items-center gap-1.5 opacity-90"><ic name="pen" :size="12"/>{{ round.signer.name }} 于 {{ fmtTime(round.submittedAt) }} 签名提交</span>
        <span v-if="rep" class="inline-flex items-center gap-1.5"><ic name="file" :size="12"/>报告 <button class="underline underline-offset-2" @click="go('/reports/' + rep.id)">{{ rep.code }}</button><st k="report" :v="rep.state"/></span>
        <span v-for="n in ncrs" :key="n.id" class="inline-flex items-center gap-1.5"><ic name="alert" :size="12"/><button class="underline underline-offset-2" @click="go('/ncr/' + n.id)">{{ n.code }}</button><st k="ncr" :v="n.status"/></span>
      </div>
    </div>
    <img v-if="round.signer && round.signer.img" :src="round.signer.img" class="h-12 rounded-lg bg-white/70 px-2" alt="检验员签名">
  </div>

  <div class="grid grid-cols-1 xl:grid-cols-12 gap-4">
    <div class="xl:col-span-5 space-y-3 xl:sticky xl:top-[calc(72px+var(--flow-h))] self-start">
      <div class="card p-3 h-[320px] xl:h-[460px]"><drawing-viewer :svg="stdSvg(t.snap.std.id) || part.svg" :items="t.snap.items" :status="statusMap" :selected="sel" focus-on-select @select="pick"/></div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-ink-4">
        <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>符合</span><span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-rose-500"></span>不符合</span><span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-white ring-1 ring-zinc-400"></span>待测</span><span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span>当前选中</span><span>滚轮缩放 · 拖拽平移 · 点击气泡定位</span>
      </div>
      <div v-if="selItem" class="card p-4 flex items-start gap-3">
        <span class="balloon-badge shrink-0" :class="badgeCls(selItem)">{{ selItem.no }}</span>
        <div class="flex-1 min-w-0">
          <div class="font-medium flex items-center gap-1.5">{{ selItem.name }}<span v-if="selItem.cls !== '一般'" :class="selItem.cls === 'CTQ' ? 'chip-red' : 'chip-amber'">{{ selItem.cls }}</span></div>
          <div class="text-xs text-ink-3 mt-0.5 font-mono">{{ specText(selItem) }} {{ selItem.kind === 'count' ? '' : selItem.unit }}</div>
          <div class="text-[11px] text-ink-4 mt-1">{{ selItem.cat }} · {{ gaugeLabel(selItem.gauge) }} · {{ selItem.cid }}</div>
        </div>
        <button class="btn-secondary btn-sm" @click="photoFor = selItem.cid"><ic name="camera" :size="14"/>照片<span v-if="photosOf(selItem.cid).length" class="tabular">{{ photosOf(selItem.cid).length }}</span></button>
      </div>
    </div>

    <div class="xl:col-span-7 card overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5 pb-3 border-b border-black/[0.05]">
        <seg v-model="tab" :options="tabOpts" size="sm"/>
        <div class="flex items-center gap-2">
          <span v-if="tab === 'M' && mode === 'grid' && editable" class="text-[11px] text-ink-4 hidden md:inline">Enter / 方向键切换单元格 · 支持从 Excel 多格粘贴</span>
          <seg v-if="tab === 'M'" v-model="mode" :options="[{ value: 'grid', label: '网格' }, { value: 'card', label: '逐项' }]" size="sm"/>
        </div>
      </div>

      <div v-if="tab === 'M' && mode === 'grid'" class="overflow-auto max-h-[600px]">
        <table class="tbl">
          <thead><tr><th class="left-0 !z-20">气泡</th><th>特性 / 规格</th><th v-for="s in round.samples" :key="s" class="text-center">{{ s }}</th><th>均值 / 极差</th><th>判定</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(it,r) in mItems" :key="it.cid" :id="'irow-' + it.cid" :class="sel === it.cid ? 'bg-amber-50/60' : ''" @click="sel = it.cid">
              <td class="sticky left-0 z-[1]" :class="sel === it.cid ? 'bg-amber-50' : 'bg-white'"><span class="balloon-badge" :class="badgeCls(it)">{{ it.no }}</span></td>
              <td class="min-w-[176px]"><div class="font-medium flex items-center gap-1.5">{{ it.name }}<span v-if="it.cls !== '一般'" :class="it.cls === 'CTQ' ? 'chip-red' : 'chip-amber'">{{ it.cls }}</span></div><div class="text-[11px] text-ink-3 font-mono mt-0.5">{{ specText(it) }} {{ it.unit }}</div><div class="text-[10.5px] text-ink-4">{{ gaugeLabel(it.gauge) }}</div></td>
              <td v-for="(s,i) in round.samples" :key="s" class="!px-1 text-center"><input class="cell" :class="cellCls(it, i)" v-model.trim="round.vals[it.cid][i]" @input="touch" :disabled="!editable" inputmode="decimal" autocomplete="off" :data-r="r" :data-c="i" @keydown="onCellKey($event, r, i)" @paste="onPaste($event, r, i)" @focus="sel = it.cid" :aria-label="'#' + it.no + ' ' + it.name + ' ' + s"></td>
              <td class="font-mono text-[12px] whitespace-nowrap"><template v-if="rowStat(it)">{{ rowStat(it).mean }}<span class="text-ink-4"> / {{ rowStat(it).range }}</span></template><span v-else class="text-ink-5">—</span></td>
              <td class="whitespace-nowrap"><span v-if="ev.byCid[it.cid].status === 'ok'" class="chip-green"><ic name="check" :size="11" stroke="2.6"/>符合</span><span v-else-if="ev.byCid[it.cid].status === 'ng'" class="chip-red">不符合 {{ ev.byCid[it.cid].ng }}</span><span v-else class="chip-gray">待测 {{ ev.byCid[it.cid].miss }}</span></td>
              <td><button class="btn-icon relative" :class="pvSet.has(it.cid) ? '!text-amber-600 !bg-amber-50' : ''" @click.stop="photoFor = it.cid" :title="pvSet.has(it.cid) ? '该特性需要拍照' : '现场照片'"><ic name="camera" :size="15"/><span v-if="photosOf(it.cid).length" class="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-brand-600 text-white text-[9px] font-semibold flex items-center justify-center">{{ photosOf(it.cid).length }}</span></button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="tab === 'M' && mode === 'card' && cardItem" class="p-4 sm:p-5">
        <div class="flex items-center justify-between gap-3">
          <button class="btn-icon" :disabled="cardIdx === 0" @click="cardGo(-1)" aria-label="上一项"><ic name="chevron-left" :size="18"/></button>
          <div class="text-center min-w-0"><div class="text-[11px] text-ink-4">{{ cardIdx + 1 }} / {{ mItems.length }}</div><div class="font-semibold text-[15px] truncate"><span class="text-brand-700">#{{ cardItem.no }}</span> {{ cardItem.name }}</div><div class="font-mono text-[12.5px] text-ink-3">{{ specText(cardItem) }} {{ cardItem.unit }} · {{ gaugeLabel(cardItem.gauge) }}</div></div>
          <button class="btn-icon" :disabled="cardIdx >= mItems.length - 1" @click="cardGo(1)" aria-label="下一项"><ic name="chevron-right" :size="18"/></button>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-5">
          <label v-for="(s,i) in round.samples" :key="s" class="block"><span class="text-[11px] text-ink-4">样本 {{ s }}</span><input class="cell !w-full !h-12 !text-[17px] mt-1" :data-card-cell="i" :class="cellCls(cardItem, i)" v-model.trim="round.vals[cardItem.cid][i]" @input="touch" @focus="sel = cardItem.cid" :disabled="!editable" inputmode="decimal" autocomplete="off"></label>
        </div>
        <div class="mt-4 flex items-center justify-between">
          <span v-if="ev.byCid[cardItem.cid].status === 'ok'" class="chip-green">符合</span><span v-else-if="ev.byCid[cardItem.cid].status === 'ng'" class="chip-red">不符合 {{ ev.byCid[cardItem.cid].ng }}</span><span v-else class="chip-gray">待测 {{ ev.byCid[cardItem.cid].miss }}</span>
          <span v-if="rowStat(cardItem)" class="font-mono text-[12px] text-ink-3">均值 {{ rowStat(cardItem).mean }} · 极差 {{ rowStat(cardItem).range }}</span>
        </div>
        <div class="mt-5"><div class="label flex items-center gap-2">现场照片<span v-if="pvSet.has(cardItem.cid)" class="chip-amber">需要拍照</span></div><photo-strip :photos="photosOf(cardItem.cid)" :readonly="!editable" @add="addPhotos(cardItem.cid, $event)" @remove="removePhoto"/></div>
        <div class="flex justify-center gap-1.5 mt-5"><button v-for="(it,i) in mItems" :key="it.cid" class="h-1.5 rounded-full transition-all duration-300" :class="[i === cardIdx ? 'w-5 bg-brand-600' : 'w-1.5', i !== cardIdx ? (statusMap[it.cid] === 'ng' ? 'bg-rose-400' : statusMap[it.cid] === 'ok' ? 'bg-emerald-400' : 'bg-black/15') : '']" @click="cardIdx = i; sel = it.cid" :aria-label="'第 ' + (i + 1) + ' 项'"></button></div>
      </div>

      <div v-if="tab === 'C' && cg && ev.c" class="p-4 sm:p-5 space-y-4">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px]"><span class="chip-amber">计数抽样 · 一次</span><span>样本量 n = <b>{{ cg.n }}</b></span><span>Ac = <b>{{ cg.ac }}</b></span><span>Re = <b>{{ cg.re }}</b></span><span class="text-ink-4 text-[11.5px]">{{ cg.aql ? 'AQL ' + cg.aql + ' · ' : '' }}方案设定，开检时继承，不可临时修改</span></div>
        <div class="overflow-x-auto"><table class="tbl">
          <thead><tr><th>气泡</th><th>特性 / 判定要求</th><th class="w-[110px]">不良数（件）</th><th>备注</th><th>判定</th><th></th></tr></thead>
          <tbody>
            <tr v-for="it in cItems" :key="it.cid" :id="'irow-' + it.cid" :class="sel === it.cid ? 'bg-amber-50/60' : ''" @click="sel = it.cid">
              <td><span class="balloon-badge" :class="badgeCls(it)">{{ it.no }}</span></td>
              <td class="min-w-[180px]"><div class="font-medium flex items-center gap-1.5">{{ it.name }}<span v-if="it.cls !== '一般'" :class="it.cls === 'CTQ' ? 'chip-red' : 'chip-amber'">{{ it.cls }}</span></div><div class="text-[11px] text-ink-3 mt-0.5">{{ specText(it) }} · {{ gaugeLabel(it.gauge) }}</div></td>
              <td><input class="cell !w-[88px]" :data-cnt="it.cid" :class="cntCls(it)" v-model.trim="round.cnt[it.cid].bad" @input="touch" @focus="sel = it.cid" :disabled="!editable" inputmode="numeric" autocomplete="off" placeholder="未录入"></td>
              <td class="min-w-[160px]"><input class="input !h-8" v-model="round.cnt[it.cid].note" :disabled="!editable" placeholder="缺陷描述（可选）"></td>
              <td class="whitespace-nowrap"><span v-if="ev.byCid[it.cid].status === 'ok'" class="chip-green">无不良</span><span v-else-if="ev.byCid[it.cid].status === 'ng'" class="chip-red">不良 {{ ev.byCid[it.cid].bad }}</span><span v-else class="chip-gray">待录入</span></td>
              <td><button class="btn-icon relative" :class="pvSet.has(it.cid) ? '!text-amber-600 !bg-amber-50' : ''" @click.stop="photoFor = it.cid" :title="pvSet.has(it.cid) ? '该特性需要拍照' : '现场照片'"><ic name="camera" :size="15"/><span v-if="photosOf(it.cid).length" class="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-brand-600 text-white text-[9px] font-semibold flex items-center justify-center">{{ photosOf(it.cid).length }}</span></button></td>
            </tr>
          </tbody>
        </table></div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="rounded-2xl bg-[#f7f7f9] p-4"><div class="label">不良单位数 d</div><input class="cell !w-full !h-10 !text-[15px]" v-model.trim="round.dUnits" @input="touch" :placeholder="'自动 = ' + ev.c.total" :disabled="!editable" inputmode="numeric" autocomplete="off"><p class="text-[11px] text-ink-4 mt-2 leading-relaxed">默认等于各项不良数之和；同一件有多处不良时可下调，但不得小于单项最大值 {{ ev.c.maxb }}。</p></div>
          <div class="md:col-span-2 rounded-2xl p-4 ring-1 ring-inset" :class="cTone"><div class="flex items-center gap-2"><st k="result" :v="ev.c.result"/><span class="font-semibold">d = {{ ev.c.d }} · Ac {{ ev.c.ac }} / Re {{ ev.c.re }}</span></div><p class="text-[12.5px] mt-2 leading-relaxed">{{ cText }}</p></div>
        </div>
      </div>

      <div v-if="tab === 'P'" class="p-4 sm:p-5 space-y-5">
        <div><div class="label">本轮通用照片（包装、标签、现场环境等）</div><photo-strip :photos="photosOf('')" :readonly="!editable" @add="addPhotos('', $event)" @remove="removePhoto"/></div>
        <div v-for="it in photoRows" :key="it.cid"><div class="label flex items-center gap-2">#{{ it.no }} {{ it.name }}<span v-if="pvSet.has(it.cid)" class="chip-amber">需要拍照</span></div><photo-strip :photos="photosOf(it.cid)" :readonly="!editable" @add="addPhotos(it.cid, $event)" @remove="removePhoto"/></div>
        <p class="text-[11px] text-ink-4 leading-relaxed">拍照要求：{{ PHOTO_POLICY[scene.photo || 'none'] }}。手机端点“拍照”直接调用相机；照片在浏览器端压缩（长边 ≤1280px）后保存。正式系统上传至私有对象存储并记录文件摘要。</p>
        <div v-if="round.imports.length" class="pt-4 border-t border-black/[0.06]"><div class="label">设备导入记录</div><div v-for="x in round.imports" :key="x.id" class="text-[12px] text-ink-2 py-1">{{ fmtTime(x.at) }} · {{ x.device }} · 入账 {{ x.applied }}（真实超差 {{ x.oot }}）· 格式异常 {{ x.fmt }} · 无法匹配 {{ x.unknown }} · 幂等键 <span class="font-mono text-ink-4">{{ x.key }}</span></div></div>
      </div>
    </div>
  </div>

  <div v-if="active && isLast" class="sticky bottom-4 z-20">
    <div class="glass rounded-2xl shadow-lift ring-1 ring-black/[0.06] px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2">
      <div class="flex items-center gap-3 min-w-[200px] flex-1">
        <div class="flex-1 h-2 rounded-full bg-black/[0.07] overflow-hidden"><div class="h-full rounded-full bg-brand-500 transition-all duration-700 ease-apple" :style="{ width: Math.round(ev.progress * 100) + '%' }"></div></div>
        <span class="text-[12px] tabular text-ink-3 whitespace-nowrap">已录 {{ ev.filled }} / {{ ev.total }}</span>
      </div>
      <div class="flex flex-wrap items-center gap-1.5 text-[12px]">
        <span v-if="ev.m.total" class="chip-green">符合 {{ ev.m.ok }}</span><span v-if="ev.m.ng" class="chip-red">不符合 {{ ev.m.ng }}</span><span v-if="ev.m.missing" class="chip-gray">待测 {{ ev.m.missing }}</span>
        <span v-if="ev.c" class="inline-flex items-center gap-1 text-ink-3">计数组<st k="result" :v="ev.c.result"/></span>
        <span v-if="pv.length" class="chip-amber"><ic name="camera" :size="11"/>待拍照 {{ pv.length }}</span>
      </div>
      <div class="flex items-center gap-3 ml-auto"><span class="text-[12.5px] hidden md:inline max-w-[360px] truncate"><span class="text-ink-4">下一步　</span><span class="font-medium">{{ nextAct.text }}</span></span><g-btn :perm="nextAct.perm" cls="btn-primary" :icon="nextAct.icon" @click="doNext">{{ nextAct.btn }}</g-btn></div>
    </div>
  </div>

  <drawer :open="photoFor !== null" @close="photoFor = null" :title="photoItem ? '#' + photoItem.no + ' ' + photoItem.name + ' · 现场照片' : '现场照片'" :sub="'拍照要求：' + PHOTO_POLICY[scene.photo || 'none']">
    <template v-if="photoFor !== null">
      <photo-strip :photos="photosOf(photoFor)" :readonly="!editable" size="w-28 h-28" @add="addPhotos(photoFor, $event)" @remove="removePhoto"/>
      <empty v-if="!photosOf(photoFor).length && !editable" icon="image" title="该特性没有照片"/>
    </template>
  </drawer>

  <modal :open="sub.open" @close="sub.open = false" title="签名提交本轮检验" :sub="t.code + ' · 第 ' + round.no + ' 轮'" width="max-w-2xl">
    <div class="space-y-5">
      <section>
        <div class="flex items-center gap-2 mb-2"><span class="w-5 h-5 rounded-full bg-brand-600 text-white text-[11px] font-semibold flex items-center justify-center">1</span><span class="font-semibold">完整性检查</span></div>
        <div v-if="!ev.missingCells.length && !blockers.length" class="rounded-xl bg-emerald-50 text-emerald-800 px-3.5 py-2.5 text-[12.5px] flex items-center gap-2"><ic name="check" :size="14"/>全部 {{ ev.total }} 个读数已录入，拍照要求已满足。</div>
        <div v-if="blockers.length" class="rounded-xl bg-rose-50 text-rose-800 px-3.5 py-2.5 text-[12.5px] space-y-1"><div class="font-medium">以下问题必须先处理：</div><div v-for="b in blockers" :key="b">· {{ b }}</div></div>
        <div v-if="ev.missingCells.length" class="rounded-xl bg-amber-50 text-amber-900 px-3.5 py-2.5 text-[12.5px] mt-2">
          <div class="font-medium">缺失 {{ ev.missingCells.length }} 个读数：{{ missingText }}</div>
          <p class="mt-1 opacity-90">缺失不等于合格，也不会补零。可以返回补测；或填写原因后以“证据不足”提交，之后通过新轮次补测。</p>
          <textarea v-model="sub.reason" rows="2" class="textarea mt-2" placeholder="缺失原因，例如：样本 S5 外送理化检测，结果未回"></textarea>
        </div>
      </section>
      <section>
        <div class="flex items-center gap-2 mb-2"><span class="w-5 h-5 rounded-full bg-brand-600 text-white text-[11px] font-semibold flex items-center justify-center">2</span><span class="font-semibold">系统判定</span><st k="result" :v="overallKey"/></div>
        <div class="rounded-xl bg-[#f7f7f9] px-3.5 py-2.5 text-[12.5px] text-ink-2 space-y-1 leading-relaxed">
          <div v-if="ev.m.total">计量组 {{ ev.m.total }} 项：符合 {{ ev.m.ok }}，不符合 {{ ev.m.ng }}，缺失 {{ ev.m.missing }}。<span v-if="!ev.c && overallKey === 'pass'">结论仅覆盖本轮被检样本与项目，不构成整批接受。</span></div>
          <div v-if="ev.c">计数组：{{ cText }}</div>
          <div class="text-[11.5px] text-ink-4">判定由系统按建单时冻结的规格执行；提交后内容冻结，只能通过新轮次复检或追加更正。</div>
        </div>
      </section>
      <section v-if="needSign">
        <div class="flex items-center gap-2 mb-2"><span class="w-5 h-5 rounded-full bg-brand-600 text-white text-[11px] font-semibold flex items-center justify-center">3</span><span class="font-semibold">电子签名</span><span class="text-[11.5px] text-ink-4">{{ who().name }} · {{ ROLES[who().role].name }}</span></div>
        <signature-pad v-model="sub.sig" :signer="who().name"/>
      </section>
    </div>
    <template #footer><button class="btn-secondary" @click="sub.open = false">返回补测</button><button class="btn-primary" :disabled="!canSubmit" @click="doSubmit"><ic name="check" :size="15"/>{{ submitLabel }}</button></template>
  </modal>

  <modal :open="imp.open" @close="imp.open = false" title="设备数据导入" sub="CMM / 电子量具 / Excel 报文按气泡特性回填，对应接口 POST /api/v1/iot/gage-measurements" width="max-w-3xl">
    <div class="space-y-3">
      <div class="flex flex-wrap items-center gap-2"><button class="btn-soft btn-sm" @click="genDemoImport"><ic name="sparkles" :size="14"/>生成演示报文（模拟 CMM-01）</button><span class="text-[11px] text-ink-4">也可粘贴 JSON 报文，或每行“气泡号,样本序号,实测值”的文本</span></div>
      <textarea v-model="imp.text" rows="9" class="textarea font-mono !text-[11.5px]" placeholder="粘贴设备报文…" @input="imp.result = null"></textarea>
      <div v-if="imp.result" class="space-y-2.5">
        <div v-if="imp.result.dup" class="rounded-xl bg-amber-50 text-amber-900 px-3.5 py-2.5 text-[12.5px]">重复导入：幂等键 <span class="font-mono">{{ imp.result.key }}</span> 已导入过，不会重复入账。</div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
          <div class="rounded-xl bg-emerald-50 py-3"><div class="text-xl font-semibold tabular text-emerald-700">{{ imp.result.ok.length }}</div><div class="text-[11px] text-ink-3">符合，可入账</div></div>
          <div class="rounded-xl bg-rose-50 py-3"><div class="text-xl font-semibold tabular text-rose-700">{{ imp.result.oot.length }}</div><div class="text-[11px] text-ink-3">真实超差，必须入账</div></div>
          <div class="rounded-xl bg-amber-50 py-3"><div class="text-xl font-semibold tabular text-amber-700">{{ imp.result.fmt.length }}</div><div class="text-[11px] text-ink-3">格式异常，不入账</div></div>
          <div class="rounded-xl bg-black/[0.04] py-3"><div class="text-xl font-semibold tabular text-ink-2">{{ imp.result.unknown }}</div><div class="text-[11px] text-ink-3">无法匹配特性 / 样本</div></div>
        </div>
        <div v-if="imp.result.oot.length" class="text-[12px] text-rose-700 leading-relaxed">真实超差：<span v-for="(x,i) in imp.result.oot" :key="i" class="mr-3 font-mono">#{{ x.it.no }} {{ round.samples[x.si] }} = {{ x.v }}</span></div>
        <div v-if="imp.result.fmt.length" class="text-[12px] text-amber-800 leading-relaxed">格式异常（进入导入异常清单，不影响其它读数）：<span v-for="(x,i) in imp.result.fmt" :key="i" class="mr-3 font-mono">#{{ x.it.no }} {{ round.samples[x.si] }} = “{{ x.v }}”</span></div>
        <div v-if="imp.result.overwrite" class="text-[12px] text-ink-3">将覆盖 {{ imp.result.overwrite }} 个已录入的草稿值（本轮尚未提交）。</div>
      </div>
    </div>
    <template #footer><button class="btn-secondary" @click="imp.open = false">取消</button><button class="btn-secondary" @click="parseImport">解析预览</button><button class="btn-primary" :disabled="!imp.result || imp.result.dup || !(imp.result.ok.length + imp.result.oot.length)" @click="applyImport">导入 {{ imp.result ? imp.result.ok.length + imp.result.oot.length : 0 }} 个读数</button></template>
  </modal>

  <modal :open="rt.open" @close="rt.open = false" title="发起复检（新轮次）" sub="复检不覆盖原轮次：原不符合记录永久保留；不能改变抽样策略类型" width="max-w-xl">
    <label class="label">复检原因</label>
    <textarea v-model="rt.reason" rows="2" class="textarea" placeholder="例如：返工后复检 / 补测缺失读数 / 量具复核后重测"></textarea>
    <template v-if="mItems.length && lastRound">
      <label class="label mt-4">样本来源</label>
      <seg v-model="rt.mode" :options="[{ value: 'new', label: '新取样本' }, { value: 'subset', label: '原样本子集' }]"/>
      <div v-if="rt.mode === 'subset'" class="mt-3 flex flex-wrap gap-1.5"><button v-for="s in lastRound.samples" :key="s" type="button" @click="togglePick(s)" class="h-8 px-3 rounded-full text-xs font-medium ring-1 ring-inset transition-all duration-200" :class="rt.picks.includes(s) ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-ink-3 ring-black/10 hover:ring-brand-400'">{{ s }}</button></div>
      <p class="text-[11.5px] text-ink-4 mt-2 leading-relaxed">{{ rt.mode === 'subset' ? '只复检所选原样本；子集复检符合，不推导整批接受。' : '按方案样本量重新取样 n=' + nMeasure + '。' }}</p>
    </template>
    <template #footer><button class="btn-secondary" @click="rt.open = false">取消</button><button class="btn-primary" @click="doRetest"><ic name="rotate-ccw" :size="15"/>创建复检轮次</button></template>
  </modal>

  <modal :open="!!pvw" @close="pvw = null" title="报告预览" sub="预览不可签发；提交后才冻结为正式报告，缺失值显示为“缺失”而不是补值" width="max-w-[880px]">
    <div class="overflow-x-auto -mx-2"><report-sheet v-if="pvw" :rep="pvw" preview/></div>
  </modal>
</div>
<empty v-else icon="list" title="检验任务不存在或已删除"><button class="btn-secondary" @click="go('/tasks')">返回任务总览</button></empty>`,
};

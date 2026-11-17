/* =====================================================================
 * 页面 B（续）：检验报告（A4 报告单 / 列表 / 详情与复核）· 报告模板
 * 报告只从“冻结内容”渲染，不读取实时任务数据；签名绑定内容摘要（A13）。
 * ===================================================================== */

COMPONENTS['report-sheet'] = {
  props: { rep: Object, preview: Boolean, templateId: String },
  computed: {
    c() { return this.rep.content; },
    tpl() { return tplOf(this.templateId || this.rep.templateId) || { name: '检验报告', withDrawing: true }; },
    title() { return String(this.tpl.name || '检验报告').replace(/（[^）]*）/g, '').replace(/模[版板]/g, '').trim() || '检验报告'; },
    mItems() { return this.c.items.filter((i) => i.group === 'M'); },
    cItems() { return this.c.items.filter((i) => i.group === 'C'); },
    cg() { return this.c.groups.find((g) => g.type === 'count') || null; },
    svg() { const s = this.c.std && stdSvg(this.c.std.id); if (s) return s; const p = S.parts.find((x) => x.partNo === this.c.part.partNo); return p ? svgOf(p) : ''; },
    statusMap() { const m = {}, b = this.c.result.byCid; Object.keys(b).forEach((k) => { m[k] = b[k].status; }); return m; },
    stamp() { return { pass: ['符 合', '#059669'], fail: ['不 符 合', '#e11d48'], incomplete: ['证据不足', '#d97706'] }[this.c.result.overall]; },
    ctxRows() {
      const ctx = this.c.task.ctx || {};
      const cells = Object.keys(CTX_FIELDS).filter((k) => ctx[k]).map((k) => [CTX_FIELDS[k].label, ctx[k], 1]);
      const rows = [];
      for (let i = 0; i < cells.length; i += 3) rows.push(cells.slice(i, i + 3));
      const last = rows[rows.length - 1];
      if (last && last.length < 3) last[last.length - 1][2] = 1 + (3 - last.length) * 2;
      return rows;
    },
    conclusion() {
      const r = this.c.result, out = [];
      if (r.m.total) out.push('计量特性 ' + r.m.total + ' 项：符合 ' + r.m.ok + ' 项，不符合 ' + r.m.ng + ' 项，缺失 ' + r.m.missing + ' 项。');
      if (r.c) out.push('计数抽样：不良单位数 d = ' + r.c.d + '，' + (r.c.result === 'accept' ? '不大于 Ac，批接受' : r.c.result === 'reject' ? '达到 Re，批拒收' : '证据不完整，未作批判定') + '。');
      if (r.overall === 'pass') out.push(r.c ? '本轮检验结论：符合。' + (r.c.d > 0 ? '已发现的不良品另行处置，不因批接受而消除。' : '') : '本轮检验结论：符合。本结论仅覆盖本轮实际被检样本与项目，不构成整批接受或放行。');
      else if (r.overall === 'fail') out.push('本轮检验结论：不符合。不符合项已在上表标示，处置见不合格处置单。');
      else out.push('本轮检验结论：证据不足（缺失原因：' + (this.c.round.missingReason || '未填写') + '）。缺失项未作任何补值。');
      return out.join('');
    },
    cResultText() { const c = this.c.result.c; if (!c) return ''; return { accept: '批接受', reject: '批拒收', continue: '未作批判定' }[c.result]; },
    reviewHint() {
      if (this.preview) return '提交后按场景策略决定是否复核';
      if (this.rep.state === 'review') return '待复核';
      if (this.rep.opinions && this.rep.opinions.length) return '已退回，待重新提请复核';
      return '本场景策略无需复核';
    },
  },
  methods: {
    cellSt(it, i) { return judgeValue(this.c.round.vals[it.cid][i], it); },
    cellText(it, i) { const v = String(this.c.round.vals[it.cid][i] == null ? '' : this.c.round.vals[it.cid][i]).trim(); return v || '缺失'; },
    cellStyle(it, i) { const st = this.cellSt(it, i); if (st === 'high' || st === 'low') return { color: '#e11d48', fontWeight: 700 }; if (st === 'missing' || st === 'invalid') return { color: '#b45309', fontStyle: 'italic' }; return null; },
    rowText(it) { const s = this.statusMap[it.cid]; return s === 'ok' ? '符合' : s === 'ng' ? '不符合' : '缺失'; },
    rowColor(it) { const s = this.statusMap[it.cid]; return s === 'ok' ? '#059669' : s === 'ng' ? '#e11d48' : '#b45309'; },
    cntText(it) { const v = String((this.c.round.cnt[it.cid] || {}).bad == null ? '' : this.c.round.cnt[it.cid].bad).trim(); return v === '' ? '缺失' : v; },
    cntStyle(it) { const s = this.statusMap[it.cid]; return s === 'ng' ? { color: '#e11d48', fontWeight: 700 } : s === 'missing' ? { color: '#b45309', fontStyle: 'italic' } : null; },
    sigOf(kind) { return (this.rep.sigs || []).find((s) => s.kind === kind) || null; },
    valid(sig) { return sigValid(this.rep, sig); },
  },
  template: `
<div class="a4 relative text-[12px] leading-relaxed">
  <div v-if="preview" class="watermark">预览 · 不可签发</div>
  <div class="flex items-start justify-between gap-4 pb-3 border-b-2 border-black">
    <div><div class="text-[11px] text-zinc-500">{{ S.settings.company }}</div><div class="text-[22px] font-bold tracking-wide mt-0.5">{{ title }}</div></div>
    <div class="text-right text-[11px] text-zinc-600 leading-relaxed"><div>报告编号 <span class="font-mono font-semibold text-black">{{ rep.code }}</span></div><div>修订 {{ rep.rev }} · {{ fmtDate(rep.createdAt) }}</div><div>模板：{{ tpl.name }}</div></div>
  </div>

  <table class="mt-4"><tbody>
    <tr><th class="w-[84px] text-left">零件号</th><td>{{ c.part.partNo }}</td><th class="w-[84px] text-left">零件名称</th><td>{{ c.part.name }}</td><th class="w-[84px] text-left">图号 / 版本</th><td>{{ c.part.drawingNo }} / {{ c.part.drawingRev }}</td></tr>
    <tr><th class="text-left">检验场景</th><td>{{ c.task.sceneName }}</td><th class="text-left">任务编号</th><td class="font-mono">{{ c.task.code }}</td><th class="text-left">轮次</th><td>第 {{ c.round.no }} 轮{{ c.round.parent ? '（复检）' : '' }}</td></tr>
    <tr><th class="text-left">检验标准</th><td>{{ c.std.code }} Rev {{ c.std.rev }}</td><th class="text-left">检验方案</th><td>{{ c.plan.code }} Rev {{ c.plan.rev }}</td><th class="text-left">批量</th><td>{{ c.task.lot ? c.task.lot + ' 件' : '—' }}</td></tr>
    <tr v-for="(row,ri) in ctxRows" :key="ri"><template v-for="cell in row" :key="cell[0]"><th class="text-left">{{ cell[0] }}</th><td :colspan="cell[2]">{{ cell[1] }}</td></template></tr>
  </tbody></table>

  <div v-if="tpl.withDrawing && svg" class="mt-4 border border-zinc-300 rounded overflow-hidden h-[300px]"><drawing-viewer :svg="svg" :items="c.items" :status="statusMap" mini/></div>

  <template v-if="mItems.length">
    <div class="mt-4 font-semibold text-[12.5px]">{{ tpl.withDrawing ? '一、' : '' }}计量特性（逐值实测，样本量 n = {{ c.round.samples.length }}）</div>
    <table class="mt-1.5">
      <thead><tr><th class="w-8">气泡</th><th class="text-left">特性</th><th class="text-left">规格</th><th>单位</th><th class="text-left">检具</th><th v-for="s in c.round.samples" :key="s">{{ s }}</th><th class="w-12">判定</th></tr></thead>
      <tbody><tr v-for="it in mItems" :key="it.cid">
        <td class="text-center font-semibold">{{ it.no }}</td>
        <td>{{ it.name }}<span v-if="it.cls !== '一般'" class="ml-1 text-[10px] font-semibold" :style="{ color: it.cls === 'CTQ' ? '#e11d48' : '#d97706' }">{{ it.cls }}</span></td>
        <td class="font-mono whitespace-nowrap">{{ specText(it) }}</td><td class="text-center">{{ it.unit }}</td><td>{{ gaugeLabel(it.gauge) }}</td>
        <td v-for="(s,i) in c.round.samples" :key="s" class="text-center font-mono" :style="cellStyle(it, i)">{{ cellText(it, i) }}</td>
        <td class="text-center font-semibold" :style="{ color: rowColor(it) }">{{ rowText(it) }}</td>
      </tr></tbody>
    </table>
  </template>

  <template v-if="cItems.length && cg">
    <div class="mt-4 font-semibold text-[12.5px]">{{ tpl.withDrawing ? '二、' : '' }}计数特性（一次抽样：n = {{ cg.n }}，Ac = {{ cg.ac }}，Re = {{ cg.re }}{{ cg.aql ? '，AQL ' + cg.aql : '' }}）</div>
    <table class="mt-1.5">
      <thead><tr><th class="w-8">气泡</th><th class="text-left">特性</th><th class="text-left">判定要求</th><th class="text-left">检验方法</th><th class="w-14">不良数</th><th class="text-left">备注</th></tr></thead>
      <tbody>
        <tr v-for="it in cItems" :key="it.cid"><td class="text-center font-semibold">{{ it.no }}</td><td>{{ it.name }}</td><td>{{ it.spec }}</td><td>{{ gaugeLabel(it.gauge) }}</td><td class="text-center font-mono" :style="cntStyle(it)">{{ cntText(it) }}</td><td>{{ (c.round.cnt[it.cid] || {}).note || '' }}</td></tr>
        <tr><th colspan="4" class="text-right">不良单位数 d</th><td class="text-center font-mono font-semibold">{{ c.result.c ? c.result.c.d : '—' }}</td><td class="font-semibold">{{ cResultText }}</td></tr>
      </tbody>
    </table>
  </template>

  <div class="mt-4 border border-zinc-400 rounded p-3 pr-28 relative">
    <div class="font-semibold text-[12.5px]">结论</div>
    <p class="mt-1">{{ conclusion }}</p>
    <p v-if="c.round.parent" class="mt-1 text-zinc-600">本报告对应复检轮次，复检原因：{{ c.round.reason }}。原轮次的不符合记录保留在原报告中。</p>
    <p class="mt-1 text-zinc-500 text-[11px]">现场照片 {{ c.round.photoCount }} 张（存于系统附件）。判定由系统按任务快照中的规格执行，十进制精确比较，规格限含边界。</p>
    <div class="absolute right-3 top-3 px-3 py-1 border-2 rounded font-bold text-[14px] tracking-widest" :style="{ color: stamp[1], borderColor: stamp[1], transform: 'rotate(-8deg)' }">{{ stamp[0] }}</div>
  </div>

  <div class="mt-5 grid grid-cols-2 gap-4">
    <div v-for="k in ['检验', '复核']" :key="k" class="border border-zinc-300 rounded p-3 min-h-[108px]">
      <div class="flex items-center justify-between text-[11px] text-zinc-500"><span>{{ k }}人签名</span><span v-if="sigOf(k)" :style="{ color: valid(sigOf(k)) ? '#059669' : '#e11d48' }">{{ valid(sigOf(k)) ? '签名有效' : '内容已变化，签名失效' }}</span></div>
      <template v-if="sigOf(k)">
        <img v-if="sigOf(k).img" :src="sigOf(k).img" class="h-12 mt-1" :alt="k + '人签名'">
        <div class="text-[11px] mt-1">{{ sigOf(k).name }} · {{ fmtTime(sigOf(k).at) }}</div>
        <div class="text-[10px] text-zinc-500 font-mono">绑定内容摘要 {{ sigOf(k).hash }}</div>
      </template>
      <div v-else class="text-[11px] text-zinc-400 mt-7">{{ k === '复核' ? reviewHint : '（未签名）' }}</div>
    </div>
  </div>

  <div class="mt-4 pt-2 border-t border-zinc-300 flex justify-between gap-4 text-[10px] text-zinc-500"><span>内容摘要 <span class="font-mono">{{ rep.hash }}</span> · 由 Worlder QMS 生成</span><span>{{ preview ? '预览件，不得作为正式记录' : '本报告内容已冻结，修改须生成替代报告' }}</span></div>
</div>`,
};

const RESULT_CHIP = { pass: ['符合', 'chip-green'], fail: ['不符合', 'chip-red'], incomplete: ['证据不足', 'chip-amber'] };

COMPONENTS['page-reports'] = {
  setup() {
    const state = ref(UI.route.query.state || 'all'), scene = ref(''), q = ref('');
    const opts = computed(() => [{ value: 'all', label: '全部', count: S.reports.length }].concat(['frozen', 'review', 'approved'].map((k) => ({ value: k, label: STATUS.report[k][0], count: S.reports.filter((r) => r.state === k).length }))));
    const rows = computed(() => {
      const k = q.value.trim().toLowerCase();
      return S.reports.filter((r) => (state.value === 'all' || r.state === state.value) && (!scene.value || r.content.task.scene === scene.value) && (!k || (r.code + ' ' + r.content.part.name + ' ' + r.content.part.partNo + ' ' + r.content.task.code).toLowerCase().includes(k)));
    });
    return { state, scene, q, opts, rows, RESULT_CHIP };
  },
  template: `
<div class="space-y-5">
  <div><h1 class="page-title">检验报告</h1><p class="text-xs text-ink-3 mt-1">每提交一轮检验，自动生成一份内容冻结的报告。点一行查看、复核或打印。</p></div>
  <div class="flex flex-wrap items-center gap-2">
    <seg v-model="state" :options="opts"/>
    <select v-model="scene" class="input !w-auto !h-[38px]"><option value="">全部场景</option><option v-for="sc in S.scenes" :key="sc.code" :value="sc.code">{{ sc.name }}</option></select>
    <div class="relative"><ic name="search" :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"/><input v-model="q" class="input !h-[38px] pl-9 w-56" placeholder="搜索报告 / 任务 / 零件"></div>
  </div>
  <div class="card overflow-hidden">
    <div class="overflow-x-auto"><table class="tbl">
      <thead><tr><th>报告编号</th><th>场景</th><th>零件</th><th>任务 / 轮次</th><th>结论</th><th>报告状态</th><th>签名</th><th>生成时间</th><th></th></tr></thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id" class="row-link" @click="go('/reports/' + r.id)">
          <td><div class="font-medium font-mono text-[12.5px]">{{ r.code }}</div><div class="text-[11px] text-ink-4 font-mono">摘要 {{ r.hash.slice(0, 10) }}</div></td>
          <td><span class="chip" :class="SCENE_META[r.content.task.scene].tint">{{ r.content.task.sceneName }}</span></td>
          <td><div>{{ r.content.part.name }}</div><div class="text-[11px] text-ink-4">{{ r.content.part.partNo }}</div></td>
          <td class="text-[12px]"><div class="font-mono">{{ r.content.task.code }}</div><div class="text-[11px] text-ink-4">第 {{ r.content.round.no }} 轮{{ r.content.round.parent ? '（复检）' : '' }}</div></td>
          <td><span :class="RESULT_CHIP[r.content.result.overall][1]">{{ RESULT_CHIP[r.content.result.overall][0] }}</span></td>
          <td><st k="report" :v="r.state"/></td>
          <td class="text-[12px] text-ink-2">{{ r.sigs.map(s => s.kind + ' ' + s.name).join(' · ') || '—' }}</td>
          <td class="text-xs text-ink-3 whitespace-nowrap">{{ fmtTime(r.createdAt) }}</td>
          <td><ic name="chevron-right" :size="14" class="text-ink-5"/></td>
        </tr>
      </tbody>
    </table></div>
    <empty v-if="!rows.length" icon="file" title="没有符合条件的报告" desc="签名提交检验轮次后，系统会自动冻结生成报告"/>
  </div>
</div>`,
};

COMPONENTS['page-report'] = {
  setup() {
    const rep = computed(() => S.reports.find((r) => r.id === UI.route.params.id) || null);
    const task = computed(() => (rep.value ? taskOf(rep.value.taskId) : null));
    const round = computed(() => (task.value ? task.value.rounds.find((r) => r.id === rep.value.roundId) || null : null));
    const inspectorSig = computed(() => (rep.value ? rep.value.sigs.find((s) => s.kind === '检验') || null : null));
    const selfReview = computed(() => !!inspectorSig.value && inspectorSig.value.uid === S.me);
    const inFlow = computed(() => !!rep.value && (rep.value.state === 'review' || rep.value.state === 'approved' || !!(rep.value.opinions && rep.value.opinions.length)));
    const stepIdx = computed(() => (rep.value ? { frozen: 0, review: 1, approved: 3 }[rep.value.state] || 0 : 0));
    const returned = computed(() => !!rep.value && rep.value.state === 'frozen' && !!(rep.value.opinions && rep.value.opinions.length));
    const photos = computed(() => (round.value ? round.value.photos : []));
    const ncrs = computed(() => (rep.value ? ncrsOfTask(rep.value.taskId) : []));
    const sign = reactive({ open: false, img: '' });
    const ret = reactive({ open: false, text: '' });
    const openSign = () => { sign.img = ''; sign.open = true; };
    const doApprove = () => { try { approveReport(rep.value, sign.img); sign.open = false; toast('已复核签批，签名已绑定报告内容摘要', 'success'); } catch (e) { toast(e.message, 'error'); } };
    const doReturn = () => { try { returnReport(rep.value, ret.text); ret.open = false; ret.text = ''; toast('已退回，等待重新提请复核', 'info'); } catch (e) { toast(e.message, 'error'); } };
    const doResubmit = () => { try { resubmitReport(rep.value); toast('已重新提请复核', 'success'); } catch (e) { toast(e.message, 'error'); } };
    const print = () => window.print();
    return { rep, task, round, inspectorSig, selfReview, inFlow, stepIdx, returned, photos, ncrs, sign, ret, openSign, doApprove, doReturn, doResubmit, print, RESULT_CHIP };
  },
  template: `
<div v-if="rep" class="space-y-5">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <button class="text-xs text-ink-3 hover:text-ink inline-flex items-center gap-1 mb-2" @click="go('/reports')"><ic name="chevron-left" :size="13"/>检验报告</button>
      <div class="flex flex-wrap items-center gap-2"><h1 class="page-title font-mono">{{ rep.code }}</h1><st k="report" :v="rep.state"/><span :class="RESULT_CHIP[rep.content.result.overall][1]">结论：{{ RESULT_CHIP[rep.content.result.overall][0] }}</span></div>
      <p class="text-xs text-ink-3 mt-1">{{ rep.content.task.sceneName }} · {{ rep.content.part.partNo }} {{ rep.content.part.name }} · 冻结于 {{ fmtTime(rep.createdAt) }}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <button class="btn-secondary" @click="print"><ic name="printer" :size="15"/>打印 / 导出 PDF</button>
      <template v-if="rep.state === 'review'">
        <g-btn perm="report.review" cls="btn-secondary" @click="ret.open = true">退回</g-btn>
        <g-btn perm="report.review" cls="btn-success" icon="stamp" :when="!selfReview" why="复核人不得为本轮签名人（独立复核）" @click="openSign">复核签批</g-btn>
      </template>
      <g-btn v-if="returned" perm="task.submit" cls="btn-primary" icon="arrow-right" @click="doResubmit">重新提请复核</g-btn>
    </div>
  </div>

  <order-trail v-if="orderOfReport(rep)" :order="orderOfReport(rep)" :stage="rep.content.task.scene"/>
  <next-step v-bind="nextOf('report', rep)"/>

  <div class="flex flex-col 2xl:flex-row gap-5">
    <aside class="2xl:w-[360px] 2xl:order-2 shrink-0 grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-1 gap-4 content-start">
      <div class="card p-4">
        <h2 class="section-title mb-3">报告状态</h2>
        <stepper v-if="inFlow" :steps="['已冻结', '待复核', '已批准']" :current="stepIdx"/>
        <div v-else class="rounded-xl bg-[#f7f7f9] px-3.5 py-2.5 text-[12px] text-ink-2 leading-relaxed"><ic name="lock" :size="13" class="inline -mt-0.5 mr-1"/>已冻结。本场景策略无需复核：普通合格检验完成即可，不额外增加放行审批。</div>
        <div v-if="rep.content.result.overall !== 'pass' && rep.state !== 'frozen'" class="text-[11.5px] text-ink-4 mt-3 leading-relaxed">复核批准的是“报告内容如实、依据正确”，不改变“{{ RESULT_CHIP[rep.content.result.overall][0] }}”的技术结论。</div>
        <div v-if="rep.opinions && rep.opinions.length" class="mt-3 space-y-2"><div v-for="(o,i) in rep.opinions" :key="i" class="rounded-xl bg-amber-50 text-amber-900 px-3 py-2 text-[12px]"><div class="font-medium">{{ userName(o.uid) }} 退回 · {{ fmtTime(o.at) }}</div><div class="mt-0.5">{{ o.text }}</div></div></div>
      </div>
      <div class="card p-4">
        <h2 class="section-title mb-3">签名校验</h2>
        <div v-for="s in rep.sigs" :key="s.kind + s.at" class="flex items-start gap-3 py-2 border-b border-black/[0.05] last:border-0">
          <avatar :uid="s.uid" :size="28"/>
          <div class="flex-1 min-w-0"><div class="text-[12.5px] font-medium">{{ s.kind }} · {{ s.name }}</div><div class="text-[11px] text-ink-4">{{ fmtTime(s.at) }}</div><div class="text-[10.5px] text-ink-4 font-mono truncate">摘要 {{ s.hash }}</div></div>
          <span :class="sigValid(rep, s) ? 'chip-green' : 'chip-red'">{{ sigValid(rep, s) ? '有效' : '已失效' }}</span>
        </div>
        <div v-if="!rep.sigs.length" class="text-xs text-ink-4">尚无签名</div>
        <p class="text-[11px] text-ink-4 mt-2 leading-relaxed">签名绑定签署时的内容摘要；报告内容一旦变化，旧签名自动显示为失效。电子签名的法律效力要求（是否接入第三方 CA）由企业确认。</p>
      </div>
      <div class="card p-4">
        <h2 class="section-title mb-3">关联对象</h2>
        <div class="space-y-2 text-[12.5px]">
          <div class="flex items-center justify-between gap-2"><span class="text-ink-3">检验任务</span><button v-if="task" class="link font-mono" @click="go('/inspect/' + task.id)">{{ task.code }} · 第 {{ rep.content.round.no }} 轮</button><span v-else class="text-ink-4">{{ rep.content.task.code }}</span></div>
          <div class="flex items-center justify-between gap-2"><span class="text-ink-3">检验标准</span><button class="link" @click="go('/standards/' + rep.content.std.id)">{{ rep.content.std.code }} Rev {{ rep.content.std.rev }}</button></div>
          <div class="flex items-center justify-between gap-2"><span class="text-ink-3">检验方案</span><button class="link" @click="go('/plans/' + rep.content.plan.id)">{{ rep.content.plan.code }} Rev {{ rep.content.plan.rev }}</button></div>
          <div class="flex items-center justify-between gap-2"><span class="text-ink-3">报告模板</span><span class="truncate">{{ (tplOf(rep.templateId) || {}).name || '—' }}</span></div>
          <div v-for="n in ncrs" :key="n.id" class="flex items-center justify-between gap-2"><span class="text-ink-3">不合格处置</span><span class="inline-flex items-center gap-1.5"><button class="link font-mono" @click="go('/ncr/' + n.id)">{{ n.code }}</button><st k="ncr" :v="n.status"/></span></div>
        </div>
      </div>
      <div class="card p-4">
        <h2 class="section-title mb-3">现场照片<span class="ml-1.5 text-xs font-normal text-ink-4">{{ photos.length }} 张</span></h2>
        <photo-strip v-if="photos.length" :photos="photos" readonly size="w-16 h-16"/>
        <div v-else class="text-xs text-ink-4">本轮没有照片</div>
      </div>
    </aside>
    <div class="flex-1 min-w-0 overflow-x-auto pb-2"><div class="print-area"><report-sheet :rep="rep"/></div></div>
  </div>

  <modal :open="sign.open" @close="sign.open = false" title="复核签批" :sub="rep.code + ' · 结论：' + RESULT_CHIP[rep.content.result.overall][0]" width="max-w-lg">
    <p class="text-[12.5px] text-ink-2 leading-relaxed mb-3">请确认报告内容如实、检验依据正确。签名将绑定当前内容摘要 <span class="font-mono text-ink-4">{{ rep.hash }}</span>。</p>
    <signature-pad v-model="sign.img" :signer="who().name"/>
    <template #footer><button class="btn-secondary" @click="sign.open = false">取消</button><button class="btn-success" :disabled="!sign.img" @click="doApprove"><ic name="check" :size="15"/>确认签批</button></template>
  </modal>
  <modal :open="ret.open" @close="ret.open = false" title="退回报告" sub="报告回到“已冻结”，记录退回意见；检验员处理后可重新提请复核" width="max-w-lg">
    <textarea v-model="ret.text" rows="4" class="textarea" placeholder="退回意见，例如：#5 镀层厚度缺 2 个读数，请补测后重新提交"></textarea>
    <template #footer><button class="btn-secondary" @click="ret.open = false">取消</button><button class="btn-primary" :disabled="!ret.text.trim()" @click="doReturn">确认退回</button></template>
  </modal>
</div>
<empty v-else icon="file" title="报告不存在或已删除"><button class="btn-secondary" @click="go('/reports')">返回报告列表</button></empty>`,
};

/* ---------------- 报告模板（复用：多个方案引用同一模板；可来自气泡软件的 Excel 模板） ---------------- */
COMPONENTS['page-rtpl'] = {
  setup() {
    const src = ref('all');
    const opts = computed(() => [{ value: 'all', label: '全部', count: S.reportTemplates.length }, { value: '气泡软件', label: '气泡软件 Excel', count: S.reportTemplates.filter((t) => t.src === '气泡软件').length }, { value: 'QMS', label: 'QMS 内置', count: S.reportTemplates.filter((t) => t.src === 'QMS').length }]);
    const rows = computed(() => S.reportTemplates.filter((t) => src.value === 'all' || t.src === src.value));
    const usedBy = (t) => S.plans.filter((p) => p.reportTplId === t.id && p.status !== 'retired');
    const pv = ref(null);
    const sample = computed(() => S.reports[0] || null);
    const openBubble = () => { UI.bubble.route = 'inspection-templates'; go('/bubble'); };
    const toggle = (t) => { t.status = t.status === 'enabled' ? 'disabled' : 'enabled'; logAudit('报告模板', t.name, t.status === 'enabled' ? '启用' : '停用'); toast('模板已' + (t.status === 'enabled' ? '启用' : '停用') + '：停用只阻止新方案引用，已冻结的报告不受影响', 'info'); };
    return { src, opts, rows, usedBy, pv, sample, openBubble, toggle };
  },
  template: `
<div class="space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div><h1 class="page-title">报告模板</h1><p class="text-xs text-ink-3 mt-1">一个模板可被多个检验方案引用。Excel 模板在气泡软件的“质检报告模板”中维护并同步到这里；报告冻结时固定所用模板，历史报告不随模板变化。</p></div>
    <button class="btn-secondary" @click="openBubble"><ic name="external" :size="15"/>在气泡软件中维护 Excel 模板</button>
  </div>
  <seg v-model="src" :options="opts"/>
  <div class="card divide-y divide-black/[0.05]">
    <div v-for="t in rows" :key="t.id" class="flex flex-wrap items-center gap-4 px-5 py-4 transition-colors hover:bg-black/[0.015]">
      <span class="w-11 h-11 rounded-xl bg-[#f3f4f6] text-ink-3 flex items-center justify-center shrink-0"><ic :name="t.withDrawing ? 'target' : 'file'" :size="19"/></span>
      <div class="flex-1 min-w-[220px]">
        <div class="font-medium text-[13.5px]">{{ t.name }}</div>
        <div class="flex flex-wrap items-center gap-1.5 mt-1"><span :class="t.src === 'QMS' ? 'chip-brand' : 'chip-gray'">{{ t.src === 'QMS' ? 'QMS 内置' : '气泡软件 · Excel 导入' }}</span><span v-if="t.withDrawing" class="chip-gray">带气泡图</span><span class="text-[11px] text-ink-4">{{ t.file !== '—' ? t.file + ' · ' : '' }}更新于 {{ fmtDate(t.updatedAt) }}</span></div>
      </div>
      <div class="text-[12px] text-ink-3 w-[200px]"><div>被 <b class="text-ink tabular">{{ usedBy(t).length }}</b> 个方案引用</div><div class="text-[11px] text-ink-4 truncate">{{ usedBy(t).map(p => p.code).join('、') || '尚未被引用' }}</div></div>
      <span :class="t.status === 'enabled' ? 'chip-green' : 'chip-gray'">{{ t.status === 'enabled' ? '已启用' : '已停用' }}</span>
      <div class="flex items-center gap-1.5"><button class="btn-ghost btn-sm" :disabled="!sample" @click="pv = t"><ic name="eye" :size="14"/>预览</button><g-btn perm="tpl.edit" cls="btn-ghost btn-sm" @click="toggle(t)">{{ t.status === 'enabled' ? '停用' : '启用' }}</g-btn></div>
    </div>
    <empty v-if="!rows.length" icon="layout" title="没有模板"/>
  </div>
  <modal :open="!!pv" @close="pv = null" :title="pv ? '模板预览 · ' + pv.name : ''" sub="示意：用最近一份报告的冻结内容套用该模板版式；Excel 模板的单元格映射在气泡软件中维护" width="max-w-[880px]">
    <div class="overflow-x-auto -mx-2"><report-sheet v-if="pv && sample" :rep="sample" :template-id="pv.id" preview/></div>
  </modal>
</div>`,
};

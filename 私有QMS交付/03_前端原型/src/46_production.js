/* =====================================================================
 * 生产现场：工单主线的数据底座
 *   · 班次与机台：班次按设置的开始时间切分；机台属于产线
 *   · 首件触发：开工、开班、换型、换刀、修机后……每台机台在每次触发之后都要重新做首件
 *   · 报工：每道工序报合格数、不良数；不良自动登记 NCR，处置结果（返工 / 报废 / 让步）回写工单数量
 *   · 让步放行：有让步接收的工单，放行时必须附客户或技术批准依据
 *   · 批次追溯：出货批次 / 发货单 → 工单 → 来料批次 → 供应商，也可以从来料批次往后查
 *   · 扫码：流转卡上的二维码、扫码枪输入，直接进到这张工单上“我”该做的检验
 * 这里只放数据与规则；页面在 49_floor.js，演示数据在 85_prod_demo.js。
 * ===================================================================== */

const FAI_TRIGGERS = [
  { key: '开工', hint: '这台机台第一次做这张工单' },
  { key: '开班', hint: '换班后继续生产' },
  { key: '换型', hint: '换了产品、夹具或程序' },
  { key: '换刀', hint: '更换刀具、砂轮或模具' },
  { key: '修机后', hint: '设备维修、调整之后' },
  { key: '停机恢复', hint: '长时间停机后重新开机' },
  { key: '工艺变更', hint: '参数、材料批次或工艺变更' },
];
const FAI_LABEL = { 开工: '开工首件', 开班: '开班首件', 换型: '换型后首件', 换刀: '换刀后首件', 修机后: '修机后首件', 停机恢复: '停机恢复首件', 工艺变更: '工艺变更后首件' };
const SHIFTS_DEFAULT = [{ key: 'D', name: '白班', start: '08:00' }, { key: 'N', name: '夜班', start: '20:00' }];
const MACHINES_DEMO = [
  { code: 'CNC-01', name: '数控车床 1#', line: '车削线' },
  { code: 'CNC-02', name: '数控车床 2#', line: '车削线' },
  { code: 'CNC-03', name: '数控车床 3#', line: '车削线' },
  { code: 'CNC-04', name: '数控车床 4#', line: '车削线' },
  { code: '磨床-02', name: '外圆磨床 2#', line: '磨削线' },
  { code: '装配线 A', name: '阀芯装配线 A', line: '装配车间' },
  { code: '装配线 B', name: '刀具装配线 B', line: '装配车间' },
];
const CONCESSION_BASIS = ['客户书面批准', '技术评审批准'];

/* ---------------- 班次 ---------------- */
function shiftList() { return S.settings && Array.isArray(S.settings.shifts) && S.settings.shifts.length ? S.settings.shifts : SHIFTS_DEFAULT; }
function hmToMin(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m ? Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]) : 0; }
function fmtHM(d) { const x = d instanceof Date ? d : new Date(d); return pad2(x.getHours()) + ':' + pad2(x.getMinutes()); }
/** 某个时刻所在的班次：{ key, name, start, end }（start / end 为 Date） */
function shiftAt(t) {
  const d = t ? new Date(t) : new Date();
  const list = shiftList().map((x) => ({ x, m: hmToMin(x.start) })).sort((a, b) => a.m - b.m);
  const mins = d.getHours() * 60 + d.getMinutes();
  let i = -1;
  list.forEach((s, k) => { if (s.m <= mins) i = k; });
  let day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (i < 0) { i = list.length - 1; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1); }
  const cur = list[i], nx = list[(i + 1) % list.length];
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(cur.m / 60), cur.m % 60);
  let end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(nx.m / 60), nx.m % 60);
  if (end <= start) end = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, end.getHours(), end.getMinutes());
  return { key: cur.x.key, name: cur.x.name, start, end };
}
function shiftText(sh) { return sh.name + ' ' + fmtHM(sh.start) + '–' + fmtHM(sh.end); }

/* ---------------- 机台 ---------------- */
function machineOf(code) { return (S.machines || []).find((m) => m.code === code) || null; }
function machineLines() { const out = []; (S.machines || []).forEach((m) => { if (out.indexOf(m.line) < 0) out.push(m.line); }); return out; }
function lineOfMachine(code) { const m = machineOf(code); return m ? m.line : ''; }
/** 工序可选的机台：工作中心本身是机台时，给出同一产线上的机台（默认机台排第一） */
function machinesForOp(op) {
  const m = op ? machineOf(op.wc) : null;
  if (!m) return [];
  return [m].concat((S.machines || []).filter((x) => x.line === m.line && x.code !== m.code));
}

/* ---------------- 工序与数量 ---------------- */
function opsOf(part) { return part && part.route ? part.route.ops : []; }
function opByKey(part, key) { return opsOf(part).find((op) => opKeyOf(op) === key) || null; }
function firstOpsOf(part) { return opsOf(part).filter((op) => op.insp.some((b) => b.scene === 'FIRST')); }
/** 未撤销的报工（撤销的保留在 o.work 里留痕，不参与计算） */
function liveWork(o) { return (o.work || []).filter((w) => !w.voided); }
/**
 * NCR 发生在哪道工序：报工登记的写在 NCR 上；检验登记的取检验任务上的工序；
 * 任务没写工序（完工、出货检验常按批次开单）时，算在这类检验在工序路线上第一次出现的工序上（与 orderPoints 一致）
 */
function ncrOpKey(n) {
  if (n.op) return n.op;
  const t = n.taskId ? taskOf(n.taskId) : null;
  if (!t || !t.ctx) return '';
  if (t.ctx.op) return t.ctx.op;
  const op = opsOf(partOf(t.partId)).find((x) => x.insp.some((b) => b.scene === t.scene));
  return op ? opKeyOf(op) : '';
}
/** NCR 算进工单的不良数：范围确认后按确认数（确认 0 件关闭的就是 0）；报工登记、还没确认的先按报工数 */
function ncrDefects(n) { return n.status !== 'registered' ? n.qtyConfirmed || 0 : n.workId ? n.qtySuspect || 0 : 0; }
function execQty(n, actions) { return sum(ncrLines(n).filter((d) => d.executed && (!actions || actions.indexOf(d.action) >= 0)).map((d) => d.qty)); }
/**
 * 算进这张工单数量的不合格：登记在本工单号或本工单成品批次上的、由本工单报工登记的、
 * 由写了本工单号的检验登记的、由按成品批次开单的检验登记的、由挂在工序上的检验登记的（例如外协回厂）。
 * 只是通过质量限制或共用的来料批次关联上的不算——追溯隔离单可能同时挂在几张工单上，
 * 来料检验的不合格是收货批次的事，不该拉低本工单的生产直通率、也不该进本工单的数量平衡；它们照样挡放行（见 releaseStage）。
 */
function orderOwnNcrs(o) {
  const wids = (o.work || []).map((w) => w.id);
  return S.ncrs.filter((n) => {
    if (n.partId !== o.partId) return false;
    if (n.batch === o.wo || (o.outLot && n.batch === o.outLot) || (n.workId && wids.indexOf(n.workId) >= 0)) return true;
    const t = n.taskId ? taskOf(n.taskId) : null;
    if (!t || !t.ctx) return false;
    return t.ctx.wo === o.wo || (!!o.outLot && t.ctx.batch === o.outLot) || (!!t.ctx.op && orderOfTask(t) === o);
  });
}

/**
 * 工单数量台账：每道工序的报工、不良和一次合格率；处置回写（返工 / 挑选 / 报废 / 让步 / 退货）；直通率与数量平衡。
 *   每张不合格落在它发生的工序（ncrOpKey）；对不上工序的算作终检之后发现的
 *   能到这道工序的件 = 投产 − 前面各道工序报废、退货的件
 *   一次合格率 = (第一次加工的件 − 不良) ÷ 第一次加工的件；第一次加工的件不超过能到这道工序的件（返工后补报的不算第一次）
 *   检验发现的不良从报工合格数里扣除（生产当时按合格报的）；直通率 = 各工序一次合格率相乘
 *   入库合格 = 终检工序合格 + 终检工序上让步接收的件 − 终检之后发现、已报废 / 退货 / 还没处置的件
 *   在制 = 投产 − 入库合格 − 报废 − 退货 − 待处置
 *   数量平衡（放行条件）= 已报工、有入库合格、在制为 0、没有待处置的不良
 */
function orderQty(o) {
  const part = partOf(o.partId), ops = opsOf(part), work = liveWork(o);
  const ncrs = orderOwnNcrs(o);
  const input = o.qtyIn || 0;
  const keys = ops.map(opKeyOf);
  const fqcOp = ops.find((op) => op.insp.some((b) => b.scene === 'FQC')) || ops[ops.length - 1] || null;
  const fqcIdx = fqcOp ? ops.indexOf(fqcOp) : -1;
  const at = ncrs.map((n) => keys.indexOf(ncrOpKey(n)));
  const where = (n) => at[ncrs.indexOf(n)];
  const loss = (n) => execQty(n, ['报废', '退货']);
  const pendingOf = (n) => Math.max(0, ncrDefects(n) - execQty(n));
  let lostBefore = 0;
  const rows = ops.map((op, i) => {
    const key = keys[i];
    const ws = work.filter((w) => w.op === key);
    const here = ncrs.filter((n) => where(n) === i);
    const processed = sum(ws.map((w) => (w.good || 0) + (w.bad || 0)));
    const badWork = sum(ws.map((w) => { const n = w.ncrId ? ncrs.find((x) => x.id === w.ncrId) : null; return n ? ncrDefects(n) : w.bad || 0; }));
    const badInsp = sum(here.filter((n) => !n.workId).map(ncrDefects));
    const bad = badWork + badInsp;
    const good = Math.max(0, processed - bad);
    const arriving = Math.max(0, input - lostBefore);
    const firstPass = input ? Math.min(processed, arriving) : processed;
    const reworkHere = sum(here.map((n) => execQty(n, ['返工', '返修', '挑选'])));
    lostBefore += sum(here.map(loss));
    const machines = [];
    ws.forEach((w) => { if (w.machine && machines.indexOf(w.machine) < 0) machines.push(w.machine); });
    return { op, key, processed, good, bad, badWork, badInsp, arriving, reworkHere, fpy: firstPass > 0 ? Math.max(0, firstPass - bad) / firstPass : null, machines, last: ws.length ? ws[ws.length - 1] : null, count: ws.length };
  });
  const orphan = ncrs.filter((n) => where(n) < 0);
  const post = ncrs.filter((n) => where(n) < 0 || where(n) > fqcIdx);
  const fqcRow = fqcIdx >= 0 ? rows[fqcIdx] : null;
  const all = (fn) => sum(ncrs.map(fn));
  const defects = sum(rows.map((r) => r.bad)) + sum(orphan.map(ncrDefects));
  const rework = all((n) => execQty(n, ['返工', '返修']));
  const sorted = all((n) => execQty(n, ['挑选']));
  const scrap = all((n) => execQty(n, ['报废']));
  const concession = all((n) => execQty(n, ['让步接收']));
  const returned = all((n) => execQty(n, ['退货']));
  const pending = Math.max(0, defects - (rework + sorted + scrap + concession + returned));
  const fqcConcession = sum(ncrs.filter((n) => where(n) === fqcIdx).map((n) => execQty(n, ['让步接收'])));
  const postOut = sum(post.map((n) => loss(n) + pendingOf(n)));
  const stocked = fqcRow ? Math.max(0, fqcRow.good + fqcConcession - postOut) : 0;
  const wip = input - stocked - scrap - returned - pending;
  const withData = rows.filter((r) => r.fpy != null);
  const rty = withData.length ? withData.reduce((a, r) => a * r.fpy, 1) : null;
  const balanced = input > 0 && stocked > 0 && wip === 0 && pending === 0;
  return { rows, input, plan: o.qty || 0, defects, rework, sorted, scrap, concession, returned, pending, stocked, wip, rty, balanced, reported: work.length > 0, fqcKey: fqcRow ? fqcRow.key : '' };
}
/** 数量平衡不满足时，说清差在哪 */
function qtyGapText(q) {
  if (!q.reported || !q.input) return '还没有报工：每道工序报合格数和不良数后才能核对数量';
  if (q.pending) return '还有 ' + q.pending + ' 件不良没有处置完';
  if (q.wip < 0) return '数量对不上：入库合格、报废加起来比投产多 ' + -q.wip + ' 件，请核对报工（报错的报工可以在“报工记录”里撤销）';
  if (!q.stocked) return '终检工序' + (q.fqcKey ? '（' + q.fqcKey + '）' : '') + '还没有报入库合格数';
  if (q.wip > 0) return '还有 ' + q.wip + ' 件在制：投产 ' + q.input + '，入库合格 ' + q.stocked + '，报废 ' + q.scrap + (q.returned ? '，退货 ' + q.returned : '');
  return '';
}
function balanceText(q) { return '数量平衡：投产 ' + q.input + ' = 入库合格 ' + q.stocked + ' + 报废 ' + q.scrap + (q.returned ? ' + 退货 ' + q.returned : '') + (q.concession ? '（入库合格中让步接收 ' + q.concession + ' 件）' : ''); }
function pctText(v) { return v == null ? '—' : (Math.round(v * 1000) / 10).toFixed(1) + '%'; }
function yieldTone(v) { return v == null ? 'text-ink-4' : v >= 0.95 ? 'text-emerald-700' : v >= 0.85 ? 'text-amber-700' : 'text-rose-600'; }

/**
 * 生产是否还在这道工序上进行：没放行、完工检验还没合格、这道工序还没报满“能到这道工序的件”
 * （前道报废、退货的件不会来了；返工后不补报也不会让工序一直显示在做）。q 可传入已算好的 orderQty(o)
 */
function opRunning(o, op, q) {
  if (o.releasedAt) return false;
  if (S.tasks.some((t) => t.scene === 'FQC' && t.status === 'pass' && orderOfTask(t) === o)) return false;
  if (!(o.qtyIn || 0)) return true;
  q = q || orderQty(o);
  const key = opKeyOf(op);
  const row = q.rows.find((r) => r.key === key);
  return !!row && row.processed < row.arriving;
}
/** 这张工单的这道工序现在在哪台机台上做：报工、首件触发登记、首件单里最新的那台（之后登记了下机的不算），没有返回空 */
function runningMachine(o, opKey) {
  if (!o || !opKey) return '';
  const evs = (o.setups || []).filter((e) => e.op === opKey);
  const off = (m, at) => evs.some((e) => e.machine === m && e.trigger === '下机' && e.at >= at);
  const cand = liveWork(o).filter((w) => w.op === opKey && w.machine).map((w) => ({ m: w.machine, at: w.at }))
    .concat(evs.filter((e) => e.trigger !== '下机').map((e) => ({ m: e.machine, at: e.at })))
    .concat(S.tasks.filter((t) => t.scene === 'FIRST' && t.partId === o.partId && t.ctx && t.ctx.wo === o.wo && t.ctx.op === opKey && t.ctx.machine).map((t) => ({ m: t.ctx.machine, at: t.createdAt })))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  const hit = cand.find((c) => !off(c.m, c.at));
  return hit ? hit.m : '';
}

/* ---------------- 首件：按机台、按触发事件 ---------------- */
function faiLabel(r) { return r.auto ? '开班首件' : FAI_LABEL[r.trigger] || r.trigger + '首件'; }
function passAt(t) { return t && t.status === 'pass' ? lastDoneAt(t) : ''; }
/** 工单上某道工序的首件任务（新的在前）；没写工序的任务算在第一道有首件检验点的工序上 */
function faiTasksOf(o, op, fops) {
  const key = opKeyOf(op);
  return S.tasks.filter((t) => t.scene === 'FIRST' && t.partId === o.partId && t.ctx && t.ctx.wo === o.wo && (t.ctx.op ? t.ctx.op === key : !!fops[0] && fops[0].no === op.no))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
/**
 * 工单现在的首件要求：每道有首件检验点的工序 × 每台在做的机台，一条要求。
 *   · 没登记过事件：默认机台“开工首件”（兼容只做一次首件的老数据）
 *   · 登记了事件（开工 / 换型 / 换刀 / 修机后…）：这台机台在事件之后要有新的首件；“下机”表示这台机台不再做
 *   · 开班首件（设置里可关）：上一班已经合格、这一班还在生产，就要在本班再做一次
 * 每条要求带着满足它的最新首件任务 task（没有为 null）。q 可传入已算好的 orderQty(o)。
 */
function faiReqs(o, q) {
  const part = partOf(o.partId);
  if (!part.id) return [];
  const fops = firstOpsOf(part);
  const sh = shiftAt(), shIso = sh.start.toISOString();
  const autoShift = !S.settings || S.settings.faiShift !== false;
  const out = [];
  fops.forEach((op) => {
    const key = opKeyOf(op);
    const tasks = faiTasksOf(o, op, fops);
    const evs = (o.setups || []).filter((e) => e.op === key).slice().sort((a, b) => (a.at < b.at ? -1 : 1));
    const latest = {};
    evs.forEach((e) => { latest[e.machine] = e; });
    /* 默认机台：最早那次“不是因为登记事件而做”的首件用的机台，没有时取工序路线上的工作中心。
       为登记事件做的首件（带 setupId）不改变默认机台：别的机台先做了首件，默认机台的开工首件要求照样保留，直到它登记“下机” */
    const imp = tasks.filter((t) => !t.ctx.setupId);
    const defM = (imp.length && imp[imp.length - 1].ctx.machine) || op.wc || '';
    const base = [];
    if (!latest[defM]) base.push({ machine: defM, trigger: '开工', at: o.createdAt || '', implicit: true });
    Object.keys(latest).forEach((m) => { const e = latest[m]; if (e.trigger !== '下机') base.push({ machine: m, trigger: e.trigger, at: e.at, ev: e }); });
    const running = opRunning(o, op, q);
    base.forEach((r) => {
      const mt = tasks.filter((t) => (r.implicit ? !t.ctx.setupId && (t.ctx.machine || defM) === defM : (t.ctx.machine || '') === r.machine && t.createdAt >= r.at));
      const prevPass = mt.find((t) => t.status === 'pass' && passAt(t) < shIso);
      const req = Object.assign({ op, key, opNo: op.no, line: lineOfMachine(r.machine) }, r);
      if (autoShift && running && prevPass && (r.at || '') < shIso) {
        const nt = mt.filter((t) => t.createdAt >= shIso);
        Object.assign(req, { trigger: '开班', at: shIso, auto: true, shift: sh.name, task: nt[0] || null, tasks: nt, prev: prevPass });
      } else Object.assign(req, { task: mt[0] || null, tasks: mt });
      req.state = !req.task ? 'todo' : req.task.status === 'pass' ? 'done' : req.task.status === 'fail' || req.task.status === 'insufficient' ? 'blocked' : 'active';
      out.push(req);
    });
  });
  return out;
}

/* ---------------- 动作：报工 / 登记首件触发 / 放行 ---------------- */
function intOf(v, name) {
  const s = String(v == null ? '' : v).trim();
  if (s === '') return 0;
  if (!/^\d+$/.test(s)) throw new Error(name + '须为整数');
  return parseInt(s, 10);
}
/** 报工：一道工序报一次合格数、不良数；有不良时自动登记 NCR（只登记事实，范围和处置走 MRB） */
function reportWork(o, f) {
  if (!can('order.work')) throw new Error(denyTip('order.work'));
  if (o.releasedAt) throw new Error('工单已质量放行，不能再报工');
  const part = partOf(o.partId), op = opByKey(part, f.op);
  if (!op) throw new Error('请选择工序');
  const good = intOf(f.good, '合格数'), bad = intOf(f.bad, '不良数');
  if (good + bad < 1) throw new Error('合格数和不良数至少填一个');
  const reason = String(f.reason || '').trim();
  if (bad > 0 && !reason) throw new Error('有不良时请写明不良现象');
  const first = !o.qtyIn;
  const input = first ? intOf(f.qtyIn, '投产数量') : o.qtyIn;
  if (!input) throw new Error('第一次报工请先确认投产数量');
  /* 每道工序最多报：能到这道工序的件（投产减去前道报废、退货的）+ 本工序返工、挑选后补报的件 */
  const q = orderQty(o), row = q.rows.find((r) => r.key === f.op);
  if (row) {
    const arriving = first ? input : row.arriving, limit = arriving + row.reworkHere, total = row.processed + good + bad;
    if (total > limit) {
      throw new Error('工序 ' + f.op + ' 累计报工 ' + total + ' 件，超过' + (arriving < input ? '能到这道工序的 ' + arriving + ' 件（投产 ' + input + ' 件，前道报废、退货 ' + (input - arriving) + ' 件）' : '投产 ' + input + ' 件')
        + (row.reworkHere ? '；本工序返工、挑选后可补报 ' + row.reworkHere + ' 件，已计入' : ''));
    }
  }
  if (first) o.qtyIn = input;
  const sh = shiftAt();
  if (!Array.isArray(o.work)) o.work = [];
  const w = { id: 'w' + nextSeq(), op: f.op, opNo: op.no, machine: String(f.machine || '').trim(), good, bad, reason, ncrId: '', shift: sh.name, by: S.me, at: nowISO() };
  o.work.push(w);
  const saved = o.work[o.work.length - 1];
  let n = null;
  if (bad > 0) {
    n = createNcr({ title: '工序 ' + f.op + ' 报工不良 ' + bad + ' 件：' + reason, partId: o.partId, batch: o.wo, severity: '一般', qtySuspect: bad, desc: '工单 ' + o.wo + '，工序 ' + f.op + (saved.machine ? '（' + saved.machine + '）' : '') + '，' + sh.name + '报工：合格 ' + good + ' 件，不良 ' + bad + ' 件。\n不良现象：' + reason });
    n.workId = saved.id; n.op = f.op;
    saved.ncrId = n.id;
    ncrLog(n, '由工单 ' + o.wo + ' 报工自动登记（工序 ' + f.op + '）');
  }
  logAudit('生产工单', o.wo, (first ? '确认投产 ' + input + ' 件；' : '') + '报工：工序 ' + f.op + (saved.machine ? ' · ' + saved.machine : '') + '，合格 ' + good + ' 件' + (bad ? '，不良 ' + bad + ' 件（已登记 ' + n.code + '）' : ''));
  return { w: saved, n };
}
/**
 * 撤销报工：报错了（数量、工序、机台）撤销后重新报。撤销的记录保留并注明原因，不再参与计算。
 * 报工自动登记的不合格还没开始处置时一起关闭（不合格 0 件）；已经在处置的不能撤销，先在不合格单里处理。
 */
function voidWork(o, wid, why) {
  if (!can('order.work')) throw new Error(denyTip('order.work'));
  if (o.releasedAt) throw new Error('工单已质量放行，不能撤销报工');
  const w = (o.work || []).find((x) => x.id === wid && !x.voided);
  if (!w) throw new Error('这条报工不存在或已经撤销');
  const reason = String(why || '').trim();
  if (!reason) throw new Error('请写明撤销原因');
  const n = w.ncrId ? S.ncrs.find((x) => x.id === w.ncrId) || null : null;
  if (n && n.status !== 'registered' && n.status !== 'closed') throw new Error(n.code + ' 已经在处置，不能撤销这条报工；请先在不合格单里处理');
  Object.assign(w, { voided: true, voidedBy: S.me, voidedAt: nowISO(), voidReason: reason });
  if (n && n.status === 'registered') {
    Object.assign(n, { status: 'closed', qtyConfirmed: 0, closedAt: nowISO(), closedBy: S.me });
    ncrLog(n, '报工撤销，不合格单随之关闭（不合格 0 件）：' + reason);
  }
  logAudit('生产工单', o.wo, '撤销报工：工序 ' + w.op + (w.machine ? ' · ' + w.machine : '') + '，合格 ' + w.good + ' 件' + (w.bad ? '、不良 ' + w.bad + ' 件' : '') + '（' + reason + '）');
  return w;
}
/** 登记首件触发事件（开工 / 开班 / 换型 / 换刀 / 修机后 …），或“下机”（这台机台不再做这张工单） */
function addSetup(o, f) {
  if (!can('order.setup')) throw new Error(denyTip('order.setup'));
  if (o.releasedAt) throw new Error('工单已质量放行');
  const part = partOf(o.partId), op = firstOpsOf(part).find((x) => opKeyOf(x) === f.op);
  if (!op) throw new Error('这道工序没有首件检验点，不需要登记');
  const machine = String(f.machine || '').trim();
  if (!machine) throw new Error('请选择机台');
  if (f.trigger !== '下机' && !FAI_TRIGGERS.some((x) => x.key === f.trigger)) throw new Error('请选择触发原因');
  const sh = shiftAt();
  if (!Array.isArray(o.setups)) o.setups = [];
  o.setups.push({ id: 'su' + nextSeq(), op: f.op, opNo: op.no, machine, trigger: f.trigger, note: String(f.note || '').trim(), shift: sh.name, by: S.me, at: nowISO() });
  const e = o.setups[o.setups.length - 1];
  logAudit('生产工单', o.wo, (f.trigger === '下机' ? machine + ' 下机，不再做工序 ' + f.op : '登记' + f.trigger + '：工序 ' + f.op + ' · ' + machine + '，需要重新做首件') + (e.note ? '（' + e.note + '）' : ''));
  return e;
}
/** 工单上已执行的让步接收（放行时要附批准依据） */
function orderConcessions(o) {
  const out = [];
  orderNcrs(o).forEach((n) => ncrLines(n).forEach((d) => { if (d.action === '让步接收' && d.executed) out.push({ n, d }); }));
  return out;
}
/** 从处置理由、执行凭据里找批准文件编号（如 CC-2611-05）；工单、不合格、报废单、返工单、收发货单、检验单等编号不算 */
const NOT_APPROVAL_DOC = /^(WO|NCR|SC|RW|IR|DN|RPT|IQC|FAI|IPQC|FQC|OQC|PL|STD|SYNC|TPL)-/;
function guessDocNo(d) {
  const all = ((d.reason || '') + ' ' + (d.evidence || '')).match(/[A-Z]{2,}-\d{4}-\d{2,}/g) || [];
  return all.find((x) => !NOT_APPROVAL_DOC.test(x)) || '';
}
/**
 * 质量放行：检查项必须全部通过；有让步接收时每一项都要写明批准方、批准文件编号和批准人。
 * @param {object} f { note, basis: { [处置行 id]: { kind, docNo, approver } } }
 */
function releaseOrder(o, f) {
  f = f || {};
  if (!can('order.release')) throw new Error(denyTip('order.release'));
  if (o.releasedAt) throw new Error('工单已经放行');
  const ml = mainlineOf(o), rel = ml.stages[ml.stages.length - 1];
  const bad = rel.checks.filter((c) => !c.ok);
  if (bad.length) throw new Error('还有检查项没通过：' + bad[0].text);
  const cons = orderConcessions(o), basis = f.basis || {};
  const rows = cons.map((c) => {
    const b = basis[c.d.id] || {};
    const kind = CONCESSION_BASIS.indexOf(b.kind) >= 0 ? b.kind : '';
    const docNo = String(b.docNo || '').trim(), approver = String(b.approver || '').trim();
    if (!kind || !docNo || !approver) throw new Error('让步接收（' + c.n.code + ' ' + c.d.qty + ' 件）要写明批准方、批准文件编号和批准人');
    return { ncrId: c.n.id, ncrCode: c.n.code, lineId: c.d.id, qty: c.d.qty, reason: c.d.reason, kind, docNo, approver };
  });
  o.releasedAt = nowISO(); o.releasedBy = S.me; o.releaseNote = String(f.note || '').trim();
  o.releaseKind = rows.length ? 'concession' : 'normal';
  o.releaseBasis = rows;
  logAudit('生产工单', o.wo, (rows.length ? '让步放行（' + rows.map((r) => r.ncrCode + ' ' + r.qty + ' 件，' + r.kind + ' ' + r.docNo + '，' + r.approver).join('；') + '）' : '质量放行') + (o.releaseNote ? '：' + o.releaseNote : ''));
  return o;
}

/* ---------------- 批次追溯 ---------------- */
/** 来料批次信息：收货记录（供应商、收货单）+ 来料检验 + 相关不合格 */
function lotInfo(lot) {
  const rec = (S.lots || []).find((l) => l.lot === lot) || null;
  const iqc = S.tasks.filter((t) => t.scene === 'IQC' && t.ctx && t.ctx.batch === lot).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return {
    lot, rec, iqc, item: rec ? rec.item : '',
    supplier: (rec && rec.supplier) || (iqc[0] && iqc[0].ctx.supplier) || '',
    receipt: (rec && rec.receipt) || (iqc[0] && iqc[0].ctx.receipt) || '',
    ncrs: S.ncrs.filter((n) => n.batch === lot || n.holds.some((h) => h.scopeVal === lot)),
    holds: holdsActive().filter((h) => h.scopeVal === lot),
  };
}
/** 工单的出货：出货检验（发货单、客户），按成品批次或工单号关联 */
function orderShipments(o) {
  return S.tasks.filter((t) => t.scene === 'OQC' && t.partId === o.partId && t.ctx && ((o.outLot && t.ctx.batch === o.outLot) || t.ctx.wo === o.wo))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
function orderShipped(o) { return !!o.releasedAt && orderShipments(o).some((t) => t.status === 'pass' && t.ctx.shipment); }
/**
 * 追溯：输入发货单号、成品批次、客户、工单号、来料批次、收货单号、供应商或检验单号。
 * 返回 { q, kind, direction: back | forward | both, orders, lots, siblings }：
 *   back    从出货往回查：发货单 → 成品批次 → 工单 → 来料批次 → 供应商
 *   forward 从来料往后查：来料批次 → 用了它的工单 → 成品批次 → 发到哪个客户
 */
function traceOf(q) {
  const k = String(q || '').trim();
  if (!k) return null;
  const lc = k.toLowerCase(), eq = (v) => !!v && String(v).toLowerCase() === lc;
  const uniq = (arr) => arr.filter((x, i) => arr.indexOf(x) === i);
  let kind = '', direction = 'both', orders = [], lots = [];
  const oqc = S.tasks.filter((t) => t.scene === 'OQC' && t.ctx && (eq(t.ctx.shipment) || eq(t.ctx.batch) || eq(t.ctx.customer)));
  const task = S.tasks.find((t) => eq(t.code));
  const byWo = S.orders.filter((o) => eq(o.wo) || eq(o.outLot));
  const lotHits = uniq((S.lots || []).filter((l) => eq(l.lot) || eq(l.receipt) || eq(l.supplier)).map((l) => l.lot)
    .concat(S.tasks.filter((t) => t.scene === 'IQC' && t.ctx && t.ctx.batch && (eq(t.ctx.batch) || eq(t.ctx.receipt) || eq(t.ctx.supplier))).map((t) => t.ctx.batch))
    .concat(S.orders.reduce((a, o) => a.concat((o.inLots || []).filter(eq)), [])));
  if (oqc.length) {
    kind = oqc.some((t) => eq(t.ctx.customer)) ? '客户' : oqc.some((t) => eq(t.ctx.shipment)) ? '发货单' : '成品批次';
    direction = 'back';
    orders = S.orders.filter((o) => oqc.some((t) => t.partId === o.partId && ((o.outLot && t.ctx.batch === o.outLot) || t.ctx.wo === o.wo)));
  } else if (byWo.length) {
    kind = byWo.some((o) => eq(o.wo)) ? '工单' : '成品批次';
    direction = byWo.some((o) => eq(o.wo)) ? 'both' : 'back';
    orders = byWo;
  } else if (lotHits.length) {
    kind = (S.lots || []).some((l) => eq(l.supplier)) || S.tasks.some((t) => t.scene === 'IQC' && t.ctx && eq(t.ctx.supplier)) ? '供应商' : (S.lots || []).some((l) => eq(l.receipt)) ? '收货单' : '来料批次';
    direction = 'forward';
    lots = lotHits;
    orders = S.orders.filter((o) => (o.inLots || []).some((l) => lots.indexOf(l) >= 0));
  } else if (task) {
    const o = orderOfTask(task);
    kind = '检验单';
    orders = o ? [o] : [];
    if (!o && task.scene === 'IQC' && task.ctx && task.ctx.batch) { direction = 'forward'; lots = [task.ctx.batch]; orders = S.orders.filter((x) => (x.inLots || []).indexOf(task.ctx.batch) >= 0); }
  }
  if (!kind) return { q: k, kind: 'none', direction, orders: [], lots: [], siblings: [] };
  /* 往后查：可疑的只是查到的那几个来料批次，工单用到的其它来料批次不算可疑，不放进 lots（也就不会被一键限制） */
  if (direction !== 'forward') orders.forEach((o) => (o.inLots || []).forEach((l) => { if (lots.indexOf(l) < 0) lots.push(l); }));
  /* 从出货往回查时，同批来料还用在哪些工单：投诉的遏制范围 */
  const siblings = direction === 'forward' ? [] : S.orders.filter((o) => orders.indexOf(o) < 0 && (o.inLots || []).some((l) => lots.indexOf(l) >= 0));
  return { q: k, kind, direction, orders, lots, siblings, task: kind === '检验单' ? task : null };
}
/** 工单上有效的、禁止发运的质量限制（工单号或成品批次上的） */
function orderShipHolds(o) { return orderHolds(o).filter((h) => h.actions.indexOf('ship') >= 0); }
/**
 * 一键质量限制的候选范围：来料批次禁止使用和继续加工；在制工单禁止继续加工和发运；
 * 已放行没发货的：成品批次禁止发运，没登记成品批次的按工单号禁止发运；已发货的只提示另行通知客户。已经有同样限制的不再重复
 */
function traceHoldScopes(tr) {
  if (!tr) return [];
  const out = [];
  tr.lots.forEach((l) => out.push({ key: '批次:' + l, scopeType: '批次', scopeVal: l, actions: ['use', 'process'], label: '来料批次 ' + l, on: true }));
  tr.orders.concat(tr.siblings || []).forEach((o) => {
    const shipped = orderShipped(o);
    if (!o.releasedAt) out.push({ key: '工单:' + o.wo, scopeType: '工单', scopeVal: o.wo, actions: ['process', 'ship'], label: '在制工单 ' + o.wo, on: true });
    else if (!shipped && !o.outLot) out.push({ key: '工单:' + o.wo, scopeType: '工单', scopeVal: o.wo, actions: ['ship'], label: '已放行未发货的工单 ' + o.wo + '（成品批次未登记，按工单号限制发运）', on: true });
    if (o.outLot) out.push({ key: '批次:' + o.outLot, scopeType: '批次', scopeVal: o.outLot, actions: ['ship'], label: '成品批次 ' + o.outLot + (shipped ? '（已发货，限制不了在途和客户处的货，另需通知客户）' : o.releasedAt ? '（已放行未发货）' : ''), on: !shipped });
  });
  const seen = {};
  return out.filter((s) => {
    if (seen[s.key]) return false;
    seen[s.key] = true;
    return !holdsActive().some((h) => h.scopeVal === s.scopeVal && s.actions.every((a) => h.actions.indexOf(a) >= 0));
  });
}
/** 一键质量限制：质量限制要挂在不合格单上，所以先登记一张 NCR，再把选中的范围逐条建立限制 */
function traceHold(tr, scopes, why) {
  if (!can('hold.create')) throw new Error(denyTip('hold.create'));
  if (!can('ncr.create')) throw new Error(denyTip('ncr.create'));
  if (!tr || tr.kind === 'none') throw new Error('先查出追溯结果');
  if (!scopes || !scopes.length) throw new Error('请至少选择一个范围');
  const o0 = tr.orders[0] || (tr.siblings || [])[0] || null;
  const rec = (S.lots || []).find((l) => tr.lots.indexOf(l.lot) >= 0);
  /* 零件：工单的；其次收货台账的；其次查到的检验单或这个批次的来料检验的；都没有才取第一个零件 */
  const iqc = tr.task || S.tasks.find((t) => t.scene === 'IQC' && t.ctx && tr.lots.indexOf(t.ctx.batch) >= 0) || null;
  const partId = (o0 && o0.partId) || (rec && rec.partId) || (iqc && iqc.partId) || (S.parts[0] && S.parts[0].id);
  const reason = String(why || '').trim();
  const n = createNcr({
    title: '追溯隔离：' + tr.kind + ' ' + tr.q + (reason ? ' · ' + reason : ''), partId, batch: tr.lots[0] || (o0 ? o0.wo : tr.q), severity: '严重',
    qtySuspect: sum(tr.orders.concat(tr.siblings || []).filter((o) => !orderShipped(o)).map((o) => o.qtyIn || o.qty || 0)),
    desc: '由批次追溯一键登记。追溯起点：' + tr.kind + ' ' + tr.q + (reason ? '\n原因：' + reason : '') + '\n涉及来料批次：' + (tr.lots.join('、') || '无') + '\n涉及工单：' + (tr.orders.concat(tr.siblings || []).map((o) => o.wo).join('、') || '无'),
  });
  scopes.forEach((s) => n.holds.push({ id: 'h' + nextSeq(), scopeType: s.scopeType, scopeVal: s.scopeVal, actions: s.actions.slice(), status: 'active', by: S.me, at: nowISO() }));
  ncrLog(n, '由批次追溯一键建立质量限制：' + scopes.map((s) => s.scopeType + ' ' + s.scopeVal + ' 禁止' + s.actions.map((a) => HOLD_ACTIONS[a]).join('、')).join('；'));
  return n;
}

/* ---------------- 扫码 ---------------- */
/** 二维码里的地址：设置了扫码地址就用它，否则用当前打开 QMS 的地址；双击打开的本地文件没有地址，只放编号（扫码枪照样能用） */
function scanBase() {
  /* 地址里自带的 #… 要去掉，否则拼出来的二维码网址打开的是那个页面，不是扫码页 */
  let b = String((S.settings && S.settings.scanBase) || '').trim().replace(/#.*$/, '');
  if (!b && typeof location !== 'undefined' && /^https?:$/.test(location.protocol || '')) b = location.origin + location.pathname;
  if (b && !/\.html?$/i.test(b) && !/\/$/.test(b)) b += '/';
  return b;
}
function scanUrl(code) { const b = scanBase(); return b ? b + '#/scan/' + encodeURIComponent(code) : String(code); }
/** 扫码地址平板能不能访问：localhost、127.0.0.1 只有本机能打开 */
function scanBaseLocal() { const b = scanBase(); return !b || /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(b); }
/** 扫工单码：优先打开“我”在这张工单上要做的检验，其次是轮到我的节点，最后是工单主线 */
function orderScanTarget(o) {
  const open = S.tasks.filter((t) => (t.status === 'pending' || t.status === 'active') && t.assignee === S.me && orderOfTask(t) === o);
  if (open.length) return '/inspect/' + open[0].id;
  const ml = mainlineOf(o), s = ml.mine[0];
  if (s && s.act && s.act.to) return s.act.to;
  return '/orders/' + o.id + (s ? '?stage=' + s.key : '');
}
/** 扫码结果 → 要去的页面：检验单、工单、NCR、报告、批次（追溯） */
function scanTarget(raw) {
  let code = String(raw || '').trim();
  if (!code) return null;
  const m = /#\/scan\/([^?#\s]+)/.exec(code);
  if (m) { try { code = decodeURIComponent(m[1]); } catch (e) { code = m[1]; } } else {
    const hm = /^https?:\/\/[^#]*#(\/\S*)$/i.exec(code);
    if (hm) return { to: hm[1], label: '链接' };
  }
  const lc = code.toLowerCase();
  const t = S.tasks.find((x) => x.code.toLowerCase() === lc);
  if (t) return { to: '/inspect/' + t.id, label: '检验单 ' + t.code };
  const o = S.orders.find((x) => x.wo.toLowerCase() === lc);
  if (o) return { to: orderScanTarget(o), label: '工单 ' + o.wo };
  const n = S.ncrs.find((x) => x.code.toLowerCase() === lc);
  if (n) return { to: '/ncr/' + n.id, label: n.code };
  const r = S.reports.find((x) => x.code.toLowerCase() === lc);
  if (r) return { to: '/reports/' + r.id, label: '报告 ' + r.code };
  const tr = traceOf(code);
  if (tr && tr.kind !== 'none') return { to: '/trace?q=' + encodeURIComponent(code), label: tr.kind + ' ' + code };
  return null;
}

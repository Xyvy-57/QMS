/* =====================================================================
 * 生产现场演示数据（新建的演示数据和旧版本升级都走这里，只运行一次：S.prodV1）
 *   · 机台、班次、收货批次台账
 *   · 补齐检验方案：三个零件的工序路线都有可用方案，主线能从技术准备一路走到质量放行
 *   · 现有工单补投产数、报工、首件记录（首件按机台）
 *   · 两张历史工单：
 *       WO-2611-052 已放行并发货：发货单 DN-2611-007 → 工单 → 来料批次 → 恒科五金（追溯演示）
 *       WO-2611-064 检验全部合格，报工不良 4 件（让步接收 2、报废 2），等待质量放行（让步放行演示）
 * 放在所有页面文件之后运行：会用到 50_ncr.js 等文件里定义的常量。
 * ===================================================================== */

/** 按规格给出合格的读数（与 tests/e2e.mjs 的取值规则一致） */
function demoOkValue(it, i) {
  const dec = (s) => (String(s).split('.')[1] || '').length;
  const l = it.lsl !== '' && it.lsl != null ? parseFloat(it.lsl) : null, u = it.usl !== '' && it.usl != null ? parseFloat(it.usl) : null;
  if (l != null && u != null) return ((l + u) / 2 + (u - l) * 0.05 * ((i % 3) - 1)).toFixed(Math.max(dec(it.lsl), dec(it.usl)));
  if (l != null) return (l * 1.04).toFixed(dec(it.lsl));
  if (u != null) return (u * 0.5).toFixed(dec(it.usl) + 1);
  return '0';
}
let demoTaskN = 0;
/** 一张已经检验合格、报告已冻结（需要复核的已签批）的历史检验任务 */
function demoTask(o) {
  const plan = S.plans.find((p) => p.code === o.plan && p.status === 'effective');
  if (!plan || !plan.scenes.includes(o.scene)) return null;
  const at = o.at, done = o.done || o.at;
  const prefix = TASK_PREFIX[o.scene] + '-' + dateCode(new Date(at)) + '-';
  let code;
  do { code = prefix + String(900 + ++demoTaskN); }
  while (S.tasks.some(t => t.code === code || t.id === 'th' + demoTaskN));
  const t = { id: 'th' + demoTaskN, code, scene: o.scene, partId: plan.partId, planId: plan.id, lot: o.lot || 0, ctx: Object.assign({}, o.ctx), assignee: o.by, due: done, status: 'pending', rounds: [], reportIds: [], createdAt: at, createdBy: o.createdBy || 'u2' };
  t.snap = buildSnapshot(S, plan, o.scene);
  t.snap.frozenAt = at;
  const r = newRound(t, 1);
  t.snap.items.forEach((it) => {
    if (it.group === 'M') r.samples.forEach((s, i) => { r.vals[it.cid][i] = demoOkValue(it, i); });
    if (it.group === 'C') r.cnt[it.cid].bad = '0';
  });
  if (t.snap.groups.some((g) => g.type === 'count')) r.dUnits = '0';
  const ev = evalRound(t, r);
  r.status = 'submitted'; r.submittedAt = done; r.result = summarizeEval(ev);
  t.status = ev.overall === 'pass' ? 'pass' : ev.overall === 'fail' ? 'fail' : 'insufficient';
  t.rounds.push(r);
  const rep = buildReport(S, t, r);
  rep.createdAt = done;
  const nm = userName(o.by);
  r.signer = { uid: o.by, name: nm, img: demoSignature(nm), at: done, hash: rep.hash };
  rep.sigs.push(Object.assign({ kind: '检验' }, r.signer));
  rep.state = 'frozen';
  if (reviewNeeded(t, t.status)) { const rn = userName('u3'); rep.state = 'approved'; rep.sigs.push({ kind: '复核', uid: 'u3', name: rn, img: demoSignature(rn), at: done, hash: rep.hash }); }
  t.reportIds.push(rep.id);
  S.tasks.push(t);
  S.reports.push(rep);
  return S.tasks[S.tasks.length - 1];
}

function seedProductionDemo() {
  if (S.prodV1) return;
  const day = (n) => dateCode(new Date(Date.now() - n * 864e5));
  if (!Array.isArray(S.settings.shifts)) S.settings.shifts = clone(SHIFTS_DEFAULT);
  if (S.settings.faiShift == null) S.settings.faiShift = true;
  if (S.settings.scanBase == null) S.settings.scanBase = '';
  if (!Array.isArray(S.machines)) S.machines = clone(MACHINES_DEMO);
  if (!Array.isArray(S.lots)) S.lots = [];
  S.orders.forEach((o) => {
    if (!Array.isArray(o.work)) o.work = [];
    if (!Array.isArray(o.setups)) o.setups = [];
    if (typeof o.qtyIn !== 'number') o.qtyIn = 0;
    if (!Array.isArray(o.inLots)) o.inLots = [];
  });

  /* 1. 补齐检验方案（已有同编号的不动） */
  const addPlan = (p, pick) => {
    if (S.plans.some((x) => x.code === p.code || x.id === p.id)) return;
    const std = effectiveStd(p.partId);
    if (!std) return;
    const assign = {};
    std.items.forEach((it) => { assign[it.cid] = pick(it); });
    S.plans.push(Object.assign({ rev: 1, status: 'effective', createdBy: 'u2', updatedAt: daysAgo(10), approvedBy: 'u3' }, p, { stdId: std.id, assign }));
  };
  addPlan({ id: 'pl-p1out', code: 'PL-011-OUT', name: '01系列阀芯 · 完工与出货方案', partId: 'p1', scenes: ['FQC', 'OQC'], groups: [{ key: 'M', type: 'measure', name: '计量组', n: 3 }, { key: 'C', type: 'count', name: '计数组', n: 32, ac: 1, re: 2, aql: '1.0', lotRef: 200, earlyReject: true }], reportTplId: 'rt-bubble' }, (it) => (it.kind === 'count' ? 'C' : it.cat === '线性尺寸' ? 'M' : '-'));
  addPlan({ id: 'pl-p2iqc', code: 'PL-018-IQC', name: '01系列轴 · 调质外协回厂检验方案', partId: 'p2', scenes: ['IQC'], groups: [{ key: 'M', type: 'measure', name: '计量组', n: 3 }], reportTplId: 'rt-iqc' }, (it) => (it.no <= 3 ? 'M' : '-'));
  addPlan({ id: 'pl-p2oqc', code: 'PL-018-OQC', name: '01系列轴 · 出货检验方案', partId: 'p2', scenes: ['OQC'], groups: [{ key: 'M', type: 'measure', name: '计量组', n: 5 }], reportTplId: 'rt-oqc' }, () => 'M');
  addPlan({ id: 'pl-p3iqc', code: 'PL-092-IQC', name: 'CP钻头组件 · 刃具来料检验方案', partId: 'p3', scenes: ['IQC'], groups: [{ key: 'M', type: 'measure', name: '计量组', n: 5 }], reportTplId: 'rt-iqc' }, (it) => (it.no <= 2 ? 'M' : '-'));
  addPlan({ id: 'pl-p3fai', code: 'PL-092-FAI', name: 'CP钻头组件 · 组装首件方案', partId: 'p3', scenes: ['FIRST'], groups: [{ key: 'M', type: 'measure', name: '计量组', n: 3 }], reportTplId: 'rt-fai' }, (it) => (it.kind === 'count' ? '-' : 'M'));

  /* 2. 收货批次台账 */
  const tk = (id) => S.tasks.find((t) => t.id === id) || null;
  const addLot = (l) => { if (!S.lots.some((x) => x.lot === l.lot)) S.lots.push(Object.assign({ id: 'lot' + (S.lots.length + 1) }, l)); };
  const t6 = tk('t6'), t1 = tk('t1'), t3 = tk('t3'), t5 = tk('t5');
  if (t6 && t6.ctx.batch) addLot({ lot: t6.ctx.batch, item: '阀芯毛坯（40Cr）', partId: 'p1', supplier: t6.ctx.supplier, receipt: t6.ctx.receipt, qty: 1241, receivedAt: daysAgo(2, 8) });
  if (t1 && t1.ctx.batch) addLot({ lot: t1.ctx.batch, item: '阀芯毛坯（40Cr）', partId: 'p1', supplier: t1.ctx.supplier, receipt: t1.ctx.receipt, qty: 1241, receivedAt: daysAgo(0, 7, 40) });
  const H1 = day(9) + '-H1', H2 = day(4) + '-H2', T1 = day(1) + '-T1';
  const n3 = S.ncrs.find((n) => n.id === 'n3');
  const R1 = n3 && n3.batch ? n3.batch : day(0) + '-R1';
  addLot({ lot: H1, item: '刃具坯料（W6Mo5Cr4V2）', partId: 'p3', supplier: '恒科五金（示例）', receipt: 'IR' + day(9).slice(2) + 'H1', qty: 520, receivedAt: daysAgo(9, 9) });
  addLot({ lot: H2, item: '刃具坯料（W6Mo5Cr4V2）', partId: 'p3', supplier: '恒科五金（示例）', receipt: 'IR' + day(4).slice(2) + 'H2', qty: 320, receivedAt: daysAgo(4, 9) });
  addLot({ lot: T1, item: '轴调质外协回厂件', partId: 'p2', supplier: '东辰表面处理（示例）', receipt: 'IR' + day(1).slice(2) + 'T1', qty: 200, receivedAt: daysAgo(1, 14) });
  addLot({ lot: R1, item: '刃具（外协涂层回厂）', partId: 'p3', supplier: '东辰表面处理（示例）', receipt: 'IR' + day(0).slice(2) + 'R1', qty: 200, receivedAt: daysAgo(0, 9) });

  /* 3. 现有工单：投产数、报工、首件（按机台） */
  const ord = (wo) => S.orders.find((o) => o.wo === wo) || null;
  const work = (o, x) => { o.work.push(Object.assign({ id: 'w' + nextSeq(), opNo: String(x.op).split(' ')[0], machine: '', bad: 0, reason: '', ncrId: '', by: 'u4', shift: shiftAt(x.at).name }, x)); };
  const o11 = ord('WO-2611-011');
  if (o11 && o11.partId === 'p1' && !o11.work.length) {
    o11.qtyIn = 200;
    demoTask({ scene: 'FIRST', plan: 'PL-011-PRC', ctx: { wo: o11.wo, op: '20 精车', machine: 'CNC-04', trigger: '开工' }, at: daysAgo(1, 8, 5), done: daysAgo(1, 8, 40), by: 'u1' });
    work(o11, { op: '20 精车', machine: 'CNC-04', good: 120, at: daysAgo(1, 10, 30) });
  }
  const o18 = ord('WO-2611-018');
  if (o18 && o18.partId === 'p2' && !o18.work.length) {
    o18.qtyIn = o18.qty || 200;
    if (o18.inLots.indexOf(T1) < 0) o18.inLots.push(T1);
    demoTask({ scene: 'FIRST', plan: 'PL-018-PRC', ctx: { wo: o18.wo, op: '20 粗车', machine: 'CNC-01', trigger: '开工' }, at: daysAgo(2, 8, 20), done: daysAgo(2, 8, 55), by: 'u1' });
    demoTask({ scene: 'IPQC', plan: 'PL-018-PRC', ctx: { wo: o18.wo, op: '20 粗车', machine: 'CNC-01', freq: '每 2 小时' }, at: daysAgo(2, 11), done: daysAgo(2, 11, 20), by: 'u1' });
    demoTask({ scene: 'IQC', plan: 'PL-018-IQC', ctx: { supplier: '东辰表面处理（示例）', receipt: 'IR' + day(1).slice(2) + 'T1', batch: T1, op: '30 调质（外协）' }, at: daysAgo(1, 15), done: daysAgo(1, 15, 40), by: 'u7' });
    work(o18, { op: '10 下料', good: o18.qtyIn, at: daysAgo(2, 9, 30) });
    work(o18, { op: '20 粗车', machine: 'CNC-01', good: o18.qtyIn, at: daysAgo(2, 17) });
  }
  const o92 = ord('WO-2611-092');
  if (o92 && o92.partId === 'p3' && !o92.work.length) {
    o92.qtyIn = o92.qty || 500;
    if (o92.inLots.indexOf(R1) < 0) o92.inLots.push(R1);
    if (!o92.outLot && t5 && t5.ctx.batch) o92.outLot = t5.ctx.batch;
    demoTask({ scene: 'FIRST', plan: 'PL-092-FAI', ctx: { wo: o92.wo, op: '20 组装', machine: '装配线 B', trigger: '开工' }, at: daysAgo(1, 8, 10), done: daysAgo(1, 8, 45), by: 'u7' });
    work(o92, { op: '20 组装', machine: '装配线 B', good: o92.qtyIn, at: daysAgo(1, 17) });
  }

  /* 两张历史工单的检验单要用到这三份方案：用户改过演示数据、方案不在了，就不造这两张工单（造出来检验对不上，主线会是乱的） */
  const p3Plans = ['PL-092-IQC', 'PL-092-FAI', 'PL-092-OUT'].every((c) => S.plans.some((p) => p.code === c && p.status === 'effective' && p.partId === 'p3'));

  /* 4. 历史工单 WO-2611-052：已放行并发货（发货单 DN-2611-007，出货检验 t3） */
  if (p3Plans && !ord('WO-2611-052') && t3 && t3.status === 'pass' && t3.partId === 'p3') {
    const D1 = t3.ctx.batch;
    S.orders.push({ id: 'oh52', wo: 'WO-2611-052', partId: 'p3', qty: 500, qtyIn: 500, due: daysAgo(0, 18), inLots: [H1], outLot: D1, createdAt: daysAgo(9, 10), createdBy: 'u4', work: [], setups: [], releasedAt: daysAgo(1, 16, 30), releasedBy: 'u3', releaseNote: '首件、完工、出货检验均合格，报告齐全', releaseKind: 'normal', releaseBasis: [] });
    const o = S.orders[S.orders.length - 1];
    demoTask({ scene: 'IQC', plan: 'PL-092-IQC', ctx: { supplier: '恒科五金（示例）', receipt: 'IR' + day(9).slice(2) + 'H1', batch: H1 }, at: daysAgo(8, 10), done: daysAgo(8, 10, 50), by: 'u7' });
    demoTask({ scene: 'FIRST', plan: 'PL-092-FAI', ctx: { wo: o.wo, op: '20 组装', machine: '装配线 B', trigger: '开工' }, at: daysAgo(6, 8, 30), done: daysAgo(6, 9, 10), by: 'u7' });
    demoTask({ scene: 'FQC', plan: 'PL-092-OUT', ctx: { wo: o.wo, batch: D1 }, lot: 500, at: daysAgo(2, 15), done: daysAgo(2, 16), by: 'u7' });
    work(o, { op: '20 组装', machine: '装配线 B', good: 500, at: daysAgo(6, 17) });
    work(o, { op: '30 终检', good: 500, at: daysAgo(2, 16) });
    S.audit.push({ at: daysAgo(1, 16, 30), uid: 'u3', act: '生产工单', obj: o.wo, text: '质量放行：首件、完工、出货检验均合格，报告齐全' });
  }

  /* 5. 历史工单 WO-2611-064：检验全部合格，让步接收 2 件，等待质量放行 */
  if (p3Plans && !ord('WO-2611-064') && S.parts.some((p) => p.id === 'p3')) {
    const F1 = day(1) + '-F1';
    S.orders.push({ id: 'oh64', wo: 'WO-2611-064', partId: 'p3', qty: 300, qtyIn: 300, due: hoursFromNow(30), inLots: [H2], outLot: F1, createdAt: daysAgo(4, 10), createdBy: 'u4', work: [], setups: [] });
    const o = S.orders[S.orders.length - 1];
    o.setups.push({ id: 'suh64', op: '20 组装', opNo: '20', machine: '装配线 B', trigger: '开工', note: '', shift: '白班', by: 'u4', at: daysAgo(3, 8) });
    demoTask({ scene: 'IQC', plan: 'PL-092-IQC', ctx: { supplier: '恒科五金（示例）', receipt: 'IR' + day(4).slice(2) + 'H2', batch: H2 }, at: daysAgo(4, 10), done: daysAgo(4, 10, 40), by: 'u7' });
    demoTask({ scene: 'FIRST', plan: 'PL-092-FAI', ctx: { wo: o.wo, op: '20 组装', machine: '装配线 B', trigger: '开工', setupId: 'suh64' }, at: daysAgo(3, 8, 10), done: daysAgo(3, 8, 50), by: 'u7' });
    const maxNo = Math.max(0, ...S.ncrs.map((n) => parseInt(String(n.code).slice(-4), 10) || 0));
    const ncrCode = 'NCR-' + new Date().getFullYear() + '-' + String(maxNo + 1).padStart(4, '0');
    o.work.push({ id: 'wh64', op: '20 组装', opNo: '20', machine: '装配线 B', good: 296, bad: 4, reason: '刃口轻微色差 2 件、崩边 2 件', ncrId: 'nh64', shift: '白班', by: 'u4', at: daysAgo(2, 17) });
    S.ncrs.push({
      id: 'nh64', code: ncrCode, title: '工序 20 组装 报工不良 4 件：刃口轻微色差 2 件、崩边 2 件', severity: '轻微', status: 'closed', partId: 'p3', batch: o.wo, taskId: '', roundId: '', cids: ['CH-092-05'],
      desc: '工单 ' + o.wo + '，工序 20 组装（装配线 B），白班报工：合格 296 件，不良 4 件。\n不良现象：刃口轻微色差 2 件、崩边 2 件', qtySuspect: 4, qtyConfirmed: 4, createdBy: 'u4', createdAt: daysAgo(2, 17), photos: [], workId: 'wh64', op: '20 组装',
      disp: [
        { id: 'dh64a', qty: 2, action: '让步接收', reason: '色差只影响外观、不影响切削性能；客户书面同意让步接收（让步申请单 CC-2611-05）', by: 'u2', approved: true, approvedBy: 'u3', approvedAt: daysAgo(2, 19), executed: true, executedBy: 'u2', executedAt: daysAgo(1, 9), evidence: '2 件已做让步标识，随货附让步单 CC-2611-05' },
        { id: 'dh64b', qty: 2, action: '报废', reason: '刃口崩边，无法修复', by: 'u2', approved: true, approvedBy: 'u3', approvedAt: daysAgo(2, 19), executed: true, executedBy: 'u2', executedAt: daysAgo(1, 9, 10), evidence: '已报废，报废单 SC-2611-21' },
      ],
      holds: [], closedAt: daysAgo(1, 10), closedBy: 'u3',
      log: [
        { at: daysAgo(2, 17), by: 'u4', text: '由工单 ' + o.wo + ' 报工自动登记（工序 20 组装）' },
        { at: daysAgo(2, 17, 30), by: 'u2', text: '确认范围：可疑 4 件，确认不合格 4 件' },
        { at: daysAgo(2, 18), by: 'u2', text: '提交 MRB 评审：让步接收 2，报废 2' },
        { at: daysAgo(2, 19), by: 'u3', text: '批准处置：让步接收 2 件（客户书面同意 CC-2611-05）、报废 2 件' },
        { at: daysAgo(1, 9, 10), by: 'u2', text: '登记执行：让步 2 件已标识随货，报废 2 件（SC-2611-21）' },
        { at: daysAgo(1, 10), by: 'u3', text: '验证通过并关闭' },
      ],
    });
    work(o, { op: '30 终检', good: 298, at: daysAgo(1, 12) });
    demoTask({ scene: 'FQC', plan: 'PL-092-OUT', ctx: { wo: o.wo, batch: F1 }, lot: orderQty(o).stocked, at: daysAgo(1, 11), done: daysAgo(1, 12), by: 'u7' });
    demoTask({ scene: 'OQC', plan: 'PL-092-OUT', ctx: { customer: '锐驰装备（示例）', shipment: 'DN-2611-010', batch: F1 }, lot: orderQty(o).stocked, at: daysAgo(0, 8, 30), done: daysAgo(0, 9, 20), by: 'u7' });
  }
  S.prodV1 = true;
}
seedProductionDemo();

// 一进入就能试分批交检的独立样单。已有浏览器只追加这张示例，不重签历史报告。
function seedSplitLotDemo() {
  if (S.splitLotDemo || S.orders.some(o => o.id === 'odemo72' || o.wo === 'WO-DEMO-072')) return;
  if (!['PL-092-IQC', 'PL-092-FAI', 'PL-092-OUT'].every(code => S.plans.some(p => p.code === code && p.status === 'effective'))) return;
  const wo = 'WO-DEMO-072', batch = 'FG-DEMO-072', material = 'MAT-DEMO-072';
  const customer = partOf('p3').customer, supplier = '新锐工具（演示）';
  if (!S.suppliers.includes(supplier)) S.suppliers.push(supplier);
  const assembly = '20 组装', final = '30 终检';
  const work = (id, op, hour) => ({ id, op, opNo: op.split(' ')[0], machine: op === assembly ? '装配线 B' : '', at: daysAgo(1, hour), good: 298, bad: 0, by: 'u4', shift: '白班' });
  S.orders.push({ id: 'odemo72', wo, partId: 'p3', qty: 300, qtyIn: 298, inLots: [material], outLot: batch,
    due: hoursFromNow(48), createdAt: daysAgo(2, 8), createdBy: 'u4', setups: [], work: [work('wd72a', assembly, 11), work('wd72b', final, 12)] });
  S.lots.push({ lot: material, item: '刃具坯料（演示）', partId: 'p3', supplier, receipt: 'IR-DEMO-072', qty: 298, receivedAt: daysAgo(2, 8) });
  const done = (scene, plan, ctx, lot, at) => demoTask({ scene, plan, ctx: { wo, ...ctx }, lot, at, by: 'u7' });
  done('IQC', 'PL-092-IQC', { supplier, receipt: 'IR-DEMO-072', batch: material }, 298, daysAgo(2, 9));
  done('FIRST', 'PL-092-FAI', { op: assembly, machine: '装配线 B', trigger: '开工' }, 0, daysAgo(1, 8));
  done('FQC', 'PL-092-OUT', { op: final, batch, workId: 'wd72b' }, 298, daysAgo(1, 13));
  done('OQC', 'PL-092-OUT', { op: '40 出货', batch, customer, shipment: 'DN-DEMO-072-A' }, 100, daysAgo(1, 15));
  S.splitLotDemo = true;
}
seedSplitLotDemo();

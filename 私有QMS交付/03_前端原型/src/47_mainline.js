/* =====================================================================
 * 生产主线：以生产工单为主线，所有岗位都围着工单走
 *   ① 技术准备（图纸气泡 → 检验标准 → 检验方案）
 *   ②… 各类检验：按这个零件工序路线上出现的先后排列（来料 / 首件 / 巡检 / 外协回厂 / 完工 / 出货）
 *   ⑦ 质量放行：所有检验合格、不合格已处置关闭、没有有效质量限制，由质量负责人放行
 *   不合格处置（NCR）挂在出问题的节点上；每个节点都给出：现在什么状态、在等谁、下一步按哪个按钮
 * ===================================================================== */

const ML_SCENE = { IQC: '来料检验', FIRST: '首件检验', IPQC: '过程巡检', FQC: '完工检验', OQC: '出货检验' };
function permRoles(perm) { return perm && PERMS[perm] ? PERMS[perm].roles.slice() : []; }
function ownerText(ow) {
  if (!ow) return '';
  if (ow.uid) return userName(ow.uid);
  return (ow.roles || []).map((r) => ROLES[r].name).join(' / ');
}
function isMineOwner(ow) {
  if (!ow) return false;
  if (ow.uid) return ow.uid === S.me;
  return (ow.roles || []).indexOf(me.value.role) >= 0;
}

/* ---------------- 工单关联的检验、不合格、质量限制 ---------------- */
function orderLots(o) { return [o.wo].concat(o.inLots || [], o.outLot ? [o.outLot] : []).filter(Boolean); }
function orderNcrs(o) {
  const lots = orderLots(o);
  return S.ncrs.filter((n) => {
    if (n.partId !== o.partId && !n.holds.some((h) => lots.indexOf(h.scopeVal) >= 0)) return false;
    if (lots.indexOf(n.batch) >= 0 || n.holds.some((h) => lots.indexOf(h.scopeVal) >= 0)) return true;
    const t = n.taskId ? taskOf(n.taskId) : null;
    return !!t && !!t.ctx && (t.ctx.wo === o.wo || (t.ctx.batch && lots.indexOf(t.ctx.batch) >= 0));
  });
}
function orderHolds(o) { const lots = orderLots(o); return holdsActive().filter((h) => lots.indexOf(h.scopeVal) >= 0); }
/** 检验任务属于哪张工单：任务上写了工单号，或者来料 / 出货批次登记在工单上 */
function orderOfTask(t) {
  if (!t || !t.ctx) return null;
  const matches = S.orders.filter((o) => o.partId === t.partId && (t.ctx.wo ? t.ctx.wo === o.wo : t.ctx.batch && orderLots(o).includes(t.ctx.batch)));
  return matches.length === 1 ? matches[0] : null;
}
function orderOfNcr(n) {
  if (!n) return null;
  const direct = S.orders.find((o) => o.partId === n.partId && o.wo === n.batch) || orderOfTask(taskOf(n.taskId));
  if (direct) return direct;
  const matches = S.orders.filter((o) => orderNcrs(o).some((x) => x.id === n.id));
  return matches.length === 1 ? matches[0] : null;
}
function orderOfReport(r) { return r ? orderOfTask(taskOf(r.taskId)) : null; }
/** 工单上某类检验的任务（新的在前）：工序检验点上的任务 + 按批次关联的来料 / 出货任务 */
function stageTasks(o, scene, pts) {
  const ids = new Set();
  const out = [];
  pts.forEach((x) => x.tasks.forEach((t) => { if (!ids.has(t.id)) { ids.add(t.id); out.push(t); } }));
  S.tasks.forEach((t) => {
    if (ids.has(t.id) || t.scene !== scene || t.partId !== o.partId || !t.ctx) return;
    if (t.ctx.wo ? t.ctx.wo === o.wo : t.ctx.batch && orderLots(o).includes(t.ctx.batch)) { ids.add(t.id); out.push(t); }
  });
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/* ---------------- 各节点的状态 ---------------- */
function prepStage(o, part, pts) {
  const s = { key: 'prep', label: '技术准备', sub: '图纸 → 标准 → 方案', icon: 'ruler', refs: {} };
  if (!part.id) return Object.assign(s, { state: 'blocked', text: '工单上的零件不存在', owner: { roles: permRoles('order.create') } });
  const std = effectiveStd(part.id);
  s.refs.std = std;
  if (!std) {
    const rv = S.standards.find((x) => x.partId === part.id && x.status === 'review');
    const dr = S.standards.find((x) => x.partId === part.id && x.status === 'draft');
    const sy = S.syncInbox.find((x) => x.status === 'pending' && (x.partId === part.id || x.drawingNo === part.drawingNo));
    if (rv) return Object.assign(s, { state: 'active', text: '标准 ' + rv.code + ' Rev ' + rv.rev + ' 等待批准', owner: { roles: permRoles('std.approve') }, since: rv.submittedAt || rv.createdAt, act: { label: '去审批标准', perm: 'std.approve', to: '/standards/' + rv.id } });
    if (dr) return Object.assign(s, { state: 'active', text: '标准草稿 ' + dr.code + ' Rev ' + dr.rev + ' 待核对并提交', owner: { roles: permRoles('std.edit') }, since: dr.createdAt, act: { label: '核对标准', perm: 'std.edit', to: '/standards/' + dr.id } });
    if (sy) return Object.assign(s, { state: 'active', text: '气泡同步 ' + sy.syncBatchId + ' 待生成标准草稿', owner: { roles: permRoles('bubble.sync') }, since: sy.at, act: { label: '生成标准草稿', perm: 'bubble.sync', to: '/bubble' } });
    return Object.assign(s, { state: 'active', text: '图纸还没有标注：在气泡识别里上传图纸、校核并冻结', owner: { roles: permRoles('bubble.sync') }, act: { label: '去气泡识别', perm: 'bubble.sync', to: '/bubble' } });
  }
  if (!pts.length) return Object.assign(s, { state: 'active', text: '零件还没有工序路线：应用工序模板后才知道要检哪些点', owner: { roles: permRoles('md.edit') }, act: { label: '设置工序路线', perm: 'md.edit', to: '/parts?id=' + part.id } });
  return Object.assign(s, { state: 'done', text: '标准 ' + std.code + ' Rev ' + std.rev + ' 已生效（图纸 Rev ' + std.drawingRev + '）', owner: { roles: permRoles('std.edit') }, doneAt: std.approvedAt || std.createdAt });
}

function inspStage(o, part, scene, pts, q) {
  const s = { key: scene, scene, label: ML_SCENE[scene] || sceneOf(scene).name, icon: SCENE_META[scene] ? SCENE_META[scene].icon : 'list', refs: {} };
  const ops = Array.from(new Set(pts.map((x) => x.key)));
  s.sub = ops.length === 1 ? ops[0] : ops.length + ' 道工序';
  if (scene === 'IQC' && ops.length === 1 && pts[0].b.note) s.sub = pts[0].b.note;
  const tasks = stageTasks(o, scene, pts);
  const reports = S.reports.filter((r) => tasks.some((t) => t.id === r.taskId));
  const ncrs = [];
  tasks.forEach((t) => ncrsOfTask(t.id).forEach((n) => { if (ncrs.indexOf(n) < 0) ncrs.push(n); }));
  Object.assign(s.refs, { tasks, reports, ncrs, points: pts });
  /* 首件按“工序 × 机台 × 触发事件”判断：开班、换型、换刀、修机后都要重新做 */
  const reqs = scene === 'FIRST' ? faiReqs(o, q) : null;
  if (reqs) s.refs.reqs = reqs;
  const hasPlan = plansFor(part.id, scene).length > 0;
  const openN = ncrs.filter((n) => n.status !== 'closed');
  const latest = (x) => x.last || null;
  const lasts = reqs ? reqs.map((r) => r.task).filter(Boolean) : pts.map(latest).filter(Boolean).concat(tasks.filter((t) => !pts.some((x) => x.last === t) && !pts.some((x) => x.tasks.indexOf(t) >= 0)).slice(0, 1));
  if (openN.length) {
    const n = openN[0], nx = nextOf('ncr', n);
    return Object.assign(s, { state: 'blocked', text: n.code + '：' + nx.text, owner: { roles: permRoles(nx.perm) }, since: n.log && n.log.length ? n.log[n.log.length - 1].at : n.createdAt, act: { label: '打开 ' + n.code, perm: nx.perm, to: '/ncr/' + n.id } });
  }
  const isLot = scene === 'FQC' || scene === 'OQC';
  const results = isLot ? tasks : lasts;
  const fail = results.find((t) => t.status === 'fail');
  if (fail) return Object.assign(s, { state: 'blocked', text: fail.code + ' 不合格：登记不合格并安排处置', owner: { roles: permRoles('ncr.create') }, since: lastDoneAt(fail), act: { label: '打开检验', perm: 'ncr.create', to: '/inspect/' + fail.id } });
  const insuf = results.find((t) => t.status === 'insufficient');
  if (insuf) return Object.assign(s, { state: 'blocked', text: insuf.code + ' 证据不足：发起补测轮次', owner: { roles: permRoles('task.retest') }, since: lastDoneAt(insuf), act: { label: '发起补测', perm: 'task.retest', to: '/inspect/' + insuf.id + '?retest=1' } });
  const rv = reports.find((r) => r.state === 'review');
  if (rv) return Object.assign(s, { state: 'active', text: '报告 ' + rv.code + ' 等待复核签批', owner: { roles: permRoles('report.review') }, since: rv.createdAt, act: { label: '去复核', perm: 'report.review', to: '/reports/' + rv.id } });
  const open = tasks.find((t) => t.status === 'active' || t.status === 'pending');
  if (open) return Object.assign(s, { state: 'active', text: (open.status === 'pending' ? '已开单 ' : '检验中 ') + open.code, owner: { uid: open.assignee, roles: permRoles('task.measure') }, since: open.createdAt, act: { label: open.status === 'pending' ? '开始检验' : '继续检验', perm: 'task.measure', to: '/inspect/' + open.id } });
  const latestDone = tasks.reduce((m, t) => { const d = lastDoneAt(t); return d > m ? d : m; }, '');
  if (reqs) {
    const need = reqs.find((r) => !r.task);
    if (need) {
      if (!hasPlan) return Object.assign(s, { state: tasks.length ? 'active' : 'todo', text: '还没有生效的' + s.label + '方案', owner: { roles: permRoles('plan.edit') }, since: latestDone || undefined, act: { label: '编制方案', perm: 'plan.edit', to: '/plans?tab=tpl' }, needPlan: true });
      return Object.assign(s, {
        state: tasks.length ? 'active' : 'todo', text: faiLabel(need) + '待检：工序 ' + need.key + (need.machine ? ' · ' + need.machine : ''), owner: { roles: permRoles('task.create') }, since: need.at || undefined,
        act: { label: '开首件', perm: 'task.create', point: pts.find((x) => x.key === need.key) || null, machine: need.machine, trigger: need.trigger, setupId: need.ev ? need.ev.id : '' },
      });
    }
    const doneAt = reqs.reduce((m, r) => { const d = passAt(r.task); return d > m ? d : m; }, '') || latestDone;
    return Object.assign(s, { state: 'done', text: reqs.length ? '首件合格：' + reqs.map((r) => (r.machine || '默认机台') + ' ' + faiLabel(r)).join('、') : '没有在生产的机台', owner: { roles: permRoles('task.create') }, doneAt });
  }
  const next = pts.find((x) => !x.last);
  if (next || (!pts.length && !tasks.length)) {
    if (!hasPlan) return Object.assign(s, { state: tasks.length ? 'active' : 'todo', text: '还没有生效的' + s.label + '方案', owner: { roles: permRoles('plan.edit') }, since: latestDone || undefined, act: { label: '编制方案', perm: 'plan.edit', to: '/plans?tab=tpl' }, needPlan: true });
    return Object.assign(s, { state: tasks.length ? 'active' : 'todo', text: (tasks.length ? '还有检验点没检：' : '待开检：') + (next ? '工序 ' + next.key + (next.b.freq ? ' · ' + next.b.freq : '') : ''), owner: { roles: permRoles('task.create') }, since: latestDone || undefined, act: { label: '开检', perm: 'task.create', point: next || null } });
  }
  if (isLot && tasks.length) {
    for (const point of pts) {
      const facts = orderLotFacts(o, scene, point.key, q);
      if (facts.remaining > 0) return Object.assign(s, {
        state: 'active', text: '已交检 ' + facts.assigned + ' 件，还有 ' + facts.remaining + ' 件待交检',
        owner: { roles: permRoles('task.create') }, since: latestDone,
        act: { label: '开下一批' + s.label, perm: 'task.create', point },
      });
    }
  }
  return Object.assign(s, { state: 'done', text: scene === 'IPQC' ? '已巡检 ' + tasks.length + ' 次，最近一次合格' : '合格' + (reports[0] ? ' · 报告 ' + reports[0].code : ''), owner: { roles: permRoles('task.create') }, doneAt: latestDone });
}

function releaseStage(o, prior, q) {
  const s = { key: 'release', label: '质量放行', sub: '放行后可以入库发货', icon: 'shield', refs: {}, checks: [] };
  const holds = orderHolds(o), openN = orderNcrs(o).filter((n) => n.status !== 'closed');
  q = q || orderQty(o);
  s.checks = prior.filter((x) => x.state !== 'na').map((x) => ({ key: x.key, stage: x.key, ok: x.state === 'done', text: x.label + (x.state === 'done' ? ' 已完成' : '：' + x.text) }))
    .concat([{ key: 'ncr', ok: !openN.length, to: openN.length ? '/ncr/' + openN[0].id : '', link: '打开不合格单', text: openN.length ? '还有 ' + openN.length + ' 张不合格（' + openN.map((n) => n.code).join('、') + '）没有关闭' : '不合格都已处置关闭' }])
    .concat([{ key: 'holds', ok: !holds.length, to: holds.length ? '/ncr/' + holds[0].ncr.id + '?show=holds' : '', link: '查看质量限制', text: holds.length ? '有效的质量限制：' + holds.map((h) => h.scopeType + ' ' + h.scopeVal + ' 禁止' + h.actions.map((a) => HOLD_ACTIONS[a]).join('、')).join('；') : '没有有效的质量限制' }])
    .concat([{ key: 'qty', ok: q.balanced, text: q.balanced ? balanceText(q) : qtyGapText(q) }]);
  const cons = orderConcessions(o);
  if (cons.length) {
    const codes = cons.map((c) => c.n.code).filter((x, i, a) => a.indexOf(x) === i);
    s.checks.push({ key: 'basis', ok: true, warn: true, text: '有让步接收 ' + sum(cons.map((c) => c.d.qty)) + ' 件（' + codes.join('、') + '）：放行时要附客户或技术批准依据' });
  }
  if (o.releasedAt) return Object.assign(s, { state: 'done', text: userName(o.releasedBy) + ' 于 ' + fmtTime(o.releasedAt) + (o.releaseKind === 'concession' ? ' 让步放行' : ' 放行'), owner: { roles: permRoles('order.release') }, doneAt: o.releasedAt });
  if (holds.length) return Object.assign(s, { state: 'blocked', text: '有质量限制，不能放行', owner: { roles: permRoles('hold.release') }, act: { label: '查看质量限制', perm: 'hold.release', to: '/ncr/' + holds[0].ncr.id } });
  const left = s.checks.filter((c) => !c.ok).length;
  if (left) return Object.assign(s, { state: 'todo', text: '还差 ' + left + ' 项才能放行', owner: { roles: permRoles('order.release') } });
  return Object.assign(s, { state: 'active', text: '全部完成，等待质量放行', owner: { roles: permRoles('order.release') }, act: { label: '质量放行', perm: 'order.release', release: true } });
}

/* ---------------- 巡检频次：每 N 小时 / 每班 / 每天 ---------------- */
function freqHours(freq) {
  const t = String(freq || '');
  let m = /每\s*(\d+(?:\.\d+)?)\s*小时/.exec(t);
  if (m) return parseFloat(m[1]);
  m = /每\s*(\d+)\s*分钟/.exec(t);
  if (m) return parseInt(m[1], 10) / 60;
  if (/每班/.test(t)) { const sh = shiftAt(); return (sh.end.getTime() - sh.start.getTime()) / 3600e3 || 8; } // 按设置的班次时长（默认两班倒，12 小时）
  if (/每天|每日/.test(t)) return 24;
  return 0;
}
function lastDoneAt(t) { const r = t.rounds[t.rounds.length - 1]; return (r && r.submittedAt) || t.createdAt; }
/** 巡检计时从哪一刻起：上次巡检和这道工序最近一次首件合格，取晚的（开班、换刀后的首件就是本班第一次检查） */
function ipqcFrom(x, reqs) {
  const fai = (reqs || []).filter((r) => r.key === x.key).reduce((m, r) => { const d = passAt(r.task); return d > m ? d : m; }, '');
  const last = x.last ? lastDoneAt(x.last) : '';
  return last > fai ? last : fai;
}
/** 生产没结束（完工检验还没完成）时，还在生产的工序巡检超过频次，就重新变成“该巡检了”；已经做完的工序不再提醒 */
function ipqcDue(o, stage, fqcDone, reqs, q) {
  if (!stage || stage.state !== 'done' || o.releasedAt || fqcDone) return;
  const now = Date.now(), part = partOf(o.partId);
  const late = stage.refs.points.map((x) => {
    const h = freqHours(x.b.freq);
    if (!h || !x.last) return null;
    const op = opByKey(part, x.key);
    if (!op || !opRunning(o, op, q)) return null;
    const due = new Date(ipqcFrom(x, reqs)).getTime() + h * 3600e3;
    return due < now ? { x, due } : null;
  }).filter(Boolean).sort((a, b) => a.due - b.due);
  if (!late.length) return;
  const f = late[0];
  const dueIso = new Date(f.due).toISOString();
  Object.assign(stage, { state: 'active', since: dueIso, text: '工序 ' + f.x.key + ' 按频次（' + f.x.b.freq + '）该巡检了，已超时 ' + waitText(dueIso) + (late.length > 1 ? '（共 ' + late.length + ' 道工序到点）' : ''), owner: { roles: permRoles('task.create') }, act: { label: '去巡检', perm: 'task.create', point: f.x } });
}
/** 质量门禁：首件合格才能批量生产（巡检、完工），完工检验合格才能出货检验 */
const ML_GATES = { IPQC: ['FIRST'], FQC: ['FIRST'], OQC: ['FQC'] };
/** 开检前的门禁：巡检按工序看这道工序在用的机台首件是否都合格；完工、出货按整个节点看 */
function gateBlocker(ml, scene, opKey) {
  if (scene === 'IPQC' && opKey) {
    const fs = ml.stages.find((s) => s.key === 'FIRST');
    const reqs = fs && fs.refs.reqs ? fs.refs.reqs.filter((r) => r.key === opKey) : [];
    const bad = reqs.find((r) => r.state !== 'done');
    if (bad) return { key: 'FIRST', label: '首件检验', text: '工序 ' + opKey + (bad.machine ? ' · ' + bad.machine : '') + ' 的' + faiLabel(bad) + (bad.task ? (bad.state === 'blocked' ? '不合格' : '还在检验中') : '还没做') };
    return null;
  }
  return (ML_GATES[scene] || []).map((k) => ml.stages.find((s) => s.key === k)).find((s) => s && s.state !== 'done' && s.state !== 'na') || null;
}
/** 等待时长：从这一步可以开始处理算起 */
function waitText(iso) {
  if (!iso) return '';
  const h = (Date.now() - new Date(iso).getTime()) / 3600e3;
  if (h < 0) return '';
  if (h < 1) return Math.max(1, Math.round(h * 60)) + ' 分钟';
  if (h < 48) return Math.floor(h) + ' 小时';
  return Math.floor(h / 24) + ' 天';
}

/** 一张工单的主线：节点列表、当前节点（有问题的优先，否则第一个没完成的）、和“我”有关的节点 */
function mainlineOf(o) {
  shopMinute.value; // 保持打开的看板也要刷新交期、巡检和跨班首件。
  const part = partOf(o.partId);
  const pts = part.id ? orderPoints(o) : [];
  const scenes = [];
  pts.forEach((x) => { if (scenes.indexOf(x.b.scene) < 0) scenes.push(x.b.scene); });
  const qty = orderQty(o);
  const stages = [prepStage(o, part, pts)].concat(scenes.map((sc) => inspStage(o, part, sc, pts.filter((x) => x.b.scene === sc), qty)));
  const fqc = stages.find((s) => s.key === 'FQC');
  const first = stages.find((s) => s.key === 'FIRST');
  ipqcDue(o, stages.find((s) => s.key === 'IPQC'), !!fqc && fqc.state === 'done', first ? first.refs.reqs : null, qty);
  stages.push(releaseStage(o, stages.slice(), qty));
  /* 没有自己时间点的节点：从前面节点最后完成的时间算起（都没完成就从工单登记算起） */
  let upto = o.createdAt || '';
  stages.forEach((s) => {
    if (s.state !== 'done' && s.state !== 'na' && !s.since) s.since = upto;
    if (s.doneAt && s.doneAt > upto) upto = s.doneAt;
  });
  stages.forEach((s, i) => { s.no = i + 1; s.mine = s.state !== 'done' && s.state !== 'na' && !!s.act && isMineOwner(s.owner); });
  let cur = stages.findIndex((s) => s.state === 'blocked');
  if (cur < 0) cur = stages.findIndex((s) => s.state !== 'done' && s.state !== 'na');
  if (cur < 0) cur = stages.length - 1;
  /* 还没轮到的后续节点：没有开始过的显示为“未开始”，不当作当前要做的事 */
  stages.forEach((s, i) => { if (i > cur && s.state === 'todo') s.later = true; });
  const mineStages = stages.filter((s) => s.mine && !s.later);
  const doneCount = stages.filter((s) => s.state === 'done').length;
  const state = o.releasedAt ? 'released' : stages.some((s) => s.state === 'blocked') ? 'blocked' : 'active';
  const dueSoon = !o.releasedAt && !!o.due && new Date(o.due).getTime() - Date.now() < 2 * 86400e3;
  const holds = orderHolds(o);
  return { o, part, stages, cur, current: stages[cur], mine: mineStages, doneCount, state, dueSoon, holds, shipHolds: holds.filter((h) => h.actions.indexOf('ship') >= 0), ncrs: orderNcrs(o), qty };
}
const ORDER_ML_STATE = { released: ['已放行', 'chip-green'], blocked: ['有问题', 'chip-red'], active: ['进行中', 'chip-blue'] };

function dispatchStatus(m) {
  if (m.shipHolds.length) return ['禁止发运', 'chip-red'];
  if (m.state === 'released') return orderShipped(m.o) ? ['已发货', 'chip-gray'] : ['已放行，可以发货', 'chip-green'];
  if (m.holds.length) return ['质量受限', 'chip-red'];
  if (m.current.key === 'release' && m.current.state === 'active') return ['待放行', 'chip-amber'];
  return m.state === 'blocked' ? ['需要处理', 'chip-amber'] : ORDER_ML_STATE.active;
}
function dispatchOwner(m) {
  if (m.shipHolds.length && m.state === 'released') return ownerText({ roles: permRoles('hold.release') });
  if (m.state === 'released') return orderShipped(m.o) ? '已交付' : ROLES.wh.name;
  return ownerText(m.current.owner) || '待安排';
}

/** 门禁提示：前置检验没合格时开检要确认（例外留给人判断，例如试制、补录） */
async function gateConfirm(o, scene, x) {
  const b = gateBlocker(mainlineOf(o), scene, x && x.key);
  if (!b) return true;
  const rule = b.key === 'FIRST' ? '首件检验合格后才能批量生产' : '完工检验合格后才能做出货检验、发货';
  return confirmBox({ title: '「' + b.label + '」还没合格', message: b.label + '：' + b.text + '\n现场规则：' + rule + '。\n确实要先开' + (ML_SCENE[scene] || '检') + '吗？（例如试制、补录）', ok: '仍要开检', danger: true });
}

/** 节点上的按钮：跳转 / 在工序检验点上开检 / 放行 */
async function runStageAct(o, s) {
  const a = s && s.act;
  if (!a) return;
  if (a.perm && !can(a.perm)) { toast(denyTip(a.perm), 'warn'); return; }
  if (a.to) { go(a.to); return; }
  if (a.release) { UI.release = o.id; return; }
  if (s.scene) {
    const x = a.point || orderPoints(o).find((p) => p.b.scene === s.scene && !p.last) || null;
    if (!(await gateConfirm(o, s.scene, x))) return;
    if (x) startPoint(o, x, a.machine ? { machine: a.machine, trigger: a.trigger, setupId: a.setupId } : null);
    else if (s.scene === 'FQC' || s.scene === 'OQC') UI.orderLot = { orderId: o.id, scene: s.scene, op: '', workId: '' };
    else UI.newTask = { scene: s.scene, partId: o.partId, ctx: { wo: o.wo } };
  }
}
/** 演示用：不是当前身份的事，一键切换到能做这一步的人 */
function stageOwnerUser(s) {
  if (!s || !s.owner) return null;
  if (s.owner.uid) return S.users.find((u) => u.id === s.owner.uid) || null;
  return S.users.find((u) => (s.owner.roles || []).indexOf(u.role) >= 0) || null;
}

/* ---------------- 主线条：从左到右的节点 ---------------- */
// 回执只引用本工单的既有记录；刷新、回退、切换岗位都不会重放写操作。
function showReceipt(o, kind, record) {
  persistDemo();
  go('/orders/' + encodeURIComponent(o.id) + '?' + kind + '=' + encodeURIComponent(record.id));
}
COMPONENTS['order-receipt'] = {
  props: { order: Object },
  setup(p) {
    const work = computed(() => (p.order.work || []).find((w) => w.id === UI.route.query.work));
    const event = computed(() => (p.order.setups || []).find((e) => e.id === UI.route.query.setup));
    const record = computed(() => work.value || event.value);
    const ncr = computed(() => work.value && S.ncrs.find((n) => n.id === work.value.ncrId && n.workId === work.value.id));
    const req = computed(() => event.value && faiReqs(p.order).find((r) => r.ev && r.ev.id === event.value.id && !r.auto));
    const task = computed(() => event.value && S.tasks.find((t) => t.scene === 'FIRST' && t.ctx && t.ctx.wo === p.order.wo && t.ctx.setupId === event.value.id));
    const finalPoint = computed(() => work.value && !work.value.voided && orderPoints(p.order).find(pt => pt.b.scene === 'FQC' && pt.key === work.value.op));
    const workBatch = computed(() => finalPoint.value && orderLotFacts(p.order, 'FQC', finalPoint.value.key));
    const remaining = computed(() => workBatch.value?.sources.find(s => s.work.id === work.value?.id)?.remaining || 0);
    const existing = computed(() => workBatch.value?.tasks.find(t => t.ctx.workId === work.value?.id));
    const sendWork = async () => {
      if (!remaining.value || !can('task.create') || p.order.releasedAt) return;
      if (await gateConfirm(p.order, 'FQC', finalPoint.value)) startPoint(p.order, finalPoint.value, { workId: work.value.id });
    };
    const canStart = computed(() => !p.order.releasedAt && !!req.value && !req.value.task && !task.value && can('task.create') && plansFor(p.order.partId, 'FIRST').length > 0);
    const handoffCue = computed(() => work.value?.voided ? 'pending' : canStart.value ? 'action'
      : ncr.value?.holds.some((h) => h.status === 'active') || ['fail', 'insufficient'].includes(task.value?.status) ? 'blocked'
      : (ncr.value && ncr.value.status !== 'closed') || (req.value && task.value?.status !== 'pass' && !p.order.releasedAt) ? 'wait' : 'done');
    const start = () => {
      if (!canStart.value) return;
      const r = req.value, x = orderPoints(p.order).find((pt) => pt.b.scene === 'FIRST' && pt.key === r.key);
      if (x) startPoint(p.order, x, { machine: r.machine, trigger: r.trigger, setupId: r.ev.id });
    };
    const handoff = computed(() => {
      if (work.value) {
        if (work.value.voided) return '已撤销，不计入当前工序产量。';
        if (ncr.value) {
          if (ncr.value.status === 'closed') return '关联的不合格单已关闭。' + (handoffCue.value === 'blocked' ? '质量限制仍有效。' : '');
          const next = nextOf('ncr', ncr.value), owner = ownerText({ roles: permRoles(next.perm) });
          return (owner ? '接手：' + owner + '。' : '') + (next.text || '等待质量人员处理。');
        }
        return '已计入本工序产量。' + (p.order.releasedAt ? '该工单已放行。' : '工单仍按检验和放行条件流转。');
      }
      if (!event.value) return '';
      if (event.value.trigger === '下机') return '已结束本次上机，不再为这次登记开首件。';
      if (task.value) return '首件检验单已建立，当前状态：' + STATUS.task[task.value.status][0] + '。';
      if (p.order.releasedAt || !req.value || req.value.task) return '这次首件要求已结束或被更新，请以工单当前环节为准。';
      if (!plansFor(p.order.partId, 'FIRST').length) return '等待质量工程师准备生效的首件检验方案。';
      return '等待检验员在 ' + event.value.machine + ' 做首件检验。';
    });
    return { work, event, record, ncr, task, canStart, start, handoff, handoffCue, remaining, existing, sendWork };
  },
  template: `
<section v-if="record" class="dispatch-receipt" data-receipt aria-label="工序交接回执">
  <div class="receipt-head"><ic :name="work?.voided ? 'undo' : 'check-square'" :size="19"/><h2>{{ work ? (work.voided ? '这笔报工已撤销' : '报工已记录') : event.trigger + '已登记' }}</h2><a :href="'#/orders/' + order.id" title="收起交接回执" aria-label="收起交接回执"><ic name="x" :size="16"/></a></div>
  <p>{{ record.op }} · {{ record.machine || '未指定机台' }} · {{ fmtTime(record.at) }}</p>
  <strong v-if="work">合格 {{ work.good }} 件 · 不良 {{ work.bad }} 件</strong>
  <div class="receipt-next" :data-cue="handoffCue"><div class="receipt-next-state"><span class="work-symbol"><ic :name="handoffCue === 'wait' ? 'clock' : handoffCue === 'action' ? 'arrow-right' : handoffCue === 'pending' ? 'undo' : handoffCue === 'blocked' ? 'alert' : 'check'" :size="16"/></span><span>{{ handoff }}</span></div>
    <a v-if="ncr" :href="'#/ncr/' + ncr.id" class="desk-link" data-next-record>查看不合格单 <ic name="arrow-right" :size="14"/></a>
    <button v-if="remaining && !order.releasedAt && can('task.create')" type="button" class="btn-secondary" @click="sendWork">本笔报工送检 · {{ remaining }} 件</button>
    <a v-else-if="existing" class="desk-link" :href="'#/inspect/' + existing.id">查看完工检验单</a>
    <a v-else-if="task" :href="'#/inspect/' + task.id" class="desk-link">查看首件单 <ic name="arrow-right" :size="14"/></a>
    <button v-else-if="canStart" type="button" class="btn-primary" data-start-first @click="start">开首件 <ic name="arrow-right" :size="14"/></button>
  </div>
</section>`,
};

COMPONENTS['mainline-track'] = {
  props: { ml: Object, selected: String },
  emits: ['pick'],
  template: `
<nav class="work-route" aria-label="工单主线">
  <button v-for="(s,i) in ml.stages" :key="s.key" type="button" class="work-route-step" :data-stage="s.key" :data-cue="tone(s,i)" :aria-current="i === ml.cur && ml.state !== 'released' ? 'step' : null" :aria-pressed="selected === s.key" @click="$emit('pick',s)" :title="s.text">
    <span class="work-symbol"><ic v-if="tone(s,i) !== 'pending'" :name="icons[tone(s,i)]" :size="15" stroke="2.2"/><span v-else>{{ s.no }}</span></span>
    <span class="work-route-label">{{ s.label }}<small>{{ status(s,i) }}</small></span>
  </button>
</nav>`,
  setup(p) {
    const tone = (s,i) => s.state === 'blocked' ? 'blocked' : s.state === 'done' ? 'done'
      : i === p.ml.cur ? (s.mine ? 'action' : 'wait') : s.state === 'active' ? 'wait' : 'pending';
    const status = (s,i) => s.state === 'na' ? '不适用' : s.state === 'done' ? '已完成' : s.state === 'blocked' ? '受阻'
      : i === p.ml.cur ? (s.mine ? '当前 · 待你处理' : '当前 · 等待处理') : s.state === 'active' ? '进行中' : '未开始';
    return { tone, status, icons: { done: 'check', blocked: 'lock', action: 'arrow-right', wait: 'clock' } };
  },
};

/* ---------------- 所属工单（检验、报告、不合格页面顶部）：一行说明这件事属于哪张工单、在第几步 ---------------- */
COMPONENTS['order-trail'] = {
  props: { order: Object, stage: String },
  setup(p) {
    const ml = computed(() => (p.order ? mainlineOf(p.order) : null));
    const here = computed(() => (ml.value ? ml.value.stages.find((s) => s.key === p.stage) || null : null));
    return { ml, here };
  },
  template: `
<div v-if="ml" class="dispatch-trail" data-test="order-trail">
  <a :href="'#/orders/' + order.id + (here ? '?stage=' + here.key : '')"><ic name="chevron-left" :size="15"/>返回工单 <b>{{ order.wo }}</b></a>
  <span v-if="here">本单环节：{{ here.label }}</span><span v-else>{{ ml.part.name }}</span>
</div>`,
};

/* ---------------- 登记生产工单（全局弹窗，由 UI.newOrder 打开） ---------------- */
COMPONENTS['new-order-modal'] = {
  setup() {
    const f = reactive({ wo: '', partId: '', qty: '', due: '', lots: '' }), err = ref('');
    const open = computed(() => !!UI.newOrder);
    watch(open, (v) => {
      if (!v) return;
      const prefix = 'WO-' + dateCode().slice(2, 6) + '-', used = new Set(S.orders.map((o) => o.wo));
      let serial = 100;
      while (used.has(prefix + serial)) serial++;
      Object.assign(f, { wo: prefix + serial, partId: '', qty: '', due: '', lots: '' }); err.value = '';
    });
    const close = () => { UI.newOrder = false; };
    const save = () => {
      if (!open.value || !can('order.create')) return;
      const wo = f.wo.trim();
      if (!wo) { err.value = '请填写工单号。'; return; }
      if (S.orders.some((o) => o.wo.toLowerCase() === wo.toLowerCase())) { err.value = '该工单号已存在，请核对。'; return; }
      if (!S.parts.some((p) => p.id === f.partId)) { err.value = '请选择本次生产的零件。'; return; }
      if (!/^[1-9]\d*$/.test(String(f.qty).trim()) || !Number.isSafeInteger(Number(f.qty))) { err.value = '计划数量须为正整数。'; return; }
      const o = { id: 'o' + nextSeq(), wo, partId: f.partId, qty: parseInt(f.qty, 10), due: f.due ? new Date(f.due + 'T18:00:00').toISOString() : '', inLots: f.lots.split(/[\s,，;；]+/).map((x) => x.trim()).filter(Boolean), outLot: '', createdAt: nowISO(), createdBy: S.me };
      S.orders.unshift(o);
      logAudit('生产工单', wo, '登记生产工单：' + partOf(f.partId).name + ' × ' + o.qty + (o.inLots.length ? '，投入物料批次 ' + o.inLots.join('、') : ''));
      close();
      toast('工单 ' + wo + ' 已登记，主线从“技术准备”开始', 'success');
      go('/orders/' + o.id);
    };
    const ops = computed(() => f.partId ? opsOf(partOf(f.partId)) : []);
    return { f, open, close, save, err, ops };
  },
  template: `
<modal :open="open" @close="close" title="登记生产工单" width="max-w-md">
  <div class="space-y-4" @input="err = ''">
    <div><label for="new-order-wo" class="label">工单号</label><input id="new-order-wo" v-model="f.wo" class="input font-mono"></div>
    <div><label for="new-order-part" class="label">生产零件</label><select id="new-order-part" v-model="f.partId" class="input" required><option disabled value="">请选择零件</option><option v-for="p in S.parts" :key="p.id" :value="p.id">{{ p.partNo }} {{ p.name }}</option></select>
      <p v-if="f.partId" class="text-xs text-ink-3 mt-2">{{ ops.length ? ops.length + ' 道工序 · 首道：' + ops[0].name : '尚未设置路线，建单后由质量工程师补齐。' }}</p></div>
    <div class="grid grid-cols-2 gap-3"><div><label for="new-order-qty" class="label">计划数量（件）</label><input id="new-order-qty" v-model.trim="f.qty" class="input" inputmode="numeric" required></div><div><label for="new-order-due" class="label">交期（选填）</label><input id="new-order-due" v-model="f.due" type="date" class="input"></div></div>
    <details><summary class="cursor-pointer text-ink-2 py-2">关联物料批次（选填）</summary><label for="new-order-lots" class="label">投入批次，多个用逗号分开</label><input id="new-order-lots" v-model="f.lots" class="input font-mono"></details>
    <p v-if="err" class="form-error" data-order-error role="alert">{{ err }}</p>
  </div>
  <template #footer><button class="btn-secondary" @click="close">取消</button><g-btn data-create-order perm="order.create" cls="btn-primary" icon="check" @click="save">建立工单</g-btn></template>
</modal>`,
};

COMPONENTS['release-checklist'] = {
  props: { checks: { type: Array, default: () => [] }, navigate: Boolean },
  emits: ['locate'],
  setup(p) {
    const rank = (c) => !c.ok ? (c.key === 'holds' ? 0 : c.key === 'ncr' ? 1 : 2) : c.warn ? 3 : 4;
    const rows = computed(() => p.checks.slice().sort((a,b) => rank(a) - rank(b)));
    const blocked = computed(() => p.checks.filter((c) => !c.ok).length);
    const warnings = computed(() => p.checks.filter((c) => c.warn).length);
    return { rows, blocked, warnings };
  },
  template: `
<div class="release-ledger">
  <div class="release-count" :data-cue="blocked ? 'blocked' : warnings ? 'wait' : 'done'"><span class="work-symbol"><ic :name="blocked ? 'lock' : warnings ? 'info' : 'check'" :size="15" stroke="2.4"/></span><b>{{ blocked ? '还有 ' + blocked + ' 项未通过' : warnings ? '基本检查已通过 · 有让步事项' : '放行检查项均已通过' }}</b><span>{{ checks.length - blocked - warnings }} / {{ checks.length - warnings }}</span></div>
  <ul aria-label="放行检查项">
    <li v-for="c in rows" :key="c.key" :data-release-check="c.key" :data-cue="!c.ok ? 'blocked' : c.warn ? 'wait' : 'done'">
      <ic :name="!c.ok ? 'alert' : c.warn ? 'info' : 'check'" :size="16" stroke="2.2"/><span>{{ c.text }}</span>
      <a v-if="navigate && !c.ok && c.to" :href="'#' + c.to" class="desk-link">{{ c.link }}<ic name="arrow-right" :size="13"/></a>
      <button v-else-if="navigate && !c.ok && (c.stage || c.key === 'qty')" type="button" class="desk-link" @click="$emit('locate',c)">{{ c.stage ? '定位环节' : '查看数量' }}<ic name="target" :size="14"/></button>
    </li>
  </ul>
</div>`,
};

/* ---------------- 质量放行（全局弹窗，由 UI.release = 工单 id 打开） ---------------- */
COMPONENTS['release-modal'] = {
  setup() {
    const note = ref('');
    const o = computed(() => (UI.release ? S.orders.find((x) => x.id === UI.release) || null : null));
    const ml = computed(() => (o.value ? mainlineOf(o.value) : null));
    const rel = computed(() => (ml.value ? ml.value.stages[ml.value.stages.length - 1] : null));
    const ok = computed(() => !!rel.value && rel.value.checks.every((c) => c.ok));
    /* 让步接收的批准依据：每一行处置一份（批准方、批准文件编号、批准人），文件编号先从处置理由里找 */
    const cons = computed(() => (o.value ? orderConcessions(o.value) : []));
    const basis = reactive({});
    const init = () => {
      note.value = '';
      Object.keys(basis).forEach((k) => { delete basis[k]; });
      cons.value.forEach((c) => { basis[c.d.id] = { kind: CONCESSION_BASIS[0], docNo: guessDocNo(c.d), approver: '' }; });
    };
    watch(() => UI.release, init, { immediate: true });
    const basisOk = computed(() => cons.value.every((c) => { const b = basis[c.d.id]; return !!b && !!b.kind && !!String(b.docNo || '').trim() && !!String(b.approver || '').trim(); }));
    const close = () => { UI.release = null; };
    const openNcr = (n) => { close(); go('/ncr/' + n.id); };
    const doRelease = () => {
      try {
        const x = releaseOrder(o.value, { note: note.value, basis });
        close();
        toast('工单 ' + x.wo + (x.releaseKind === 'concession' ? ' 已让步放行（批准依据已记录）' : ' 已质量放行') + '，可以入库发货', 'success');
      } catch (e) { toast(e.message, 'error'); }
    };
    return { note, o, ml, rel, ok, cons, basis, basisOk, close, openNcr, doRelease, CONCESSION_BASIS };
  },
  template: `
<modal :open="!!o" @close="close" :title="o ? (cons.length ? '让步放行 ' : '质量放行 ') + o.wo : ''" sub="放行是质量负责人的判断：确认检验都合格、不合格已处置关闭、没有有效的质量限制、数量对得上" width="max-w-xl">
  <div v-if="rel" class="space-y-2">
    <release-checklist :checks="rel.checks"/>
    <div v-if="cons.length" class="mt-4 rounded-2xl bg-amber-50/70 ring-1 ring-inset ring-amber-500/20 p-4 space-y-3">
      <div><div class="text-[13px] font-semibold text-amber-900">让步放行依据（每一项都要填）</div><p class="text-[11.5px] text-amber-800/80 mt-0.5">让步接收的件随这批货一起放行。写明是谁批准的、凭哪份文件，记进放行记录和工单质量档案。</p></div>
      <div v-for="c in cons" :key="c.d.id" class="rounded-xl bg-white ring-1 ring-black/[0.06] p-3 space-y-2">
        <div class="text-[12.5px] leading-relaxed"><button type="button" class="link font-mono" @click="openNcr(c.n)">{{ c.n.code }}</button> · 让步接收 <b>{{ c.d.qty }}</b> 件 · <span class="text-ink-3">{{ c.d.reason }}</span></div>
        <div v-if="basis[c.d.id]" class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div><label class="label">批准方</label><select v-model="basis[c.d.id].kind" class="input"><option v-for="k in CONCESSION_BASIS" :key="k" :value="k">{{ k }}</option></select></div>
          <div><label class="label" :for="'basis-doc-' + c.d.id">批准文件编号</label><input :id="'basis-doc-' + c.d.id" v-model="basis[c.d.id].docNo" :data-next-field="!basis[c.d.id].docNo.trim()" required class="input font-mono" placeholder="如 CC-2611-05"></div>
          <div><label class="label" :for="'basis-by-' + c.d.id">批准人</label><input :id="'basis-by-' + c.d.id" v-model="basis[c.d.id].approver" :data-next-field="!basis[c.d.id].approver.trim()" required class="input" placeholder="客户或技术负责人"></div>
        </div>
      </div>
    </div>
    <div class="pt-3"><label class="label">放行说明（可选）</label><textarea v-model="note" rows="2" class="textarea" placeholder="例如：首件、巡检、完工、出货检验均合格，报告齐全"></textarea></div>
  </div>
  <template #footer><button class="btn-secondary" @click="close">取消</button><g-btn perm="order.release" cls="btn-primary" icon="shield" :when="ok && basisOk" :why="ok ? '让步依据没有填完整' : '还有检查项没通过'" @click="doRelease">{{ cons.length ? '确认让步放行' : '确认放行' }}</g-btn></template>
</modal>`,
};

/* ---------------- 工单详情（参照黑湖小工单：工单 → 工序 → 报工 / 检验，一页看完） ----------------
 * 从上到下：这是哪张工单 → 现在该做什么（只有一个主按钮）→ 主线走到哪 → 每道工序一行（报工、这道工序上的检验）
 * → 不合格（有才显示）→ 放行检查（走到放行时显示）→ 记录（收起）。流转卡、物料批次、报工记录、登记换型换刀放在“更多”里。 */
const CHECK_CLS = {
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 hover:bg-emerald-100',
  todo: 'bg-white text-ink-2 ring-black/15 hover:ring-brand-500 hover:text-brand-700',
  active: 'bg-sky-50 text-sky-700 ring-sky-600/25 hover:bg-sky-100',
  blocked: 'bg-rose-50 text-rose-700 ring-rose-600/30 hover:bg-rose-100',
};
const CHECK_TEXT = { done: '合格', todo: '待检', active: '检验中', blocked: '不合格' };
const SCENE_SHORT = { IQC: '来料检验', FIRST: '首件', IPQC: '巡检', FQC: '完工检验', OQC: '出货检验' };
COMPONENTS['page-order'] = {
  setup() {
    const o = computed(() => S.orders.find((x) => x.id === UI.route.params.id || x.wo === UI.route.params.id) || null);
    const ml = computed(() => (o.value ? mainlineOf(o.value) : null));
    const sel = ref(UI.route.query.stage || '');
    const focus = computed(() => (ml.value ? (ml.value.state !== 'active' ? ml.value.current : ml.value.mine[0] || ml.value.current) : null));
    const picked = computed(() => (ml.value && sel.value && (!focus.value || sel.value !== focus.value.key) ? ml.value.stages.find((s) => s.key === sel.value) || null : null));
    const pick = (s) => { sel.value = sel.value === s.key ? '' : s.key; };
    const ownerUser = (s) => (s && !s.mine && s.act && s.state !== 'done' ? stageOwnerUser(s) : null);
    const act = (s) => runStageAct(o.value, s);
    const swap = (s) => { const u = ownerUser(s); if (u) switchUser(u.id); };
    const orderTrack = ref(null), orderOps = ref(null), releasePanel = ref(null);
    const tone = computed(() => !ml.value ? 'pending' : ml.value.shipHolds.length || focus.value.state === 'blocked' ? 'blocked'
      : ml.value.state === 'released' ? 'done' : focus.value.mine ? 'action' : 'wait');
    const stOf = (t) => (!t ? 'todo' : t.status === 'pass' ? 'done' : t.status === 'fail' || t.status === 'insufficient' ? 'blocked' : 'active');
    /* 每道工序一行：报工数量、合格率，这道工序上的检验（首件按机台一条） */
    const opRows = computed(() => {
      if (!ml.value) return [];
      const pts = orderPoints(o.value), fs = ml.value.stages.find((s) => s.key === 'FIRST'), reqs = fs && fs.refs.reqs ? fs.refs.reqs : [];
      return ml.value.qty.rows.map((r) => {
        const checks = [];
        pts.filter((x) => x.key === r.key).forEach((x) => {
          if (x.b.scene === 'FIRST') reqs.filter((q) => q.key === r.key).forEach((q) => checks.push({ id: 'F|' + q.machine, text: faiLabel(q) + ' · ' + (q.machine || '默认机台') + ' ' + CHECK_TEXT[q.state], state: q.state, task: q.task, req: q, x }));
          else {
            const isLot = x.b.scene === 'FQC' || x.b.scene === 'OQC';
            const batch = isLot && x.last ? orderLotFacts(o.value, x.b.scene, x.key, ml.value.qty) : null;
            checks.push({ id: x.b.scene, text: (x.b.note || SCENE_SHORT[x.b.scene] || sceneOf(x.b.scene).name) + ' ' + CHECK_TEXT[stOf(x.last)] + (x.tasks.length > 1 ? '（' + x.tasks.length + ' 次）' : ''), state: stOf(x.last), task: x.last, x, batch });
          }
        });
        const reportable = r.processed > 0 || !!machineOf(r.op.wc) || r.op.insp.some((b) => b.scene === 'FIRST' || b.scene === 'IPQC' || b.scene === 'FQC');
        return Object.assign({}, r, { checks, reportable, machine: runningMachine(o.value, r.key) || r.machines[0] || r.op.wc || '' });
      });
    });
    /* 点检验：开过的直接打开；没开过的开检（首件带上机台和原因；巡检、完工、出货先过门禁） */
    const openCheck = async (c, nextLot = false) => {
      if (c.task && !nextLot) { go('/inspect/' + c.task.id); return; }
      if (!can('task.create')) { toast(denyTip('task.create'), 'warn'); return; }
      if (!plansFor(o.value.partId, c.x.b.scene).length) { toast('还没有生效的' + (ML_SCENE[c.x.b.scene] || '') + '方案，请先编制方案', 'warn'); return; }
      if (c.req) { startPoint(o.value, c.x, { machine: c.req.machine, trigger: c.req.trigger, setupId: c.req.ev ? c.req.ev.id : '' }); return; }
      if (!(await gateConfirm(o.value, c.x.b.scene, c.x))) return;
      startPoint(o.value, c.x);
    };
    const rel = computed(() => (ml.value ? ml.value.stages[ml.value.stages.length - 1] : null));
    const showRelease = computed(() => !!ml.value && (sel.value === 'release' || ml.value.current.key === 'release' || !!o.value.releasedAt));
    const showChecks = () => { sel.value = 'release'; nextTick(() => revealWorkTarget(releasePanel.value)); };
    const cueCheck = computed(() => {
      const s = picked.value || focus.value;
      if (!s || !s.scene || ml.value.state === 'released') return null;
      const a = s.act || {}, [kind, id] = String(a.to || '').split('?')[0].split('/').slice(1);
      const ncr = kind === 'ncr' && S.ncrs.find((n) => n.id === id);
      const task = kind === 'inspect' ? taskOf(id) : kind === 'reports' ? taskOf(S.reports.find((r) => r.id === id)?.taskId) : ncr ? taskOf(ncr.taskId) : null;
      const op = a.point?.key || task?.ctx?.op || ncr?.op, machine = a.machine || task?.ctx?.machine;
      const stageCue = s.state === 'blocked' ? 'blocked' : s.state === 'done' ? 'done' : s.later ? 'pending' : s.mine ? 'action' : 'wait';
      const rows = opRows.value.filter((r) => !op || r.key === op);
      const candidates = rows.flatMap((r) => r.checks.filter((c) => c.x.b.scene === s.scene).map((c) => ({ op: r.key, check: c, tone: stageCue })));
      return candidates.find(({check: c}) => task && c.task?.id === task.id)
        || (s.scene === 'FIRST' && machine ? candidates.find(({check: c}) => c.req?.machine === machine) : candidates[0]) || null;
    });
    const locateOperation = () => {
      const c = cueCheck.value;
      if (!c || !orderOps.value) return;
      const row = Array.from(orderOps.value.querySelectorAll('[data-op]')).find((el) => el.dataset.op === c.op);
      revealWorkTarget(Array.from(row?.querySelectorAll('button[data-check-key]') || []).find((el) => el.dataset.checkKey === c.check.id));
    };
    const locateCheck = (c) => {
      if (!c.stage) { revealWorkTarget(orderOps.value); return; }
      sel.value = c.stage;
      nextTick(() => revealWorkTarget(Array.from(orderTrack.value?.querySelectorAll('[data-stage]') || []).find((el) => el.dataset.stage === c.stage)));
    };
    const ncrs = computed(() => (ml.value ? ml.value.ncrs.slice().sort((a, b) => (a.status === 'closed') - (b.status === 'closed')) : []));
    const audit = computed(() => {
      if (!ml.value) return [];
      const keys = new Set([o.value.wo]);
      ml.value.stages.forEach((s) => { (s.refs.tasks || []).forEach((t) => keys.add(t.code)); (s.refs.ncrs || []).forEach((n) => keys.add(n.code)); (s.refs.reports || []).forEach((r) => keys.add(r.code)); });
      return S.audit.filter((a) => keys.has(a.obj) || Array.from(keys).some((k) => String(a.obj).indexOf(k) === 0)).slice(0, 20);
    });
    const lotEdit = reactive({ open: false, inLots: '', outLot: '' });
    const openLots = () => { Object.assign(lotEdit, { open: true, inLots: (o.value.inLots || []).join(', '), outLot: o.value.outLot || '' }); };
    const saveLots = () => {
      o.value.inLots = lotEdit.inLots.split(/[\s,，;；]+/).map((x) => x.trim()).filter(Boolean);
      o.value.outLot = lotEdit.outLot.trim();
      logAudit('生产工单', o.value.wo, '更新批次：投入 ' + (o.value.inLots.join('、') || '无') + '；产出 ' + (o.value.outLot || '无'));
      lotEdit.open = false; toast('批次已更新', 'success');
    };
    /* 报工记录（新的在前）和撤销 */
    const worksOpen = ref(false);
    const works = computed(() => (o.value && Array.isArray(o.value.work) ? o.value.work.slice().reverse() : []));
    const lastHandoffs = computed(() => !o.value ? [] : (o.value.work || []).map((w) => ({ id:w.id, at:w.at, kind:'work', text:w.op + ' · ' + (w.voided ? '报工已撤销' : '合格 ' + w.good + ' 件 / 不良 ' + w.bad + ' 件') })).concat((o.value.setups || []).map((e) => ({ id:e.id, at:e.at, kind:'setup', text:e.op + ' · ' + e.machine + ' ' + e.trigger }))).sort((a,b) => b.at.localeCompare(a.at)).slice(0,5));
    const vw = reactive({ open: false, id: '', why: '' });
    const openVoid = (w) => { Object.assign(vw, { open: true, id: w.id, why: '' }); };
    const saveVoid = () => {
      try { voidWork(o.value, vw.id, vw.why); vw.open = false; toast('报工已撤销，可以重新报', 'success'); }
      catch (e) { toast(e.message, 'error'); }
    };
    /* “更多”菜单 */
    const more = ref(null);
    const menuDo = (k) => {
      if (more.value) more.value.open = false;
      if (k === 'card') go('/orders/' + o.value.id + '/card');
      else if (k === 'lots') openLots();
      else if (k === 'works') worksOpen.value = true;
      else if (k === 'setup') UI.setup = { orderId: o.value.id };
    };
    const overdue = computed(() => !!o.value && !!o.value.due && !o.value.releasedAt && new Date(o.value.due) < new Date());
    return { o, ml, sel, focus, picked, pick, ownerUser, act, swap, opRows, openCheck, rel, showRelease, ncrs, audit, lotEdit, openLots, saveLots, worksOpen, works, lastHandoffs, vw, openVoid, saveVoid, more, menuDo, overdue, CHECK_CLS, dispatchStatus, firstOpsOf, ownerText, pctText, yieldTone, qtyGapText, balanceText, waitText, orderTrack, orderOps, releasePanel, tone, cueCheck, showChecks, locateOperation, locateCheck };
  },
  template: `
<div v-if="o && ml" class="dispatch-page order-sheet">
  <div>
    <button class="text-xs text-ink-3 hover:text-ink inline-flex items-center gap-1 mb-2" @click="go('/orders')"><ic name="chevron-left" :size="13"/>工单</button>
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="page-title font-mono">{{ o.wo }}</h1>
      <span :class="dispatchStatus(ml)[1]">{{ dispatchStatus(ml)[0] }}</span>
      <span v-if="ml.dueSoon" class="chip-amber">{{ overdue ? '已逾期' : '交期临近' }}</span>
      <span v-if="o.releasedAt && o.releaseKind === 'concession'" class="chip-amber">让步放行</span>
      <details ref="more" class="relative ml-auto">
        <summary class="btn-ghost btn-sm list-none cursor-pointer select-none">更多<ic name="chevron-down" :size="13"/></summary>
        <div class="absolute right-0 mt-1 w-48 card shadow-pop z-30 p-1.5 text-[13px]">
          <button type="button" class="w-full text-left px-3 py-2 rounded-lg hover:bg-black/[0.04]" @click="menuDo('card')">打印流转卡</button>
          <button type="button" class="w-full text-left px-3 py-2 rounded-lg hover:bg-black/[0.04]" @click="menuDo('lots')">物料批次</button>
          <button v-if="works.length" type="button" class="w-full text-left px-3 py-2 rounded-lg hover:bg-black/[0.04]" @click="menuDo('works')">报工记录（{{ works.length }}）</button>
        </div>
      </details>
    </div>
    <p class="text-[13px] text-ink-3 mt-1">{{ ml.part.name }} · {{ ml.part.partNo }} · 图号 {{ ml.part.drawingNo }} · 计划 {{ o.qty }} 件<template v-if="o.due"> · 交期 {{ fmtDate(o.due) }}</template></p>
  </div>

  <section v-if="ml.holds.length" class="order-holds" aria-label="当前质量限制">
    <div class="order-holds-head"><strong><ic name="lock" :size="16"/>当前质量限制</strong><span>解除由质量负责人处理</span></div>
    <div v-for="h in ml.holds" :key="h.ncr.id + ':' + h.id" class="order-hold-line">
      <div class="order-hold-actions"><b v-for="a in h.actions" :key="a">禁止{{ HOLD_ACTIONS[a] }}</b></div>
      <span>{{ h.scopeType }} <strong class="font-mono">{{ h.scopeVal }}</strong></span>
      <a :href="'#/ncr/' + h.ncr.id + '?show=holds&hold=' + h.id" :aria-label="'查看' + h.scopeType + ' ' + h.scopeVal + '的限制依据'">{{ h.ncr.code }}<ic name="chevron-right" :size="14"/></a>
    </div>
  </section>
  <order-receipt :order="o"/>
  <div class="work-banner" :data-cue="tone" data-panel="next">
    <span class="work-symbol"><ic :name="tone === 'blocked' ? 'lock' : tone === 'done' ? 'check' : tone === 'wait' ? 'clock' : focus.icon || 'arrow-right'" :size="22" stroke="2.3"/></span>
    <div class="work-banner-body" aria-live="polite">
      <span class="work-banner-kicker">{{ tone === 'done' ? dispatchStatus(ml)[0] : tone === 'blocked' ? '待处理异常' : tone === 'action' ? '轮到你' : '等待处理' }}</span>
      <strong>{{ ml.state === 'released' ? rel.text : focus.label + '：' + focus.text }}</strong>
      <span v-if="ml.state === 'released' && ml.shipHolds.length" class="work-banner-meta">{{ ml.shipHolds.map(h => h.scopeType + ' ' + h.scopeVal).join('、') }} 暂不能发货</span>
      <span v-else-if="ml.state !== 'released'" class="work-banner-meta">{{ ownerText(focus.owner) }}<template v-if="waitText(focus.since)"> · 已等 {{ waitText(focus.since) }}</template></span>
    </div>
    <div class="work-banner-actions">
      <button v-if="ml.state !== 'released' && focus.mine && focus.act" type="button" class="btn-primary" data-test="stage-act" @click="act(focus)">{{ focus.act.label }}<ic name="arrow-right" :size="16"/></button>
      <button v-else-if="ml.state !== 'released' && ownerUser(focus)" type="button" class="btn-secondary" title="演示用：切换身份后继续这一步" @click="swap(focus)"><avatar :uid="ownerUser(focus).id" :size="18"/>切换为{{ ownerUser(focus).name }}继续</button>
      <a v-else-if="ml.shipHolds.length" class="desk-link" :href="'#/ncr/' + ml.shipHolds[0].ncr.id + '?show=holds'">查看质量限制<ic name="arrow-right" :size="14"/></a>
      <button v-if="!o.releasedAt" type="button" class="desk-link" @click="showChecks"><ic name="clipboard-check" :size="16"/>放行条件</button>
    </div>
  </div>

  <div ref="orderTrack" class="order-track">
    <div class="station-heading"><h2>工单进度</h2><span>已完成 {{ ml.doneCount }} / {{ ml.stages.length }} 个环节</span></div>
    <mainline-track :ml="ml" :selected="sel || focus.key" @pick="pick"/>
    <div v-if="picked" class="mt-2 rounded-xl bg-[#f7f7f9] px-3.5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
      <span><b class="font-medium">第 {{ picked.no }} 步 {{ picked.label }}</b><span class="text-ink-3"> · {{ picked.later ? '还没轮到' : picked.text }}</span><span v-if="picked.state !== 'done' && picked.owner" class="text-ink-4"> · 负责：{{ ownerText(picked.owner) }}</span></span>
      <span class="flex-1"></span>
      <button v-if="picked.mine && picked.act && !picked.later" type="button" class="btn-primary btn-sm" @click="act(picked)">{{ picked.act.label }}</button>
      <button v-else-if="picked.act && picked.act.to" type="button" class="btn-secondary btn-sm" @click="go(picked.act.to)">查看</button>
    </div>
    <div v-if="cueCheck" class="work-target-line"><ic name="target" :size="16"/><span>{{ cueCheck.op }}</span><button type="button" data-order-locate class="desk-link" @click="locateOperation">定位工序<ic name="arrow-right" class="rotate-90" :size="15"/></button></div>
  </div>

  <div ref="orderOps" class="station-ops" data-panel="ops" tabindex="-1">
    <div class="px-5 pt-4 pb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="section-title">工序作业</h2><button v-if="!o.releasedAt && can('order.setup') && firstOpsOf(ml.part).length" type="button" class="btn-secondary btn-sm" data-order-setup @click="menuDo('setup')"><ic name="wrench" :size="14"/>登记换型 / 换刀</button>
      <span class="text-[12.5px] text-ink-3">投产 <b class="text-ink tabular">{{ ml.qty.input || '—' }}</b> · 入库合格 <b class="text-ink tabular">{{ ml.qty.stocked }}</b><template v-if="ml.qty.defects"> · 不良 <b class="text-rose-600 tabular">{{ ml.qty.defects }}</b></template> · 直通率 <b class="tabular" :class="yieldTone(ml.qty.rty)">{{ pctText(ml.qty.rty) }}</b></span>
    </div>
    <div v-for="r in opRows" :key="r.key" class="px-5 py-3 border-t border-black/[0.05] flex flex-wrap items-center gap-x-4 gap-y-2" :data-op="r.key" :data-flow-focus="cueCheck?.op === r.key ? cueCheck.tone : null">
      <div class="w-[140px] shrink-0"><div class="font-medium text-[13.5px]">{{ r.key }}</div><div class="text-[11.5px] text-ink-4 truncate">{{ r.machine || '—' }}</div></div>
      <div class="w-[150px] shrink-0 text-[12.5px] tabular">
        <template v-if="r.processed">已报 {{ r.processed }}<template v-if="ml.qty.input"> / {{ r.arriving }}</template><span v-if="r.bad" class="text-rose-600"> · 不良 {{ r.bad }}</span><div class="text-[11.5px]" :class="yieldTone(r.fpy)">合格率 {{ pctText(r.fpy) }}</div></template>
        <span v-else class="text-ink-5">{{ r.reportable ? '还没报工' : '—' }}</span>
      </div>
      <div class="flex-1 flex flex-wrap gap-1.5 min-w-[160px]">
        <template v-for="c in r.checks" :key="c.id">
        <button type="button" class="order-check min-h-8 px-2.5 rounded-lg text-[12px] font-medium ring-1 ring-inset transition-colors" :class="CHECK_CLS[c.state]" :data-check="c.x.b.scene" :data-check-key="c.id" :data-next-field="cueCheck?.check === c" :title="c.task ? '打开 ' + c.task.code : '开检'" @click="openCheck(c)"><ic :name="c.state === 'done' ? 'check' : c.state === 'blocked' ? 'alert' : c.state === 'active' ? 'clock' : 'clipboard'" :size="14"/>{{ c.text }}<ic name="chevron-right" :size="12"/></button>
          <button v-if="c.batch?.remaining && !o.releasedAt && can('task.create')" class="btn-soft btn-sm" type="button" :data-next-lot="c.id" @click="openCheck(c,true)"><ic name="plus" :size="14"/>下一批交检 · 余 {{ c.batch.remaining }} 件</button>
          <details v-if="c.batch && c.batch.tasks.length > 1" class="batch-history"><summary>查看 {{ c.batch.tasks.length }} 批交检</summary><a v-for="t in c.batch.tasks" :key="t.id" :href="'#/inspect/' + t.id">{{ t.code }} · {{ t.lot }} 件 <st k="task" :v="t.status"/></a></details>
        </template>
      </div>
      <button v-if="!o.releasedAt && r.reportable && can('order.work')" type="button" class="btn-secondary btn-sm" data-work @click="UI.work = { orderId: o.id, op: r.key }"><ic name="edit" :size="14"/>报工</button>
    </div>
    <p class="px-5 py-2.5 border-t border-black/[0.05] text-[12px]" :class="ml.qty.balanced ? 'text-emerald-700' : 'text-ink-3'">{{ ml.qty.balanced ? '数量对得上，' + balanceText(ml.qty) : qtyGapText(ml.qty) }}</p>
  </div>

  <div v-if="ncrs.length" class="card overflow-hidden">
    <div class="px-5 pt-4 pb-2"><h2 class="section-title">不合格</h2></div>
    <button v-for="n in ncrs" :key="n.id" type="button" class="w-full text-left px-5 py-2.5 border-t border-black/[0.05] flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-black/[0.015]" @click="go('/ncr/' + n.id)">
      <span class="font-mono text-[12.5px]">{{ n.code }}</span><st k="ncr" :v="n.status"/><span class="text-[13px] truncate flex-1 min-w-[160px]">{{ n.title }}</span><span v-if="n.status !== 'closed'" class="text-[12px] text-ink-4">下一步：{{ nextOf('ncr', n).text }}</span>
    </button>
  </div>

  <div v-if="showRelease" ref="releasePanel" class="release-panel" data-panel="release" tabindex="-1">
    <h2 class="section-title">放行检查</h2>
    <release-checklist :checks="rel.checks" navigate @locate="locateCheck"/>
    <p v-if="o.releaseNote" class="text-[12.5px] text-ink-3 pt-2">放行说明：{{ o.releaseNote }}</p>
    <div v-if="(o.releaseBasis || []).length" class="pt-2"><div class="label">让步放行依据</div><div v-for="b in o.releaseBasis" :key="b.lineId" class="text-[12.5px] py-0.5"><span class="font-mono">{{ b.ncrCode }}</span> 让步接收 {{ b.qty }} 件 · {{ b.kind }} <span class="font-mono">{{ b.docNo }}</span> · 批准人 {{ b.approver }}</div></div>
  </div>

  <details class="card px-5 py-3">
    <summary class="cursor-pointer list-none select-none text-[13px] font-medium text-ink-2 flex flex-wrap items-center gap-1.5"><ic name="history" :size="14"/>记录（{{ audit.length }}）<span class="text-ink-4 font-normal">· 投入批次 {{ (o.inLots || []).join('、') || '未登记' }} · 成品批次 {{ o.outLot || '未登记' }}</span></summary>
    <div class="mt-2">
      <div v-if="lastHandoffs.length" class="recent-handoffs"><b>近期工序交接</b><a v-for="r in lastHandoffs" :key="r.kind + r.id" :href="'#/orders/' + o.id + '?' + r.kind + '=' + r.id"><span>{{ r.text }}</span><small>{{ fmtTime(r.at) }}</small><ic name="chevron-right" :size="14"/></a></div>
      <div v-for="(a,i) in audit" :key="i" class="py-1.5 border-b border-black/[0.04] last:border-0"><div class="text-[12.5px] text-ink-2 leading-relaxed">{{ a.text }}</div><div class="text-[11px] text-ink-4">{{ userName(a.uid) }} · {{ fmtTime(a.at) }} · {{ a.obj }}</div></div>
      <div v-if="!audit.length" class="text-[12px] text-ink-4">暂无记录</div>
    </div>
  </details>

  <modal :open="worksOpen" @close="worksOpen = false" title="报工记录" sub="报错了（数量、工序、机台）可以撤销后重新报，撤销留有记录" width="max-w-xl">
    <div class="space-y-1.5">
      <div v-for="w in works" :key="w.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        <span class="text-ink-4 tabular w-[120px]">{{ fmtTime(w.at) }}</span>
        <span :class="w.voided ? 'line-through text-ink-4' : ''"><span class="font-mono">{{ w.op }}</span>{{ w.machine ? ' · ' + w.machine : '' }} · 合格 {{ w.good }}<template v-if="w.bad"> · 不良 {{ w.bad }}</template></span>
        <span class="text-ink-4">{{ userName(w.by) }}{{ w.shift ? ' · ' + w.shift : '' }}</span>
        <span v-if="w.voided" class="text-ink-4">已撤销（{{ userName(w.voidedBy) }}：{{ w.voidReason }}）</span>
        <g-btn v-else-if="!o.releasedAt && can('order.work')" perm="order.work" cls="btn-ghost btn-xs" @click="openVoid(w)">撤销</g-btn>
      </div>
    </div>
  </modal>

  <modal :open="vw.open" @close="vw.open = false" title="撤销报工" sub="这条报工自动登记的不合格还没开始处置时一起关闭；已经在处置的要先在不合格单里处理" width="max-w-md">
    <label class="label">撤销原因</label><input v-model="vw.why" class="input" placeholder="例如：终检多报了 10 件">
    <template #footer><button class="btn-secondary" @click="vw.open = false">取消</button><g-btn perm="order.work" cls="btn-danger" icon="undo" :when="!!vw.why.trim()" why="请写明撤销原因" @click="saveVoid">撤销这条报工</g-btn></template>
  </modal>

  <modal :open="lotEdit.open" @close="lotEdit.open = false" title="物料批次" sub="来料检验、出货检验按批次关联到这张工单，从客户投诉可以一路追到来料批次" width="max-w-md">
    <div class="space-y-4"><div><label class="label">投入的物料批次（多个用逗号分开）</label><input v-model="lotEdit.inLots" class="input font-mono"></div><div><label class="label">产出的成品批次</label><input v-model="lotEdit.outLot" class="input font-mono"></div></div>
    <template #footer><button class="btn-secondary" @click="lotEdit.open = false">取消</button><g-btn perm="order.create" cls="btn-primary" icon="check" @click="saveLots">保存</g-btn></template>
  </modal>
</div>
<empty v-else icon="factory" title="工单不存在"><button class="btn-secondary" @click="go('/orders')">回到工单</button></empty>`,
};

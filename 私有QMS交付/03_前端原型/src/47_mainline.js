/* =====================================================================
 * 生产主线：以生产工单为主线，所有岗位都围着工单走
 *   ① 技术准备（图纸气泡 → 检验标准 → 检验方案）
 *   ②… 各类检验：按这个零件工序路线上出现的先后排列（来料 / 首件 / 巡检 / 外协回厂 / 完工 / 出货）
 *   ⑦ 质量放行：所有检验合格、不合格已处置关闭、没有有效质量限制，由质量负责人放行
 *   不合格处置（NCR）挂在出问题的节点上；每个节点都给出：现在什么状态、在等谁、下一步按哪个按钮
 * ===================================================================== */

const ML_SCENE = { IQC: '来料检验', FIRST: '首件检验', IPQC: '过程巡检', FQC: '完工检验', OQC: '出货检验' };
const ML_STATE = {
  done: { chip: 'chip-green', text: '已完成' },
  active: { chip: 'chip-blue', text: '进行中' },
  blocked: { chip: 'chip-red', text: '有问题' },
  todo: { chip: 'chip-gray', text: '未开始' },
  na: { chip: 'chip-gray', text: '不适用' },
};
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
  return S.orders.find((o) => o.partId === t.partId && (t.ctx.wo === o.wo || (t.ctx.batch && (o.inLots || []).concat(o.outLot ? [o.outLot] : []).indexOf(t.ctx.batch) >= 0))) || null;
}
function orderOfNcr(n) { return n ? S.orders.find((o) => orderNcrs(o).some((x) => x.id === n.id)) || null : null; }
function orderOfReport(r) { return r ? orderOfTask(taskOf(r.taskId)) : null; }
/** 工单上某类检验的任务（新的在前）：工序检验点上的任务 + 按批次关联的来料 / 出货任务 */
function stageTasks(o, scene, pts) {
  const ids = new Set();
  const out = [];
  pts.forEach((x) => x.tasks.forEach((t) => { if (!ids.has(t.id)) { ids.add(t.id); out.push(t); } }));
  S.tasks.forEach((t) => {
    if (ids.has(t.id) || t.scene !== scene || t.partId !== o.partId || !t.ctx) return;
    if (t.ctx.wo === o.wo || (t.ctx.batch && orderLots(o).indexOf(t.ctx.batch) >= 0)) { ids.add(t.id); out.push(t); }
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

function inspStage(o, part, scene, pts) {
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
  const reqs = scene === 'FIRST' ? faiReqs(o) : null;
  if (reqs) s.refs.reqs = reqs;
  const hasPlan = plansFor(part.id, scene).length > 0;
  const openN = ncrs.filter((n) => n.status !== 'closed');
  const latest = (x) => x.last || null;
  const lasts = reqs ? reqs.map((r) => r.task).filter(Boolean) : pts.map(latest).filter(Boolean).concat(tasks.filter((t) => !pts.some((x) => x.last === t) && !pts.some((x) => x.tasks.indexOf(t) >= 0)).slice(0, 1));
  if (openN.length) {
    const n = openN[0], nx = nextOf('ncr', n);
    return Object.assign(s, { state: 'blocked', text: n.code + '：' + nx.text, owner: { roles: permRoles(nx.perm) }, since: n.log && n.log.length ? n.log[n.log.length - 1].at : n.createdAt, act: { label: '打开 ' + n.code, perm: nx.perm, to: '/ncr/' + n.id } });
  }
  const fail = lasts.find((t) => t.status === 'fail');
  if (fail) return Object.assign(s, { state: 'blocked', text: fail.code + ' 不合格：登记不合格并安排处置', owner: { roles: permRoles('ncr.create') }, since: lastDoneAt(fail), act: { label: '打开检验', perm: 'ncr.create', to: '/inspect/' + fail.id } });
  const insuf = lasts.find((t) => t.status === 'insufficient');
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
  return Object.assign(s, { state: 'done', text: scene === 'IPQC' ? '已巡检 ' + tasks.length + ' 次，最近一次合格' : '合格' + (reports[0] ? ' · 报告 ' + reports[0].code : ''), owner: { roles: permRoles('task.create') }, doneAt: latestDone });
}

function releaseStage(o, prior, q) {
  const s = { key: 'release', label: '质量放行', sub: '放行后可以入库发货', icon: 'shield', refs: {}, checks: [] };
  const holds = orderHolds(o), openN = orderNcrs(o).filter((n) => n.status !== 'closed');
  q = q || orderQty(o);
  s.checks = prior.filter((x) => x.state !== 'na').map((x) => ({ ok: x.state === 'done', text: x.label + (x.state === 'done' ? ' 已完成' : '：' + x.text) }))
    .concat([{ ok: !openN.length, text: openN.length ? '还有 ' + openN.length + ' 张不合格（' + openN.map((n) => n.code).join('、') + '）没有关闭' : '不合格都已处置关闭' }])
    .concat([{ ok: !holds.length, text: holds.length ? '有效的质量限制：' + holds.map((h) => h.scopeType + ' ' + h.scopeVal + ' 禁止' + h.actions.map((a) => HOLD_ACTIONS[a]).join('、')).join('；') : '没有有效的质量限制' }])
    .concat([{ ok: q.balanced, text: q.balanced ? balanceText(q) : qtyGapText(q) }]);
  const cons = orderConcessions(o);
  if (cons.length) {
    const codes = cons.map((c) => c.n.code).filter((x, i, a) => a.indexOf(x) === i);
    s.checks.push({ ok: true, warn: true, text: '有让步接收 ' + sum(cons.map((c) => c.d.qty)) + ' 件（' + codes.join('、') + '）：放行时要附客户或技术批准依据' });
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
  if (/每班/.test(t)) return 8;
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
/** 生产没结束（完工检验还没完成）时，巡检超过频次就重新变成“该巡检了” */
function ipqcDue(o, stage, fqcDone, reqs) {
  if (!stage || stage.state !== 'done' || o.releasedAt || fqcDone) return;
  const now = Date.now();
  const late = stage.refs.points.map((x) => {
    const h = freqHours(x.b.freq);
    if (!h || !x.last) return null;
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
  const part = partOf(o.partId);
  const pts = part.id ? orderPoints(o) : [];
  const scenes = [];
  pts.forEach((x) => { if (scenes.indexOf(x.b.scene) < 0) scenes.push(x.b.scene); });
  const stages = [prepStage(o, part, pts)].concat(scenes.map((sc) => inspStage(o, part, sc, pts.filter((x) => x.b.scene === sc))));
  const fqc = stages.find((s) => s.key === 'FQC');
  const first = stages.find((s) => s.key === 'FIRST');
  ipqcDue(o, stages.find((s) => s.key === 'IPQC'), !!fqc && fqc.state === 'done', first ? first.refs.reqs : null);
  const qty = orderQty(o);
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
  return { o, part, stages, cur, current: stages[cur], mine: mineStages, doneCount, state, dueSoon, holds: orderHolds(o), ncrs: orderNcrs(o), qty };
}
const ORDER_ML_STATE = { released: ['已放行', 'chip-green'], blocked: ['有问题', 'chip-red'], active: ['进行中', 'chip-blue'] };

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
const ML_NODE = {
  done: 'bg-emerald-500 text-white ring-emerald-500',
  active: 'bg-brand-600 text-white ring-brand-600',
  blocked: 'bg-rose-500 text-white ring-rose-500',
  todo: 'bg-white text-ink-3 ring-black/15',
  na: 'bg-[#f2f2f5] text-ink-5 ring-black/[0.06]',
};
COMPONENTS['mainline-track'] = {
  props: { ml: Object, size: { type: String, default: 'md' }, selected: String },
  emits: ['pick'],
  template: `
<div class="flex items-start overflow-x-auto no-scrollbar pb-1" role="list" aria-label="工单主线">
  <template v-for="(s,i) in ml.stages" :key="s.key">
    <button type="button" role="listitem" :data-stage="s.key" @click.stop="$emit('pick', s)" class="group shrink-0 flex flex-col items-center text-center rounded-xl transition-all duration-200" :class="[size === 'lg' ? 'w-[118px] px-1 py-2' : 'w-[92px] px-0.5 py-1', selected === s.key ? 'bg-brand-50/80 ring-1 ring-brand-500/30' : 'hover:bg-black/[0.03]']" :title="s.label + '：' + s.text">
      <span class="relative rounded-full flex items-center justify-center font-semibold ring-2 transition-transform duration-200 group-hover:scale-105" :class="[ML_NODE[s.state], size === 'lg' ? 'w-9 h-9 text-[13px]' : 'w-7 h-7 text-[11.5px]', i === ml.cur && ml.state !== 'released' ? 'shadow-[0_0_0_4px_rgba(52,120,246,.18)]' : '']">
        <ic v-if="s.state === 'done'" name="check" :size="size === 'lg' ? 16 : 13" stroke="2.6"/><ic v-else-if="s.state === 'blocked'" name="alert" :size="size === 'lg' ? 15 : 12" stroke="2.4"/><template v-else-if="s.state === 'na'">–</template><template v-else>{{ s.no }}</template>
        <span v-if="s.mine && !s.later" class="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-400 ring-2 ring-white"></span>
      </span>
      <span class="mt-1.5 font-medium leading-tight whitespace-nowrap" :class="[size === 'lg' ? 'text-[12.5px]' : 'text-[11.5px]', s.state === 'na' ? 'text-ink-5' : i === ml.cur ? 'text-ink' : 'text-ink-2']">{{ s.label }}</span>
      <span class="mt-0.5 leading-tight truncate max-w-full" :class="[size === 'lg' ? 'text-[11px]' : 'text-[10.5px]', s.state === 'blocked' ? 'text-rose-600' : s.state === 'active' ? 'text-brand-700' : 'text-ink-4']">{{ s.state === 'na' ? '不适用' : s.state === 'done' ? '已完成' : s.later ? '未开始' : ownerText(s.owner) }}</span>
    </button>
    <span v-if="i < ml.stages.length - 1" class="shrink-0 h-[2px] rounded-full self-start" :class="[size === 'lg' ? 'w-5 mt-[26px]' : 'w-3 mt-[18px]', s.state === 'done' ? 'bg-emerald-400' : 'bg-black/10']"></span>
  </template>
</div>`,
  setup() { return { ML_NODE, ownerText }; },
};

/* ---------------- 所属工单（检验、报告、不合格页面顶部）：这一步在主线的哪里 ---------------- */
COMPONENTS['order-trail'] = {
  props: { order: Object, stage: String },
  setup(p) {
    const ml = computed(() => (p.order ? mainlineOf(p.order) : null));
    return { ml };
  },
  template: `
<div v-if="ml" class="rounded-2xl bg-white ring-1 ring-black/[0.06] shadow-soft px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
  <button type="button" class="flex items-center gap-2 text-left" @click="go('/orders/' + order.id)" title="回到工单主线">
    <span class="w-7 h-7 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0"><ic name="factory" :size="15"/></span>
    <span class="leading-tight"><span class="block text-[11px] text-ink-4">所属工单</span><span class="block font-mono font-semibold text-[13px]">{{ order.wo }}</span></span>
  </button>
  <div class="flex items-center gap-1 overflow-x-auto no-scrollbar">
    <template v-for="(s,i) in ml.stages" :key="s.key">
      <button type="button" @click="go('/orders/' + order.id + '?stage=' + s.key)" class="shrink-0 inline-flex items-center gap-1 h-7 pl-0.5 pr-2 rounded-full text-[11.5px] ring-1 ring-inset transition-colors" :class="s.key === stage ? 'bg-brand-600 text-white ring-brand-600' : s.state === 'done' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' : s.state === 'blocked' ? 'bg-rose-50 text-rose-700 ring-rose-600/20' : 'bg-white text-ink-3 ring-black/10'" :title="s.label + '：' + s.text">
        <span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold" :class="s.key === stage ? 'bg-white/25' : 'bg-black/[0.05]'"><ic v-if="s.state === 'done'" name="check" :size="10" stroke="2.8"/><template v-else>{{ s.no }}</template></span>{{ s.label }}
      </button>
      <span v-if="i < ml.stages.length - 1" class="w-2 h-px bg-black/15 shrink-0"></span>
    </template>
  </div>
  <button type="button" class="link text-xs ml-auto" @click="go('/orders/' + order.id)">回到主线</button>
</div>`,
};

/* ---------------- 工单卡片（生产主线看板） ---------------- */
COMPONENTS['order-card'] = {
  props: { ml: Object },
  setup(p) {
    const focus = computed(() => (p.ml.mine[0] || p.ml.current));
    const other = computed(() => (focus.value && !focus.value.mine && focus.value.act ? stageOwnerUser(focus.value) : null));
    const overdue = computed(() => !!p.ml.o.due && !p.ml.o.releasedAt && new Date(p.ml.o.due) < new Date());
    const open = () => go('/orders/' + p.ml.o.id);
    const act = () => runStageAct(p.ml.o, focus.value);
    const pick = (s) => go('/orders/' + p.ml.o.id + '?stage=' + s.key);
    const swap = () => { if (other.value) switchUser(other.value.id); };
    const waited = computed(() => (focus.value && focus.value.since ? (Date.now() - new Date(focus.value.since).getTime()) / 3600e3 : 0));
    return { focus, other, overdue, open, act, pick, swap, waited, waitText, pctText, yieldTone, ORDER_ML_STATE, ownerText };
  },
  template: `
<div class="card p-4 sm:p-5 transition-shadow duration-300 hover:shadow-lift" :data-order="ml.o.wo">
  <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
    <button type="button" class="font-mono font-semibold text-[15px] hover:text-brand-700" @click="open">{{ ml.o.wo }}</button>
    <span class="text-[13px] text-ink-2">{{ ml.part.name || '未知零件' }} <span class="text-ink-4 font-mono text-[11.5px]">{{ ml.part.partNo }}</span></span>
    <span class="text-[12px] text-ink-3">{{ ml.o.qty }} 件</span>
    <span v-if="ml.o.due" class="text-[12px]" :class="overdue ? 'text-rose-600 font-medium' : 'text-ink-3'">交期 {{ fmtDate(ml.o.due) }}{{ overdue ? '（已逾期）' : '' }}</span>
    <span v-if="ml.dueSoon && !overdue" class="chip-amber" title="交期两天内，主线还没走完">交期临近</span>
    <span class="ml-auto flex items-center gap-1.5">
      <span v-if="ml.holds.length" class="chip-red"><ic name="lock" :size="11"/>质量限制</span>
      <span v-if="ml.ncrs.filter(n => n.status !== 'closed').length" class="chip-amber">不合格 {{ ml.ncrs.filter(n => n.status !== 'closed').length }}</span>
      <span v-if="ml.o.releasedAt && ml.o.releaseKind === 'concession'" class="chip-amber">让步放行</span>
      <span :class="ORDER_ML_STATE[ml.state][1]">{{ ORDER_ML_STATE[ml.state][0] }}</span>
    </span>
  </div>
  <div v-if="ml.qty.reported" class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
    <span>投产 <b class="text-ink tabular">{{ ml.qty.input }}</b></span>
    <span>入库合格 <b class="text-ink tabular">{{ ml.qty.stocked }}</b></span>
    <span>不良 <b class="tabular" :class="ml.qty.defects ? 'text-rose-600' : 'text-ink'">{{ ml.qty.defects }}</b><template v-if="ml.qty.defects">（返工 {{ ml.qty.rework + ml.qty.sorted }} · 报废 {{ ml.qty.scrap }} · 让步 {{ ml.qty.concession }}<template v-if="ml.qty.pending"> · <span class="text-amber-700">待处置 {{ ml.qty.pending }}</span></template>）</template></span>
    <span>直通率 <b class="tabular" :class="yieldTone(ml.qty.rty)">{{ pctText(ml.qty.rty) }}</b></span>
  </div>
  <div class="mt-3"><mainline-track :ml="ml" @pick="pick"/></div>
  <div v-if="focus && ml.state !== 'released'" class="mt-3 rounded-xl px-3.5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2" :class="focus.mine ? 'bg-amber-50/80 ring-1 ring-inset ring-amber-500/25' : focus.state === 'blocked' ? 'bg-rose-50/70' : 'bg-[#f7f7f9]'">
    <span class="text-[11.5px] font-medium shrink-0" :class="focus.mine ? 'text-amber-800' : 'text-ink-4'">{{ focus.mine ? '轮到你' : '下一步' }}</span>
    <span class="text-[13px] flex-1 min-w-[200px]"><b class="font-medium">{{ focus.no }} {{ focus.label }}</b><span class="text-ink-3"> · {{ focus.text }}</span><span v-if="!focus.mine && focus.owner" class="text-ink-4"> · 等{{ ownerText(focus.owner) }}</span><span v-if="waitText(focus.since)" :class="waited >= 24 ? 'text-rose-600 font-medium' : waited >= 8 ? 'text-amber-700' : 'text-ink-4'" title="从这一步可以开始处理算起"> · 已等 {{ waitText(focus.since) }}</span></span>
    <button v-if="focus.mine && focus.act" type="button" class="btn-primary btn-sm" @click="act" data-test="order-act">{{ focus.act.label }}<ic name="arrow-right" :size="13"/></button>
    <button v-else-if="other" type="button" class="btn-secondary btn-sm" @click="swap" title="演示用：切换身份后继续这一步"><avatar :uid="other.id" :size="18"/>切换为{{ other.name }}</button>
    <button type="button" class="btn-ghost btn-sm" @click="open">工单详情</button>
  </div>
  <div v-else-if="ml.state === 'released'" class="mt-3 rounded-xl px-3.5 py-2.5 bg-emerald-50/70 text-[13px] text-emerald-800 flex items-center gap-2"><ic name="check" :size="15"/>{{ ml.stages[ml.stages.length - 1].text }}，可以入库发货</div>
</div>`,
};

/* ---------------- 生产主线看板：所有在制工单，一张工单一条线 ---------------- */
COMPONENTS['order-board'] = {
  props: { mode: { type: String, default: 'mine' } },
  setup(p) {
    const all = computed(() => S.orders.map(mainlineOf));
    const hasMine = (m) => m.mine.length > 0 && m.state !== 'released';
    const initial = UI.route.query.f || (p.mode === 'mine' && S.orders.map(mainlineOf).some(hasMine) ? 'mine' : 'active');
    const filter = ref(initial);
    const q = ref(UI.route.query.wo || '');
    const counts = computed(() => ({
      mine: all.value.filter(hasMine).length, active: all.value.filter((m) => m.state !== 'released').length,
      blocked: all.value.filter((m) => m.state === 'blocked').length, released: all.value.filter((m) => m.state === 'released').length,
    }));
    const opts = computed(() => [
      { value: 'mine', label: '轮到我', count: counts.value.mine }, { value: 'active', label: '全部在制', count: counts.value.active },
      { value: 'blocked', label: '有问题', count: counts.value.blocked }, { value: 'released', label: '已放行', count: counts.value.released },
    ]);
    const rows = computed(() => {
      const k = q.value.trim().toLowerCase();
      return all.value.filter((m) => (filter.value === 'mine' ? hasMine(m) : filter.value === 'blocked' ? m.state === 'blocked' : filter.value === 'released' ? m.state === 'released' : m.state !== 'released')
        && (!k || (m.o.wo + ' ' + (m.part.name || '') + ' ' + (m.part.partNo || '') + ' ' + (m.o.inLots || []).join(' ') + ' ' + (m.o.outLot || '')).toLowerCase().includes(k)))
        .sort((a, b) => (hasMine(b) - hasMine(a)) || ((b.state === 'blocked') - (a.state === 'blocked')) || String(a.o.due || '9').localeCompare(String(b.o.due || '9')));
    });
    return { filter, q, opts, rows, counts };
  },
  template: `
<div class="space-y-4">
  <div class="flex flex-wrap items-center gap-2">
    <seg v-model="filter" :options="opts"/>
    <div class="relative"><ic name="search" :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"/><input v-model="q" class="input !h-[38px] pl-9 w-60" placeholder="工单号 / 零件 / 批次"></div>
    <div class="flex-1"></div>
    <button type="button" class="btn-ghost" @click="go('/orders')" title="按工序看每张工单的检验点"><ic name="route" :size="15"/>工序视图</button>
    <g-btn perm="order.create" cls="btn-secondary" icon="plus" @click="UI.newOrder = true">登记工单</g-btn>
  </div>
  <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-3">
    <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>已完成</span>
    <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-brand-600"></span>进行中</span>
    <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-rose-500"></span>有问题（不合格、质量限制）</span>
    <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-white ring-1 ring-black/20"></span>未开始</span>
    <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-amber-400"></span>轮到你</span>
  </div>
  <order-card v-for="m in rows" :key="m.o.id" :ml="m"/>
  <div v-if="!rows.length" class="card">
    <empty v-if="filter === 'mine'" icon="check" title="主线上暂时没有轮到你的事" :desc="counts.active ? '其他工单在等别的岗位处理' : '还没有在制的工单'"><button v-if="counts.active" class="btn-secondary btn-sm" @click="filter = 'active'">看全部在制工单</button></empty>
    <empty v-else icon="factory" title="没有符合条件的工单" desc="登记一张生产工单，主线就从“技术准备”开始"><g-btn perm="order.create" cls="btn-primary btn-sm" icon="plus" @click="UI.newOrder = true">登记工单</g-btn></empty>
  </div>
</div>`,
};

/* ---------------- 登记生产工单（全局弹窗，由 UI.newOrder 打开） ---------------- */
COMPONENTS['new-order-modal'] = {
  setup() {
    const f = reactive({ wo: '', partId: '', qty: '200', due: '', lots: '' });
    const open = computed(() => !!UI.newOrder);
    watch(open, (v) => {
      if (!v) return;
      const d = new Date(Date.now() + 7 * 86400e3);
      Object.assign(f, { wo: 'WO-' + dateCode().slice(2, 6) + '-' + String(100 + (nextSeq() % 900)), partId: (S.parts.find((p) => p.route && p.route.ops.length) || S.parts[0] || {}).id || '', qty: '200', due: d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()), lots: '' });
    });
    const close = () => { UI.newOrder = false; };
    const save = () => {
      const wo = f.wo.trim();
      if (!wo) { toast('请填写工单号', 'error'); return; }
      if (S.orders.some((o) => o.wo === wo)) { toast('工单号已存在', 'error'); return; }
      if (!f.partId) { toast('请选择零件', 'error'); return; }
      if (!/^[1-9]\d*$/.test(String(f.qty).trim())) { toast('计划数量须为正整数', 'error'); return; }
      const o = { id: 'o' + nextSeq(), wo, partId: f.partId, qty: parseInt(f.qty, 10), due: f.due ? new Date(f.due + 'T18:00:00').toISOString() : '', inLots: f.lots.split(/[\s,，;；]+/).map((x) => x.trim()).filter(Boolean), outLot: '', createdAt: nowISO(), createdBy: S.me };
      S.orders.unshift(o);
      logAudit('生产工单', wo, '登记生产工单：' + partOf(f.partId).name + ' × ' + o.qty + (o.inLots.length ? '，投入物料批次 ' + o.inLots.join('、') : ''));
      close();
      toast('工单 ' + wo + ' 已登记，主线从“技术准备”开始', 'success');
      go('/orders/' + o.id);
    };
    return { f, open, close, save };
  },
  template: `
<modal :open="open" @close="close" title="登记生产工单" sub="没有 ERP / MES 时在这里登记；登记后这张工单就是一条主线，所有检验都挂在它上面" width="max-w-md">
  <div class="space-y-4">
    <div><label class="label">工单号</label><input v-model="f.wo" class="input font-mono"></div>
    <div><label class="label">零件</label><select v-model="f.partId" class="input"><option v-for="p in S.parts" :key="p.id" :value="p.id">{{ p.partNo }} {{ p.name }}{{ p.route && p.route.ops.length ? '' : '（还没有工序路线）' }}</option></select></div>
    <div class="grid grid-cols-2 gap-3"><div><label class="label">计划数量（件）</label><input v-model.trim="f.qty" class="input" inputmode="numeric"></div><div><label class="label">交期</label><input v-model="f.due" type="date" class="input"></div></div>
    <div><label class="label">投入的物料批次（可空，多个用逗号分开）</label><input v-model="f.lots" class="input font-mono" placeholder="如 20261117-A"><p class="text-[11px] text-ink-4 mt-1">来料检验按这里的批次关联到工单，方便追溯。</p></div>
  </div>
  <template #footer><button class="btn-secondary" @click="close">取消</button><g-btn perm="order.create" cls="btn-primary" icon="check" @click="save">登记</g-btn></template>
</modal>`,
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
    <div v-for="(c,i) in rel.checks" :key="i" class="flex items-start gap-2.5 text-[13px]"><span class="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-px text-white" :class="c.warn ? 'bg-amber-400' : c.ok ? 'bg-emerald-500' : 'bg-rose-500'"><ic :name="c.warn ? 'alert' : c.ok ? 'check' : 'x'" :size="11" stroke="2.8"/></span><span :class="c.warn ? 'text-amber-800' : c.ok ? 'text-ink-2' : 'text-rose-700'">{{ c.text }}</span></div>
    <div v-if="cons.length" class="mt-4 rounded-2xl bg-amber-50/70 ring-1 ring-inset ring-amber-500/20 p-4 space-y-3">
      <div><div class="text-[13px] font-semibold text-amber-900">让步放行依据（每一项都要填）</div><p class="text-[11.5px] text-amber-800/80 mt-0.5">让步接收的件随这批货一起放行。写明是谁批准的、凭哪份文件，记进放行记录和工单质量档案。</p></div>
      <div v-for="c in cons" :key="c.d.id" class="rounded-xl bg-white ring-1 ring-black/[0.06] p-3 space-y-2">
        <div class="text-[12.5px] leading-relaxed"><button type="button" class="link font-mono" @click="openNcr(c.n)">{{ c.n.code }}</button> · 让步接收 <b>{{ c.d.qty }}</b> 件 · <span class="text-ink-3">{{ c.d.reason }}</span></div>
        <div v-if="basis[c.d.id]" class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div><label class="label">批准方</label><select v-model="basis[c.d.id].kind" class="input"><option v-for="k in CONCESSION_BASIS" :key="k" :value="k">{{ k }}</option></select></div>
          <div><label class="label">批准文件编号</label><input v-model="basis[c.d.id].docNo" class="input font-mono" placeholder="如 CC-2611-05"></div>
          <div><label class="label">批准人</label><input v-model="basis[c.d.id].approver" class="input" placeholder="客户或技术负责人"></div>
        </div>
      </div>
    </div>
    <div class="pt-3"><label class="label">放行说明（可选）</label><textarea v-model="note" rows="2" class="textarea" placeholder="例如：首件、巡检、完工、出货检验均合格，报告齐全"></textarea></div>
  </div>
  <template #footer><button class="btn-secondary" @click="close">取消</button><g-btn perm="order.release" cls="btn-primary" icon="shield" :when="ok && basisOk" :why="ok ? '让步依据没有填完整' : '还有检查项没通过'" @click="doRelease">{{ cons.length ? '确认让步放行' : '确认放行' }}</g-btn></template>
</modal>`,
};

/* ---------------- 工单详情：一张工单的完整主线（工单质量档案） ---------------- */
COMPONENTS['page-order'] = {
  setup() {
    const o = computed(() => S.orders.find((x) => x.id === UI.route.params.id || x.wo === UI.route.params.id) || null);
    const ml = computed(() => (o.value ? mainlineOf(o.value) : null));
    const sel = ref(UI.route.query.stage || '');
    const stage = computed(() => (ml.value ? ml.value.stages.find((s) => s.key === sel.value) || ml.value.stages[ml.value.cur] : null));
    const pick = (s) => { sel.value = s.key; };
    const other = computed(() => (stage.value && !stage.value.mine && stage.value.act ? stageOwnerUser(stage.value) : null));
    const act = () => runStageAct(o.value, stage.value);
    const swap = () => { if (other.value) switchUser(other.value.id); };
    const startAt = async (x) => {
      if (!can('task.create')) { toast(denyTip('task.create'), 'warn'); return; }
      if (!plansFor(o.value.partId, x.b.scene).length) { toast('还没有生效的' + (ML_SCENE[x.b.scene] || '') + '方案，请先编制方案', 'warn'); return; }
      if (!(await gateConfirm(o.value, x.b.scene, x))) return;
      startPoint(o.value, x);
    };
    /* 按机台的首件要求：直接在要求上开首件，带上机台和触发原因 */
    const startReq = (r) => {
      if (!can('task.create')) { toast(denyTip('task.create'), 'warn'); return; }
      if (!plansFor(o.value.partId, 'FIRST').length) { toast('还没有生效的首件检验方案，请先编制方案', 'warn'); return; }
      const x = orderPoints(o.value).find((p) => p.b.scene === 'FIRST' && p.key === r.key);
      if (x) startPoint(o.value, x, { machine: r.machine, trigger: r.trigger, setupId: r.ev ? r.ev.id : '' });
    };
    const REQ_CLS = { done: 'bg-emerald-50/60 ring-emerald-600/15', active: 'bg-sky-50/60 ring-sky-600/15', blocked: 'bg-rose-50/70 ring-rose-600/20', todo: 'bg-amber-50/70 ring-amber-500/25' };
    /* 数量台账的格子 */
    const qtyTiles = computed(() => {
      if (!ml.value) return [];
      const q = ml.value.qty;
      return [
        { k: '计划', v: q.plan || '—' }, { k: '投产', v: q.input || '—' }, { k: '入库合格', v: q.stocked, tone: 'text-emerald-700' },
        { k: '不良', v: q.defects, tone: q.defects ? 'text-rose-600' : '' }, { k: '返工 / 挑选', v: q.rework + q.sorted }, { k: '报废', v: q.scrap },
        { k: '让步', v: q.concession, tone: q.concession ? 'text-amber-700' : '' }, { k: '待处置', v: q.pending, tone: q.pending ? 'text-amber-700' : '' },
        { k: '在制', v: q.input ? q.wip : '—', tone: q.wip < 0 ? 'text-rose-600' : '' }, { k: '直通率', v: pctText(q.rty), tone: yieldTone(q.rty) },
      ];
    });
    const plansOf = computed(() => (ml.value ? ml.value.stages.filter((s) => s.scene).map((s) => ({ s, plans: plansFor(o.value.partId, s.scene), draft: S.plans.find((p) => p.partId === o.value.partId && p.scenes.includes(s.scene) && (p.status === 'draft' || p.status === 'review')) })) : []));
    const audit = computed(() => {
      if (!ml.value) return [];
      const keys = new Set([o.value.wo]);
      ml.value.stages.forEach((s) => { (s.refs.tasks || []).forEach((t) => keys.add(t.code)); (s.refs.ncrs || []).forEach((n) => keys.add(n.code)); (s.refs.reports || []).forEach((r) => keys.add(r.code)); });
      return S.audit.filter((a) => keys.has(a.obj) || Array.from(keys).some((k) => String(a.obj).indexOf(k) === 0)).slice(0, 14);
    });
    const lotEdit = reactive({ open: false, inLots: '', outLot: '' });
    const openLots = () => { Object.assign(lotEdit, { open: true, inLots: (o.value.inLots || []).join(', '), outLot: o.value.outLot || '' }); };
    const saveLots = () => {
      o.value.inLots = lotEdit.inLots.split(/[\s,，;；]+/).map((x) => x.trim()).filter(Boolean);
      o.value.outLot = lotEdit.outLot.trim();
      logAudit('生产工单', o.value.wo, '更新批次：投入 ' + (o.value.inLots.join('、') || '无') + '；产出 ' + (o.value.outLot || '无'));
      lotEdit.open = false; toast('批次已更新', 'success');
    };
    return { o, ml, sel, stage, pick, other, act, swap, startAt, startReq, REQ_CLS, qtyTiles, plansOf, audit, lotEdit, openLots, saveLots, waitText, pctText, yieldTone, qtyGapText, faiLabel, ML_STATE, ORDER_ML_STATE, ownerText, POINT_TEXT, RESULT_TEXT: { pass: '合格', fail: '不合格', insufficient: '证据不足', pending: '待检', active: '检验中' } };
  },
  template: `
<div v-if="o && ml" class="space-y-4">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <button class="text-xs text-ink-3 hover:text-ink inline-flex items-center gap-1 mb-2" @click="go('/workbench')"><ic name="chevron-left" :size="13"/>生产主线</button>
      <div class="flex flex-wrap items-center gap-2"><h1 class="page-title font-mono">{{ o.wo }}</h1><span :class="ORDER_ML_STATE[ml.state][1]">{{ ORDER_ML_STATE[ml.state][0] }}</span><span v-if="ml.holds.length" class="chip-red"><ic name="lock" :size="11"/>质量限制</span><span v-if="ml.dueSoon" class="chip-amber">{{ new Date(o.due) < new Date() ? '已逾期' : '交期临近' }}</span><span v-if="o.releasedAt && o.releaseKind === 'concession'" class="chip-amber">让步放行</span></div>
      <p class="text-xs text-ink-3 mt-1">{{ ml.part.name }} · <button class="link" @click="go('/parts?id=' + ml.part.id)">{{ ml.part.partNo }}</button> · 图号 {{ ml.part.drawingNo }} · 计划 {{ o.qty }} 件<template v-if="o.due"> · 交期 {{ fmtDate(o.due) }}</template> · {{ userName(o.createdBy) }} 登记于 {{ fmtDate(o.createdAt) }}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2"><button class="btn-secondary" @click="go('/orders/' + o.id + '/card')" title="打印随工件流转的卡片，扫上面的二维码直接进到这张工单"><ic name="qr" :size="15"/>流转卡</button><g-btn v-if="!o.releasedAt" perm="order.work" cls="btn-secondary" icon="edit" @click="UI.work = { orderId: o.id }">报工</g-btn><button class="btn-secondary" @click="openLots"><ic name="tag" :size="15"/>物料批次</button><g-btn v-if="!o.releasedAt" perm="order.release" cls="btn-primary" icon="shield" :when="ml.stages[ml.stages.length - 1].state === 'active'" why="主线还没走完，见第 7 步的检查项" @click="UI.release = o.id">质量放行</g-btn></div>
  </div>

  <div class="card p-4 sm:p-5">
    <div class="flex items-center justify-between mb-2"><h2 class="section-title">工单主线</h2><span class="text-[11.5px] text-ink-4">{{ ml.doneCount }} / {{ ml.stages.length }} 步完成 · 点任意一步查看详情</span></div>
    <mainline-track :ml="ml" size="lg" :selected="stage ? stage.key : ''" @pick="pick"/>
  </div>

  <div class="card p-4 sm:p-5" data-panel="qty">
    <div class="flex flex-wrap items-start justify-between gap-2 mb-3">
      <div><h2 class="section-title">数量与良率</h2><p class="text-[11.5px] text-ink-4 mt-0.5">每道工序报合格数和不良数；不良自动登记 NCR，处置结果（返工、报废、让步）回写到这里。直通率 = 各工序一次合格率相乘。</p></div>
      <g-btn v-if="!o.releasedAt" perm="order.work" cls="btn-secondary btn-sm" icon="edit" @click="UI.work = { orderId: o.id }">报工</g-btn>
    </div>
    <div class="flex flex-wrap gap-2">
      <div v-for="t in qtyTiles" :key="t.k" class="rounded-xl bg-[#f7f7f9] px-3 py-2 min-w-[84px]"><div class="text-[11px] text-ink-4 whitespace-nowrap">{{ t.k }}</div><div class="text-[17px] font-semibold tabular mt-0.5" :class="t.tone || 'text-ink'">{{ t.v }}</div></div>
    </div>
    <p class="mt-2 text-[12px]" :class="ml.qty.balanced ? 'text-emerald-700' : 'text-amber-700'">{{ ml.qty.balanced ? '数量对得上，可以作为放行依据' : qtyGapText(ml.qty) }}</p>
    <div class="overflow-x-auto mt-2"><table class="tbl">
      <thead><tr><th>工序</th><th>机台</th><th class="text-right">报工</th><th class="text-right">合格</th><th class="text-right">不良</th><th class="text-right">一次合格率</th><th>最近报工</th><th></th></tr></thead>
      <tbody>
        <tr v-for="r in ml.qty.rows" :key="r.key">
          <td class="font-mono text-[12.5px]">{{ r.key }}</td>
          <td class="text-[12px] text-ink-3">{{ r.machines.join('、') || r.op.wc || '—' }}</td>
          <td class="text-right tabular">{{ r.processed || '—' }}</td>
          <td class="text-right tabular">{{ r.processed ? r.good : '—' }}</td>
          <td class="text-right tabular" :class="r.bad ? 'text-rose-600 font-medium' : ''">{{ r.processed || r.bad ? r.bad : '—' }}<span v-if="r.badInsp" class="text-[11px] text-ink-4 font-normal">（检验发现 {{ r.badInsp }}）</span></td>
          <td class="text-right tabular font-medium" :class="yieldTone(r.fpy)">{{ pctText(r.fpy) }}</td>
          <td class="text-[12px] text-ink-3">{{ r.last ? userName(r.last.by) + ' · ' + fmtRel(r.last.at) + (r.count > 1 ? '（共 ' + r.count + ' 次）' : '') : '—' }}</td>
          <td class="text-right"><g-btn v-if="!o.releasedAt" perm="order.work" cls="btn-ghost btn-xs" @click="UI.work = { orderId: o.id, op: r.key }">报工</g-btn></td>
        </tr>
      </tbody>
    </table></div>
  </div>

  <div v-if="stage" class="grid grid-cols-1 xl:grid-cols-12 gap-4">
    <div class="xl:col-span-8 space-y-4">
      <div class="card p-5">
        <div class="flex flex-wrap items-start gap-3">
          <span class="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0" :class="stage.state === 'done' ? 'bg-emerald-50 text-emerald-600' : stage.state === 'blocked' ? 'bg-rose-50 text-rose-600' : 'bg-brand-50 text-brand-600'"><ic :name="stage.icon || 'list'" :size="19"/></span>
          <div class="flex-1 min-w-[220px]">
            <div class="flex items-center gap-2"><span class="font-semibold text-[16px]">第 {{ stage.no }} 步 · {{ stage.label }}</span><span :class="ML_STATE[stage.state].chip">{{ stage.later ? '未开始' : ML_STATE[stage.state].text }}</span></div>
            <div class="text-[12px] text-ink-4 mt-0.5">{{ stage.sub }}</div>
            <div class="text-[13.5px] mt-2">{{ stage.text }}</div>
            <div v-if="stage.state !== 'done' && stage.state !== 'na' && stage.owner" class="text-[12px] text-ink-3 mt-1">负责：{{ ownerText(stage.owner) }}<template v-if="!stage.later && waitText(stage.since)"> · 已等 {{ waitText(stage.since) }}</template></div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button v-if="stage.mine && stage.act" type="button" class="btn-primary" @click="act" data-test="stage-act">{{ stage.act.label }}<ic name="arrow-right" :size="14"/></button>
            <button v-else-if="other" type="button" class="btn-secondary" @click="swap" title="演示用：切换身份后继续这一步"><avatar :uid="other.id" :size="18"/>切换为{{ other.name }}继续</button>
            <button v-else-if="stage.act && stage.act.to" type="button" class="btn-secondary" @click="go(stage.act.to)">查看</button>
          </div>
        </div>
      </div>

      <div v-if="stage.key === 'prep'" class="card p-5 space-y-4">
        <div><div class="label">检验标准（来自气泡识别）</div>
          <div v-if="stage.refs.std" class="flex items-center gap-2 text-[13px]"><span class="chip-green">生效</span><button class="link font-mono" @click="go('/standards/' + stage.refs.std.id)">{{ stage.refs.std.code }} Rev {{ stage.refs.std.rev }}</button><span class="text-ink-4 text-[12px]">{{ stage.refs.std.items.length }} 项特性 · 图纸 Rev {{ stage.refs.std.drawingRev }}</span></div>
          <div v-else class="text-[13px] text-ink-3">还没有生效的标准</div></div>
        <div><div class="label">检验方案（主线上每类检验都要有）</div>
          <div v-for="x in plansOf" :key="x.s.key" class="flex items-center gap-2 py-1 text-[13px]"><span class="w-24 text-ink-3">{{ x.s.label }}</span>
            <template v-if="x.plans.length"><span class="chip-green">生效</span><button v-for="p in x.plans" :key="p.id" class="link font-mono text-[12.5px]" @click="go('/plans/' + p.id)">{{ p.code }} Rev {{ p.rev }}</button></template>
            <template v-else-if="x.draft"><span class="chip-amber">{{ x.draft.status === 'review' ? '待批准' : '草稿' }}</span><button class="link font-mono text-[12.5px]" @click="go('/plans/' + x.draft.id)">{{ x.draft.code }}</button></template>
            <template v-else><span class="chip-red">缺少</span><button class="link text-[12px]" @click="go('/plans?tab=tpl')">从模板生成</button></template>
          </div>
        </div>
      </div>

      <div v-if="stage.scene" class="card overflow-hidden">
        <div v-if="stage.key === 'FIRST'" class="px-5 pt-4 pb-3 border-b border-black/[0.05]">
          <div class="flex flex-wrap items-center justify-between gap-2"><div><h3 class="section-title !text-[14px]">按机台的首件要求</h3><p class="text-[11.5px] text-ink-4 mt-0.5">每台在做的机台都要有首件；开班、换型、换刀、修机后要重新做。首件没合格，这道工序不该批量生产。</p></div><g-btn v-if="!o.releasedAt" perm="order.setup" cls="btn-soft btn-sm" icon="plus" @click="UI.setup = { orderId: o.id }">登记换型 / 换刀 / 修机</g-btn></div>
          <div class="mt-2.5 space-y-1.5">
            <div v-for="r in stage.refs.reqs || []" :key="r.key + '|' + r.machine" class="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl px-3 py-2 text-[12.5px] ring-1 ring-inset" :class="REQ_CLS[r.state]">
              <span class="font-mono text-ink-3">{{ r.key }}</span><span class="font-semibold">{{ r.machine || '默认机台' }}</span><span class="chip-gray">{{ faiLabel(r) }}</span>
              <span class="text-[11.5px] text-ink-4">{{ r.implicit ? '工单开工' : r.auto ? r.shift + ' ' + fmtTime(r.at) + ' 起' : '登记于 ' + fmtTime(r.at) }}</span>
              <span class="flex-1"></span>
              <template v-if="r.task"><button class="link font-mono text-[12px]" @click="go('/inspect/' + r.task.id)">{{ r.task.code }}</button><st k="task" :v="r.task.status" dot/></template>
              <g-btn v-else perm="task.create" cls="btn-primary btn-xs" @click="startReq(r)">开首件</g-btn>
            </div>
            <div v-if="!(stage.refs.reqs || []).length" class="text-[12px] text-ink-4">没有在生产的机台</div>
          </div>
          <div v-if="(o.setups || []).length" class="mt-2 text-[11.5px] text-ink-4 leading-relaxed">登记记录：<span v-for="e in o.setups.slice().reverse().slice(0, 6)" :key="e.id" class="mr-3 whitespace-nowrap">{{ fmtTime(e.at) }} {{ e.machine }} {{ e.trigger }}（{{ userName(e.by) }}）</span></div>
        </div>
        <div class="px-5 pt-4 pb-2 flex items-center justify-between"><h3 class="section-title !text-[14px]">检验点与检验记录</h3><span class="text-[11.5px] text-ink-4">按工序路线</span></div>
        <div class="overflow-x-auto"><table class="tbl">
          <thead><tr><th>工序</th><th>检验点</th><th>检验单</th><th>状态</th><th>检验员</th><th>报告</th><th></th></tr></thead>
          <tbody>
            <tr v-for="x in stage.refs.points" :key="x.key + x.b.scene">
              <td class="font-mono text-[12.5px]">{{ x.key }}</td>
              <td class="text-[12.5px]">{{ sceneOf(x.b.scene).name }}{{ x.b.freq ? ' · ' + x.b.freq : '' }}{{ x.b.note ? ' · ' + x.b.note : '' }}</td>
              <td><button v-if="x.last" class="link font-mono text-[12.5px]" @click="go('/inspect/' + x.last.id)">{{ x.last.code }}</button><span v-else class="text-ink-5">—</span><span v-if="x.tasks.length > 1" class="text-[11px] text-ink-4 ml-1">共 {{ x.tasks.length }} 次</span></td>
              <td><st v-if="x.last" k="task" :v="x.last.status" dot/><span v-else class="chip-gray">未开检</span></td>
              <td class="text-[12.5px]">{{ x.last ? userName(x.last.assignee) : '—' }}</td>
              <td><template v-for="r in S.reports.filter(r => x.last && r.taskId === x.last.id)" :key="r.id"><button class="link font-mono text-[12px]" @click="go('/reports/' + r.id)">{{ r.code }}</button></template></td>
              <td class="text-right"><button v-if="!x.last || (x.b.scene === 'IPQC' && x.last.status !== 'pending' && x.last.status !== 'active')" class="btn-secondary btn-xs" @click="startAt(x)">{{ x.last ? '再巡检一次' : '开检' }}</button><button v-else class="btn-ghost btn-xs" @click="go('/inspect/' + x.last.id)">打开</button></td>
            </tr>
            <tr v-for="t in stage.refs.tasks.filter(t => !stage.refs.points.some(x => x.tasks.indexOf(t) >= 0))" :key="t.id">
              <td class="text-[12px] text-ink-4">按批次关联</td><td class="text-[12.5px]">{{ sceneOf(t.scene).name }} · 批次 {{ t.ctx.batch }}</td>
              <td><button class="link font-mono text-[12.5px]" @click="go('/inspect/' + t.id)">{{ t.code }}</button></td><td><st k="task" :v="t.status" dot/></td><td class="text-[12.5px]">{{ userName(t.assignee) }}</td><td></td><td></td>
            </tr>
          </tbody>
        </table></div>
        <div v-if="stage.refs.ncrs.length" class="px-5 py-3 border-t border-black/[0.05]">
          <div class="label">不合格处置（挂在这一步上）</div>
          <div v-for="n in stage.refs.ncrs" :key="n.id" class="flex flex-wrap items-center gap-2 py-1 text-[13px]"><button class="link font-mono" @click="go('/ncr/' + n.id)">{{ n.code }}</button><st k="ncr" :v="n.status"/><span class="text-ink-2 truncate">{{ n.title }}</span><span v-if="n.status !== 'closed'" class="text-[12px] text-ink-4">下一步：{{ nextOf('ncr', n).text }}</span></div>
        </div>
      </div>

      <div v-if="stage.key === 'release'" class="card p-5 space-y-2">
        <div class="label">放行检查</div>
        <div v-for="(c,i) in stage.checks" :key="i" class="flex items-start gap-2.5 text-[13px]"><span class="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-px" :class="c.warn ? 'bg-amber-400 text-white' : c.ok ? 'bg-emerald-500 text-white' : 'bg-black/[0.08] text-ink-4'"><ic :name="c.warn ? 'alert' : c.ok ? 'check' : 'x'" :size="11" stroke="2.8"/></span><span :class="c.warn ? 'text-amber-800' : c.ok ? 'text-ink-2' : 'text-ink'">{{ c.text }}</span></div>
        <p v-if="o.releaseNote" class="text-[12.5px] text-ink-3 pt-2">放行说明：{{ o.releaseNote }}</p>
        <div v-if="(o.releaseBasis || []).length" class="pt-2"><div class="label">让步放行依据</div><div v-for="b in o.releaseBasis" :key="b.lineId" class="text-[12.5px] py-0.5"><span class="font-mono">{{ b.ncrCode }}</span> 让步接收 {{ b.qty }} 件 · {{ b.kind }} <span class="font-mono">{{ b.docNo }}</span> · 批准人 {{ b.approver }}</div></div>
      </div>
    </div>

    <div class="xl:col-span-4 space-y-4">
      <div class="card p-5 space-y-3">
        <h3 class="section-title !text-[14px]">批次</h3>
        <kv k="投入的物料批次" :v="(o.inLots || []).join('、') || '未登记'"/>
        <kv k="产出的成品批次" :v="o.outLot || '未登记'"/>
        <button class="link text-xs" @click="openLots">修改批次</button>
      </div>
      <div class="card p-5">
        <h3 class="section-title !text-[14px] mb-2">主线记录</h3>
        <div v-for="(a,i) in audit" :key="i" class="py-1.5 border-b border-black/[0.04] last:border-0"><div class="text-[12.5px] text-ink-2 leading-relaxed">{{ a.text }}</div><div class="text-[11px] text-ink-4">{{ userName(a.uid) }} · {{ fmtTime(a.at) }} · {{ a.obj }}</div></div>
        <div v-if="!audit.length" class="text-[12px] text-ink-4">暂无记录</div>
      </div>
    </div>
  </div>

  <modal :open="lotEdit.open" @close="lotEdit.open = false" title="物料批次" sub="来料检验、出货检验按批次关联到这张工单，从客户投诉可以一路追到来料批次" width="max-w-md">
    <div class="space-y-4"><div><label class="label">投入的物料批次（多个用逗号分开）</label><input v-model="lotEdit.inLots" class="input font-mono"></div><div><label class="label">产出的成品批次</label><input v-model="lotEdit.outLot" class="input font-mono"></div></div>
    <template #footer><button class="btn-secondary" @click="lotEdit.open = false">取消</button><g-btn perm="order.create" cls="btn-primary" icon="check" @click="saveLots">保存</g-btn></template>
  </modal>
</div>
<empty v-else icon="factory" title="工单不存在"><button class="btn-secondary" @click="go('/workbench')">回到生产主线</button></empty>`,
};

/* =====================================================================
 * 领域动作（各页面共用；正式系统中对应后端领域命令，带幂等键与版本校验）
 *   createTask / createRetestRound / submitRound / createNcr
 * 约定：动作失败时抛出 Error（message 为可直接展示的中文原因），调用方 try/catch 后 toast。
 * ===================================================================== */

const TASK_PREFIX = { IQC: 'IQC', FIRST: 'FAI', IPQC: 'IPQC', FQC: 'FQC', OQC: 'OQC' };

function taskCodeFor(scene) {
  const head = TASK_PREFIX[scene] + '-' + dateCode() + '-';
  let n = S.tasks.filter((t) => t.code.indexOf(head) === 0).length + 1;
  while (S.tasks.some((t) => t.code === head + String(n).padStart(3, '0'))) n++;
  return head + String(n).padStart(3, '0');
}

/** 可用于某零件、某场景的生效方案 */
function plansFor(partId, scene) {
  return S.plans.filter((p) => p.status === 'effective' && (!partId || p.partId === partId) && (!scene || p.scenes.includes(scene)));
}

/** 新建检验任务：冻结“场景定义 + 标准修订 + 方案修订”三层快照（建单不可改技术规则） */
function createTask(o) {
  const plan = planOf(o.planId);
  if (!plan || plan.status !== 'effective') throw new Error('只能采用生效的检验方案');
  if (!plan.scenes.includes(o.scene)) throw new Error('该方案不适用于所选检验场景');
  const scene = sceneOf(o.scene);
  if (!scene.enabled) throw new Error('该检验场景已停用，不能新建任务');
  const cg = plan.groups.find((g) => g.type === 'count');
  const lot = String(o.lot == null ? '' : o.lot).trim();
  if (cg && !/^[1-9]\d*$/.test(lot)) throw new Error('方案含计数抽样组，需填写整数件制的批量');
  if (lot && !/^\d+$/.test(lot)) throw new Error('批量须为整数');
  const t = {
    id: 't' + nextSeq(), code: taskCodeFor(o.scene), scene: o.scene, partId: plan.partId, planId: plan.id, lot: lot ? parseInt(lot, 10) : 0,
    ctx: clone(o.ctx || {}), assignee: o.assignee || S.me, due: o.due || hoursFromNow(8), status: 'pending', rounds: [], reportIds: [], createdAt: nowISO(), createdBy: S.me,
  };
  t.snap = buildSnapshot(S, plan, o.scene);
  if (!t.snap.items.length) throw new Error('该方案没有分配任何检验特性');
  t.rounds.push(newRound(t, 1));
  S.tasks.unshift(t);
  logAudit('检验', t.code, '新建' + scene.name + '任务，冻结快照：场景 v' + t.snap.scene.ver + ' / ' + t.snap.std.code + ' Rev ' + t.snap.std.rev + ' / ' + t.snap.plan.code + ' Rev ' + t.snap.plan.rev);
  return taskOf(t.id);
}

/** 复检 = 新轮次：记录父轮次与原因；可选原样本子集或新取样本；原失败永远保留（V3 §6.4，A09） */
function createRetestRound(task, o) {
  o = o || {};
  const last = task.rounds[task.rounds.length - 1];
  if (!last || last.status !== 'submitted') throw new Error('上一轮尚未提交，不能发起复检');
  const reason = String(o.reason || '').trim();
  if (!reason) throw new Error('请填写复检原因');
  const hasMeasure = task.snap.groups.some((g) => g.type === 'measure');
  let samples;
  if (o.sampleMode === 'subset') {
    samples = (o.samples || []).filter((s) => last.samples.includes(s));
    if (hasMeasure && !samples.length) throw new Error('请选择要复检的原样本');
  }
  const r = newRound(task, last.no + 1, { parent: last.id, reason, sampleMode: o.sampleMode === 'subset' ? 'subset' : 'new', samples: samples && samples.length ? samples : undefined });
  r.ncrId = o.ncrId || '';
  task.rounds.push(r);
  task.status = 'active';
  logAudit('检验', task.code, '发起复检第 ' + r.no + ' 轮（' + (r.sampleMode === 'subset' ? '原样本子集：' + r.samples.join('、') : '新取样本') + '）：' + reason);
  return task.rounds[task.rounds.length - 1];
}

/** 拍照要求（场景参数）：返回尚未满足拍照要求的特性 */
function photoViolations(task, round, ev) {
  const sc = task.snap.scene, pol = sc.photo || 'none';
  if (!sc.steps.includes('photo') || pol === 'none') return [];
  const has = (cid) => round.photos.some((p) => p.cid === cid);
  return task.snap.items.filter((it) => {
    if (has(it.cid)) return false;
    if (pol === 'onDefect') return !!ev.byCid[it.cid] && ev.byCid[it.cid].status === 'ng';
    if (pol === 'appearance') return it.cat === '外观';
    return false;
  });
}

/** 是否需要报告复核（按场景策略；未配置复核步骤则不产生任何批准） */
function reviewNeeded(task, status) {
  const sc = task.snap.scene;
  return sc.steps.includes('review') && (sc.review === 'always' || (sc.review === 'onFail' && status === 'fail'));
}

/** 签名提交本轮：完整性检查 → 判定 → 冻结报告 → 按策略进入复核 */
function submitRound(task, round, o) {
  o = o || {};
  if (round.status !== 'active') throw new Error('该轮次已提交，不能重复提交');
  const ev = evalRound(task, round);
  if (ev.c && ev.c.dInvalid) throw new Error(ev.c.dInvalid);
  const pv = photoViolations(task, round, ev);
  if (pv.length) throw new Error('拍照要求未满足：' + pv.map((i) => '#' + i.no + ' ' + i.name).join('、'));
  if (ev.overall === 'incomplete') {
    if (!task.snap.scene.allowInsufficient) throw new Error('存在缺失项，当前场景不允许以“证据不足”提交');
    const why = String(o.missingReason || '').trim();
    if (!why) throw new Error('存在缺失项：请补测，或填写缺失原因后以“证据不足”提交');
    round.missingReason = why;
  }
  const needSign = task.snap.scene.steps.includes('sign');
  if (needSign && !o.sigImg) throw new Error('请先手写签名');
  round.status = 'submitted';
  round.submittedAt = nowISO();
  round.result = summarizeEval(ev);
  task.status = ev.overall === 'fail' ? 'fail' : ev.overall === 'pass' ? 'pass' : 'insufficient';
  const rep = buildReport(S, task, round, 'RPT-' + task.code + (round.no > 1 ? '-R' + round.no : ''));
  round.signer = { uid: S.me, name: me.value.name, img: o.sigImg || '', at: round.submittedAt, hash: rep.hash };
  if (needSign) rep.sigs.push(Object.assign({ kind: '检验' }, round.signer));
  rep.state = reviewNeeded(task, task.status) ? 'review' : 'frozen';
  S.reports.unshift(rep);
  task.reportIds.push(rep.id);
  const txt = { pass: '符合', fail: '不符合', insufficient: '证据不足' }[task.status];
  logAudit('检验', task.code, '签名提交第 ' + round.no + ' 轮：' + txt + (ev.c ? '；计数组 d=' + ev.c.d + '（Ac ' + ev.c.ac + ' / Re ' + ev.c.re + '）' + STATUS.result[ev.c.result][0] : '') + '；报告 ' + rep.code + (rep.state === 'review' ? ' 待复核' : ' 已冻结'));
  return S.reports.find((x) => x.id === rep.id);
}

/** 报告签名是否仍然有效：签名时的内容摘要须等于报告当前内容摘要（A13） */
function sigValid(rep, sig) { return !!sig && sig.hash === hashOf(rep.content); }

/** 复核签批：复核人不得为本轮签名人（A14）；不合格报告也可以被批准——批准的是报告如实，不改变结论（A12） */
function approveReport(rep, sigImg) {
  if (rep.state !== 'review') throw new Error('报告不在待复核状态');
  if (!can('report.review')) throw new Error(denyTip('report.review'));
  if (rep.sigs.some((s) => s.kind === '检验' && s.uid === S.me)) throw new Error('复核人不得为本轮签名人');
  if (!sigImg) throw new Error('请先手写签名');
  rep.sigs.push({ kind: '复核', uid: S.me, name: me.value.name, img: sigImg, at: nowISO(), hash: rep.hash });
  rep.state = 'approved';
  logAudit('报告', rep.code, '复核通过并签批（内容摘要 ' + rep.hash + '）');
}
function returnReport(rep, opinion) {
  if (rep.state !== 'review') throw new Error('报告不在待复核状态');
  if (!can('report.review')) throw new Error(denyTip('report.review'));
  const text = String(opinion || '').trim();
  if (!text) throw new Error('请填写退回意见');
  rep.opinions = rep.opinions || [];
  rep.opinions.push({ uid: S.me, at: nowISO(), text });
  rep.state = 'frozen';
  logAudit('报告', rep.code, '复核退回：' + text);
}
/** 退回后重新提请复核 */
function resubmitReport(rep) {
  if (rep.state !== 'frozen' || !(rep.opinions && rep.opinions.length)) throw new Error('只有被退回的报告可以重新提请复核');
  rep.state = 'review';
  logAudit('报告', rep.code, '重新提请复核');
}

/** 登记不合格（NCR）：只登记本次事实；NCR 不自动冻结整批（质量限制需单独建立） */
function createNcr(o) {
  const title = String(o.title || '').trim();
  if (!title) throw new Error('请填写不合格标题');
  if (!o.partId) throw new Error('请选择零件');
  const year = new Date().getFullYear();
  const maxNo = Math.max(0, ...S.ncrs.map((n) => parseInt(n.code.slice(-4), 10) || 0));
  const task = o.taskId ? taskOf(o.taskId) : null;
  const round = task && o.roundId ? task.rounds.find((r) => r.id === o.roundId) : null;
  const n = {
    id: 'n' + nextSeq(), code: 'NCR-' + year + '-' + String(maxNo + 1).padStart(4, '0'), title, severity: o.severity || '一般', status: 'registered',
    partId: o.partId, batch: o.batch || '', taskId: o.taskId || '', roundId: o.roundId || '', cids: (o.cids || []).slice(), desc: o.desc || '',
    qtySuspect: parseInt(o.qtySuspect, 10) || 0, qtyConfirmed: 0, createdBy: S.me, createdAt: nowISO(), photos: (o.photos || []).slice(), disp: [], holds: [],
    log: [{ at: nowISO(), by: S.me, text: '登记不合格' + (task ? '（来源：' + task.code + (round ? ' 第 ' + round.no + ' 轮' : '') + '）' : '（现场发现）') }],
  };
  S.ncrs.unshift(n);
  logAudit('NCR', n.code, '登记不合格：' + title);
  return S.ncrs.find((x) => x.id === n.id);
}
function ncrsOfTask(taskId) { return S.ncrs.filter((n) => n.taskId === taskId); }

/** 任务上下文摘要（列表与报告共用） */
function ctxText(task) {
  const c = task.ctx || {};
  return ['supplier', 'customer', 'receipt', 'shipment', 'wo', 'op', 'machine', 'freq', 'batch'].filter((k) => c[k]).map((k) => (CTX_FIELDS[k] ? CTX_FIELDS[k].label + ' ' : '') + c[k]).join(' · ');
}
/** 任务当前轮次与进度 */
function currentRound(task) { return task.rounds[task.rounds.length - 1]; }
function taskProgress(task) { const r = currentRound(task); if (!r) return 0; if (r.status === 'submitted') return 1; return evalRound(task, r).progress; }

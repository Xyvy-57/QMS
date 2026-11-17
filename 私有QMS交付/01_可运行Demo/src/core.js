/* Worlder QMS local demonstration domain model. No network or device connection. */
(function (root) {
  'use strict';
  const STORAGE_KEY = 'worlder-qms-local-v1';
  const SCENARIOS = ['IQC', 'FIRST', 'IPQC', 'FQC', 'OQC'];
  // This seed-only bitmap visibly reads “DEMO SIGN”; it is never used for user signatures.
  const DEMO_SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAABGCAIAAAD5Bz6qAAABUElEQVR42u3cMQ6DMAxAUQ7Ezs797wQnQCKKrTjJ++pUVdAav6VUPR5JQzuMQIJQglAShBKEkiCUIJQEoQShJAglCCVBKEEoCUIJQkkQShBKglCCUNKCCM/rbnpEHefrmH/O1fr6ns9VbeZRc46aT8b1ghBCCCGEEEIIIYQQQgjHLETP66OG27OIlZej2vEzrnsGWgghhBBCCCGEEEIIIYRwX4QZz0NY83pBCCGEEEIIIYQQQgghhOsgzLj5OzvC1llVvo6t563wAwkIIYQQQgghhBBCCCGEcO4vZrLfT7XlGHXzfbc5Q2g5IIQQQgghhNByQAghhBBCCKHlgBBCCCGEEELLASGE/uhppzlHzQdCCCGEEEIIIYQQQgghnBuhJAglCCVBKEEoQSgJQglCSRBKEEqCUIJQEoQShJIglCCUBKEEoSQIJQglQShBKCm1F60IjhiAMpyZAAAAAElFTkSuQmCC';
  const db = {};
  let serial = 0;
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const now = () => new Date().toISOString();
  const uid = prefix => `${prefix || 'ID'}-${Date.now().toString(36)}-${(++serial).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const empty = value => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
  const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);
  const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value) && !RESERVED_IDS.has(value);
  function assertId(value, label) {
    if (!validId(value)) throw new Error(`${label || '对象'}编号必须是 1–128 字符的非空字符串，且不能使用保留名称。`);
  }
  function dictionary(source) {
    const result = Object.create(null);
    if (source && typeof source === 'object') Object.entries(source).forEach(([key, value]) => { result[key] = value; });
    return result;
  }
  function validateStandardIds(standard) {
    if (!standard || typeof standard !== 'object') throw new Error('检验标准不存在。');
    assertId(standard.id, '标准');
    assertId(standard.drawingId, '图纸');
    if (!Array.isArray(standard.items)) throw new Error('检验标准的项目必须为列表。');
    standard.items.forEach(item => { if (!item || typeof item !== 'object') throw new Error('检验项目无效。'); assertId(item.id, '检验项目'); });
    if (new Set(standard.items.map(item => item.id)).size !== standard.items.length) throw new Error('检验项目编号不能重复。');
  }

  // Parse decimals as scaled integers. Inclusive specification boundaries never use floats.
  function decimal(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const input = String(value).trim();
    if (input.length > 400) return null;
    const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(input);
    if (!match) return null;
    const fraction = match[3] || match[4] || '';
    const exponent = Number(match[5] || 0);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 308) return null;
    let scale = fraction.length - exponent;
    let integer = BigInt((match[1] === '-' ? '-' : '') + (match[2] || '0') + fraction);
    if (scale < 0) { integer *= 10n ** BigInt(-scale); scale = 0; }
    return { integer, scale };
  }
  function compare(a, b) {
    const scale = Math.max(a.scale, b.scale);
    const x = a.integer * 10n ** BigInt(scale - a.scale);
    const y = b.integer * 10n ** BigInt(scale - b.scale);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  function evaluate(item, value) {
    if (empty(value)) return 'pending';
    if (!item || !['number', 'attribute'].includes(item.kind)) return 'invalid';
    if (item.kind === 'attribute') {
      const text = String(value).trim().toLowerCase();
      if (['合格', 'pass', 'ok', '符合', 'true'].includes(text)) return 'pass';
      if (['不合格', 'ng', 'fail', '不符合', 'false'].includes(text)) return 'ng';
      return 'invalid';
    }
    const number = decimal(value);
    const lower = empty(item.lower) ? null : decimal(item.lower);
    const upper = empty(item.upper) ? null : decimal(item.upper);
    if (!number || (!empty(item.lower) && !lower) || (!empty(item.upper) && !upper) || (!lower && !upper)) return 'invalid';
    if (lower && upper && compare(lower, upper) > 0) return 'invalid';
    if ((lower && compare(number, lower) < 0) || (upper && compare(number, upper) > 0)) return 'ng';
    return 'pass';
  }
  function getTask(id) { return db.tasks.find(task => task.id === id); }
  function getRound(task) { return task && task.rounds.find(round => round.id === task.activeRoundId); }
  function technical(task, round) {
    round = round || getRound(task);
    const summary = { status: 'pending', total: 0, filled: 0, valid: 0, pending: 0, pass: 0, ng: 0, invalid: 0, progress: 0, items: [] };
    if (!task || !round) return summary;
    const defaultCount = Number.isInteger(round.sampleCount) && round.sampleCount > 0 ? round.sampleCount : 3;
    const specifications = task.standardSnapshot && task.standardSnapshot.items || [];
    summary.items = specifications.map(item => {
      const requestedCount = round.itemSampleCounts && round.itemSampleCounts[item.id];
      const count = Number.isSafeInteger(requestedCount) && requestedCount > 0 ? requestedCount : defaultCount;
      const stored = round.measurements && round.measurements[item.id] || [];
      const values = Array.from({ length: count }, (_, index) => stored[index] ?? '');
      const results = values.map(value => evaluate(item, value));
      results.forEach(result => { summary.total++; summary[result]++; });
      const status = results.includes('invalid') ? 'invalid' : results.includes('ng') ? 'ng' : results.includes('pending') ? 'pending' : 'pass';
      return { item, itemId: item.id, status, sampleCount: count, values, results };
    });
    summary.filled = summary.total - summary.pending;
    summary.valid = summary.pass + summary.ng;
    summary.progress = summary.total ? Math.round(summary.valid / summary.total * 100) : 0;
    summary.status = summary.invalid ? 'invalid' : summary.ng ? 'ng' : summary.pending || !summary.total ? 'pending' : 'pass';
    summary.itemCount = summary.items.length;
    summary.completedItems = summary.items.filter(item => item.results.every(result => result === 'pass' || result === 'ng')).length;
    return summary;
  }
  function log(action, targetId, detail) {
    db.activity.unshift({ id: uid('LOG'), action, targetId, detail, createdAt: now(), source: '本地演示' });
    if (db.activity.length > 250) db.activity.length = 250;
  }
  function save() {
    db.tasks.forEach(task => { task.progress = technical(task).progress; });
    db.updatedAt = now();
    try {
      if (!root.localStorage) throw new Error('当前环境无法使用本地存储，修改仅保留在当前页面。');
      root.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
      if (root.QMS) root.QMS.lastSaveError = null;
      return true;
    } catch (error) {
      const message = '本地保存失败，请导出备份后再关闭页面。' + (error && error.message ? ' ' + error.message : '');
      if (root.QMS) root.QMS.lastSaveError = message;
      try {
        if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') root.dispatchEvent(new root.CustomEvent('qms-storage-error', { detail: { message, errorName: error && error.name || 'StorageError' } }));
      } catch (_) { /* Storage failure reporting must not interrupt local work. */ }
      return false;
    }
  }
  function newRound(task, reason) {
    const previous = getRound(task);
    const sourceCounts = task.itemSampleCounts || (previous && previous.itemSampleCounts) || {};
    const itemSampleCounts = dictionary();
    task.standardSnapshot.items.forEach(item => {
      assertId(item.id, '检验项目');
      const count = Object.prototype.hasOwnProperty.call(sourceCounts, item.id) ? sourceCounts[item.id] : previous && previous.sampleCount || 3;
      if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new Error('检验项目的样本数无效。');
      itemSampleCounts[item.id] = count;
    });
    const round = { id: uid('ROUND'), reason: reason || '首次检验', createdAt: now(), itemSampleCounts, sampleCount: Math.max(...Object.values(itemSampleCounts)), measurements: dictionary(), photos: [], signatures: {}, status: 'draft' };
    task.standardSnapshot.items.forEach(item => { round.measurements[item.id] = Array(itemSampleCounts[item.id]).fill(''); });
    return round;
  }
  function validateStandard(standard) {
    if (!standard || standard.status !== 'published') throw new Error('请选择已发布的检验标准。');
    validateStandardIds(standard);
    if (!standard.items || !standard.items.length) throw new Error('检验标准至少需要一个检验项目。');
    if (new Set(standard.items.map(item => item.id)).size !== standard.items.length) throw new Error('检验项目编号不能重复。');
    standard.items.forEach(item => {
      if (!item.verified) throw new Error(`气泡 #${item.balloon} 尚未复核。`);
      if (item.kind === 'attribute') return;
      const lower = empty(item.lower) ? null : decimal(item.lower);
      const upper = empty(item.upper) ? null : decimal(item.upper);
      if (item.kind !== 'number' || (!lower && !upper) || (!empty(item.lower) && !lower) || (!empty(item.upper) && !upper) || (lower && upper && compare(lower, upper) > 0)) throw new Error(`气泡 #${item.balloon} 的限值无效。`);
    });
  }
  function validatePlan(plan, standard) {
    if (!plan || !Array.isArray(plan.nodes) || !plan.nodes.length || !Array.isArray(plan.edges)) throw new Error('流程必须包含工序节点与连接关系。');
    if (!standard || !Array.isArray(standard.items)) throw new Error('流程关联的检验标准不存在。');
    validateStandardIds(standard);
    assertId(plan.id, '流程');
    if (plan.standardId !== undefined && plan.standardId !== null) assertId(plan.standardId, '关联标准');
    if (plan.standardId && plan.standardId !== standard.id) throw new Error('流程绑定的检验标准与当前标准不一致。');
    if (!SCENARIOS.includes(plan.scenario)) throw new Error('流程检验类型无效。');
    const knownItems = new Set(standard.items.map(item => item.id));
    const nodeIds = new Set(), adjacency = new Map(), indegree = new Map(), neighbours = new Map();
    const itemSampleCounts = dictionary();
    for (const node of plan.nodes) {
      if (!node) throw new Error('工序节点无效。');
      assertId(node.id, '工序节点');
      assertId(node.stepId, '工序组件');
      if (nodeIds.has(node.id)) throw new Error('工序节点编号必须存在且唯一。');
      nodeIds.add(node.id); adjacency.set(node.id, []); indegree.set(node.id, 0); neighbours.set(node.id, []);
      if (!db.steps.some(step => step.id === node.stepId)) throw new Error(`工序「${node.name || node.id}」引用的工序组件不存在。`);
      if (!Array.isArray(node.itemIds)) throw new Error(`工序「${node.name || node.id}」的检验项目必须为列表。`);
      const count = Number(node.sampleCount);
      if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new Error(`工序「${node.name || node.id}」的样本数须为 1–100 的整数。`);
      for (const itemId of node.itemIds) {
        assertId(itemId, '关联检验项目');
        if (!knownItems.has(itemId)) throw new Error(`工序「${node.name || node.id}」引用了不存在的检验项目。`);
        itemSampleCounts[itemId] = Math.max(itemSampleCounts[itemId] || 0, count);
      }
    }
    const seenEdges = new Set();
    for (const edge of plan.edges) {
      if (!edge) throw new Error('流程连接无效。');
      assertId(edge.source, '连接起点'); assertId(edge.target, '连接终点');
      if (!edge || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) throw new Error('流程连接引用了不存在的节点。');
      if (edge.source === edge.target) throw new Error('工序节点不能连接到自身。');
      const edgeKey = JSON.stringify([edge.source, edge.target]);
      if (seenEdges.has(edgeKey)) throw new Error('流程存在重复连接。');
      seenEdges.add(edgeKey);
      adjacency.get(edge.source).push(edge.target);
      indegree.set(edge.target, indegree.get(edge.target) + 1);
      neighbours.get(edge.source).push(edge.target); neighbours.get(edge.target).push(edge.source);
    }
    const ready = Array.from(nodeIds).filter(id => indegree.get(id) === 0);
    let visitedCount = 0;
    for (let index = 0; index < ready.length; index++) {
      visitedCount++;
      for (const next of adjacency.get(ready[index])) {
        indegree.set(next, indegree.get(next) - 1);
        if (indegree.get(next) === 0) ready.push(next);
      }
    }
    if (visitedCount !== nodeIds.size) throw new Error('流程存在循环，请使用有向无环的工序关系。');
    const connected = new Set(), queue = [plan.nodes[0].id];
    while (queue.length) {
      const id = queue.pop();
      if (connected.has(id)) continue;
      connected.add(id); queue.push(...neighbours.get(id));
    }
    if (connected.size !== nodeIds.size) throw new Error('流程存在未连接的工序，请连接后再发布。');
    const itemIds = standard.items.filter(item => itemSampleCounts[item.id]).map(item => item.id);
    if (!itemIds.length) throw new Error('流程至少需要关联一个检验项目。');
    return { itemIds, itemSampleCounts, sampleCount: Math.max(...Object.values(itemSampleCounts)) };
  }
  function createTask(input) {
    const { standardId, scenario, batch, quantity, planId, inspector = '', reviewRequired = false } = input || {};
    assertId(standardId, '标准');
    if (planId !== undefined && planId !== null && planId !== '') assertId(planId, '流程');
    const standard = db.standards.find(item => item.id === standardId);
    validateStandard(standard);
    if (!SCENARIOS.includes(scenario)) throw new Error('请选择有效的检验类型。');
    if (!String(batch || '').trim()) throw new Error('请填写批次号。');
    if (!Number.isSafeInteger(Number(quantity)) || Number(quantity) < 1) throw new Error('批量必须为正整数。');
    const plan = planId ? db.plans.find(item => item.id === planId) : null;
    if (planId && (!plan || plan.status !== 'published')) throw new Error('请选择已发布的工艺流程。');
    if (plan && plan.standardId && plan.standardId !== standardId) throw new Error('流程绑定的检验标准与当前标准不一致。');
    if (plan && plan.scenario !== scenario) throw new Error('流程检验类型与任务类型不一致。');
    const selection = plan ? validatePlan(plan, standard) : { itemIds: standard.items.map(item => item.id), itemSampleCounts: Object.fromEntries(standard.items.map(item => [item.id, 3])), sampleCount: 3 };
    if (selection.sampleCount > Number(quantity)) throw new Error(`计划样本数 ${selection.sampleCount} 不得超过批量 ${quantity}。`);
    const standardSnapshot = clone(standard);
    standardSnapshot.items = standardSnapshot.items.filter(item => selection.itemIds.includes(item.id));
    const task = {
      id: uid(scenario), standardId, planId: planId || null, scenario, batch: String(batch).trim(), quantity: Number(quantity),
      inspector: String(inspector).trim(), reviewRequired: Boolean(reviewRequired), createdAt: now(), progress: 0,
      standardSnapshot, planSnapshot: clone(plan), itemSampleCounts: dictionary(selection.itemSampleCounts), rounds: [], activeRoundId: null,
      source: '本地演示数据', batchDecision: '未判批', decisionMode: 'measurement'
    };
    const round = newRound(task, '首次检验');
    task.rounds.push(round); task.activeRoundId = round.id;
    db.tasks.unshift(task);
    log('创建检验任务', task.id, `${scenario} / ${task.batch}；已冻结标准与流程快照`);
    save();
    return task;
  }
  function addRound(taskId, reason) {
    const task = getTask(taskId);
    if (!task) throw new Error('检验任务不存在。');
    const active = getRound(task);
    if (!active || active.status !== 'completed') throw new Error('请先完成当前检验轮次，再发起复检。');
    if (!String(reason || '').trim()) throw new Error('请填写复检原因。');
    const round = newRound(task, String(reason).trim());
    task.rounds.push(round); task.activeRoundId = round.id; task.progress = 0;
    log('发起复检', task.id, round.reason);
    save();
    return round;
  }
  function hasSignature(value) {
    if (!value || typeof value.name !== 'string' || !value.name.trim() || typeof value.dataUrl !== 'string') return false;
    const match = /^data:image\/png;base64,(iVBORw0KGgo[A-Za-z0-9+/]*={0,2})$/.exec(value.dataUrl);
    if (!match || match[1].length < 80 || match[1].length % 4 !== 0) return false;
    try {
      const bytes = typeof root.atob === 'function' ? root.atob(match[1]) : typeof Buffer !== 'undefined' ? Buffer.from(match[1], 'base64').toString('binary') : '';
      return bytes.length >= 57 && bytes.slice(12, 16) === 'IHDR' && bytes.slice(-8, -4) === 'IEND';
    } catch (_) { return false; }
  }
  function completeRound(taskId, roundId) {
    const task = getTask(taskId);
    if (!task) return { ok: false, error: '检验任务不存在。' };
    const round = roundId ? task.rounds.find(item => item.id === roundId) : getRound(task);
    if (!round) return { ok: false, error: '检验轮次不存在。' };
    if (round.status === 'completed') return { ok: true, task, round, report: db.reports.find(report => report.taskId === task.id && report.roundId === round.id), alreadyCompleted: true };
    const result = technical(task, round);
    if (!result.total) return { ok: false, error: '当前标准没有检验项目。' };
    if (result.pending) return { ok: false, error: `还有 ${result.pending} 个实测值未填写。` };
    if (result.invalid) return { ok: false, error: `有 ${result.invalid} 个实测值格式无效，请修正。` };
    if (!hasSignature(round.signatures.inspector)) return { ok: false, error: '请完成检验员签名。' };
    if (task.reviewRequired && !hasSignature(round.signatures.reviewer)) return { ok: false, error: '该任务需要审核员签名。' };
    if (task.reviewRequired && round.signatures.reviewer.name.trim() === round.signatures.inspector.name.trim()) return { ok: false, error: '独立审核的审核员与检验员不能是同一人。' };
    round.status = 'completed'; round.completedAt = now(); round.result = result.status;
    const report = {
      id: uid('RPT'), taskId: task.id, roundId: round.id, createdAt: now(), scenario: task.scenario, batch: task.batch,
      standardSnapshot: clone(task.standardSnapshot), planSnapshot: clone(task.planSnapshot), roundSnapshot: clone(round),
      result: result.status, technical: clone(result), quantity: task.quantity, inspector: task.inspector,
      batchDecision: '未判批', source: '本地演示数据', signatureNotice: '本地演示签名，非认证电子签章',
      taskSnapshot: clone(task)
    };
    db.reports.unshift(report);
    log('完成检验', task.id, result.status === 'ng' ? '已记录不合格实测结果，待异常处置；未自动判批' : '所测样本符合限值；未自动判批');
    save();
    return { ok: true, task, round, report };
  }
  function createNcr(taskId, roundId) {
    const task = getTask(taskId);
    if (!task) throw new Error('检验任务不存在。');
    const round = roundId ? task.rounds.find(item => item.id === roundId) : getRound(task);
    if (!round) throw new Error('检验轮次不存在。');
    const result = technical(task, round);
    const failed = result.items.filter(item => item.results.includes('ng'));
    if (!failed.length) throw new Error('当前轮次没有不合格实测值，无需生成异常单。');
    const existing = db.ncrs.find(item => item.taskId === task.id && item.roundId === round.id);
    if (existing) return existing;
    const createdAt = now();
    const ncr = {
      id: uid('NCR'), taskId: task.id, roundId: round.id,
      title: `${task.standardSnapshot.name}：${failed.map(item => '#' + item.item.balloon + ' ' + item.item.name).join('、')}`,
      status: 'open', owner: '质量工程师', due: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      dispositions: [], events: [{ action: '创建异常单', text: '根据当前轮次不合格实测值建立异常记录。', createdAt }],
      failures: clone(failed), createdAt, source: '本地演示数据'
    };
    db.ncrs.unshift(ncr); log('创建异常单', ncr.id, `${task.id} / ${round.id}`); save();
    return ncr;
  }
  function seed() {
    Object.keys(db).forEach(key => { delete db[key]; });
    Object.assign(db, { schemaVersion: 1, source: '本地演示数据', drawings: [], standards: [], steps: [], plans: [], tasks: [], ncrs: [], reports: [], activity: [], settings: { bubbleUrl: 'https://223.106.198.62:3080/#/drawing-packages', dataMode: 'local-demo' } });
    const drawingSeeds = [
      ['valve', '01系列阀芯', '1.2020.01.1', 'DWG-2026-011', 'A3', '演示客户 A'],
      ['shaft', '01系列轴1-1', '1.2020.01.2', 'DWG-2026-018', 'B1', '演示客户 B'],
      ['drill', 'CP钻头组件', '20.0363.02', 'DWG-2026-092', 'A2', '演示客户 C']
    ];
    db.drawings = drawingSeeds.map(([id, name, partNo, code, revision, customer]) => ({ id, name, partNo, code, revision, customer, status: 'approved', source: '本地演示数据' }));
    const characteristics = {
      valve: [
        ['1-1轴直径', '20.00', '19.90', '20.10', 'mm', '三坐标 CMM', 'CTQ', 78, 150],
        ['1-1轴长', '12.00', '11.95', '12.05', 'mm', '数显卡尺', 'NORMAL', 170, 92],
        ['1-2轴长', '36.00', '35.90', '36.10', 'mm', '三坐标 CMM', 'NORMAL', 340, 86],
        ['3-1支撑杆高', '25.08', '25.05', '25.10', 'mm', '三坐标 CMM', 'CC', 575, 220],
        ['镀层厚度', '0.360', '0.350', null, 'mm', 'X 射线膜厚仪', 'CTQ', 325, 58],
        ['拉力测试', '660000', '600000', '700000', 'N', '万能拉力计', 'CTQ', 485, 398],
        ['抗拉强度', '2100', '2000', '2285', 'N/mm²', '万能拉力计', 'CC', 485, 428],
        ['定子外观', '合格', null, null, '', '目视检查', 'CTQ', 640, 122, 'attribute'],
        ['转子缺陷数', '0', '0', '1', '个', '目视计数', 'CC', 752, 145],
        ['螺旋焊缝划伤', '合格', null, null, '', '工业内窥镜', 'CTQ', 265, 270, 'attribute']
      ],
      shaft: [
        ['主轴外径', '18.00', '17.92', '18.08', 'mm', '数显千分尺', 'CTQ', 120, 165],
        ['台阶总长', '48.00', '47.85', '48.15', 'mm', '数显卡尺', 'CC', 310, 95],
        ['同轴度公差', '0.015', '0', '0.025', 'mm', '三坐标 CMM', 'CTQ', 685, 120],
        ['表面粗糙度 Ra', '0.80', '0', '1.60', 'μm', '粗糙度仪', 'NORMAL', 460, 135]
      ],
      drill: [
        ['刃口直径', '10.00', '9.96', '10.04', 'mm', '三坐标 CMM', 'CTQ', 140, 170],
        ['洛氏硬度 HRC', '62.0', '60.0', '64.0', 'HRC', '数显洛氏硬度计', 'CTQ', 375, 110],
        ['端面跳动', '0.010', '0', '0.020', 'mm', '三坐标 CMM', 'CC', 685, 135]
      ]
    };
    db.standards = db.drawings.map(drawing => ({
      id: 'STD-' + drawing.id, drawingId: drawing.id, name: drawing.name + '检验标准', revision: '1.0', status: 'published', source: '本地演示数据',
      items: characteristics[drawing.id].map((row, index) => ({ id: drawing.id + '-' + (index + 1), balloon: index + 1, name: row[0], nominal: row[1], lower: row[2], upper: row[3], unit: row[4], method: row[5], level: row[6], x: row[7], y: row[8], kind: row[9] || 'number', verified: true }))
    }));
    db.steps = [
      { id: 'step-receive', name: '来料核验', type: 'input', role: '检验员', description: '核对图号、版本、物料与批次，确认检验准备完成。' },
      { id: 'step-dimension', name: '尺寸检验', type: 'measurement', role: '计量员', description: '按工序关联的特性逐项录入实测结果。' },
      { id: 'step-surface', name: '外观与理化检验', type: 'measurement', role: '检验员', description: '完成外观、材料性能或表面质量检查。' },
      { id: 'step-review', name: '质量复核', type: 'review', role: '质量工程师', description: '复核测量完整性，签署检验记录，超差转入异常处理。' },
      { id: 'step-report', name: '报告归档', type: 'output', role: '质量主管', description: '形成版本化记录，归档证据，批次处置单独审批。' }
    ];
    db.plans = db.standards.map((standard, index) => {
      const prefix = 'PLAN-' + standard.drawingId;
      const ids = standard.items.map(item => item.id);
      const splitAt = standard.drawingId === 'valve' ? 4 : 2;
      return {
        id: prefix, name: ['精密机加工全流程', '轴类首件确认流程', '刀具出货检验流程'][index], revision: '1.0', status: 'published', standardId: standard.id,
        scenario: ['IQC', 'FIRST', 'OQC'][index], source: '本地演示数据',
        nodes: [
          { id: prefix + '-1', stepId: 'step-receive', name: '来料核验', role: '检验员', itemIds: [], sampleCount: 3 },
          { id: prefix + '-2', stepId: 'step-dimension', name: '尺寸检验', role: '计量员', itemIds: ids.slice(0, splitAt), sampleCount: 3 },
          { id: prefix + '-3', stepId: 'step-surface', name: '外观与理化检验', role: '检验员', itemIds: ids.slice(splitAt), sampleCount: 3 },
          { id: prefix + '-4', stepId: 'step-review', name: '质量复核', role: '质量工程师', itemIds: [], sampleCount: 3 },
          { id: prefix + '-5', stepId: 'step-report', name: '报告归档', role: '质量主管', itemIds: [], sampleCount: 3 }
        ],
        edges: [[1, 2], [1, 3], [2, 4], [3, 4], [4, 5]].map(([source, target]) => ({ source: prefix + '-' + source, target: prefix + '-' + target }))
      };
    });
    [['valve', 'IPQC', '机加工过程巡检流程'], ['shaft', 'FQC', '轴类完工检验流程']].forEach(([key, scenario, name]) => {
      const plan = clone(db.plans.find(item => item.id === 'PLAN-' + key));
      plan.id += '-' + scenario; plan.name = name; plan.scenario = scenario;
      const nodeIds = new Map(plan.nodes.map(node => [node.id, node.id + '-' + scenario]));
      plan.nodes.forEach(node => { node.id = nodeIds.get(node.id); });
      plan.edges.forEach(edge => { edge.source = nodeIds.get(edge.source); edge.target = nodeIds.get(edge.target); });
      db.plans.push(plan);
    });
    const tasks = [
      ['IQC', 'valve', 'DEMO-261116-A', 1241, '林检验', true],
      ['FIRST', 'shaft', 'DEMO-261116-B', 800, '陈检验', true],
      ['IPQC', 'valve', 'DEMO-261116-C', 300, '林检验', false],
      ['FQC', 'shaft', 'DEMO-261116-D', 200, '赵检验', false],
      ['OQC', 'drill', 'DEMO-261116-E', 500, '陈检验', true]
    ].map(([scenario, key, batch, quantity, inspector, reviewRequired]) => createTask({ standardId: 'STD-' + key, planId: db.plans.find(plan => plan.standardId === 'STD-' + key && plan.scenario === scenario).id, scenario, batch, quantity, inspector, reviewRequired }));
    const iqc = getRound(tasks[0]);
    iqc.measurements['valve-1'] = ['20.12', '20.00', '20.02'];
    iqc.measurements['valve-2'] = ['11.98', '12.02', '11.99'];
    iqc.measurements['valve-5'] = ['0.365', '0.359', '0.345'];
    const ipqc = getRound(tasks[2]);
    ipqc.measurements['valve-1'] = ['20.01', '20.00', '19.99'];
    ipqc.measurements['valve-2'] = ['12.00', '12.01', ''];
    const oqc = getRound(tasks[4]);
    oqc.measurements['drill-1'] = ['10.00', '10.01', '9.99'];
    oqc.measurements['drill-2'] = ['61.8', '62.1', '62.0'];
    oqc.measurements['drill-3'] = ['0.011', '0.012', '0.009'];
    oqc.signatures = { inspector: { name: '陈检验', signedAt: now(), dataUrl: DEMO_SIGNATURE, source: '预置 DEMO SIGN 演示图' }, reviewer: { name: '王质量', signedAt: now(), dataUrl: DEMO_SIGNATURE, source: '预置 DEMO SIGN 演示图' } };
    completeRound(tasks[4].id);
    createNcr(tasks[0].id);
    db.tasks.sort((a, b) => SCENARIOS.indexOf(a.scenario) - SCENARIOS.indexOf(b.scenario));
    save();
    return db;
  }
  function restore() {
    try {
      const stored = root.localStorage && root.localStorage.getItem(STORAGE_KEY);
      if (!stored) return false;
      const data = JSON.parse(stored);
      if (!data || data.schemaVersion !== 1 || !['drawings', 'standards', 'steps', 'plans', 'tasks', 'ncrs', 'reports', 'activity'].every(key => Array.isArray(data[key])) || !data.settings) return false;
      if (!data.tasks.every(task => task.standardSnapshot && Array.isArray(task.standardSnapshot.items) && Array.isArray(task.rounds) && task.rounds.every(round => round.measurements && round.signatures))) return false;
      data.standards.forEach(validateStandardIds);
      data.tasks.forEach(task => {
        assertId(task.id, '检验任务'); validateStandardIds(task.standardSnapshot);
        task.itemSampleCounts = dictionary(task.itemSampleCounts);
        task.rounds.forEach(round => {
          assertId(round.id, '检验轮次');
          Object.keys(round.measurements).forEach(id => { assertId(id, '实测项目'); });
          Object.keys(round.itemSampleCounts || {}).forEach(id => { assertId(id, '抽样项目'); });
          round.measurements = dictionary(round.measurements);
          if (round.itemSampleCounts) round.itemSampleCounts = dictionary(round.itemSampleCounts);
        });
      });
      Object.assign(db, data);
      return true;
    } catch (_) { return false; }
  }
  root.QMS = { db, seed, save, clone, uid, now, evaluate, validatePlan, createTask, addRound, getTask, getRound, technical, completeRound, createNcr, STORAGE_KEY, SCENARIOS, lastSaveError: null };
  if (!restore()) seed();
  if (typeof module !== 'undefined' && module.exports) module.exports = root.QMS;
})(typeof window !== 'undefined' ? window : globalThis);

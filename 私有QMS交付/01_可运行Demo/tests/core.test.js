const test = require('node:test');
const assert = require('node:assert/strict');
const QMS = require('../src/core.js');

test.beforeEach(() => { delete globalThis.localStorage; QMS.seed(); });
function signature(name) {
  return { name, signedAt: QMS.now(), dataUrl: QMS.db.reports[0].roundSnapshot.signatures.inspector.dataUrl };
}
function fillAndSign(task) {
  const round = QMS.getRound(task);
  task.standardSnapshot.items.forEach(item => { round.measurements[item.id] = Array(round.itemSampleCounts[item.id]).fill(item.nominal); });
  round.signatures.inspector = signature('检验员甲');
  if (task.reviewRequired) round.signatures.reviewer = signature('审核员乙');
  return round;
}

test('demo seed contains five scenarios, two untouched tasks and one completed report', () => {
  assert.deepEqual(QMS.db.tasks.map(task => task.scenario), ['IQC', 'FIRST', 'IPQC', 'FQC', 'OQC']);
  assert.equal(QMS.db.tasks.filter(task => task.progress === 0).length, 2);
  assert.equal(QMS.db.tasks.filter(task => task.progress > 0 && task.progress < 100).length, 2);
  assert.equal(QMS.db.reports.length, 1);
  assert.equal(QMS.db.reports[0].batchDecision, '未判批');
});

test('task uses independent standard and workflow snapshots', () => {
  const first = QMS.createTask({ standardId: 'STD-shaft', planId: 'PLAN-shaft', scenario: 'FIRST', batch: 'B-2', quantity: 5 });
  const second = QMS.createTask({ standardId: 'STD-shaft', planId: 'PLAN-shaft', scenario: 'FIRST', batch: 'B-3', quantity: 3 });
  QMS.db.standards.find(item => item.id === 'STD-shaft').items[0].upper = '999';
  QMS.db.plans.find(item => item.id === 'PLAN-shaft').nodes[0].name = '已修改模板';
  first.standardSnapshot.items[0].lower = '0';
  assert.equal(first.standardSnapshot.items[0].upper, '18.08');
  assert.equal(second.standardSnapshot.items[0].lower, '17.92');
  assert.equal(first.planSnapshot.nodes[0].name, '来料核验');
  assert.notEqual(first.rounds[0].measurements, second.rounds[0].measurements);
});

test('reinspection starts blank and retains original values and evidence', () => {
  const task = QMS.db.tasks[0];
  fillAndSign(task);
  QMS.getRound(task).measurements['valve-1'][0] = '20.12';
  assert.equal(QMS.completeRound(task.id).ok, true);
  const old = QMS.getRound(task);
  old.photos.push({ name: 'photo.png', data: 'data:image/png;base64,example' });
  const snapshot = QMS.clone(old);
  const next = QMS.addRound(task.id, '返工后复检');
  assert.deepEqual(QMS.clone(old), snapshot);
  assert.equal(task.rounds.length, 2);
  assert.equal(QMS.getRound(task), next);
  assert.ok(Object.values(next.measurements).flat().every(value => value === ''));
  assert.deepEqual(next.photos, []);
  assert.equal(QMS.technical(task).status, 'pending');
});

test('empty or invalid measurements cannot be mistaken for a pass', () => {
  const item = { kind: 'number', lower: '0', upper: '0' };
  for (const value of ['', ' ', null, undefined]) assert.equal(QMS.evaluate(item, value), 'pending');
  for (const value of ['NaN', 'Infinity', 'abc', true, {}, [], '1,000']) assert.equal(QMS.evaluate(item, value), 'invalid');
  assert.equal(QMS.evaluate(item, '0'), 'pass');
  assert.equal(QMS.evaluate(item, '0.00001'), 'ng');
});

test('inclusive decimal bounds remain exact beyond floating point precision', () => {
  const item = { kind: 'number', lower: '0.10000000000000000001', upper: '0.30000000000000000001' };
  assert.equal(QMS.evaluate(item, '0.10000000000000000001'), 'pass');
  assert.equal(QMS.evaluate(item, '0.30000000000000000001'), 'pass');
  assert.equal(QMS.evaluate(item, '0.30000000000000000002'), 'ng');
  assert.equal(QMS.evaluate(item, '0.10000000000000000000'), 'ng');
  assert.equal(QMS.evaluate({ kind: 'number', lower: '-0.03', upper: '-0.01' }, '-2e-2'), 'pass');
  assert.equal(QMS.evaluate({ kind: 'number', lower: '1', upper: '0' }, '0.5'), 'invalid');
});

test('one-sided limits and attributes have explicit results', () => {
  assert.equal(QMS.evaluate({ kind: 'number', lower: null, upper: '1.6' }, '1.60'), 'pass');
  assert.equal(QMS.evaluate({ kind: 'number', lower: '0.350', upper: null }, '0.3499999'), 'ng');
  assert.equal(QMS.evaluate({ kind: 'number', lower: '', upper: '' }, '12'), 'invalid');
  assert.equal(QMS.evaluate({ kind: 'attribute' }, '合格'), 'pass');
  assert.equal(QMS.evaluate({ kind: 'attribute' }, '不合格'), 'ng');
  assert.equal(QMS.evaluate({ kind: 'attribute' }, '待确认'), 'invalid');
});

test('completion checks all measurements and required signatures, accepts real NG', () => {
  const task = QMS.db.tasks.find(task => task.scenario === 'FIRST');
  const round = QMS.getRound(task);
  assert.equal(QMS.completeRound(task.id).ok, false);
  task.standardSnapshot.items.forEach(item => { round.measurements[item.id] = [item.nominal, item.nominal, item.nominal]; });
  round.measurements['shaft-1'][0] = '18.09';
  assert.match(QMS.completeRound(task.id).error, /检验员/);
  round.signatures.inspector = signature('检验员甲');
  assert.match(QMS.completeRound(task.id).error, /审核员/);
  round.signatures.reviewer = signature('审核员乙');
  const result = QMS.completeRound(task.id);
  assert.equal(result.ok, true);
  assert.equal(result.report.result, 'ng');
  assert.equal(result.report.batchDecision, '未判批');
  assert.equal(round.status, 'completed');
  const count = QMS.db.reports.length;
  assert.equal(QMS.completeRound(task.id).alreadyCompleted, true);
  assert.equal(QMS.db.reports.length, count);
  round.measurements['shaft-1'][0] = '18.00';
  assert.equal(result.report.roundSnapshot.measurements['shaft-1'][0], '18.09');
});

test('invalid inputs and missing sample array entries block completion', () => {
  const task = QMS.db.tasks.find(task => task.scenario === 'FQC');
  const round = QMS.getRound(task);
  task.standardSnapshot.items.forEach(item => { round.measurements[item.id] = [item.nominal, item.nominal, item.nominal]; });
  round.signatures.inspector = signature('检验员甲');
  round.measurements['shaft-1'][0] = 'error';
  assert.match(QMS.completeRound(task.id).error, /格式无效/);
  round.measurements['shaft-1'] = ['18.00'];
  assert.equal(QMS.technical(task).pending, 2);
  assert.match(QMS.completeRound(task.id).error, /未填写/);
});

test('NCR generation requires actual NG and is idempotent per round', () => {
  const task = QMS.db.tasks[0];
  const a = QMS.createNcr(task.id), b = QMS.createNcr(task.id);
  assert.equal(a.id, b.id);
  assert.equal(a.failures.length, 2);
  assert.throws(() => QMS.createNcr(QMS.db.tasks[1].id), /没有不合格/);
  fillAndSign(task);
  assert.equal(QMS.completeRound(task.id).ok, true);
  QMS.addRound(task.id, '复检');
  assert.throws(() => QMS.createNcr(task.id), /没有不合格/);
});

test('task validation rejects unpublished standards, mismatched plans and invalid quantity', () => {
  const input = { standardId: 'STD-shaft', planId: 'PLAN-shaft', scenario: 'FIRST', batch: 'A', quantity: 10 };
  assert.throws(() => QMS.createTask({ ...input, planId: 'PLAN-valve' }), /不一致/);
  assert.throws(() => QMS.createTask({ ...input, quantity: 1.5 }), /正整数/);
  assert.throws(() => QMS.createTask({ ...input, batch: ' ' }), /批次号/);
  QMS.db.standards.find(item => item.id === 'STD-shaft').status = 'draft';
  assert.throws(() => QMS.createTask(input), /已发布/);
});

test('save reports storage failures and serializes data when storage is available', () => {
  assert.equal(QMS.save(), false);
  assert.match(QMS.lastSaveError, /本地保存失败/);
  globalThis.localStorage = { setItem() { throw new Error('quota'); } };
  assert.equal(QMS.save(), false);
  let written;
  globalThis.localStorage = { setItem(key, value) { written = { key, value }; } };
  assert.equal(QMS.save(), true);
  assert.equal(QMS.lastSaveError, null);
  assert.equal(written.key, QMS.STORAGE_KEY);
  assert.equal(JSON.parse(written.value).tasks.length, 5);
});

test('workflow selection snapshots only linked items and applies maximum per-item sample count', () => {
  const plan = QMS.db.plans.find(plan => plan.id === 'PLAN-shaft');
  plan.nodes[1].itemIds = ['shaft-1']; plan.nodes[1].sampleCount = 2;
  plan.nodes[2].itemIds = ['shaft-1', 'shaft-3']; plan.nodes[2].sampleCount = 4;
  plan.nodes[3].itemIds = ['shaft-4']; plan.nodes[3].sampleCount = 1;
  const task = QMS.createTask({ standardId: plan.standardId, planId: plan.id, scenario: 'FIRST', batch: 'COUNT-1', quantity: 4 });
  const round = QMS.getRound(task);
  assert.deepEqual(task.standardSnapshot.items.map(item => item.id), ['shaft-1', 'shaft-3', 'shaft-4']);
  assert.deepEqual({ ...round.itemSampleCounts }, { 'shaft-1': 4, 'shaft-3': 4, 'shaft-4': 1 });
  assert.equal(round.sampleCount, 4);
  assert.equal(QMS.technical(task).total, 9);
  fillAndSign(task);
  round.measurements['shaft-4'].push('999'); // Surplus cells do not enter the selected sampling scope.
  assert.equal(QMS.technical(task).status, 'pass');
  assert.equal(QMS.technical(task).items[2].values.length, 1);
  assert.equal(QMS.completeRound(task.id).ok, true);
  const next = QMS.addRound(task.id, '计划范围内复检');
  assert.equal(next.measurements['shaft-1'].length, 4);
  assert.equal(next.measurements['shaft-4'].length, 1);
});

test('task creation rejects scenario mismatch and samples exceeding the batch', () => {
  const input = { standardId: 'STD-shaft', planId: 'PLAN-shaft', scenario: 'FIRST', batch: 'SMALL', quantity: 3 };
  assert.throws(() => QMS.createTask({ ...input, scenario: 'IQC' }), /类型.*不一致/);
  assert.throws(() => QMS.createTask({ ...input, quantity: 2 }), /不得超过批量/);
  const task = QMS.createTask({ ...input, planId: null });
  assert.equal(task.standardSnapshot.items.length, 4);
  assert.equal(QMS.technical(task).total, 12);
});

test('workflow validation rejects loops, dangling references, disconnected nodes and unknown items', () => {
  const standard = QMS.db.standards.find(item => item.id === 'STD-shaft');
  const original = QMS.db.plans.find(item => item.id === 'PLAN-shaft');
  let plan = QMS.clone(original);
  plan.edges.push({ source: plan.nodes[4].id, target: plan.nodes[0].id });
  assert.throws(() => QMS.validatePlan(plan, standard), /循环/);
  plan = QMS.clone(original); plan.edges[0].source = 'missing';
  assert.throws(() => QMS.validatePlan(plan, standard), /不存在的节点/);
  plan = QMS.clone(original); plan.nodes[1].id = plan.nodes[0].id;
  assert.throws(() => QMS.validatePlan(plan, standard), /唯一/);
  plan = QMS.clone(original); plan.nodes[1].itemIds = ['missing'];
  assert.throws(() => QMS.validatePlan(plan, standard), /不存在的检验项目/);
  plan = QMS.clone(original); plan.edges = plan.edges.filter(edge => edge.target !== plan.nodes[4].id);
  assert.throws(() => QMS.validatePlan(plan, standard), /未连接/);
  plan = QMS.clone(original); plan.nodes.forEach(node => { node.itemIds = []; });
  assert.throws(() => QMS.validatePlan(plan, standard), /至少需要关联/);
  plan = QMS.clone(original); plan.nodes[1].sampleCount = 0;
  assert.throws(() => QMS.validatePlan(plan, standard), /样本数/);
  assert.equal(QMS.validatePlan(original, standard).itemIds.length, 4);
});

test('signature completion requires a PNG image and independent reviewer identity', () => {
  const task = QMS.db.tasks.find(task => task.scenario === 'FIRST');
  const round = fillAndSign(task);
  round.signatures.inspector = { name: '检验员甲' };
  assert.match(QMS.completeRound(task.id).error, /检验员签名/);
  round.signatures.inspector.dataUrl = 'data:image/png;base64,not-a-png';
  assert.match(QMS.completeRound(task.id).error, /检验员签名/);
  round.signatures.inspector = signature('检验员甲');
  round.signatures.reviewer = signature('检验员甲');
  assert.match(QMS.completeRound(task.id).error, /不能是同一人/);
  round.signatures.reviewer = signature('审核员乙');
  assert.equal(QMS.completeRound(task.id).ok, true);
});

test('unfinished draft cannot be replaced by a new reinspection round', () => {
  const task = QMS.db.tasks[0];
  const old = QMS.clone(task.rounds);
  assert.throws(() => QMS.addRound(task.id, '重测'), /先完成/);
  assert.deepEqual(QMS.clone(task.rounds), old);
});

test('explicit round actions cannot accidentally operate on the active reinspection', () => {
  const task = QMS.db.tasks.find(task => task.scenario === 'FQC');
  const old = fillAndSign(task);
  old.measurements['shaft-1'][0] = '18.09';
  assert.equal(QMS.completeRound(task.id, old.id).ok, true);
  const next = QMS.addRound(task.id, '返工后复检');
  const ncr = QMS.createNcr(task.id, old.id);
  assert.equal(ncr.roundId, old.id);
  assert.equal(QMS.completeRound(task.id, old.id).alreadyCompleted, true);
  assert.equal(next.status, 'draft');
  assert.throws(() => QMS.createNcr(task.id, next.id), /没有不合格/);
  assert.equal(QMS.completeRound(task.id, 'missing').ok, false);
});

test('storage failure is observable through both status and a browser event', t => {
  const previousDispatch = globalThis.dispatchEvent, previousEvent = globalThis.CustomEvent;
  t.after(() => { globalThis.dispatchEvent = previousDispatch; globalThis.CustomEvent = previousEvent; });
  let captured;
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  globalThis.dispatchEvent = event => { captured = event; };
  globalThis.localStorage = { setItem() { throw new Error('quota exceeded'); } };
  assert.equal(QMS.save(), false);
  assert.equal(captured.type, 'qms-storage-error');
  assert.equal(captured.detail.message, QMS.lastSaveError);
  assert.match(QMS.lastSaveError, /quota exceeded/);
});

test('reserved or malformed imported IDs cannot become dictionary keys', () => {
  const standard = QMS.db.standards.find(item => item.id === 'STD-shaft');
  const plan = QMS.db.plans.find(item => item.id === 'PLAN-shaft');
  const original = standard.items[0].id;
  for (const id of ['__proto__', 'constructor', 'prototype', '', ' ', ' leading', 12, null, {}, 'x'.repeat(129), 'line\nfeed']) {
    standard.items[0].id = id;
    assert.throws(() => QMS.validatePlan(plan, standard), /编号/);
    assert.throws(() => QMS.createTask({ standardId: standard.id, planId: plan.id, scenario: 'FIRST', batch: 'BAD-ID', quantity: 10 }), /编号/);
  }
  standard.items[0].id = original;
  for (const id of ['__proto__', 'constructor', 'prototype']) {
    const invalidPlan = QMS.clone(plan);
    invalidPlan.nodes[0].id = id;
    assert.throws(() => QMS.validatePlan(invalidPlan, standard), /编号/);
    invalidPlan.nodes[0].id = plan.nodes[0].id;
    invalidPlan.edges[0].source = id;
    assert.throws(() => QMS.validatePlan(invalidPlan, standard), /编号/);
  }
  assert.equal(Object.getPrototypeOf(QMS.validatePlan(plan, standard).itemSampleCounts), null);
  const task = QMS.createTask({ standardId: standard.id, planId: plan.id, scenario: 'FIRST', batch: 'SAFE-ID', quantity: 10 });
  assert.equal(Object.getPrototypeOf(task.itemSampleCounts), null);
  assert.equal(Object.getPrototypeOf(QMS.getRound(task).measurements), null);
  assert.equal(Object.getPrototypeOf(QMS.getRound(task).itemSampleCounts), null);
  assert.ok(Number.isFinite(QMS.getRound(task).sampleCount));
  assert.equal({}.polluted, undefined);
});

test('known NG may create NCR even while the same item has invalid or pending cells', () => {
  const task = QMS.db.tasks.find(task => task.scenario === 'FIRST');
  const round = QMS.getRound(task);
  round.measurements['shaft-1'] = ['999999', 'bad', ''];
  const result = QMS.technical(task);
  assert.equal(result.items[0].status, 'invalid');
  assert.deepEqual(result.items[0].results, ['ng', 'invalid', 'pending']);
  const ncr = QMS.createNcr(task.id, round.id);
  assert.equal(ncr.failures.length, 1);
  assert.equal(ncr.failures[0].itemId, 'shaft-1');
  assert.equal(ncr.failures[0].results[0], 'ng');
  assert.equal(QMS.completeRound(task.id, round.id).ok, false);
});

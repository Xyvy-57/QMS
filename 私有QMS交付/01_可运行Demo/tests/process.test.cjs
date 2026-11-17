'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const coreSource = fs.readFileSync(path.join(__dirname, '../src/core.js'), 'utf8');
const processSource = fs.readFileSync(path.join(__dirname, '../src/process.js'), 'utf8');
function setup() {
  const page = {};
  const messages = [];
  const ctx = { Date, Math, Set, Map, console, document: { getElementById: id => id === 'page' ? page : null } };
  ctx.window = ctx;
  ctx.UI = { e: value => String(value).replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])), icon: () => '<svg></svg>', badge: text => text, toast: text => messages.push(text), close() {}, modal() {} };
  vm.createContext(ctx); vm.runInContext(coreSource, ctx); vm.runInContext(processSource, ctx);
  ctx.App = { render: () => { ctx.html = ctx.ProcessPage.render(); ctx.ProcessPage.bind(); }, go() {} };
  ctx.App.render();
  const click = (action, id) => page.onclick({ target: { closest: () => ({ dataset: { procAction: action, id } }) } });
  const change = (key, value) => page.onchange({ target: { dataset: { nodeField: key }, value } });
  return { ctx, click, change, messages };
}
test('plan publication rejects cyclic, self and dangling dependencies', () => {
  const { ctx } = setup();
  const plan = ctx.QMS.clone(ctx.QMS.db.plans[0]);
  const [first, second] = plan.nodes;
  assert.equal(ctx.ProcessPage.validate(plan, true), true);
  plan.edges.push({ source: second.id, target: first.id });
  assert.throws(() => ctx.ProcessPage.validate(plan, true), /环/);
  plan.edges = [{ source: first.id, target: first.id }];
  assert.throws(() => ctx.ProcessPage.validate(plan, true), /自身/);
  plan.edges = [{ source: first.id, target: 'missing' }];
  assert.throws(() => ctx.ProcessPage.validate(plan, true), /不存在/);
});
test('empty plans and invalid sample counts cannot be published', () => {
  const { ctx } = setup();
  const plan = ctx.QMS.clone(ctx.QMS.db.plans[0]);
  plan.nodes[0].sampleCount = 0;
  assert.throws(() => ctx.ProcessPage.validate(plan, true), /抽样数量/);
  plan.nodes = []; plan.edges = [];
  assert.throws(() => ctx.ProcessPage.validate(plan, true), /至少添加/);
});
test('editing a published plan creates a revision and preserves old task snapshots', () => {
  const { ctx, click, change } = setup();
  const oldPlan = ctx.QMS.db.plans[0];
  const originalName = oldPlan.nodes[0].name;
  const taskSnapshot = JSON.stringify(ctx.QMS.db.tasks.map(task => task.planSnapshot));
  const count = ctx.QMS.db.plans.length;
  click('select-node', oldPlan.nodes[0].id);
  change('name', '新版来料核验');
  click('publish');
  assert.equal(ctx.QMS.db.plans.length, count + 1);
  assert.equal(oldPlan.nodes[0].name, originalName);
  assert.equal(ctx.QMS.db.plans[0].nodes[0].name, '新版来料核验');
  assert.notEqual(ctx.QMS.db.plans[0].id, oldPlan.id);
  assert.equal(ctx.QMS.db.plans[0].status, 'published');
  assert.equal(JSON.stringify(ctx.QMS.db.tasks.map(task => task.planSnapshot)), taskSnapshot);
});
test('copying a plan gives every node and edge an independent identity', () => {
  const { ctx, click } = setup();
  const source = ctx.QMS.db.plans[0];
  const oldIds = new Set(source.nodes.map(node => node.id));
  click('copy-plan'); click('save-draft');
  const copy = ctx.QMS.db.plans[0];
  assert.notEqual(copy.id, source.id);
  assert.equal(copy.status, 'draft');
  assert.equal(copy.nodes.length, source.nodes.length);
  assert.ok(copy.nodes.every(node => !oldIds.has(node.id)));
  const ids = new Set(copy.nodes.map(node => node.id));
  assert.ok(copy.edges.every(edge => ids.has(edge.source) && ids.has(edge.target)));
});
test('plan titles are escaped in the rendered interface', () => {
  const { ctx, click } = setup();
  const source = ctx.QMS.db.plans[0];
  source.name = '<img src=x onerror=alert(1)>';
  click('select-plan', source.id);
  assert.ok(ctx.html.includes('&lt;img'));
  assert.ok(!ctx.html.includes('<img src=x'));
});

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { join } from 'node:path';
import { launch, openApp, setUser, ROOT } from './lib.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });
async function scene(t, user, route) {
  const context = await browser.createBrowserContext();
  t.after(() => context.close());
  const { page, log } = await openApp(context, join(ROOT, 'qms_pro_qms.html'), { user, route, viewport: '390x844' });
  t.after(() => assert.deepEqual(log.errors, []));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  page.setDefaultTimeout(4500);
  return page;
}
const tap = (p, selector) => p.locator(selector).setTimeout(4500).click();
const text = (p, selector) => p.$eval(selector, el => el.innerText);
const route = (p, path) => p.evaluate(r => { location.hash = '#' + r; }, path);
async function fill(p, selector, value) {
  await p.$eval(selector, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
}

test('手机分别批准报废和返工，品项、件数与操作处于同一可见卡片', async t => {
  const p = await scene(t, 'u3', '/ncr/n1');
  await tap(p, '[data-next-locate]');
  const located = await p.evaluate(() => {
    const button = document.activeElement, row = button.closest('tr');
    const a = row.cells[0].getBoundingClientRect(), b = row.cells[1].getBoundingClientRect(), c = button.getBoundingClientRect();
    return { name: button.innerText.trim(), sameView: [a,b,c].every(r => r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight) };
  });
  assert.deepEqual(located, { name: '批准返工 30 件', sameView: true });
  await tap(p, '::-p-aria(批准报废 6 件)');
  const states = await p.evaluate(() => window.__QMS.S.ncrs.find(n => n.id === 'n1').disp.map(d => [d.action, !!d.approved, !!d.executed]));
  assert.deepEqual(states, [['返工',false,false],['报废',true,false]]);
  assert.match(await text(p,'[data-disposition="报废"]'), /已批准，待执行/);
  assert.match(await text(p,'[data-disposition="返工"]'), /待批准/);
});

test('同一工单的多项限制逐条显示，解除一条保留另一个范围', async t => {
  const p = await scene(t, 'u4', '/orders/o1');
  const panel = '[aria-label="当前质量限制"]';
  const initial = await text(p,panel);
  for (const s of ['禁止使用','禁止发运','WO-2611-011','质量负责人']) assert.ok(initial.includes(s), s);
  await p.evaluate(() => {
    const {S} = window.__QMS, n=S.ncrs.find(n=>n.id==='n1');
    n.holds.push({...n.holds[0],id:'h-test',scopeType:'批次',scopeVal:S.orders.find(o=>o.id==='o1').inLots[0], actions:['process']});
    n.holds[0].status='released';
  });
  const after = await text(p,panel);
  assert.match(after,/禁止继续加工/); assert.doesNotMatch(after,/禁止使用|禁止发运/);
  assert.match(await p.$eval(panel+' a', el=>el.hash), /ncr\/n1\?show=holds/);
  await tap(p, panel+' a');
  await p.waitForFunction(()=>document.activeElement.dataset.holdId === 'h-test');
});

test('从工单返回检验恢复所选特性和样本，同时可直接跳到第一缺项', async t => {
  const p = await scene(t, 'u1', '/inspect/t1');
  await tap(p,'[aria-label="第 4 项"]');
  await tap(p,'[data-card-cell="2"]');
  await tap(p,'a[href*="?stage=IQC"]');
  await tap(p,'[data-test="stage-act"]');
  await p.waitForSelector('[data-card-cell="2"]');
  assert.match(await text(p,'main'), /3-1 支撑杆高/);
  await p.waitForFunction(()=>document.activeElement.dataset.cardCell==='2');
  assert.equal(await p.evaluate(()=>document.activeElement.value),'25.06');
  await fill(p, '[data-card-cell="2"]', '25.09');
  await p.reload(); await p.waitForFunction(()=>!document.querySelector('#boot') && document.activeElement.dataset.cardCell==='2');
  assert.equal(await p.evaluate(()=>document.activeElement.value),'25.09','刷新前最后一个读数与位置一并保留');
  await tap(p,'.inspect-footer button');
  await p.waitForFunction(()=>document.activeElement.dataset.cardCell==='4');
  assert.match(await text(p,'main'), /1-1 轴直径/);
  await setUser(p,'u7');
  assert.equal(await p.$('[data-resumed-position]'), null, '其他岗位和用户不沿用此书签');
});

test('工单按实际报工和入库量建检，分批占用剩余件数且不能超额', async t => {
  const p = await scene(t, 'u1', '/orders/oh64');
  const facts=await p.evaluate(()=>{
    const {S,orderQty}=window.__QMS, o=S.orders.find(x=>x.id==='oh64');
    const saved=S.tasks.filter(x=>['OQC','FQC'].includes(x.scene)&&x.ctx.batch===o.outLot);
    return {stock:orderQty(o).stocked, lots:saved.map(x=>x.lot)};
  });
  assert.deepEqual(facts,{stock:298,lots:[298,298]},'新演示的签名前批量与入库相符');
  // 复制报工数据模拟同批尚未建检的工单，原始历史单完整保留。
  await p.evaluate(()=>{ const {S}=window.__QMS, o=S.orders.find(x=>x.id==='oh64');
    S.orders.push({...JSON.parse(JSON.stringify(o)),id:'test-lot',wo:'WO-TEST-LOT',outLot:'FG-TEST',inLots:[],work:[{id:'wk1',op:'30 终检',at:'2026-11-20T08:00:00Z',good:198,bad:0},{id:'wk2',op:'30 终检',at:'2026-11-20T09:00:00Z',good:100,bad:0}],qtyIn:298}); });
  await route(p,'/orders/test-lot');
  await p.waitForFunction(()=>document.querySelector('h1')?.innerText==='WO-TEST-LOT');
  const gate = p.locator('::-p-aria(仍要开检)').setTimeout(4500);
  await tap(p,'[data-check="FQC"]'); await gate.click();
  await p.waitForSelector('#order-lot-qty');
  assert.equal(await p.$eval('#order-lot-qty',e=>e.value),'100','带入最新一笔报工，而不是累计或计划量');
  assert.equal(await p.$eval('#order-lot-batch',e=>e.value),'FG-TEST');
  await tap(p,'[data-create-order-lot] button');
  await p.waitForSelector('.inspect-footer');
  assert.equal(await p.evaluate(()=>window.__QMS.S.tasks[0].lot),100);
  await route(p,'/orders/test-lot'); await tap(p,'[data-check="OQC"]');
  await gate.click();
  await p.waitForSelector('#order-lot-qty');
  assert.equal(await p.$eval('#order-lot-qty',e=>e.value),'298');
  await fill(p,'#order-lot-qty','299');
  assert.equal(await p.$eval('[data-create-order-lot] button',e=>e.disabled),true);
  assert.match(await text(p,'[data-lot-error]'),/298/);
  await fill(p,'#order-lot-qty','100'); await fill(p,'#order-shipment','DN-TEST-01');
  await tap(p,'[data-create-order-lot] button'); await p.waitForSelector('.inspect-footer');
  const shipment=await p.evaluate(()=>{ const t=window.__QMS.S.tasks[0]; return [t.lot,t.ctx.wo,t.ctx.batch,t.ctx.shipment]; });
  assert.deepEqual(shipment,[100,'WO-TEST-LOT','FG-TEST','DN-TEST-01']);
  await route(p,'/orders/test-lot'); await tap(p,'[data-next-lot="OQC"]'); await gate.click();
  await p.waitForSelector('#order-lot-qty');
  assert.equal(await p.$eval('#order-lot-qty',e=>e.value),'198');
  await fill(p,'#order-shipment','DN-TEST-02'); await tap(p,'[data-create-order-lot] button'); await p.waitForSelector('.inspect-footer');
  await route(p,'/orders/test-lot'); await p.waitForSelector('[data-check="OQC"]');
  assert.equal(await p.$('[data-next-lot="OQC"]'),null);
  assert.ok(await p.$('[data-next-lot="FQC"]'));
});

test('分批演示直接进入剩余 198 件，早批未通过仍会挡住整单放行', async t => {
  const p = await scene(t, 'u1', '/orders/odemo72');
  assert.match(await text(p, '[data-test="stage-act"]'), /下一批出货检验/);
  const gate = await p.evaluate(() => {
    const q = window.__QMS, o = q.S.orders.find(o => o.id === 'odemo72');
    const check = q.mainlineOf(o).stages.at(-1).checks.find(c => c.key === 'OQC');
    const ctx = { wo:o.wo, op:'40 出货', batch:o.outLot };
    const tooMany = () => q.createTask({ planId:'pl4', scene:'OQC', ctx, lot:199 });
    let error = '';
    try { tooMany(); } catch (e) { error = e.message; }
    return { covered:check.ok, error };
  });
  assert.equal(gate.covered,false);
  assert.match(gate.error,/198/);
  await tap(p, '[data-test="stage-act"]');
  assert.equal(await p.$eval('#order-lot-qty', el => el.value),'198');
  await tap(p, '[data-create-order-lot] button'); await p.waitForSelector('.inspect-footer');
  const status = await p.evaluate(() => {
    const q=window.__QMS, o=q.S.orders.find(o=>o.id==='odemo72');
    const batches=q.S.tasks.filter(x=>x.scene==='OQC' && x.ctx.wo===o.wo);
    // 独立检验批，早批不合格时，后批合格不能代表全单。
    batches.find(x=>x.lot===100).status='fail';
    batches.find(x=>x.lot===198).status='pass';
    return q.mainlineOf(o).stages.find(s=>s.key==='OQC').state;
  });
  assert.equal(status,'blocked');
});

test('无终检报工时明确填写实际送检数，入库为零时拦住出货', async t => {
  const p = await scene(t, 'u1', '/orders/o4');
  const gate = p.locator('::-p-aria(仍要开检)').setTimeout(4500);
  await tap(p,'[data-check="FQC"]'); await gate.click();
  await p.waitForSelector('#order-lot-qty');
  assert.equal(await p.$eval('#order-lot-qty',el=>el.value),'');
  assert.equal(await p.$eval('#order-lot-batch',el=>el.value),'');
  await fill(p,'#order-lot-qty','12');
  assert.match(await text(p,'[data-lot-error]'),/成品批次/);
  await fill(p,'#order-lot-batch','FG-MANUAL');
  assert.equal(await p.$eval('[data-create-order-lot] button',el=>el.disabled),false);
  await tap(p,'::-p-aria(取消)');
  await tap(p,'[data-check="OQC"]'); await gate.click();
  await p.waitForSelector('#order-lot-qty');
  await fill(p,'#order-lot-qty','1');
  assert.match(await text(p,'[data-lot-error]'),/还没有入库合格数/);
  assert.equal(await p.$eval('[data-create-order-lot] button',el=>el.disabled),true);
});

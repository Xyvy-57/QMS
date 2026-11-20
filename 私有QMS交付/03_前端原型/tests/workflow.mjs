/** 车间交接：仅在临时 Chrome 配置中操作演示数据，不访问气泡服务。 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, openApp, setUser, gotoRoute, ROOT } from './lib.mjs';

const browser = await launch();
try {
  const { page, log } = await openApp(browser, join(ROOT, 'qms_pro_qms.html'), { user: 'u1', viewport: '390x844' });
  const see = async (s) => {
    try { return await page.waitForSelector(s, { visible: true, timeout: 6000 }); }
    catch (e) { console.error(s, await page.evaluate(() => ({ route: location.hash, dialog: document.querySelector('[role="dialog"]')?.innerText, error: document.querySelector('[role="alert"]')?.innerText, toasts: window.__QMS?.UI.toasts.map((t) => t.msg) })), log.errors); throw e; }
  };
  const text = (s) => page.$eval(s, (el) => el.innerText);
  const visit = (r) => gotoRoute(page, r, 550);
  const tap = async (s) => { await page.locator(s).setTimeout(6000).click(); };
  const onScreen = (s) => page.$eval(s, (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= document.documentElement.clientWidth + 1; });

  const o11 = await page.evaluate(() => window.__QMS.S.orders.find((o) => o.wo === 'WO-2611-011').id);
  const o21 = await page.evaluate(() => window.__QMS.S.orders.find((o) => o.wo === 'WO-2611-021').id);
  const group = '[data-todo-order="' + o11 + '"]';
  await see(group);
  assert.match(await text(group), /CNC-04/);
  const search = 'input[aria-label="查找工单、批次或检验单"]';
  await page.type(search, 'WO-2611-021'); await page.keyboard.press('Enter');
  await page.waitForFunction((id) => location.hash === '#/orders/' + id, { timeout: 5000 }, o21);
  assert.match(await page.evaluate(() => window.__QMS.scanTarget('WO-2611-021').to), /^\/inspect\//, '查工单和扫码作业是不同意图');
  await visit('/workbench');
  await tap(group + ' [data-todo] button');
  await see('[data-test="order-trail"]');
  assert.match(await text('[data-test="order-trail"]'), /WO-2611-011/);
  await see('.drawing-toggle');
  assert.equal(await page.$eval('#inspection-drawing', (el) => el.offsetHeight), 0);
  await tap('.drawing-toggle'); await see('#inspection-drawing');
  await tap('.drawing-toggle');
  await tap('[data-test="order-trail"] a');
  await see('[data-panel="ops"]');
  assert.match(await page.evaluate(() => location.hash), /stage=FIRST/);
  console.log('✓ 本班待办 → 对应机台首件 → 回到同工单的首件节点');

  await setUser(page, 'u4'); await visit('/orders');
  const row = '[data-order="WO-2611-011"]';
  await tap('[data-order-filter="mine"]');
  await see('[data-order="WO-2611-018"]'); // 生产主管本班待报工，也属于“轮到我”。
  await tap('[data-order-filter="active"]');
  await see(row + ' [data-order-owner]');
  assert.ok(await onScreen(row + ' [data-order-owner]'), '手机不用横滑就能看到处理岗位');
  assert.ok(await onScreen(row + ' [data-order-stage]'), '手机不用横滑就能看到工单卡点');
  await tap(row + ' a');
  await tap('[data-op="20 精车"] [data-work]');
  await see('[data-work-form]');
  assert.match(await text('[data-work-context]'), /WO-2611-011/);
  assert.match(await text('[data-work-context]'), /20 精车/);
  await page.type('[data-work-good]', '2'); await page.type('[data-work-bad]', '1');
  await tap('[data-work-submit] button');
  await see('[data-work-form] [role="alert"]');
  assert.match(await text('[data-work-form] [role="alert"]'), /不良现象/);
  await page.type('[data-work-reason]', '尺寸偏大');
  await tap('[data-work-submit] button'); await see('[data-receipt]');
  assert.match(await text('[data-receipt]'), /合格 2 件/);
  assert.match(await text('[data-receipt]'), /不良 1 件/);
  assert.match(await text('[data-receipt]'), /质量工程师/);
  const receiptRoute = await page.evaluate(() => location.hash.slice(1));
  await page.reload(); await see('[data-receipt]');
  assert.equal(await page.evaluate(() => window.__QMS.S.orders.find((o) => o.wo === 'WO-2611-011').work.filter((w) => w.reason === '尺寸偏大' && w.good === 2 && w.bad === 1).length), 1);
  await tap('[data-receipt] [data-next-record]'); await see('[data-test="order-trail"]');
  assert.match(await text('[data-test="order-trail"]'), /WO-2611-011/);
  assert.match(await text('main'), /尺寸偏大/);
  await visit(receiptRoute.replace('/orders/' + o11, '/orders/' + o21));
  assert.equal(await page.$('[data-receipt]'), null, '其他工单不能显示这笔交接');
  console.log('✓ 手机上报工 → 原因校验 → 同笔报工交接 → 对应不合格单；回执刷新不重报、不串单');

  await visit('/orders/' + o21); await tap('[data-order-setup]');
  await see('[data-setup-submit] button'); await tap('[data-setup-submit] button');
  await see('[data-receipt]');
  const setupRoute = await page.evaluate(() => location.hash.slice(1));
  assert.match(await text('[data-receipt]'), /CNC-02/);
  assert.match(await text('[data-receipt]'), /首件/);
  assert.equal(await page.$('[data-receipt] [data-start-first]'), null, '生产主管不能代检');
  await setUser(page, 'u1'); await tap('[data-receipt] [data-start-first]');
  await see('[data-test="order-trail"]');
  const ctx = await page.evaluate(() => { const Q = window.__QMS, x = Q.S.tasks.find((t) => t.id === Q.UI.route.params.id)?.ctx; return x && [x.wo, x.op, x.machine, x.trigger]; });
  assert.deepEqual(ctx, ['WO-2611-021', '20 精车', 'CNC-02', '换刀']);
  await visit(setupRoute); await see('[data-receipt]');
  assert.equal(await page.$('[data-receipt] [data-start-first]'), null, '已有首件，回到回执不会开重复单');
  assert.match(await text('[data-receipt]'), /查看首件单/);
  console.log('✓ 换刀 → 指定工单/工序/机台的首件 → 由检验岗位开检');
  await setUser(page, 'u4'); await visit('/orders');
  await tap('[data-new-order] button'); await see('#new-order-part');
  const readValue = (s) => page.$eval(s, (el) => el.value);
  assert.equal(await readValue('#new-order-part'), '');
  assert.equal(await readValue('#new-order-qty'), '');
  await page.select('#new-order-part', 'p1'); await tap('[data-create-order] button');
  await see('[data-order-error]'); assert.match(await text('[data-order-error]'), /计划数量/);
  await page.type('#new-order-qty', '12'); await tap('[data-create-order] button');
  await see('[data-panel="ops"]');
  const opened = await page.evaluate(() => { const Q = window.__QMS, o = Q.S.orders.find((x) => x.id === Q.UI.route.params.id); return o && [o.partId, o.qty, o.due, o.inLots.length]; });
  assert.deepEqual(opened, ['p1', 12, '', 0]);
  console.log('✓ 新工单不预填示例数量或零件，必要字段齐全后进入所选零件的工单');
  assert.deepEqual(log.errors, []);
} finally { await browser.close(); }

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, openApp, setUser, ROOT } from './lib.mjs';

const browser = await launch();
try {
  const { page, log } = await openApp(browser, process.argv[2] || join(ROOT, 'qms_pro_qms.html'), { user: 'u3', viewport: '1440x900' });
  const see = (s) => page.waitForSelector(s, { visible: true, timeout: 5500 });
  const tap = (s) => page.locator(s).setTimeout(5500).click();
  const focus = (s) => page.waitForFunction((sel) => document.activeElement.matches(sel), { timeout: 5500 }, s);
  const visit = async (route, ready) => {
    await page.evaluate((r) => { location.hash = '#' + r; }, route);
    await see(ready);
  };
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);

  await visit('/orders/o1?stage=release', '[data-panel="release"]');
  const hold = '[data-release-check="holds"][data-cue="blocked"]';
  assert.ok(await page.$(hold), '有效质量限制必须是可辨认的放行阻塞项');
  assert.equal(await page.$eval('[data-panel="release"] [data-release-check]', (el) => el.dataset.releaseCheck), 'holds', '有效质量限制排在第一项');
  await tap(hold + ' a');
  await see('[data-panel="quality-holds"]');
  await tap('[data-next-locate]');
  await focus('[data-work-action="approve-disposition"] button');
  assert.equal(await page.evaluate(() => window.__QMS.S.ncrs.find((n) => n.id === 'n1').disp.some((d) => d.approved)), false, '定位只聚焦，不批准处置');
  console.log('✓ 放行阻塞可追到不合格单，下一步准确定位且不代办');

  await visit('/orders/o1?stage=IPQC', '[data-order-locate]');
  assert.equal(await page.$eval('[aria-label="工单主线"] [data-stage="IPQC"]', (el) => el.getAttribute('aria-current')), 'step');
  await tap('[data-order-locate]');
  await focus('[data-op="20 精车"] button[data-check="IPQC"]');
  assert.equal(await page.evaluate(() => window.__QMS.UI.route.name), 'order', '工序定位不会直接开检');
  console.log('✓ 点击工单节点后能定位对应工序上的巡检入口');

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await setUser(page, 'u1');
  await visit('/inspect/t1', '.inspect-footer');
  const measure = '[aria-label="检验进度"] [data-inspect-step="measure"][aria-current="step"]';
  await see(measure);
  const input = 'input[data-next-field="true"]';
  await tap('.inspect-footer button');
  await focus(input);
  assert.equal(await page.$eval(input, (el) => el.getAttribute('data-card-cell')), '4', '定位的是首项未录完的第 5 样本');

  function fillDraft(id, reads, d = '') {
    const t = window.__QMS.S.tasks.find((x) => x.id === id), r = t.rounds.at(-1);
    for (const it of t.snap.items) {
      if (it.group === 'M') r.vals[it.cid].fill(reads[it.no - 1]);
      else r.cnt[it.cid].bad = '0';
    }
    r.dUnits = d;
  }
  await page.evaluate(fillDraft, 't1', ['20.00', '12.00', '36.00', '25.07', '0.370', '650000', '2120'], '4');
  await tap('.inspect-footer [data-inspect-action="count-total"] button');
  await focus('[data-d-units][data-next-field="true"]');
  assert.equal(await page.$eval('[data-d-units]', (el) => el.getAttribute('aria-invalid')), 'true');
  await page.$eval('[data-d-units]', (el) => { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await see('[data-inspect-step="submit"][aria-current="step"]');
  console.log('✓ 手机精准定位缺失读数及无效计数，修正后才进入签名');

  await page.evaluate(fillDraft, 't5', ['10.00', '62', '0.012']);
  await visit('/inspect/t5', '[data-inspect-step="photo"][aria-current="step"]');
  assert.match(await page.$eval('[data-inspect-step="photo"]', (el) => el.innerText), /待拍/);
  await tap('.inspect-footer [data-inspect-action="photo"] button');
  const picture = '.drawer-panel [title^="插入一张示例照片"]';
  await see(picture);
  assert.match(await page.$eval('.drawer-panel h3', (el) => el.innerText), /刃口外观/);
  await tap(picture);
  await tap('.drawer-panel [aria-label="关闭"]');
  await see('[data-inspect-step="submit"][aria-current="step"]');
  assert.deepEqual(log.errors, []);
  console.log('✓ 必拍照片显示为未完成步骤，直达对应特性，添加后切换到签名');
} finally {
  await browser.close();
}

/**
 * 冒烟测试：逐个路由打开，检查页面有内容、没有脚本错误；可选截图。
 *   node tests/smoke.mjs                       # 测 ./qms_pro_qms.html
 *   node tests/smoke.mjs --html index.html     # 测免构建的开发入口
 *   node tests/smoke.mjs --shots shots --viewport 390x844
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch, openApp, gotoRoute, setUser, ROOT } from './lib.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const ROUTES = [
  '/workbench', '/workbench?step=take', '/orders?f=mine', '/orders?f=released', '/orders/o1', '/orders/o2?stage=release', '/orders/oh64', '/orders/oh64?stage=release', '/orders/oh64/card',
  '/floor', '/trace', '/trace?q=DN-2611-007', '/scan/WO-2611-021', '/dashboard', '/orders', '/orders?wo=WO-2611-011', '/bubble', '/standards', '/standards/s1', '/plans', '/plans?tab=tpl', '/plans/pl1', '/plans/pl4',
  '/tasks', '/tasks/IQC', '/tasks/FIRST', '/tasks/IPQC', '/tasks/FQC', '/tasks/OQC',
  '/inspect/t1', '/inspect/t2', '/inspect/t3', '/inspect/t4', '/inspect/t5', '/inspect/t6',
  '/reports', '/reports/rt3-1', '/reports/rt4-1', '/reports/rt6-1', '/report-templates',
  '/ncr', '/ncr?tab=holds', '/ncr/n1', '/ncr/n2', '/ncr/n3',
  '/parts', '/parts?id=p2', '/routes', '/scenes', '/gauges', '/users', '/audit', '/settings', '/rd',
  '/ext/capa', '/ext/complaint', '/ext/supplier', '/ext/metrology', '/ext/msa', '/ext/spc', '/ext/audit', '/ext/docs', '/ext/training',
];
const USERS = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];

const html = resolve(arg('html', join(ROOT, 'qms_pro_qms.html')));
const routes = arg('routes', '') ? arg('routes', '').split(',').map((s) => s.trim()).filter(Boolean) : ROUTES;
const shots = arg('shots', '') ? resolve(arg('shots', '')) : '';
const viewport = arg('viewport', '1440x900');
const user = arg('user', 'u2');
if (shots) mkdirSync(shots, { recursive: true });

const browser = await launch();
const out = [];
let failed = 0;
try {
  const { page, log } = await openApp(browser, html, { viewport, user });
  const visit = async (route, label) => {
    log.clear();
    await gotoRoute(page, route, 700);
    const info = await page.evaluate(() => {
      const main = document.querySelector('main');
      const text = main ? main.innerText : '';
      return { len: text.length, missing: text.includes('页面建设中'), notFound: /不存在或已删除|模块不存在/.test(text), title: document.title };
    });
    const errs = log.errors.slice();
    if (info.len < 20) errs.push('页面内容为空');
    if (info.missing) errs.push('路由对应的页面没有注册');
    if (info.notFound) errs.push('页面显示“不存在”');
    let shot = '';
    if (shots) { shot = join(shots, label.replace(/[\/?=]/g, '_').replace(/^_/, '') + '.png'); await page.screenshot({ path: shot }); }
    const pass = !errs.length;
    if (!pass) failed++;
    out.push({ route: label, pass, title: info.title, errors: errs, shot });
    console.log((pass ? '✓ ' : '✗ ') + label + (pass ? '' : '\n    ' + errs.join('\n    ')));
  };
  for (const r of routes) await visit(r, r);
  if (!arg('routes', '')) {
    for (const u of USERS) { await setUser(page, u); await visit('/workbench', '/workbench@' + u); await visit('/ncr/n1', '/ncr/n1@' + u); }
  }
} finally {
  await browser.close();
}
console.log('\n' + (out.length - failed) + ' / ' + out.length + ' 通过');
if (arg('json', '')) console.log(JSON.stringify(out, null, 1));
process.exit(failed ? 1 : 0);

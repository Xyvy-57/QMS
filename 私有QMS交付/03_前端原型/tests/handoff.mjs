import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, launch, collect } from './lib.mjs';

let browser, pageUrl, guideUrl, extracted;
before(async () => {
  extracted = await mkdtemp(join(tmpdir(), 'Worlder 外部交付 '));
  const zip = join(ROOT,'demo','Worlder-QMS-工单实操演示.zip');
  execFileSync('python3', ['-c',"from zipfile import ZipFile\nimport sys\nwith ZipFile(sys.argv[1]) as z:\n assert sorted(z.namelist()) == sorted(['开始演示.html','演示讲解卡.html']) and z.testzip() is None\n z.extractall(sys.argv[2])",zip,extracted]);
  pageUrl = pathToFileURL(join(extracted,'开始演示.html')).href;
  guideUrl = pathToFileURL(join(extracted,'演示讲解卡.html')).href;
  browser = await launch();
});
after(async()=>{await browser?.close();});
async function start(t,width,fromGuide=false) {
  const context = await browser.createBrowserContext();
  t.after(()=>context.close());
  const page = await context.newPage(), log = collect(page), http = [];
  page.on('request',req=>{if(/^https?:/.test(req.url())) http.push(req.url());});
  await page.setOfflineMode(true);
  await page.setViewport({width,height:width>700?900:844,deviceScaleFactor:1});
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  page.setDefaultTimeout(5000);
  await page.goto(fromGuide ? guideUrl : pageUrl);
  if(fromGuide) await page.locator('a.start').click();
  try {await page.waitForSelector('[data-live-stage="patrol"]');}
  catch(e) {throw Error(e.message+' '+JSON.stringify(log.errors));}
  t.after(()=>{assert.deepEqual(log.errors,[]);assert.deepEqual(http,[]);});
  return page;
}
const click=(p,s)=>p.locator(s).setTimeout(5000).click();
const fill=(p,s,v)=>p.$eval(s,(el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},v);
const waitStage=(p,stage)=>p.waitForSelector('[data-live-stage="'+stage+'"]');
async function submit(p,from,to) {
  await waitStage(p,from);await click(p,'[data-live-submit]');
  try {await waitStage(p,to);} catch(e) {throw Error(from+' → '+to+': '+await p.$eval('.hw-form',el=>el.innerText));}
}
async function endChecks(p,stocked,scrap){
  const receipt=await p.$eval('.hw-closure',el=>el.innerText);
  assert.match(receipt,new RegExp(stocked+' 件入库合格 \\+ '+scrap+' 件报废'));
  await click(p,'::-p-aria(查看本次演示记录)');await p.waitForSelector('.hw-dialog[open]');
  assert.match(await p.$eval('.hw-dialog',el=>el.innerText),/出货检验/);
  await click(p,'.hw-record');
  assert.match(await p.$eval('.hw-dialog',el=>el.innerText),/报告|已复核/);
}

test('电脑从解压后的讲解卡开始，超差留证、分别审批、复测与两次发货直接操作至放行',async t=>{
  const p=await start(t,1440,true);
  assert.equal(await p.$eval('#live-reading',el=>el.value),'');
  await fill(p,'#live-reading','abc');assert.equal(await p.$eval('#live-verdict',el=>el.innerText),'格式有误');
  await fill(p,'#live-reading','20.10');assert.equal(await p.$eval('#live-verdict',el=>el.innerText),'符合');
  await fill(p,'#live-reading','20.12');assert.equal(await p.$eval('#live-verdict',el=>el.innerText),'高于上限');
  assert.ok(await p.$eval('[data-live-submit]',el=>el.disabled));await click(p,'[data-live-photo]');
  await submit(p,'patrol','scope');
  await fill(p,'[data-live-rework]','8');assert.ok(await p.$eval('[data-live-submit]',el=>el.disabled));
  await fill(p,'[data-live-rework]','5');await submit(p,'scope','approve');
  await click(p,'[data-live-line="报废"] .hw-line-action');
  assert.match(await p.$eval('[data-live-line="报废"]',el=>el.innerText),/已批准，待执行/);
  assert.match(await p.$eval('[data-live-line="返工"]',el=>el.innerText),/待批准/);
  await p.reload();await waitStage(p,'approve');assert.ok(await p.$eval('[data-live-submit]',el=>el.disabled));
  await click(p,'[data-live-line="返工"] .hw-line-action');await submit(p,'approve','execute');
  for(const action of ['返工','报废']) {
    await fill(p,`[aria-label="${action}执行凭据"]`,'已记录 '+action+' 208');
    await click(p,`[data-live-line="${action}"] .hw-line-action`);
  }
  await submit(p,'execute','retest');await fill(p,'#live-reading','20.13');await click(p,'[data-live-photo]');await click(p,'[data-live-submit]');
  await p.waitForFunction(()=>document.querySelector('.hw-context')?.innerText.includes('第 3 轮'));
  await fill(p,'#live-reading','20.00');await submit(p,'retest','verify');await submit(p,'verify','unhold');
  assert.match(await p.$eval('.hw-state',el=>el.innerText),/禁止发运/);
  for(const [from,to] of [['unhold','outside'],['outside','assembly'],['assembly','work'],['work','final'],['final','ship']]) await submit(p,from,to);
  await fill(p,'[data-live-qty]','100');await submit(p,'ship','shipInspect');await submit(p,'shipInspect','shipReview');await submit(p,'shipReview','ship');
  assert.equal(await p.$eval('[data-live-qty]',el=>el.value),'105');
  await fill(p,'[data-live-qty]','106');assert.ok(await p.$eval('[data-live-submit]',el=>el.disabled));
  await fill(p,'[data-live-qty]','105');await submit(p,'ship','shipInspect');await submit(p,'shipInspect','shipReview');await submit(p,'shipReview','release');
  assert.match(await p.$eval('.hw-checks',el=>el.innerText),/数量平衡/);await submit(p,'release','done');await endChecks(p,205,3);
});

test('手机从建单开始，改数量、巡检合格、两笔报工、交检和放行',async t=>{
  const p=await start(t,390);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),390);
  await click(p,'::-p-aria(重新演示)');await click(p,'input[type=radio][value=create]');await click(p,'::-p-aria(开始新一场演示)');
  await waitStage(p,'create');await fill(p,'[data-live-wo]','WO-现场演示');await fill(p,'[data-live-plan]','210');
  for(const [from,to] of [['create','iqc'],['iqc','first'],['first','firstReview'],['firstReview','startWork'],['startWork','patrol']]) await submit(p,from,to);
  await fill(p,'#live-reading','20.00');
  for(const [from,to] of [['patrol','outside'],['outside','assembly'],['assembly','work']]) await submit(p,from,to);
  await fill(p,'[data-live-qty]','30');await click(p,'[data-live-submit]');await p.waitForFunction(()=>document.querySelector('[data-live-qty]')?.value==='180');
  await submit(p,'work','final');await click(p,'[data-live-submit]');await p.waitForFunction(()=>document.querySelector('.hw-form .hw-spec')?.innerText.includes('180 件交检'));
  await submit(p,'final','ship');await fill(p,'[data-live-qty]','210');
  for(const [from,to] of [['ship','shipInspect'],['shipInspect','shipReview'],['shipReview','release'],['release','done']]) await submit(p,from,to);
  await endChecks(p,210,0); assert.match(await p.$eval('.hw-body',el=>el.innerText),/WO-现场演示/);
});

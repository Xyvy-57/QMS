import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { copyFile, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { openApp, launch, ROOT } from './lib.mjs';

let browser, html;
const frames = ['orders','create','intake','record','first','deviation','ncr','scope','approve','rework','retest','unhold','work','final','shipping','remaining','release','closed'];
/* 实拍画面只内嵌在单独的演示文件里（日常工作台 qms_pro_qms.html 不带），
   先运行 npm run delivery 或 node build.mjs --tour-out demo/工单操作演示.html */
const TOUR_HTML = join(ROOT, 'demo', '工单操作演示.html');
before(async () => {
  if (!existsSync(TOUR_HTML)) throw new Error('找不到 ' + TOUR_HTML + '，请先运行 npm run delivery');
  browser = await launch();
  html = join(await mkdtemp(join(tmpdir(),'worlder-tour-offline-')), 'qms.html');
  await copyFile(TOUR_HTML, html);
});
after(async () => { await browser?.close(); });
async function open(t, route, width=390, height=844) {
  const context=await browser.createBrowserContext();
  t.after(()=>context.close());
  const {page,log}=await openApp(context,html,{viewport:width+'x'+height,route});
  page.setDefaultTimeout(5500);
  await page.emulateMediaFeatures([{ name:'prefers-reduced-motion', value:'reduce' }]);
  t.after(()=>assert.deepEqual(log.errors,[]));
  return page;
}
const click=(p,selector)=>p.locator(selector).setTimeout(5500).click();
async function at(p,id) {
  await p.waitForFunction(id=>document.querySelector('.order-tour')?.dataset.tourStep===id && document.querySelector('.tour-hot') && document.querySelector('.tour-photo img')?.complete,{},id);
}
for(const [device,width,height,imageWidth] of [['web',1440,900,1360],['mobile',390,844,390]]) {
  test(device+' 从工作台点击全部实拍控件，离线查看整单放行',async t=>{
    const p=await open(t,'/workbench',width,height);
    await click(p,`.tour-entry-links a[href="#/demo/${device}"]`);
    for(const id of frames) {
      await at(p,id);
      const frame=await p.evaluate(()=>{
        const image=document.querySelector('.tour-photo img');
        const hot=document.querySelector('.tour-hot');
        const r=hot.getBoundingClientRect();
        return { width:image.naturalWidth, inline:image.src.startsWith('data:image/webp;base64,'), onScreen:hot.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)), overflow:document.documentElement.scrollWidth>innerWidth };
      });
      assert.deepEqual(frame,{width:imageWidth,inline:true,onScreen:true,overflow:false},device+'/'+id);
      await click(p,'.tour-hot');
    }
    assert.match(await p.$eval('.tour-end',el=>el.innerText),/208 件投入 = 205 件合格 \+ 3 件报废/);
    await click(p,'.tour-end button'); await at(p,'orders');
  });
}

test('切换端保持同一步，刷新续看，原图与播放可以暂停',async t=>{
  const p=await open(t,'/demo/mobile?step=approve');
  await at(p,'approve'); await click(p,'.tour-devices button:first-child'); await at(p,'approve');
  await p.waitForSelector('[data-tour-device="web"]');
  await p.reload(); await p.waitForFunction(()=>!document.querySelector('#boot')); await at(p,'approve');
  await click(p,'[aria-label="放大当前画面"]'); await p.waitForSelector('dialog[open]');
  await p.keyboard.press('Escape'); await p.waitForFunction(()=>!document.querySelector('dialog'));
  await click(p,'[data-tour-play]'); await at(p,'rework'); await click(p,'[data-tour-play]');
  assert.match(await p.$eval('[data-tour-play]',e=>e.innerText),/自动演示/);
  await click(p,'[aria-label="上一步"]'); await at(p,'approve');
});

test('两端实操共用 QMS 规则，刷新保留练习，重练只影响当前练习',async t=>{
  const p=await open(t,'/workbench');
  // 正常工作台先做一个本机标记，整个练习期间必须保留。
  await p.evaluate(()=>{window.__QMS.S.tourIsolationSentinel='original';});
  await p.waitForFunction(()=>JSON.parse(localStorage.getItem('worlder-qms-proto-v1'))?.tourIsolationSentinel==='original');
  const original=await p.evaluate(()=>localStorage.getItem('worlder-qms-proto-v1'));
  async function enter(key){
    await click(p,'.tour-practice-menu summary');
    await click(p,`[data-tour-case="${key}"]`);
    await p.waitForFunction(()=>!document.querySelector('#boot') && document.querySelector('.tour-practice-bar'));
  }
  async function back(){await click(p,'.tour-practice-actions a');await p.waitForFunction(()=>!document.querySelector('#boot'));await at(p,'orders');}
  await click(p,'a[href="#/demo/mobile"]'); await at(p,'orders');
  await enter('measure');
  const read='[data-card-cell="0"]';
  assert.equal(await p.$eval(read,e=>e.value),'');
  await p.$eval(read, e=>{e.value='20.12';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await p.waitForSelector('[data-card-cell="0"].cell-ng');
  await back(); await enter('approve');
  await click(p,'[data-disposition="报废"] [data-work-action="approve-disposition"] button');
  const states=()=>p.evaluate(()=>window.__QMS.S.ncrs[0].disp.map(d=>[d.action,!!d.approved]));
  assert.deepEqual(await states(),[['返工',false],['报废',true]]);
  await p.reload(); await p.waitForFunction(()=>!document.querySelector('#boot') && window.__QMS); assert.equal((await states())[1][1],true);
  await click(p,'.tour-practice-actions button');
  await p.waitForFunction(()=>!document.querySelector('#boot') && window.__QMS?.S.ncrs[0]?.disp.every(d=>!d.approved));
  await back(); await enter('ship');
  await click(p,'[data-test="stage-act"]'); await p.waitForSelector('#order-lot-qty');
  assert.equal(await p.$eval('#order-lot-qty', e=>e.value),'105');
  await p.$eval('#order-lot-qty', e=>{e.value='106';e.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.ok(await p.$eval('[data-create-order-lot] button',e=>e.disabled));
  await p.$eval('#order-lot-qty', e=>{e.value='105';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await click(p,'[data-create-order-lot] button'); await p.waitForSelector('.inspect-footer');
  assert.equal(await p.evaluate(()=>window.__QMS.S.tasks[0].lot),105);
  await back();
  assert.equal(await p.evaluate(()=>localStorage.getItem('worlder-qms-proto-v1')),original);
});

test('桌面上能进入 390px 的真实手机审批，返回时保留导览位置',async t=>{
  const p=await open(t,'/demo/mobile?step=approve',1440,900);
  await at(p,'approve'); await click(p,'.tour-practice-menu summary'); await click(p,'[data-tour-case="approve"]');
  const handle=await p.waitForSelector('iframe[title="可操作的手机工位"]');
  const frame=await handle.contentFrame();
  await frame.waitForFunction(()=>!document.querySelector('#boot') && document.querySelector('[data-disposition="报废"]'));
  assert.equal(await frame.evaluate(()=>innerWidth),390);
  await frame.locator('[data-disposition="报废"] [data-work-action="approve-disposition"] button').click();
  const row=await frame.$eval('[data-disposition="报废"]',el=>el.innerText);
  assert.match(row,/已批准，待执行/);
  await click(p,'.tour-phone-info a'); await at(p,'approve');
});

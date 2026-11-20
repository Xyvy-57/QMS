/** 在临时 Chrome 配置中运行同一张工单。画面与点击框取自同一帧的真实页面。 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, openApp, ROOT } from '../tests/lib.mjs';

const workdir = await mkdtemp(join(tmpdir(), 'worlder-order-tour-'));
const exercises = {};
const sizes = { web: [1360, 800], mobile: [390, 780] };
const crew = { production: 'u4', inspector: 'u1', engineer: 'u2', quality: 'u3', warehouse: 'u5' };

// 将重复的读数和演示签名补入真实检验引擎，结论、报告与放行仍由产品计算。
function installFixture() {
  const q = window.__QMS, wo = 'WO-DEMO-208';
  const order = () => q.S.orders.find(o => o.wo === wo);
  const rounds = {};
  function evidence(label) {
    const c = document.createElement('canvas'); c.width = 240; c.height = 80;
    const ctx = c.getContext('2d'); ctx.fillStyle='#edf3f3'; ctx.fillRect(0,0,240,80);
    ctx.fillStyle='#225456'; ctx.font='16px sans-serif'; ctx.fillText('演示记录 · WO-DEMO-208',10,27);
    ctx.fillText(label,10,57); return c.toDataURL();
  }
  function create(key, scene, op, ctx = {}, lot = '') {
    const plan = q.S.plans.find(p => p.partId === 'p1' && p.status === 'effective' && p.scenes.includes(scene));
    const task = q.createTask({scene,planId:plan.id,lot,ctx:{wo,op,...ctx},assignee:'u1'});
    rounds[key] = task.id;
    return task.id;
  }
  const task = key => q.S.tasks.find(t => t.id === rounds[key]);
  function measure(key, fail = false) {
    const t=task(key), r=t.rounds.at(-1); t.status='active';
    for (const it of t.snap.items) {
      if (it.group==='C') { r.cnt[it.cid].bad='0'; continue; }
      const lo = it.lsl === '' || it.lsl == null ? null : +it.lsl;
      const hi = it.usl === '' || it.usl == null ? null : +it.usl;
      const precision=Math.max(...[it.lsl,it.usl].map(v => (String(v).split('.')[1] || '').length));
      const ok=lo == null ? hi * .9 : hi == null ? lo * 1.02 : (lo+hi)/2;
      r.vals[it.cid].fill(ok.toFixed(precision));
      if (fail && it.no===1) r.vals[it.cid][0]='20.12';
    }
    r.dUnits='0';
    for (const it of q.photoViolations(t,r,q.evalRound(t,r))) r.photos.push({id:'tour-'+it.cid,cid:it.cid,url:evidence(it.name),at:new Date().toISOString(),by:q.S.me});
    return t.id;
  }
  function sign(key) {
    const t=task(key), rep=q.submitRound(t,t.rounds.at(-1),{sigImg:evidence('李敏 · 模拟签名')});
    if(rep.state==='review') { q.S.me='u3'; q.approveReport(rep,evidence('周岚 · 模拟复核')); q.S.me='u1'; }
    return rep.id;
  }
  window.tourFixture={q,wo,order,rounds,create,task,measure,sign,evidence};
}

async function capture(browser, device) {
  const [width,height]=sizes[device];
  const context=await browser.createBrowserContext();
  const {page,log}=await openApp(context,join(ROOT,'qms_pro_qms.html'),{user:crew.production,route:'/orders',viewport:width+'x'+height});
  page.setDefaultTimeout(6500);
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.addStyleTag({content:'.shop-toasts{display:none!important}'});
  await page.evaluate(installFixture);
  const captures={};
  const operate=(fn,arg)=>page.evaluate(fn,arg);
  const actor=(role)=>operate(id=>{ window.__QMS.S.me=id; },crew[role]);
  const settle=async()=>{ await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))); await page.waitForFunction(()=>!document.querySelector('.page-leave-active,.page-enter-active,.modal-leave-active,.modal-enter-active')); };
  const visit=async path=>{ await operate(path=>window.__QMS.go(path),path); await page.waitForFunction(path=>window.__QMS.UI.route.path===path.split('?')[0],{},path); await settle(); };
  const ready=s=>page.waitForSelector(s,{visible:true});
  async function control(s) {
    if (!s.startsWith('@')) return ready(s);
    const name=s.slice(1);
    return page.waitForFunction(name=>[...document.querySelectorAll('button')].find(el=>el.innerText.trim()===name && !el.disabled && el.getClientRects().length),{},name);
  }
  const click=async s=>{const el=await control(s);await el.click();await settle();};
  const fill=(s,v)=>page.$eval(s,(el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},v);
  async function snapshotExercise(key, path) {
    if (device !== 'web') return;
    exercises[key] = await operate(({key, path}) => {
      const f = tourFixture;
      const state = f.q.S;
      const order = f.order();
      const tasks = state.tasks.filter(t => t.ctx.wo === order.wo);
      const taskIds = new Set(tasks.map(t => t.id));
      const ncrs = state.ncrs.filter(n => n.batch === order.wo || taskIds.has(n.taskId));
      const reports = state.reports.filter(r => taskIds.has(r.taskId));
      const codes = new Set([order.wo, ...[...tasks, ...reports, ...ncrs].map(row => row.code)]);
      const audit = state.audit.filter(entry => codes.has(entry.obj));
      const sample = JSON.parse(JSON.stringify({order, tasks, ncrs, reports, audit, path, me:state.me, seq:state.seq}));
      if (key === 'measure') {
        const patrol = sample.tasks.find(t => t.id === f.rounds.patrol);
        patrol.rounds[0].vals[patrol.snap.items.find(it => it.no === 1).cid][0] = '';
      }
      return sample;
    }, {key, path});
  }
  async function snap(id,selector) {
    await settle();
    const target=await control(selector);
    await target.evaluate(el=>{
      const r=el.getBoundingClientRect();
      if (r.top<65 || r.bottom>innerHeight-12 || !el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))) el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    });
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const box=await target.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,visible:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});
    assert.ok(box.visible && box.w>0 && box.h>0, `${device}/${id} 操作位置被遮挡 ${JSON.stringify(box)}`);
    captures[id]=[box.x/width,box.y/height,box.w/width,box.h/height].map(n=>+n.toFixed(5));
    await page.screenshot({path:join(workdir,`${device}-${id}.webp`), type:'webp',quality:86});
    console.log(device,id);
  }
  try {
    await snap('orders','[data-new-order] button'); await click('[data-new-order] button');
    await ready('#new-order-wo'); await fill('#new-order-wo','WO-DEMO-208'); await page.select('#new-order-part','p1'); await fill('#new-order-qty','208');
    await snap('create','[data-create-order] button'); await click('[data-create-order] button'); await ready('.order-track');
    const orderPath=await operate(()=>{const o=tourFixture.order();o.inLots=['IN-208-A'];o.outLot='FG-208-A';return '/orders/'+o.id;});
    await actor('inspector');
    await snap('intake','[data-op="10 毛坯来料"] [data-check="IQC"]');
    const iqc=await operate(()=>tourFixture.create('iqc','IQC','10 毛坯来料',{batch:'IN-208-A',supplier:'华研精密（示例）'},208));
    await visit('/inspect/'+iqc);await operate(()=>tourFixture.measure('iqc')); await snap('record','[data-inspect-action="submit"] button'); await operate(()=>tourFixture.sign('iqc'));
    await visit(orderPath+'?stage=FIRST'); await snap('first','[data-op="20 精车"] [data-check="FIRST"]'); await click('[data-op="20 精车"] [data-check="FIRST"]'); await ready('.inspect-footer');
    await operate(()=>{const f=tourFixture;f.rounds.first=f.q.UI.route.params.id;f.measure('first');f.sign('first');f.q.S.me='u4';f.q.reportWork(f.order(),{op:'20 精车',machine:'CNC-02',qtyIn:208,good:208,bad:0});f.q.S.me='u1';});
    const patrol=await operate(()=>{const f=tourFixture;f.create('patrol','IPQC','20 精车',{machine:'CNC-02',freq:'每 2 小时'});return f.measure('patrol',true);});
    await visit('/inspect/'+patrol); await snapshotExercise('measure','/inspect/'+patrol); await snap('deviation',device==='web'?'input[data-r="0"][data-c="0"]':'[data-card-cell="0"]');
    await operate(()=>tourFixture.sign('patrol'));await snap('ncr','@登记不合格');
    const ncr=await operate(()=>{const f=tourFixture,t=f.task('patrol'),r=t.rounds[0];const n=f.q.createNcr({title:'精车巡检 · 轴直径超上限',partId:'p1',batch:f.wo,taskId:t.id,roundId:r.id,cids:[t.snap.items[0].cid],qtySuspect:8,desc:'S1 实测 20.12 mm，上限 20.10 mm。隔离同机台 8 件。'});return n.id;});
    await actor('engineer');await visit('/ncr/'+ncr);await click('[data-work-action="scope-ncr"] button');
    await ready('.modal-panel input[inputmode="numeric"]');
    await page.$$eval('.modal-panel input[inputmode="numeric"]',inputs=>{inputs[1].value='8';inputs[1].dispatchEvent(new Event('input',{bubbles:true}));}); await page.select('.modal-panel select','工单');
    await snap('scope','@确认');await click('@确认');
    for(const [action,qty,reason] of [['返工',5,'修正刀补后重车，并对这 5 件复检'],['报废',3,'剩余加工余量不足，记录报废凭据']]) {
      await click('[data-work-action="add-disposition"] button');await ready('.modal-panel textarea');await page.select('.modal-panel select',action);await fill('.modal-panel input[inputmode="numeric"]',String(qty));await fill('.modal-panel textarea',reason);await click('@添加');
    }
    await click('[data-work-action="submit-mrb"] button');await actor('quality');
    await snapshotExercise('approve', '/ncr/'+ncr);
    await snap('approve','[data-disposition="报废"] [data-work-action="approve-disposition"] button');await click('@批准报废 3 件');await snap('rework','[data-disposition="返工"] [data-work-action="approve-disposition"] button');await click('@批准返工 5 件');
    await actor('engineer');
    for(const [action,note] of [['返工','5 件重车，返工记录 RW-208'],['报废','3 件报废，报废单 SC-208']]) {
      await click(`[data-disposition="${action}"] [data-work-action="execute-disposition"] button`);await ready('.modal-panel textarea');await fill('.modal-panel textarea',note);await click('@登记');
    }
    await snap('retest','[data-work-action="retest-ncr"] button');
    await operate(ncr=>{const f=tourFixture,t=f.task('patrol');f.q.createRetestRound(t,{reason:'返工后复测轴直径',ncrId:ncr});f.q.S.me='u1';f.measure('patrol');f.sign('patrol');},ncr);
    await actor('quality');await click('[data-work-action="verify-ncr"] button');await ready('.modal-panel textarea');await fill('.modal-panel textarea','返工件复检合格，报废凭据已核对。');await click('@验证通过并关闭');
    await snap('unhold','[data-work-action="release-hold"] button');await click('[data-work-action="release-hold"] button');await ready('.modal-panel textarea');await fill('.modal-panel textarea','复检第 2 轮符合，处置执行记录核对完成。');await click('@确认解除');
    await actor('inspector');await operate(()=>{const f=tourFixture;f.create('outside','IQC','30 电镀（外协）',{batch:'OUT-208-A'},205);f.measure('outside');f.sign('outside');f.create('assembly','IPQC','40 装配',{freq:'每班 1 次'});f.measure('assembly');f.sign('assembly');});
    await actor('production');await visit(orderPath);await click('[data-op="50 终检"] [data-work]');await ready('#work-good');await fill('#work-good','205');await snap('work','[data-work-submit] button');await click('[data-work-submit] button');await ready('[data-receipt]');
    await actor('inspector');await click('[data-op="50 终检"] [data-check="FQC"]');await ready('#order-lot-qty');assert.equal(await page.$eval('#order-lot-qty',e=>e.value),'205');await snap('final','[data-create-order-lot] button');await click('[data-create-order-lot] button');await ready('.inspect-footer');
    await operate(()=>{const f=tourFixture;f.rounds.final=f.q.UI.route.params.id;f.measure('final');f.sign('final');});
    for (const [key,n,delivery] of [['shipping',100,'DN-208-A'],['remaining',105,'DN-208-B']]) {
      await visit(orderPath);
      if (key==='remaining') await snapshotExercise('ship',orderPath+'?stage=OQC');
      await click(key==='shipping'?'[data-check="OQC"]':'[data-next-lot="OQC"]');await ready('#order-lot-qty');
      assert.equal(await page.$eval('#order-lot-qty',e=>e.value),key==='shipping'?'205':'105');
      await fill('#order-lot-qty',String(n));await fill('#order-shipment',delivery);await snap(key,'[data-create-order-lot] button');await click('[data-create-order-lot] button');await ready('.inspect-footer');
      await operate(key=>{const f=tourFixture;f.rounds[key]=f.q.UI.route.params.id;f.measure(key);f.sign(key);},key);
    }
    await actor('quality');await visit(orderPath);await ready('[data-test="stage-act"]');
    assert.equal(await page.$eval('[data-test="stage-act"]',e=>e.innerText.trim()),'质量放行');
    await click('[data-test="stage-act"]');await snap('release','@确认放行');await click('@确认放行');
    await page.waitForFunction(()=>!!tourFixture.order().releasedAt);
    await actor('warehouse');await snap('closed','[data-stage="release"]');
    const ledger=await operate(()=>{const f=tourFixture,q=f.q.orderQty(f.order());return [q.input,q.stocked,q.scrap,f.q.mainlineOf(f.order()).state,f.task('patrol').rounds.map(r=>r.result.overall)];});
    assert.deepEqual(ledger,[208,205,3,'released',['fail','pass']]);assert.deepEqual(log.errors,[]);
    return captures;
  } catch (err) {
    console.error(device,await page.url(),await page.evaluate(()=>({message:document.querySelector('.modal-panel')?.innerText || document.querySelector('main')?.innerText?.slice(0,380),toasts:window.__QMS.UI.toasts.map(t=>t.text),errors:document.querySelector('[role="alert"]')?.innerText})),log.errors);
    throw err;
  } finally { await context.close(); }
}
const browser=await launch();
try {
  const bounds={};
  for(const device of Object.keys(sizes)) bounds[device]=await capture(browser,device);
  assert.deepEqual(Object.keys(bounds.web),Object.keys(bounds.mobile));
  // 两个视口的全流程都通过后才更新可交付的素材。
  for(const device of Object.keys(sizes)) {
    const dir=join(ROOT,'demo','frames',device);await mkdir(dir,{recursive:true});
    for(const id of Object.keys(bounds[device])) await copyFile(join(workdir,`${device}-${id}.webp`),join(dir,id+'.webp'));
  }
  await writeFile(join(ROOT,'src','81_tour_frames.js'),'/* 由 scripts/capture-order-tour.mjs 从目标控件实测生成，坐标相对于截图。 */\nconst TOUR_BOUNDS = '+JSON.stringify(bounds,null,2)+';\n');
  await writeFile(join(ROOT,'src','83_tour_cases.js'), '/* 导览实操起点，由 scripts/capture-order-tour.mjs 从隔离的演示工单生成。 */\nconst TOUR_CASES = '+JSON.stringify(exercises)+';\n');
  console.log('两端均通过放行核对。每端 '+Object.keys(bounds.web).length+' 帧。');
} finally { await browser.close(); }

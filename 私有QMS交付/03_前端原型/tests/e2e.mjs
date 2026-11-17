/**
 * 规则与主链端到端测试（在真实浏览器里调用原型的领域动作，再检查页面能正常渲染）
 *   node tests/e2e.mjs [--html qms_pro_qms.html]
 * 覆盖：十进制判定与边界、抽样推荐、三层快照、计数判批（接受但有不良）、缺失≠0、拍照要求、
 *       复检新轮次保留原失败、报告复核独立性、签名绑定内容摘要、管理员无审批权、消息来源白名单、数据持久化、
 *       身份流程条（六种身份各自的步数、每一步可点、检验员在一张检验里点步骤不跳走）。
 */
import { join, resolve } from 'node:path';
import { launch, openApp, gotoRoute, setUser, sleep, checker, ROOT } from './lib.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const html = resolve(arg('html', join(ROOT, 'qms_pro_qms.html')));

const browser = await launch();
const c = checker();
let pageErrors = [];
try {
  const { page, log } = await openApp(browser, html, { user: 'u2' });

  /* 页面内的辅助函数：按规格生成合格读数、填满一轮、加照片 */
  await page.evaluate(() => {
    const Q = window.__QMS;
    const dec = (s) => (String(s).split('.')[1] || '').length;
    window.__T = {
      okVal(it, i) {
        const l = it.lsl ? parseFloat(it.lsl) : null, u = it.usl ? parseFloat(it.usl) : null;
        if (l != null && u != null) return ((l + u) / 2 + (u - l) * 0.05 * (i % 3 - 1)).toFixed(Math.max(dec(it.lsl), dec(it.usl)));
        if (l != null) return (l * 1.04).toFixed(dec(it.lsl));
        return (u * 0.5).toFixed(dec(it.usl) + 1);
      },
      fill(task, round, skip) {
        task.snap.items.forEach((it) => {
          if (it.group === 'M') round.samples.forEach((s, i) => { if (!(skip && skip(it, i))) round.vals[it.cid][i] = window.__T.okVal(it, i); });
          if (it.group === 'C') round.cnt[it.cid].bad = '0';
        });
      },
      photo(round, cid) { round.photos.push({ id: 'ph-test-' + round.photos.length, url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', cid, at: new Date().toISOString(), by: Q.S.me }); },
      appearancePhotos(task, round) { task.snap.items.filter((i) => i.cat === '外观').forEach((i) => window.__T.photo(round, i.cid)); },
      last(task) { return task.rounds[task.rounds.length - 1]; },
      attempt(fn) { try { fn(); return ''; } catch (e) { return e.message || String(e); } },
      SIG: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
    };
  });

  console.log('\n[1] 十进制判定与抽样规则');
  const r1 = await page.evaluate(() => {
    const Q = window.__QMS;
    return {
      over: Q.judgeValue('10.0200000000000001', { lsl: '', usl: '10.02' }),
      edgeHi: Q.judgeValue('10.02', { lsl: '9.98', usl: '10.02' }), edgeLo: Q.judgeValue('9.980', { lsl: '9.98', usl: '10.02' }),
      low: Q.judgeValue('9.9799', { lsl: '9.98', usl: '10.02' }), blank: Q.judgeValue('  ', { lsl: '1', usl: '2' }), bad: Q.judgeValue('12,01', { lsl: '1', usl: '20' }),
      cmp: [Q.cmpDec('0.30', '0.3'), Q.cmpDec('-1.5', '1.5'), Q.cmpDec('1e3', '1')],
      aqlK: Q.aqlSuggest(1241, '1.0'), aqlBad: Q.aqlSuggest('12.5', '1.0'), aqlUnsupported: Q.aqlSuggest(60, '0.65'),
    };
  });
  c.ok('上限 10.02、实测 10.0200000000000001 判为超差', r1.over === 'high', r1.over);
  c.ok('规格限含边界：等于上限 / 下限均符合', r1.edgeHi === 'ok' && r1.edgeLo === 'ok', r1.edgeHi + ' / ' + r1.edgeLo);
  c.ok('低于下限判为不符合', r1.low === 'low', r1.low);
  c.ok('空值为缺失、格式错误为无效（都不当作 0）', r1.blank === 'missing' && r1.bad === 'invalid', r1.blank + ' / ' + r1.bad);
  c.ok('十进制比较：0.30 = 0.3，-1.5 < 1.5，科学计数法不接受', r1.cmp[0] === 0 && r1.cmp[1] === -1 && r1.cmp[2] === null, JSON.stringify(r1.cmp));
  c.ok('批量 1241、AQL 1.0 → 字码 K，n=125，Ac 3 / Re 4', r1.aqlK.letter === 'K' && r1.aqlK.n === 125 && r1.aqlK.ac === 3 && r1.aqlK.re === 4, JSON.stringify(r1.aqlK));
  c.ok('非整数批量被拒绝；子集外的组合不推算', !!r1.aqlBad.error && r1.aqlUnsupported.unsupported === true, JSON.stringify([r1.aqlBad, r1.aqlUnsupported]));

  console.log('\n[2] 来料检验：计数抽样接受但发现不良（A02）、拍照要求、三层快照');
  const r2 = await page.evaluate(() => {
    const Q = window.__QMS, T = window.__T;
    const t = Q.createTask({ scene: 'IQC', planId: 'pl1', lot: '1241', ctx: { supplier: '测试供应商', batch: 'E2E-A' } });
    const r = T.last(t);
    T.fill(t, r);
    r.cnt['CH-011-09'].bad = '1';
    const ev = Q.evalRound(t, r);
    const noPhoto = T.attempt(() => Q.submitRound(t, r, { sigImg: T.SIG }));
    T.photo(r, 'CH-011-09');
    const noSig = T.attempt(() => Q.submitRound(t, r, {}));
    const rep = Q.submitRound(t, r, { sigImg: T.SIG });
    const again = T.attempt(() => Q.submitRound(t, r, { sigImg: T.SIG }));
    const badLot = T.attempt(() => Q.createTask({ scene: 'IQC', planId: 'pl1', lot: '12.5' }));
    const wrongScene = T.attempt(() => Q.createTask({ scene: 'OQC', planId: 'pl1', lot: '100' }));
    return { id: t.id, snap: [t.snap.scene.code, t.snap.std.code + t.snap.std.rev, t.snap.plan.code + '#' + t.snap.plan.rev], overall: ev.overall, c: ev.c.result, d: ev.c.d, noPhoto, noSig, status: t.status, repState: rep.state, repCode: rep.code, again, badLot, wrongScene };
  });
  c.ok('建单冻结场景、标准、方案三层快照', r2.snap[0] === 'IQC' && r2.snap[1] === 'STD-011A' && r2.snap[2] === 'PL-011-IQC#2', JSON.stringify(r2.snap));
  c.ok('d=1 ≤ Ac=3：批接受，本轮结论符合（不良件另行处置）', r2.overall === 'pass' && r2.c === 'accept' && r2.d === 1, JSON.stringify([r2.overall, r2.c, r2.d]));
  c.ok('不合格项没有照片时不能提交', /拍照/.test(r2.noPhoto), r2.noPhoto);
  c.ok('没有手写签名时不能提交', /签名/.test(r2.noSig), r2.noSig);
  c.ok('提交后任务合格；来料场景无需复核，报告直接冻结', r2.status === 'pass' && r2.repState === 'frozen', r2.status + ' / ' + r2.repState);
  c.ok('报告编号带场景前缀', /^RPT-IQC-\d{8}-\d{3}$/.test(r2.repCode), r2.repCode);
  c.ok('已提交的轮次不能重复提交', /已提交/.test(r2.again), r2.again);
  c.ok('含计数组的方案拒绝非整数批量；方案不适用的场景被拒绝', /批量/.test(r2.badLot) && /场景/.test(r2.wrongScene), r2.badLot + ' / ' + r2.wrongScene);

  console.log('\n[3] 完工检验：缺失不等于 0，证据不足（A03）');
  const r3 = await page.evaluate(() => {
    const Q = window.__QMS, T = window.__T;
    const t = Q.createTask({ scene: 'FQC', planId: 'pl4', lot: '500', ctx: { wo: 'WO-E2E', batch: 'E2E-F' } });
    const r = T.last(t);
    T.fill(t, r, (it, i) => it.no === 1 && i === 4);
    T.appearancePhotos(t, r);
    const ev = Q.evalRound(t, r);
    const noReason = T.attempt(() => Q.submitRound(t, r, { sigImg: T.SIG }));
    const rep = Q.submitRound(t, r, { sigImg: T.SIG, missingReason: '样本 S5 外送检测未回' });
    return { id: t.id, overall: ev.overall, missing: ev.missingCells.length, noReason, status: t.status, reportOverall: rep.content.result.overall, stored: rep.content.round.vals[t.snap.items[0].cid][4] };
  });
  c.ok('缺 1 个读数时结论为证据不足，而不是合格', r3.overall === 'incomplete' && r3.missing === 1, r3.overall + ' / ' + r3.missing);
  c.ok('缺失时必须填写原因才能提交', /缺失/.test(r3.noReason), r3.noReason);
  c.ok('任务状态为证据不足，报告里缺失值保持为空（不补值）', r3.status === 'insufficient' && r3.reportOverall === 'incomplete' && r3.stored === '', JSON.stringify([r3.status, r3.reportOverall, r3.stored]));

  console.log('\n[4] 过程检验不合格 → NCR → 复检新轮次保留原失败（A09）');
  const r4 = await page.evaluate(() => {
    const Q = window.__QMS, T = window.__T;
    const t = Q.createTask({ scene: 'IPQC', planId: 'pl2', ctx: { wo: 'WO-E2E-2', op: '20 精车', freq: '每 2 小时' } });
    const r = T.last(t);
    T.fill(t, r);
    r.vals['CH-011-01'][0] = '20.11';
    T.photo(r, 'CH-011-01');
    const rep1 = Q.submitRound(t, r, { sigImg: T.SIG });
    const n = Q.createNcr({ title: 'E2E 轴径超差', partId: t.partId, taskId: t.id, roundId: r.id, cids: ['CH-011-01'], qtySuspect: 20 });
    const early = T.attempt(() => Q.createRetestRound(t, { reason: '' }));
    const r2 = Q.createRetestRound(t, { reason: '返工后复检', sampleMode: 'subset', samples: [r.samples[0]], ncrId: n.id });
    const statusAfterRetestStart = t.status;
    T.fill(t, r2);
    const rep2 = Q.submitRound(t, r2, { sigImg: T.SIG });
    return { id: t.id, ncrId: n.id, ncrCode: n.code, ncrStatus: n.status, first: t.rounds[0].result.overall, firstVal: t.rounds[0].vals['CH-011-01'][0], status1: rep1.content.result.overall, early, round2: { no: r2.no, parent: r2.parent === r.id, samples: r2.samples.length, ncr: r2.ncrId === n.id }, statusAfterRetestStart, final: t.status, reports: t.reportIds.length, rep2Code: rep2.code, holds: n.holds.length };
  });
  c.ok('超上限 0.01 判为不合格', r4.status1 === 'fail', r4.status1);
  c.ok('登记 NCR：状态“已登记”，且不自动建立任何质量限制', r4.ncrStatus === 'registered' && r4.holds === 0 && /^NCR-\d{4}-\d{4}$/.test(r4.ncrCode), JSON.stringify([r4.ncrStatus, r4.holds, r4.ncrCode]));
  c.ok('复检必须填写原因', /原因/.test(r4.early), r4.early);
  c.ok('复检是新轮次：记录父轮次、原样本子集、关联 NCR', r4.round2.no === 2 && r4.round2.parent && r4.round2.samples === 1 && r4.round2.ncr, JSON.stringify(r4.round2));
  c.ok('复检符合后任务合格，但第 1 轮的不合格记录与原值保留', r4.final === 'pass' && r4.first === 'fail' && r4.firstVal === '20.11', JSON.stringify([r4.final, r4.first, r4.firstVal]));
  c.ok('两轮各有一份报告，复检报告编号带 -R2', r4.reports === 2 && /-R2$/.test(r4.rep2Code), r4.reports + ' / ' + r4.rep2Code);

  console.log('\n[5] 生产首件：报告复核、独立性与签名校验（A12–A15）');
  const r5 = await page.evaluate(() => {
    const Q = window.__QMS, T = window.__T;
    const t = Q.createTask({ scene: 'FIRST', planId: 'pl3', ctx: { wo: 'WO-E2E-3', op: '40 精车', machine: 'CNC-03' } });
    const r = T.last(t);
    T.fill(t, r);
    const rep = Q.submitRound(t, r, { sigImg: T.SIG });
    const state0 = rep.state;
    const byQe = T.attempt(() => Q.approveReport(rep, T.SIG));
    Q.S.me = 'u6';
    const adminCan = Q.can('report.review') || Q.can('std.approve') || Q.can('ncr.approve') || Q.can('hold.release');
    const byAdmin = T.attempt(() => Q.approveReport(rep, T.SIG));
    Q.S.me = 'u3';
    const noSig = T.attempt(() => Q.approveReport(rep, ''));
    Q.approveReport(rep, T.SIG);
    const valid = rep.sigs.map((s) => Q.sigValid(rep, s));
    rep.content.round.vals[t.snap.items[0].cid][0] = '999';
    const validAfterTamper = rep.sigs.map((s) => Q.sigValid(rep, s));
    Q.S.me = 'u2';
    return { id: t.id, repId: rep.id, state0, byQe, adminCan, byAdmin, noSig, state1: rep.state, sigs: rep.sigs.map((s) => s.kind), valid, validAfterTamper };
  });
  c.ok('首件场景提交后报告进入待复核', r5.state0 === 'review', r5.state0);
  c.ok('质量工程师没有复核权限', /无权限/.test(r5.byQe), r5.byQe);
  c.ok('系统管理员没有任何质量审批权（A15）', r5.adminCan === false && /无权限/.test(r5.byAdmin), r5.adminCan + ' / ' + r5.byAdmin);
  c.ok('复核必须手写签名', /签名/.test(r5.noSig), r5.noSig);
  c.ok('质量负责人复核后报告为已批准，含检验与复核两个签名', r5.state1 === 'approved' && r5.sigs.join() === '检验,复核', r5.state1 + ' / ' + r5.sigs.join());
  c.ok('签名绑定内容摘要：内容被改动后签名失效（A13）', r5.valid.every(Boolean) && r5.validAfterTamper.every((v) => v === false), JSON.stringify([r5.valid, r5.validAfterTamper]));

  console.log('\n[6] 气泡服务消息：来源白名单与同步收件箱');
  const r6 = await page.evaluate(() => {
    const Q = window.__QMS, src = { postMessage() {} };
    const n0 = Q.S.syncInbox.length;
    Q.onBubbleMessage({ origin: 'https://evil.example.com', data: { type: 'worlder.balloon.frozen', payload: { drawingNo: 'DWG-2026-011', drawingRev: 'Z9' } }, source: src });
    const n1 = Q.S.syncInbox.length, st1 = Q.UI.bubble.status;
    const ok = String(Q.S.settings.allowedOrigins).split(/[\s,;]+/).filter(Boolean)[0];
    Q.onBubbleMessage({ origin: ok, data: { type: 'worlder.ready' }, source: src });
    const st2 = Q.UI.bubble.status;
    Q.onBubbleMessage({ origin: ok, data: { type: 'worlder.balloon.frozen', payload: { syncBatchId: 'SYNC-E2E', drawingNo: 'DWG-2026-018', drawingRev: 'B' } }, source: src });
    Q.onBubbleMessage({ origin: ok, data: { type: 'worlder.balloon.frozen', payload: { syncBatchId: 'SYNC-E2E', drawingNo: 'DWG-2026-018', drawingRev: 'B' } }, source: src });
    const rec = Q.S.syncInbox.find((x) => x.syncBatchId === 'SYNC-E2E');
    return { n0, n1, st1, st2, n2: Q.S.syncInbox.length, recStatus: rec && rec.status };
  });
  c.ok('非白名单来源的消息被丢弃', r6.n1 === r6.n0 && r6.st1 !== 'handshake', JSON.stringify(r6));
  c.ok('白名单来源握手成功', r6.st2 === 'handshake', r6.st2);
  c.ok('只带通知的冻结消息进入收件箱并标记为待后端拉取；同一批次号重复送达不重复入箱', r6.n2 === r6.n0 + 1 && r6.recStatus === 'fetching', JSON.stringify(r6));

  console.log('\n[7] 页面渲染与数据持久化');
  log.clear();
  for (const route of ['/inspect/' + r2.id, '/inspect/' + r3.id, '/inspect/' + r4.id, '/reports/' + r5.repId, '/ncr/' + r4.ncrId, '/tasks', '/reports', '/ncr', '/workbench']) await gotoRoute(page, route, 500);
  c.ok('新建的任务、报告、NCR 页面渲染无脚本错误', log.errors.length === 0, log.errors.join(' | '));
  await sleep(700);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__QMS && !document.getElementById('boot'), { timeout: 45000 });
  const r7 = await page.evaluate((ids) => { const Q = window.__QMS; return { task: !!Q.S.tasks.find((t) => t.id === ids.t), ncr: !!Q.S.ncrs.find((n) => n.id === ids.n), rounds: (Q.S.tasks.find((t) => t.id === ids.t) || { rounds: [] }).rounds.length }; }, { t: r4.id, n: r4.ncrId });
  c.ok('刷新后任务、轮次与 NCR 仍在（localStorage 持久化）', r7.task && r7.ncr && r7.rounds === 2, JSON.stringify(r7));

  console.log('\n[8] 界面权限：管理员看到的审批按钮置灰并说明原因');
  await setUser(page, 'u6');
  await gotoRoute(page, '/ncr/n1', 700);
  const r8 = await page.evaluate(() => { const tips = Array.from(document.querySelectorAll('.guard[data-tip]')); return { n: tips.length, sample: tips.length ? tips[0].getAttribute('data-tip') : '', disabled: tips.every((g) => g.querySelector('button').disabled) }; });
  c.ok('置灰按钮带无权限说明', r8.n > 0 && r8.disabled && /无权限/.test(r8.sample), JSON.stringify(r8));

  console.log('\n[9] 身份流程条：每种身份一条自己的流程，从左到右，每一步都能点');
  const FLOW = { u1: 5, u2: 6, u3: 6, u4: 5, u5: 3, u6: 3 };
  const BAR = '[aria-label="我的工作流程"] button[data-step]';
  const errs0 = log.errors.length, r9 = {};
  for (const uid of Object.keys(FLOW)) {
    await setUser(page, uid);
    await gotoRoute(page, '/tasks', 500);
    const keys = await page.evaluate((sel) => Array.from(document.querySelectorAll(sel)).map((b) => b.getAttribute('data-step')), BAR);
    const bad = [];
    for (const k of keys) {
      await gotoRoute(page, '/tasks', 400);
      await page.evaluate((sel, key) => { const b = Array.from(document.querySelectorAll(sel)).find((x) => x.getAttribute('data-step') === key); if (b) b.click(); }, BAR, k);
      await sleep(600);
      const st = await page.evaluate(() => { const m = document.querySelector('main'), t = m ? m.innerText : ''; return { hash: location.hash, broken: t.length < 20 || /页面建设中|不存在或已删除/.test(t) }; });
      if (st.broken) bad.push(k + ' → ' + st.hash);
    }
    r9[uid] = { n: keys.length, bad };
  }
  c.ok('流程步数：检验员 5、质量工程师 6、质量负责人 6、生产主管 5、仓库执行人 3、系统管理员 3', Object.keys(FLOW).every((u) => r9[u].n === FLOW[u]), JSON.stringify(r9));
  c.ok('每一步点了都能打开正常页面，且没有脚本错误', Object.keys(FLOW).every((u) => !r9[u].bad.length) && log.errors.length === errs0, JSON.stringify(r9) + ' ' + log.errors.slice(errs0).join(' | '));

  await setUser(page, 'u1');
  const mine = await page.evaluate(() => { const t = window.__QMS.S.tasks.find((x) => x.assignee === 'u1' && (x.status === 'pending' || x.status === 'active')); return t ? t.id : ''; });
  await gotoRoute(page, '/inspect/' + mine, 700);
  const r9b = await page.evaluate((sel) => {
    const bar = document.querySelector('[aria-label="我的工作流程"]');
    const sign = Array.from(document.querySelectorAll(sel)).find((x) => x.getAttribute('data-step') === 'sign');
    if (sign) sign.click();
    return { label: bar ? bar.innerText.replace(/\s+/g, ' ').slice(0, 60) : '', clicked: !!sign };
  }, BAR);
  await sleep(600);
  const r9c = await page.evaluate(() => ({ hash: location.hash, modal: /签名提交本轮检验/.test(document.body.innerText) }));
  c.ok('检验员在一张检验里：流程条显示这张检验的进度，点“签名提交”留在本页并打开签名提交', !!mine && /这张检验的进度/.test(r9b.label) && r9b.clicked && r9c.hash === '#/inspect/' + mine && r9c.modal, JSON.stringify([mine, r9b, r9c]));
  pageErrors = log.errors.slice();
} finally {
  await browser.close();
}
const failed = c.failed();
console.log('\n' + (c.results.length - failed.length) + ' / ' + c.results.length + ' 通过' + (pageErrors.length ? '；页面错误 ' + pageErrors.length + ' 条：\n  ' + pageErrors.join('\n  ') : ''));
process.exit(failed.length || pageErrors.length ? 1 : 0);

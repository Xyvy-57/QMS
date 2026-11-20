/* 交付版的一单到底实操。阶段与表单保存在本标签页，检验、报告、报工与放行共用 QMS 规则。 */
const HANDOFF_STAGES = {
  create:      [0, 'u4', '登记生产工单', '建立工单，交给来料检验员'],
  iqc:         [0, 'u1', '核对来料检验', '签名提交来料检验'],
  first:       [0, 'u1', '核对机台首件', '提交首件报告，交给质量负责人'],
  firstReview: [0, 'u3', '复核首件报告', '复核通过，交给生产主管'],
  startWork:   [0, 'u4', '登记精车产量', '确认投产，交给巡检员'],
  patrol:      [1, 'u1', '录入精车巡检读数', '提交本轮巡检'],
  scope:       [2, 'u2', '分配不合格品去向', '确认限制并提交处置建议'],
  approve:     [2, 'u3', '逐项批准处置', '交给质量工程师执行'],
  execute:     [2, 'u2', '登记实际执行结果', '发起复检'],
  retest:      [2, 'u1', '录入处置后复检读数', '提交本轮复检'],
  verify:      [2, 'u3', '验证并关闭不合格单', '验证并关闭不合格单'],
  unhold:      [2, 'u3', '解除工单质量限制', '解除这项限制'],
  outside:     [3, 'u1', '核对外协回厂检验', '提交回厂检验'],
  assembly:    [3, 'u1', '核对装配巡检', '提交装配巡检'],
  work:        [3, 'u4', '登记终检工序报工', '确认本笔报工'],
  final:       [3, 'u1', '按报工数量做完工检验', '提交完工检验'],
  ship:        [4, 'u1', '安排本批出货交检', '按本批数量开检'],
  shipInspect: [4, 'u1', '核对本批出货检验', '提交本批出货报告'],
  shipReview:  [4, 'u3', '复核本批出货报告', '复核通过'],
  release:     [5, 'u3', '核对整单放行条件', '确认质量放行'],
  done:        [5, 'u5', '工单已质量放行', ''],
};
const HANDOFF_CHAPTERS = ['登记与投产', '精车巡检', '异常处置', '报工与完检', '分批交检', '质量放行'];
const HANDOFF_TASKS = {
  iqc:['IQC','10 毛坯来料'], first:['FIRST','20 精车'], patrol:['IPQC','20 精车'],
  outside:['IQC','30 电镀（外协）'], assembly:['IPQC','40 装配'], final:['FQC','50 终检'], shipInspect:['OQC','60 出货'],
};
const liveOrder = () => S.orders.find(o => o.id === S.live.orderId);
const liveTask = () => taskOf(S.live.taskId);
const liveNcr = () => S.ncrs.find(n => n.id === S.live.ncrId);
const liveReport = () => S.reports.find(r => r.id === S.live.reportId);
const liveRound = () => liveTask().rounds.at(-1);
const liveChar = () => liveTask().snap.items.find(it => it.group === 'M' && it.no === 1);
const livePassedQty = () => liveOrder().qtyIn - orderQty(liveOrder()).scrap;
const liveShipFacts = () => orderLotFacts(liveOrder(), 'OQC', '60 出货');
function liveCheck(condition, message) { if (!condition) throw new Error(message); }
function liveCount(value, minimum = 0) {
  const raw = String(value).trim();
  return /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) >= minimum ? Number(raw) : NaN;
}
function liveMove(stage, message) {
  const h = S.live;
  if (message) h.events.unshift({ stage:h.stage, at:nowISO(), by:S.me, text:message });
  h.signature='';
  h.stage = stage;
  S.me = HANDOFF_STAGES[stage][1];
}
function liveFillRound(task, editableFirst) {
  const round = task.rounds.at(-1);
  task.status = 'active';
  for (const it of task.snap.items) {
    if (it.group === 'M') round.vals[it.cid] = round.samples.map((_,i) => demoOkValue(it,i));
    if (it.group === 'C') round.cnt[it.cid].bad = '0';
  }
  if (task.snap.groups.some(g => g.type === 'count')) round.dUnits = '0';
  if (editableFirst) round.vals[liveChar().cid][0] = '';
}
function liveOpenInspection(stage, lot, other = {}) {
  const [scene, op] = HANDOFF_TASKS[stage], o = liveOrder();
  const plan = plansFor(o.partId,scene)[0];
  const task = createTask({ scene, planId:plan.id, lot:lot || '', ctx:{wo:o.wo, op, ...other}, assignee:'u1' });
  S.live.taskId = task.id;
  liveFillRound(task, stage === 'patrol');
}
function liveAttachEvidence() {
  const t = liveTask(), round = liveRound();
  for (const it of photoViolations(t, round, evalRound(t,round))) {
    round.photos.push({id:'ph'+nextSeq(),url:demoPhoto(),cid:it.cid,by:S.me,at:nowISO()});
  }
}
function liveSign() {
  const t = liveTask(), round = liveRound();
  liveCheck(!evalRound(t,round).missingCells.length,'请先补齐本轮读数。');
  // 辅助岗位读数和图片是示例。选择提交的那一步才生成带轮次的正式演示记录。
  if (!['patrol','retest'].includes(S.live.stage)) liveAttachEvidence();
  const rep = submitRound(t,round,{sigImg:S.live.signature || demoSignature('示例签名')});
  S.live.reportId=rep.id;
  return rep;
}
function liveReview() { approveReport(liveReport(),S.live.signature || demoSignature('示例复核')); }
function liveStartOrder() {
  const h = S.live, qty = liveCount(h.plan,1), number = h.number.trim(), batch = h.batch.trim();
  const plan = plansFor('p1','IQC')[0], sampled=plan.groups.find(g=>g.type==='count')?.n || 1;
  liveCheck(number && batch, '请填写工单号和成品批次。');
  liveCheck(qty >= sampled, '来料方案需计数抽检 '+sampled+' 件，请填写足够的整数批量。');
  const o = {id:'o'+nextSeq(),wo:number,partId:'p1',qty,qtyIn:0,inLots:['IN-208-A'],outLot:batch,work:[],setups:[],createdAt:nowISO(),createdBy:S.me,due:''};
  S.orders.unshift(o);h.orderId=o.id;
  logAudit('生产工单',number,'登记阀芯工单 '+qty+' 件');
  liveMove('iqc','已建立工单 '+number+'，计划 '+qty+' 件');
  liveOpenInspection('iqc',qty,{batch:o.inLots[0],supplier:'演示供应商'});
}
function liveArriveOutside(message) {
  liveMove('outside',message);
  liveOpenInspection('outside',livePassedQty(),{batch:'OUT-208-A',supplier:'演示外协厂'});
}
function liveStartShipping(message) {
  const facts=liveShipFacts();
  liveMove(facts.remaining ? 'ship' : 'release',message);
  S.live.qty = String(facts.assigned ? facts.remaining : Math.min(100,facts.remaining));
  S.live.shipment='DN-208-'+String(facts.tasks.length+1).padStart(2,'0');
}
function liveStartRetest(message) {
  const n=liveNcr(), t=taskOf(n.taskId);
  createRetestRound(t,{reason:'处置后重新检查本批轴直径',ncrId:n.id});
  S.live.taskId=t.id; liveFillRound(t,true);
  liveMove('retest',message);
}
function liveDisposition(lineId, evidence) {
  const n=liveNcr(), line=ncrLines(n).find(d=>d.id===lineId);
  if (S.live.stage==='approve') approveDisposition(n,line);
  else if(S.live.stage==='execute') executeDisposition(n,line,evidence);
  else throw new Error('当前环节没有待处理的处置行。');
}
const LIVE_ACTIONS = {
  create: liveStartOrder,
  iqc() {
    liveSign(); liveMove('first','来料检验合格，交 CNC-02 开首件');
    liveOpenInspection('first',0,{machine:'CNC-02',trigger:'开工'});
  },
  first() { liveSign(); liveMove('firstReview','首件报告已签名，等质量负责人复核'); },
  firstReview() { liveReview(); liveMove('startWork','首件已复核合格，机台可以批量生产'); },
  startWork() {
    const o=liveOrder(); reportWork(o,{op:'20 精车',machine:'CNC-02',qtyIn:o.qty,good:o.qty,bad:0});
    liveMove('patrol','精车已报工 '+o.qty+' 件，交检验员巡检');
    liveOpenInspection('patrol',0,{machine:'CNC-02',freq:'每 2 小时'});
  },
  patrol() {
    const task=liveTask(), round=liveRound(), item=liveChar();
    const reading=round.vals[item.cid][0]; liveSign();
    if(task.status==='pass') { liveArriveOutside('巡检符合，转外协回厂检验'); return; }
    const n=createNcr({title:'精车巡检 · 轴直径超差',partId:'p1',batch:liveOrder().wo,taskId:task.id,roundId:round.id,cids:[item.cid],qtySuspect:8,desc:'样本 S1 实测 '+reading+' mm，现场隔离同机台 8 件。'});
    S.live.ncrId=n.id; liveMove('scope','已登记 '+n.code+'，8 件实物待确认范围');
  },
  scope() {
    const h=S.live,n=liveNcr(), r=liveCount(h.rework), s=liveCount(h.scrap);
    liveCheck(r+s===n.qtySuspect,'返工和报废的件数合计须等于 '+n.qtySuspect+' 件。');
    n.qtyConfirmed=n.qtySuspect; n.status='disposing';
    n.holds.push({id:'h'+nextSeq(),scopeType:'工单',scopeVal:liveOrder().wo,actions:['use','ship'],status:'active',by:S.me,at:nowISO()});
    ncrLog(n,'按本工单建立禁止使用、禁止发运限制');
    for(const [action,qty,reason] of [['返工',r,'刀补校正后重车，再复检轴径'],['报废',s,'余量不足，无法返工']]) {
      if(qty) n.disp.push({id:'d'+nextSeq(),action,qty,reason,by:S.me,approved:false,executed:false});
    }
    ncrLog(n,'确认范围并提交处置建议：返工 '+r+' 件，报废 '+s+' 件');
    liveMove('approve','已分配 '+n.qtyConfirmed+' 件，等待逐项批准');
  },
  approve() {
    liveCheck(ncrLines(liveNcr()).every(d=>d.approved),'请逐项批准尚待处理的建议。');
    liveMove('execute','处置建议已逐项批准，交质量工程师登记实际结果');
  },
  execute() {
    liveCheck(liveNcr().status==='verifying','请先登记每一项的执行凭据。');
    liveStartRetest('执行凭据已登记，已开启新的复检轮次');
  },
  retest() {
    liveSign();
    if(liveTask().status==='fail') { liveStartRetest('复检仍超差，本轮已留档。需处理后再次复测'); return; }
    liveMove('verify','复检符合，交质量负责人核对并关闭不合格单');
  },
  verify() {
    const n=liveNcr();liveCheck(n.status==='verifying' && ncrRetests(n).some(r=>r.result?.overall==='pass'),'请先完成复检。');
    Object.assign(n,{status:'closed',closedAt:nowISO(),closedBy:S.me}); ncrLog(n,'核对执行凭据及复检报告后验证关闭');
    liveMove('unhold','不合格单已关闭，工单质量限制仍有效');
  },
  unhold() {
    const n=liveNcr(), rep=liveReport();liveCheck(n.status==='closed','请先验证关闭不合格单。');
    for(const hold of n.holds.filter(h=>h.status==='active')) Object.assign(hold,{status:'released',releasedAt:nowISO(),releasedBy:S.me,releaseNote:'已核对复检报告 '+rep.code});
    ncrLog(n,'依据 '+rep.code+' 解除本工单质量限制');liveArriveOutside('工单限制已解除，转外协回厂检验');
  },
  outside() { liveSign();liveMove('assembly','外协回厂检验合格，交装配巡检');liveOpenInspection('assembly',0,{freq:'每班 1 次'}); },
  assembly() { liveSign();S.live.qty=String(livePassedQty());liveMove('work','装配巡检合格，交生产主管登记终检产量'); },
  work() {
    const o=liveOrder(),qty=liveCount(S.live.qty,1), remaining=livePassedQty()-orderQty(o).stocked;
    liveCheck(qty<=remaining,'本笔最多可报 '+remaining+' 件。');
    reportWork(o,{op:'50 终检',good:qty,bad:0});
    const left=livePassedQty()-orderQty(o).stocked;
    if(left) { S.live.qty=String(left);liveMove('work','本笔已报 '+qty+' 件，还有 '+left+' 件待报');return; }
    // 多笔报工均按各自的合格数开完检，随后统一进行出货交检。
    S.live.finalWorks=o.work.filter(entry=>entry.op==='50 终检' && !entry.voided && entry.good>0).map(entry=>entry.id);
    liveMove('final','终检工序已报齐，按每笔报工的实际数量送检');liveOpenFinal();
  },
  final() {
    liveSign();S.live.finalWorks.shift();
    if(S.live.finalWorks.length) { liveMove('final','本笔完工检验合格，核对下一笔报工');liveOpenFinal(); }
    else liveStartShipping('完工检验合格，成品按实际库存分批交检');
  },
  ship() {
    const h=S.live;liveCheck(h.shipment.trim(),'请填写本批发货单号。');
    liveCheck(!liveShipFacts().tasks.some(t=>t.ctx.shipment===h.shipment.trim()),'本工单已使用该发货单号，请核对。');
    liveOpenInspection('shipInspect',h.qty,{batch:liveOrder().outLot,shipment:h.shipment.trim(),customer:'演示客户'});
    liveMove('shipInspect','已建立 '+h.shipment+' 的出货检验，共 '+liveTask().lot+' 件');
  },
  shipInspect() {liveSign();liveMove('shipReview','本批出货检验合格，报告已交质量负责人复核');},
  shipReview() {liveReview();liveStartShipping('已复核 '+liveReport().code+'（'+liveTask().lot+' 件）');},
  release() {releaseOrder(liveOrder(),{note:'已在交付演示中核对检验报告、处置凭据及数量平衡。'});liveMove('done','整单质量放行，仓库可以核对发货批次');},
};
function liveOpenFinal() {
  const o=liveOrder(), w=o.work.find(entry=>entry.id===S.live.finalWorks[0]);
  liveOpenInspection('final',w.good,{batch:o.outLot,workId:w.id});
}
function liveInitialize(start) {
  // 只作用于交付版的独立状态。重新演示不触碰普通工作台。
  liveCheck(liveHandoff,'需要在交付实操入口运行。');
  for(const key of ['orders','tasks','reports','ncrs','audit']) S[key]=[];
  S.settings.faiShift=false; // 演示固定为同一生产班次，可跨日继续。
  S.live={version:1,stage:'create',events:[],number:'WO-DEMO-208',batch:'FG-208-A',plan:'208',rework:'5',scrap:'3',qty:'',shipment:'',evidence:{},view:'auto'};
  S.me='u4';
  if(start==='patrol') {
    for(const phase of ['create','iqc','first','firstReview','startWork']) LIVE_ACTIONS[phase]();
  }
  persistDemo();
}

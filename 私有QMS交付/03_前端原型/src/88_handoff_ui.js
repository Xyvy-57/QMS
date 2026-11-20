/* 外部演示人员直接操作的工作台。工序结果从当前工单记录计算。 */
COMPONENTS['handoff-workshop'] = {
  setup() {
    if (S.live?.version !== 1 || !HANDOFF_STAGES[S.live.stage]) liveInitialize('patrol');
    const h = computed(()=>S.live), phase=computed(()=>h.value.stage);
    const meta=computed(()=>HANDOFF_STAGES[phase.value]);
    const order=computed(liveOrder), task=computed(liveTask), ncr=computed(liveNcr), report=computed(liveReport);
    const round=computed(()=>task.value?.rounds.at(-1));
    const item=computed(()=>task.value?.snap.items.find(it=>it.group==='M' && it.no===1));
    const ledger=computed(()=>order.value ? orderQty(order.value) : null);
    const facts=computed(()=>order.value ? liveShipFacts() : {remaining:0,assigned:0,tasks:[]});
    const lines=computed(()=>ncr.value ? ncrLines(ncr.value) : []);
    const hasHold=computed(()=>!!ncr.value?.holds.some(hold=>hold.status==='active'));
    const isReading=computed(()=>['patrol','retest'].includes(phase.value));
    const supplied=computed(()=>['iqc','first','outside','assembly','final','shipInspect'].includes(phase.value));
    const isReview=computed(()=>['firstReview','shipReview'].includes(phase.value));
    const reading=computed({get:()=>item.value && round.value ? round.value.vals[item.value.cid][0] : '',set:value=>{round.value.vals[item.value.cid][0]=String(value).trim();h.value.signature='';}});
    const verdict=computed(()=>item.value ? judgeValue(reading.value,item.value) : 'missing');
    const needsPhoto=computed(()=>isReading.value && round.value && photoViolations(task.value,round.value,evalRound(task.value,round.value)).length>0);
    const ncrNotes=computed(()=>ncr.value?.log.slice().reverse() || []);
    const checkList=computed(()=>order.value ? mainlineOf(order.value).stages.at(-1).checks : []);
    const visibleReports=computed(()=>S.reports.filter(r=>S.tasks.some(t=>t.id===r.taskId && t.ctx.wo===order.value?.wo)));
    const warn=ref(''), saved=ref(true), busy=ref(false), dialog=ref(null), pane=ref(''), chosen=ref(''), resetStart=ref('patrol'), titleEl=ref(null);
    const picked=computed(()=>S.reports.find(r=>r.id===chosen.value));
    const signPad=ref(false);
    const submitted=computed(()=>round.value?.status==='submitted');
    const splitTotal=computed(()=>liveCount(h.value.rework)+liveCount(h.value.scrap));
    const workLeft=computed(()=>order.value ? livePassedQty()-ledger.value.stocked : 0);
    const validation=computed(()=>{
      switch(phase.value) {
        case 'patrol': case 'retest':
          if (verdict.value==='missing') return '请填写样本 S1 的实测值，或点下方的样例。';
          if (verdict.value==='invalid') return '请输入有效的十进制数。';
          if (needsPhoto.value) return '超差读数需要现场证据，请添加示例测量照片。';
          return '';
        case 'scope': return splitTotal.value===ncr.value.qtySuspect ? '' : '分配数量须为非负整数，且合计 '+ncr.value.qtySuspect+' 件。';
        case 'approve': return lines.value.every(d=>d.approved) ? '' : '请分别批准本次的处置建议。';
        case 'execute': return lines.value.every(d=>d.executed) ? '' : '请先登记各项实际执行凭据。';
        case 'work': return liveCount(h.value.qty,1)<=workLeft.value ? '' : '本笔可报 1 至 '+workLeft.value+' 件。';
        case 'ship': {
          const issue=orderLotIssue(order.value,'OQC',facts.value,{batch:order.value.outLot},h.value.qty);
          return issue?.message || (!h.value.shipment.trim() ? '请填写发货单号。' : facts.value.tasks.some(t=>t.ctx.shipment===h.value.shipment.trim()) ? '发货单号已使用。' : '');
        }
        case 'release': return checkList.value.every(c=>c.ok) ? '' : '还有放行条件待完成。';
        default: return '';
      }
    });
    const meter=computed(()=>{
      if(!isReading.value || !['ok','high','low'].includes(verdict.value)) return null;
      const lo=Number(item.value.lsl), hi=Number(item.value.usl);
      return Math.min(98,Math.max(2,25+50*(Number(reading.value)-lo)/(hi-lo)));
    });
    function run(fn, moveFocus=false) {
      if(busy.value) return;
      busy.value=true;warn.value='';
      try { fn(); saved.value=persistDemo(); if(moveFocus) nextTick(()=>{titleEl.value?.focus({preventScroll:true}); titleEl.value?.scrollIntoView({block:'nearest'});}); }
      catch(e) {warn.value=e.message;}
      finally { nextTick(()=>{busy.value=false;}); }
    }
    function advance() {
      const step=phase.value;
      if(validation.value) { warn.value=validation.value;return; }
      run(()=>{if(step===S.live.stage && HANDOFF_STAGES[step][1]===S.me) LIVE_ACTIONS[step]();},true);
    }
    function lineAction(d) {run(()=>liveDisposition(d.id,h.value.evidence[d.id]));}
    function changeStage(stage) {return h.value.events.some(e=>HANDOFF_STAGES[e.stage]?.[0]===stage);}
    function show(name, reportId) {
      chosen.value=reportId || '';pane.value=name;
      if(!dialog.value.open) dialog.value.showModal();
    }
    function dismiss() {dialog.value.close();pane.value='';}
    function restart() {dismiss();run(()=>liveInitialize(resetStart.value),true);}
    function attach() {run(()=>liveAttachEvidence());}
    function addSample(value) {reading.value=value;warn.value='';}
    watch(phase,()=>{warn.value='';signPad.value=false;});
    onMounted(()=>{document.title='工单实操 · Worlder QMS';document.getElementById('boot')?.remove();});
    return { h,phase,meta,order,task,round,ncr,report,ledger,facts,lines,hasHold,isReading,supplied,isReview,reading,verdict,needsPhoto,checkList,visibleReports,picked,ncrNotes,splitTotal,workLeft,validation,meter,warn,saved,busy,dialog,pane,resetStart,titleEl,signPad,submitted,item,
      chapters:HANDOFF_CHAPTERS,roles:ROLES,reviewState:{review:'待复核',approved:'已复核',frozen:'已冻结'}, verdictText:{missing:'待录入',invalid:'格式有误',ok:'符合',high:'高于上限',low:'低于下限'},
      userName,roleName:computed(()=>ROLES[me.value.role].name),fmtTime,specText,number:Number,changeStage,show,dismiss,restart,attach,addSample,advance,lineAction,
      fillEvidence:d=>{h.value.evidence[d.id]=d.action==='报废'?'示例报废凭据 SC-208':'示例返工凭据 RW-208';} };
  },
  template:`
<div class="hw-root" :class="{'hw-phone':h.view==='phone'}" :data-live-stage="phase">
  <header class="hw-top"><b class="hw-brand"><span>W</span>Worlder QMS</b><div class="hw-tools"><button type="button" class="hw-view" :aria-pressed="h.view==='phone'" @click="h.view=h.view==='phone'?'auto':'phone'"><ic :name="h.view==='phone'?'monitor':'phone'" :size="15"/>{{ h.view==='phone'?'桌面视图':'手机视图' }}</button><button type="button" @click="show('guide')"><ic name="book" :size="16"/>讲解卡</button><button type="button" @click="show('restart')"><ic name="rotate-ccw" :size="15"/>重新演示</button></div></header>
  <main class="hw-body"><div class="hw-orderhead"><div><p class="hw-code">{{ order?.wo || '新工单' }}<span>模拟工单</span></p><h1>阀芯生产工单</h1><p>01 系列阀芯 · {{ order?.outLot || h.batch }} · 计划 {{ order?.qty || h.plan || '—' }} 件</p></div><div class="hw-state" :class="{held:hasHold,done:phase==='done'}"><ic :name="hasHold?'lock':phase==='done'?'shield':'factory'" :size="18"/>{{ hasHold?'禁止使用、禁止发运':phase==='done'?'已质量放行':'生产实操' }}</div></div>
    <ol class="hw-steps" aria-label="工单环节"><li v-for="(s,i) in chapters" :key="s" :aria-current="i===meta[0]?'step':null" :class="{passed:i<meta[0] && changeStage(i),skipped:i<meta[0] && !changeStage(i)}"><i><ic v-if="i<meta[0] && changeStage(i) || phase==='done'" name="check" :size="14"/><template v-else>{{ i+1 }}</template></i>{{ s }}</li></ol>
    <div class="hw-grid"><section class="hw-form"><div class="hw-form-head"><span class="hw-role"><ic name="user" :size="15"/>{{ roleName }} · {{ userName(meta[1]) }}</span><h2 ref="titleEl" tabindex="-1">{{ meta[2] }}</h2></div>
      <form class="hw-operation" novalidate @submit.prevent="advance" :key="phase">
        <template v-if="phase==='create'"><label>工单号<input v-model.trim="h.number" data-live-wo></label><div class="hw-fields"><label>计划数量（件）<input inputmode="numeric" v-model.trim="h.plan" data-live-plan></label><label>成品批次<input v-model.trim="h.batch"></label></div><p>来料、机台首件和后续报告将关联到这张工单。</p></template>
        <template v-else-if="isReading"><p class="hw-context">20 精车 · CNC-02 · 第 {{ round.no }} 轮</p><div class="hw-spec"><b>轴直径</b><span>规格范围 {{ item.lsl }} – {{ item.usl }} mm</span></div>
          <label for="live-reading">样本 S1 实测值</label><div class="hw-readrow"><div class="hw-number"><input id="live-reading" autocomplete="off" inputmode="decimal" v-model="reading" placeholder="输入读数" :aria-invalid="verdict==='invalid'" aria-describedby="live-verdict"><span>mm</span></div><strong id="live-verdict" role="status" :data-verdict="verdict"><ic :name="verdict==='ok'?'check':verdict==='missing'?'clock':'alert'" :size="17"/>{{ verdictText[verdict] }}</strong></div>
          <div class="hw-gauge" aria-hidden="true"><span v-if="meter!==null" :style="{left:meter+'%'}"></span></div><div class="hw-limits"><span>下限 {{ item.lsl }}</span><span>上限 {{ item.usl }}</span></div>
          <div class="hw-samples"><span>试填</span><button type="button" @click="addSample('20.00')">合格样例 20.00</button><button type="button" @click="addSample('20.12')">超差样例 20.12</button></div>
          <div v-if="needsPhoto" class="hw-notice"><ic name="camera" :size="17"/><span>本项超差，需留存证据。</span><button type="button" data-live-photo @click="attach">添加示例照片</button></div><div v-else-if="round.photos.length" class="hw-photo"><img :src="round.photos[0].url" alt="本轮示例测量照片"><span>已附 {{ round.photos.length }} 张示例照片</span></div>
          <p v-if="phase==='retest'">原巡检 S1 为 {{ task.rounds[0].vals[item.cid][0] }} mm。每次复测都会保留独立报告。</p>
        </template>
        <template v-else-if="supplied"><p class="hw-context">{{ task.ctx.op }} · {{ task.code }}</p><div class="hw-spec"><b>{{ task.lot ? task.lot+' 件交检' : '机台检验' }}</b><span>{{ task.ctx.batch || task.ctx.machine || order.wo }}</span></div><ul class="hw-data"><li v-for="it in task.snap.items.filter(it=>it.group==='M').slice(0,3)" :key="it.cid"><span>{{ it.name }}</span><b>{{ round.vals[it.cid].join(' / ') }} {{ it.unit }}</b></li></ul><p>本环节已载入模拟检测记录。核对后提交，生成对应检验报告。</p></template>
        <template v-else-if="isReview"><div class="hw-spec"><b>检验结论 · 符合</b><span>{{ report.code }}</span></div><p>检验员已签名。由质量负责人核对{{ phase==='firstReview'?'首件报告':'本批 '+task.lot+' 件的出货报告' }}。</p><button class="hw-minor" type="button" @click="show('report',report.id)">查看待复核报告</button></template>
        <template v-else-if="phase==='startWork'"><div class="hw-spec"><b>CNC-02 · 精车</b><span>本班投入 {{ order.qty }} 件</span></div><p>首件报告已复核，本班开始批量生产并登记精车产量。</p></template>
        <template v-else-if="phase==='scope'"><p>{{ ncr.code }} · 同机台隔离 {{ ncr.qtySuspect }} 件，现场复筛确认均需处理。</p><div class="hw-fields"><label>返工（件）<input v-model.trim="h.rework" data-live-rework inputmode="numeric"></label><label>报废（件）<input v-model.trim="h.scrap" data-live-scrap inputmode="numeric"></label></div><div class="hw-spec"><b>已分配 {{ number.isFinite(splitTotal)?splitTotal:'—' }} / {{ ncr.qtySuspect }} 件</b><span>范围 · {{ order.wo }}</span></div><p>提交后，此工单限制使用和发运，处置建议交质量负责人逐项批准。</p></template>
        <template v-else-if="phase==='approve'||phase==='execute'"><p>确认不合格 {{ ncr.qtyConfirmed }} 件 · {{ ncr.code }}</p><article class="hw-line" v-for="d in lines" :key="d.id" :data-live-line="d.action"><header><b>{{ d.action }} {{ d.qty }} 件</b><span :class="{yes:d.approved}">{{ d.executed?'已执行':d.approved?'已批准，待执行':'待批准' }}</span></header><p>{{ d.reason }}</p><button v-if="phase==='approve' && !d.approved" type="button" class="hw-line-action" @click="lineAction(d)"><ic name="check" :size="15"/>批准{{ d.action }} {{ d.qty }} 件</button><div v-if="phase==='execute' && !d.executed"><label>执行结果及凭据<input v-model.trim="h.evidence[d.id]" :aria-label="d.action+'执行凭据'" placeholder="填写记录编号或结果"></label><div class="hw-samples"><button type="button" @click="fillEvidence(d)">填入示例凭据</button><button type="button" class="hw-line-action" @click="lineAction(d)">登记{{ d.action }} {{ d.qty }} 件</button></div></div><p v-if="d.executed">{{ d.evidence }}</p></article></template>
        <template v-else-if="phase==='verify'||phase==='unhold'"><div class="hw-spec"><b>{{ phase==='verify'?'复检符合':'不合格单已关闭' }}</b><span>{{ ncr.code }}</span></div><p>{{ phase==='verify'?'核对执行记录与复检结果，确认后关闭本单。':'当前工单仍限制使用和发运。请核对复检报告，再明确解除。' }}</p><button type="button" class="hw-minor" @click="show('report',report.id)">查看复检依据 · 第 {{ report.content.round.no }} 轮</button></template>
        <template v-else-if="phase==='work'||phase==='ship'"><div class="hw-balance" v-if="phase==='ship'"><div><span>入库合格</span><b>{{ ledger.stocked }}</b></div><div><span>已安排交检</span><b>{{ facts.assigned }}</b></div><div><span>剩余可交检</span><b>{{ facts.remaining }}</b></div></div><div v-else class="hw-spec"><b>本次待报 {{ workLeft }} 件</b><span>已报废 {{ ledger.scrap }} 件</span></div><label>{{ phase==='ship'?'本批交检数量':'本笔报工合格数量' }}（件）<input data-live-qty v-model.trim="h.qty" inputmode="numeric"></label><label v-if="phase==='ship'">发货单号<input data-live-shipment v-model.trim="h.shipment"></label><p>成品批次 {{ order.outLot }}</p></template>
        <template v-else-if="phase==='release'||phase==='done'"><div class="hw-closure"><ic name="shield" :size="26"/><div><b>{{ phase==='done'?'仓库可按批次发货':'整单待质量负责人签放' }}</b><p>{{ ledger.input }} 件投入 = {{ ledger.stocked }} 件入库合格 + {{ ledger.scrap }} 件报废</p></div></div><ul class="hw-checks"><li v-for="c in checkList" :key="c.key"><ic :name="c.ok?'check':'lock'" :size="15"/>{{ c.text }}</li></ul></template>
        <details v-if="isReading || supplied || isReview" class="hw-sign"><summary @click="signPad=true">本次使用岗位示例签名 · 可手写演示签名</summary><signature-pad v-if="signPad" v-model="h.signature" :height="95" :signer="roleName"/></details>
        <p v-if="warn || validation" class="hw-feedback" :class="{error:warn}" aria-live="polite">{{ warn || validation }}</p>
        <button v-if="phase!=='done'" class="hw-primary" data-live-submit type="submit" :disabled="!!validation || busy">{{ meta[3] }}<ic name="arrow-right" :size="17"/></button>
        <button v-else class="hw-primary" type="button" @click="show('records')">查看本次演示记录<ic name="arrow-right" :size="17"/></button>
      </form></section>
      <aside class="hw-side"><h2>工单记录</h2><div class="hw-side-qty"><div><small>投产</small><b>{{ ledger?.input || 0 }}</b></div><div><small>入库合格</small><b>{{ ledger?.stocked || 0 }}</b></div><div><small>报废</small><b>{{ ledger?.scrap || 0 }}</b></div></div><ul class="hw-events"><li v-for="(e,i) in h.events.slice(0,3)" :key="i"><b>{{ e.text }}</b><small>{{ userName(e.by) }} · {{ fmtTime(e.at) }}</small></li></ul><button type="button" class="hw-minor" @click="show('records')">查看全部记录及报告（{{ visibleReports.length }}）</button><p class="hw-persist">{{ saved?'进度保存在当前浏览器标签页。':'浏览器存储不可用，请保持当前页面打开。' }}</p></aside>
    </div></main>
  <dialog class="hw-dialog" ref="dialog" @close="pane=''" @click.self="dismiss"><header><h2>{{ {guide:'现场讲解卡',restart:'重新开始本次演示',records:'本张工单的记录',report:'检验报告'}[pane] }}</h2><button type="button" aria-label="关闭" @click="dismiss"><ic name="x" :size="18"/></button></header><div class="hw-dialog-body">
    <template v-if="pane==='guide'"><ol class="hw-guide"><li><b>试一个超差读数</b><p>输入 20.12 mm，添加示例照片，再提交巡检。改填 20.00 mm 可以走合格路径。</p></li><li><b>看 8 件不良品的去向</b><p>返工 5 件、报废 3 件。先只批准报废，观察另一项仍待批准。分别登记执行凭据。</p></li><li><b>把处置结果带回工单</b><p>复检填 20.00 mm。验证关闭后解除限制，再报工并做完工检验。</p></li><li><b>试分批交检与放行</b><p>默认合格 205 件，首批交检 100 件。下一批试填 106，再改为剩余的 105 件。复核报告后确认放行。</p></li></ol><p>「重新演示」可从工单登记开始。岗位按环节切换，样例记录仅用于演示。</p></template>
    <template v-if="pane==='restart'"><p>重新开始将替换本标签页里的这场模拟记录。</p><fieldset><legend>选择起点</legend><label><input type="radio" v-model="resetStart" value="patrol"> 从精车巡检开始</label><label><input type="radio" v-model="resetStart" value="create"> 从工单登记开始</label></fieldset><div class="hw-dialog-actions"><button type="button" class="hw-minor" @click="dismiss">保留进度</button><button type="button" class="hw-primary" @click="restart">开始新一场演示</button></div></template>
    <template v-if="pane==='records'"><b>{{ order?.wo || '待建工单' }}</b><h3>检验报告</h3><p v-if="!visibleReports.length">提交检验后，报告会出现在这里。</p><button v-for="r in visibleReports" :key="r.id" type="button" class="hw-record" @click="show('report',r.id)"><span>{{ r.content.task.sceneName }} · 第 {{ r.content.round.no }} 轮<small>{{ r.code }}</small></span><b>{{ r.content.result.overall==='pass'?'符合':'不符合' }} · {{ reviewState[r.state] }}</b></button><h3>交接记录</h3><ol class="hw-log"><li v-for="(e,i) in h.events" :key="i">{{ e.text }}<small>{{ fmtTime(e.at) }} · {{ userName(e.by) }}</small></li></ol><template v-if="ncrNotes.length"><h3>处置记录</h3><ol class="hw-log"><li v-for="(e,i) in ncrNotes" :key="i">{{ e.text }}<small>{{ userName(e.by) }}</small></li></ol></template></template>
    <template v-if="pane==='report' && picked"><p>{{ picked.code }}</p><h3>{{ picked.content.task.sceneName }} · 第 {{ picked.content.round.no }} 轮 · {{ picked.content.result.overall==='pass'?'符合':'不符合' }}</h3><p>{{ picked.content.task.ctx.wo }} · {{ picked.content.task.ctx.op }} · {{ reviewState[picked.state] }}</p><ul class="hw-data"><li v-for="it in picked.content.items" :key="it.cid"><span>{{ it.name }}</span><b>{{ it.group==='M'?picked.content.round.vals[it.cid].join(' / ')+' '+it.unit:'不良 '+picked.content.round.cnt[it.cid].bad+' 件' }}</b></li></ul><p>证据照片 {{ picked.content.round.photoCount }} 张 · {{ picked.sigs.map(s=>s.kind+' '+s.name).join(' / ') }}</p><button type="button" class="hw-minor" @click="show('records')">返回工单记录</button></template>
  </div></dialog>
</div>`,
};

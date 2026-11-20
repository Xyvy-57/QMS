/* 操作导览的两套实拍共享工单、顺序和讲解。读数与数量取自采集时的真实检验结果。 */
const TOUR_CHAPTERS = [
  { name: '登记工单', icon: 'factory', steps: [
    ['orders', '生产主管', '从工单列表开始', '打开「工单」，点「登记工单」。接下来的检验、报工和放行都跟随同一个工单号。'],
    ['create', '生产主管', '建立 208 件阀芯工单', '核对 WO-DEMO-208、01 系列阀芯和计划数量 208 件，点「建立工单」。'],
  ] },
  { name: '来料与首件', icon: 'clipboard', steps: [
    ['intake', '检验员', '从毛坯来料开检', '在工单的「10 毛坯来料」点「来料检验 待检」，进入这道工序的检验单。'],
    ['record', '检验员', '签名提交来料检验', '核对本轮样本读数和外观计数，点「签名提交」。提交后，检验结论和报告归入工单。'],
    ['first', '检验员', '为 CNC-02 做首件', '在「20 精车」点 CNC-02 的开工首件，录入首件尺寸。质量负责人复核合格报告后，机台进入批量生产。'],
  ] },
  { name: '巡检与隔离', icon: 'target', steps: [
    ['deviation', '检验员', '发现轴径超差', '精车巡检的 S1 实测为 20.12 mm，超过 20.10 mm 上限。保留原始读数，附上现场证据并签名提交。'],
    ['ncr', '检验员', '从巡检单登记不合格', '点「登记不合格」，把超差特性、原检验单和本轮读数带入处置单。现场隔离同机台的 8 件。'],
    ['scope', '质量工程师', '确认 8 件并限制使用、发运', '填写可疑 8 件、确认不合格 8 件，核对限制范围和受限动作，点「确认」。'],
  ] },
  { name: '处置与复检', icon: 'wrench', steps: [
    ['approve', '质量负责人', '只批准报废 3 件', '处置建议分为返工 5 件、报废 3 件。核对报废依据后，点「批准报废 3 件」。'],
    ['rework', '质量负责人', '单独批准返工 5 件', '报废行已批准，返工行仍待批准。点「批准返工 5 件」，交给质量工程师分别登记执行凭据。'],
    ['retest', '质量工程师', '为返工件发起复检', '核对返工与报废执行记录，点「发起复检」。检验员填写第 2 轮读数，原来超差的第 1 轮留在检验单里。'],
    ['unhold', '质量负责人', '核验后解除本项限制', '返工复检合格、报废数量核对完成。验证关闭不合格单后，点「解除这一项」，填写解除依据。'],
  ] },
  { name: '报工与交检', icon: 'truck', steps: [
    ['work', '生产主管', '按实物数量报工', '外协回厂检验和装配巡检合格后，在「50 终检」报合格 205 件。另有 3 件报废，合计与投入的 208 件相符。'],
    ['final', '检验员', '按这笔报工做完工检验', '终检报工带出 205 件和成品批次 FG-208-A。点「确认开检」，按方案录数、拍照并提交。'],
    ['shipping', '检验员', '第一批出货交检 100 件', '入库合格共 205 件。在「本次发货交检数」填 100，关联发货单 DN-208-A，点「确认开检」。'],
    ['remaining', '检验员', '为剩余的 105 件开检', '从工单点「下一批交检」。页面带出 205 − 100 = 105 件，核对第二张发货单 DN-208-B 后确认。'],
  ] },
  { name: '质量放行', icon: 'shield', steps: [
    ['release', '质量负责人', '核对条件并放行整张工单', '两批出货检验完成复核后，逐项核对检验、异常处置、质量限制和数量平衡，再点「确认放行」。'],
    ['closed', '仓库执行人', '查看已放行的工单', '工单已放行。208 件投入，205 件合格、3 件报废。仓库可按发货单追溯到成品批次及检验报告。'],
  ] },
];
const TOUR_STEPS = TOUR_CHAPTERS.flatMap((chapter, chapterIndex) => chapter.steps.map(([id, role, title, detail]) => ({ id, role, title, detail, chapterIndex })));
const TOUR_PROGRESS_KEY = 'worlder-order-tour-208-v1';
let packedTourFrames;
function tourPicture(device, id) {
  if (packedTourFrames === undefined) {
    const embedded = document.getElementById('order-tour-media');
    packedTourFrames = embedded ? JSON.parse(embedded.textContent) : null;
  }
  const path = device + '/' + id + '.webp';
  return packedTourFrames ? 'data:image/webp;base64,' + packedTourFrames[path] : 'demo/frames/' + path;
}
function tourStepIndex(id) { return TOUR_STEPS.findIndex(step => step.id === id); }

COMPONENTS['page-order-tour'] = {
  setup() {
    const index = ref(0), playing = ref(false), zoom = ref(false), imageReady = ref(false), finished = ref(false);
    const stage = ref(null), expanded = ref(null), expandButton = ref(null), dialog = ref(null);
    const step = computed(() => TOUR_STEPS[index.value]);
    const device = computed(() => {
      const choice = UI.route.params.device;
      return ['mobile', 'web'].includes(choice) ? choice : window.matchMedia('(max-width: 720px)').matches ? 'mobile' : 'web';
    });
    const bounds = computed(() => TOUR_BOUNDS[device.value][step.value.id]);
    const picture = computed(() => tourPicture(device.value, step.value.id));
    const hotspotStyle = computed(() => {
      const [x, y, w, h] = bounds.value;
      return {left: x*100+'%', top:y*100+'%', width:w*100+'%', height:h*100+'%'};
    });
    const last = computed(() => index.value === TOUR_STEPS.length-1);
    const chapters = TOUR_CHAPTERS.map((chapter, i) => ({ name:chapter.name, icon:chapter.icon, steps:TOUR_STEPS.filter(step => step.chapterIndex===i) }));
    let timer, observer;
    function pause() { clearTimeout(timer); playing.value = false; }
    function savePosition() {
      const hash = '#/demo/' + device.value + '?step=' + step.value.id;
      try { localStorage.setItem(TOUR_PROGRESS_KEY, step.value.id); } catch { /* 私密窗口仍可播放 */ }
      if (location.hash !== hash) { try { history.replaceState(history.state, '', hash); } catch { /* file 地址仍可用按钮切换 */ } }
    }
    function select(at, manual = true) {
      if (manual) pause();
      if (at < 0 || at >= TOUR_STEPS.length) return;
      index.value = at; finished.value = false; savePosition();
    }
    function advance(manual = true) {
      if (last.value) { finished.value = true; pause(); return; }
      select(index.value+1, manual);
    }
    function replay() { select(0); playing.value = true; }
    function toggle() {
      if (playing.value) pause();
      else if (finished.value || last.value) replay();
      else playing.value = true;
    }
    function switchDevice(value) { if (value !== device.value) { pause(); go('/demo/' + value + '?step=' + step.value.id); } }
    function restore() {
      let saved;
      try { saved=localStorage.getItem(TOUR_PROGRESS_KEY); } catch { /* 新访客 */ }
      const id = UI.route.query.step || saved;
      select(Math.max(0, tourStepIndex(id)));
    }
    // 手机实拍按原比例显示。较矮的视窗自动滚到真实控件，仍可触摸上下看全屏。
    function centerTarget() {
      const el = stage.value;
      if (!el) return;
      const dims = device.value === 'mobile' ? [390,780] : [1360,800];
      const renderedHeight = el.clientWidth * dims[1]/dims[0];
      el.scrollTop = Math.max(0, (bounds.value[1]+bounds.value[3]/2)*renderedHeight-el.clientHeight/2);
    }
    const loaded = () => { imageReady.value=true; nextTick(centerTarget); };
    watch(picture, () => { imageReady.value=false; nextTick(centerTarget); });
    watch([playing, index, imageReady], () => {
      clearTimeout(timer);
      if (playing.value && imageReady.value) timer = setTimeout(() => advance(false), 4800);
    });
    watch(() => UI.route, restore, { immediate:true });
    function closeZoom() { dialog.value?.close(); zoom.value=false; nextTick(()=>expandButton.value?.focus()); }
    function openZoom() { pause(); zoom.value=true; nextTick(()=>{ dialog.value?.showModal(); expanded.value?.focus(); }); }
    function onKey(e) {
      if (UI.palette || e.metaKey || e.ctrlKey || e.altKey || e.target.matches?.('input,select,textarea')) return;
      if (zoom.value) { if (e.key==='Escape') closeZoom(); return; }
      if (e.key==='ArrowLeft') { e.preventDefault(); select(index.value-1); }
      if (e.key==='ArrowRight') { e.preventDefault(); advance(); }
    }
    const visibility = () => { if (document.hidden) pause(); };
    onMounted(() => {
      observer = new ResizeObserver(centerTarget); if(stage.value) observer.observe(stage.value);
      window.addEventListener('keydown',onKey); document.addEventListener('visibilitychange',visibility);
    });
    onBeforeUnmount(() => { clearTimeout(timer); observer?.disconnect(); window.removeEventListener('keydown',onKey); document.removeEventListener('visibilitychange',visibility); });
    return { chapters, steps:TOUR_STEPS, step, index, playing, imageReady, device, bounds, picture, hotspotStyle, stage, last, finished, toggle, replay, select, advance, switchDevice, jump:id=>select(tourStepIndex(id)), zoom, expanded, expandButton, openZoom, closeZoom, loaded, dialog, cases:TOUR_PRACTICE_LABELS, exerciseLink:key=>exerciseUrl(key, device.value, step.value.id) };
  },
  template: `
<div class="order-tour" :data-tour-device="device" :data-tour-step="step.id">
  <header class="tour-bar"><div class="tour-bar-inner"><a href="#/workbench" class="tour-brand"><span class="shop-logo">W</span><b>Worlder QMS</b></a><div class="tour-bar-actions"><a class="handoff-entry-link" href="?live=1" title="打开可以录数、审批与放行的模拟工单"><ic name="edit" :size="15"/>进入实操</a><details class="tour-practice-menu" @toggle="$event.target.open && playing && toggle()"><summary><ic name="edit" :size="15"/>动手练习<ic name="chevron-down" :size="12"/></summary><div><a v-for="(item,key) in cases" :key="key" :href="exerciseLink(key)" :data-tour-case="key"><ic :name="item.icon" :size="17"/><span><b>{{ item.title }}</b><small>{{ item.role }}</small></span><ic name="chevron-right" :size="14"/></a></div></details><a href="#/workbench" class="tour-exit"><ic name="chevron-left" :size="16"/>回工作台</a></div></div></header>
  <main class="tour-main">
    <div class="tour-titlebar"><div><p><span class="tour-order-code">WO-DEMO-208</span><span class="tour-kind">模拟工单</span></p><h1>阀芯工单操作演示</h1><div class="tour-subtitle">01 系列阀芯<span>·</span>计划 208 件</div></div>
      <div class="tour-devices" role="group" aria-label="选择演示端"><button :aria-pressed="device==='web'" @click="switchDevice('web')"><ic name="monitor" :size="17"/>Web 端</button><button :aria-pressed="device==='mobile'" @click="switchDevice('mobile')"><ic name="phone" :size="17"/>手机端</button></div>
    </div>
    <div class="tour-workspace">
      <nav class="tour-outline" aria-label="演示章节"><h2>工单流程</h2><ol><li v-for="(chapter,c) in chapters" :key="chapter.name" :class="{ current:c===step.chapterIndex }"><button class="tour-chapter" @click="jump(chapter.steps[0].id)" :aria-current="c===step.chapterIndex ? 'step' : null"><ic :name="chapter.icon" :size="18"/><b>{{ chapter.name }}</b><span>{{ chapter.steps.length }} 步</span></button><ul v-if="c===step.chapterIndex"><li v-for="s in chapter.steps" :key="s.id"><button @click="jump(s.id)" :aria-current="s.id===step.id ? 'step' : null">{{ s.title }}</button></li></ul></li></ol></nav>
      <div class="tour-active">
        <div class="tour-instruction" aria-live="polite" aria-atomic="true"><div class="tour-step-meta"><span class="tour-role"><ic name="user" :size="13"/>{{ step.role }}</span><span>{{ index+1 }} / {{ steps.length }} 步</span><select aria-label="跳至操作步骤" :value="step.id" @change="jump($event.target.value)"><optgroup v-for="ch in chapters" :key="ch.name" :label="ch.name"><option v-for="s in ch.steps" :value="s.id">{{ s.title }}</option></optgroup></select></div><h2>{{ step.title }}</h2><p>{{ step.detail }}</p></div>
        <div class="tour-stage" :class="{handset:device==='mobile'}">
          <div class="tour-screen" ref="stage"><div class="tour-photo"><img :key="picture" :src="picture" @load="loaded" :alt="(device==='mobile'?'手机端':'Web 端')+'实拍，'+step.title" :width="device==='mobile'?390:1360" :height="device==='mobile'?780:800" draggable="false"><button v-if="imageReady && !finished" class="tour-hot" :style="hotspotStyle" :class="{below:bounds[1]<.12,edge:bounds[0]>.78}" @click="advance()" :aria-label="'跟随画面，'+step.title"><span class="tour-pin" aria-hidden="true"><ic name="target" :size="13"/>{{ last?'查看结果':'点这里' }}</span></button></div></div>
          <div v-if="finished" class="tour-end" role="status"><ic name="shield" :size="28"/><h2>工单已放行</h2><p>208 件投入 = 205 件合格 + 3 件报废</p><button class="tour-main-btn" @click="replay"><ic name="rotate-ccw" :size="16"/>重播演示</button></div>
        </div>
        <div class="tour-controls"><div class="tour-meter" role="progressbar" aria-label="演示进度" :aria-valuemax="steps.length" :aria-valuenow="index+1" aria-valuemin="1"><span :style="{width:((index+1)/steps.length*100)+'%'}"></span></div><div class="tour-buttons"><button class="tour-play" data-tour-play @click="toggle"><ic :name="playing?'pause':'play'" :size="16"/>{{ playing?'暂停':last?'重播':'自动演示' }}</button><button class="tour-expand" ref="expandButton" @click="openZoom" aria-label="放大当前画面" title="放大当前画面"><ic name="maximize" :size="16"/></button><div class="tour-step-buttons"><button aria-label="上一步" title="上一步" :disabled="index===0" @click="select(index-1)"><ic name="chevron-left" :size="17"/></button><button class="tour-main-btn" data-tour-next @click="finished ? replay() : advance()">{{ finished?'重新播放':last?'查看结果':'下一步' }}<ic name="arrow-right" :size="16"/></button></div></div></div>
      </div>
    </div>
  </main>
  <dialog v-if="zoom" ref="dialog" class="tour-lightbox" @cancel.prevent="closeZoom" aria-modal="true" aria-label="当前步骤原图" @click.self="closeZoom"><button ref="expanded" class="tour-close-image" @click="closeZoom"><ic name="x" :size="16"/>关闭原图</button><div class="tour-full-image" tabindex="0"><img :src="picture" :alt="step.title" :width="device==='mobile'?390:1360"></div></dialog>
</div>`,
};

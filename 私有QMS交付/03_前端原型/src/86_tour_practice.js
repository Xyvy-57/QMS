/* 练习使用独立的、当前标签页可恢复的 QMS 数据。同一套页面、按钮和数量规则。 */
const TOUR_PRACTICE_LABELS = {
  measure: { title:'录入巡检读数', role:'检验员', icon:'ruler', hint:'在轴直径的样本 S1 填 20.12 mm，核对超差判定。' },
  approve: { title:'逐项批准处置', role:'质量负责人', icon:'stamp', hint:'只批准报废 3 件，查看返工 5 件的审批状态。' },
  ship: { title:'分批出货交检', role:'检验员', icon:'truck', hint:'开下一批出货检验，核对剩余 105 件后确认批量。' },
};
function exerciseUrl(key, device, stepId) {
  const url = new URL(location.href);
  url.searchParams.set('exercise', key);
  url.searchParams.set('returnView', device);
  url.searchParams.set('returnStep', stepId);
  url.hash = TOUR_CASES[key].path;
  return url.href;
}
function returnTourUrl() {
  const url = new URL(location.href);
  const device = url.searchParams.get('returnView') === 'mobile' ? 'mobile' : 'web';
  const id = url.searchParams.get('returnStep');
  for (const key of ['exercise','returnView','returnStep','practicePane']) url.searchParams.delete(key);
  url.hash = '/demo/' + device + '?step=' + (tourStepIndex(id) < 0 ? 'orders' : id);
  return url.href;
}
if (practiceCase && !mobilePracticeHost && S.exerciseVersion !== 1) {
  const snapshot = clone(TOUR_CASES[practiceCase]);
  S.orders = [snapshot.order];
  for (const key of ['tasks','ncrs','reports','audit']) S[key] = snapshot[key];
  S.me = snapshot.me;
  S.seq = Math.max(S.seq, snapshot.seq);
  S.exerciseVersion = 1;
  persistDemo();
}
COMPONENTS['tour-practice-bar'] = {
  setup() { return { item:TOUR_PRACTICE_LABELS[practiceCase], back:returnTourUrl(), restart:resetDemo }; },
  template: `<aside class="tour-practice-bar" aria-label="工单实操练习"><div><strong><ic name="edit" :size="15"/>实操练习 · {{ item.title }}</strong><p>{{ item.hint }}</p></div><div class="tour-practice-actions"><button @click="restart">重做本项</button><a :href="back" target="_top"><ic name="chevron-left" :size="14"/>回到导览</a></div></aside>`,
};

// 在电脑上试手机操作时让浏览器按 390px 重新排版，沿用移动检验表单和权限。
COMPONENTS['tour-phone-practice'] = {
  setup() {
    const frame = new URL(location.href);
    frame.searchParams.set('practicePane','1');
    onMounted(() => { document.title='手机端实操 · Worlder QMS'; document.getElementById('boot')?.remove(); });
    return { src:frame.href, back:returnTourUrl(), item:TOUR_PRACTICE_LABELS[practiceCase] };
  },
  template: `<main class="tour-phone-practice"><div class="tour-phone-info"><span class="tour-order-code">WO-DEMO-208</span><h1>手机端实操</h1><h2>{{ item.title }}</h2><p>{{ item.hint }}</p><a :href="back"><ic name="chevron-left" :size="15"/>回到导览</a></div><iframe title="可操作的手机工位" :src="src"></iframe></main>`,
};

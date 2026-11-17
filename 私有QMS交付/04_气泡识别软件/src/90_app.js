/* =====================================================================
 * 应用外壳：侧栏 / 顶栏 / 路由 / 全局弹层（上传、确认、提示、打印检验记录表）/ 启动与 QMS 握手
 *   嵌在 QMS 里时不显示侧栏（QMS 顶部已经有入口），只保留一条细顶栏
 * ===================================================================== */
const NAV = [
  { to: '/drawings', label: '图纸库与标注', icon: 'folder' },
  { to: '/compare', label: '图纸对比', icon: 'compare' },
  { to: '/similar', label: '相似图纸', icon: 'search' },
  { to: '/tolerances', label: '公差标准', icon: 'ruler' },
  { to: '/settings', label: '设置与对接', icon: 'settings' },
];
/* Worlder 气泡图里的工序、质检单、检具、报告模板在 QMS 里维护（避免两套数据），这里只放跳转 */
const QMS_LINKS = [
  { to: '/routes', label: '工序路线与模板', icon: 'layers' },
  { to: '/tasks', label: '检验任务（质检单）', icon: 'list' },
  { to: '/gauges', label: '检具与检验方法', icon: 'ruler' },
  { to: '/report-templates', label: '报告模板', icon: 'file' },
];
const PAGE_TITLE = { drawings: '图纸库', annotate: '标注工作台', compare: '图纸对比', similar: '相似图纸', tolerances: '公差标准', settings: '设置与对接' };

function activeNav() { const n = UI.route.name; return n === 'annotate' ? '/drawings' : '/' + n; }
function doPrint() { window.print(); }

const App = {
  setup() {
    const pageComp = computed(() => 'page-' + UI.route.name);
    const pageKey = computed(() => UI.route.path + '?' + JSON.stringify(UI.route.query));
    const has = (n) => !!COMPONENTS[n];
    const qmsBase = computed(() => (UI.qms.origin || (S.settings.qmsOrigins || [])[0] || S.server.qmsUrl || '').replace(/\/+$/, ''));
    const openQms = (to) => {
      if (!qmsBase.value) { toast('还没有配置 QMS 地址：到“设置与对接”里填写', 'warn'); return; }
      window.open(qmsBase.value + '/#' + to, UI.embedded ? '_top' : '_blank');
    };
    const applyRoute = () => {
      UI.route = parseHash();
      document.title = (PAGE_TITLE[UI.route.name] || '气泡识别') + ' · Worlder 气泡识别';
      if (UI.embedded) postToQms('worlder.navigate', { route: UI.route.path.replace(/^\//, ''), title: PAGE_TITLE[UI.route.name] || '' });
    };
    const cf = ref({ title: '', message: '', ok: '确定', cancel: '取消', danger: false });
    watch(() => UI.confirm, (v) => { if (v) cf.value = v; });
    const confirmDone = (v) => { const c = UI.confirm; UI.confirm = null; if (c) c.resolve(v); };
    const toastIcon = { success: 'check', error: 'x', warn: 'alert', info: 'info' };
    const toastTone = { success: 'bg-emerald-500', error: 'bg-rose-500', warn: 'bg-amber-500', info: 'bg-brand-500' };
    const pickFile = () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.pdf,.png,.jpg,.jpeg,.svg';
      inp.onchange = () => { if (inp.files && inp.files[0]) UI.upload = { files: [inp.files[0]] }; };
      inp.click();
    };
    onMounted(async () => {
      window.addEventListener('hashchange', applyRoute);
      window.addEventListener('message', onQmsMessage);
      try {
        const hl = await api('GET', '/health');
        Object.assign(S.server, hl);
        Object.assign(S.settings, await api('GET', '/settings'));
        S.booted = true;
      } catch (e) { S.bootError = e.message || String(e); }
      applyRoute();
      if (UI.embedded && S.booted) postToQms('worlder.ready', { version: APP_VERSION, app: 'worlder-bubble', user: meName() });
      const boot = document.getElementById('boot');
      if (boot) { boot.style.opacity = '0'; setTimeout(() => boot.remove(), 420); }
    });
    return { pageComp, pageKey, has, qmsBase, openQms, cf, confirmDone, toastIcon, toastTone, pickFile, NAV, QMS_LINKS, PAGE_TITLE, activeNav };
  },
  template: `
<div class="min-h-screen">
  <aside v-if="!UI.embedded" class="fixed inset-y-0 left-0 z-40 w-[232px] flex flex-col glass border-r border-black/[0.06] max-lg:hidden">
    <div class="h-14 flex items-center gap-2.5 px-5 shrink-0 cursor-pointer" @click="go('/drawings')">
      <span class="w-8 h-8 rounded-full border-[2.5px] border-brand-600 text-brand-600 flex items-center justify-center font-extrabold text-[14px]">1</span>
      <div class="leading-tight"><div class="font-semibold tracking-tight text-[15px]">气泡识别</div><div class="text-[10.5px] text-ink-4">Worlder · 自研私有化版</div></div>
    </div>
    <nav class="flex-1 overflow-y-auto px-3 pb-4">
      <button v-for="i in NAV" :key="i.to" @click="go(i.to)" class="w-full flex items-center gap-2.5 h-9 rounded-xl px-2.5 text-[13px] transition-colors" :class="activeNav() === i.to ? 'bg-white shadow-soft ring-1 ring-black/[0.05] text-brand-700 font-semibold' : 'text-ink-2 hover:bg-black/[0.04]'" :data-nav="i.to"><ic :name="i.icon" :size="17"/>{{ i.label }}</button>
      <div class="mt-5 mb-1 px-2.5 text-[11px] font-medium text-ink-4">在 QMS 里维护</div>
      <button v-for="i in QMS_LINKS" :key="i.to" @click="openQms(i.to)" class="w-full flex items-center gap-2.5 h-9 rounded-xl px-2.5 text-[13px] text-ink-3 hover:bg-black/[0.04] transition-colors"><ic :name="i.icon" :size="17"/><span class="flex-1 text-left">{{ i.label }}</span><ic name="external" :size="13" class="text-ink-5"/></button>
    </nav>
    <div class="p-4 border-t border-black/[0.06] text-[11px] text-ink-4 leading-relaxed">识别在本机浏览器完成，图纸不出内网。</div>
  </aside>

  <div :class="UI.embedded ? '' : 'lg:pl-[232px]'">
    <header class="sticky top-0 z-30 glass border-b border-black/[0.06] flex items-center gap-3 px-4 sm:px-6" :class="UI.embedded ? 'h-11' : 'h-14'">
      <span class="font-semibold text-[14px]">{{ PAGE_TITLE[UI.route.name] || '气泡识别' }}</span>
      <span v-if="UI.embedded" class="chip-blue">已嵌入 QMS</span>
      <div class="flex-1"></div>
      <span class="hidden sm:inline-flex items-center gap-1.5 text-[11.5px]" :class="S.online ? 'text-emerald-700' : 'text-rose-600'"><span class="w-1.5 h-1.5 rounded-full" :class="S.online ? 'bg-emerald-500' : 'bg-rose-500'"></span>{{ S.online ? '服务已连接' : '服务未连接' }}</span>
      <span class="hidden sm:inline-flex items-center gap-1.5 text-[12px] text-ink-3"><ic name="user" :size="14"/>{{ meName() }}</span>
      <button class="btn-primary" :class="UI.embedded ? 'btn-sm' : ''" @click="pickFile"><ic name="upload" :size="15"/>上传图纸</button>
    </header>
    <main class="px-4 sm:px-6 py-4 mx-auto max-w-[1800px]">
      <div v-if="S.bootError" class="card max-w-2xl mx-auto mt-10"><empty icon="server" title="连接不到气泡识别服务" :desc="S.bootError"><p class="text-xs text-ink-3">在 04_气泡识别软件 目录执行 <span class="kbd">node server.mjs</span>，然后用它打印的地址打开本页面。</p></empty></div>
      <transition v-else name="page" mode="out-in">
        <component v-if="has(pageComp)" :is="pageComp" :key="pageKey"/>
      </transition>
    </main>
  </div>

  <component v-if="has('upload-dialog')" :is="'upload-dialog'"/>

  <modal :open="!!UI.confirm" @close="confirmDone(false)" :title="cf.title" width="max-w-md">
    <p class="text-[13px] text-ink-2 leading-relaxed whitespace-pre-line">{{ cf.message }}</p>
    <template #footer><button class="btn-secondary" @click="confirmDone(false)">{{ cf.cancel }}</button><button :class="cf.danger ? 'btn-danger' : 'btn-primary'" @click="confirmDone(true)">{{ cf.ok }}</button></template>
  </modal>

  <teleport to="body"><div v-if="UI.print" class="fixed inset-0 z-[90] bg-white overflow-auto print-area">
    <div class="sheet">
      <div class="flex items-start justify-between gap-4 mb-3">
        <div><div class="text-[18px] font-bold">检验记录表 · {{ UI.print.title }}</div><div class="text-[12px] text-ink-3 mt-1">{{ UI.print.sub }}</div></div>
        <div class="no-print flex gap-2"><button class="btn-primary btn-sm" @click="doPrint"><ic name="printer" :size="14"/>打印</button><button class="btn-secondary btn-sm" @click="UI.print = null">关闭</button></div>
      </div>
      <img v-for="(src,i) in UI.print.images" :key="i" :src="src" class="w-full border border-zinc-300 mb-3" alt="带气泡图纸">
      <table class="page-break">
        <thead><tr><th>气泡</th><th>特性</th><th>规格</th><th>下限</th><th>上限</th><th>单位</th><th>等级</th><th>实测 1</th><th>实测 2</th><th>实测 3</th><th>实测 4</th><th>实测 5</th><th>判定</th></tr></thead>
        <tbody><tr v-for="c in UI.print.rows" :key="c.cid"><td style="text-align:center;font-weight:700">{{ c.no }}</td><td>{{ c.name }}</td><td style="font-family:monospace">{{ specLine(c) }}</td><td>{{ c.lsl }}</td><td>{{ c.usl }}</td><td>{{ c.unit }}</td><td>{{ c.cls }}</td><td></td><td></td><td></td><td></td><td></td><td></td></tr></tbody>
      </table>
      <div class="flex gap-10 mt-6 text-[12px]"><span>检验员：__________</span><span>日期：__________</span><span>审核：__________</span></div>
      <p class="text-[10.5px] text-zinc-500 mt-3">本表由气泡识别软件生成，供现场纸面记录；正式检验数据以 QMS 录入为准。</p>
    </div>
  </div></teleport>

  <teleport to="body"><div class="fixed z-[95] bottom-5 right-5 left-5 sm:left-auto flex flex-col items-end gap-2 pointer-events-none">
    <transition-group name="toast">
      <div v-for="t in UI.toasts" :key="t.id" class="pointer-events-auto max-w-sm flex items-start gap-2.5 pl-3 pr-4 py-2.5 rounded-2xl glass-dark text-white shadow-pop text-[13px] leading-snug">
        <span class="mt-px w-5 h-5 rounded-full flex items-center justify-center shrink-0" :class="toastTone[t.type]"><ic :name="toastIcon[t.type]" :size="12" stroke="2.6"/></span><span>{{ t.msg }}</span>
      </div>
    </transition-group>
  </div></teleport>
</div>`,
};

/* ---------------- 启动 ---------------- */
const app = createApp(App);
Object.keys(COMPONENTS).forEach((n) => app.component(n, COMPONENTS[n]));
/* 模板中可直接使用的名称（运行时编译的模板只能访问这里登记的名称与 setup 返回值） */
Object.assign(app.config.globalProperties, {
  S, UI, go, toast, fmtTime, fmtRel, fmtSize, specLine, meName, recomputeLimits, doPrint,
  REV_STATUS, TOL_SOURCE, CLS_META, SRC_META, MAP_META, CATS, APP_VERSION,
});
app.config.errorHandler = (err, vm, info) => {
  console.error('[BUBBLE] 界面错误', err, info);
  toast('界面出现错误：' + ((err && err.message) || err), 'error');
};
app.mount('#app');

/* 调试与自动化测试入口（原型专用） */
window.__BUBBLE = { S, UI, api, go, parseSpec, parseNote, analyzePage, groupTokens, isoFit, generalTol, mapRevision, canonicalSync, sha256Hex, specToChar, readFileInfo, openDocument, recognizeDocument, DOC_CACHE };

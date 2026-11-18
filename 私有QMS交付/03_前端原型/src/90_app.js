/* =====================================================================
 * 应用外壳：侧栏 / 顶栏 / 命令面板（⌘K）/ 全局弹层 / 路由 / 气泡服务 postMessage 握手
 * ===================================================================== */

function switchUser(id) {
  const u = S.users.find((x) => x.id === id);
  if (!u) return;
  S.me = id; UI.roleMenu = false;
  toast('已切换身份：' + u.name + '（' + ROLES[u.role].name + '）', 'info');
}

function activeNavPath() {
  const r = UI.route;
  if (r.name === 'inspect' || r.name === 'tasks') return '/tasks';
  const map = { standard: '/standards', plan: '/plans', report: '/reports', ncr: '/ncr', order: '/orders', orders: '/orders', traveler: '/orders', scan: '/workbench' };
  return map[r.name] || r.path;
}

function crumbsOf() {
  const r = UI.route, a = activeNavPath(), out = [];
  let grp = '', item = null;
  NAV.forEach((g) => g.items.forEach((i) => { if (i.to === a) { grp = g.group || ''; item = i; } }));
  if (grp) out.push({ label: grp });
  if (item) out.push({ label: item.label, to: item.to });
  const id = r.params.id;
  if (r.name === 'standard') { const s = stdOf(id); if (s) out.push({ label: s.code + ' Rev ' + s.rev }); }
  if (r.name === 'plan') { const p = planOf(id); if (p) out.push({ label: p.code + ' Rev ' + p.rev }); }
  if (r.name === 'inspect') { const t = taskOf(id); if (t) out.push({ label: t.code }); }
  if (r.name === 'order' || r.name === 'traveler') { const o = S.orders.find((x) => x.id === id || x.wo === id); if (o) out.push(r.name === 'traveler' ? { label: o.wo, to: '/orders/' + o.id } : { label: o.wo }); if (o && r.name === 'traveler') out.push({ label: '流转卡' }); }
  if (r.name === 'scan') out.push({ label: '扫码 ' + (r.params.code || '') });
  if (r.name === 'report') { const x = S.reports.find((y) => y.id === id); if (x) out.push({ label: x.code }); }
  if (r.name === 'ncr') { const n = S.ncrs.find((y) => y.id === id); if (n) out.push({ label: n.code }); }
  return out.length ? out : [{ label: 'Worlder QMS' }];
}

/** 命令面板条目：导航 / 操作 / 切换身份 / 业务对象检索 */
function paletteItems(q) {
  const out = [];
  const add = (group, label, sub, icon, run) => out.push({ group, label, sub: sub || '', icon, run });
  NAV.forEach((g) => g.items.forEach((i) => add('前往', i.label, g.group || '', i.icon, () => go(i.to))));
  if (can('task.create')) S.scenes.filter((s) => s.enabled).forEach((sc) => add('操作', '新建' + sc.name + '任务', sc.en, SCENE_META[sc.code].icon, () => { UI.newTask = { scene: sc.code }; }));
  if (can('ncr.create')) add('操作', '登记不合格', 'NCR', 'alert', () => { UI.newNcr = {}; });
  add('操作', '扫码', '流转卡二维码、扫码枪', 'scan', () => { UI.scan = true; });
  if (can('order.work')) add('操作', '报工', '工序合格数、不良数', 'edit', () => { UI.work = {}; });
  if (can('order.setup')) add('操作', '登记换型 / 换刀', '首件触发', 'plus', () => { UI.setup = {}; });
  add('操作', UI.sidebar ? '收起侧栏' : '展开侧栏', '', 'sidebar', () => { UI.sidebar = !UI.sidebar; });
  S.users.forEach((u) => { if (u.id !== S.me) add('切换身份', u.name + ' · ' + ROLES[u.role].name, u.dept, 'user', () => switchUser(u.id)); });
  const k = String(q || '').trim().toLowerCase();
  if (!k) return out.filter((x) => x.group !== '切换身份').slice(0, 40);
  S.orders.forEach((o) => add('生产工单', o.wo, partOf(o.partId).name + ' · ' + ORDER_ML_STATE[mainlineOf(o).state][0] + ((o.inLots || []).length ? ' · 来料 ' + o.inLots.join(' ') : '') + (o.outLot ? ' · 成品 ' + o.outLot : ''), 'factory', () => go('/orders/' + o.id)));
  S.tasks.forEach((t) => add('检验任务', t.code, sceneOf(t.scene).name + ' · ' + partOf(t.partId).name + ' · ' + STATUS.task[t.status][0], SCENE_META[t.scene].icon, () => go('/inspect/' + t.id)));
  S.standards.forEach((s) => add('检验标准', s.code + ' Rev ' + s.rev, partOf(s.partId).name + ' · ' + STATUS.std[s.status][0], 'ruler', () => go('/standards/' + s.id)));
  S.plans.forEach((p) => add('检验方案', p.code + ' Rev ' + p.rev, p.name, 'clipboard', () => go('/plans/' + p.id)));
  S.reports.forEach((r) => add('检验报告', r.code, r.content.part.name + ' · ' + STATUS.report[r.state][0], 'file', () => go('/reports/' + r.id)));
  S.ncrs.forEach((n) => add('不合格', n.code, n.title, 'alert', () => go('/ncr/' + n.id)));
  S.parts.forEach((p) => add('零部件', p.partNo + ' ' + p.name, p.drawingNo + ' Rev ' + p.drawingRev, 'box', () => go('/parts?id=' + p.id)));
  return out.filter((x) => (x.label + ' ' + x.sub + ' ' + x.group).toLowerCase().includes(k)).slice(0, 40);
}

/** 气泡服务 → QMS 的浏览器消息：只做通知，权威数据由后端按 syncBatchId 拉取（PRD §7.1） */
function onBubbleMessage(e) {
  const allowed = String(S.settings.allowedOrigins || '').split(/[\s,;]+/).filter(Boolean);
  if (!allowed.includes(e.origin)) return; // 只接受白名单来源，其余静默丢弃
  const d = e.data;
  if (!d || typeof d !== 'object' || typeof d.type !== 'string') return;
  UI.bubble.lastMsg = { type: d.type, at: nowISO(), origin: e.origin };
  if (d.type === 'worlder.ready') {
    UI.bubble.status = 'handshake';
    clearTimeout(handshakeTimer);
    const ctx = { user: me.value.name, role: me.value.role, token: 'DEMO-TOKEN' };
    try { e.source.postMessage(Object.assign({ type: 'qms.context', version: 1, payload: ctx }, ctx), e.origin); } catch (err) { /* 来源窗口已关闭 */ }
  } else if (d.type === 'worlder.balloon.frozen') {
    ingestSync(d.payload || d, 'bubble');
  } else if (d.type === 'worlder.navigate') {
    const r = (d.payload && d.payload.route) || d.route;
    if (typeof r === 'string') UI.bubble.route = r.replace(/^#?\/?/, '');
  }
}

const App = {
  setup() {
    const navEl = ref(null);
    const ind = reactive({ top: 0, h: 0, show: false });
    const showLabels = computed(() => UI.sidebar || UI.mobileNav);
    const active = computed(() => activeNavPath());
    const crumbs = computed(() => crumbsOf());
    const todos = computed(() => buildTodos());
    const badges = computed(() => ({
      /* 首页角标 = 首页待办条数（与首页列表同一口径） */
      mine: myTodos().length,
      inbox: S.syncInbox.filter((x) => x.status === 'pending').length,
      stdReview: S.standards.filter((s) => s.status === 'review').length,
      planReview: S.plans.filter((p) => p.status === 'review').length,
      review: S.reports.filter((r) => r.state === 'review').length,
      ncr: S.ncrs.filter((n) => n.status !== 'closed').length,
    }));
    const badgeOf = (i) => (i.badge ? badges.value[i.badge] : 0);
    /* 侧栏分组：常用的直接显示，其余收进“更多功能”（当前页面在里面时自动展开） */
    const isMore = (g) => (!!g.more && !(g.promote && g.promote.includes(me.value.role))) || (!!g.roles && !g.roles.includes(me.value.role));
    const navGroups = computed(() => {
      const prim = NAV.filter((g) => !isMore(g)), more = NAV.filter(isMore);
      const out = prim.map((g, i) => Object.assign({ key: 'p' + i }, g));
      if (more.length) {
        const open = UI.moreOpen || more.some((g) => g.items.some((i) => i.to === active.value));
        out.push({ key: 'toggle', toggle: true, open, items: [] });
        if (open) more.forEach((g, i) => out.push(Object.assign({ key: 'm' + i }, g)));
      }
      return out;
    });

    const measure = () => {
      const nav = navEl.value; if (!nav) return;
      const el = nav.querySelector('[data-nav="' + active.value + '"]');
      if (!el) { ind.show = false; return; }
      ind.top = el.offsetTop; ind.h = el.offsetHeight; ind.show = true;
    };
    const applyRoute = () => {
      const r = parseHash();
      if (r.name === 'ext') UI.extOpen = true;
      UI.route = r; UI.mobileNav = false; UI.notif = false; UI.roleMenu = false;
      window.scrollTo(0, 0);
    };

    /* —— 命令面板 —— */
    const pq = ref(''), pIdx = ref(0), pInput = ref(null);
    const pItems = computed(() => paletteItems(pq.value));
    watch(pq, () => { pIdx.value = 0; });
    watch(() => UI.palette, (v) => { if (v) { pq.value = ''; pIdx.value = 0; nextTick(() => pInput.value && pInput.value.focus()); } });
    const runItem = (it) => { UI.palette = false; it.run(); };
    const scrollActive = () => nextTick(() => { const el = document.querySelector('[data-pal-active="true"]'); if (el) el.scrollIntoView({ block: 'nearest' }); });
    const onPaletteKey = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); pIdx.value = Math.min(pItems.value.length - 1, pIdx.value + 1); scrollActive(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); pIdx.value = Math.max(0, pIdx.value - 1); scrollActive(); }
      else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const it = pItems.value[pIdx.value]; if (it) runItem(it); }
    };
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') { e.preventDefault(); UI.palette = !UI.palette; }
      else if (e.key === 'Escape') {
        if (UI.palette) UI.palette = false;
        else if (UI.lightbox) UI.lightbox = null;
        else if (UI.notif || UI.roleMenu) { UI.notif = false; UI.roleMenu = false; }
      }
    };

    /* —— 确认框：保留最后一次内容，避免关闭动画期间文字闪空 —— */
    const cf = ref({ title: '', message: '', ok: '确定', cancel: '取消', danger: false });
    watch(() => UI.confirm, (v) => { if (v) cf.value = v; });
    const confirmDone = (v) => { const c = UI.confirm; UI.confirm = null; if (c) c.resolve(v); };
    const doReset = async () => {
      UI.roleMenu = false;
      if (await confirmBox({ title: '重置演示数据？', message: '将清空浏览器中保存的全部演示数据（任务、报告、NCR、照片与签名），恢复为初始示例。', ok: '重置', danger: true })) resetDemo();
    };

    onMounted(() => {
      window.addEventListener('hashchange', applyRoute);
      window.addEventListener('keydown', onKey);
      window.addEventListener('message', onBubbleMessage);
      window.addEventListener('resize', measure);
      applyRoute();
      nextTick(measure);
      const boot = document.getElementById('boot');
      if (boot) { boot.style.opacity = '0'; setTimeout(() => boot.remove(), 420); }
    });
    watch([active, () => UI.sidebar, () => UI.extOpen, () => UI.moreOpen, () => UI.mobileNav, () => S.me], () => nextTick(measure), { flush: 'post' });
    watch(crumbs, (c) => { document.title = c[c.length - 1].label + ' · Worlder QMS'; }, { immediate: true });

    const pageComp = computed(() => 'page-' + UI.route.name);
    const pageOk = computed(() => !!COMPONENTS[pageComp.value]);
    const pageKey = computed(() => UI.route.path + '?' + JSON.stringify(UI.route.query));
    const has = (n) => !!COMPONENTS[n];
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
    const toastIcon = { success: 'check', error: 'x', warn: 'alert', info: 'info' };
    const toastTone = { success: 'bg-emerald-500', error: 'bg-rose-500', warn: 'bg-amber-500', info: 'bg-brand-500' };
    return { navEl, ind, showLabels, active, crumbs, todos, badges, badgeOf, navGroups, pq, pIdx, pInput, pItems, runItem, onPaletteKey, cf, confirmDone, doReset, pageComp, pageOk, pageKey, has, isMac, toastIcon, toastTone, switchUser, NAV, TONE };
  },
  template: `
<div class="min-h-screen">
  <transition name="fade"><div v-if="UI.mobileNav" class="fixed inset-0 z-40 bg-black/30 lg:hidden" @click="UI.mobileNav = false"></div></transition>

  <!-- 侧栏 -->
  <aside class="fixed inset-y-0 left-0 z-50 flex flex-col glass border-r border-black/[0.06] transition-[width,transform] duration-500 ease-apple" :class="[showLabels ? 'w-[248px]' : 'w-[72px]', UI.mobileNav ? 'translate-x-0' : '-translate-x-full lg:translate-x-0']">
    <div class="h-14 flex items-center gap-2.5 px-5 shrink-0 cursor-pointer" @click="go('/workbench')">
      <span class="w-8 h-8 rounded-[10px] flex items-center justify-center text-white font-bold text-[15px] shrink-0 shadow-[0_2px_8px_rgba(31,99,224,.35)]" style="background:linear-gradient(135deg,#3478f6,#1a4fb8)">W</span>
      <div v-if="showLabels" class="min-w-0 leading-tight"><div class="font-semibold tracking-tight text-[15px]">Worlder QMS</div><div class="text-[10.5px] text-ink-4 truncate">私有化质量管理 · 首期原型</div></div>
    </div>
    <nav ref="navEl" class="relative flex-1 overflow-y-auto overflow-x-hidden px-3 pb-4">
      <span class="absolute left-3 right-3 rounded-xl bg-white shadow-soft ring-1 ring-black/[0.05] transition-all duration-500 ease-apple pointer-events-none" :style="{ top: ind.top + 'px', height: ind.h + 'px', opacity: ind.show ? 1 : 0 }"></span>
      <template v-for="g in navGroups" :key="g.key">
        <button v-if="g.toggle" :data-nav="'__more'" :title="showLabels ? '' : '更多功能'" @click="UI.moreOpen = !g.open" class="relative z-[1] mt-4 w-full flex items-center gap-2.5 h-9 rounded-xl px-2.5 text-[12.5px] text-ink-3 hover:bg-black/[0.04] transition-colors duration-200">
          <ic name="grid" :size="17"/><span v-if="showLabels" class="flex-1 text-left">{{ g.open ? '收起更多功能' : '更多功能' }}</span><ic v-if="showLabels" name="chevron-down" :size="13" class="transition-transform duration-300" :class="g.open ? 'rotate-180' : ''"/>
        </button>
        <div v-if="!g.toggle && g.group" class="mt-4 mb-1 px-2.5 h-6 flex items-center">
          <template v-if="showLabels">
            <button v-if="g.ext" class="flex items-center gap-1 text-[11px] font-medium text-ink-4 hover:text-ink-2 transition-colors" @click="UI.extOpen = !UI.extOpen">{{ g.group }}<span class="chip-gray !text-[9.5px] !px-1.5 !py-0">{{ g.items.length }}</span><ic name="chevron-down" :size="12" class="transition-transform duration-300" :class="UI.extOpen ? '' : '-rotate-90'"/></button>
            <span v-else class="text-[11px] font-medium text-ink-4">{{ g.group }}</span>
          </template>
          <span v-else class="w-full h-px bg-black/[0.07]"></span>
        </div>
        <template v-if="!g.toggle && (!g.ext || UI.extOpen)">
          <button v-for="i in g.items" :key="i.to" :data-nav="i.to" :title="showLabels ? '' : i.label" @click="go(i.to)" class="relative z-[1] w-full flex items-center gap-2.5 h-9 rounded-xl px-2.5 text-[13px] transition-colors duration-200" :class="[active === i.to ? 'text-brand-700 font-semibold' : 'text-ink-2 hover:bg-black/[0.04]', g.ext ? 'opacity-80' : '']">
            <ic :name="i.icon" :size="17"/>
            <span v-if="showLabels" class="flex-1 text-left truncate">{{ i.label }}</span>
            <span v-if="showLabels && i.tag" class="text-[10px] text-ink-4 font-mono">{{ i.tag }}</span>
            <span v-if="badgeOf(i) && showLabels" class="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold flex items-center justify-center tabular">{{ badgeOf(i) }}</span>
            <span v-if="badgeOf(i) && !showLabels" class="absolute top-1.5 right-2.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white"></span>
          </button>
        </template>
      </template>
    </nav>
    <div class="shrink-0 p-3 border-t border-black/[0.06]">
      <button class="hidden lg:flex w-full items-center gap-2.5 h-9 rounded-xl px-2.5 text-[12.5px] text-ink-3 hover:bg-black/[0.04] transition-colors" @click="UI.sidebar = !UI.sidebar"><ic name="sidebar" :size="17"/><span v-if="showLabels">收起侧栏</span></button>
      <div v-if="showLabels" class="px-2.5 pt-1.5 text-[10.5px] text-ink-5 leading-relaxed">演示数据保存在本机浏览器</div>
    </div>
  </aside>

  <div class="transition-[padding] duration-500 ease-apple" :class="UI.sidebar ? 'lg:pl-[248px]' : 'lg:pl-[72px]'" :style="{ '--flow-h': '0px' }">
    <!-- 顶栏 -->
    <header class="sticky top-0 z-30 h-14 glass border-b border-black/[0.06] flex items-center gap-2 px-3 sm:px-6">
      <button class="btn-icon lg:hidden" @click="UI.mobileNav = true" aria-label="打开导航"><ic name="menu" :size="18"/></button>
      <nav class="flex items-center gap-1.5 text-[13px] min-w-0" aria-label="面包屑">
        <template v-for="(c,i) in crumbs" :key="i">
          <ic v-if="i" name="chevron-right" :size="13" class="text-ink-5 shrink-0"/>
          <button v-if="c.to && i < crumbs.length - 1" class="text-ink-3 hover:text-ink truncate transition-colors" @click="go(c.to)">{{ c.label }}</button>
          <span v-else class="truncate" :class="i === crumbs.length - 1 ? 'font-medium text-ink' : 'text-ink-3 max-sm:hidden'">{{ c.label }}</span>
        </template>
      </nav>
      <div class="flex-1"></div>
      <!-- 顶栏只留两样：扫码（现场最常用）和身份。待办都在首页，搜索在首页和各列表页，⌘K 仍可用 -->
      <button class="btn-secondary !h-9" @click="UI.scan = true" aria-label="扫码" title="扫流转卡上的二维码，或用扫码枪"><ic name="scan" :size="16"/><span class="hidden sm:inline">扫码</span></button>

      <div class="relative">
        <button class="flex items-center gap-2 h-9 pl-1 pr-2 rounded-full hover:bg-black/[0.05] transition-colors" @click="UI.roleMenu = !UI.roleMenu; UI.notif = false" aria-label="切换演示身份">
          <avatar :uid="S.me" :size="28"/>
          <span class="hidden sm:block text-left leading-tight"><span class="block text-[12.5px] font-medium">{{ who().name }}</span><span class="block text-[10.5px] text-ink-4">{{ ROLES[who().role].name }}</span></span>
          <ic name="chevron-down" :size="13" class="text-ink-4"/>
        </button>
        <transition name="pop"><div v-if="UI.roleMenu" class="absolute right-0 mt-2 w-[330px] max-w-[calc(100vw-24px)] card shadow-pop z-50 p-1.5">
          <div class="px-3 pt-2 pb-1.5 text-[11px] text-ink-4 leading-relaxed">切换演示身份（待确认的示例配置，不代表企业岗位制度）</div>
          <button v-for="u in S.users" :key="u.id" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left hover:bg-black/[0.04] transition-colors" :class="u.id === S.me ? 'bg-brand-50/70' : ''" @click="switchUser(u.id)">
            <avatar :uid="u.id" :size="30"/>
            <span class="flex-1 min-w-0"><span class="flex items-center gap-1.5"><span class="font-medium text-[13px]">{{ u.name }}</span><span :class="ROLES[u.role].chip">{{ ROLES[u.role].name }}</span></span><span class="block text-[11px] text-ink-4 truncate">{{ ROLES[u.role].desc }}</span></span>
            <ic v-if="u.id === S.me" name="check" :size="15" class="text-brand-600"/>
          </button>
          <div class="h-px bg-black/[0.06] my-1.5"></div>
          <button class="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left text-[12.5px] text-ink-3 hover:bg-black/[0.04]" @click="doReset"><ic name="rotate-ccw" :size="14"/>重置演示数据</button>
        </div></transition>
      </div>
    </header>
    <div v-if="UI.notif || UI.roleMenu" class="fixed inset-0 z-20" @click="UI.notif = false; UI.roleMenu = false"></div>

    <main class="px-4 sm:px-6 lg:px-8 py-6 mx-auto max-w-[1680px]">
      <transition name="page" mode="out-in">
        <component v-if="pageOk" :is="pageComp" :key="pageKey"/>
        <empty v-else :key="'missing' + pageKey" icon="wrench" title="页面建设中" :desc="'路由 ' + UI.route.path + ' 对应的页面尚未注册'"/>
      </transition>
    </main>
  </div>

  <!-- 全局：新建检验任务 / 登记不合格 -->
  <component v-if="has('new-inspect-wizard')" :is="'new-inspect-wizard'"/>
  <component v-if="has('new-task-drawer')" :is="'new-task-drawer'"/>
  <component v-if="has('new-ncr-modal')" :is="'new-ncr-modal'"/>
  <component v-if="has('new-order-modal')" :is="'new-order-modal'"/>
  <component v-if="has('release-modal')" :is="'release-modal'"/>
  <component v-if="has('work-modal')" :is="'work-modal'"/>
  <component v-if="has('setup-modal')" :is="'setup-modal'"/>
  <component v-if="has('scan-modal')" :is="'scan-modal'"/>

  <!-- 命令面板 -->
  <teleport to="body"><transition name="modal"><div v-if="UI.palette" class="fixed inset-0 z-[80] flex items-start justify-center pt-[12vh] px-4">
    <div class="absolute inset-0 bg-black/25 backdrop-blur-[2px]" @click="UI.palette = false"></div>
    <div class="modal-panel relative w-full max-w-xl rounded-2xl bg-white shadow-pop ring-1 ring-black/5 overflow-hidden">
      <div class="flex items-center gap-2.5 px-4 border-b border-black/[0.06]"><ic name="search" :size="17" class="text-ink-4"/><input ref="pInput" v-model="pq" @keydown="onPaletteKey" class="flex-1 h-12 bg-transparent outline-none text-[15px] placeholder:text-ink-5" placeholder="搜索页面、任务、标准、报告、NCR，或输入操作…"><span class="kbd">Esc</span></div>
      <div class="max-h-[52vh] overflow-y-auto p-1.5">
        <template v-for="(it,i) in pItems" :key="it.group + it.label + i">
          <div v-if="i === 0 || pItems[i - 1].group !== it.group" class="px-3 pt-2.5 pb-1 text-[10.5px] font-medium text-ink-4">{{ it.group }}</div>
          <button class="w-full flex items-center gap-2.5 px-3 h-10 rounded-xl text-left transition-colors duration-100" :class="i === pIdx ? 'bg-brand-600 text-white' : 'hover:bg-black/[0.04]'" :data-pal-active="i === pIdx" @mousemove="pIdx = i" @click="runItem(it)">
            <ic :name="it.icon" :size="16" :class="i === pIdx ? 'text-white' : 'text-ink-3'"/><span class="font-medium text-[13px] truncate shrink-0 max-w-[60%]">{{ it.label }}</span><span class="text-[11.5px] truncate" :class="i === pIdx ? 'text-white/75' : 'text-ink-4'">{{ it.sub }}</span>
            <ic v-if="i === pIdx" name="arrow-right" :size="14" class="ml-auto shrink-0"/>
          </button>
        </template>
        <div v-if="!pItems.length" class="py-10 text-center text-ink-4 text-[13px]">没有匹配的结果</div>
      </div>
      <div class="flex items-center gap-3 px-4 h-9 border-t border-black/[0.06] text-[11px] text-ink-4 bg-[#fbfbfd]"><span><span class="kbd">↑</span> <span class="kbd">↓</span> 选择</span><span><span class="kbd">↵</span> 打开</span><span class="ml-auto">当前身份：{{ ROLES[who().role].name }}</span></div>
    </div>
  </div></transition></teleport>

  <!-- 确认框 -->
  <modal :open="!!UI.confirm" @close="confirmDone(false)" :title="cf.title" width="max-w-md">
    <p class="text-[13px] text-ink-2 leading-relaxed whitespace-pre-line">{{ cf.message }}</p>
    <template #footer><button class="btn-secondary" @click="confirmDone(false)">{{ cf.cancel }}</button><button :class="cf.danger ? 'btn-danger' : 'btn-primary'" @click="confirmDone(true)">{{ cf.ok }}</button></template>
  </modal>

  <!-- 照片大图 -->
  <teleport to="body"><transition name="fade"><div v-if="UI.lightbox" class="fixed inset-0 z-[95] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 cursor-zoom-out" @click="UI.lightbox = null">
    <img :src="UI.lightbox.url" class="max-w-full max-h-full rounded-2xl shadow-pop" alt="照片大图">
    <div v-if="UI.lightbox.note" class="absolute bottom-6 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full glass-dark text-white text-xs">{{ UI.lightbox.note }}</div>
  </div></transition></teleport>

  <!-- 轻提示 -->
  <teleport to="body"><div class="fixed z-[90] bottom-5 right-5 left-5 sm:left-auto flex flex-col items-end gap-2 pointer-events-none">
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
/* 模板中可直接使用的全局对象与函数（运行时编译的模板只能访问这里登记的名称与 setup 返回值） */
Object.assign(app.config.globalProperties, {
  S, UI, go, can, denyTip, toast, who: () => me.value,
  ROLES, PERMS, STATUS, SCENE_META, STEP_LIB, STEP_ORDER, PHOTO_POLICY, REVIEW_POLICY, CTX_FIELDS, HOLD_ACTIONS, DISPOSITIONS, NCR_FLOW, EXT, AQL_OPTIONS,
  fmtTime, fmtDate, fmtRel, specText, hashOf, userName, partOf, stdOf, planOf, taskOf, sceneOf, gaugeOf, tplOf, gaugeLabel, effectiveStd, holdsActive,
  ctxText, currentRound, taskProgress, plansFor, ncrsOfTask, sigValid, nextOf, svgOf, stdSvg, orderOfTask, orderOfNcr, orderOfReport,
});
app.config.errorHandler = (err, vm, info) => {
  console.error('[QMS] 界面错误', err, info);
  toast('界面出现错误：' + ((err && err.message) || err), 'error');
};
app.mount('#app');

/* 调试与自动化测试入口（原型专用） */
window.__QMS = { mainlineOf, orderQty, faiReqs, reportWork, addSetup, releaseOrder, orderConcessions, traceOf, traceHoldScopes, traceHold, scanTarget, scanUrl, qrEncode, shiftAt, floorItems, gateBlocker, startPoint, orderPoints, S, UI, go, can, me, evalRound, judgeValue, cmpDec, aqlSuggest, createTask, createRetestRound, submitRound, photoViolations, createNcr, approveReport, returnReport, resubmitReport, sigValid, onBubbleMessage, ingestSync, createDraftFromSync, resetDemo, hashOf, fetchSyncBatch, pollBubble, createPartFromSync, balloonsToItems, canonicalSyncQms, sha256HexQms, switchUser };

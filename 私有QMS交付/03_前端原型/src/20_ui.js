/* =====================================================================
 * 通用界面组件（图标 / 权限按钮 / 弹层 / 图纸查看器 / 签名板 / 拍照 / 图表 …）
 * 约定：页面模板写在 JS 字符串里，由 Vue 运行时编译；模板内不使用反引号与 ${}。
 * ===================================================================== */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  ruler: '<path d="M3 17 17 3l4 4L7 21z"/><path d="m7.5 12.5 2 2M10.5 9.5l2 2M13.5 6.5l2 2"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4V3h6v1"/><path d="M9 10h6M9 14h6M9 18h3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13L21 13v6H3v-6z"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  'check-square': '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>',
  truck: '<path d="M2.5 6h11.5v10H2.5z"/><path d="M14 9h4l3 3.5V16h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  file: '<path d="M14 3H6.5A2.5 2.5 0 0 0 4 5.5v13A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/>',
  alert: '<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><circle cx="12" cy="17" r=".7" fill="currentColor"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  route: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H15a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6.5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  gauge: '<path d="M3 7h18v4H3z"/><path d="M6 11v6M10 11v3M14 11v3M18 11v6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  kanban: '<rect x="3" y="3" width="5" height="18" rx="1.5"/><rect x="10" y="3" width="5" height="12" rx="1.5"/><rect x="17" y="3" width="4" height="8" rx="1.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  bell: '<path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m21 16-5-5-9 9"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6H5V5h6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 3"/><path d="M20 20v-4h-4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  printer: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  'zoom-in': '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6M11 8v6"/>',
  'zoom-out': '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6"/>',
  maximize: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  diff: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5V21M18 3v12.5M13 6h5M3 18h5"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 9h6v6H9zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  grip: '<circle cx="9" cy="6" r="1.2" fill="currentColor"/><circle cx="15" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="18" r="1.2" fill="currentColor"/><circle cx="15" cy="18" r="1.2" fill="currentColor"/>',
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".8" fill="currentColor"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-2-2 8-8-1.3-1.3a4 4 0 0 1-5-5L11 7 7.5 3.5"/><path d="M3 21l6-6"/>',
  message: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 10h8M8 13h5"/>',
  factory: '<path d="M3 21V10l6 4V10l6 4V6h6v15z"/><path d="M7 18h2M13 18h2"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-5 3 3 5-7"/>',
  'clipboard-check': '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4V3h6v1"/><path d="m9 13 2 2 4-4"/>',
  book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3"/>',
  graduation: '<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5"/>',
  stamp: '<path d="M9 3h6l-1 7h4a2 2 0 0 1 2 2v3H4v-3a2 2 0 0 1 2-2h4z"/><path d="M5 19h14"/>',
  dot: '<circle cx="12" cy="12" r="3" fill="currentColor"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.4" fill="currentColor"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M7 12h10"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><path d="m7 11 2.5-2.5L12 11l4-4"/>',
  trace: '<circle cx="5" cy="12" r="2.2"/><circle cx="19" cy="5" r="2.2"/><circle cx="19" cy="19" r="2.2"/><path d="M7.2 12H11m0 0 6-6m-6 6 6 6"/>',
};

const COMPONENTS = {};

COMPONENTS['ic'] = {
  props: { name: String, size: { type: [Number, String], default: 16 }, stroke: { type: [Number, String], default: 1.8 } },
  setup(p) {
    return () => h('svg', { width: p.size, height: p.size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': p.stroke, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'shrink-0', 'aria-hidden': 'true', innerHTML: ICONS[p.name] || ICONS.dot });
  },
};

/** 带原因说明的按钮：无权限或条件不满足时置灰，悬浮显示原因 */
COMPONENTS['g-btn'] = {
  props: { perm: String, when: { type: Boolean, default: true }, why: String, cls: { type: String, default: 'btn-secondary' }, icon: String },
  emits: ['click'],
  computed: {
    allowed() { return (!this.perm || can(this.perm)) && this.when; },
    reason() { if (this.perm && !can(this.perm)) return denyTip(this.perm); if (!this.when) return this.why || '当前状态不可操作'; return null; },
  },
  template: '<span class="guard" :data-tip="reason"><button type="button" :class="cls" :disabled="!allowed" @click="$emit(\'click\')"><ic v-if="icon" :name="icon" :size="15"/><slot/></button></span>',
};

COMPONENTS['modal'] = {
  props: { open: Boolean, title: String, sub: String, width: { type: String, default: 'max-w-lg' } },
  emits: ['close'],
  mounted() { this._esc = (e) => { if (e.key === 'Escape' && this.open) this.$emit('close'); }; window.addEventListener('keydown', this._esc); },
  unmounted() { window.removeEventListener('keydown', this._esc); },
  template:
    '<teleport to="body"><transition name="modal"><div v-if="open" class="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-6">' +
    '<div class="absolute inset-0 bg-black/30 backdrop-blur-[2px]" @click="$emit(\'close\')"></div>' +
    '<div class="modal-panel relative w-full bg-white sm:rounded-3xl rounded-t-3xl shadow-pop flex flex-col max-h-[92vh]" :class="width" role="dialog" aria-modal="true">' +
    '<div class="flex items-start justify-between gap-4 px-6 pt-5 pb-3"><div class="min-w-0"><h3 class="text-[17px] font-semibold tracking-tight">{{ title }}</h3><p v-if="sub" class="text-xs text-ink-3 mt-1 leading-relaxed">{{ sub }}</p></div>' +
    '<button type="button" class="btn-icon -mr-2 -mt-1" @click="$emit(\'close\')" aria-label="关闭"><ic name="x" :size="18"/></button></div>' +
    '<div class="px-6 pb-5 overflow-y-auto flex-1"><slot/></div>' +
    '<div v-if="$slots.footer" class="px-6 py-4 border-t border-black/[0.06] flex flex-wrap items-center justify-end gap-2 bg-[#fbfbfd] sm:rounded-b-3xl"><slot name="footer"/></div>' +
    '</div></div></transition></teleport>',
};

COMPONENTS['drawer'] = {
  props: { open: Boolean, title: String, sub: String, width: { type: String, default: 'max-w-xl' } },
  emits: ['close'],
  mounted() { this._esc = (e) => { if (e.key === 'Escape' && this.open) this.$emit('close'); }; window.addEventListener('keydown', this._esc); },
  unmounted() { window.removeEventListener('keydown', this._esc); },
  template:
    '<teleport to="body"><transition name="drawer"><div v-if="open" class="fixed inset-0 z-[65] flex justify-end">' +
    '<div class="absolute inset-0 bg-black/25" @click="$emit(\'close\')"></div>' +
    '<aside class="drawer-panel relative h-full w-full bg-white shadow-pop flex flex-col" :class="width" role="dialog" aria-modal="true">' +
    '<div class="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-black/[0.06]"><div class="min-w-0"><h3 class="text-[17px] font-semibold tracking-tight truncate">{{ title }}</h3><p v-if="sub" class="text-xs text-ink-3 mt-1 leading-relaxed">{{ sub }}</p></div>' +
    '<button type="button" class="btn-icon -mr-2" @click="$emit(\'close\')" aria-label="关闭"><ic name="x" :size="18"/></button></div>' +
    '<div class="flex-1 overflow-y-auto px-6 py-5"><slot/></div>' +
    '<div v-if="$slots.footer" class="px-6 py-4 border-t border-black/[0.06] flex flex-wrap items-center justify-end gap-2 bg-[#fbfbfd]"><slot name="footer"/></div>' +
    '</aside></div></transition></teleport>',
};

COMPONENTS['st'] = {
  props: { k: String, v: String, dot: Boolean },
  computed: { m() { return (STATUS[this.k] || {})[this.v] || [this.v || '—', 'chip-gray']; } },
  template: '<span :class="m[1]"><span v-if="dot" class="w-1.5 h-1.5 rounded-full" :style="{ background: m[2] || \'currentColor\' }"></span>{{ m[0] }}</span>',
};

/** 分段控件：选中项背后的白色滑块随选择平滑移动 */
COMPONENTS['seg'] = {
  props: { modelValue: [String, Number], options: Array, size: { type: String, default: 'md' } },
  emits: ['update:modelValue'],
  data() { return { thumb: { x: 0, w: 0, ready: false } }; },
  mounted() { this.measure(); this._ro = new ResizeObserver(() => this.measure()); this._ro.observe(this.$el); },
  unmounted() { if (this._ro) this._ro.disconnect(); },
  watch: { modelValue() { this.$nextTick(this.measure); }, options() { this.$nextTick(this.measure); } },
  methods: {
    measure() {
      const i = this.options.findIndex((o) => o.value === this.modelValue);
      const r = this.$refs['b' + i]; const el = Array.isArray(r) ? r[0] : r;
      if (el) this.thumb = { x: el.offsetLeft, w: el.offsetWidth, ready: true }; else this.thumb = { x: 0, w: 0, ready: false };
    },
  },
  template:
    '<div class="relative inline-flex items-center p-[3px] rounded-xl bg-black/[0.055] max-w-full overflow-x-auto">' +
    '<span class="seg-thumb absolute top-[3px] bottom-[3px] left-0 rounded-[9px] bg-white shadow-[0_1px_3px_rgba(0,0,0,.12),0_1px_1px_rgba(0,0,0,.04)]" :style="{ transform: \'translateX(\' + thumb.x + \'px)\', width: thumb.w + \'px\', opacity: thumb.ready ? 1 : 0 }"></span>' +
    '<button v-for="(o,i) in options" :key="o.value" :ref="\'b\' + i" type="button" @click="$emit(\'update:modelValue\', o.value)" class="relative z-[1] inline-flex items-center gap-1.5 rounded-[9px] font-medium whitespace-nowrap transition-colors duration-200" :class="[size === \'sm\' ? \'h-7 px-2.5 text-xs\' : \'h-8 px-3 text-[13px]\', o.value === modelValue ? \'text-ink\' : \'text-ink-3 hover:text-ink\']">' +
    '<span v-if="o.dot" class="w-1.5 h-1.5 rounded-full" :style="{ background: o.dot }"></span>{{ o.label }}<span v-if="o.count != null" class="tabular text-[11px] text-ink-4">{{ o.count }}</span></button></div>',
};

COMPONENTS['stepper'] = {
  props: { steps: Array, current: Number },
  template:
    '<ol class="flex items-center w-full overflow-x-auto">' +
    '<li v-for="(s,i) in steps" :key="i" class="flex items-center" :class="i < steps.length - 1 ? \'flex-1 min-w-[96px]\' : \'\'">' +
    '<div class="flex items-center gap-2 shrink-0">' +
    '<span class="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold transition-all duration-500" :class="i < current ? \'bg-brand-600 text-white\' : i === current ? \'bg-white text-brand-700 ring-2 ring-brand-500 shadow-[0_0_0_4px_rgba(52,120,246,.15)]\' : \'bg-black/[0.06] text-ink-4\'"><ic v-if="i < current" name="check" :size="13" stroke="2.6"/><template v-else>{{ i + 1 }}</template></span>' +
    '<span class="text-xs whitespace-nowrap" :class="i <= current ? \'text-ink font-medium\' : \'text-ink-4\'">{{ s }}</span></div>' +
    '<div v-if="i < steps.length - 1" class="flex-1 h-[2px] mx-3 rounded-full bg-black/[0.07] overflow-hidden"><div class="h-full bg-brand-500 transition-all duration-700 ease-apple" :style="{ width: i < current ? \'100%\' : \'0%\' }"></div></div>' +
    '</li></ol>',
};

COMPONENTS['empty'] = {
  props: { icon: { type: String, default: 'inbox' }, title: String, desc: String },
  template: '<div class="flex flex-col items-center justify-center text-center py-14 px-6"><div class="w-12 h-12 rounded-2xl bg-black/[0.04] flex items-center justify-center text-ink-4 mb-3"><ic :name="icon" :size="22"/></div><div class="font-medium text-ink-2">{{ title }}</div><p v-if="desc" class="text-xs text-ink-4 mt-1 max-w-sm leading-relaxed">{{ desc }}</p><div class="mt-4"><slot/></div></div>',
};

COMPONENTS['count-up'] = {
  props: { value: { type: Number, default: 0 }, decimals: { type: Number, default: 0 } },
  data() { return { shown: 0 }; },
  mounted() { this.run(0, this.value); },
  watch: { value(v, o) { this.run(o, v); } },
  unmounted() { cancelAnimationFrame(this._raf); },
  methods: {
    run(from, to) {
      const t0 = performance.now(), dur = 900;
      cancelAnimationFrame(this._raf);
      const step = (t) => { const k = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - k, 4); this.shown = from + (to - from) * e; if (k < 1) this._raf = requestAnimationFrame(step); };
      this._raf = requestAnimationFrame(step);
    },
  },
  template: '<span class="tabular">{{ shown.toFixed(decimals) }}</span>',
};

COMPONENTS['chart-box'] = {
  props: { config: Object, height: { type: Number, default: 240 } },
  mounted() { this.draw(); },
  watch: { config: { deep: true, handler() { this.draw(); } } },
  unmounted() { if (this._c) this._c.destroy(); },
  methods: {
    draw() {
      if (!window.Chart) return;
      window.Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
      window.Chart.defaults.color = '#86868b';
      if (this._c) this._c.destroy();
      this._c = new window.Chart(this.$refs.cv, clone(this.config));
    },
  },
  template: '<div class="relative w-full" :style="{ height: height + \'px\' }"><canvas ref="cv"></canvas></div>',
};

/** 图纸查看器：底图 + 气泡层；滚轮缩放、拖拽平移、按特性自动定位 */
COMPONENTS['drawing-viewer'] = {
  props: { svg: String, items: { type: Array, default: () => [] }, status: { type: Object, default: null }, diff: { type: Object, default: null }, selected: String, mini: Boolean, focusOnSelect: Boolean },
  emits: ['select'],
  data() { return { s: 1, tx: 0, ty: 0, drag: null }; },
  watch: { selected(cid) { if (this.focusOnSelect && cid) this.focus(cid); } },
  mounted() { this.$el.addEventListener('wheel', this.onWheel, { passive: false }); },
  unmounted() { this.$el.removeEventListener('wheel', this.onWheel); cancelAnimationFrame(this._raf); },
  methods: {
    ctm() { return this.$refs.svg.getScreenCTM(); },
    toUser(cx, cy) { const pt = this.$refs.svg.createSVGPoint(); pt.x = cx; pt.y = cy; return pt.matrixTransform(this.ctm().inverse()); },
    onWheel(e) {
      if (this.mini) return;
      e.preventDefault();
      const u = this.toUser(e.clientX, e.clientY);
      const s2 = Math.min(5, Math.max(0.6, this.s * Math.exp(-e.deltaY * 0.0015)));
      this.tx = u.x - (u.x - this.tx) * (s2 / this.s); this.ty = u.y - (u.y - this.ty) * (s2 / this.s); this.s = s2;
    },
    onDown(e) { if (this.mini || e.button !== 0) return; this.drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty }; e.currentTarget.setPointerCapture(e.pointerId); },
    onMove(e) { if (!this.drag) return; const k = this.ctm().a || 1; this.tx = this.drag.tx + (e.clientX - this.drag.x) / k; this.ty = this.drag.ty + (e.clientY - this.drag.y) / k; },
    onUp() { this.drag = null; },
    animate(s, tx, ty) {
      cancelAnimationFrame(this._raf);
      const a = { s: this.s, tx: this.tx, ty: this.ty }, t0 = performance.now(), dur = 520;
      const step = (t) => { const k = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - k, 4); this.s = a.s + (s - a.s) * e; this.tx = a.tx + (tx - a.tx) * e; this.ty = a.ty + (ty - a.ty) * e; if (k < 1) this._raf = requestAnimationFrame(step); };
      this._raf = requestAnimationFrame(step);
    },
    zoom(f) { const s2 = Math.min(5, Math.max(0.6, this.s * f)); const cx = 430, cy = 260; this.animate(s2, cx - (cx - this.tx) * (s2 / this.s), cy - (cy - this.ty) * (s2 / this.s)); },
    fit() { this.animate(1, 0, 0); },
    focus(cid) { if (this.mini) return; const it = this.items.find((x) => x.cid === cid); if (!it) return; const s2 = Math.max(this.s, 1.7); this.animate(s2, 430 - it.x * s2, 260 - it.y * s2); },
    st(it) { return this.status ? this.status[it.cid] : null; },
    colors(it) {
      const st = this.st(it), df = this.diff ? this.diff[it.cid] : null;
      if (this.selected === it.cid) return { f: '#f59e0b', s: '#fff7ed', t: '#fff' };
      if (df === 'added') return { f: '#10b981', s: '#ecfdf5', t: '#fff' };
      if (df === 'changed') return { f: '#f59e0b', s: '#fffbeb', t: '#fff' };
      if (df === 'removed') return { f: '#e4e4e7', s: '#a1a1aa', t: '#71717a' };
      if (st === 'ok') return { f: '#10b981', s: '#d1fae5', t: '#fff' };
      if (st === 'ng') return { f: '#f43f5e', s: '#ffe4e6', t: '#fff' };
      if (st === 'missing') return { f: '#ffffff', s: '#a1a1aa', t: '#52525b' };
      if (it.cls === 'CTQ') return { f: '#fff1f2', s: '#f43f5e', t: '#be123c' };
      if (it.cls === 'CC') return { f: '#fffbeb', s: '#f59e0b', t: '#b45309' };
      return { f: '#eef5ff', s: '#1f63e0', t: '#1a4fb8' };
    },
    tip(it) { return '#' + it.no + ' ' + it.name + '  ' + specText(it) + (it.unit && it.kind !== 'count' ? ' ' + it.unit : ''); },
  },
  template:
    '<div class="relative w-full h-full overflow-hidden rounded-xl bg-[#fbfbfd] select-none" :class="mini ? \'\' : \'viewer-grab\'" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp">' +
    '<svg ref="svg" viewBox="0 0 860 520" class="w-full h-full" preserveAspectRatio="xMidYMid meet">' +
    '<g :transform="\'translate(\' + tx + \' \' + ty + \') scale(\' + s + \')\'">' +
    '<g v-html="svg"></g>' +
    '<g v-for="it in items" :key="it.cid" class="balloon" :class="{ \'is-active\': selected === it.cid, \'is-ng\': st(it) === \'ng\' }" @pointerdown.stop @click.stop="$emit(\'select\', it.cid)">' +
    '<title>{{ tip(it) }}</title>' +
    '<circle v-if="st(it) === \'ng\'" class="halo" :cx="it.x" :cy="it.y" r="14" fill="none" stroke="#f43f5e" stroke-width="2"/>' +
    '<circle :cx="it.x" :cy="it.y" r="12.5" :fill="colors(it).f" :stroke="colors(it).s" stroke-width="2.2"/>' +
    '<text :x="it.x" :y="it.y + 4" text-anchor="middle" font-size="11" font-weight="700" :fill="colors(it).t" font-family="-apple-system,sans-serif">{{ it.no }}</text>' +
    '</g></g></svg>' +
    '<div v-if="!mini" class="absolute right-3 bottom-3 flex items-center gap-0.5 p-1 rounded-xl glass shadow-soft ring-1 ring-black/5">' +
    '<button type="button" class="btn-icon h-7 w-7" @pointerdown.stop @click.stop="zoom(1/1.3)" title="缩小"><ic name="zoom-out" :size="15"/></button>' +
    '<span class="text-[11px] tabular w-10 text-center text-ink-3">{{ Math.round(s * 100) }}%</span>' +
    '<button type="button" class="btn-icon h-7 w-7" @pointerdown.stop @click.stop="zoom(1.3)" title="放大"><ic name="zoom-in" :size="15"/></button>' +
    '<button type="button" class="btn-icon h-7 w-7" @pointerdown.stop @click.stop="fit" title="适应窗口"><ic name="maximize" :size="15"/></button></div>' +
    '</div>',
};

/** 手写签名板：Pointer Events + 高分屏适配 + 随速度变化的笔触，支持撤销与清除 */
COMPONENTS['signature-pad'] = {
  props: { modelValue: String, height: { type: Number, default: 160 }, signer: String },
  emits: ['update:modelValue'],
  data() { return { strokes: [], drawing: false }; },
  mounted() { this.resize(); this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(this.$refs.wrap); },
  unmounted() { if (this._ro) this._ro.disconnect(); },
  methods: {
    resize() {
      const c = this.$refs.cv, w = this.$refs.wrap.clientWidth, dpr = window.devicePixelRatio || 1;
      if (!w) return;
      c.width = w * dpr; c.height = this.height * dpr; c.style.width = w + 'px'; c.style.height = this.height + 'px';
      this.ctx = c.getContext('2d'); this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.redraw();
    },
    pos(e) { const r = this.$refs.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() }; },
    down(e) { e.preventDefault(); try { this.$refs.cv.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ } this.drawing = true; const p = this.pos(e); p.w = 2.4; this.strokes.push([p]); },
    move(e) {
      if (!this.drawing) return;
      const s = this.strokes[this.strokes.length - 1], a = s[s.length - 1], p = this.pos(e);
      const v = Math.hypot(p.x - a.x, p.y - a.y) / Math.max(1, p.t - a.t);
      p.w = Math.max(1.1, Math.min(3.4, a.w * 0.6 + (3.4 - v * 1.6) * 0.4));
      s.push(p); this.seg(a, p);
    },
    up() { if (!this.drawing) return; this.drawing = false; this.emit(); },
    seg(a, b) { const c = this.ctx; c.strokeStyle = '#0f2a6b'; c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = b.w; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); },
    redraw() {
      if (!this.ctx) return;
      const c = this.$refs.cv; this.ctx.save(); this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, c.width, c.height); this.ctx.restore();
      this.strokes.forEach((s) => { if (s.length === 1) this.seg(s[0], { x: s[0].x + 0.1, y: s[0].y, w: 2.4 }); for (let i = 1; i < s.length; i++) this.seg(s[i - 1], s[i]); });
    },
    emit() { this.$emit('update:modelValue', this.strokes.length ? this.$refs.cv.toDataURL('image/png') : ''); },
    undo() { this.strokes.pop(); this.redraw(); this.emit(); },
    clear() { this.strokes = []; this.redraw(); this.emit(); },
  },
  template:
    '<div><div ref="wrap" class="relative rounded-2xl border border-black/10 bg-[#fcfcfd] overflow-hidden">' +
    '<canvas ref="cv" class="sig-canvas block" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up"></canvas>' +
    '<div v-if="!strokes.length" class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-ink-5"><ic name="pen" :size="22"/><span class="text-xs mt-1.5">请在此处手写签名{{ signer ? \'（\' + signer + \'）\' : \'\' }}</span></div>' +
    '</div><div class="flex items-center justify-between gap-3 mt-2"><span class="text-[11px] text-ink-4">签名与本次内容摘要绑定；内容变化后签名失效</span>' +
    '<div class="flex gap-1 shrink-0"><button type="button" class="btn-ghost btn-xs" @click="undo" :disabled="!strokes.length"><ic name="undo" :size="13"/>撤销</button><button type="button" class="btn-ghost btn-xs" @click="clear" :disabled="!strokes.length"><ic name="trash" :size="13"/>清除</button></div></div></div>',
};

/** 图片压缩：长边不超过 1280px，JPEG 质量 0.78（正式系统上传私有对象存储并记录摘要） */
function compressImage(file, max, q) {
  max = max || 1280; q = q || 0.78;
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('文件读取失败'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('不是可识别的图片'));
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', q));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
/** 演示用示例照片：没有真实图片时也能走通“必须拍照”的流程（仅原型提供） */
function demoPhoto() {
  const c = document.createElement('canvas'); c.width = 640; c.height = 480;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 640, 480); grd.addColorStop(0, '#dbeafe'); grd.addColorStop(1, '#e0e7ff');
  g.fillStyle = grd; g.fillRect(0, 0, 640, 480);
  g.strokeStyle = 'rgba(31,99,224,.28)'; g.lineWidth = 2;
  for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(320, 240, 44 + i * 36, 0, Math.PI * 2); g.stroke(); }
  g.textAlign = 'center'; g.fillStyle = '#1a4fb8'; g.font = '600 30px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'; g.fillText('示例照片', 320, 236);
  g.fillStyle = '#475569'; g.font = '16px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'; g.fillText(fmtTime(nowISO()) + ' · 演示用，非真实照片', 320, 272);
  return c.toDataURL('image/jpeg', 0.8);
}

COMPONENTS['photo-strip'] = {
  props: { photos: { type: Array, default: () => [] }, readonly: Boolean, size: { type: String, default: 'w-20 h-20' } },
  emits: ['add', 'remove'],
  data() { return { busy: false }; },
  methods: {
    async onFiles(e) {
      const files = Array.from(e.target.files || []); e.target.value = '';
      if (!files.length) return;
      this.busy = true;
      try { const urls = []; for (const f of files) urls.push(await compressImage(f)); this.$emit('add', urls); }
      catch (err) { toast('图片处理失败：' + (err.message || err), 'error'); }
      this.busy = false;
    },
    addDemo() { this.$emit('add', [demoPhoto()]); },
    view(p) { UI.lightbox = p; },
  },
  template:
    '<div class="flex flex-wrap gap-2">' +
    '<div v-for="p in photos" :key="p.id" class="relative group rounded-xl overflow-hidden ring-1 ring-black/5 bg-black/5" :class="size">' +
    '<img :src="p.url" class="w-full h-full object-cover cursor-zoom-in transition-transform duration-500 ease-apple group-hover:scale-105" @click="view(p)" alt="现场照片">' +
    '<button v-if="!readonly" type="button" @click="$emit(\'remove\', p.id)" class="absolute top-1 right-1 w-6 h-6 rounded-full glass-dark text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity" aria-label="删除照片"><ic name="x" :size="12" stroke="2.4"/></button>' +
    '</div>' +
    '<template v-if="!readonly">' +
    '<label class="rounded-xl border-[1.5px] border-dashed border-black/15 hover:border-brand-500 hover:bg-brand-50/50 text-ink-3 hover:text-brand-700 flex flex-col items-center justify-center gap-1 cursor-pointer transition-all duration-200" :class="size"><ic :name="busy ? \'refresh\' : \'camera\'" :size="18" :class="busy ? \'animate-spin\' : \'\'"/><span class="text-[11px]">拍照</span><input type="file" accept="image/*" capture="environment" class="hidden" @change="onFiles"></label>' +
    '<label class="rounded-xl border-[1.5px] border-dashed border-black/15 hover:border-brand-500 hover:bg-brand-50/50 text-ink-3 hover:text-brand-700 flex flex-col items-center justify-center gap-1 cursor-pointer transition-all duration-200" :class="size"><ic name="image" :size="18"/><span class="text-[11px]">相册</span><input type="file" accept="image/*" multiple class="hidden" @change="onFiles"></label>' +
    '<button type="button" class="rounded-xl border-[1.5px] border-dashed border-black/10 hover:border-brand-400 hover:bg-brand-50/40 text-ink-4 hover:text-brand-700 flex flex-col items-center justify-center gap-1 transition-all duration-200" :class="size" @click="addDemo" title="插入一张示例照片（仅原型提供，方便没有图片时演示）"><ic name="sparkles" :size="18"/><span class="text-[11px]">示例</span></button>' +
    '</template></div>',
};

COMPONENTS['code-block'] = {
  props: { code: String, title: String },
  methods: {
    copy() {
      const done = () => toast('已复制到剪贴板', 'success'), failed = () => toast('复制失败，请手动选择文本', 'warn');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(this.code).then(done).catch(failed); else failed();
    },
  },
  template: '<div class="rounded-2xl bg-[#1d1d1f] text-[#f5f5f7] overflow-hidden"><div class="flex items-center justify-between gap-3 px-4 py-2 border-b border-white/10"><span class="text-[11px] text-white/60 truncate">{{ title }}</span><button type="button" class="text-[11px] text-white/70 hover:text-white inline-flex items-center gap-1 shrink-0" @click="copy"><ic name="copy" :size="12"/>复制</button></div><pre class="px-4 py-3 text-[11.5px] leading-relaxed font-mono overflow-x-auto">{{ code }}</pre></div>',
};

/** 工序路线可视化（路线模板与零件路线共用） */
COMPONENTS['route-flow'] = {
  props: { ops: Array, compact: Boolean },
  template:
    '<div class="flex items-stretch overflow-x-auto pb-1">' +
    '<template v-for="(op,i) in ops" :key="op.no + op.name">' +
    '<div class="shrink-0 rounded-2xl border border-black/[0.07] bg-white px-3 py-2.5 transition-all duration-300 ease-apple hover:shadow-lift hover:-translate-y-0.5" :class="compact ? \'w-[132px]\' : \'w-[158px]\'">' +
    '<div class="flex items-center gap-1.5"><span class="text-[10px] font-mono font-semibold text-brand-600 bg-brand-50 rounded-md px-1.5 py-0.5">{{ op.no }}</span><span class="font-medium text-[12.5px] truncate">{{ op.name }}</span></div>' +
    '<div class="text-[11px] text-ink-4 mt-1 truncate">{{ op.wc || \'—\' }}</div>' +
    '<div class="flex flex-wrap gap-1 mt-2 min-h-[20px]"><span v-for="b in op.insp" :key="b.scene" class="chip !text-[10px]" :class="SCENE_META[b.scene].tint">{{ sceneOf(b.scene).name || b.scene }}<template v-if="b.freq"> · {{ b.freq }}</template></span><span v-if="!op.insp.length" class="text-[10px] text-ink-5">无检验点</span></div>' +
    '</div>' +
    '<div v-if="i < ops.length - 1" class="shrink-0 w-6 flex items-center justify-center text-ink-5"><ic name="chevron-right" :size="14"/></div>' +
    '</template></div>',
};

/** 场景流程步骤条（来自可复用步骤库）；states: done / active / warn */
COMPONENTS['scene-pipeline'] = {
  props: { steps: Array, states: { type: Object, default: null }, small: Boolean },
  methods: {
    cls(k) {
      const s = this.states ? this.states[k] : null;
      if (s === 'done') return 'bg-emerald-50 text-emerald-700 ring-emerald-600/20';
      if (s === 'active') return 'bg-brand-600 text-white ring-brand-600 shadow-[0_4px_14px_rgba(31,99,224,.35)]';
      if (s === 'warn') return 'bg-amber-50 text-amber-700 ring-amber-600/25';
      return 'bg-white text-ink-3 ring-black/[0.08]';
    },
    done(k) { return !!this.states && this.states[k] === 'done'; },
  },
  template:
    '<div class="flex items-center gap-1 overflow-x-auto pb-0.5">' +
    '<template v-for="(k,i) in steps" :key="k">' +
    '<span class="inline-flex items-center gap-1.5 shrink-0 rounded-full ring-1 ring-inset font-medium transition-all duration-500 ease-apple" :class="[cls(k), small ? \'h-6 px-2 text-[10.5px]\' : \'h-7 px-2.5 text-[11.5px]\']" :title="STEP_LIB[k].desc">' +
    '<ic :name="done(k) ? \'check\' : STEP_LIB[k].icon" :size="small ? 11 : 13" :stroke="done(k) ? 2.6 : 1.8"/>{{ STEP_LIB[k].name }}</span>' +
    '<span v-if="i < steps.length - 1" class="w-3 h-px bg-black/15 shrink-0"></span>' +
    '</template></div>',
};

COMPONENTS['kv'] = {
  props: { k: String, v: [String, Number], mono: Boolean },
  template: '<div class="min-w-0"><div class="text-[11px] text-ink-4">{{ k }}</div><div class="text-[13px] mt-0.5 truncate" :class="mono ? \'font-mono\' : \'\'"><slot>{{ v == null || v === \'\' ? \'—\' : v }}</slot></div></div>',
};

COMPONENTS['avatar'] = {
  props: { uid: String, size: { type: Number, default: 28 } },
  computed: {
    u() { return S.users.find((x) => x.id === this.uid) || { name: '?', role: 'wh' }; },
    bg() { return { insp: 'linear-gradient(135deg,#38bdf8,#0284c7)', qe: 'linear-gradient(135deg,#5996ff,#1a4fb8)', ql: 'linear-gradient(135deg,#a78bfa,#6d28d9)', pm: 'linear-gradient(135deg,#fbbf24,#d97706)', wh: 'linear-gradient(135deg,#a1a1aa,#52525b)', admin: 'linear-gradient(135deg,#6b7280,#1f2937)' }[this.u.role]; },
  },
  template: '<span class="inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0" :style="{ width: size + \'px\', height: size + \'px\', fontSize: Math.round(size * 0.42) + \'px\', background: bg }">{{ u.name.slice(-1) }}</span>',
};

/* ---------------- 外围模块空壳定义（首期只留入口） ---------------- */
const EXT = {
  capa: { title: 'CAPA / 8D 改进', icon: 'wrench', phase: '二期', desc: '针对严重、重复、客户要求或过程失控的问题开展原因分析与纠正预防；8D 是 CAPA 的一种方法。', features: ['从 NCR、客诉、审核发现发起，引用原 NCR，不另建一套单据', 'D1–D8 阶段与任务分派', '措施实施与有效性验证分开记录；观察期未到不能关闭', '验证结果回流：修订检验标准、方案、作业指导与培训'], links: ['NCR 详情页的“发起 CAPA / 8D”入口已预留', '检验标准与方案的“新建修订”承接回流'] },
  complaint: { title: '客户投诉', icon: 'message', phase: '二期', desc: '客诉登记、遏制、调查、处理与客户沟通；客户陈述与内部已证实的事实分开记录。', features: ['两段式：先快反遏制，再寻因改进', '一条客诉可涉及多个物料、多个缺陷', '客户没有回复，不推定为认可', '关联已出库批次风险与质量限制'], links: ['可从客诉生成 NCR 与质量限制', '可发起 CAPA / 8D'] },
  supplier: { title: '供应商质量', icon: 'factory', phase: '二期', desc: '供方资料、真实来料质量统计，以及在原 NCR 上登记供方回复与验证；首期不做准入评分与门户。', features: ['来料批合格率：按批去重，分母为零时不显示 0%', '按供应商、物料、特性的不良排列图', '在原 NCR 上登记供方回复与验证结果'], links: ['数据来源：来料检验的任务与轮次'] },
  metrology: { title: '量具与校准', icon: 'gauge', phase: '二期', desc: '量具台账、校准计划与记录、借还、维修报废；失准时评估对历史测量的影响。', features: ['校准记录保留调整前与调整后的结果', '失准触发影响评估；恢复使用只面向未来', '过期量具在录数时提示（是否锁定由企业策略决定）'], links: ['“检具与检验方法”已建立量具身份与校准到期日'] },
  msa: { title: 'MSA 测量系统分析', icon: 'sliders', phase: '二期', desc: '首个方法为平衡交叉型 Gage R&R（双因素方差分析，保留交互项）。', features: ['最低结构 2 零件 × 2 操作者 × 2 次重复', '不预设 10% / 30% 判据，由企业规则配置', 'MSA 结论与校准状态分开保存'], links: ['引用量具台账与检验特性'] },
  spc: { title: 'SPC 过程分析', icon: 'chart', phase: '二期', desc: '用明确选择的产品、方案修订与特性的本地实测，做单值-移动极差控制图与过程能力分析。', features: ['控制限由实测数据计算，规格限与控制限分开显示', '信号只判点超限', '过程能力高，也不能用来放行具体批次'], links: ['数据来源：检验执行的实测事实（同单位、可追溯）'] },
  audit: { title: '审核管理', icon: 'clipboard-check', phase: '三期', desc: '体系审核、过程审核与分层审核；发现项按需转 CAPA。', features: ['检查表权重与必过项', '移动端现场拍照取证', '整改验证与关闭各自记录'], links: ['复用拍照与签名组件'] },
  docs: { title: '受控文件', icon: 'book', phase: '三期', desc: '文件发布、修订对比与岗位适用；FMEA、控制计划仅作为受控文件管理。', features: ['发布、修订、作废', '岗位资格关联培训', '检验指导书引用'], links: ['检验方案可引用受控文件版本'] },
  training: { title: '培训管理', icon: 'graduation', phase: '三期', desc: '培训计划、记录与岗位覆盖矩阵。', features: ['岗位 × 文件覆盖矩阵', '培训记录与有效期', '检验员资格提示（策略待确认）'], links: ['关联受控文件与岗位'] },
};

/* ---------------- 导航 ----------------
 * 按“要做的事”分组，默认只显示日常用得到的几项，其余收进“更多功能”：
 *   more  —— 默认收起的分组；promote 里的身份例外（例如系统管理员默认看到“系统”）
 *   roles —— 只有这些身份默认显示该组，其它身份的该组也收进“更多功能”
 * 五类检验不再各占一个菜单，在“检验任务”页里用页签切换。 */
const NAV = [
  { group: '生产主线', items: [{ to: '/workbench', label: '生产主线', icon: 'factory', badge: 'mainline' }, { to: '/floor', label: '现场看板', icon: 'monitor', badge: 'floor' }, { to: '/tasks', label: '检验任务', icon: 'list' }, { to: '/reports', label: '检验报告', icon: 'file', badge: 'review' }, { to: '/ncr', label: '不合格处置', icon: 'alert', badge: 'ncr' }, { to: '/trace', label: '批次追溯', icon: 'trace' }] },
  { group: '定标准', roles: ['qe', 'ql'], items: [{ to: '/bubble', label: '气泡识别', icon: 'target', badge: 'inbox' }, { to: '/standards', label: '检验标准', icon: 'ruler', badge: 'stdReview' }, { to: '/plans', label: '检验方案', icon: 'clipboard', badge: 'planReview' }] },
  { group: '看数据', roles: ['qe', 'ql', 'pm'], items: [{ to: '/dashboard', label: '数据看板', icon: 'chart' }] },
  { group: '基础资料', more: true, items: [{ to: '/parts', label: '零部件', icon: 'box' }, { to: '/routes', label: '工序路线与模板', icon: 'route' }, { to: '/scenes', label: '检验场景与流程', icon: 'layers' }, { to: '/gauges', label: '检具与检验方法', icon: 'gauge' }, { to: '/report-templates', label: '报告模板', icon: 'layout' }] },
  { group: '系统', more: true, promote: ['admin'], items: [{ to: '/users', label: '用户与角色', icon: 'users' }, { to: '/audit', label: '操作日志', icon: 'history' }, { to: '/settings', label: '集成设置', icon: 'settings' }] },
  { group: '规划中', more: true, ext: true, items: Object.keys(EXT).map((k) => ({ to: '/ext/' + k, label: EXT[k].title, icon: EXT[k].icon })) },
  { group: '研发协作', more: true, items: [{ to: '/rd', label: '研发排期看板', icon: 'kanban', tag: '内部' }] },
];

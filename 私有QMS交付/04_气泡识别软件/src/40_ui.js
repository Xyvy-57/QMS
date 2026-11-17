/* =====================================================================
 * 通用界面组件：图标、弹层、分段控件、流程条、图纸查看器（缩放 / 平移 / 拖动气泡 / 框选 / 点放）
 * 约定：模板写在 JS 字符串里，由 Vue 运行时编译；模板内不使用反引号与 ${}。
 * ===================================================================== */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  ruler: '<path d="M3 17 17 3l4 4L7 21z"/><path d="m7.5 12.5 2 2M10.5 9.5l2 2M13.5 6.5l2 2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  file: '<path d="M14 3H6.5A2.5 2.5 0 0 0 4 5.5v13A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  alert: '<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><circle cx="12" cy="17" r=".7" fill="currentColor"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  'check-all': '<path d="m2.5 12.5 4 4L15 8"/><path d="m11 16 1 1 9.5-9.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m21 16-5-5-9 9"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  upload: '<path d="M12 20V8M7 13l5-5 5 5"/><path d="M4 4h16"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6H5V5h6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 3"/><path d="M20 20v-4h-4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A16.6 16.6 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
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
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".8" fill="currentColor"/>',
  pointer: '<path d="M5 3l14 7-6 2-2 6z"/>',
  hand: '<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 8-7 8-3 0-4.5-1.5-6-4l-1.8-3a1.5 1.5 0 0 1 2.5-1.6L8 15"/>',
  'box-select': '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M9 12h6M12 9v6"/>',
  balloon: '<circle cx="12" cy="10" r="6.5"/><path d="M12 16.5V21M9 21h6"/><path d="M10.2 8.2 12 7v6"/>',
  hash: '<path d="M5 9h14M4 15h14M10 3 8 21M16 3l-2 18"/>',
  wand: '<path d="m4 20 11-11"/><path d="m14 4 1-2 1 2 2 1-2 1-1 2-1-2-2-1zM19 10l.6-1.2L21 8.2l-1.4-.6L19 6.2l-.6 1.4-1.4.6 1.4.6z"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/>',
  compare: '<rect x="3" y="4" width="7.5" height="16" rx="1.5"/><rect x="13.5" y="4" width="7.5" height="16" rx="1.5"/><path d="M6 9h2M16 9h2M6 13h2M16 13h2"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 9h6v6H9zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  dot: '<circle cx="12" cy="12" r="3" fill="currentColor"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.4"/>',
};

const COMPONENTS = {};

COMPONENTS['ic'] = {
  props: { name: String, size: { type: [Number, String], default: 16 }, stroke: { type: [Number, String], default: 1.8 } },
  setup(p) {
    return () => h('svg', { width: p.size, height: p.size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': p.stroke, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'shrink-0', 'aria-hidden': 'true', innerHTML: ICONS[p.name] || ICONS.dot });
  },
};

COMPONENTS['modal'] = {
  props: { open: Boolean, title: String, sub: String, width: { type: String, default: 'max-w-lg' } },
  emits: ['close'],
  mounted() { this._esc = (e) => { if (e.key === 'Escape' && this.open) this.$emit('close'); }; window.addEventListener('keydown', this._esc); },
  unmounted() { window.removeEventListener('keydown', this._esc); },
  template: `
<teleport to="body"><transition name="modal"><div v-if="open" class="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-6">
  <div class="absolute inset-0 bg-black/30 backdrop-blur-[2px]" @click="$emit('close')"></div>
  <div class="modal-panel relative w-full bg-white sm:rounded-3xl rounded-t-3xl shadow-pop flex flex-col max-h-[92vh]" :class="width" role="dialog" aria-modal="true">
    <div class="flex items-start justify-between gap-4 px-6 pt-5 pb-3"><div class="min-w-0"><h3 class="text-[17px] font-semibold tracking-tight">{{ title }}</h3><p v-if="sub" class="text-xs text-ink-3 mt-1 leading-relaxed">{{ sub }}</p></div>
      <button type="button" class="btn-icon -mr-2 -mt-1" @click="$emit('close')" aria-label="关闭"><ic name="x" :size="18"/></button></div>
    <div class="px-6 pb-5 overflow-y-auto flex-1"><slot/></div>
    <div v-if="$slots.footer" class="px-6 py-4 border-t border-black/[0.06] flex flex-wrap items-center justify-end gap-2 bg-[#fbfbfd] sm:rounded-b-3xl"><slot name="footer"/></div>
  </div>
</div></transition></teleport>`,
};

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
      this.thumb = el ? { x: el.offsetLeft, w: el.offsetWidth, ready: true } : { x: 0, w: 0, ready: false };
    },
  },
  template: `
<div class="relative inline-flex items-center p-[3px] rounded-xl bg-black/[0.055] max-w-full overflow-x-auto no-scrollbar">
  <span class="absolute top-[3px] bottom-[3px] left-0 rounded-[9px] bg-white shadow-[0_1px_3px_rgba(0,0,0,.12)] transition-all duration-300 ease-apple" :style="{ transform: 'translateX(' + thumb.x + 'px)', width: thumb.w + 'px', opacity: thumb.ready ? 1 : 0 }"></span>
  <button v-for="(o,i) in options" :key="o.value" :ref="'b' + i" type="button" @click="$emit('update:modelValue', o.value)" class="relative z-[1] inline-flex items-center gap-1.5 rounded-[9px] font-medium whitespace-nowrap transition-colors duration-200" :class="[size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]', o.value === modelValue ? 'text-ink' : 'text-ink-3 hover:text-ink']">
    <ic v-if="o.icon" :name="o.icon" :size="14"/>{{ o.label }}<span v-if="o.count != null" class="tabular text-[11px] text-ink-4">{{ o.count }}</span>
  </button>
</div>`,
};

COMPONENTS['empty'] = {
  props: { icon: { type: String, default: 'folder' }, title: String, desc: String },
  template: '<div class="flex flex-col items-center justify-center text-center py-14 px-6"><div class="w-12 h-12 rounded-2xl bg-black/[0.04] flex items-center justify-center text-ink-4 mb-3"><ic :name="icon" :size="22"/></div><div class="font-medium text-ink-2">{{ title }}</div><p v-if="desc" class="text-xs text-ink-4 mt-1 max-w-sm leading-relaxed">{{ desc }}</p><div class="mt-4"><slot/></div></div>',
};

COMPONENTS['kv'] = {
  props: { k: String, v: [String, Number], mono: Boolean },
  template: '<div class="min-w-0"><div class="text-[11px] text-ink-4">{{ k }}</div><div class="text-[13px] mt-0.5 truncate" :class="mono ? \'font-mono\' : \'\'"><slot>{{ v == null || v === \'\' ? \'—\' : v }}</slot></div></div>',
};

/** 从左到右的流程条：每一步都能点；state = done / current / todo */
COMPONENTS['flow-steps'] = {
  props: { steps: { type: Array, default: () => [] } },
  emits: ['pick'],
  template: `
<div class="flex items-center overflow-x-auto no-scrollbar" role="navigation" aria-label="处理流程">
  <template v-for="(s,i) in steps" :key="s.key">
    <button type="button" :data-step="s.key" :title="s.hint || ''" @click="$emit('pick', s.key)" class="shrink-0 inline-flex items-center gap-1.5 h-8 pl-1 pr-2.5 rounded-full text-[12.5px] font-medium ring-1 ring-inset transition-all duration-300 ease-apple active:scale-[0.97]"
      :class="s.state === 'current' ? 'bg-brand-600 text-white ring-brand-600 shadow-[0_4px_14px_rgba(31,99,224,.3)]' : s.state === 'done' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 hover:bg-emerald-100' : 'bg-white text-ink-3 ring-black/[0.08] hover:text-ink'">
      <span class="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold" :class="s.state === 'current' ? 'bg-white/25 text-white' : s.state === 'done' ? 'bg-emerald-500 text-white' : 'bg-black/[0.05] text-ink-4'"><ic v-if="s.state === 'done'" name="check" :size="12" stroke="2.6"/><template v-else>{{ i + 1 }}</template></span>
      <span class="whitespace-nowrap">{{ s.label }}</span>
      <span v-if="s.badge" class="text-[11px] font-normal tabular opacity-80 whitespace-nowrap">{{ s.badge }}</span>
    </button>
    <span v-if="i < steps.length - 1" class="flex-1 min-w-[10px] max-w-[28px] h-[2px] mx-0.5 rounded-full" :class="s.state === 'done' ? 'bg-emerald-400' : 'bg-black/10'"></span>
  </template>
</div>`,
};

COMPONENTS['progress-bar'] = {
  props: { value: { type: Number, default: -1 }, tone: { type: String, default: 'bg-brand-500' } },
  template: '<div class="h-1.5 rounded-full bg-black/[0.07] overflow-hidden" :class="value < 0 ? \'bar-indeterminate\' : \'\'"><div v-if="value >= 0" class="h-full rounded-full transition-all duration-500 ease-apple" :class="tone" :style="{ width: Math.round(Math.min(1, value) * 100) + \'%\' }"></div></div>',
};

COMPONENTS['bubble-no'] = {
  props: { c: Object, size: { type: Number, default: 24 } },
  computed: {
    tone() {
      const c = this.c || {};
      if (c.status === 'confirmed') return 'bg-emerald-500 text-white ring-emerald-200';
      if (needsReview(c)) return 'bg-amber-50 text-amber-700 ring-amber-300';
      return 'bg-brand-50 text-brand-700 ring-brand-300';
    },
  },
  template: '<span class="balloon-badge shrink-0" :class="tone" :style="{ height: size + \'px\', minWidth: size + \'px\' }">{{ c ? c.no : \'\' }}</span>',
};

/* ---------------- 图纸查看器 ----------------
 * 坐标：页面像素（与识别、气泡、截取一致）。舞台按 translate(tx,ty) scale(s) 变换。
 * tool：select 选择/拖动气泡 · hand 平移 · box 框选识别 · place 点击放气泡；按住空格临时平移。 */
const VIEW_COLORS = {
  sel: { fill: '#1f63e0', stroke: '#1f63e0', text: '#fff' },
  confirmed: { fill: '#ecfdf5', stroke: '#10b981', text: '#047857' },
  review: { fill: '#fffbeb', stroke: '#f59e0b', text: '#b45309' },
  auto: { fill: '#eef5ff', stroke: '#1f63e0', text: '#1a4fb8' },
  added: { fill: '#ecfdf5', stroke: '#10b981', text: '#047857' },
  changed: { fill: '#fffbeb', stroke: '#f59e0b', text: '#b45309' },
  removed: { fill: '#f4f4f5', stroke: '#a1a1aa', text: '#71717a' },
  uncertain: { fill: '#f5f3ff', stroke: '#7c3aed', text: '#6d28d9' },
  same: { fill: '#ffffff', stroke: '#94a3b8', text: '#475569' },
};
COMPONENTS['page-viewer'] = {
  props: {
    src: String, w: Number, h: Number, chars: { type: Array, default: () => [] }, selected: String,
    tool: { type: String, default: 'select' }, boxes: Boolean, readonly: Boolean, colorKey: Function, extra: { type: Array, default: () => [] }, overlay: String,
  },
  emits: ['select', 'move', 'rect', 'place', 'deselect', 'view'],
  data() { return { s: 1, tx: 0, ty: 0, drag: null, rect: null, space: false, dragPos: null, loaded: false }; },
  computed: {
    r() { return balloonRadius(this.w || 2000); },
    panning() { return this.tool === 'hand' || this.space; },
    zoomPct() { return Math.round((this.s / (this._fitS || this.s || 1)) * 100); },
  },
  watch: {
    src() { this.loaded = false; },
    w() { this.$nextTick(this.fit); },
    selected(cid) { if (cid) this.focus(cid); },
  },
  mounted() {
    this._ro = new ResizeObserver(() => { if (!this._moved) this.fit(); });
    this._ro.observe(this.$el);
    this.$el.addEventListener('wheel', this.onWheel, { passive: false });
    this._kd = (e) => { if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) { this.space = true; e.preventDefault(); } if (e.key === 'Escape') { this.rect = null; this.drag = null; } };
    this._ku = (e) => { if (e.code === 'Space') this.space = false; };
    window.addEventListener('keydown', this._kd); window.addEventListener('keyup', this._ku);
    this.$nextTick(this.fit);
  },
  unmounted() {
    if (this._ro) this._ro.disconnect();
    this.$el.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this._kd); window.removeEventListener('keyup', this._ku);
    cancelAnimationFrame(this._raf);
  },
  methods: {
    box() { return this.$el.getBoundingClientRect(); },
    toPage(e) { const b = this.box(); return { x: (e.clientX - b.left - this.tx) / this.s, y: (e.clientY - b.top - this.ty) / this.s }; },
    fit() {
      const b = this.box();
      if (!this.w || !this.h || !b.width || !b.height) return;
      const s = Math.min((b.width - 24) / this.w, (b.height - 24) / this.h);
      this._fitS = s; this._moved = false;
      this.s = s; this.tx = (b.width - this.w * s) / 2; this.ty = (b.height - this.h * s) / 2;
    },
    animate(s, tx, ty) {
      cancelAnimationFrame(this._raf);
      const a = { s: this.s, tx: this.tx, ty: this.ty }, t0 = performance.now(), dur = 460;
      const step = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4); this.s = a.s + (s - a.s) * e; this.tx = a.tx + (tx - a.tx) * e; this.ty = a.ty + (ty - a.ty) * e; if (k < 1) this._raf = requestAnimationFrame(step); };
      this._raf = requestAnimationFrame(step);
    },
    zoomBy(f, cx, cy) {
      const b = this.box();
      if (cx == null) { cx = b.width / 2; cy = b.height / 2; }
      const base = this._fitS || this.s;
      const s2 = clamp(this.s * f, base * 0.5, Math.max(base * 12, 4));
      this._moved = true;
      this.animate(s2, cx - (cx - this.tx) * (s2 / this.s), cy - (cy - this.ty) * (s2 / this.s));
    },
    onWheel(e) {
      e.preventDefault();
      const b = this.box(), cx = e.clientX - b.left, cy = e.clientY - b.top;
      const base = this._fitS || this.s;
      const s2 = clamp(this.s * Math.exp(-e.deltaY * 0.0016), base * 0.5, Math.max(base * 12, 4));
      this._moved = true;
      this.tx = cx - (cx - this.tx) * (s2 / this.s); this.ty = cy - (cy - this.ty) * (s2 / this.s); this.s = s2;
    },
    focusBox(bx) {
      if (!bx) return;
      const b = this.box();
      const s2 = Math.max(this.s, (this._fitS || this.s) * 2.2);
      this._moved = true;
      this.animate(s2, b.width / 2 - (bx.x + bx.w / 2) * s2, b.height / 2 - (bx.y + bx.h / 2) * s2);
    },
    focus(cid) {
      const c = this.chars.find((x) => x.cid === cid);
      if (!c) return;
      const p = c.balloon || { x: c.anchor.x, y: c.anchor.y };
      const bx = c.anchor ? boxUnion(c.anchor, { x: p.x - this.r, y: p.y - this.r, w: this.r * 2, h: this.r * 2 }) : { x: p.x - 40, y: p.y - 40, w: 80, h: 80 };
      const b = this.box();
      const cx = bx.x * this.s + this.tx, cy = bx.y * this.s + this.ty;
      const visible = cx > 0 && cy > 0 && cx + bx.w * this.s < b.width && cy + bx.h * this.s < b.height && this.s >= (this._fitS || 0) * 1.5;
      if (!visible) this.focusBox(bx);
    },
    pos(c) { return this.dragPos && this.dragPos.cid === c.cid ? this.dragPos : c.balloon || { x: 0, y: 0 }; },
    lead(c) { return c.anchor && c.balloon ? leaderLine(this.pos(c).x, this.pos(c).y, this.r, c.anchor) : null; },
    col(c) {
      if (c.cid === this.selected) return VIEW_COLORS.sel;
      const k = this.colorKey ? this.colorKey(c) : c.status === 'confirmed' ? 'confirmed' : needsReview(c) ? 'review' : 'auto';
      return VIEW_COLORS[k] || VIEW_COLORS.auto;
    },
    onDown(e) {
      if (e.button !== 0 && e.button !== 1) return;
      const p = this.toPage(e);
      this.$el.setPointerCapture(e.pointerId);
      if (this.panning || e.button === 1 || this.tool === 'select') this.drag = { kind: 'pan', x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false };
      else if (this.tool === 'box') this.rect = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      else if (this.tool === 'place') this.drag = { kind: 'place', x: e.clientX, y: e.clientY, p, moved: false };
    },
    onBalloonDown(e, c) {
      if (e.button !== 0) return;
      e.stopPropagation();
      this.$el.setPointerCapture(e.pointerId);
      if (this.panning) { this.drag = { kind: 'pan', x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false }; return; }
      this.drag = { kind: 'balloon', cid: c.cid, x: e.clientX, y: e.clientY, start: Object.assign({}, c.balloon), moved: false };
    },
    onMove(e) {
      if (this.rect) { const p = this.toPage(e); this.rect.x1 = p.x; this.rect.y1 = p.y; return; }
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      if (d.kind === 'pan') { this.tx = d.tx + dx; this.ty = d.ty + dy; this._moved = true; }
      else if (d.kind === 'balloon' && !this.readonly && d.moved) this.dragPos = { cid: d.cid, x: d.start.x + dx / this.s, y: d.start.y + dy / this.s };
    },
    onUp(e) {
      if (this.rect) {
        const r = this.rect; this.rect = null;
        const box = { x: Math.min(r.x0, r.x1), y: Math.min(r.y0, r.y1), w: Math.abs(r.x1 - r.x0), h: Math.abs(r.y1 - r.y0) };
        if (box.w > 6 && box.h > 6) this.$emit('rect', box);
        return;
      }
      const d = this.drag; this.drag = null;
      if (!d) return;
      if (d.kind === 'balloon') {
        if (d.moved && this.dragPos && !this.readonly) this.$emit('move', d.cid, Math.round(this.dragPos.x), Math.round(this.dragPos.y));
        else this.$emit('select', d.cid);
        this.dragPos = null;
      } else if (d.kind === 'place' && !d.moved) this.$emit('place', d.p);
      else if (d.kind === 'pan' && !d.moved) this.$emit('deselect');
    },
    pickAnchor(c) { this.$emit('select', c.cid); },
  },
  template: `
<div class="viewer relative w-full h-full overflow-hidden select-none" :class="['tool-' + tool, panning ? 'panning' : '']" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp">
  <div class="stage absolute left-0 top-0" :style="{ transform: 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')', width: w + 'px', height: h + 'px' }">
    <img v-if="src" :src="src" class="page" :width="w" :height="h" draggable="false" alt="图纸" @load="loaded = true">
    <img v-if="overlay" :src="overlay" class="absolute inset-0" :width="w" :height="h" draggable="false" alt="">
    <svg class="absolute left-0 top-0 overflow-visible" :width="w" :height="h" :viewBox="'0 0 ' + w + ' ' + h">
      <g v-if="boxes"><rect v-for="(x,i) in extra" :key="'u' + i" :x="x.box.x" :y="x.box.y" :width="x.box.w" :height="x.box.h" fill="rgba(148,163,184,.10)" stroke="#94a3b8" :stroke-width="Math.max(1, r * 0.06)" stroke-dasharray="4 3"><title>{{ x.text }}（{{ x.reason }}）</title></rect></g>
      <g v-for="c in chars" :key="c.cid" class="bl" :class="{ 'is-sel': c.cid === selected }">
        <rect v-if="c.anchor && (boxes || c.cid === selected)" :x="c.anchor.x - 2" :y="c.anchor.y - 2" :width="c.anchor.w + 4" :height="c.anchor.h + 4" rx="3" :fill="c.cid === selected ? 'rgba(31,99,224,.10)' : 'rgba(31,99,224,.04)'" :stroke="col(c).stroke" :stroke-width="Math.max(1, r * 0.08)" stroke-dasharray="5 3" @pointerdown.stop="pickAnchor(c)"/>
        <template v-if="c.balloon">
          <line v-if="lead(c)" :x1="lead(c).x1" :y1="lead(c).y1" :x2="lead(c).x2" :y2="lead(c).y2" :stroke="col(c).stroke" :stroke-width="Math.max(1.2, r * 0.1)"/>
          <circle v-if="lead(c)" :cx="lead(c).x2" :cy="lead(c).y2" :r="Math.max(2, r * 0.13)" :fill="col(c).stroke"/>
          <circle v-if="c.cid === selected" class="ring" :cx="pos(c).x" :cy="pos(c).y" :r="r * 1.55" fill="none" :stroke="col(c).stroke" :stroke-width="r * 0.18"/>
          <g @pointerdown="onBalloonDown($event, c)">
            <title>#{{ c.no }} {{ c.name }}  {{ specLine(c) }}</title>
            <circle class="face" :cx="pos(c).x" :cy="pos(c).y" :r="r" :fill="col(c).fill" :stroke="col(c).stroke" :stroke-width="r * 0.16"/>
            <text :x="pos(c).x" :y="pos(c).y + r * 0.36" text-anchor="middle" :font-size="String(c.no).length > 2 ? r * 0.8 : r" font-weight="700" :fill="col(c).text" font-family="-apple-system, 'PingFang SC', Arial, sans-serif" style="pointer-events:none">{{ c.no }}</text>
          </g>
        </template>
      </g>
      <rect v-if="rect" :x="Math.min(rect.x0, rect.x1)" :y="Math.min(rect.y0, rect.y1)" :width="Math.abs(rect.x1 - rect.x0)" :height="Math.abs(rect.y1 - rect.y0)" fill="rgba(52,120,246,.10)" stroke="#3478f6" :stroke-width="Math.max(1.5, 1.5 / s)" stroke-dasharray="6 4"/>
    </svg>
  </div>
  <div v-if="src && !loaded" class="absolute inset-0 flex items-center justify-center"><div class="w-64"><progress-bar/><p class="text-center text-xs text-ink-4 mt-2">正在加载图纸…</p></div></div>
  <div class="absolute right-3 bottom-3 flex items-center gap-0.5 p-1 rounded-xl glass shadow-soft ring-1 ring-black/5" @pointerdown.stop>
    <button type="button" class="btn-icon h-7 w-7" @click="zoomBy(1 / 1.35)" title="缩小"><ic name="zoom-out" :size="15"/></button>
    <span class="text-[11px] tabular w-11 text-center text-ink-3">{{ zoomPct }}%</span>
    <button type="button" class="btn-icon h-7 w-7" @click="zoomBy(1.35)" title="放大"><ic name="zoom-in" :size="15"/></button>
    <button type="button" class="btn-icon h-7 w-7" @click="fit" title="适应窗口"><ic name="maximize" :size="15"/></button>
  </div>
</div>`,
};

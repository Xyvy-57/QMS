/* =====================================================================
 * 公差标准：GB/T 1804 一般公差表、ISO 286 配合公差计算、识别规则（写法对照 + 在线试解析）
 * ===================================================================== */
const NOTATION_EXAMPLES = [
  ['直径、对称偏差', 'Ø20±0.1'], ['不对称偏差', '20 +0.10/-0.05'], ['单向偏差', '5 0/-0.05'], ['极限尺寸', '19.95~20.05'], ['配合代号', 'Ø80h7'],
  ['配合代号 + 偏差', 'Ø25g6(-0.007/-0.020)'], ['未注公差', '48'], ['半径', 'R5'], ['倒角', 'C0.5'], ['角度', '30°±30′'], ['数量', '4×Ø9'],
  ['螺纹', 'M8×1.25-6g'], ['粗糙度', 'Ra1.6'], ['垂直度', '⊥ 0.02 A'], ['位置度', '⌖ Ø0.1 A B'], ['硬度', 'HRC 58~62'], ['单侧要求', '镀层厚度 ≥0.35'],
];
COMPONENTS['page-tolerances'] = {
  setup() {
    const cls = ref(S.settings.defaultGeneralTol || 'm');
    const fit = reactive({ size: '20', code: 'H7' });
    const fitRes = computed(() => isoFit(fit.size, fit.code));
    const fitLimits = computed(() => { const r = fitRes.value; if (r.error || !DEC_RE.test(String(fit.size).trim())) return null; return { lo: decAdd(String(fit.size).trim(), r.lower), hi: decAdd(String(fit.size).trim(), r.upper) }; });
    const pairs = computed(() => [['H7', 'g6', '间隙配合'], ['H7', 'h6', '间隙（定位）'], ['H7', 'k6', '过渡配合'], ['H7', 'n6', '过渡配合'], ['H7', 'p6', '过盈配合']].map(([a, b, kind]) => ({ a, b, kind, ha: isoFit(fit.size, a), sb: isoFit(fit.size, b) })));
    const tryText = ref('Ø20±0.1');
    const tryRes = computed(() => parseSpec(tryText.value, { generalTol: cls.value }));
    const setDefault = async () => {
      try { const r = await api('PUT', '/settings', { defaultGeneralTol: cls.value }); Object.assign(S.settings, r); toast('默认未注公差等级已设为 ' + GBT1804_CLASSES[cls.value] + '：标题栏没写等级时按它处理（并标“需核对”）', 'success'); }
      catch (e) { toast(e.message, 'error'); }
    };
    return { cls, fit, fitRes, fitLimits, pairs, tryText, tryRes, setDefault, GBT1804, GBT1804_CLASSES, NOTATION_EXAMPLES, ISO_GRADES };
  },
  template: `
<div class="space-y-5">
  <div><h1 class="page-title">公差标准</h1><p class="text-xs text-ink-3 mt-1">识别时自动用这些表补公差：图面没写公差的按未注公差等级查 GB/T 1804，写了 H7、g6 这类代号的按 ISO 286 查表。查表得到的都会标“需核对”。</p></div>

  <div class="card p-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div><h2 class="section-title">一般公差 GB/T 1804-2000（等同 ISO 2768-1）</h2><p class="text-xs text-ink-3 mt-1">标题栏或技术要求写“未注公差按 GB/T 1804-m”时自动采用对应等级。</p></div>
      <div class="flex items-center gap-2"><seg v-model="cls" :options="Object.keys(GBT1804_CLASSES).map(k => ({ value: k, label: GBT1804_CLASSES[k] }))" size="sm"/><button class="btn-secondary btn-sm" @click="setDefault" :disabled="cls === S.settings.defaultGeneralTol">设为默认等级</button></div>
    </div>
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
      <div v-for="(tab,key) in GBT1804" :key="key" class="rounded-2xl ring-1 ring-black/[0.06] overflow-hidden">
        <div class="px-3 py-2 text-[12px] font-medium bg-[#fafafa] border-b border-black/[0.05]">{{ tab.title }}</div>
        <table class="tbl"><thead><tr><th>{{ key === 'angle' ? '短边长度 mm' : '尺寸 mm' }}</th><th v-for="(l,k) in GBT1804_CLASSES" :key="k" :class="k === cls ? '!text-brand-700' : ''">{{ k }}</th></tr></thead>
          <tbody><tr v-for="r in tab.rows" :key="r.label"><td class="tabular text-[12px]">{{ r.label }}</td><td v-for="(l,k) in GBT1804_CLASSES" :key="k" class="tabular text-[12px]" :class="k === cls ? 'bg-brand-50/60 font-semibold text-brand-800' : ''">{{ r[k] ? '±' + r[k] : '—' }}</td></tr></tbody></table>
      </div>
    </div>
  </div>

  <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
    <div class="card p-5">
      <h2 class="section-title">配合公差计算（ISO 286）</h2>
      <p class="text-xs text-ink-3 mt-1">支持孔 D E F G H JS K M N P、轴 d e f g h js k m n p，500 mm 以内。</p>
      <div class="flex flex-wrap items-end gap-3 mt-4">
        <div><label class="label">名义尺寸 mm</label><input v-model.trim="fit.size" class="input w-32 font-mono" inputmode="decimal"></div>
        <div><label class="label">公差带代号</label><input v-model.trim="fit.code" class="input w-28 font-mono" placeholder="H7"></div>
      </div>
      <div class="mt-4 rounded-2xl p-4" :class="fitRes.error ? 'bg-rose-50 text-rose-800' : 'bg-[#f7f7f9]'">
        <template v-if="fitRes.error">{{ fitRes.error }}</template>
        <template v-else>
          <div class="grid grid-cols-4 gap-3">
            <kv k="上偏差" :v="fitRes.upper" mono/><kv k="下偏差" :v="fitRes.lower" mono/><kv k="下限" :v="fitLimits ? fitLimits.lo : '—'" mono/><kv k="上限" :v="fitLimits ? fitLimits.hi : '—'" mono/>
          </div>
          <div class="text-[11.5px] text-ink-3 mt-3">{{ fitRes.kind }} · {{ fitRes.basis }}</div>
        </template>
      </div>
      <div class="mt-4"><div class="label">常用配合（按上面的名义尺寸）</div>
        <table class="tbl"><thead><tr><th>配合</th><th>性质</th><th>孔</th><th>轴</th></tr></thead>
          <tbody><tr v-for="p in pairs" :key="p.a + p.b"><td class="font-mono">{{ p.a }}/{{ p.b }}</td><td class="text-[12px]">{{ p.kind }}</td><td class="font-mono text-[12px]">{{ p.ha.error ? '—' : p.ha.upper + ' / ' + p.ha.lower }}</td><td class="font-mono text-[12px]">{{ p.sb.error ? '—' : p.sb.upper + ' / ' + p.sb.lower }}</td></tr></tbody></table>
      </div>
    </div>

    <div class="card p-5">
      <h2 class="section-title">识别规则</h2>
      <p class="text-xs text-ink-3 mt-1">输入一段图面标注，看看会被解析成什么。未注公差按左边选中的等级。</p>
      <div class="flex gap-2 mt-4"><input v-model="tryText" class="input font-mono flex-1" placeholder="例如 Ø20±0.1"></div>
      <div class="mt-3 rounded-2xl bg-[#f7f7f9] p-4 text-[12.5px]">
        <template v-if="tryRes && tryRes.ok">
          <div class="flex flex-wrap items-center gap-1.5"><span class="font-semibold text-[13.5px]">{{ tryRes.name }}</span><span class="chip-gray">{{ tryRes.cat }}</span><span class="chip-gray">{{ tryRes.kind === 'count' ? '计数' : '计量' }}</span><span :class="TOL_SOURCE[tryRes.tolSource][1]">{{ TOL_SOURCE[tryRes.tolSource][0] }}</span><span v-if="tryRes.cls" class="chip-red">{{ tryRes.cls }}</span></div>
          <div class="grid grid-cols-4 gap-3 mt-3"><kv k="名义值" :v="tryRes.nominal" mono/><kv k="上 / 下偏差" :v="(tryRes.upper || '—') + ' / ' + (tryRes.lower || '—')" mono/><kv k="下限" :v="tryRes.lsl" mono/><kv k="上限" :v="tryRes.usl" mono/></div>
          <div v-if="tryRes.spec" class="mt-2 text-ink-2">检验要求：{{ tryRes.spec }}</div>
          <div v-if="tryRes.tolNote" class="mt-2 text-amber-800">{{ tryRes.tolNote }}</div>
        </template>
        <template v-else-if="tryRes">不作为特性：{{ tryRes.reason }}</template>
        <template v-else>没能识别这段文字</template>
      </div>
      <div class="mt-4"><div class="label">支持的写法（点一下试试）</div>
        <div class="flex flex-wrap gap-1.5"><button v-for="x in NOTATION_EXAMPLES" :key="x[1]" class="h-7 px-2.5 rounded-lg ring-1 ring-inset ring-black/10 bg-white text-[12px] hover:ring-brand-500 transition-colors" :title="x[0]" @click="tryText = x[1]"><span class="text-ink-4 mr-1">{{ x[0] }}</span><span class="font-mono">{{ x[1] }}</span></button></div>
      </div>
    </div>
  </div>
</div>`,
};

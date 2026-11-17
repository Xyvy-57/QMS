/* =====================================================================
 * 页面 E：系统（用户与角色 / 操作日志 / 集成设置）· 外围模块空壳入口
 * ===================================================================== */

const PERM_GROUPS = [
  ['质量策划', ['bubble.sync', 'std.edit', 'std.approve', 'plan.edit', 'plan.approve']],
  ['生产主线', ['order.create', 'order.work', 'order.setup', 'order.release']],
  ['检验执行', ['task.create', 'task.measure', 'task.submit', 'task.retest']],
  ['报告', ['report.review', 'tpl.edit']],
  ['不合格与质量限制', ['ncr.create', 'ncr.scope', 'ncr.suggest', 'ncr.approve', 'ncr.execute', 'hold.create', 'hold.release']],
  ['基础资料与系统', ['md.edit', 'scene.edit', 'sys.admin']],
];
const ROLE_KEYS = ['insp', 'qe', 'ql', 'pm', 'wh', 'admin'];

function downloadText(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------------- 用户与角色 ---------------- */
COMPONENTS['page-users'] = {
  setup() {
    const nw = reactive({ open: false, name: '', dept: '', role: 'insp' });
    const openNew = () => { Object.assign(nw, { open: true, name: '', dept: '', role: 'insp' }); };
    const saveNew = () => {
      if (!nw.name.trim()) { toast('请填写姓名', 'error'); return; }
      S.users.push({ id: 'u' + nextSeq(), name: nw.name.trim(), role: nw.role, dept: nw.dept.trim() || '—' });
      logAudit('用户', nw.name.trim(), '新建账号，身份：' + ROLES[nw.role].name);
      nw.open = false; toast('账号已创建', 'success');
    };
    const setRole = (u, r) => { if (u.role === r) return; const old = ROLES[u.role].name; u.role = r; logAudit('用户', u.name, '身份由 ' + old + ' 调整为 ' + ROLES[r].name); toast(u.name + ' 的身份已调整为 ' + ROLES[r].name, 'success'); };
    const act = (id) => { S.me = id; toast('已切换身份：' + userName(id), 'info'); };
    const allow = (perm, role) => PERMS[perm].roles.includes(role);
    return { nw, openNew, saveNew, setRole, act, allow, PERM_GROUPS, ROLE_KEYS };
  },
  template: `
<div class="space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div><h1 class="page-title">用户与角色</h1><p class="text-xs text-ink-3 mt-1">六种演示身份及其权限是待确认的示例配置，不代表企业岗位制度。每个动作都由服务端按“动作 × 对象 × 范围”校验：能看到菜单不等于能执行。</p></div>
    <g-btn perm="sys.admin" cls="btn-primary" icon="plus" @click="openNew">新建账号</g-btn>
  </div>

  <div class="card overflow-hidden">
    <div class="overflow-x-auto"><table class="tbl">
      <thead><tr><th>账号</th><th>部门</th><th>身份</th><th>职责边界</th><th class="text-right">操作</th></tr></thead>
      <tbody>
        <tr v-for="u in S.users" :key="u.id" :class="u.id === S.me ? 'bg-brand-50/40' : ''">
          <td><span class="inline-flex items-center gap-2.5"><avatar :uid="u.id" :size="30"/><span><span class="font-medium">{{ u.name }}</span><span v-if="u.id === S.me" class="chip-brand ml-2">当前</span></span></span></td>
          <td class="text-ink-2">{{ u.dept }}</td>
          <td><select v-if="can('sys.admin')" :value="u.role" @change="setRole(u, $event.target.value)" class="input !h-8 !w-36"><option v-for="r in ROLE_KEYS" :key="r" :value="r">{{ ROLES[r].name }}</option></select><span v-else :class="ROLES[u.role].chip">{{ ROLES[u.role].name }}</span></td>
          <td class="text-[12px] text-ink-3 whitespace-normal min-w-[260px] max-w-[420px]">{{ ROLES[u.role].desc }}</td>
          <td class="text-right"><button class="btn-ghost btn-sm" :disabled="u.id === S.me" @click="act(u.id)"><ic name="user" :size="14"/>以此身份体验</button></td>
        </tr>
      </tbody>
    </table></div>
  </div>

  <div class="card overflow-hidden">
    <div class="px-5 pt-4 pb-3"><h2 class="section-title">动作权限矩阵</h2><p class="text-xs text-ink-3 mt-0.5">系统管理员负责账号与集成，不自动获得任何质量审批权；质量负责人批准与复核，但不代编制、不代录数；提出建议不等于批准。</p></div>
    <div class="overflow-x-auto"><table class="tbl">
      <thead><tr><th>动作</th><th v-for="r in ROLE_KEYS" :key="r" class="text-center"><span :class="ROLES[r].chip">{{ ROLES[r].name }}</span></th></tr></thead>
      <tbody>
        <template v-for="g in PERM_GROUPS" :key="g[0]">
          <tr><td :colspan="ROLE_KEYS.length + 1" class="!py-2 bg-[#fafafa] text-[11px] font-medium text-ink-4">{{ g[0] }}</td></tr>
          <tr v-for="p in g[1]" :key="p">
            <td>{{ PERMS[p].label }}<span class="ml-2 text-[10.5px] font-mono text-ink-5">{{ p }}</span></td>
            <td v-for="r in ROLE_KEYS" :key="r" class="text-center"><span v-if="allow(p, r)" class="inline-flex w-5 h-5 rounded-full items-center justify-center text-white" :class="r === who().role ? 'bg-brand-600' : 'bg-emerald-500'"><ic name="check" :size="12" stroke="2.8"/></span><span v-else class="text-ink-5">—</span></td>
          </tr>
        </template>
      </tbody>
    </table></div>
    <div class="px-5 py-3 text-[11.5px] text-ink-4 border-t border-black/[0.05]">附加约束（不在矩阵里，但始终生效）：提交人不得批准本人提交的标准修订；复核人不得为本轮签名人；未配置复核策略的场景不产生任何批准。</div>
  </div>

  <modal :open="nw.open" @close="nw.open = false" title="新建账号" sub="正式系统对接企业统一登录（OIDC / LDAP / 企业微信 / 钉钉，待确认）" width="max-w-md">
    <div class="space-y-4">
      <div><label class="label">姓名</label><input v-model="nw.name" class="input"></div>
      <div><label class="label">部门</label><input v-model="nw.dept" class="input" placeholder="如 质量部 · 检验组"></div>
      <div><label class="label">身份</label><select v-model="nw.role" class="input"><option v-for="r in ROLE_KEYS" :key="r" :value="r">{{ ROLES[r].name }}</option></select><p class="text-[11.5px] text-ink-4 mt-1.5">{{ ROLES[nw.role].desc }}</p></div>
    </div>
    <template #footer><button class="btn-secondary" @click="nw.open = false">取消</button><button class="btn-primary" @click="saveNew">创建</button></template>
  </modal>
</div>`,
};

/* ---------------- 操作日志 ---------------- */
COMPONENTS['page-audit'] = {
  setup() {
    const act = ref(''), uid = ref(''), q = ref('');
    const acts = computed(() => Array.from(new Set(S.audit.map((a) => a.act))));
    const rows = computed(() => { const k = q.value.trim().toLowerCase(); return S.audit.filter((a) => (!act.value || a.act === act.value) && (!uid.value || a.uid === uid.value) && (!k || (a.obj + ' ' + a.text).toLowerCase().includes(k))); });
    const exportCsv = () => {
      const cell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const lines = [['时间', '人员', '模块', '对象', '内容'].map(cell).join(',')].concat(rows.value.map((a) => [fmtTime(a.at), userName(a.uid), a.act, a.obj, a.text].map(cell).join(',')));
      downloadText('worlder-qms-操作日志.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
      toast('已导出 ' + rows.value.length + ' 条日志', 'success');
    };
    return { act, uid, q, acts, rows, exportCsv };
  },
  template: `
<div class="space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div><h1 class="page-title">操作日志</h1><p class="text-xs text-ink-3 mt-1">只追加、不修改：每次提交、批准、签名、处置与集成事件都留下时间、人员、对象和内容。</p></div>
    <button class="btn-secondary" @click="exportCsv"><ic name="download" :size="15"/>导出 CSV</button>
  </div>
  <div class="flex flex-wrap items-center gap-2">
    <select v-model="act" class="input !w-auto !h-[38px]"><option value="">全部模块</option><option v-for="a in acts" :key="a">{{ a }}</option></select>
    <select v-model="uid" class="input !w-auto !h-[38px]"><option value="">全部人员</option><option v-for="u in S.users" :key="u.id" :value="u.id">{{ u.name }}</option></select>
    <div class="relative"><ic name="search" :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"/><input v-model="q" class="input !h-[38px] pl-9 w-64" placeholder="搜索对象或内容"></div>
    <span class="text-xs text-ink-4 ml-1">共 {{ rows.length }} 条</span>
  </div>
  <div class="card overflow-hidden">
    <div class="overflow-auto max-h-[calc(100vh-280px)]"><table class="tbl">
      <thead><tr><th class="w-[150px]">时间</th><th class="w-[130px]">人员</th><th class="w-[110px]">模块</th><th class="w-[220px]">对象</th><th>内容</th></tr></thead>
      <tbody>
        <tr v-for="(a,i) in rows" :key="i">
          <td class="text-xs text-ink-3 whitespace-nowrap tabular">{{ fmtTime(a.at) }}</td>
          <td><span class="inline-flex items-center gap-1.5"><avatar :uid="a.uid" :size="20"/>{{ userName(a.uid) }}</span></td>
          <td><span class="chip-gray">{{ a.act }}</span></td>
          <td class="font-mono text-[12px]">{{ a.obj }}</td>
          <td class="text-[12.5px] text-ink-2 whitespace-normal min-w-[280px]">{{ a.text }}</td>
        </tr>
      </tbody>
    </table></div>
    <empty v-if="!rows.length" icon="history" title="没有符合条件的日志"/>
  </div>
</div>`,
};

/* ---------------- 集成设置 ---------------- */
const API_DOCS = [
  { title: '浏览器消息 postMessage（只做通知，必须校验 origin）', code: [
    '// 气泡图 → QMS',
    '{ "type": "worlder.ready" }',
    '{ "type": "worlder.balloon.frozen", "payload": { "syncBatchId": "SYNC-9107", "drawingNo": "DWG-2026-011", "drawingRev": "A4", "contentHash": "…", "balloonCount": 11 } }',
    '{ "type": "worlder.navigate", "route": "drawing-compare" }',
    '',
    '// QMS → 气泡图',
    '{ "type": "qms.context", "user": "吴清阳", "role": "qe", "token": "<后端签发的短期令牌>" }',
    '{ "type": "qms.navigate", "route": "drawing-packages" }',
  ].join('\n') },
  { title: 'POST /api/v1/open/balloon-sync（权威数据：后端按 syncBatchId 拉取或接收）', code: JSON.stringify({
    syncBatchId: 'SYNC-9107', partNo: '1.2020.01.1', drawingNo: 'DWG-2026-011', drawingRev: 'A4', contentHash: '9F3C…', annotatedFileUrl: 's3://qms-drawings/DWG-2026-011-A4-ballooned.pdf',
    balloons: [{ balloonNo: 1, characteristicId: 'CH-011-01', itemName: '1-1 轴直径', category: '线性尺寸', gdtSymbol: 'Ø', nominal: '20.00', upperTol: '+0.10', lowerTol: '-0.10', lsl: '19.90', usl: '20.10', unit: 'mm', specialClass: 'CTQ', coord: { page: 1, x: 66, y: 150 } }],
  }, null, 2) },
  { title: 'POST /api/v1/iot/gage-measurements（设备数据导入，带幂等键）', code: JSON.stringify({
    deviceCode: 'CMM-01', inspectionTaskNo: 'IQC-20261116-001', roundNo: 1, idempotencyKey: 'CMM-01-IQC-20261116-001-R1-1',
    measurements: [{ balloonNo: 1, characteristicId: 'CH-011-01', sampleIndex: 1, value: '20.01', measuredAt: '2026-11-16T16:45:10+08:00' }],
  }, null, 2) },
  { title: '统一错误结构', code: JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: '对象已被他人修改，请刷新后重试', details: { expectedVersion: 3, currentVersion: 4 }, retryable: false }, request_id: 'req_01JD…' }, null, 2) },
];
const BUBBLE_NEEDS = [
  ['有效的 TLS 证书', '当前地址为自签名证书：浏览器会拦截 iframe，需先在新窗口信任，正式环境须换成受信任证书'],
  ['允许被 QMS 内嵌', '响应头 Content-Security-Policy: frame-ancestors 放行 QMS 域名，并去掉 X-Frame-Options: DENY'],
  ['统一登录', '与 QMS 共用 OIDC 会话，或接受 qms.context 里的短期令牌，避免内嵌页再登录一次'],
  ['postMessage 通知', '页面就绪发 worlder.ready；冻结标注后发 worlder.balloon.frozen；接受 qms.navigate'],
  ['同步接口', '按 syncBatchId 提供冻结结果（气泡、稳定特性 ID、公差、坐标、内容摘要），重复请求幂等'],
];

COMPONENTS['page-settings'] = {
  setup() {
    const f = reactive({ bubbleBase: S.settings.bubbleBase, allowedOrigins: S.settings.allowedOrigins, handshakeTimeout: S.settings.handshakeTimeout, company: S.settings.company });
    const dirty = computed(() => f.bubbleBase !== S.settings.bubbleBase || f.allowedOrigins !== S.settings.allowedOrigins || +f.handshakeTimeout !== +S.settings.handshakeTimeout || f.company !== S.settings.company);
    const originOf = (u) => { try { return new URL(u).origin; } catch (e) { return ''; } };
    const save = () => {
      const o = originOf(f.bubbleBase.trim());
      if (!o) { toast('气泡服务地址不是有效的 URL', 'error'); return; }
      const list = String(f.allowedOrigins || '').split(/[\s,;]+/).filter(Boolean);
      if (!list.includes(o)) { list.push(o); f.allowedOrigins = list.join(', '); }
      Object.assign(S.settings, { bubbleBase: f.bubbleBase.trim().replace(/\/$/, ''), allowedOrigins: f.allowedOrigins, handshakeTimeout: Math.max(2, parseInt(f.handshakeTimeout, 10) || 6), company: f.company.trim() || S.settings.company });
      f.bubbleBase = S.settings.bubbleBase; f.handshakeTimeout = S.settings.handshakeTimeout;
      UI.bubble.status = 'idle'; UI.bubble.reloadKey++;
      logAudit('集成', '气泡识别服务', '更新集成设置：' + S.settings.bubbleBase);
      toast('集成设置已保存，气泡服务地址的来源已加入白名单', 'success');
    };
    const simulate = () => {
      const o = originOf(S.settings.bubbleBase);
      onBubbleMessage({ origin: o, data: { type: 'worlder.ready' }, source: { postMessage() {} } });
      toast(UI.bubble.status === 'handshake' ? '已模拟来自 ' + o + ' 的握手消息' : '握手被忽略：来源不在白名单中', UI.bubble.status === 'handshake' ? 'success' : 'warn');
    };
    const simulateBad = () => {
      const before = UI.bubble.lastMsg;
      onBubbleMessage({ origin: 'https://evil.example.com', data: { type: 'worlder.balloon.frozen', payload: { drawingNo: 'DWG-FAKE', drawingRev: 'Z' } }, source: { postMessage() {} } });
      toast(UI.bubble.lastMsg === before ? '非白名单来源的消息已被静默丢弃' : '异常：非白名单消息被处理了', UI.bubble.lastMsg === before ? 'success' : 'error');
    };
    const usage = computed(() => (JSON.stringify(S).length / 1024).toFixed(0));
    const exportState = () => { downloadText('worlder-qms-演示数据.json', JSON.stringify(S, null, 1), 'application/json'); toast('已导出演示数据', 'success'); };
    const reset = async () => { if (await confirmBox({ title: '重置演示数据？', message: '将清空浏览器中保存的全部演示数据，恢复为初始示例。', ok: '重置', danger: true })) resetDemo(); };
    const statusText = computed(() => ({ idle: '未连接', loading: '连接中', handshake: '已握手', nohandshake: '未收到握手' })[UI.bubble.status] || UI.bubble.status);
    /* 生产现场：班次、开班首件、扫码地址 */
    const pf = reactive({ shifts: shiftList().map((x) => ({ key: x.key, name: x.name, start: x.start })), faiShift: S.settings.faiShift !== false, scanBase: S.settings.scanBase || '' });
    const prodDirty = computed(() => JSON.stringify(pf.shifts) !== JSON.stringify(shiftList().map((x) => ({ key: x.key, name: x.name, start: x.start }))) || pf.faiShift !== (S.settings.faiShift !== false) || pf.scanBase.trim() !== (S.settings.scanBase || ''));
    const scanNow = computed(() => scanUrl('WO-2611-011'));
    const saveProd = () => {
      const bad = pf.shifts.find((x) => !String(x.name || '').trim() || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(x.start).trim()));
      if (bad) { toast('班次名称不能为空，开始时间写成 08:00 这样的格式', 'error'); return; }
      const starts = pf.shifts.map((x) => hmToMin(x.start));
      if (starts.some((m, i) => starts.indexOf(m) !== i)) { toast('两个班次的开始时间不能相同', 'error'); return; }
      /* 地址里的 #… 去掉：二维码会在后面拼 #/scan/工单号 */
      const raw = pf.scanBase.trim(), base = raw.replace(/#.*$/, '');
      if (base && !/^https?:\/\/\S+$/i.test(base)) { toast('扫码地址要以 http:// 或 https:// 开头', 'error'); return; }
      S.settings.shifts = pf.shifts.map((x) => ({ key: x.key, name: String(x.name).trim(), start: String(x.start).trim().padStart(5, '0') }));
      S.settings.faiShift = !!pf.faiShift;
      S.settings.scanBase = base;
      /* 表单换成保存后的值（时间补零、去掉 #…），保存按钮随之变回不可点 */
      pf.shifts = S.settings.shifts.map((x) => ({ key: x.key, name: x.name, start: x.start }));
      pf.scanBase = base;
      logAudit('集成', '生产现场', '更新班次（' + S.settings.shifts.map((x) => x.name + ' ' + x.start).join('、') + '）、开班首件' + (S.settings.faiShift ? '开启' : '关闭') + '、扫码地址 ' + (base || '跟随当前地址'));
      toast('生产现场设置已保存' + (base !== raw ? '（扫码地址里的 # 及后面的部分已去掉）' : ''), 'success');
    };
    return { f, dirty, save, simulate, simulateBad, usage, exportState, reset, statusText, API_DOCS, BUBBLE_NEEDS, pf, prodDirty, scanNow, saveProd };
  },
  template: `
<div class="space-y-5">
  <div><h1 class="page-title">集成设置</h1><p class="text-xs text-ink-3 mt-1">QMS 不自建标注引擎：图纸标注在 Worlder 气泡图中完成，通过 iframe 内嵌到“气泡识别工作台”，冻结结果同步为检验标准的来源。没有 ERP / MES / WMS 也能独立运行。</p></div>

  <div class="grid grid-cols-1 xl:grid-cols-5 gap-5">
    <div class="card p-5 xl:col-span-3 space-y-4">
      <div class="flex items-center justify-between gap-3"><h2 class="section-title">气泡识别服务（iframe 内嵌）</h2>
        <span :class="UI.bubble.status === 'handshake' ? 'chip-green' : 'chip-gray'"><span class="w-1.5 h-1.5 rounded-full" :class="UI.bubble.status === 'handshake' ? 'bg-emerald-500' : 'bg-ink-5'"></span>{{ statusText }}</span></div>
      <div><label class="label">服务地址</label><input v-model="f.bubbleBase" class="input font-mono" :disabled="!can('sys.admin')" placeholder="https://bubble.example.com"></div>
      <div><label class="label">允许的消息来源（origin 白名单，逗号分隔）</label><input v-model="f.allowedOrigins" class="input font-mono" :disabled="!can('sys.admin')"><p class="text-[11.5px] text-ink-4 mt-1.5">只处理来自白名单的浏览器消息，其余静默丢弃；浏览器消息只做通知，同步数据以后端接口为准。</p></div>
      <div class="grid grid-cols-2 gap-4">
        <div><label class="label">握手等待（秒）</label><input v-model="f.handshakeTimeout" type="number" min="2" class="input w-28" :disabled="!can('sys.admin')"></div>
        <div><label class="label">企业名称（报告抬头）</label><input v-model="f.company" class="input" :disabled="!can('sys.admin')"></div>
      </div>
      <div class="flex flex-wrap items-center gap-2 pt-1">
        <g-btn perm="sys.admin" cls="btn-primary" icon="check" :when="dirty" why="没有需要保存的修改" @click="save">保存设置</g-btn>
        <button class="btn-secondary" @click="simulate"><ic name="play" :size="14"/>模拟握手</button>
        <button class="btn-ghost" @click="simulateBad"><ic name="shield" :size="14"/>测试非白名单消息</button>
        <button class="btn-ghost" @click="go('/bubble')"><ic name="target" :size="14"/>打开气泡识别工作台</button>
      </div>
      <div v-if="UI.bubble.lastMsg" class="text-[11.5px] text-ink-4">最近一条消息：<span class="font-mono">{{ UI.bubble.lastMsg.type }}</span> · {{ UI.bubble.lastMsg.origin }} · {{ fmtRel(UI.bubble.lastMsg.at) }}</div>
    </div>

    <div class="card p-5 xl:col-span-2">
      <h2 class="section-title">需要气泡服务侧配合</h2>
      <p class="text-xs text-ink-3 mt-1">这是跨团队依赖，排期时需要一起确认。</p>
      <ol class="mt-3 space-y-3">
        <li v-for="(x,i) in BUBBLE_NEEDS" :key="i" class="flex gap-3"><span class="w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">{{ i + 1 }}</span><div><div class="font-medium text-[13px]">{{ x[0] }}</div><div class="text-[11.5px] text-ink-4 leading-relaxed mt-0.5">{{ x[1] }}</div></div></li>
      </ol>
    </div>
  </div>

  <div class="grid grid-cols-1 xl:grid-cols-5 gap-5" data-panel="production">
    <div class="card p-5 xl:col-span-3 space-y-4">
      <div><h2 class="section-title">生产现场</h2><p class="text-xs text-ink-3 mt-1">班次决定“开班首件”和现场看板的“本班”；扫码地址写进工单流转卡的二维码。</p></div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div v-for="(x,i) in pf.shifts" :key="x.key" class="rounded-xl bg-[#f7f7f9] p-3 grid grid-cols-2 gap-2">
          <div><label class="label">班次 {{ i + 1 }}</label><input v-model="x.name" class="input" :disabled="!can('sys.admin')"></div>
          <div><label class="label">开始时间</label><input v-model="x.start" class="input font-mono" placeholder="08:00" :disabled="!can('sys.admin')"></div>
        </div>
      </div>
      <label class="flex items-start gap-2.5 text-[13px] cursor-pointer"><input type="checkbox" v-model="pf.faiShift" class="w-4 h-4 mt-0.5 accent-brand-600" :disabled="!can('sys.admin')"><span><span class="font-medium">开班首件</span><span class="block text-[12px] text-ink-3 mt-0.5">上一班首件已经合格、这一班还在生产的机台，开班后要再做一次首件。关掉后只按登记的开工、换型、换刀、修机后等事件要求首件。</span></span></label>
      <div><label class="label">扫码地址（平板、手机访问 QMS 用的地址）</label><input v-model="pf.scanBase" class="input font-mono" placeholder="例如 http://192.168.1.20:5180/ ；留空则用当前打开 QMS 的地址" :disabled="!can('sys.admin')">
        <p class="text-[11.5px] text-ink-4 mt-1.5 leading-relaxed">现在二维码里的地址：<span class="font-mono break-all">{{ scanNow }}</span>。localhost 只有本机能打开：让平板扫码时，用 <span class="font-mono">node server.mjs --host 0.0.0.0</span> 启动服务，把终端显示的局域网地址填在这里。</p></div>
      <g-btn perm="sys.admin" cls="btn-primary" icon="check" :when="prodDirty" why="没有需要保存的修改" @click="saveProd">保存生产现场设置</g-btn>
    </div>
    <div class="card overflow-hidden xl:col-span-2">
      <div class="px-5 pt-4 pb-2"><h2 class="section-title">机台</h2><p class="text-xs text-ink-3 mt-1">演示数据。正式系统从设备台账同步。</p></div>
      <table class="tbl"><thead><tr><th>编号</th><th>名称</th><th>产线</th></tr></thead>
        <tbody><tr v-for="m in S.machines || []" :key="m.code"><td class="font-mono text-[12.5px]">{{ m.code }}</td><td>{{ m.name }}</td><td class="text-ink-3">{{ m.line }}</td></tr></tbody></table>
    </div>
  </div>

  <div class="card p-5">
    <h2 class="section-title">接口契约</h2>
    <p class="text-xs text-ink-3 mt-1">数值一律用字符串传递，由服务端做十进制精确比较；所有写入接口带幂等键，重复提交不重复入账。</p>
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4"><code-block v-for="d in API_DOCS" :key="d.title" :title="d.title" :code="d.code"/></div>
  </div>

  <div class="card p-5 flex flex-wrap items-center justify-between gap-4">
    <div><h2 class="section-title">演示数据</h2><p class="text-xs text-ink-3 mt-1">全部数据保存在本机浏览器（约 {{ usage }} KB），不上传任何服务器。正式系统使用 PostgreSQL 与私有对象存储。</p></div>
    <div class="flex items-center gap-2"><button class="btn-secondary" @click="exportState"><ic name="download" :size="15"/>导出 JSON</button><button class="btn-danger" @click="reset"><ic name="rotate-ccw" :size="15"/>重置演示数据</button></div>
  </div>
</div>`,
};

/* ---------------- 外围模块空壳入口（M10） ---------------- */
COMPONENTS['page-ext'] = {
  setup() {
    const x = computed(() => EXT[UI.route.params.key] || null);
    const others = computed(() => Object.keys(EXT).filter((k) => k !== UI.route.params.key));
    return { x, others };
  },
  template: `
<div v-if="x" class="space-y-6">
  <div class="card overflow-hidden">
    <div class="px-6 sm:px-10 py-10 sm:py-14" style="background:linear-gradient(135deg,#f5f8ff 0%,#ffffff 55%,#f7f5ff 100%)">
      <div class="flex flex-wrap items-center gap-2"><span class="chip-amber">规划中</span><span class="chip-gray">{{ x.phase }}</span></div>
      <div class="flex items-center gap-4 mt-5"><span class="w-14 h-14 rounded-[18px] bg-white shadow-lift flex items-center justify-center text-brand-600"><ic :name="x.icon" :size="26"/></span><h1 class="text-[30px] sm:text-[36px] font-semibold tracking-tight">{{ x.title }}</h1></div>
      <p class="text-[15px] text-ink-2 mt-4 max-w-3xl leading-relaxed">{{ x.desc }}</p>
      <p class="text-[12.5px] text-ink-4 mt-3">首期只保留入口：先把“图纸气泡 → 标准 → 方案 → 五类检验 → 报告 → 不合格处置”主链做扎实，再接入这个模块。</p>
    </div>
  </div>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
    <div class="card p-6">
      <h2 class="section-title">计划提供的能力</h2>
      <ul class="mt-4 space-y-3"><li v-for="f in x.features" :key="f" class="flex gap-3 text-[13px] text-ink-2 leading-relaxed"><span class="w-5 h-5 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 mt-0.5"><ic name="check" :size="12" stroke="2.6"/></span>{{ f }}</li></ul>
    </div>
    <div class="card p-6">
      <h2 class="section-title">与首期模块的衔接</h2>
      <ul class="mt-4 space-y-3"><li v-for="l in x.links" :key="l" class="flex gap-3 text-[13px] text-ink-2 leading-relaxed"><span class="w-5 h-5 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5"><ic name="link" :size="12"/></span>{{ l }}</li></ul>
      <div class="mt-6 rounded-2xl bg-[#f7f7f9] p-4">
        <div class="text-[11px] text-ink-4 mb-3">页面骨架（示意）</div>
        <div class="space-y-2"><div class="skeleton h-7 w-2/5"></div><div class="grid grid-cols-3 gap-2"><div class="skeleton h-14"></div><div class="skeleton h-14"></div><div class="skeleton h-14"></div></div><div class="skeleton h-24"></div></div>
      </div>
    </div>
  </div>
  <div class="card p-5">
    <div class="text-xs text-ink-4 mb-3">其它规划中的模块</div>
    <div class="flex flex-wrap gap-2"><button v-for="k in others" :key="k" class="inline-flex items-center gap-2 h-9 px-3.5 rounded-xl bg-[#f7f7f9] hover:bg-brand-50 hover:text-brand-700 text-[13px] text-ink-2 transition-colors" @click="go('/ext/' + k)"><ic :name="EXT[k].icon" :size="15"/>{{ EXT[k].title }}</button><button class="btn-secondary ml-auto" @click="go('/workbench')">返回工作台</button></div>
  </div>
</div>
<empty v-else icon="wrench" title="模块不存在"><button class="btn-secondary" @click="go('/workbench')">返回工作台</button></empty>`,
};

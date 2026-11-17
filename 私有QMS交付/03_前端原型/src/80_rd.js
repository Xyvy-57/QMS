/* =====================================================================
 * 页面 F：研发排期看板（内部研发协作工具，不属于交付给客户的产品功能）
 * 8 列与《开发流程确定方案》§4 的状态 ①–⑧ 一一对应；门禁 G2–G10 在这里强制校验。
 * 截图原文的 4 道门禁：G3（产品/组长确认清单）、G5（字段自测后标注已完成）、
 *                      G6（前端凭“已完成 + 接口文档”接手）、G9（联调清单通过才提测）。
 * ===================================================================== */

const RD_COLS = [
  { n: 1, name: '后端排期', owner: '后端', code: 'S1_BE_SCHEDULE' },
  { n: 2, name: '任务清单待确认', owner: '产品 / 组长', code: 'S2_TASKLIST_PENDING' },
  { n: 3, name: '后端开发 · CI/CD 部署', owner: '后端', code: 'S3_BE_DEV' },
  { n: 4, name: '后端自测 · 标注已完成', owner: '后端', code: 'S4_BE_SELFTEST' },
  { n: 5, name: '前端排期与开发', owner: '前端', code: 'S5_FE_DEV' },
  { n: 6, name: '前端提交测试环境', owner: '前端', code: 'S6_FE_SUBMITTED' },
  { n: 7, name: '前后端联调自测', owner: '前端 + 后端', code: 'S7_JOINT_TEST' },
  { n: 8, name: '专业测试（QA）', owner: '测试', code: 'S8_QA' },
];
const RD_ROLES = { pm: '产品 / 项目组长', be: '后端', fe: '前端', qa: '测试（QA）' };
const RD_C = [['C1', '人力占用'], ['C2', '同模块并行改动'], ['C3', '同表 / 同迁移并行改动'], ['C4', '上游依赖未完成'], ['C5', '外部服务排期（气泡服务改造）'], ['C6', '测试环境占用'], ['C7', '发版窗口'], ['C8', '企业策略未定'], ['C9', '节假日与请假']];
const RD_F = [['F1', '字段齐全：接口返回 = 接口文档 = PRD 字段表'], ['F2', '类型一致；实测值、公差、规格限以字符串传输'], ['F3', '必填缺失返回 422 与字段级错误'], ['F4', '枚举值与 PRD 完全一致'], ['F5', '空值语义：缺失 ≠ 0，不补零、不补合格'], ['F6', '时间为 ISO 8601 带时区'], ['F7', '统一错误结构'], ['F8', '无权限返回 403；管理员调用批准类接口被拒'], ['F9', '对象不存在返回 404'], ['F10', '版本不符返回 409'], ['F11', '幂等：重复提交不产生重复事实'], ['F12', '列表无匹配返回空集合，不忽略筛选'], ['F13', '要求审计的动作已写入操作日志'], ['F14', '判定在服务端，不接受客户端汇总结果'], ['F15', '附件鉴权下载；签名绑定内容摘要']];
const RD_J = [['J1', '主路径走通（新建 → 执行 → 提交 → 报告）'], ['J2', '异常路径（缺失、超差、重复导入、版本冲突）'], ['J3', '六种身份的权限表现与置灰原因'], ['J4', '移动端拍照与手写签名'], ['J5', '刷新后数据与状态一致'], ['J6', '错误提示可读，无未处理异常']];
const RD_FE = [['feMerged', '前端代码已合并到测试分支'], ['feCi', 'CI 通过'], ['feDeployed', '测试环境部署成功'], ['designChecked', '对照设计稿自查完成']];
const RD_PIPE = ['代码规范检查', '单元测试', '构建镜像', '部署测试环境', '冒烟测试'];
const RD_ORIGIN = [
  ['①', '后端从项目系统里接到需求以后先排好期，确保不能跟现有需求冲突。'],
  ['②', '开发前需要先读设计稿和需求文档，并在后台排出任务清单，由产品或项目组长确认以后才能开发。'],
  ['③', '开发完以后必须合并提交代码到测试环境，然后 CI/CD 流水线会自动部署代码到测试后台。'],
  ['④', '自测以后确保字段都有，在后台里标注已完成。'],
  ['⑤', '前端看到已完成状态后同样进行排期，找后端要接口对接文档，并对照项目里备注的设计文档开始做页面、对接后端接口。'],
  ['⑥', '前端做完后同步提交测试环境。'],
  ['⑦ ⑧', '前后端沟通排期进行联调自测，自测完觉得没有问题、功能能跑，再提交专业测试进行测试。'],
];
/* 允许的退回路径（《开发流程确定方案》§4.3 状态图） */
const RD_BACK = { '2>1': ['pm', '驳回任务清单，需重排'], '4>3': ['be', '自测发现问题，回到开发'], '7>3': ['be', '联调发现后端问题'], '7>5': ['fe', '联调发现前端问题'], '8>7': ['qa', 'QA 退回，缺陷修复后重新联调'] };

function rdChecks(list, done) { return list.map((x) => ({ k: x[0], t: x[1], ok: !!done })); }
function rdSeed() {
  const mk = (o) => {
    const s = o.stage;
    return Object.assign({
      id: '', title: '', fr: '', prd: '', design: '', beOwner: '后端 A', feOwner: '前端 A', ext: false, policy: false, done: false,
      beSchedule: '', feSchedule: '', taskList: [], listSubmitted: s > 2, confirmedBy: s > 2 ? '产品经理' : '', confirmedAt: s > 2 ? daysAgo(3) : '',
      conflict: rdChecks(RD_C, s > 1), merged: s > 3, ci: s > 3, deployed: s > 3, pipeline: s > 3 ? 'pipeline #' + (1180 + s * 7) : '',
      fields: rdChecks(RD_F, s > 4), beDone: s > 4, apiDoc: s > 4 ? 'openapi/' + o.id.toLowerCase() + '.json' : '', selfTestNote: s > 4 ? '主路径与异常路径已跑通' : '',
      feMerged: s > 5, feCi: s > 5, feDeployed: s > 5, designChecked: s > 5, jointAt: s > 6 ? '已约定' : '', jointBeOk: s > 6,
      joint: rdChecks(RD_J, s > 7), submitNote: s > 7 ? '提测单已填写' : '', qaNote: '', history: [{ at: daysAgo(6), role: 'pm', text: '需求评审通过，进入排期（G1）' }],
    }, o);
  };
  return [
    mk({ id: 'REQ-01', title: '基础框架：账号 / 角色 / 权限 / 审计 / 集成设置', fr: 'FR-SYS', prd: 'PRD §6.9', design: '原型 › 系统', stage: 8, beSchedule: '11/23 – 12/02', feSchedule: '12/03 – 12/09', taskList: ['用户、角色、动作权限表与迁移', '审计日志（只追加）', '集成设置与 origin 白名单', '统一登录对接（OIDC）', '权限 403 与管理员禁批用例'] }),
    mk({ id: 'REQ-03', title: '基础资料与复用：零部件 / 工序路线模板 / 检具方法 / 场景步骤库', fr: 'FR-MD', prd: 'PRD §6.8、§5', design: '原型 › 基础资料', stage: 7, beSchedule: '12/03 – 12/10', feSchedule: '12/11 – 12/17', beOwner: '后端 B', feOwner: '前端 B', taskList: ['零部件一物一档', '工序路线模板与应用（独立副本）', '检具与检验方法', '检验场景定义版本化', '流程步骤库（固定步骤，不做 BPM）'] }),
    mk({ id: 'REQ-02', title: '气泡集成与检验标准：iframe 内嵌 / 同步收件箱 / 标准版本', fr: 'FR-DRW / FR-STD', prd: 'PRD §6.2、§6.3、§7', design: '原型 › 气泡识别工作台 / 检验标准', stage: 5, ext: true, beSchedule: '12/11 – 12/22', feSchedule: '12/23 – 12/30', taskList: ['balloon-sync 接收与按批次拉取（幂等）', '同步收件箱与差异计算（按稳定特性 ID）', '标准版本状态机与内容摘要', 'postMessage 协议与 origin 校验', '气泡服务侧配合项跟踪'] }),
    mk({ id: 'REQ-04', title: '检验方案：抽样组 / 特性分配 / 模板 / 换版', fr: 'FR-PLN', prd: 'PRD §6.4', design: '原型 › 检验方案', stage: 4, policy: true, beSchedule: '12/23 – 12/30', beOwner: '后端 B', feOwner: '前端 B', taskList: ['方案修订状态机', '抽样组与授权抽样规则', '方案模板（规则映射）', '采用新标准版本生成新修订'] }),
    mk({ id: 'REQ-05', title: '检验执行引擎：任务 / 轮次 / 录数 / 判定 / 拍照 / 签名', fr: 'FR-INS', prd: 'PRD §6.5', design: '原型 › 检验执行', stage: 3, policy: true, beSchedule: '12/31 – 01/15', taskList: ['任务三层快照', '轮次与复检（新轮次）', '十进制判定与计数判批', '设备导入（幂等、异常分流）', '照片与签名附件存储', '完整性检查与证据不足'] }),
    mk({ id: 'REQ-06', title: '检验报告：冻结 / 复核 / 打印 / 模板', fr: 'FR-RPT', prd: 'PRD §6.7', design: '原型 › 检验报告', stage: 2, policy: true, listSubmitted: true, beSchedule: '01/18 – 01/25', beOwner: '后端 B', feOwner: '前端 B', taskList: ['报告内容冻结与摘要', '复核策略与独立性校验', 'A4 打印与 PDF', 'Excel 模板映射'] }),
    mk({ id: 'REQ-07', title: '不合格处置 NCR 与质量限制', fr: 'FR-NCR', prd: 'PRD §6.6', design: '原型 › 不合格处置', stage: 2, listSubmitted: false, beSchedule: '01/18 – 01/27', taskList: ['NCR 状态机', '处置行与数量校验'] }),
    mk({ id: 'REQ-08', title: '工作台与外围空壳入口', fr: 'FR-WB / FR-EXT', prd: 'PRD §6.1、§6.10', design: '原型 › 工作台', stage: 1, beOwner: '后端 B', feOwner: '前端 B' }),
  ];
}
/* 首次加载或旧版本数据：初始化看板数据 */
if (!Array.isArray(S.rd) || !S.rd.length || !S.rd[0].conflict || S.rd[0].conflict.length !== RD_C.length) S.rd = rdSeed();

/** 门禁判断：返回 { ok, unmet[], roles[], gate } 或 { illegal: true } */
function rdGate(c, to) {
  const from = c.stage, unmet = [];
  const left = (arr) => arr.filter((x) => !x.ok).length;
  if (to === from + 1) {
    if (from === 1) { if (!c.beSchedule.trim()) unmet.push('填写后端排期'); if (left(c.conflict)) unmet.push('冲突检查清单还有 ' + left(c.conflict) + ' 项未确认（C1–C9）'); return { ok: !unmet.length, unmet, roles: ['be'], gate: 'G2' }; }
    if (from === 2) { if (!c.taskList.length) unmet.push('任务清单为空'); if (!c.listSubmitted) unmet.push('后端尚未提交任务清单'); return { ok: !unmet.length, unmet, roles: ['pm'], gate: 'G3' }; }
    if (from === 3) { if (!c.merged) unmet.push('代码未合并到测试分支'); if (!c.ci) unmet.push('CI 未全部通过'); if (!c.deployed) unmet.push('测试环境未部署成功'); return { ok: !unmet.length, unmet, roles: ['be'], gate: 'G4' }; }
    if (from === 4) { if (!c.beDone) unmet.push('后端尚未标注“已完成”（G5）'); if (!c.apiDoc.trim()) unmet.push('接口文档链接为空'); if (!c.design.trim()) unmet.push('设计稿链接为空'); return { ok: !unmet.length, unmet, roles: ['fe'], gate: 'G6' }; }
    if (from === 5) { if (!c.feSchedule.trim()) unmet.push('填写前端排期'); RD_FE.forEach((x) => { if (!c[x[0]]) unmet.push(x[1]); }); return { ok: !unmet.length, unmet, roles: ['fe'], gate: 'G7' }; }
    if (from === 6) { if (!c.jointAt.trim()) unmet.push('未约定联调时间'); if (!c.jointBeOk) unmet.push('后端尚未确认联调时间'); return { ok: !unmet.length, unmet, roles: ['fe'], gate: 'G8' }; }
    if (from === 7) { if (left(c.joint)) unmet.push('联调清单还有 ' + left(c.joint) + ' 项未通过'); if (!c.submitNote.trim()) unmet.push('提测单未填写'); return { ok: !unmet.length, unmet, roles: ['fe', 'be'], gate: 'G9' }; }
  }
  const back = RD_BACK[from + '>' + to];
  if (back) return { ok: true, unmet, roles: [back[0]], gate: '退回', back: back[1] };
  return { illegal: true };
}

COMPONENTS['page-rd'] = {
  setup() {
    const role = ref('pm');
    const roleOpts = Object.keys(RD_ROLES).map((k) => ({ value: k, label: RD_ROLES[k] }));
    const showOrigin = ref(false);
    const cardsOf = (n) => S.rd.filter((c) => c.stage === n);
    const colName = (n) => '① ② ③ ④ ⑤ ⑥ ⑦ ⑧'.split(' ')[n - 1] + ' ' + RD_COLS[n - 1].name;
    const progress = (c) => {
      if (c.stage === 1) return [c.conflict.filter((x) => x.ok).length, c.conflict.length, 'C'];
      if (c.stage === 2) return [c.listSubmitted ? 1 : 0, 1, c.listSubmitted ? '待确认' : '待提交'];
      if (c.stage === 3) return [[c.merged, c.ci, c.deployed].filter(Boolean).length, 3, 'CI'];
      if (c.stage === 4) return [c.fields.filter((x) => x.ok).length, c.fields.length, 'F'];
      if (c.stage === 5) return [RD_FE.filter((x) => c[x[0]]).length, RD_FE.length, 'FE'];
      if (c.stage === 6) return [(c.jointAt.trim() ? 1 : 0) + (c.jointBeOk ? 1 : 0), 2, '联调'];
      if (c.stage === 7) return [c.joint.filter((x) => x.ok).length, c.joint.length, 'J'];
      return [c.done ? 1 : 0, 1, 'QA'];
    };
    const log = (c, text) => { c.history.push({ at: nowISO(), role: role.value, text }); };

    /* —— 详情抽屉 —— */
    const cur = ref(null);
    const c = computed(() => S.rd.find((x) => x.id === cur.value) || null);
    const open = (card) => { cur.value = card.id; };
    const mine = (roles) => roles.includes(role.value);
    const why = (roles) => '当前研发角色「' + RD_ROLES[role.value] + '」不能操作（需 ' + roles.map((r) => RD_ROLES[r]).join(' / ') + '）';
    const newTask = ref('');
    const addTask = () => { const v = newTask.value.trim(); if (!v) return; c.value.taskList.push(v); newTask.value = ''; };
    const submitList = () => { if (!c.value.taskList.length) { toast('任务清单为空', 'error'); return; } c.value.listSubmitted = true; log(c.value, '提交任务清单（' + c.value.taskList.length + ' 项），等待产品或项目组长确认'); toast('任务清单已提交，等待产品或项目组长确认', 'success'); };

    /* —— CI/CD 流水线模拟 —— */
    const pipe = reactive({ id: '', step: -1 });
    const runPipe = (card) => {
      if (pipe.id) return;
      pipe.id = card.id; pipe.step = 0;
      const tick = () => {
        if (pipe.step < RD_PIPE.length - 1) { pipe.step++; setTimeout(tick, 520); return; }
        setTimeout(() => {
          Object.assign(card, { merged: true, ci: true, deployed: true, pipeline: 'pipeline #' + (1200 + nextSeq()) });
          log(card, '合并到测试分支，CI/CD 自动部署测试环境成功（' + card.pipeline + '）');
          pipe.id = ''; pipe.step = -1; toast(card.id + '：流水线全部通过，已自动部署到测试后台', 'success');
        }, 520);
      };
      setTimeout(tick, 520);
    };

    /* —— G5：字段自测后标注已完成；G11：标注后改接口须回到自测中 —— */
    const markDone = (card) => {
      const n = card.fields.filter((x) => !x.ok).length;
      if (n) { toast('门禁 G5 未通过：字段自测清单还有 ' + n + ' 项未勾选（F1–F15）', 'error'); return; }
      if (!card.apiDoc.trim()) { toast('门禁 G5 未通过：请填写接口文档链接', 'error'); return; }
      card.beDone = true; log(card, '字段自测清单 15 / 15 通过，标注“已完成”，接口文档 ' + card.apiDoc + '；系统通知前端排期');
      toast(card.id + ' 已标注“已完成”，已通知前端', 'success');
    };
    const chg = reactive({ open: false, note: '' });
    const apiChanged = () => {
      const card = c.value; if (!chg.note.trim()) { toast('请填写接口变更说明', 'error'); return; }
      card.beDone = false; card.stage = 4; card.fields.forEach((x) => { x.ok = false; });
      log(card, '接口变更（G11）：' + chg.note.trim() + '。回到 ④ 自测中，须更新接口文档并重新自测，已通知前端');
      chg.open = false; chg.note = ''; toast('已回到 ④ 自测中，并通知前端接口有变更', 'warn');
    };

    /* —— 推进 / 退回 —— */
    const back = reactive({ open: false, id: '', to: 0, label: '', reason: '' });
    const doMove = (card, to, gate, reason) => {
      const from = card.stage;
      if (to > from) {
        if (from === 2) { card.confirmedBy = RD_ROLES[role.value]; card.confirmedAt = nowISO(); }
        log(card, '通过门禁 ' + gate + '：' + colName(from) + ' → ' + colName(to));
      } else {
        if (to === 1) card.listSubmitted = false;
        if (to === 3) Object.assign(card, { merged: false, ci: false, deployed: false, beDone: false });
        if (to === 5) Object.assign(card, { feMerged: false, feCi: false, feDeployed: false });
        if (to === 7) card.joint.forEach((x) => { x.ok = false; });
        if (from === 7) { card.jointAt = ''; card.jointBeOk = false; }
        log(card, '退回 ' + colName(from) + ' → ' + colName(to) + '：' + reason);
      }
      card.stage = to;
      toast(card.id + ' 已' + (to > from ? '进入 ' : '退回 ') + colName(to), to > from ? 'success' : 'warn');
    };
    const tryMove = (card, to) => {
      if (card.stage === to) return;
      const g = rdGate(card, to);
      if (g.illegal) { toast('不能从 ' + colName(card.stage) + ' 直接移到 ' + colName(to) + '：只能逐步推进，或按规定路径退回', 'warn'); return; }
      if (!g.roles.includes(role.value)) { toast(why(g.roles), 'warn'); return; }
      if (!g.ok) { toast('门禁 ' + g.gate + ' 未通过：' + g.unmet[0] + (g.unmet.length > 1 ? ' 等 ' + g.unmet.length + ' 项' : ''), 'error'); open(card); return; }
      if (to < card.stage) { Object.assign(back, { open: true, id: card.id, to, label: g.back, reason: '' }); return; }
      doMove(card, to, g.gate);
    };
    const saveBack = () => { const card = S.rd.find((x) => x.id === back.id); if (!card || !back.reason.trim()) { toast('请填写退回原因', 'error'); return; } doMove(card, back.to, '退回', back.reason.trim()); back.open = false; };
    const qaPass = (card) => { if (!card.qaNote.trim()) { toast('请填写测试结论', 'error'); return; } card.done = true; log(card, 'QA 准出（G10）：' + card.qaNote.trim()); toast(card.id + ' 已通过专业测试', 'success'); };
    const gateOf = (card) => rdGate(card, card.stage + 1);

    /* —— 拖拽 —— */
    const dragId = ref(''), over = ref(0);
    const onDragStart = (card, e) => { dragId.value = card.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', card.id); };
    const onDragEnd = () => { dragId.value = ''; over.value = 0; };
    const onDrop = (n) => { const card = S.rd.find((x) => x.id === dragId.value); onDragEnd(); if (card) tryMove(card, n); };
    const dropCls = (n) => { if (!dragId.value || over.value !== n) return ''; const card = S.rd.find((x) => x.id === dragId.value); return card && card.stage !== n && !rdGate(card, n).illegal ? 'drop-ok' : ''; };
    const resetBoard = async () => { if (await confirmBox({ title: '重置看板？', message: '看板恢复为初始演示数据，不影响 QMS 业务数据。', ok: '重置' })) { cur.value = null; S.rd = rdSeed(); } };
    const stats = computed(() => ({ total: S.rd.length, qa: S.rd.filter((x) => x.stage === 8).length, done: S.rd.filter((x) => x.done).length, ext: S.rd.filter((x) => x.ext).length }));
    return { role, roleOpts, showOrigin, cardsOf, colName, progress, cur, c, open, mine, why, newTask, addTask, submitList, pipe, runPipe, markDone, chg, apiChanged, back, tryMove, saveBack, qaPass, gateOf, dragId, over, onDragStart, onDragEnd, onDrop, dropCls, resetBoard, stats, RD_COLS, RD_ROLES, RD_FE, RD_PIPE, RD_ORIGIN };
  },
  template: `
<div class="space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div><div class="flex items-center gap-2"><h1 class="page-title">研发排期看板</h1><span class="chip-amber">内部工具</span></div>
      <p class="text-xs text-ink-3 mt-1 max-w-3xl">团队内部的研发协作看板，不属于交付给客户的产品功能。8 列对应《开发流程确定方案》的状态 ①–⑧；拖动卡片或在详情里推进时，按门禁强制校验。卡片所处阶段为流程演示，排期取自方案中的估算。</p></div>
    <div class="flex flex-wrap items-center gap-2"><span class="text-xs text-ink-4">当前研发角色</span><seg v-model="role" :options="roleOpts" size="sm"/><button class="btn-ghost btn-sm" @click="showOrigin = !showOrigin"><ic name="book" :size="14"/>流程原文</button><button class="btn-ghost btn-sm" @click="resetBoard"><ic name="rotate-ccw" :size="14"/>重置</button></div>
  </div>

  <transition name="fade"><div v-if="showOrigin" class="card p-5">
    <div class="flex items-center justify-between mb-3"><h2 class="section-title">团队开发流程（原文 7 步）</h2><span class="text-xs text-ink-4">看板列与原文一一对应；⑦ 之后的“提交专业测试”单独成列 ⑧</span></div>
    <ol class="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-2.5"><li v-for="x in RD_ORIGIN" :key="x[0]" class="flex gap-3 text-[12.5px] leading-relaxed"><span class="shrink-0 w-10 text-brand-700 font-semibold">{{ x[0] }}</span><span class="text-ink-2">{{ x[1] }}</span></li></ol>
  </div></transition>

  <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
    <div class="card p-4"><div class="text-xs text-ink-3">首期需求包</div><div class="text-2xl font-semibold tabular mt-1">{{ stats.total }}</div></div>
    <div class="card p-4"><div class="text-xs text-ink-3">专业测试中</div><div class="text-2xl font-semibold tabular mt-1">{{ stats.qa }}</div></div>
    <div class="card p-4"><div class="text-xs text-ink-3">QA 已准出</div><div class="text-2xl font-semibold tabular mt-1 text-emerald-600">{{ stats.done }}</div></div>
    <div class="card p-4"><div class="text-xs text-ink-3">含外部依赖（气泡服务）</div><div class="text-2xl font-semibold tabular mt-1 text-amber-600">{{ stats.ext }}</div></div>
  </div>

  <div class="flex gap-3 overflow-x-auto pb-3">
    <div v-for="col in RD_COLS" :key="col.n" class="w-[264px] shrink-0 rounded-2xl bg-black/[0.035] p-2.5 transition-all duration-200" :class="dropCls(col.n)" @dragover.prevent="over = col.n" @drop.prevent="onDrop(col.n)">
      <div class="flex items-center justify-between px-1.5 pt-1 pb-2.5">
        <div class="min-w-0"><div class="flex items-center gap-1.5"><span class="w-5 h-5 rounded-full bg-white text-[11px] font-semibold flex items-center justify-center shadow-soft">{{ col.n }}</span><span class="font-semibold text-[12.5px] truncate">{{ col.name }}</span></div><div class="text-[10.5px] text-ink-4 mt-0.5 pl-[26px]">{{ col.owner }}</div></div>
        <span class="chip-gray">{{ cardsOf(col.n).length }}</span>
      </div>
      <transition-group name="list" tag="div" class="space-y-2 min-h-[72px] relative">
        <div v-for="k in cardsOf(col.n)" :key="k.id" class="card p-3 cursor-grab active:cursor-grabbing transition-all duration-300 ease-apple hover:shadow-lift hover:-translate-y-0.5" :class="dragId === k.id ? 'dragging' : ''" draggable="true" @dragstart="onDragStart(k, $event)" @dragend="onDragEnd" @click="open(k)">
          <div class="flex items-center justify-between gap-2"><span class="text-[10.5px] font-mono font-semibold text-brand-700">{{ k.id }}</span><span class="text-[10px] font-mono text-ink-4">{{ k.fr }}</span></div>
          <div class="text-[12.5px] font-medium leading-snug mt-1.5">{{ k.title }}</div>
          <div class="flex flex-wrap gap-1 mt-2"><span v-if="k.ext" class="chip-amber !text-[10px]">含外部依赖</span><span v-if="k.policy" class="chip-violet !text-[10px]">企业策略待定</span><span v-if="k.stage === 4 && k.beDone" class="chip-green !text-[10px]">已完成 · 待前端接手</span><span v-if="k.stage === 4 && !k.beDone" class="chip-blue !text-[10px]">自测中</span><span v-if="k.done" class="chip-green !text-[10px]">QA 准出</span></div>
          <div class="flex items-center gap-2 mt-2.5"><div class="flex-1 h-1.5 rounded-full bg-black/[0.07] overflow-hidden"><div class="h-full rounded-full bg-brand-500 transition-all duration-700 ease-apple" :style="{ width: (progress(k)[1] ? progress(k)[0] / progress(k)[1] * 100 : 0) + '%' }"></div></div><span class="text-[10.5px] tabular text-ink-4 whitespace-nowrap">{{ progress(k)[2] }} {{ progress(k)[0] }}/{{ progress(k)[1] }}</span></div>
          <div class="flex items-center justify-between mt-2 text-[10.5px] text-ink-4"><span>{{ k.stage >= 5 ? k.feOwner : k.beOwner }}</span><span class="font-mono">{{ k.stage >= 5 ? (k.feSchedule || '待排期') : (k.beSchedule || '待排期') }}</span></div>
          <div v-if="pipe.id === k.id" class="mt-2 rounded-lg bg-brand-50 px-2 py-1.5 text-[10.5px] text-brand-800 flex items-center gap-1.5"><ic name="refresh" :size="11" class="animate-spin"/>{{ RD_PIPE[pipe.step] }}…</div>
        </div>
      </transition-group>
    </div>
  </div>

  <drawer :open="!!c" @close="cur = null" :title="c ? c.id + ' · ' + c.title : ''" :sub="c ? colName(c.stage) + ' · 负责人 ' + c.beOwner + ' / ' + c.feOwner : ''" width="max-w-2xl">
    <template v-if="c">
      <div class="grid grid-cols-3 gap-3">
        <kv k="对应需求" :v="c.fr" mono/><kv k="PRD 章节" :v="c.prd"/><kv k="设计稿" :v="c.design"/>
      </div>
      <div class="flex flex-wrap gap-1.5 mt-3"><span v-if="c.ext" class="chip-amber">含外部依赖：需气泡服务侧配合（证书、frame-ancestors、统一登录、postMessage）</span><span v-if="c.policy" class="chip-violet">企业策略待定：按“未配置策略不签审、不默认批准”实现</span></div>

      <div class="mt-5 rounded-2xl ring-1 ring-black/[0.07] p-4">
        <div class="flex items-center justify-between gap-3 mb-3"><div class="font-semibold">{{ colName(c.stage) }}</div><span class="chip-gray">{{ RD_COLS[c.stage - 1].code }}</span></div>

        <template v-if="c.stage === 1">
          <label class="label">后端排期（起止日期）</label><input v-model="c.beSchedule" class="input w-56" :disabled="!mine(['be'])" placeholder="如 12/31 – 01/15">
          <div class="label mt-4">冲突检查清单（G2：全部确认无冲突，或冲突已由组长裁决）</div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5"><label v-for="x in c.conflict" :key="x.k" class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] ring-1 ring-inset ring-black/[0.06]" :class="mine(['be']) ? 'cursor-pointer hover:bg-black/[0.02]' : 'opacity-70'"><input type="checkbox" v-model="x.ok" :disabled="!mine(['be'])" class="w-4 h-4 accent-brand-600"><span class="font-mono text-[10.5px] text-ink-4 w-6">{{ x.k }}</span>{{ x.t }}</label></div>
        </template>

        <template v-if="c.stage === 2">
          <div class="label">任务清单（读完设计稿与需求文档后拆解；须覆盖表与迁移、接口、规则、权限、审计、集成、测试）</div>
          <div class="space-y-1.5"><div v-for="(x,i) in c.taskList" :key="i" class="flex items-center gap-2 rounded-lg bg-[#f7f7f9] px-3 py-2 text-[12.5px]"><span class="tabular text-ink-4 w-4">{{ i + 1 }}</span><span class="flex-1">{{ x }}</span><button v-if="mine(['be']) && !c.listSubmitted" class="btn-icon h-6 w-6" @click="c.taskList.splice(i, 1)"><ic name="x" :size="12"/></button></div></div>
          <div v-if="mine(['be']) && !c.listSubmitted" class="flex gap-2 mt-2"><input v-model="newTask" class="input !h-8" placeholder="添加子任务，回车确认" @keydown.enter="addTask"><button class="btn-secondary btn-sm" @click="addTask">添加</button></div>
          <div class="mt-3 rounded-xl px-3.5 py-2.5 text-[12.5px]" :class="c.listSubmitted ? 'bg-amber-50 text-amber-900' : 'bg-[#f7f7f9] text-ink-3'">{{ c.listSubmitted ? '任务清单已提交，等待产品或项目组长确认（G3）。未经确认不得开始开发。' : '任务清单尚未提交。' }}</div>
        </template>

        <template v-if="c.stage === 3">
          <div class="grid grid-cols-3 gap-2 text-center text-[12px]">
            <div class="rounded-xl py-3" :class="c.merged ? 'bg-emerald-50 text-emerald-700' : 'bg-[#f7f7f9] text-ink-4'"><ic :name="c.merged ? 'check' : 'dot'" :size="14" class="mx-auto"/><div class="mt-1">已合并到测试分支</div></div>
            <div class="rounded-xl py-3" :class="c.ci ? 'bg-emerald-50 text-emerald-700' : 'bg-[#f7f7f9] text-ink-4'"><ic :name="c.ci ? 'check' : 'dot'" :size="14" class="mx-auto"/><div class="mt-1">CI 全部通过</div></div>
            <div class="rounded-xl py-3" :class="c.deployed ? 'bg-emerald-50 text-emerald-700' : 'bg-[#f7f7f9] text-ink-4'"><ic :name="c.deployed ? 'check' : 'dot'" :size="14" class="mx-auto"/><div class="mt-1">测试环境部署成功</div></div>
          </div>
          <div v-if="pipe.id === c.id" class="mt-3 flex items-center gap-1.5">
            <template v-for="(p,i) in RD_PIPE" :key="p"><span class="h-7 px-2.5 rounded-full text-[11px] font-medium inline-flex items-center gap-1 transition-all duration-300" :class="i < pipe.step ? 'bg-emerald-50 text-emerald-700' : i === pipe.step ? 'bg-brand-600 text-white' : 'bg-black/[0.05] text-ink-4'"><ic v-if="i < pipe.step" name="check" :size="11" stroke="2.6"/>{{ p }}</span></template>
          </div>
          <div class="mt-3 flex items-center gap-2"><g-btn cls="btn-secondary btn-sm" icon="play" :when="mine(['be']) && !pipe.id && !c.deployed" :why="!mine(['be']) ? why(['be']) : c.deployed ? '已部署成功' : '流水线运行中'" @click="runPipe(c)">合并提交并触发 CI/CD（模拟）</g-btn><span v-if="c.pipeline" class="text-[11.5px] text-ink-4 font-mono">{{ c.pipeline }}</span></div>
          <p class="text-[11.5px] text-ink-4 mt-2">未合并到测试环境的代码一律视为未完成，不得进入 ④。</p>
        </template>

        <template v-if="c.stage === 4">
          <div class="flex items-center justify-between gap-3"><div class="label !mb-0">字段自测清单（G5：15 项全部勾选才能标注“已完成”）</div><span :class="c.beDone ? 'chip-green' : 'chip-blue'">{{ c.beDone ? '已完成' : '自测中' }}</span></div>
          <div class="grid grid-cols-1 gap-1 mt-2 max-h-[260px] overflow-y-auto pr-1"><label v-for="x in c.fields" :key="x.k" class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] ring-1 ring-inset ring-black/[0.06]" :class="mine(['be']) && !c.beDone ? 'cursor-pointer hover:bg-black/[0.02]' : 'opacity-70'"><input type="checkbox" v-model="x.ok" :disabled="!mine(['be']) || c.beDone" class="w-4 h-4 accent-brand-600"><span class="font-mono text-[10.5px] text-ink-4 w-7">{{ x.k }}</span>{{ x.t }}</label></div>
          <div class="grid grid-cols-2 gap-3 mt-3"><div><label class="label">接口文档链接（OpenAPI）</label><input v-model="c.apiDoc" class="input !h-8 font-mono" :disabled="!mine(['be']) || c.beDone" placeholder="openapi/req-04.json"></div><div><label class="label">自测记录</label><input v-model="c.selfTestNote" class="input !h-8" :disabled="!mine(['be']) || c.beDone" placeholder="主路径与异常路径"></div></div>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <g-btn v-if="!c.beDone" cls="btn-success btn-sm" icon="check" :when="mine(['be'])" :why="why(['be'])" @click="markDone(c)">标注已完成</g-btn>
            <button v-if="!c.beDone && mine(['be'])" class="btn-ghost btn-sm" @click="c.fields.forEach(x => { x.ok = true })">全部勾选（演示）</button>
          </div>
        </template>

        <template v-if="c.stage === 5">
          <div class="rounded-xl bg-emerald-50 text-emerald-800 px-3.5 py-2.5 text-[12.5px] flex items-center gap-2"><ic name="check" :size="14"/>后端已标注“已完成”，接口文档：<span class="font-mono">{{ c.apiDoc }}</span></div>
          <label class="label mt-4">前端排期（起止日期）</label><input v-model="c.feSchedule" class="input w-56" :disabled="!mine(['fe'])" placeholder="如 12/23 – 12/30">
          <div class="label mt-4">提交测试环境前（G7）</div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5"><label v-for="x in RD_FE" :key="x[0]" class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] ring-1 ring-inset ring-black/[0.06]" :class="mine(['fe']) ? 'cursor-pointer hover:bg-black/[0.02]' : 'opacity-70'"><input type="checkbox" v-model="c[x[0]]" :disabled="!mine(['fe'])" class="w-4 h-4 accent-brand-600">{{ x[1] }}</label></div>
        </template>

        <template v-if="c.stage === 6">
          <div class="label">约定联调时间（G8：前端发起，后端确认）</div>
          <div class="flex flex-wrap items-center gap-2"><input v-model="c.jointAt" class="input w-56" :disabled="!mine(['fe'])" placeholder="如 12/31 下午"><label class="inline-flex items-center gap-2 text-[12.5px]" :class="mine(['be']) ? 'cursor-pointer' : 'opacity-70'"><input type="checkbox" v-model="c.jointBeOk" :disabled="!mine(['be'])" class="w-4 h-4 accent-brand-600">后端已确认时间</label></div>
        </template>

        <template v-if="c.stage === 7">
          <div class="label">联调清单（G9：全部通过、双方确认后才能提交专业测试）</div>
          <div class="grid grid-cols-1 gap-1"><label v-for="x in c.joint" :key="x.k" class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] ring-1 ring-inset ring-black/[0.06]" :class="mine(['fe', 'be']) ? 'cursor-pointer hover:bg-black/[0.02]' : 'opacity-70'"><input type="checkbox" v-model="x.ok" :disabled="!mine(['fe', 'be'])" class="w-4 h-4 accent-brand-600"><span class="font-mono text-[10.5px] text-ink-4 w-6">{{ x.k }}</span>{{ x.t }}</label></div>
          <label class="label mt-3">提测单（范围、版本、已知问题）</label><input v-model="c.submitNote" class="input" :disabled="!mine(['fe', 'be'])" placeholder="如 测试环境 v0.3.1，覆盖 FR-INS-001 ~ 034，无已知阻塞问题">
          <div class="flex flex-wrap gap-2 mt-3"><g-btn cls="btn-ghost btn-sm" :when="mine(['be'])" :why="why(['be'])" @click="tryMove(c, 3)">后端问题 → 回到 ③</g-btn><g-btn cls="btn-ghost btn-sm" :when="mine(['fe'])" :why="why(['fe'])" @click="tryMove(c, 5)">前端问题 → 回到 ⑤</g-btn></div>
        </template>

        <template v-if="c.stage === 8">
          <div v-if="c.done" class="rounded-xl bg-emerald-50 text-emerald-800 px-3.5 py-2.5 text-[12.5px] flex items-center gap-2"><ic name="check" :size="14"/>QA 已准出：{{ c.qaNote }}</div>
          <template v-else>
            <label class="label">测试结论（G10：达到准出标准）</label><input v-model="c.qaNote" class="input" :disabled="!mine(['qa'])" placeholder="如 用例 86 条全部通过，无 P0 / P1 缺陷">
            <div class="flex flex-wrap gap-2 mt-3"><g-btn cls="btn-success btn-sm" icon="check" :when="mine(['qa'])" :why="why(['qa'])" @click="qaPass(c)">测试通过 · 准出</g-btn><g-btn cls="btn-ghost btn-sm" :when="mine(['qa'])" :why="why(['qa'])" @click="tryMove(c, 7)">退回联调</g-btn></div>
          </template>
        </template>

        <div v-if="c.stage < 8" class="mt-4 pt-4 border-t border-black/[0.06]">
          <div v-if="gateOf(c).unmet.length" class="rounded-xl bg-amber-50 text-amber-900 px-3.5 py-2.5 text-[12px] mb-3"><div class="font-medium">进入 {{ colName(c.stage + 1) }} 前（门禁 {{ gateOf(c).gate }}）还需要：</div><div v-for="u in gateOf(c).unmet" :key="u">· {{ u }}</div></div>
          <div class="flex flex-wrap items-center gap-2">
            <g-btn v-if="c.stage === 2 && !c.listSubmitted" cls="btn-secondary btn-sm" :when="mine(['be'])" :why="why(['be'])" @click="submitList">提交任务清单</g-btn>
            <g-btn v-if="c.stage === 2" cls="btn-ghost btn-sm" :when="mine(['pm'])" :why="why(['pm'])" @click="tryMove(c, 1)">驳回，重排</g-btn>
            <g-btn cls="btn-primary btn-sm" icon="arrow-right" :when="mine(gateOf(c).roles) && gateOf(c).ok" :why="!mine(gateOf(c).roles) ? why(gateOf(c).roles) : '门禁 ' + gateOf(c).gate + ' 未通过'" @click="tryMove(c, c.stage + 1)">{{ c.stage === 2 ? '确认任务清单，允许开发' : c.stage === 4 ? '前端接手并排期' : c.stage === 7 ? '联调通过，提交专业测试' : '进入 ' + colName(c.stage + 1) }}</g-btn>
            <g-btn v-if="c.beDone && c.stage >= 4 && c.stage <= 7" cls="btn-ghost btn-sm" :when="mine(['be'])" :why="why(['be'])" @click="chg.open = true">接口有变更（G11）</g-btn>
          </div>
        </div>
      </div>

      <div class="mt-5"><div class="label">流转记录</div>
        <ol class="relative border-l border-black/[0.08] ml-2 space-y-3"><li v-for="(x,i) in c.history.slice().reverse()" :key="i" class="pl-4 relative"><span class="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-white ring-2" :class="i === 0 ? 'ring-brand-500' : 'ring-black/20'"></span><div class="text-[12.5px] text-ink-2 leading-relaxed"><span class="font-medium text-ink">{{ RD_ROLES[x.role] }}</span> {{ x.text }}</div><div class="text-[11px] text-ink-4">{{ fmtTime(x.at) }}</div></li></ol>
      </div>
    </template>
  </drawer>

  <modal :open="back.open" @close="back.open = false" title="退回" :sub="back.label" width="max-w-md">
    <textarea v-model="back.reason" rows="3" class="textarea" placeholder="退回原因（会记录在流转记录中）"></textarea>
    <template #footer><button class="btn-secondary" @click="back.open = false">取消</button><button class="btn-primary" :disabled="!back.reason.trim()" @click="saveBack">确认退回</button></template>
  </modal>
  <modal :open="chg.open" @close="chg.open = false" title="接口有变更" sub="标注“已完成”后改接口，必须回到 ④ 自测中：更新接口文档版本与变更说明、通知前端、重新自测" width="max-w-md">
    <textarea v-model="chg.note" rows="3" class="textarea" placeholder="变更说明，例如：/tasks 响应新增字段 lotUnit；错误码 PLAN_RETIRED 改为 409"></textarea>
    <template #footer><button class="btn-secondary" @click="chg.open = false">取消</button><button class="btn-primary" :disabled="!chg.note.trim()" @click="apiChanged">确认，回到自测中</button></template>
  </modal>
</div>`,
};

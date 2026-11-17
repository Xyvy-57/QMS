/* Shared inspection workbench: five scenarios, immutable completed rounds and report snapshots. */
(function () {
  'use strict';
  const scenarios = { IQC: '来料检验', FIRST: '生产首件', IPQC: '过程检验', FQC: '完工检验', OQC: '出货检验' };
  const resultLabels = { pending: '待录入', pass: '符合', ng: '不符合', invalid: '格式错误', conforming: '符合', nonconforming: '不符合', insufficient: '证据不足' };
  const tones = { pending: 'neutral', pass: 'green', ng: 'red', invalid: 'amber', conforming: 'green', nonconforming: 'red', insufficient: 'amber' };
  let current = {}, search = '', saveTimer = null;
  const photoJobs = new Set();
  const E = value => UI.e(value == null ? '' : String(value));
  const B = (label, action, kind = 'secondary', attrs = '') => `<button type="button" class="button ${kind}" data-inspection-action="${action}" ${attrs}>${label}</button>`;
  const badge = (text, tone) => UI.badge(text, tone);
  const date = value => value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '未记录';
  const taskItems = task => {
    const items = task.standardSnapshot?.items || [];
    const selected = (task.planSnapshot?.nodes || []).flatMap(n => n.itemIds || []);
    return selected.length ? items.filter(item => selected.includes(item.id)) : items;
  };
  const roundOf = task => QMS.getRound(task);
  const requiredSamples = (round, itemId) => round.itemSampleCounts?.[itemId] || round.sampleCount || 3;
  const statusOf = stats => stats?.status || 'insufficient';
  const taskName = task => task.standardSnapshot?.name || task.standardId || '检验任务';
  const technical = (task, round) => QMS.technical(task, round);
  const range = item => item.kind === 'attribute' ? '属性符合性' : `${item.lower === '' || item.lower == null ? '—' : item.lower} ～ ${item.upper === '' || item.upper == null ? '—' : item.upper} ${item.unit || ''}`;
  function save() { try { const ok = QMS.save(); if (ok === false) { UI.toast('浏览器未能保存，请导出数据备份后释放存储空间。'); return false; } return true; } catch (err) { UI.toast(`保存失败：${err.message || '浏览器存储空间不足，请先导出备份'}`); return false; } }
  function empty(title, text, action = '') { return `<div class="empty-state"><div class="inspection-empty-icon">${UI.icon('checkSquare', 28)}</div><h3>${E(title)}</h3><p>${E(text)}</p>${action}</div>`; }
  function meta(task, round) {
    return `<div class="inspection-context"><span><small>批次</small><strong>${E(task.batch)}</strong></span><span><small>采用标准</small><strong>${E(task.standardSnapshot?.name || task.standardId)} / ${E(task.standardSnapshot?.revision || '—')}</strong></span><span><small>采用方案</small><strong>${E(task.planSnapshot?.name || task.planId)} / ${E(task.planSnapshot?.revision || '—')}</strong></span><span><small>本轮对象</small><strong>${E(round.sampleCount)} 件</strong></span></div>`;
  }
  function list(params) {
    const scenario = params.scenario || 'ALL';
    const tasks = (QMS.db.tasks || []).filter(t => (scenario === 'ALL' || t.scenario === scenario) && (!search || `${t.id} ${t.batch} ${taskName(t)} ${t.inspector || ''}`.toLowerCase().includes(search.toLowerCase())));
    return `<div class="page-head"><div class="title-group"><div class="muted">检验管理</div><h1>${E(scenarios[scenario] || '检验任务')}</h1><p class="muted">从受控方案开检，按轮次保存样本与真实测量。</p></div><div class="actions">${B(`${UI.icon('plus')} 新建检验任务`, 'new-task', 'primary')}</div></div>
      <div class="tabs inspection-scenario-tabs">${[['ALL', '全部任务'], ...Object.entries(scenarios)].map(([key, value]) => `<button class="tab ${scenario === key ? 'active' : ''}" data-inspection-action="scenario" data-scenario="${key}">${E(value)}<span>${(QMS.db.tasks || []).filter(t => key === 'ALL' || t.scenario === key).length}</span></button>`).join('')}</div>
      <section class="panel"><div class="toolbar"><div class="inspection-search">${UI.icon('search')}<input class="input" id="inspection-search" aria-label="搜索检验任务" placeholder="搜索批次、零件、检验员" value="${E(search)}"></div><span class="muted">${tasks.length} 项任务</span></div>
      ${tasks.length ? `<div class="table-wrap"><table class="data-table inspection-task-table"><thead><tr><th>任务 / 零件</th><th>检验场景</th><th>批次</th><th>执行进度</th><th>技术结论</th><th>检验员</th><th>操作</th></tr></thead><tbody>${tasks.map(t => {
        const r = roundOf(t), s = technical(t, r);
        return `<tr><td><button class="inspection-text-link" data-inspection-action="open-task" data-id="${E(t.id)}">${E(taskName(t))}</button><small class="inspection-subline">${E(t.id)}</small></td><td>${E(scenarios[t.scenario] || t.scenario)}</td><td>${E(t.batch)}<small class="inspection-subline">批量 ${E(t.quantity)} 件</small></td><td><div class="inspection-progress"><span>${r.status === 'completed' ? '本轮已完成' : `${s.filled || 0} / ${s.total || 0} 项读数`}</span><progress value="${s.filled || 0}" max="${s.total || 1}"></progress></div></td><td>${badge(resultLabels[statusOf(s)] || statusOf(s), tones[statusOf(s)] || 'neutral')}</td><td>${E(t.inspector || '未指定')}</td><td>${B(r.status === 'completed' ? '查看记录' : '继续检验', 'open-task', 'ghost', `data-id="${E(t.id)}"`)}</td></tr>`;
      }).join('')}</tbody></table></div>` : empty(search ? '没有匹配的任务' : '从一份受控方案开始', search ? '尝试其他批次、零件名称或检验员。' : '新任务会冻结当前标准和方案；后续改版不改写历史。', search ? '' : B('新建检验任务', 'new-task', 'primary'))}</section>`;
  }
  function statsMarkup(task, round) {
    const s = technical(task, round);
    return `<div class="inspection-stats"><div><small>录入进度</small><strong>${s.filled || 0}<span> / ${s.total || 0}</span></strong><progress value="${s.filled || 0}" max="${s.total || 1}"></progress></div><div><small>符合读数</small><strong class="inspection-good">${s.pass || 0}</strong></div><div><small>不符合读数</small><strong class="inspection-bad">${s.ng || 0}</strong></div><div><small>技术结论</small>${badge(resultLabels[statusOf(s)] || statusOf(s), tones[statusOf(s)] || 'neutral')}<small>仅证明本轮被检范围</small></div><div><small>批接受依据</small><strong class="inspection-small-value">未作批判定</strong><small>逐项实测模式</small></div></div>`;
  }
  function rowMarkup(task, round, item, index) {
    const values = round.measurements?.[item.id] || [];
    const needed = requiredSamples(round, item.id);
    const results = Array.from({ length: needed }, (_, i) => QMS.evaluate(item, values[i] || ''));
    const status = results.includes('invalid') ? 'invalid' : results.includes('ng') ? 'ng' : results.includes('pending') ? 'pending' : 'pass';
    const locked = round.status === 'completed';
    return `<tr data-item-row="${E(item.id)}"><td><span class="inspection-balloon">${E(item.balloon || index + 1)}</span></td><td><strong>${E(item.name)}</strong><small class="inspection-subline">${E(item.method || '按方案执行')}</small></td><td><span class="inspection-spec">${E(range(item))}</span><small class="inspection-subline">${item.nominal == null || item.nominal === '' ? '' : `公称 ${E(item.nominal)} ${E(item.unit || '')}`}</small></td>${Array.from({ length: round.sampleCount }, (_, i) => i >= needed ? '<td><span class="inspection-not-required" title="本项方案未要求此样本">—</span></td>' : `<td><div class="inspection-reading ${results[i]}" data-reading-wrap="${E(item.id)}:${i}">${item.kind === 'attribute' ? `<select aria-label="${E(item.name)} 样本 ${i + 1}" data-item-id="${E(item.id)}" data-sample="${i}" ${locked ? 'disabled' : ''}><option value="">请选择</option><option value="pass" ${values[i] === 'pass' ? 'selected' : ''}>符合</option><option value="ng" ${values[i] === 'ng' ? 'selected' : ''}>不符合</option></select>` : `<input inputmode="decimal" autocomplete="off" aria-label="${E(item.name)} 样本 ${i + 1}" data-item-id="${E(item.id)}" data-sample="${i}" value="${E(values[i] || '')}" placeholder="—" ${locked ? 'readonly' : ''}>`}<small data-reading-result>${E(resultLabels[results[i]] || results[i])}</small></div></td>`).join('')}<td data-item-result>${badge(resultLabels[status], tones[status])}</td></tr>`;
  }
  function photosMarkup(round) {
    const photos = round.photos || [];
    return `<div class="inspection-photo-grid">${photos.map(p => `<figure><button class="inspection-photo-preview" data-inspection-action="preview-photo" data-id="${E(p.id)}" aria-label="查看照片 ${E(p.name)}"><img src="${E(p.dataUrl)}" alt="${E(p.name || '检验现场照片')}" loading="lazy"></button><figcaption><span>${E(p.name || '现场照片')}</span>${round.status !== 'completed' ? B(UI.icon('close', 14), 'delete-photo', 'ghost', `data-id="${E(p.id)}" aria-label="移除照片 ${E(p.name)}"`) : ''}</figcaption></figure>`).join('')}${round.status !== 'completed' ? `<label class="inspection-photo-add" tabindex="0" role="button" aria-label="上传或拍摄现场照片">${UI.icon('camera', 24)}<strong>拍照 / 上传</strong><small>最多 8 张，自动压缩保存</small><input id="inspection-photos" type="file" accept="image/*" capture="environment" multiple></label>` : ''}</div>${!photos.length && round.status === 'completed' ? '<p class="muted">本轮未附现场照片。</p>' : ''}`;
  }
  function signaturesMarkup(task, round) {
    const signatures = round.signatures || {};
    return `<div class="inspection-sign-grid">${[['inspector', '检验员', true], ['reviewer', '审核员', !!task.reviewRequired]].map(([key, label, required]) => {
      const s = signatures[key];
      return `<div class="inspection-sign-box"><div class="inspection-sign-head"><strong>${label}</strong>${badge(s ? '已签名' : required ? '需签名' : '未要求签名', s ? 'green' : required ? 'blue' : 'neutral')}</div>${s ? `<img class="inspection-sign-image" src="${E(s.dataUrl)}" alt="${label} ${E(s.name)} 手写签名"><div class="inspection-sign-meta"><span>${E(s.name)}</span><span>${date(s.signedAt)}</span></div>` : `<div class="inspection-sign-placeholder">${UI.icon('pen', 23)}<span>${required ? '完成测量后手写签名' : '本任务未要求审核签名，可选填'}</span></div>`}${round.status !== 'completed' ? B(s ? '重新签名' : '手写签名', 'sign', 'secondary', `data-signature="${key}"`) : ''}</div>`;
    }).join('')}</div><p class="inspection-sign-notice">本地手写签名记录确认意愿，不等同于企业身份认证。修改实测值或照片后，已有签名需重新确认。</p>`;
  }
  function detail(params) {
    const task = QMS.getTask(params.taskId);
    if (!task) return empty('任务不存在', '请返回检验台账重新选择。', B('返回检验任务', 'back-list'));
    const round = params.roundId ? task.rounds.find(r => r.id === params.roundId) : roundOf(task);
    if (!round) return empty('轮次不存在', '请选择此任务中已有的轮次。', B('返回当前轮次', 'current-round'));
    const locked = round.status === 'completed', items = taskItems(task);
    return `<div class="page-head"><div class="title-group"><button class="inspection-back" data-inspection-action="back-list">${UI.icon('arrowLeft', 15)} ${E(scenarios[task.scenario] || '检验任务')}</button><h1>${E(taskName(task))}</h1><p class="muted">${E(task.id)} ${badge(locked ? '本轮已完成' : '检验中', locked ? 'green' : 'blue')}</p></div><div class="actions">${B('新建复检轮次', 'new-round')}${locked ? B(`${UI.icon('report')} 查看本轮报告`, 'round-report', 'primary') : B(`${UI.icon('check')} 完成本轮并生成报告`, 'complete', 'primary')}</div></div>
      ${meta(task, round)}<div class="inspection-rounds"><span class="muted">检验轮次</span>${task.rounds.map((r, i) => `<button class="inspection-round ${r.id === round.id ? 'active' : ''}" data-inspection-action="round" data-id="${E(r.id)}">${i === 0 ? '原检' : `复检 ${i}`}<span>${r.status === 'completed' ? '已完成' : '进行中'}</span></button>`).join('')}<span class="inspection-round-reason">${E(round.reason || '首次检验')}</span></div>
      <section class="panel" id="inspection-stats">${statsMarkup(task, round)}</section>
      <section class="panel inspection-measure-panel"><div class="panel-head"><div><h2>逐项实测</h2><p class="muted">${locked ? '本轮已固定；需要补检或返工复检时新建轮次。' : '直接录入原始读数。超差如实保存，空值不视为符合。'}</p></div><span class="tag">${items.length} 项特性</span></div><div class="table-wrap"><table class="data-table inspection-measure-table"><thead><tr><th>气泡</th><th>检验特性 / 方法</th><th>技术要求</th>${Array.from({ length: round.sampleCount }, (_, i) => `<th>样本 S${i + 1}</th>`).join('')}<th>项目结论</th></tr></thead><tbody>${items.map((item, i) => rowMarkup(task, round, item, i)).join('')}</tbody></table></div><div class="inspection-table-foot"><span id="inspection-save-status">${locked ? `完成于 ${date(round.completedAt || round.updatedAt || round.createdAt)}` : '输入保存在当前浏览器'}</span><span>单位、公差及项目来自冻结标准</span></div></section>
      <div class="inspection-evidence-layout"><section class="panel"><div class="panel-head"><div><h2>现场照片</h2><p class="muted">保留样件状态、测量位置与异常证据。</p></div>${UI.icon('camera', 20)}</div><div class="inspection-evidence-body" id="inspection-photo-region">${photosMarkup(round)}</div></section><section class="panel"><div class="panel-head"><div><h2>记录确认</h2><p class="muted">检验员签名；审核仅在本任务要求时必需。</p></div>${UI.icon('pen', 20)}</div><div class="inspection-evidence-body" id="inspection-sign-region">${signaturesMarkup(task, round)}</div></section></div>
      <div class="inspection-bottom-actions"><p class="muted">${locked ? '原始记录与失败结论持续保留，复检不覆盖本轮。' : '完成将固定当前轮次、照片与签名，并形成独立报告快照。'}</p><div class="actions">${B('登记不合格问题', 'create-ncr', 'secondary')}${!locked ? B('完成本轮并生成报告', 'complete', 'primary') : B('查看本轮报告', 'round-report', 'primary')}</div></div>`;
  }
  function selected() {
    const task = QMS.getTask(current.taskId);
    if (!task) return {};
    const round = current.roundId ? task.rounds.find(r => r.id === current.roundId) : roundOf(task);
    return { task, round };
  }
  function invalidate(round) {
    if (Object.keys(round.signatures || {}).length) {
      round.signatures = {};
      const { task, round: shownRound } = selected();
      const region = shownRound?.id === round.id ? document.getElementById('inspection-sign-region') : null;
      if (region && task) region.innerHTML = signaturesMarkup(task, round);
      UI.toast('检验内容已变更，请重新手写签名确认。');
    }
  }
  function updateStats(task, round, itemId) {
    const el = document.getElementById('inspection-stats');
    if (el) el.innerHTML = statsMarkup(task, round);
    const row = Array.from(document.querySelectorAll('[data-item-row]')).find(r => r.dataset.itemRow === itemId);
    const item = taskItems(task).find(i => i.id === itemId);
    if (row && item) {
      const results = Array.from({ length: requiredSamples(round, itemId) }, (_, i) => QMS.evaluate(item, round.measurements[itemId]?.[i] || ''));
      row.querySelectorAll('.inspection-reading').forEach((wrap, i) => { wrap.className = `inspection-reading ${results[i]}`; wrap.querySelector('[data-reading-result]').textContent = resultLabels[results[i]]; });
      const status = results.includes('invalid') ? 'invalid' : results.includes('ng') ? 'ng' : results.includes('pending') ? 'pending' : 'pass';
      row.querySelector('[data-item-result]').innerHTML = badge(resultLabels[status], tones[status]);
    }
  }
  function newTask(defaultScenario) {
    const plans = QMS.db.plans || [];
    UI.drawer('新建检验任务', `<form id="new-inspection-form" class="stack"><p class="muted">先选场景与受控方案，任务将固定采用版本。</p><div class="form-grid"><label class="field">检验场景<select name="scenario" id="new-inspection-scenario">${Object.entries(scenarios).map(([k, v]) => `<option value="${k}" ${k === defaultScenario ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label class="field">检验员<input type="text" name="inspector" required maxlength="40" placeholder="输入实际检验员姓名"></label></div><label class="field">检验方案<select name="planId" id="new-inspection-plan" required></select></label><div id="new-inspection-plan-info" class="inspection-plan-preview"></div><div class="form-grid"><label class="field">批次号<input type="text" name="batch" required maxlength="80" placeholder="例如 LOT-20261116-01"></label><label class="field">批量（件）<input name="quantity" type="number" min="1" max="10000000" step="1" value="100" required></label></div><label class="inspection-check"><input type="checkbox" name="reviewRequired">本任务需要审核员签名</label><p class="muted">未选审核时，检验员完成记录即可汇总，不增加人工放行流程。</p><div class="actions">${B('取消', 'close')}<button class="button primary" type="submit">创建并开始检验</button></div></form>`);
    const form = document.getElementById('new-inspection-form');
    const scenarioInput = form.elements.scenario, planSelect = form.elements.planId;
    const sync = () => {
      const applicable = plans.filter(p => p.scenario === scenarioInput.value && p.status === 'published');
      planSelect.innerHTML = applicable.length ? applicable.map(p => `<option value="${E(p.id)}">${E(p.name)} / ${E(p.revision || '—')}</option>`).join('') : '<option value="">当前场景暂无已发布方案</option>';
      form.querySelector('[type="submit"]').disabled = !applicable.length;
      preview();
    };
    const preview = () => {
      const plan = plans.find(p => p.id === planSelect.value), std = (QMS.db.standards || []).find(s => s.id === plan?.standardId);
      document.getElementById('new-inspection-plan-info').innerHTML = plan ? `<strong>${E(std?.name || plan.standardId)}</strong><p>标准 ${E(std?.revision || '—')} / ${(plan.nodes || []).length} 道工序 / ${new Set((plan.nodes || []).flatMap(n => n.itemIds || [])).size} 项特性</p><small>开检时不能临时修改技术要求。</small>` : '<p>请先在检验方案中编制并发布当前场景的适用方案。</p>';
    };
    scenarioInput.addEventListener('change', sync); planSelect.addEventListener('change', preview); sync();
    form.querySelector('[data-inspection-action="close"]').onclick = () => UI.close();
    form.addEventListener('submit', event => {
      event.preventDefault();
      const data = new FormData(form), plan = plans.find(p => p.id === data.get('planId'));
      if (!plan) return;
      try {
        const task = QMS.createTask({ standardId: plan.standardId, planId: plan.id, scenario: data.get('scenario'), batch: data.get('batch').trim(), quantity: Number(data.get('quantity')), inspector: data.get('inspector').trim(), reviewRequired: data.has('reviewRequired') });
        UI.close(); UI.toast('任务已创建，采用版本已固定。'); App.go('inspection', { scenario: task.scenario, taskId: task.id });
      } catch (error) { UI.toast(error.message); }
    });
  }
  function newRound(task) {
    UI.modal('新建复检轮次', `<form id="new-round-form" class="stack"><p class="muted">原检读数、失败与报告保持不变，新轮次单独记录。</p><label class="field">复检原因<textarea name="reason" required maxlength="400" rows="3" placeholder="说明返工、补检或重新取样的原因与范围"></textarea></label><div class="actions">${B('取消', 'close')}<button type="submit" class="button primary">创建新轮次</button></div></form>`);
    const form = document.getElementById('new-round-form');
    form.querySelector('[data-inspection-action="close"]').onclick = () => UI.close();
    form.onsubmit = event => { event.preventDefault(); try { const round = QMS.addRound(task.id, form.elements.reason.value.trim()); UI.close(); UI.toast('新轮次已建立，原检记录已保留。'); App.go('inspection', { scenario: task.scenario, taskId: task.id, roundId: round.id }); } catch (error) { UI.toast(error.message); } };
  }
  function sign(task, round, key) {
    if (round.status === 'completed') return;
    const label = key === 'reviewer' ? '审核员' : '检验员';
    UI.modal(`${label}手写签名`, `<form id="inspection-sign-form" class="stack"><label class="field">签署人姓名<input type="text" name="signer" required maxlength="40" autocomplete="name" value="${E(round.signatures?.[key]?.name || (key === 'inspector' ? task.inspector : ''))}" placeholder="请先填写姓名"></label><div class="inspection-sign-pad"><canvas id="inspection-sign-canvas" aria-label="请在此手写签名"></canvas><span>在此手写，支持触屏或鼠标</span></div><p class="inspection-sign-notice">签名与本轮记录一同保存，仅用于本地记录确认，不代表企业身份认证。</p><div class="actions">${B('清空笔迹', 'clear-sign')}${B('取消', 'close')}<button type="submit" class="button primary">确认签名</button></div></form>`);
    const form = document.getElementById('inspection-sign-form'), canvas = document.getElementById('inspection-sign-canvas'), ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--inspection-ink').trim() || '#182128';
    let drawing = false, hasInk = false;
    const point = e => { const box = canvas.getBoundingClientRect(); return [e.clientX - box.left, e.clientY - box.top]; };
    canvas.addEventListener('pointerdown', e => { if (!form.elements.signer.value.trim()) { form.elements.signer.reportValidity(); form.elements.signer.focus(); return; } drawing = true; canvas.setPointerCapture(e.pointerId); const [x, y] = point(e); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + .1, y + .1); ctx.stroke(); hasInk = true; canvas.parentElement.classList.add('has-ink'); e.preventDefault(); });
    canvas.addEventListener('pointermove', e => { if (!drawing) return; const [x, y] = point(e); ctx.lineTo(x, y); ctx.stroke(); e.preventDefault(); });
    canvas.addEventListener('pointerup', () => { drawing = false; }); canvas.addEventListener('pointercancel', () => { drawing = false; });
    form.querySelector('[data-inspection-action="clear-sign"]').onclick = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); hasInk = false; canvas.parentElement.classList.remove('has-ink'); };
    form.querySelector('[data-inspection-action="close"]').onclick = () => UI.close();
    form.onsubmit = event => { event.preventDefault(); if (!hasInk) return UI.toast('请在签名框内手写签名。'); const name = form.elements.signer.value.trim(); if (!name) return; if (key === 'reviewer' && task.reviewRequired && round.signatures?.inspector?.name === name) return UI.toast('本任务选择了独立审核，请由另一位审核员签署。'); round.signatures = round.signatures || {}; round.signatures[key] = { name, signedAt: QMS.now(), dataUrl: canvas.toDataURL('image/png') }; if (!save()) return; UI.close(); document.getElementById('inspection-sign-region').innerHTML = signaturesMarkup(task, round); UI.toast(`${label}签名已保存。`); };
  }
  async function compressPhoto(file) {
    if (!file.type.startsWith('image/')) throw new Error(`${file.name} 不是图片文件`);
    if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name} 超过 15MB，请选择较小图片`);
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error(`${file.name} 无法读取，请使用 JPG、PNG 或 WebP`)); i.src = url; });
      const ratio = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight)), canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * ratio); canvas.height = Math.round(img.naturalHeight * ratio);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--inspection-paper').trim() || '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      let dataUrl = canvas.toDataURL('image/jpeg', .76);
      if (dataUrl.length > 550000) dataUrl = canvas.toDataURL('image/jpeg', .52);
      return { id: QMS.uid('photo'), name: file.name, dataUrl, createdAt: QMS.now() };
    } finally { URL.revokeObjectURL(url); }
  }
  async function uploadPhotos(files, task, round) {
    if (round.status === 'completed') return;
    if (photoJobs.has(round.id)) return UI.toast('当前照片仍在处理中，请稍候。');
    const available = 8 - (round.photos || []).length;
    if (available <= 0) return UI.toast('每轮最多保存 8 张照片。');
    const selectedFiles = Array.from(files).slice(0, available), added = [];
    photoJobs.add(round.id);
    UI.toast('正在压缩并保存现场照片…');
    for (const file of selectedFiles) { try { added.push(await compressPhoto(file)); } catch (error) { UI.toast(error.message); } }
    photoJobs.delete(round.id);
    if (added.length && round.status !== 'completed') { invalidate(round); round.photos = [...(round.photos || []), ...added]; const ok = save(); const shown = selected(); const region = shown.task?.id === task.id && shown.round?.id === round.id ? document.getElementById('inspection-photo-region') : null; if (region) region.innerHTML = photosMarkup(round); if (ok) UI.toast(`已保存 ${added.length} 张现场照片。`); }
  }
  function complete(task, round) {
    if (round.status === 'completed') return openRoundReport(task, round);
    if (photoJobs.has(round.id)) return UI.toast('照片仍在处理中，完成后即可提交本轮。');
    const stats = technical(task, round);
    if (stats.pending || stats.invalid) { UI.toast(`尚有 ${stats.pending || 0} 项未填写、${stats.invalid || 0} 项格式错误，请补齐。`); const input = document.querySelector('.inspection-reading.pending input,.inspection-reading.pending select,.inspection-reading.invalid input'); input?.focus(); return; }
    if (!round.signatures?.inspector) return UI.toast('请先填写检验员姓名并手写签名。');
    if (task.reviewRequired && !round.signatures?.reviewer) return UI.toast('本任务要求审核员签名，请完成后再提交。');
    try { const result = QMS.completeRound(task.id, round.id); if (!result.ok) return UI.toast(result.error || '未能完成本轮，请检查记录。'); UI.toast('本轮已完成，独立报告快照已生成。'); if (result.report?.id) App.go('reports', { reportId: result.report.id }); else App.render(); } catch (error) { UI.toast(error.message); }
  }
  function openRoundReport(task, round) { const report = (QMS.db.reports || []).find(r => r.taskId === task.id && r.roundId === round.id); if (report) App.go('reports', { reportId: report.id }); else UI.toast('本轮尚未生成报告，请先完成本轮记录。'); }
  function bind(params) {
    current = params || {}; const page = document.getElementById('page'); if (!page) return;
    page._inspectionAbort?.abort(); const abort = new AbortController(); page._inspectionAbort = abort; const listen = (type, handler) => page.addEventListener(type, handler, { signal: abort.signal });
    listen('click', event => {
      const button = event.target.closest('[data-inspection-action]'); if (!button) return;
      const action = button.dataset.inspectionAction, { task, round } = selected();
      if (action === 'new-task') return newTask(current.scenario && current.scenario !== 'ALL' ? current.scenario : 'IQC');
      if (action === 'scenario') { search = ''; return App.go('inspection', { scenario: button.dataset.scenario }); }
      if (action === 'open-task') return App.go('inspection', { scenario: current.scenario, taskId: button.dataset.id });
      if (action === 'back-list') return App.go('inspection', { scenario: task?.scenario || current.scenario || 'ALL' });
      if (action === 'current-round') return App.go('inspection', { taskId: current.taskId });
      if (!task || !round) return;
      if (action === 'round') return App.go('inspection', { scenario: task.scenario, taskId: task.id, roundId: button.dataset.id });
      if (action === 'new-round') return newRound(task);
      if (action === 'sign') return sign(task, round, button.dataset.signature);
      if (action === 'complete') return complete(task, round);
      if (action === 'round-report') return openRoundReport(task, round);
      if (action === 'preview-photo') { const photo = (round.photos || []).find(p => p.id === button.dataset.id); if (photo) UI.modal(photo.name || '现场照片', `<img class="inspection-photo-full" src="${E(photo.dataUrl)}" alt="${E(photo.name)}">`); }
      if (action === 'delete-photo' && round.status !== 'completed') { invalidate(round); round.photos = round.photos.filter(p => p.id !== button.dataset.id); save(); document.getElementById('inspection-photo-region').innerHTML = photosMarkup(round); UI.toast('照片已从本轮移除。'); }
      if (action === 'create-ncr') { try { const ncr = QMS.createNcr(task.id, round.id); UI.toast('问题已登记；不会自动冻结整批。'); App.go('ncr', { ncrId: ncr.id }); } catch (error) { UI.toast(error.message); } }
    });
    listen('input', event => {
      if (event.target.id === 'inspection-search') { search = event.target.value; const start = event.target.selectionStart; App.render(); const replacement = document.getElementById('inspection-search'); replacement?.focus(); replacement?.setSelectionRange(start, start); return; }
      const input = event.target.closest('[data-item-id]'); if (!input) return;
      const { task, round } = selected(); if (!task || !round || round.status === 'completed') return;
      round.measurements = round.measurements || {}; round.measurements[input.dataset.itemId] = round.measurements[input.dataset.itemId] || [];
      const i = Number(input.dataset.sample), value = input.value;
      if (round.measurements[input.dataset.itemId][i] === value) return;
      invalidate(round); round.measurements[input.dataset.itemId][i] = value; updateStats(task, round, input.dataset.itemId);
      clearTimeout(saveTimer); saveTimer = setTimeout(() => { const ok = save(); const status = document.getElementById('inspection-save-status'); if (status) status.textContent = ok ? '本地已保存' : '未能持久化，请导出数据备份'; }, 220);
    });
    listen('change', event => { if (event.target.id === 'inspection-photos') { const { task, round } = selected(); if (task && round) uploadPhotos(event.target.files, task, round); } });
    listen('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.inspection-photo-add')) { event.preventDefault(); event.target.querySelector('input').click(); } });
    if (params.create === '1') { delete params.create; const query = new URLSearchParams(params).toString(); history.replaceState(null, '', '#inspection' + (query ? '?' + query : '')); newTask(params.scenario && params.scenario !== 'ALL' ? params.scenario : 'IQC'); }
  }
  function reportData(report) {
    const task = report.taskSnapshot || report.snapshot?.task || report.task || {};
    const round = report.roundSnapshot || report.snapshot?.round || report.round || {};
    return { task, round, stats: report.technical || report.technicalResult || report.snapshot?.technical || (task.standardSnapshot && round.measurements ? technical(task, round) : { status: 'insufficient' }) };
  }
  function reportBody(report) {
    const { task, round, stats } = reportData(report), items = taskItems(task);
    return `<article class="inspection-report" id="inspection-report-document"><header class="inspection-report-heading"><div><span class="inspection-report-brand">Worlder QMS</span><h2>${E(scenarios[task.scenario] || '质量检验')}记录报告</h2><p>${E(report.number || report.id)}</p></div><div>${badge('本地检验记录', 'neutral')}${badge(resultLabels[statusOf(stats)] || statusOf(stats), tones[statusOf(stats)] || 'neutral')}</div></header><div class="inspection-report-meta"><span><small>零件 / 标准</small><strong>${E(taskName(task))}</strong></span><span><small>批次 / 批量</small><strong>${E(task.batch)} / ${E(task.quantity)} 件</strong></span><span><small>检验员</small><strong>${E(task.inspector || round.signatures?.inspector?.name || '未记录')}</strong></span><span><small>生成时间</small><strong>${date(report.createdAt)}</strong></span><span><small>标准修订</small><strong>${E(task.standardSnapshot?.revision || '—')}</strong></span><span><small>方案修订</small><strong>${E(task.planSnapshot?.revision || '—')}</strong></span><span><small>任务 / 轮次</small><strong>${E(report.taskId)} / ${E(report.roundId)}</strong></span><span><small>检验范围</small><strong>${E(round.sampleCount || 0)} 件，${items.length} 项特性</strong></span></div><div class="inspection-report-callout"><strong>批接受：未作批判定</strong><span>本报告仅证明本轮被检样本与项目。技术不符合、问题处置、报告确认与质量限制分别记录。</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>气泡</th><th>特性</th><th>技术要求</th>${Array.from({ length: round.sampleCount || 0 }, (_, i) => `<th>样本 S${i + 1}</th>`).join('')}<th>结论</th></tr></thead><tbody>${items.map((item, index) => { const values = round.measurements?.[item.id] || []; const needed = requiredSamples(round, item.id); const results = Array.from({ length: needed }, (_, i) => QMS.evaluate(item, values[i] || '')); const state = results.includes('invalid') ? 'invalid' : results.includes('ng') ? 'ng' : results.includes('pending') ? 'pending' : 'pass'; return `<tr><td>${E(item.balloon || index + 1)}</td><td>${E(item.name)}<small class="inspection-subline">${E(item.method || '')}</small></td><td>${E(range(item))}</td>${Array.from({ length: round.sampleCount || 0 }, (_, i) => `<td class="${results[i] === 'ng' ? 'inspection-bad' : ''}">${E(i >= needed ? '—' : item.kind === 'attribute' ? resultLabels[values[i]] || values[i] || '缺失' : values[i] || '缺失')}</td>`).join('')}<td>${badge(resultLabels[state], tones[state])}</td></tr>`; }).join('')}</tbody></table></div><section class="inspection-report-section"><h3>轮次说明</h3><p>${E(round.reason || '首次检验')}</p><p class="muted">原轮次的测量、失败与处置记录保持独立，本报告不替代其他轮次。</p></section>${(round.photos || []).length ? `<section class="inspection-report-section"><h3>现场照片</h3><div class="inspection-report-photos">${round.photos.map(p => `<figure><img src="${E(p.dataUrl)}" alt="${E(p.name)}"><figcaption>${E(p.name)}</figcaption></figure>`).join('')}</div></section>` : ''}<section class="inspection-report-section"><h3>记录确认</h3><div class="inspection-report-signatures">${[['inspector', '检验员'], ['reviewer', '审核员']].map(([key, label]) => { const s = round.signatures?.[key]; return `<div><strong>${label}</strong>${s ? `<img src="${E(s.dataUrl)}" alt="${label} ${E(s.name)} 手写签名"><span>${E(s.name)} / ${date(s.signedAt)}</span>` : '<span>未要求 / 未签署</span>'}</div>`; }).join('')}</div><p class="inspection-sign-notice">本地手写签名用于记录确认，不等同企业身份认证或正式生产签发。</p></section><footer class="inspection-report-footer"><span>报告快照 ${E(report.id)}</span><span>模板 v1.0 / 本地生成器 v1.0</span></footer></article>`;
  }
  function reports(params = {}) {
    if (params.reportId) {
      const report = (QMS.db.reports || []).find(r => r.id === params.reportId);
      if (!report) return empty('报告不存在', '请返回报告台账选择确定的任务与轮次。', B('返回报告台账', 'reports-back'));
      return `<div class="page-head"><div class="title-group"><button class="inspection-back" data-inspection-action="reports-back">${UI.icon('arrowLeft', 15)} 记录与报告</button><h1>检验报告</h1><p class="muted">保存时固定内容，后续复检不覆盖此报告。</p></div><div class="actions">${B(`${UI.icon('download')} 导出 CSV`, 'report-csv')}${B(`${UI.icon('report')} 打印 / 存为 PDF`, 'report-print', 'primary')}</div></div>${reportBody(report)}`;
    }
    const all = [...(QMS.db.reports || [])].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return `<div class="page-head"><div class="title-group"><div class="muted">检验管理</div><h1>记录与报告</h1><p class="muted">按确定的任务和轮次查看已保存证据。</p></div></div><section class="panel"><div class="panel-head"><h2>报告台账</h2><span class="muted">${all.length} 份记录</span></div>${all.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>报告</th><th>零件 / 批次</th><th>轮次</th><th>技术结论</th><th>生成时间</th><th>操作</th></tr></thead><tbody>${all.map(r => { const { task, round, stats } = reportData(r); return `<tr><td><strong>${E(r.number || r.id)}</strong><small class="inspection-subline">${E(scenarios[task.scenario] || '')}</small></td><td>${E(taskName(task))}<small class="inspection-subline">${E(task.batch)}</small></td><td>${E(round.reason || '首次检验')}<small class="inspection-subline">${E(r.roundId)}</small></td><td>${badge(resultLabels[statusOf(stats)] || statusOf(stats), tones[statusOf(stats)] || 'neutral')}</td><td>${date(r.createdAt)}</td><td>${B('查看报告', 'report-open', 'ghost', `data-id="${E(r.id)}"`)}</td></tr>`; }).join('')}</tbody></table></div>` : empty('暂无已完成的检验报告', '完成一个检验轮次后，真实记录、照片与签名会形成独立快照。', B('进入检验任务', 'inspection-list', 'primary'))}</section>`;
  }
  function csvCell(value) { let str = String(value == null ? '' : value); if (/^[\s]*[=+\-@]/.test(str) || /^[\t\r\n]/.test(str)) str = "'" + str; return '"' + str.replace(/"/g, '""') + '"'; }
  function downloadCsv(report) {
    const { task, round } = reportData(report);
    const rows = [['报告编号', report.number || report.id], ['任务', report.taskId], ['轮次', report.roundId], ['零件', taskName(task)], ['批次', task.batch], ['标准修订', task.standardSnapshot?.revision], ['方案修订', task.planSnapshot?.revision], ['批接受', '未作批判定'], [], ['气泡', '特性', '技术要求', '方法', ...Array.from({ length: round.sampleCount || 0 }, (_, i) => `样本S${i + 1}`)]];
    taskItems(task).forEach(item => rows.push([item.balloon, item.name, range(item), item.method, ...Array.from({ length: round.sampleCount || 0 }, (_, i) => i >= requiredSamples(round, item.id) ? '不要求' : item.kind === 'attribute' ? resultLabels[round.measurements?.[item.id]?.[i]] || '缺失' : round.measurements?.[item.id]?.[i] || '缺失')]));
    rows.push([], ['照片数量', (round.photos || []).length], ['检验员签名', round.signatures?.inspector?.name || '未签署'], ['审核员签名', round.signatures?.reviewer?.name || '未要求 / 未签署'], ['说明', 'CSV 不包含图片或手写笔迹，完整证据请使用报告打印。']);
    const blob = new Blob(['\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `检验报告-${report.number || report.id}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); UI.toast('CSV 已导出；照片与笔迹保留在完整报告中。');
  }
  function printReport() {
    const report = document.getElementById('inspection-report-document'); if (!report) return;
    const host = document.createElement('div'); host.id = 'inspection-print-host'; host.appendChild(report.cloneNode(true)); document.body.appendChild(host);
    document.body.classList.add('printing-inspection-report');
    const cleanup = () => { document.body.classList.remove('printing-inspection-report'); host.remove(); window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup); window.print(); setTimeout(cleanup, 1500);
  }
  function bindReports(params = {}) {
    const page = document.getElementById('page'); if (!page) return;
    page._inspectionAbort?.abort(); const abort = new AbortController(); page._inspectionAbort = abort; const listen = (type, handler) => page.addEventListener(type, handler, { signal: abort.signal });
    listen('click', event => { const b = event.target.closest('[data-inspection-action]'); if (!b) return; const action = b.dataset.inspectionAction;
      if (action === 'reports-back') return App.go('reports');
      if (action === 'report-open') return App.go('reports', { reportId: b.dataset.id });
      if (action === 'inspection-list') return App.go('inspection');
      const report = (QMS.db.reports || []).find(r => r.id === params.reportId); if (!report) return;
      if (action === 'report-csv') downloadCsv(report);
      if (action === 'report-print') printReport();
    });
  }
  window.InspectionPage = { render(params = {}) { current = params; return params.taskId ? detail(params) : list(params); }, bind };
  window.ReportPage = { render: reports, bind: bindReports };
})();

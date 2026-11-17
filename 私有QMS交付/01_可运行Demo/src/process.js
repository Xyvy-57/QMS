/* Reusable process definitions and independent production plan revisions. */
(function () {
  'use strict';
  const state = { tab: 'plans', selectedId: null, draft: null, nodeId: null, dirty: false, query: '', libraryQuery: '' };
  // One page-lifecycle listener preserves drafts across ordinary in-app navigation.
  window.addEventListener?.('beforeunload', event => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
  const scenarios = { IQC: '来料检验', FIRST: '首件检验', IPQC: '制程巡检', FQC: '完工检验', OQC: '出货检验' };
  const esc = value => UI.e(String(value == null ? '' : value));
  const clone = value => QMS.clone ? QMS.clone(value) : JSON.parse(JSON.stringify(value));
  const uid = prefix => QMS.uid(prefix);
  const db = () => QMS.db;
  const btn = (text, action, kind = '', attrs = '') => `<button type="button" class="button ${kind}" data-proc-action="${action}" ${attrs}>${text}</button>`;
  const icon = name => UI.icon(name, 17);
  const revision = p => String(p.revision || 1).replace(/^v/i, '');
  const nextRevision = p => { const n = Number(String(p.revision || 1).replace(/^v/i, '')); return Number.isFinite(n) ? n + 1 : 2; };
  const standard = () => (db().standards || []).find(s => s.id === state.draft?.standardId);
  const notify = text => UI.toast(text);
  const repaint = () => App.render();
  const published = p => p.status === 'published';
  const stepType = value => ({input:'准备核验',manufacturing:'加工',measurement:'检验',review:'质量复核',output:'放行归档',packaging:'包装',other:'其他'}[value] || value || '检验');
  function ensure() {
    const plans = db().plans || (db().plans = []);
    if (!state.draft) {
      const p = plans.find(p => p.id === state.selectedId) || plans[0];
      if (p) select(p.id, false);
    }
  }
  function select(id, render = true) {
    const p = db().plans.find(p => p.id === id);
    state.selectedId = id; state.draft = p ? clone(p) : null; state.dirty = false;
    if (state.draft) { state.draft.nodes ||= []; state.draft.edges ||= []; }
    state.nodeId = state.draft?.nodes[0]?.id || null;
    if (render) repaint();
  }
  function changed() { state.dirty = true; }
  function formField(label, content, full = false) { return `<label class="field ${full ? 'pp-span' : ''}"><span>${label}</span>${content}</label>`; }
  function options(values, selected) { return values.map(([value, label]) => `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(label)}</option>`).join(''); }
  function safeAction(fn) { try { fn(); } catch (error) { notify(error.message || '操作未完成，请检查填写内容。'); } }
  function modalActions(onConfirm, confirm = '确认', cancel = '取消') {
    const confirmButton = document.getElementById('pp-confirm');
    confirmButton?.addEventListener('click', () => safeAction(onConfirm));
    document.getElementById('pp-cancel')?.addEventListener('click', () => UI.close());
    const form = document.getElementById('pp-form');
    form?.addEventListener('submit', event => { event.preventDefault(); safeAction(onConfirm); });
    form?.querySelector('input:not([type="checkbox"]), select')?.focus();
  }
  function modal(title, content, confirmLabel, onConfirm) {
    UI.modal(title, `<form id="pp-form">${content}</form>`, `<button type="button" class="button" id="pp-cancel">取消</button><button type="button" class="button primary" id="pp-confirm">${esc(confirmLabel)}</button>`);
    modalActions(onConfirm);
  }
  function askDiscard(next) {
    if (!state.dirty) { next(); return; }
    modal('保留当前修改？', '<p class="muted">当前方案有未保存的修改。切换后这些修改将丢弃，已保存的版本不受影响。</p>', '丢弃修改并继续', () => { UI.close(); next(); });
  }
  function descendants(id, edges) {
    const found = new Set(); const queue = [id];
    while (queue.length) { const current = queue.shift(); edges.filter(e => e.source === current).forEach(e => { if (!found.has(e.target)) { found.add(e.target); queue.push(e.target); } }); }
    return found;
  }
  function validate(plan, publishing = false) {
    if (!String(plan.name || '').trim()) throw new Error('请填写方案名称。');
    const ids = new Set(plan.nodes.map(n => n.id));
    if (ids.size !== plan.nodes.length) throw new Error('工序节点编号重复。');
    const seen = new Set();
    plan.edges.forEach(edge => {
      if (edge.source === edge.target) throw new Error('工序不能依赖自身。');
      if (!ids.has(edge.source) || !ids.has(edge.target)) throw new Error('依赖关系包含不存在的工序。');
      const key = `${edge.source}|${edge.target}`;
      if (seen.has(key)) throw new Error('存在重复的工序依赖。');
      seen.add(key);
    });
    if (plan.nodes.some(n => descendants(n.id, plan.edges).has(n.id))) throw new Error('工序依赖形成了环，请移除循环依赖。');
    plan.nodes.forEach(n => {
      if (!n.name.trim()) throw new Error('每个工序都需要名称。');
      if (!Number.isInteger(Number(n.sampleCount)) || Number(n.sampleCount) < 1 || Number(n.sampleCount) > 100) throw new Error('抽样数量需要是 1–100 的整数。');
    });
    if (publishing) {
      if (!plan.nodes.length) throw new Error('请至少添加一道工序后再发布。');
      const s = db().standards.find(s => s.id === plan.standardId);
      if (!s) throw new Error('请先关联检验标准。');
      const itemIds = new Set(s.items.map(item => item.id));
      if (plan.nodes.some(n => n.itemIds.some(id => !itemIds.has(id)))) throw new Error('工序含有已失效的检验特性，请重新关联。');
      if (!plan.nodes.some(n => n.itemIds.length)) throw new Error('请至少为一道工序关联检验特性。');
      if (s.status !== 'published') throw new Error('关联的检验标准尚未发布，请先完成标准复核。');
      if (QMS.validatePlan) QMS.validatePlan(plan, s);
    }
    return true;
  }
  function save(publish) {
    const working = clone(state.draft);
    validate(working, publish);
    const original = db().plans.find(p => p.id === state.selectedId);
    if (original && published(original) && !state.dirty) { notify('当前版本已发布，没有待保存的修改。'); return; }
    working.name = working.name.trim();
    working.status = publish ? 'published' : 'draft';
    if (original && published(original)) {
      working.id = uid('plan'); working.revision = nextRevision(original);
      working.previousRevisionId = original.id;
      db().plans.unshift(working);
    } else {
      const index = db().plans.findIndex(p => p.id === working.id);
      if (index >= 0) db().plans[index] = working; else db().plans.unshift(working);
    }
    QMS.save(); select(working.id);
    notify(publish ? '方案已发布，可创建独立批次任务。' : '方案草稿已保存。');
  }
  function newPlan(copyId) {
    askDiscard(() => {
      const source = db().plans.find(p => p.id === copyId);
      const s = db().standards.find(s => s.status === 'published') || db().standards[0];
      const p = source ? clone(source) : { nodes: [], edges: [], standardId: s?.id || '', scenario: 'FIRST' };
      p.id = uid('plan'); p.name = source ? `${source.name} 副本` : '新建检验流程'; p.revision = 1; p.status = 'draft';
      delete p.previousRevisionId;
      if (source) {
        const mapping = new Map(p.nodes.map(n => [n.id, uid('node')]));
        p.nodes.forEach(n => { n.id = mapping.get(n.id); });
        p.edges = p.edges.map(e => ({ source: mapping.get(e.source), target: mapping.get(e.target) }));
      }
      state.selectedId = p.id; state.draft = p; state.nodeId = p.nodes[0]?.id || null; state.dirty = true; state.tab = 'plans'; repaint();
      notify(source ? '已创建独立副本，编辑后保存。' : '从工序库添加节点，开始编排流程。');
    });
  }
  function layout(plan) {
    const nodes = plan.nodes;
    const indegree = new Map(nodes.map(n => [n.id, 0]));
    const levels = new Map(nodes.map(n => [n.id, 0]));
    plan.edges.forEach(e => { if (indegree.has(e.target)) indegree.set(e.target, indegree.get(e.target) + 1); });
    const queue = nodes.filter(n => indegree.get(n.id) === 0).map(n => n.id);
    while (queue.length) {
      const id = queue.shift();
      plan.edges.filter(e => e.source === id).forEach(e => {
        if (!indegree.has(e.target)) return;
        levels.set(e.target, Math.max(levels.get(e.target), levels.get(id) + 1));
        indegree.set(e.target, indegree.get(e.target) - 1);
        if (!indegree.get(e.target)) queue.push(e.target);
      });
    }
    const groups = [];
    nodes.forEach(n => { const level = levels.get(n.id) || 0; (groups[level] ||= []).push(n); });
    const max = Math.max(1, ...groups.map(g => g.length));
    const height = Math.max(400, max * 150 + 74);
    const positions = new Map();
    groups.forEach((group, col) => group.forEach((n, row) => positions.set(n.id, { x: 35 + col * 280, y: (height - group.length * 150 + 20) / 2 + row * 150 })));
    return { positions, width: Math.max(530, groups.length * 280 + 10), height };
  }
  function graph() {
    const plan = state.draft;
    if (!plan.nodes.length) return `<div class="pp-canvas-empty"><div class="pp-empty-icon">${icon('git-branch')}</div><h3>把经验，编排成标准流程</h3><p>从工序库添加节点，为节点设置前置工序。<br>串行、并行与汇合都使用同一套规则。</p>${btn(`${icon('plus')} 添加第一道工序`, 'add-node', 'primary')}</div>`;
    const { positions, width, height } = layout(plan);
    const lines = plan.edges.map(e => {
      const a = positions.get(e.source), b = positions.get(e.target); if (!a || !b) return '';
      const x1 = a.x + 210, y1 = a.y + 58, x2 = b.x, y2 = b.y + 58;
      return `<path d="M${x1},${y1} C${x1 + 40},${y1} ${x2 - 40},${y2} ${x2 - 7},${y2}" class="${e.source === state.nodeId || e.target === state.nodeId ? 'selected' : ''}" marker-end="url(#pp-arrow)"/>`;
    }).join('');
    return `<div class="pp-graph" style="width:${width}px;height:${height}px"><svg class="pp-edges" viewBox="0 0 ${width} ${height}" aria-hidden="true"><defs><marker id="pp-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" class="pp-arrow"/></marker></defs>${lines}</svg>${plan.nodes.map((n, index) => {
      const p = positions.get(n.id), incoming = plan.edges.filter(e => e.target === n.id).length;
      return `<button type="button" class="pp-node ${state.nodeId === n.id ? 'is-selected' : ''}" style="transform:translate(${p.x}px,${p.y}px)" data-proc-action="select-node" data-id="${esc(n.id)}" aria-pressed="${state.nodeId === n.id}"><span class="pp-node-top"><span class="pp-node-number">${String(index + 1).padStart(2, '0')}</span><span>${incoming > 1 ? '汇合工序' : incoming === 0 ? '起始工序' : '执行工序'}</span>${icon('more-horizontal')}</span><strong>${esc(n.name)}</strong><span class="pp-node-bottom"><span>${esc(n.role || '未分配角色')}</span><span>${n.itemIds.length} 特性 <span class="pp-node-sep">/</span> ${n.sampleCount} 件</span></span></button>`;
    }).join('')}</div>`;
  }
  function inspector() {
    const plan = state.draft, node = plan.nodes.find(n => n.id === state.nodeId), s = standard();
    if (!node) return `<aside class="pp-inspector"><div class="pp-inspector-empty">${icon('mouse-pointer')}<h3>选择一道工序</h3><p>在画布中选择节点，配置检验范围、责任角色和执行顺序。</p></div></aside>`;
    const dependencies = plan.edges.filter(e => e.target === node.id).map(e => e.source);
    const excluded = descendants(node.id, plan.edges);
    const others = plan.nodes.filter(n => n.id !== node.id);
    return `<aside class="pp-inspector"><div class="pp-inspector-head"><div><small>节点配置</small><h3>${esc(node.name)}</h3></div>${btn(icon('copy'), 'copy-node', 'ghost', 'title="复制当前节点" aria-label="复制当前节点"')}</div><div class="pp-inspector-body">${formField('工序名称', `<input class="input" data-node-field="name" value="${esc(node.name)}" maxlength="60">`)}${formField('责任角色', `<input class="input" data-node-field="role" value="${esc(node.role || '')}" placeholder="例如：质量检验员" maxlength="40">`)}${formField('每项抽样数量', `<input class="input" type="number" min="1" max="100" step="1" data-node-field="sampleCount" value="${Number(node.sampleCount) || 1}">`)}<div class="pp-section-label"><span>前置工序</span><span>${dependencies.length} 项</span></div><p class="pp-helper">前置关系保存在方案中；当前演示统一录入关联特性。</p><div class="pp-check-list">${others.length ? others.map(n => `<label class="pp-check-row ${excluded.has(n.id) ? 'is-disabled' : ''}"><input type="checkbox" data-dependency="${esc(n.id)}" ${dependencies.includes(n.id) ? 'checked' : ''} ${excluded.has(n.id) ? 'disabled' : ''}><span>${esc(n.name)}</span>${excluded.has(n.id) ? '<small>后续工序</small>' : ''}</label>`).join('') : '<p class="pp-helper">当前为起始节点，无前置工序。</p>'}</div><div class="pp-section-label"><span>关联检验特性</span><span>${node.itemIds.length} 项</span></div><p class="pp-helper">来自 ${esc(s?.name || '未关联的检验标准')}</p><div class="pp-check-list pp-items">${s?.items?.length ? s.items.map(item => `<label class="pp-check-row"><input type="checkbox" data-item-id="${esc(item.id)}" ${node.itemIds.includes(item.id) ? 'checked' : ''}><span class="pp-item-bubble">${esc(item.balloon)}</span><span>${esc(item.name)}<small>${esc(item.nominal)} ${esc(item.unit || '')} ${item.verified ? '' : '（待核对）'}</small></span></label>`).join('') : '<p class="pp-helper">请在方案设置中关联检验标准。</p>'}</div></div><div class="pp-inspector-footer">${btn(`${icon('trash-2')} 删除节点`, 'remove-node', 'ghost pp-danger')}</div></aside>`;
  }
  function library() {
    const items = (db().steps || []).filter(s => `${s.name} ${s.type} ${s.role}`.toLowerCase().includes(state.libraryQuery.toLowerCase()));
    return `<div class="panel pp-library"><div class="panel-head"><div><h3>标准工序库</h3><p class="muted">将工序作为积木复用，加入流程后可独立调整。</p></div>${btn(`${icon('plus')} 新建工序`, 'new-step', 'primary')}</div><div class="toolbar"><div class="pp-search">${icon('search')}<input class="input" id="pp-step-search" placeholder="搜索工序名称、类型或责任角色" value="${esc(state.libraryQuery)}"></div><span class="muted">${items.length} 道工序</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>工序名称</th><th>类型</th><th>责任角色</th><th>作业说明</th><th>操作</th></tr></thead><tbody>${items.map(s => `<tr><td><strong>${esc(s.name)}</strong><small class="pp-cell-sub">${esc(s.id)}</small></td><td>${UI.badge(stepType(s.type), 'neutral')}</td><td>${esc(s.role || '未设置')}</td><td class="pp-description">${esc(s.description || '—')}</td><td><div class="actions">${btn('编辑', 'edit-step', 'ghost', `data-id="${esc(s.id)}"`)}${btn('复制', 'copy-step', 'ghost', `data-id="${esc(s.id)}"`)}</div></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty-state">未找到匹配的工序</div></td></tr>'}</tbody></table></div></div>`;
  }
  function plans() {
    const all = db().plans || [], filtered = all.filter(p => p.name.toLowerCase().includes(state.query.toLowerCase()));
    const p = state.draft;
    return `<div class="pp-workspace"><aside class="pp-plan-list"><div class="pp-list-heading"><h3>流程方案</h3>${btn(icon('plus'), 'new-plan', 'ghost', 'title="新建方案" aria-label="新建方案"')}</div><div class="pp-list-search">${icon('search')}<input id="pp-plan-search" placeholder="搜索方案" value="${esc(state.query)}"></div><div class="pp-plans-scroll">${p && !all.find(x => x.id === p.id) ? `<button class="pp-plan active" type="button"><strong>${esc(p.name)}</strong><span>${UI.badge('未保存', 'amber')}<small>v${esc(revision(p))}</small></span></button>` : ''}${filtered.map(item => `<button type="button" class="pp-plan ${state.selectedId === item.id ? 'active' : ''}" data-proc-action="select-plan" data-id="${esc(item.id)}"><strong>${esc(item.name)}</strong><span>${UI.badge(published(item) ? '已发布' : '草稿', published(item) ? 'green' : 'neutral')}<small>v${esc(revision(item))} / ${item.nodes.length} 工序</small></span></button>`).join('') || (!p ? '<div class="pp-list-empty">还没有流程方案</div>' : '')}</div><div class="pp-list-foot">${icon('layers')}<span>模板复用，批次独立执行</span></div></aside><section class="pp-editor">${p ? `<div class="pp-editor-head"><div class="pp-plan-title"><span class="pp-plan-glyph">${icon('git-branch')}</span><div><h3>${esc(p.name)}</h3><p>v${esc(revision(p))} ${state.dirty ? '有未保存修改' : published(p) ? '已发布的标准流程' : '草稿流程'}</p></div></div><div class="actions">${btn(icon('copy'), 'copy-plan', 'ghost', 'title="复制为新方案" aria-label="复制为新方案"')}${btn(icon('settings'), 'plan-settings', 'ghost', 'title="方案设置" aria-label="方案设置"')}</div></div><div class="pp-editor-toolbar"><span>${UI.badge(scenarios[p.scenario] || p.scenario || '首件检验', 'blue')}<span class="pp-standard-name">${esc(standard()?.name || '未关联标准')}</span></span>${btn(`${icon('plus')} 添加工序`, 'add-node', 'ghost')}</div><div class="pp-canvas" tabindex="0" aria-label="工序关系画布，可横向滚动">${graph()}</div><div class="pp-editor-foot"><span>${p.nodes.length} 道工序 <span class="pp-node-sep">/</span> ${p.edges.length} 条依赖</span><span>${icon('git-branch')}自动布局</span></div>` : `<div class="pp-canvas-empty"><h3>建立第一个可复用流程</h3><p>关联检验标准，编排工序，发布后用于多个生产批次。</p>${btn('新建流程方案', 'new-plan', 'primary')}</div>`}</section>${p ? inspector() : ''}</div>`;
  }
  function render() {
    ensure();
    return `<div class="pp-page"><div class="page-head"><div class="title-group"><h1>工序与方案</h1><p class="muted">让每一道工序有标准，让每一个批次可追溯。</p></div><div class="actions">${state.tab === 'plans' && state.draft ? `${btn('保存草稿', 'save-draft', '', !state.dirty && published(state.draft) ? 'disabled' : '')}${btn(published(state.draft) && !state.dirty ? '创建批次任务' : '发布方案', published(state.draft) && !state.dirty ? 'create-task' : 'publish', 'primary')}` : ''}</div></div><div class="tabs pp-tabs"><button type="button" class="tab ${state.tab === 'plans' ? 'active' : ''}" data-proc-action="tab-plans">${icon('git-branch')}流程编排<span>${db().plans.length}</span></button><button type="button" class="tab ${state.tab === 'library' ? 'active' : ''}" data-proc-action="tab-library">${icon('layers')}标准工序库<span>${db().steps.length}</span></button><div class="pp-tabs-note">${icon('copy')}工序、流程、检验范围均可复用</div></div>${state.tab === 'library' ? library() : plans()}</div>`;
  }
  function editStep(id, copy = false) {
    const found = db().steps.find(s => s.id === id);
    const step = found ? clone(found) : { name: '', type: 'measurement', role: '质量检验员', description: '' };
    if (copy) step.name += ' 副本';
    modal(copy ? '复制标准工序' : found ? '编辑标准工序' : '新建标准工序', `<div class="form-grid">${formField('工序名称', `<input class="input" id="pp-step-name" required maxlength="60" value="${esc(step.name)}" placeholder="例如：CNC 首件尺寸检验">`, true)}${formField('工序类型', `<select class="select" id="pp-step-type">${options([['input','准备核验'],['manufacturing','加工'],['measurement','检验'],['review','质量复核'],['output','放行归档'],['packaging','包装'],['other','其他']], step.type)}</select>`)}${formField('责任角色', `<input class="input" id="pp-step-role" required maxlength="40" value="${esc(step.role)}">`)}${formField('作业说明', `<textarea class="input" id="pp-step-description" rows="4" maxlength="500" placeholder="标准作业要求、输入和输出">${esc(step.description)}</textarea>`, true)}</div><p class="pp-helper">工序库更新后，已应用到方案中的节点保留原配置。</p>`, '保存工序', () => {
      const name = document.getElementById('pp-step-name').value.trim(), role = document.getElementById('pp-step-role').value.trim();
      if (!name || !role) throw new Error('请填写工序名称和责任角色。');
      const data = { id: found && !copy ? found.id : uid('step'), name, role, type: document.getElementById('pp-step-type').value, description: document.getElementById('pp-step-description').value.trim() };
      const index = db().steps.findIndex(s => s.id === data.id); if (index >= 0) db().steps[index] = data; else db().steps.unshift(data);
      QMS.save(); UI.close(); repaint(); notify('标准工序已保存。');
    });
  }
  function addNode() {
    const steps = db().steps || [];
    if (!steps.length) { notify('请先在标准工序库中创建工序。'); state.tab = 'library'; repaint(); return; }
    const current = state.draft.nodes.find(n => n.id === state.nodeId);
    modal('从工序库添加', `<div class="pp-step-picker">${steps.map((s, i) => `<label class="pp-step-option"><input type="radio" name="pp-step-choice" value="${esc(s.id)}" ${i === 0 ? 'checked' : ''}><span><strong>${esc(s.name)}</strong><small>${esc(s.role)} / ${esc(stepType(s.type))}</small></span></label>`).join('')}</div>${current ? `<label class="pp-check-row pp-after-option"><input type="checkbox" id="pp-after-current" checked><span>接在「${esc(current.name)}」之后</span></label>` : ''}<p class="pp-helper">添加后可独立配置节点，不会修改工序库原件。</p>`, '添加到流程', () => {
      const selected = document.querySelector('input[name="pp-step-choice"]:checked');
      const step = steps.find(s => s.id === selected?.value);
      if (!step) throw new Error('请选择一道工序。');
      const node = { id: uid('node'), stepId: step.id, name: step.name, role: step.role, itemIds: [], sampleCount: 1 };
      state.draft.nodes.push(node);
      if (current && document.getElementById('pp-after-current')?.checked) state.draft.edges.push({ source: current.id, target: node.id });
      state.nodeId = node.id; changed(); UI.close(); repaint();
    });
  }
  function removeNode() {
    const node = state.draft.nodes.find(n => n.id === state.nodeId); if (!node) return;
    modal('删除当前节点', `<p>将从当前流程移除「${esc(node.name)}」及其依赖连线。</p><p class="muted">工序库中的原件和已生成的批次任务不受影响。</p>`, '删除节点', () => {
      state.draft.nodes = state.draft.nodes.filter(n => n.id !== node.id);
      state.draft.edges = state.draft.edges.filter(e => e.source !== node.id && e.target !== node.id);
      state.nodeId = state.draft.nodes[0]?.id || null; changed(); UI.close(); repaint();
    });
  }
  function copyNode() {
    const source = state.draft.nodes.find(n => n.id === state.nodeId); if (!source) return;
    const node = clone(source); node.id = uid('node'); node.name += ' 副本';
    state.draft.nodes.push(node);
    state.draft.edges.filter(e => e.target === source.id).forEach(e => state.draft.edges.push({ source: e.source, target: node.id }));
    state.nodeId = node.id; changed(); repaint(); notify('已复制节点与前置依赖。');
  }
  function planSettings() {
    const p = state.draft;
    modal('方案设置', `<div class="form-grid">${formField('方案名称', `<input class="input" id="pp-plan-name" maxlength="80" value="${esc(p.name)}">`, true)}${formField('检验场景', `<select class="select" id="pp-plan-scenario">${options(Object.entries(scenarios), p.scenario)}</select>`)}${formField('关联检验标准', `<select class="select" id="pp-plan-standard"><option value="">请选择标准</option>${options(db().standards.map(s => [s.id, `${s.name} / v${s.revision || 1}`]), p.standardId)}</select>`)}<p class="pp-helper pp-span">更换标准后，原有特性关联将被清空，请重新配置每道工序的检验范围。</p></div>`, '更新方案', () => {
      const name = document.getElementById('pp-plan-name').value.trim(), standardId = document.getElementById('pp-plan-standard').value;
      if (!name) throw new Error('请填写方案名称。');
      if (standardId !== p.standardId) p.nodes.forEach(n => { n.itemIds = []; });
      p.name = name; p.standardId = standardId; p.scenario = document.getElementById('pp-plan-scenario').value;
      changed(); UI.close(); repaint();
    });
  }
  function createTask() {
    if (state.dirty || !published(state.draft)) { notify('请先发布当前修改，再创建批次任务。'); return; }
    const p = state.draft;
    modal('创建批次检验任务', `<div class="pp-modal-summary">${icon('git-branch')}<div><strong>${esc(p.name)}</strong><p>${esc(scenarios[p.scenario] || p.scenario)} / v${esc(revision(p))} / ${p.nodes.length} 道工序</p></div></div><div class="form-grid">${formField('生产批次', '<input class="input" id="pp-task-batch" required maxlength="60" placeholder="例如：LOT-20261116-01">', true)}${formField('批次数量', '<input class="input" type="number" id="pp-task-quantity" min="1" max="1000000" step="1" value="100">')}${formField('检验人员', '<input class="input" id="pp-task-inspector" maxlength="40" placeholder="填写检验员姓名">')}<label class="pp-check-row pp-span"><input type="checkbox" id="pp-task-review"><span>本任务需要审核员签名</span></label></div><p class="pp-helper">创建时冻结当前方案和标准，后续模板修订不会改变本批次任务。</p>`, '创建并开始检验', () => {
      const batch = document.getElementById('pp-task-batch').value.trim(), inspector = document.getElementById('pp-task-inspector').value.trim(), quantity = Number(document.getElementById('pp-task-quantity').value);
      if (!batch || !inspector) throw new Error('请填写生产批次和检验人员。');
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000000) throw new Error('批次数量需为 1–1,000,000 的整数。');
      const task = QMS.createTask({ standardId: p.standardId, scenario: p.scenario, batch, quantity, planId: p.id, inspector, reviewRequired: document.getElementById('pp-task-review').checked });
      UI.close(); App.go('inspection', { taskId: task.id }); notify('批次任务已创建。');
    });
  }
  function bind() {
    const root = document.getElementById('page'); if (!root) return;
    root.onclick = event => {
      const target = event.target.closest('[data-proc-action]'); if (!target) return;
      const action = target.dataset.procAction, id = target.dataset.id;
      safeAction(() => {
        if (action === 'tab-plans' || action === 'tab-library') { state.tab = action === 'tab-plans' ? 'plans' : 'library'; repaint(); }
        else if (action === 'select-plan') askDiscard(() => select(id));
        else if (action === 'select-node') { state.nodeId = id; repaint(); }
        else if (action === 'new-plan') newPlan();
        else if (action === 'copy-plan') {
          if (!db().plans.some(p => p.id === state.selectedId)) { notify('请先保存当前方案，再复制。'); return; }
          newPlan(state.selectedId);
        }
        else if (action === 'save-draft') save(false);
        else if (action === 'publish') save(true);
        else if (action === 'new-step') editStep();
        else if (action === 'edit-step') editStep(id);
        else if (action === 'copy-step') editStep(id, true);
        else if (action === 'add-node') addNode();
        else if (action === 'copy-node') copyNode();
        else if (action === 'remove-node') removeNode();
        else if (action === 'plan-settings') planSettings();
        else if (action === 'create-task') createTask();
      });
    };
    root.onchange = event => {
      const input = event.target, node = state.draft?.nodes.find(n => n.id === state.nodeId);
      if (!node) return;
      safeAction(() => {
        if (input.dataset.nodeField) {
          const key = input.dataset.nodeField, value = key === 'sampleCount' ? Number(input.value) : input.value.trim();
          if (key === 'sampleCount' && (!Number.isInteger(value) || value < 1 || value > 100)) { input.value = node.sampleCount; throw new Error('抽样数量应为 1–100 的整数。'); }
          if (key === 'name' && !value) { input.value = node.name; throw new Error('工序名称不能为空。'); }
          node[key] = value; changed(); repaint();
        } else if (input.dataset.dependency) {
          const source = input.dataset.dependency;
          if (source === node.id || descendants(node.id, state.draft.edges).has(source)) { input.checked = false; throw new Error('该依赖会产生循环，已阻止添加。'); }
          state.draft.edges = state.draft.edges.filter(e => !(e.source === source && e.target === node.id));
          if (input.checked) state.draft.edges.push({ source, target: node.id });
          changed(); repaint();
        } else if (input.dataset.itemId) {
          const itemId = input.dataset.itemId;
          node.itemIds = node.itemIds.filter(id => id !== itemId); if (input.checked) node.itemIds.push(itemId);
          changed(); repaint();
        }
      });
    };
    const searchHandler = (id, prop) => {
      const el = document.getElementById(id); if (!el) return;
      el.addEventListener('input', () => { const caret = el.selectionStart; state[prop] = el.value; repaint(); const next = document.getElementById(id); next?.focus(); next?.setSelectionRange(caret, caret); });
    };
    searchHandler('pp-plan-search', 'query'); searchHandler('pp-step-search', 'libraryQuery');
  }
  window.ProcessPage = { render, bind, validate };
})();

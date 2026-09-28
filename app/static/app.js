const appState = { projects: [], selectedProjectId: null, selectedProject: null, selectedDocument: null, activeTab: 'materials', activePlan: null, editingContentId: null, collectionFilter: '' };
const SCENARIOS = {
  daily_brief: { name: '晨间 / 晚间法律速听', description: '单篇资讯的短时精炼收听', transform: 'condense', verification: 'source_only', duration: 5, audio: true, audience: '个人学习', narrativeLabel: '速听讲稿' },
  topic_learning: { name: '专题学习与表达', description: '围绕选定材料形成分章节学习内容', transform: 'adapt', verification: 'material_check', duration: 10, audio: true, audience: '法律从业者与企业法务', narrativeLabel: '主题讲稿' },
  speaking_note: { name: '客户培训 / Speak Note', description: '准备培训、发言和对外交流讲稿', transform: 'enrich', verification: 'external_verify', duration: 20, audio: false, audience: '客户法务与业务团队', narrativeLabel: 'Speak Note' },
  legal_podcast: { name: '法律科普播客', description: '实务热点与经验积累的对外表达', transform: 'enrich', verification: 'external_verify', duration: 20, audio: true, audience: '行业听众与潜在客户', narrativeLabel: '播客讲稿' },
};
const TRANSFORM_NAMES = { condense: '内容精炼', adapt: '正常转译', enrich: '内容丰富' };
const lengthOfWords = words => words <= 2200 ? 'short' : words <= 5000 ? 'standard' : 'deep';
const VERIFICATION_NAMES = { source_only: '资讯转译', material_check: '材料一致性检查', external_verify: '外部事实核验' };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

async function request(url, options = {}) {
  if (window.location.protocol === 'file:') {
    throw new Error('当前打开的是源码页面，不能直接使用。请打开已安装的声息 app。');
  }
  const response = await fetch(url, options);
  if (!response.ok) {
    let detail = '请求失败，请稍后重试。';
    try { detail = formatErrorDetail((await response.json()).detail) || detail; } catch (_) {}
    throw new Error(typeof detail === 'string' ? detail : '请求失败，请检查设置后重试。');
  }
  return (response.headers.get('content-type') || '').includes('application/json') ? response.json() : response;
}

function formatErrorDetail(detail) {
  if (typeof detail === 'string') return detail;
  if (detail instanceof Error) return typeof detail.message === 'string' ? detail.message : '请求失败，请稍后重试。';
  if (Array.isArray(detail)) {
    const messages = detail.map(item => {
      if (!item || typeof item !== 'object') return String(item || '');
      const field = Array.isArray(item.loc) ? item.loc.filter(part => part !== 'body').join(' / ') : '';
      return (field ? '“' + field + '”' : '设置') + (item.msg ? '：' + item.msg : '格式不正确');
    }).filter(Boolean);
    return messages.join('；');
  }
  if (detail && typeof detail === 'object') {
    for (const key of ['message', 'detail', 'error', 'msg']) {
      const value = formatErrorDetail(detail[key]);
      if (value) return value;
    }
    try {
      const text = JSON.stringify(detail);
      return text && text !== '{}' ? text : '请求参数不正确，请检查后重试。';
    } catch (_) {
      return '请求参数不正确，请检查后重试。';
    }
  }
  return '';
}

function readableError(error) {
  const message = formatErrorDetail(error);
  return typeof message === 'string' && message ? message : '请求失败，请稍后重试。';
}

function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function formatDate(value) { try { return value ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value)) : ''; } catch (_) { return value || ''; } }
function statusText(status) { return ({ draft: '草稿', pending_review: '待律师审核', confirmed: '已确认', needs_revision: '待修改', discarded: '已废弃', open: '待处理', in_progress: '处理中', done: '已完成', dismissed: '已关闭' })[status] || status; }
function showMessage(message, error = false) { const box = $('#workspace-message'); box.textContent = message; box.className = error ? 'message error' : 'message'; setTimeout(() => box.classList.add('hidden'), 4800); }
function setBusy(button, busy, label = '处理中…') { if (!button) return; if (busy) { button.dataset.label = button.textContent; button.textContent = label; button.disabled = true; } else { button.textContent = button.dataset.label || button.textContent; button.disabled = false; } }

async function loadProjects() { appState.projects = await request('/api/projects'); renderProjectList(); }
async function loadDailyBriefSubscriptions() {
  const list = $('#daily-brief-list');
  if (!list) return;
  try {
    const subscriptions = await request('/api/daily-brief-subscriptions');
    if (!subscriptions.length) { list.innerHTML = ''; return; }
    list.innerHTML = '<section class="daily-brief-card"><div><p class="eyebrow">每日速听</p><h3>已订阅的资讯渠道</h3></div><div class="daily-brief-rows">' + subscriptions.map(item => '<div class="daily-brief-row"><div><b>' + escapeHtml(item.name) + '</b><small>每天 ' + escapeHtml(item.daily_time) + ' · 每次最多 ' + item.max_items + ' 篇 · ' + escapeHtml(item.last_status || '尚未运行') + '</small></div><div class="daily-brief-actions"><button class="button button-outline button-small" data-run-subscription="' + item.id + '">立即收集</button><button class="button button-quiet button-small" data-delete-subscription="' + item.id + '">删除</button></div></div>').join('') + '</div></section>';
    $$('[data-run-subscription]', list).forEach(button => button.addEventListener('click', () => runDailyBriefSubscription(button.dataset.runSubscription, button)));
    $$('[data-delete-subscription]', list).forEach(button => button.addEventListener('click', () => deleteDailyBriefSubscription(button.dataset.deleteSubscription)));
  } catch (error) { list.innerHTML = '<p class="form-note">无法读取每日速听订阅：' + escapeHtml(error.message) + '</p>'; }
}
async function runDailyBriefSubscription(id, button) {
  try { setBusy(button, true, '收集中…'); const result = await request('/api/daily-brief-subscriptions/' + id + '/run', {method:'POST'}); await Promise.all([loadDailyBriefSubscriptions(), loadProjects()]); showMessage(result.status + (result.project_id ? '，已创建待审速听任务。' : '。')); if (result.project_id) openProject(result.project_id); } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); }
}
async function deleteDailyBriefSubscription(id) {
  if (!window.confirm('删除这个每日速听订阅？已收集的项目和导出成果不会删除。')) return;
  try { await request('/api/daily-brief-subscriptions/' + id, {method:'DELETE'}); await loadDailyBriefSubscriptions(); showMessage('每日速听订阅已删除。'); } catch (error) { showMessage(error.message, true); }
}
function renderCollectionBar() {
  const bar = $('#collection-bar');
  if (!bar) return;
  const counts = {};
  let untagged = 0;
  for (const project of appState.projects) {
    const key = (project.collection || '').trim();
    if (key) counts[key] = (counts[key] || 0) + 1; else untagged += 1;
  }
  const chips = ['<button type="button" class="collection-chip' + (appState.collectionFilter === '' ? ' active' : '') + '" data-collection="">全部<span class="count">' + appState.projects.length + '</span></button>'];
  for (const [name, count] of Object.entries(counts)) chips.push('<button type="button" class="collection-chip' + (appState.collectionFilter === name ? ' active' : '') + '" data-collection="' + escapeHtml(name) + '">' + escapeHtml(name) + '<span class="count">' + count + '</span></button>');
  if (untagged) chips.push('<button type="button" class="collection-chip' + (appState.collectionFilter === '__untagged__' ? ' active' : '') + '" data-collection="__untagged__">未归类<span class="count">' + untagged + '</span></button>');
  bar.innerHTML = chips.join('');
  $$('.collection-chip', bar).forEach(chip => chip.addEventListener('click', () => { appState.collectionFilter = chip.dataset.collection; renderProjectList(); }));
}

function renderProjectList() {
  const list = $('#project-list');
  if (!document.body.classList.contains('in-shelf')) return;
  renderCollectionBar();
  if (!appState.projects.length) {
    list.innerHTML = '<section class="empty-state onboarding"><p class="eyebrow">首次使用</p><h3>从一篇材料到可审阅讲稿，只需三步</h3><div class="onboarding-steps"><div><b>1</b><span>导入法规、新闻或实务笔记</span></div><div><b>2</b><span>确认结构；对外内容先完成核验</span></div><div><b>3</b><span>用 ChatGPT 或 API 生成，回到本地审阅与导出</span></div></div><div class="onboarding-actions"><button class="button button-primary" id="load-demo-project">加载完整示例</button><button class="button button-outline" id="start-first-project">新建我的任务</button></div><small>示例不调用任何外部模型，也可以随时删除。</small></section>';
    $('#load-demo-project').addEventListener('click', loadDemoProject);
    $('#start-first-project').addEventListener('click', () => $('#new-project').click());
    return;
  }
  const filter = appState.collectionFilter;
  const visible = appState.projects.filter(project => {
    const tag = (project.collection || '').trim();
    if (filter === '__untagged__') return !tag;
    return !filter || tag === filter;
  });
  if (!visible.length) { list.innerHTML = '<div class="empty-state"><b>这个收藏夹还是空的</b><p>换一个标签看看，或点卡片上的「＋ 收藏夹」把它归到这。</p></div>'; return; }
  list.innerHTML = visible.map(project => { const scenario = SCENARIOS[project.scenario] || SCENARIOS.topic_learning; const progress = project.learning_progress || { done: 0, total: 0 }; const percent = progress.total ? Math.round(progress.done / progress.total * 100) : 0; const progressHtml = progress.total ? '<div class="card-progress"><div class="card-progress-bar"><i style="width:' + percent + '%"></i></div><span>已学 ' + progress.done + ' / ' + progress.total + ' 节</span></div>' : ''; const tag = (project.collection || '').trim(); const tagBtn = '<button type="button" class="card-tag-btn' + (tag ? '' : ' untagged') + '" data-tag-project="' + project.id + '">' + (tag ? escapeHtml(tag) : '＋ 收藏夹') + '</button>'; return '<div class="project-card" role="button" tabindex="0" data-project-id="' + project.id + '"><div class="project-card-top"><span class="tag">' + escapeHtml(scenario.name) + '</span><small>' + formatDate(project.updated_at) + '</small></div><h3>' + escapeHtml(project.name) + '</h3><p>' + escapeHtml(project.description || project.client_name || scenario.name) + '</p>' + progressHtml + '<div class="meta">' + tagBtn + '<span>' + project.document_count + ' 份素材</span><span>' + (project.verification_mode === 'source_only' ? '无需核验' : project.task_count + ' 项核验') + '</span><span>' + project.target_duration + ' 分钟</span></div></div>'; }).join('');
  $$('.project-card', list).forEach(card => {
    card.addEventListener('click', () => openProject(card.dataset.projectId));
    card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openProject(card.dataset.projectId); } });
  });
  $$('.card-tag-btn', list).forEach(button => button.addEventListener('click', event => { event.stopPropagation(); openCollectionDialog(button.dataset.tagProject); }));
}
async function loadDemoProject(event) {
  const button = event.currentTarget;
  try {
    setBusy(button, true, '正在准备示例…');
    const result = await request('/api/demo-project', {method:'POST'});
    await loadProjects();
    await openProject(result.project_id);
    showMessage(result.created ? '完整示例已加载。可按上方步骤依次查看素材、结构、ChatGPT 协作、音频与导出。' : '已打开现有示例项目。');
  } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); }
}

async function openProject(projectId) {
  try {
    appState.selectedProjectId = projectId;
    appState.selectedProject = await request('/api/projects/' + projectId);
    appState.selectedDocument = null;
    appState.activePlan = appState.selectedProject.plans[0] || null;
    $('#project-detail').classList.remove('hidden');
    document.body.classList.add('in-project', 'in-shelf');
    renderProjectDetail();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) { showMessage(error.message, true); }
}

function closeProject() {
  appState.selectedProjectId = null; appState.selectedProject = null; appState.selectedDocument = null; appState.activePlan = null;
  $('#project-detail').classList.add('hidden'); $('#project-detail').innerHTML = '';
  document.body.classList.remove('in-project');
  document.body.classList.add('in-shelf');
  renderProjectList();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showShelf(openDialog = false) {
  document.body.classList.remove('in-project');
  document.body.classList.add('in-shelf');
  $('#project-detail').classList.add('hidden');
  appState.selectedProjectId = null; appState.selectedProject = null; appState.selectedDocument = null;
  renderProjectList();
  window.scrollTo({ top: 0 });
  if (openDialog) $('#project-dialog')?.showModal();
}

function goHome() {
  document.body.classList.remove('in-shelf', 'in-project');
  $('#project-detail').classList.add('hidden');
  window.scrollTo({ top: 0 });
}

function projectStepState(data) {
  const narratives = data.narrative_contents || [];
  const tasks = data.tasks || [];
  const openTasks = tasks.filter(item => !['done', 'dismissed'].includes(item.status)).length;
  const hasStructure = (data.narrative_outlines || []).some(item => item.status === 'confirmed');
  const needsExternalVerification = data.project.verification_mode === 'external_verify';
  const hasVerificationStep = data.project.verification_mode !== 'source_only';
  const verificationReady = !needsExternalVerification || (tasks.length > 0 && openTasks === 0);
  const confirmed = narratives.some(item => item.status === 'confirmed');
  const hasAudio = (data.audio_outputs || []).length > 0;
  const hasDocument = data.documents.length > 0;
  return {
    hasDocument, hasStructure, needsExternalVerification, verificationReady, confirmed, hasAudio, openTasks,
    materials: hasDocument ? 'done' : 'current',
    structure: !hasDocument ? '' : hasStructure ? 'done' : 'current',
    verification: !hasVerificationStep ? '' : !hasStructure ? '' : openTasks ? 'current' : 'done',
    narrative: !hasStructure || !verificationReady ? '' : confirmed ? 'done' : 'current',
    audio: !data.project.audio_enabled ? '' : confirmed ? (hasAudio ? 'done' : 'current') : '',
  };
}

function renderWorkflowHint(data, state) {
  const narratives = data.narrative_contents || [];
  const next = !state.hasDocument ? ['materials', '导入第一份素材']
    : !state.hasStructure ? ['structure', '确认写作大纲']
    : !state.verificationReady ? ['tasks', '完成发布前核验']
    : !narratives.length ? ['narrative', '生成讲稿']
    : !state.confirmed ? ['narrative', '确认讲稿审阅']
    : data.project.audio_enabled && !state.hasAudio ? ['audio', '整理音频脚本']
    : ['narrative', '查看已完成成果'];
  const gate = state.needsExternalVerification && !state.verificationReady;
  return '<div class="workflow-next"><div><b>下一步：' + next[1] + '</b>' + (gate ? '<small>对外讲稿会在全部核验项完成或关闭后解锁。</small>' : '') + '</div><button class="button button-primary button-small" data-workflow-next="' + next[0] + '">继续</button></div>';
}

function renderProjectDetail() {
  const detail = $('#project-detail'); const data = appState.selectedProject; if (!data) return;
  document.body.classList.add('in-project');
  const scenario = SCENARIOS[data.project.scenario] || SCENARIOS.topic_learning;
  const verificationStep = data.project.verification_mode === 'source_only' ? 0 : 3;
  const narrativeStep = verificationStep ? 4 : 3;
  const audioStep = narrativeStep + 1;
  const state = projectStepState(data);
  const tabs = [['materials', '1 素材', state.materials], ['structure', '2 大纲', state.structure]];
  if (verificationStep) tabs.push(['tasks', verificationStep + ' ' + (data.project.verification_mode === 'external_verify' ? '核验与来源' : '表述核对'), state.verification]);
  tabs.push(['narrative', narrativeStep + ' ' + scenario.narrativeLabel, state.narrative]);
  if (data.project.audio_enabled) tabs.push(['audio', audioStep + ' 音频与导出', state.audio]);
  if (!tabs.some(item => item[0] === appState.activeTab)) appState.activeTab = 'materials';
  const tabHtml = tabs.map(([key, label, status]) =>
    '<button data-tab="' + key + '" class="' + (appState.activeTab === key ? 'active ' : '') + (status || '') + '"' + (status === 'current' ? ' aria-current="step"' : '') + '>' +
    '<span class="step-mark">' + (status === 'done' ? '✓' : status === 'current' ? '●' : '○') + '</span>' + label + '</button>'
  ).join('');
  detail.innerHTML = '<div class="detail-header"><div><p class="eyebrow">' + escapeHtml(scenario.name) + '</p><h2>' + escapeHtml(data.project.name) + '</h2><p>' + escapeHtml(data.project.client_name || data.project.description || scenario.description) + '</p><div class="task-preferences"><button type="button" class="tag-edit-btn" id="edit-collection" title="归类到某个收藏夹">🏷 ' + ((data.project.collection || '').trim() ? escapeHtml(data.project.collection.trim()) : '未归类 · 点此归类') + '</button><span>' + TRANSFORM_NAMES[data.project.transform_mode] + '</span><span>' + VERIFICATION_NAMES[data.project.verification_mode] + '</span><span>' + data.project.target_duration + ' 分钟目标时长</span></div></div><div class="detail-actions"><button class="button button-outline button-small" id="back-to-projects">← 全部项目</button><button class="button button-outline button-small" id="export-project">导出至本机目录</button><button class="button button-outline button-small" id="reload-project">刷新任务</button><button class="button button-danger button-small" id="delete-project">删除任务</button></div></div>' + '<div class="tabbar">' + tabHtml + '</div>' + renderWorkflowHint(data, state) + '<div id="detail-panel" class="detail-panel"></div>';
  $('#edit-collection')?.addEventListener('click', () => openCollectionDialog(data.project.id));
  $$('.tabbar button', detail).forEach(button => button.addEventListener('click', () => { appState.activeTab = button.dataset.tab; renderProjectDetail(); }));
  $$('[data-workflow-next]', detail).forEach(button => button.addEventListener('click', () => { appState.activeTab = button.dataset.workflowNext; renderProjectDetail(); $('#detail-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  $('#reload-project').addEventListener('click', () => openProject(data.project.id)); $('#back-to-projects').addEventListener('click', closeProject); $('#export-project').addEventListener('click', exportProject); $('#delete-project').addEventListener('click', deleteProject); renderActivePanel();
}
let collectionDialogProjectId = null;

function openCollectionDialog(projectId) {
  const project = appState.projects.find(item => item.id === projectId) || (appState.selectedProject?.project?.id === projectId ? appState.selectedProject.project : null);
  if (project === null) return;
  collectionDialogProjectId = projectId;
  const current = (project.collection || '').trim();
  const existing = [...new Set(appState.projects.map(item => (item.collection || '').trim()).filter(Boolean))];
  $('#collection-dialog-target').textContent = '「' + project.name + '」' + (current ? '当前在「' + current + '」' : '还没有归类');
  const list = $('#collection-chip-list');
  list.innerHTML = existing.length ? existing.map((name, index) => '<button type="button" class="collection-chip' + (name === current ? ' active' : '') + '" data-collection-index="' + index + '">' + escapeHtml(name) + '</button>').join('') : '<p class="form-note">还没有任何收藏夹，直接在下面输入一个名字。</p>';
  const form = $('#collection-form');
  $$('.collection-chip', list).forEach(chip => chip.addEventListener('click', () => {
    const name = existing[Number(chip.dataset.collectionIndex)];
    form.elements.collection.value = form.elements.collection.value.trim() === name ? '' : name;
    $$('.collection-chip', list).forEach(item => item.classList.toggle('active', item === chip && form.elements.collection.value.trim() === name));
  }));
  $('#collection-options').innerHTML = existing.map(name => '<option value="' + escapeHtml(name) + '"></option>').join('');
  form.elements.collection.value = current;
  $('#collection-remove').hidden = !current;
  $('#collection-dialog').showModal();
}

async function saveProjectCollection(projectId, value) {
  try {
    const updated = await request('/api/projects/' + projectId + '/collection', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collection: value }) });
    $('#collection-dialog').close();
    if (appState.selectedProject?.project?.id === projectId) appState.selectedProject.project = updated;
    await loadProjects();
    if (appState.selectedProject?.project?.id === projectId) renderProjectDetail();
    showMessage(value ? '已归入「' + value + '」。' : '已从收藏夹移出。');
  } catch (error) { showMessage(error.message, true); }
}

function renderActivePanel() { if (appState.activeTab === 'materials') return renderMaterialsPanel(); if (appState.activeTab === 'structure') return renderStructurePanel(); if (appState.activeTab === 'review') return renderReviewPanel(); if (appState.activeTab === 'narrative') return renderNarrativeOutputPanel(); if (appState.activeTab === 'audio') return renderAudioPanel(); return renderTasksPanel(); }
function currentDocument() { const docs = appState.selectedProject.documents; return appState.selectedDocument || docs[0] || null; }
async function ensureDocumentLoaded(documentId) { if (appState.selectedDocument?.id === documentId && appState.selectedDocument.blocks) return appState.selectedDocument; appState.selectedDocument = await request('/api/documents/' + documentId); return appState.selectedDocument; }

function renderMaterialsPanel() {
  const panel = $('#detail-panel'); const docs = appState.selectedProject.documents;
  const learning = appState.selectedProject.project.scenario === 'topic_learning';
  const intro = appState.selectedProject.project.scenario === 'daily_brief'
    ? '导入一篇行业资讯、报道或公开材料，系统会将其精炼为适合碎片化收听的短讲稿。'
    : '导入已有材料，或按主题检索公开网页后逐条确认导入。生成时可明确选择原始材料和补充公开来源；未选中的检索结果不会进入讲稿。';
  const searchPanel = learning ? '<section class="panel-card web-search-panel"><div><p class="eyebrow">可选步骤</p><h3>按主题检索公开材料</h3><p>仅用于发现公开网页。先查看标题、摘要和链接，再选择要导入的来源；它不等同于外部事实核验。</p></div><div class="web-search-form"><input id="web-search-query" value="' + escapeHtml(appState.selectedProject.project.client_name || appState.selectedProject.project.name) + '" placeholder="例如：生成式人工智能 数据合规 监管动态"/><button class="button button-outline button-small" id="search-web-sources">检索公开材料</button></div><div id="web-search-results" class="web-search-results"></div></section>' : '';
  panel.innerHTML = '<section class="panel-card"><h3>输入素材</h3><p>' + intro + '</p><div class="source-input-grid"><label class="upload-zone"><input type="file" id="document-upload" accept=".docx,.txt,.md"/><div><b>上传文件</b><span>DOCX、TXT、Markdown</span></div></label><div class="paste-source"><b>粘贴文章或公开材料</b><input id="text-source-title" placeholder="素材标题，例如：某监管动态解读"/><input id="text-source-url" placeholder="来源链接（可选）"/><textarea id="text-source-content" placeholder="粘贴公众号正文、新闻报道、公开判决摘要或你的实务笔记…"></textarea><button class="button button-outline button-small" id="create-text-source">保存为素材</button></div></div><div class="doc-list">' + (docs.length ? docs.map(doc => '<div class="doc-row"><div><b>' + escapeHtml(doc.original_name) + '</b><small>' + doc.paragraph_count + ' 个段落 · ' + doc.block_count + ' 个素材块' + (doc.source_url ? ' · 已记录来源' : '') + '</small></div><button class="button button-outline button-small" data-view-document="' + doc.id + '">查看主题地图</button></div>').join('') : '<p class="form-note">尚未导入素材。你可以先导入一篇资讯或一份实务笔记开始。</p>') + '</div></section>' + searchPanel + '<section class="panel-card" id="material-map-panel"><h3>主题地图</h3><p>选择一份已导入素材后，查看结构、主题信号、规范名称和可展开的内容方向。</p></section>';
  $('#document-upload').addEventListener('change', event => uploadDocument(event.target.files[0]));
  $('#create-text-source').addEventListener('click', createTextSource);
  $('#search-web-sources')?.addEventListener('click', searchWebSources);
  $$('[data-view-document]', panel).forEach(button => button.addEventListener('click', () => viewDocumentMap(button.dataset.viewDocument)));
  const doc = currentDocument(); if (doc) viewDocumentMap(doc.id);
}

async function uploadDocument(file) {
  if (!file) return; const upload = $('#document-upload');
  try { setBusy(upload, true, ''); showMessage('正在解析“' + file.name + '”，请稍候…'); const form = new FormData(); form.append('file', file); const result = await request('/api/projects/' + appState.selectedProject.project.id + '/documents', { method: 'POST', body: form }); appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id); appState.selectedDocument = { ...result, blocks: null }; await loadProjects(); renderProjectDetail(); await viewDocumentMap(result.id); showMessage('已完成解析：' + result.paragraph_count + ' 个段落、' + result.block_count + ' 个材料块。'); } catch (error) { showMessage(error.message, true); } finally { if (upload) upload.disabled = false; }
}

async function createTextSource() {
  const button = $('#create-text-source');
  const title = $('#text-source-title').value.trim();
  const content = $('#text-source-content').value.trim();
  if (!title || content.length < 20) { showMessage('请填写素材标题，并粘贴至少 20 个字符的正文。', true); return; }
  try { setBusy(button, true, '保存中…'); const result = await request('/api/projects/' + appState.selectedProject.project.id + '/text-sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, content, source_url: $('#text-source-url').value.trim() }) }); appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id); appState.selectedDocument = { ...result, blocks: null }; await loadProjects(); renderProjectDetail(); await viewDocumentMap(result.id); showMessage('文字素材已保存并完成结构解析。'); } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); }
}

async function searchWebSources() {
  const button = $('#search-web-sources'); const query = $('#web-search-query').value.trim(); const box = $('#web-search-results');
  if (query.length < 2) { showMessage('请输入至少两个字符的学习主题。', true); return; }
  try {
    setBusy(button, true, '检索中…'); box.innerHTML = '<p class="form-note">正在检索公开网页…</p>';
    const data = await request('/api/web-search', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({query, max_results:6})});
    if (!data.results.length) { box.innerHTML = '<p class="form-note">没有找到可导入的公开结果。请更换关键词或手动粘贴材料。</p>'; return; }
    box.innerHTML = '<p class="field-hint">' + escapeHtml(data.notice) + '</p>' + data.results.map((item, index) => '<article class="web-result"><div><b>' + escapeHtml(item.title) + '</b><a href="' + escapeHtml(item.url) + '" target="_blank" rel="noreferrer">查看原文</a><p>' + escapeHtml(item.summary || '未提供摘要。') + '</p></div><button class="button button-outline button-small" data-import-web-result="' + index + '">导入为素材</button></article>').join('');
    $$('[data-import-web-result]', box).forEach(button => button.addEventListener('click', () => importWebSource(data.results[Number(button.dataset.importWebResult)], button)));
  } catch (error) { box.innerHTML = ''; showMessage(readableError(error), true); } finally { setBusy(button, false); }
}

async function importWebSource(item, button) {
  try {
    setBusy(button, true, '读取网页…');
    const result = await request('/api/projects/' + appState.selectedProject.project.id + '/web-sources', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({title:item.title, url:item.url})});
    appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id); appState.selectedDocument = {...result, blocks:null};
    await loadProjects(); renderProjectDetail(); await viewDocumentMap(result.id);
    showMessage('已导入公开网页并记录来源链接。请在主题地图中确认材料范围。');
  } catch (error) { showMessage(readableError(error), true); } finally { setBusy(button, false); }
}

async function viewDocumentMap(documentId) {
  const box = $('#material-map-panel'); if (!box) return;
  try {
    box.innerHTML = '<h3>材料地图</h3><p>正在读取材料结构…</p>'; const doc = await ensureDocumentLoaded(documentId); const map = doc.material_map;
    const outline = map.outline.slice(0,14).map(item => '<button class="outline-item level-' + item.level + '" data-block-id="' + item.id + '">' + escapeHtml(item.title) + '</button>').join('');
    const topics = map.topics.map(item => '<span class="signal">' + escapeHtml(item.name) + ' · ' + item.mentions + '</span>').join('') || '<span class="signal">暂未识别</span>';
    const regs = map.regulations.slice(0,6).map(item => '<span class="signal">' + escapeHtml(item) + '</span>').join('') || '<span class="signal">暂未识别</span>';
    const risks = map.risk_candidates.slice(0,4).map(item => '<button class="risk-candidate" data-block-id="' + item.block_id + '"><small>' + escapeHtml(item.locator) + '</small>' + escapeHtml(item.excerpt) + '</button>').join('') || '<p class="form-note">当前未找到明显候选项。仍建议由律师结合项目背景审阅全文。</p>';
    box.innerHTML = '<h3>材料地图：' + escapeHtml(doc.original_name) + '</h3><p>' + escapeHtml(map.summary) + '</p><details class="material-map-details"><summary>查看结构导航、主题信号与核验候选</summary><div class="map-grid"><div><h4>结构导航</h4><div class="outline-list">' + outline + '</div></div><div><h4>关注信号</h4><div class="signal-list">' + topics + '</div><h4>识别到的规范名称</h4><div class="signal-list">' + regs + '</div></div></div><h4>待核验候选项</h4><div>' + risks + '</div></details>';
    $$('[data-block-id]', box).forEach(button => button.addEventListener('click', () => showSourceBlock(doc.id, button.dataset.blockId)));
  } catch (error) { box.innerHTML = '<h3>材料地图</h3><p class="message error">' + escapeHtml(error.message) + '</p>'; }
}

async function showSourceBlock(documentId, blockId) { try { const block = await request('/api/documents/' + documentId + '/blocks/' + blockId); showSourceOverlay('材料块依据', '<h4>' + escapeHtml(block.source_locator) + '</h4><pre>' + escapeHtml(block.text) + '</pre>'); } catch (error) { showMessage(error.message, true); } }

function formatChapterQuestion(chapter) {
  const q = (chapter.question || '').trim();
  const legacyDefaults = ['这一部分对目标读者意味着什么', '核心事实如何界定？涉及哪些合规差距'];
  if (!q || legacyDefaults.some(marker => q.includes(marker))) return '围绕本章的关键事实、规则边界与落地要求展开，并标注需先核实的内容。';
  return q;
}
function renderChapters(chapters) {
  return chapters.map(chapter => '<div class="chapter-row ' + (chapter.enabled === false ? 'disabled' : '') + '" data-chapter-id="' + escapeHtml(chapter.id) + '" data-source-blocks="' + escapeHtml(JSON.stringify(chapter.source_block_ids)) + '"><input class="chapter-enabled" type="checkbox" ' + (chapter.enabled !== false ? 'checked' : '') + '/><div><input class="chapter-title" type="text" value="' + escapeHtml(chapter.title) + '"/><small>' + escapeHtml(formatChapterQuestion(chapter)) + '</small><span class="source-count">' + chapter.source_block_ids.length + ' 个材料块</span></div><div class="chapter-row-actions"><button class="button button-outline button-small chapter-up" type="button" title="上移章节">↑</button><button class="button button-outline button-small chapter-down" type="button" title="下移章节">↓</button><button class="button button-outline button-small chapter-preview" type="button">查看依据</button></div></div>').join('');
}
function bindChapterControls() {
  $$('.chapter-enabled').forEach(input => input.addEventListener('change', () => input.closest('.chapter-row').classList.toggle('disabled', !input.checked)));
  $$('.chapter-up, .chapter-down').forEach(button => button.addEventListener('click', () => {
    const row = button.closest('.chapter-row');
    if (button.classList.contains('chapter-up') && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
    if (button.classList.contains('chapter-down') && row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
  }));
  $$('.chapter-preview').forEach(button => button.addEventListener('click', async () => {
    const row = button.closest('.chapter-row');
    const doc = await ensureDocumentLoaded($('#plan-document').value);
    const ids = JSON.parse(row.dataset.sourceBlocks);
    const blocks = doc.blocks.filter(block => ids.includes(block.id)).slice(0, 10);
    showSourceOverlay('章节依据预览', blocks.map(block => '<h4>' + escapeHtml(block.source_locator) + '</h4><pre>' + escapeHtml(block.text) + '</pre>').join(''));
  }));
}

async function loadPlanHeadings() {
  const selector = $('#plan-heading-selector');
  const documentId = $('#plan-document')?.value;
  if (!selector || !documentId) return;
  selector.innerHTML = '<p class="form-note">正在读取文档目录…</p>';
  try {
    const doc = await ensureDocumentLoaded(documentId);
    if ($('#plan-document')?.value !== documentId || !selector.isConnected) return;
    const blocks = doc.blocks || [];
    const headings = blocks.filter(block => block.kind === 'heading').map(heading => {
      const end = blocks.find(block => block.kind === 'heading' && block.sequence_no > heading.sequence_no && block.heading_level <= heading.heading_level)?.sequence_no || Infinity;
      const scoped = blocks.filter(block => block.sequence_no >= heading.sequence_no && block.sequence_no < end);
      const paragraphs = scoped.filter(block => block.kind === 'paragraph');
      return { ...heading, paragraphCount: paragraphs.length, charCount: scoped.reduce((sum, block) => sum + (block.text || '').length, 0) };
    }).filter(heading => heading.paragraphCount >= 2);
    if (!headings.length) {
      selector.innerHTML = '<p class="form-note">这份材料没有可识别的正文目录；短材料可直接建立结构，长材料请先整理标题层级。</p>';
      return;
    }
    selector.innerHTML = '<label for="plan-heading-search">从目录中勾选要学习的章节（最多 8 个）</label><input id="plan-heading-search" type="search" placeholder="输入标题关键词筛选"/><p class="form-note">没有正文的条目已自动排除；过长章节建议改选其下级标题。</p><div class="heading-candidate-list">' + headings.map(heading => '<label class="heading-candidate" data-heading-title="' + escapeHtml(heading.text.toLowerCase()) + '" style="margin-left:' + Math.min((heading.heading_level - 1) * 18, 54) + 'px"><input type="checkbox" name="plan-heading" value="' + escapeHtml(heading.id) + '"/><span class="heading-candidate-title">' + escapeHtml(heading.text) + '</span><small>' + heading.paragraphCount + ' 段 · 约 ' + heading.charCount.toLocaleString() + ' 字' + (heading.charCount > 18000 ? ' · 建议选下级标题' : '') + '</small></label>').join('') + '</div><div class="plan-actions"><button class="button button-primary button-small" id="create-learning-plan">用所选章节建立结构</button></div>';
    $('#plan-heading-search').addEventListener('input', event => {
      const query = event.target.value.trim().toLowerCase();
      $$('.heading-candidate', selector).forEach(item => { item.hidden = !!query && !item.dataset.headingTitle.includes(query); });
    });
    $$('input[name="plan-heading"]', selector).forEach(input => input.addEventListener('change', () => {
      if ($$('input[name="plan-heading"]:checked', selector).length > 8) {
        input.checked = false;
        showMessage('最多选择 8 个目录章节。', true);
      }
    }));
  } catch (error) {
    selector.innerHTML = '<p class="message error">' + escapeHtml(error.message) + '</p>';
  }
}

async function createLearningPlan(options = {}) {
  const auto = !!options.auto;
  const button = auto ? $('#auto-split-plan') : $('#create-learning-plan');
  try {
    const doc = await ensureDocumentLoaded($('#plan-document').value);
    const selectedHeadingIds = auto ? [] : $$('input[name="plan-heading"]:checked').map(input => input.value);
    if (!auto && !selectedHeadingIds.length) throw new Error('请先勾选要学习的目录章节。');
    const project = appState.selectedProject.project;
    const scenario = SCENARIOS[project.scenario] || SCENARIOS.topic_learning;
    const body = { source_document_id: doc.id, selected_heading_ids: selectedHeadingIds, audience: $('#narrative-audience').value.trim() || scenario.audience, output_type: project.scenario === 'speaking_note' ? 'client_brief' : 'lexcast', style_name: '深入浅出、适合朗读', include_audio: !!project.audio_enabled, auto_split: auto, split_mode: auto ? 'ai' : 'rules' };
    setBusy(button, true, auto ? 'AI 正在阅读材料、设计章节…' : '建立中…');
    const plan = await request('/api/projects/' + project.id + '/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    appState.selectedProject = await request('/api/projects/' + project.id);
    appState.activePlan = appState.selectedProject.plans.find(item => item.id === plan.id) || plan;
    renderProjectDetail();
    showMessage(plan.split_mode === 'ai' ? 'AI 已按内容逻辑划分章节，并为每章设计了学习问题；可继续调整后确认。' : 'AI 分章不可用，已按目录规则划分章节；可调整标题和顺序，确认后生成写作大纲。');
  } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); }
}

function readChaptersFromUi() { return $$('.chapter-row').map(row => ({ id: row.dataset.chapterId, title: $('.chapter-title', row).value.trim() || '未命名章节', source_block_ids: JSON.parse(row.dataset.sourceBlocks), question: $('small', row)?.textContent || '', estimated_length: '800–1200 字', enabled: $('.chapter-enabled', row).checked })); }
async function confirmPlan() { const button = $('#confirm-plan'); try { const chapters = readChaptersFromUi(); if (!chapters.some(chapter => chapter.enabled)) throw new Error('至少选择一个要生成的章节。'); setBusy(button, true); const result = await request('/api/plans/' + appState.activePlan.id + '/confirm', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chapters }) }); appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id); appState.activePlan = appState.selectedProject.plans.find(plan => plan.id === appState.activePlan.id); renderProjectDetail(); showMessage(result.tasks_generated ? '内容结构已确认，核验清单已从所选素材中生成。请先完成关键核验，再生成对外讲稿。' : '内容结构已确认。当前为轻量学习模式，可直接进入讲稿与音频生成。'); } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); } }

function renderReviewPanel() {
  const panel = $('#detail-panel'); const plan = appState.activePlan; const contents = appState.selectedProject.contents; const canGenerate = plan?.status === 'confirmed';
  const buttons = canGenerate ? '<div class="detail-actions" id="generate-buttons">' + plan.chapters.filter(chapter => chapter.enabled !== false).map(chapter => '<button class="button button-primary button-small" data-generate-chapter="' + chapter.id + '">✨ 提炼：' + escapeHtml(chapter.title.replace(/^(决策速览：|法律简报：|法声解读：)/,'')) + '</button>').join('') + '</div>' : '<p class="form-note">请先在“章节方案”中确认范围，才能生成内容。</p>';

  const chapterNav = contents.length > 1 ? '<div class="review-nav-bar"><span class="nav-label">目录速览：</span><div class="nav-pills">' +
    contents.map((c, i) => '<a href="#content-card-' + c.id + '" class="nav-pill ' + c.status + '"><span>第' + (i + 1) + '篇</span><b>' + escapeHtml(c.title.replace(/^(决策速览：|法律简报：|法声解读：)/,'')) + '</b><small>' + statusText(c.status) + '</small></a>').join('') + '</div></div>' : '';

  panel.innerHTML = '<section class="panel-card review-intro"><h3>工作备忘录与成果审阅</h3><p>材料摘录以引用编号标出；支持直接修改正文或添加退回修改意见。未核验事项应在“待核验任务”中推进，不作为确定法律结论。</p>' + buttons + '</section>' + chapterNav + '<div class="content-list">' + (contents.length ? contents.map((c, i) => renderContentCard(c, i, contents.length)).join('') : '<section class="panel-card"><p>尚未生成内容。确认章节方案后，请逐章生成可审阅初稿。</p></section>') + '</div>';

  $$('[data-generate-chapter]').forEach(button => button.addEventListener('click', () => generateChapter(button.dataset.generateChapter, button)));
  $$('[data-citation]').forEach(button => button.addEventListener('click', () => focusCitation(button.dataset.contentId, button.dataset.claimId)));
  $$('[data-open-evidence]').forEach(button => button.addEventListener('click', () => viewClaimEvidence(button.dataset.contentId, button.dataset.claimId)));
  $$('.memo-check').forEach(item => item.addEventListener('click', () => item.classList.toggle('checked')));
  $$('[data-review-confirm]').forEach(button => button.addEventListener('click', () => reviewContent(button.dataset.reviewConfirm, 'confirmed', '律师确认：可作为经审核工作底稿使用。')));
  $$('[data-review-dialog]').forEach(button => button.addEventListener('click', () => openRevisionDialog(button.dataset.reviewDialog)));
  $$('[data-edit-content]').forEach(button => button.addEventListener('click', () => { appState.editingContentId = button.dataset.editContent; renderReviewPanel(); }));
  $$('[data-cancel-edit]').forEach(button => button.addEventListener('click', () => { appState.editingContentId = null; renderReviewPanel(); }));
  $$('[data-save-edit]').forEach(button => button.addEventListener('click', () => saveContentEdit(button.dataset.saveEdit)));
}

function renderMemo(content) {
  const inlineText = text => escapeHtml(text).replace(/\[(\d+)\]/g, (_, index) => '<button class="citation" data-citation data-content-id="' + content.id + '" data-claim-id="claim-' + index + '">[' + index + ']</button>');
  let raw = content.markdown || '';
  const meta = raw.match(/<div class="memo-meta">([\s\S]*?)<\/div>/);
  let html = '';
  if (meta) {
    const metaItems = [...meta[1].matchAll(/<span><b>(.*?)<\/b>(.*?)<\/span>/g)];
    html += '<div class="memo-meta">' + metaItems.map(item => '<span><b>' + escapeHtml(item[1]) + '</b>' + escapeHtml(item[2]) + '</span>').join('') + '</div>';
    raw = raw.replace(meta[0], '');
  }
  raw.split('\n').forEach(line => {
    const value = line.trim();
    if (!value) return;
    let match;
    if ((match = value.match(/^# (.+)$/))) html += '<h1>' + escapeHtml(match[1]) + '</h1>';
    else if ((match = value.match(/^## (.+)$/))) html += '<h2>' + escapeHtml(match[1]) + '</h2>';
    else if ((match = value.match(/^<p class="memo-footnote">(.*?)<\/p>$/))) html += '<p class="memo-footnote">' + escapeHtml(match[1]) + '</p>';
    else if ((match = value.match(/^- \[ \] (.+)$/))) html += '<div class="memo-check"><span>□</span><span>' + inlineText(match[1]) + '</span></div>';
    else if ((match = value.match(/^- (.+)$/))) html += '<div class="memo-bullet"><span>—</span><span>' + inlineText(match[1]) + '</span></div>';
    else if ((match = value.match(/^\[(\d+)\] (.+)$/))) html += '<div class="memo-source"><button class="citation" data-citation data-content-id="' + content.id + '" data-claim-id="claim-' + match[1] + '">[' + match[1] + ']</button>' + escapeHtml(match[2]) + '</div>';
    else html += '<p>' + inlineText(value) + '</p>';
  });
  return html;
}

function renderContentCard(content, index = 0, total = 1) {
  const claims = content.claims || [];
  const isEditing = appState.editingContentId === content.id;
  const revisionBanner = (content.status === 'needs_revision' && content.review_note) ?
    '<div class="revision-alert"><b>⚠️ 律师修改意见：</b><span>' + escapeHtml(content.review_note) + '</span></div>' : '';

  const mainArea = isEditing ?
    '<div class="memo-edit-container"><div class="memo-edit-header"><b>✏️ 正在编辑备忘录正文（支持 Markdown）</b><small>修改后点击下方“保存文书修改”生效</small></div><textarea class="memo-editor" id="memo-editor-' + content.id + '">' + escapeHtml(content.markdown) + '</textarea></div>' :
    '<article class="memo-document">' + revisionBanner + renderMemo(content) + '</article>';

  const actionButtons = isEditing ?
    '<button class="button button-outline button-small" data-cancel-edit="' + content.id + '">取消编辑</button><button class="button button-primary button-small" data-save-edit="' + content.id + '">保存文书修改</button>' :
    '<button class="button button-outline button-small" data-edit-content="' + content.id + '">✏️ 修改正文</button><button class="button button-outline button-small" data-review-dialog="' + content.id + '">退回修改</button><button class="button button-primary button-small" data-review-confirm="' + content.id + '">确认内容</button>';

  return '<article class="content-card" id="content-card-' + content.id + '">' +
    '<div class="content-card-header">' +
      '<div>' +
        '<p class="doc-kicker">第 ' + (index + 1) + ' 篇 / 共 ' + total + ' 篇 · 内部工作备忘录</p>' +
        '<h3>' + escapeHtml(content.title) + '</h3>' +
        '<small>生成于 ' + formatDate(content.created_at) + ' · <span class="status ' + content.status + '">' + statusText(content.status) + '</span></small>' +
      '</div>' +
      '<span class="tag">✨ 事实提取 ' + claims.length + ' 项 · 证据已锚定</span>' +
    '</div>' +
    '<div class="content-body">' +
      mainArea +
      '<aside class="evidence-panel"><h4>本节材料摘录</h4><p class="evidence-help">点击正文中的引用编号，可在此处定位材料摘录；再次点击材料定位可打开原文。</p>' +
        claims.map((claim, cIdx) => '<div class="claim" data-claim-card="' + content.id + ':' + claim.id + '"><div class="claim-top"><span class="claim-number">[' + (cIdx + 1) + ']</span><span class="status ' + claim.status + '">' + escapeHtml(claim.label) + '</span></div><p>' + escapeHtml(claim.statement) + '</p><button data-open-evidence data-content-id="' + content.id + '" data-claim-id="' + claim.id + '">' + escapeHtml(claim.evidence_locator || '查看原文') + '</button></div>').join('') +
      '</aside>' +
    '</div>' +
    '<div class="review-bar">' +
      '<span class="review-note">' + escapeHtml(content.review_note || '尚未添加审核意见。') + '</span>' +
      '<div class="review-actions">' + actionButtons + '</div>' +
    '</div>' +
  '</article>';
}

async function saveContentEdit(contentId) {
  const textarea = $('#memo-editor-' + contentId);
  if (!textarea) return;
  const newText = textarea.value.trim();
  if (!newText) { showMessage('正文内容不能为空', true); return; }
  try {
    await request('/api/contents/' + contentId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: newText, status: 'draft', review_note: '律师已于本机编辑正文' })
    });
    appState.editingContentId = null;
    appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id);
    renderProjectDetail();
    showMessage('文书正文已保存。');
  } catch (error) {
    showMessage(error.message, true);
  }
}

function openRevisionDialog(contentId) {
  const content = appState.selectedProject.contents.find(c => c.id === contentId);
  if (!content) return;
  const quickNotes = ['请核实事实表述与主体界定', '请补充明确的监管条文依据', '请细化合规差距并明确责任人', '建议调整表述口径，避免绝对化定性'];
  const modal = document.createElement('div');
  modal.className = 'source-modal';
  modal.innerHTML = '<div class="source-modal-card" style="max-width:540px;">' +
    '<div class="source-modal-top"><div><p class="eyebrow">律师审核批注</p><h3>退回修改意见</h3></div><button class="icon-button close-dialog">×</button></div>' +
    '<div style="display:grid;gap:12px;margin-top:14px;">' +
      '<p style="margin:0;font-size:13px;color:var(--ink-soft);">请记录对“<b>' + escapeHtml(content.title) + '</b>”的审核修改要求：</p>' +
      '<div class="style-preset-chips">' + quickNotes.map(n => '<button type="button" class="preset-chip quick-note-chip" data-note="' + escapeHtml(n) + '">' + escapeHtml(n) + '</button>').join('') + '</div>' +
      '<textarea id="revision-note-input" style="width:100%;height:100px;padding:10px;border:1px solid #d4cebe;border-radius:8px;font:inherit;resize:vertical;" placeholder="请输入具体的修改要求或依据建议...">' + escapeHtml(content.review_note || '') + '</textarea>' +
      '<div style="display:flex;justify-content:flex-end;gap:9px;margin-top:8px;">' +
        '<button class="button button-outline close-dialog">取消</button>' +
        '<button class="button button-primary submit-revision">确认退回</button>' +
      '</div>' +
    '</div>' +
  '</div>';
  $$('.close-dialog', modal).forEach(b => b.addEventListener('click', () => modal.remove()));
  $$('.quick-note-chip', modal).forEach(chip => chip.addEventListener('click', () => {
    const input = $('#revision-note-input', modal);
    input.value = chip.dataset.note;
  }));
  $('.submit-revision', modal).addEventListener('click', async () => {
    const note = $('#revision-note-input', modal).value.trim() || '律师审核：请结合业务事实与条文依据修改后重新提交。';
    modal.remove();
    await reviewContent(contentId, 'needs_revision', note);
  });
  document.body.appendChild(modal);
}

async function generateChapter(chapterId, button) { try { const chapter = appState.activePlan.chapters.find(item => item.id === chapterId); if (!chapter) throw new Error('未找到章节。'); setBusy(button, true, '✨ 提炼中…'); await request('/api/plans/' + appState.activePlan.id + '/contents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chapter_id: chapter.id, title: chapter.title, source_block_ids: chapter.source_block_ids, audience: appState.activePlan.audience, output_type: appState.activePlan.output_type, style_name: appState.activePlan.style_name }) }); appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id); renderProjectDetail(); showMessage('已生成可审阅初稿，并提取了待核验任务。'); } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); } }
function highlightClaim(contentId, claimId) {
  const card = $('[data-claim-card="' + contentId + ':' + claimId + '"]');
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.remove('claim-highlight');
  void card.offsetWidth;
  card.classList.add('claim-highlight');
  setTimeout(() => card.classList.remove('claim-highlight'), 1600);
}
async function focusCitation(contentId, claimId) { highlightClaim(contentId, claimId); }
async function viewClaimEvidence(contentId, claimId) { const content = appState.selectedProject.contents.find(item => item.id === contentId); const claim = content?.claims?.find(item => item.id === claimId); const doc = currentDocument(); if (!claim || !doc) return; await ensureDocumentLoaded(doc.id); const blocks = appState.selectedDocument.blocks.filter(block => claim.evidence_block_ids.includes(block.id)); showSourceOverlay(claim.label + '：材料依据', blocks.map(block => '<h4>' + escapeHtml(block.source_locator) + '</h4><pre>' + escapeHtml(block.text) + '</pre>').join('') || '<p>未找到材料块。</p>'); }
async function reviewContent(contentId, status, note = '') {
  const reviewNote = note || (status === 'confirmed' ? '律师确认：可作为经审核工作底稿使用。' : '律师审核：请补充事实基础或调整表述后重新提交。');
  try {
    await request('/api/contents/' + contentId + '/review', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, note: reviewNote })
    });
    appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id);
    renderProjectDetail();
    showMessage(status === 'confirmed' ? '内容已标记为律师确认。' : '内容已标记为退回修改。');
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function getNarrativeProfiles() {
  try { return await request('/api/narrative/profiles'); } catch (error) { showMessage(error.message, true); return []; }
}

function readingSections(markdown = '') {
  const sections = markdownSections(markdown).map(section => ({ ...section, heading: section.heading.replace(/\*\*|__|`/g, '').trim() }));
  return sections.length ? sections : [{ id: 'section-1', heading: '全文', text: markdown }];
}

function renderInlineMarkdown(text = '') {
  // 先转义 HTML，再把常见行内 Markdown 语法转为标签，避免 ** 等标记原样显示。
  let html = escapeHtml(text);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*\\])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  html = html.replace(/(^|[^_\\])__([^_\n]+)__(?!_)/g, '$1<strong>$2</strong>');
  html = html.replace(/(^|[^_\\])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  return html;
}

function renderNarrativeHtml(markdown = '', contentId = '') {
  // 卡片头部已经显示讲稿标题，正文首行的同名一级标题不再重复渲染。
  let html = /^##[ \t]+.+$/m.test(markdown) ? '' : '<span id="read-' + escapeHtml(contentId) + '-section-1"></span>';
  let skippedTitle = false;
  let lastHeading = null;
  let sectionIndex = 0;
  markdown.split('\n').forEach(line => {
    const val = line.trim();
    if (!val) return;
    let match;
    if ((match = val.match(/^# (.+)$/))) {
      if (!skippedTitle) { skippedTitle = true; return; }
      lastHeading = null;
      html += '<h1>' + renderInlineMarkdown(match[1]) + '</h1>';
      return;
    }
    if ((match = val.match(/^(#{2,3}) (.+)$/))) {
      if (match[2] === lastHeading) return;
      lastHeading = match[2];
      if (match[1] === '##') {
        sectionIndex += 1;
        html += '<h2 id="read-' + escapeHtml(contentId) + '-section-' + sectionIndex + '">' + renderInlineMarkdown(match[2]) + '</h2>';
      } else {
        html += '<h3>' + renderInlineMarkdown(match[2]) + '</h3>';
      }
      return;
    }
    lastHeading = null;
    if ((match = val.match(/^- (.+)$/))) html += '<div class="memo-bullet"><span>—</span><span>' + renderInlineMarkdown(match[1]) + '</span></div>';
    else html += '<p>' + renderInlineMarkdown(val) + '</p>';
  });
  return html;
}

function renderStructurePanel() {
  const panel = $('#detail-panel');
  const docs = appState.selectedProject.documents;
  const outlines = appState.selectedProject.narrative_outlines || [];
  const project = appState.selectedProject.project;
  const scenario = SCENARIOS[project.scenario] || SCENARIOS.topic_learning;
  if (!docs.length) {
    panel.innerHTML = '<section class="panel-card"><h3>写作大纲</h3><p>请先导入原始材料，或在“素材”中按主题发现并确认公开来源。大纲只依据你选定的材料生成。</p></section>';
    return;
  }

  const latestPlan = (appState.activePlan?.status === 'confirmed' ? appState.activePlan : null) || appState.selectedProject.plans.find(plan => plan.status === 'confirmed');
  const defaultDocId = latestPlan?.document_id || docs[0].id;
  const defaultChapter = latestPlan?.chapters?.find(chapter => chapter.enabled !== false);
  const defaultDocument = docs.find(doc => doc.id === defaultDocId) || docs[0];
  const chapterWordLimit = latestPlan ? Math.min(8000, latestPlan.chapters.filter(chapter => chapter.enabled !== false).length * 2400) : 8000;
  const defaultWords = Math.min(project.target_duration <= 5 ? Math.min(1800, project.target_duration * 240) : 3800, chapterWordLimit || 8000);
  const wordPresets = [
    ['short', '短篇 · 约 1,800 字', project.target_duration <= 5 ? Math.min(1800, project.target_duration * 240) : 1800],
    ['standard', '标准 · 约 3,800 字', 3800],
    ['deep', '深度 · 约 7,000 字', 7000],
  ];
  const scopeOptions = latestPlan?.document_id === defaultDocId
    ? '<label class="check-label"><input type="radio" name="narrative-scope" value="chapter" checked/> 沿用已确认的章节及素材范围</label><label class="check-label"><input type="radio" name="narrative-scope" value="document"/> 根据整份素材重新规划</label>'
    : '<label class="check-label"><input type="radio" name="narrative-scope" value="document" checked/> 使用整份素材（超出预算时提示拆分）</label>';
  const supplementDocs = docs.filter(doc => doc.source_url);
  const supplementOptions = supplementDocs.map(doc => '<label class="check-label"><input type="checkbox" name="narrative-supplement" value="' + doc.id + '" ' + (doc.id === defaultDocId ? 'disabled' : '') + '/><span>' + escapeHtml(doc.original_name) + ' <small>· 已登记公开链接</small></span></label>').join('');
  const currentPlan = appState.activePlan;
  const planPanel = '<section class="panel-card"><p class="eyebrow">第一步 · 划分学习章节</p><h3>把材料分成适合碎片学习的章节</h3><p>每一章会单独成稿、可单独收听，适合通勤、间隙时间逐章推进。通常按材料目录自动划分即可；目录复杂或只想学部分章节时再手动挑选。</p><div class="plan-settings"><div class="field"><label>源材料<select id="plan-document">' + docs.map(doc => '<option value="' + doc.id + '" ' + (doc.id === (currentPlan?.document_id || defaultDocId) ? 'selected' : '') + '>' + escapeHtml(doc.original_name) + '</option>').join('') + '</select></label></div></div><div class="plan-actions"><button class="button button-primary" id="auto-split-plan">自动划分章节</button><button class="button button-outline" id="toggle-heading-picker">手动挑选目录章节</button></div><div id="plan-heading-selector" class="plan-heading-selector" hidden></div>' + (currentPlan ? '<div class="plan-selected-chapters"><h4>' + (currentPlan.status === 'confirmed' ? '已确认的章节' : '待确认的章节') + '</h4><p class="form-note">可修改标题、取消不需要的章节；改动后请重新确认，并在下方重新建立写作大纲。</p><div id="chapter-list" class="chapter-list">' + renderChapters(currentPlan.chapters) + '</div>' + (function(){ const total = currentPlan.chapters.length; const enabled = currentPlan.chapters.filter(c => c.enabled).length; return '<div class="plan-confirm-bar"><div class="plan-confirm-summary"><strong>已选 ' + enabled + ' / ' + total + ' 章</strong><span>' + (enabled === total ? '保持默认即可直接确认' : '已取消的章节不会生成内容') + '</span></div><button class="button button-primary" id="confirm-plan">' + (currentPlan.status === 'confirmed' ? '保存结构调整' : '确认章节结构') + '</button></div>'; })() + '</div>' : '') + '</section>';

  panel.innerHTML = planPanel + '<section class="panel-card"><p class="eyebrow">第二步 · 生成写作大纲</p><h3>章节确认后自动生成大纲</h3>' +
    '<p class="form-note">' + (currentPlan?.status === 'confirmed' ? '已根据你确认的章节自动生成写作大纲，下方可直接检查。' : '确认上方章节后会自动生成写作大纲，通常无需手动操作。') + '</p>' +
    '<details class="outline-advanced" id="outline-advanced"><summary>生成前调整参数（可选）</summary>' +
    '<div class="narrative-form"><div class="field"><label>讲稿标题</label><input id="narrative-title" value="' + escapeHtml(defaultChapter?.title?.replace(/^第\d+章\s*·\s*/, '') || defaultDocument.original_name.replace(/\.[^.]+$/, '')) + '" /></div>' +
    '<div class="field"><label>目标听众</label><input id="narrative-audience" value="' + escapeHtml(scenario.audience) + '" /></div>' +
    '<div class="field full"><label>目标成稿字数</label><input id="narrative-target-words" type="number" min="400" max="8000" step="100" value="' + defaultWords + '"/>' +
      '<div class="style-preset-chips">' + wordPresets.map(([key, label, words]) => '<button type="button" class="preset-chip ' + (defaultWords === Math.min(words, 8000) ? 'active' : '') + '" data-set-words="' + words + '">' + label + '</button>').join('') + '</div>' +
      '<small class="field-hint" id="narrative-word-hint">用于分配每节篇幅，实际字数可能有偏差；不按字数填充空话。</small></div>' +
    '<div class="field full"><label>写作画像</label><select id="narrative-profile"><option value="">正在加载画像…</option></select><button type="button" class="button button-outline button-small" id="manage-profile">新增 / 编辑画像</button><small class="field-hint">系统只把选定素材块发送给模型；画像影响表达方式，不改变事实来源。</small></div>' +
    '<div class="field full"><label>素材范围</label><div class="narrative-scope">' + scopeOptions + '</div></div>' +
    (supplementDocs.length ? '<div class="field full"><label class="check-label"><input type="checkbox" id="narrative-web-augment" ' + (project.web_research_mode === 'augment' ? 'checked' : '') + '/> 补充使用已登记公开链接的资料</label></div><div class="field full" id="narrative-supplemental" ' + (project.web_research_mode === 'augment' ? '' : 'hidden') + '><label>补充公开资料（需逐份勾选）</label>' + supplementOptions + '<small class="field-hint">只会读取勾选资料的正文；未勾选的网页不会进入生成请求。</small></div>' : '') + '</div>' +
    '<div class="plan-actions"><button class="button button-primary" id="create-narrative-outline">用以上参数重新生成大纲</button></div>' +
    '</details>' +
    '<div class="narrative-outline-area" id="narrative-outline-area"><h3>大纲</h3><p class="form-note">尚未生成大纲。请确认已在“模型设置”中配置模型服务，并允许发送原始材料。</p><div style="margin-top:10px;"><button class="button button-outline button-small" id="open-settings-narrative">打开模型设置</button></div></div></section>';

  $('#create-narrative-outline').addEventListener('click', createNarrativeOutline);
  $('#auto-split-plan').addEventListener('click', () => createLearningPlan({ auto: true }));
  $('#toggle-heading-picker').addEventListener('click', () => {
    const selector = $('#plan-heading-selector');
    selector.hidden = !selector.hidden;
    if (!selector.hidden && !selector.dataset.loaded) { selector.dataset.loaded = '1'; loadPlanHeadings(); }
  });
  $('#plan-document').addEventListener('change', () => { loadPlanHeadings(); updateSupplementState(); });
  $('#confirm-plan')?.addEventListener('click', confirmPlan);
  if (currentPlan) bindChapterControls();
  loadPlanHeadings();
  const updateWordLimit = () => {
    const limit = $('input[name="narrative-scope"]:checked')?.value === 'chapter' ? chapterWordLimit : 8000;
    const input = $('#narrative-target-words');
    input.max = limit || 8000;
    if (Number(input.value) > Number(input.max)) input.value = input.max;
    $('#narrative-word-hint').textContent = (limit < 8000 ? '当前章节范围最多 ' + limit.toLocaleString() + ' 字；' : '') + '实际字数可能有偏差，不按字数填充空话。';
  };
  const syncWordChips = () => {
    const words = Number($('#narrative-target-words').value);
    $$('.preset-chip[data-set-words]', panel).forEach(chip => chip.classList.toggle('active', Number(chip.dataset.setWords) === words));
  };
  $$('input[name="narrative-scope"]').forEach(input => input.addEventListener('change', () => { updateWordLimit(); syncWordChips(); }));
  $$('.preset-chip[data-set-words]', panel).forEach(chip => chip.addEventListener('click', () => {
    $('#narrative-target-words').value = Math.min(Number(chip.dataset.setWords), Number($('#narrative-target-words').max));
    syncWordChips();
  }));
  $('#narrative-target-words').addEventListener('input', syncWordChips);
  $('#narrative-web-augment')?.addEventListener('change', event => { $('#narrative-supplemental').hidden = !event.target.checked; });
  const updateSupplementState = () => {
    const documentId = $('#plan-document').value;
    $$('input[name="narrative-supplement"]').forEach(input => { input.disabled = input.value === documentId; if (input.disabled) input.checked = false; });
  };
  updateWordLimit();
  updateSupplementState();
  $('#open-settings-narrative')?.addEventListener('click', () => $('#open-settings').click());
  if (outlines.length) renderNarrativeOutline(outlines[0]);
  if (currentPlan?.status === 'confirmed') maybeAutoCreateOutline();
  loadProfileOptions();
  $('#manage-profile').addEventListener('click', openProfileEditor);
}

function renderNarrativeOutputPanel() {
  const panel = $('#detail-panel');
  const docs = appState.selectedProject.documents;
  const outlines = appState.selectedProject.narrative_outlines || [];
  const contents = appState.selectedProject.narrative_contents || [];
  const project = appState.selectedProject.project;
  const scenario = SCENARIOS[project.scenario] || SCENARIOS.topic_learning;
  const tasks = appState.selectedProject.tasks || [];
  const confirmedOutline = outlines.find(outline => outline.status === 'confirmed');
  if (!docs.length) {
    panel.innerHTML = '<section class="panel-card"><h3>' + scenario.narrativeLabel + '</h3><p>请先导入素材，并在“大纲”中确认写作结构。</p></section>';
    return;
  }
  if (project.verification_mode === 'external_verify' && (!tasks.length || tasks.some(task => !['done', 'dismissed'].includes(task.status)))) {
    panel.innerHTML = '<section class="panel-card workflow-gate"><p class="eyebrow">发布前闸门</p><h3>先完成核验，再生成对外讲稿</h3><p>当前仍有 ' + tasks.filter(task => !['done', 'dismissed'].includes(task.status)).length + ' 项核验事项待处理。完成或关闭全部事项后，才能生成 ' + escapeHtml(scenario.narrativeLabel) + '，避免未确认内容进入对外表达。</p><div class="plan-actions"><button class="button button-primary" data-open-tab="tasks">进入核验与来源</button></div></section>';
    $('[data-open-tab="tasks"]', panel).addEventListener('click', () => { appState.activeTab = 'tasks'; renderProjectDetail(); });
    return;
  }
  if (!confirmedOutline) {
    panel.innerHTML = '<section class="panel-card workflow-gate"><p class="eyebrow">写作前置条件</p><h3>先确认大纲</h3><p>大纲决定章节顺序、材料范围和每节要回答的问题。确认后这里会显示“生成' + escapeHtml(scenario.narrativeLabel) + '”按钮。</p><div class="plan-actions"><button class="button button-primary" data-open-tab="structure">去确认大纲</button></div></section>' +
      '<details class="panel-card optional-path"><summary>也可以让 ChatGPT 写稿，再粘贴回本地审阅</summary><div class="optional-path-body"><p>无需 OpenAI API Key。声息只复制当前材料块与写作要求；你在 ChatGPT App 生成 Markdown 后，粘贴回本地即可。</p><div class="handoff-actions"><button class="button button-outline" id="copy-chatgpt-prompt">复制给 ChatGPT</button><button class="button button-primary" id="open-chatgpt-import">粘贴 ChatGPT 成稿</button></div></div></details>';
    $('[data-open-tab="structure"]', panel).addEventListener('click', () => { appState.activeTab = 'structure'; renderProjectDetail(); });
    $('#copy-chatgpt-prompt').addEventListener('click', copyChatGPTPrompt);
    $('#open-chatgpt-import').addEventListener('click', openChatGPTImport);
    return;
  }

  const learningStats = (() => { let total = 0, done = 0; contents.forEach(content => { const reading = readingSections(content.markdown || ''); total += reading.length; const completed = new Set((content.reading_progress || {}).completed_section_ids || []); reading.forEach(section => { if (completed.has(section.id)) done += 1; }); }); return { total, done }; })();
  const learningSummary = learningStats.total ? '<p class="form-note">碎片学习进度：已学 ' + learningStats.done + ' / ' + learningStats.total + ' 节' + (learningStats.done < learningStats.total ? '，从上次停下的地方继续即可。' : '，全部完成。') + '</p>' : '';

  panel.innerHTML = (contents.length ? '' : '<section class="panel-card"><h3>生成' + scenario.narrativeLabel + '</h3><p>大纲已确认。生成后可整篇阅读、逐节重写、人工修改并导出 DOCX。</p><p class="form-note" id="generation-status">点击下方按钮开始逐节写作；写作过程中这里会显示当前进度。</p><div class="plan-actions"><button class="button button-primary" data-generate-from-outline="' + confirmedOutline.id + '">逐节生成' + escapeHtml(scenario.narrativeLabel) + '</button></div></section>') +
    '<section class="panel-card"><h3>已生成的' + scenario.narrativeLabel + '</h3>' + learningSummary + '<div class="narrative-content-list">' + (contents.length ? contents.map(renderNarrativeContentCard).join('') : '<p class="form-note">尚未生成讲稿。</p>') + '</div></section>' +
    '<details class="panel-card optional-path"><summary>也可以让 ChatGPT 写稿，再粘贴回本地审阅</summary><div class="optional-path-body"><p>无需 OpenAI API Key。声息只复制当前材料块与写作要求；你在 ChatGPT App 生成 Markdown 后，粘贴回本地即可。</p><div class="handoff-actions"><button class="button button-outline" id="copy-chatgpt-prompt">复制给 ChatGPT</button><button class="button button-primary" id="open-chatgpt-import">粘贴 ChatGPT 成稿</button></div></div></details>';

  $('[data-generate-from-outline]')?.addEventListener('click', event => generateNarrative(confirmedOutline.id, event.currentTarget));
  $('#copy-chatgpt-prompt').addEventListener('click', copyChatGPTPrompt);
  $('#open-chatgpt-import').addEventListener('click', openChatGPTImport);
  bindNarrativeContentEvents();
}

function selectedNarrativeSourceIds(documentId) {
  const doc = appState.selectedDocument?.id === documentId ? appState.selectedDocument : null;
  const scopedPlan = appState.activePlan?.status === 'confirmed' ? appState.activePlan : appState.selectedProject.plans.find(plan => plan.status === 'confirmed');
  const scope = $('input[name="narrative-scope"]:checked')?.value || (scopedPlan?.document_id === documentId ? 'chapter' : 'document');
  if (scope === 'chapter' && scopedPlan?.document_id === documentId) {
    return [...new Set((scopedPlan.chapters || []).filter(chapter => chapter.enabled !== false).flatMap(chapter => chapter.source_block_ids || []))];
  }
  return doc?.blocks?.filter(block => block.kind === 'paragraph').map(block => block.id) || [];
}

async function getChatGPTHandoff() {
  const scopedPlan = appState.activePlan?.status === 'confirmed' ? appState.activePlan : appState.selectedProject.plans.find(plan => plan.status === 'confirmed');
  const documentId = $('#plan-document')?.value || scopedPlan?.document_id || appState.selectedProject.documents[0]?.id;
  if (!documentId) throw new Error('请先导入素材。');
  const doc = await ensureDocumentLoaded(documentId);
  const sourceBlockIds = selectedNarrativeSourceIds(documentId).length ? selectedNarrativeSourceIds(documentId) : doc.blocks.filter(block => block.kind === 'paragraph').map(block => block.id);
  if (!sourceBlockIds.length) throw new Error('当前范围内没有可交给 ChatGPT 的正文材料。');
  const title = $('#narrative-title')?.value.trim() || appState.selectedProject.narrative_outlines?.[0]?.title || doc.original_name;
  return request('/api/projects/' + appState.selectedProject.project.id + '/chatgpt-handoff', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({document_id:documentId, title, audience:$('#narrative-audience')?.value.trim() || SCENARIOS[appState.selectedProject.project.scenario]?.audience || '法律从业者', style_profile:$('#narrative-profile')?.value || appState.profiles?.[0]?.id || '', source_block_ids:sourceBlockIds}),
  });
}

async function copyChatGPTPrompt(event) {
  const button = event.currentTarget;
  try {
    setBusy(button, true, '整理材料包…');
    const handoff = await getChatGPTHandoff();
    await navigator.clipboard.writeText(handoff.prompt);
    showMessage('已复制材料包。切换到 ChatGPT App 粘贴并生成 Markdown，然后回到这里导入。');
  } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); }
}

async function openChatGPTImport() {
  try {
    const handoff = await getChatGPTHandoff();
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog chatgpt-import-dialog';
    dialog.innerHTML = '<form><div class="dialog-header"><h2>导入 ChatGPT 成稿</h2><button type="button" class="icon-button" data-close>×</button></div><p class="form-note">仅粘贴基于刚才材料包生成的 Markdown。导入后仍会进入“待律师审核”。</p><label>讲稿标题<input id="chatgpt-import-title" value="' + escapeHtml(handoff.title) + '" /></label><label>Markdown 成稿<textarea id="chatgpt-import-markdown" required minlength="20" placeholder="粘贴 ChatGPT 返回的 Markdown 正文…"></textarea></label><div class="dialog-actions"><button type="button" class="button button-outline" data-close>取消</button><button type="submit" class="button button-primary">导入并审阅</button></div></form>';
    document.body.appendChild(dialog); dialog.showModal();
    $$('[data-close]', dialog).forEach(button => button.addEventListener('click', () => dialog.close()));
    $('form', dialog).addEventListener('submit', async event => {
      event.preventDefault(); const submit = $('button[type="submit"]', dialog);
      try {
        setBusy(submit, true, '导入中…');
        await request('/api/projects/' + appState.selectedProject.project.id + '/skill-host-contents', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({document_id:handoff.document_id, title:$('#chatgpt-import-title', dialog).value.trim() || handoff.title, markdown:$('#chatgpt-import-markdown', dialog).value.trim(), source_block_ids:handoff.source_block_ids, style_profile:$('#narrative-profile').value || appState.profiles?.[0]?.id || '', review_note:'由 ChatGPT App 生成，待律师审核。'})});
        dialog.close(); appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id); renderProjectDetail(); showMessage('ChatGPT 成稿已导入，现可在本地审阅、生成音频脚本和导出。');
      } catch (error) { showMessage(error.message, true); } finally { setBusy(submit, false); }
    });
  } catch (error) { showMessage(error.message, true); }
}

function bindNarrativeContentEvents() {
  $$('[data-confirm-narrative]').forEach(button => button.addEventListener('click', () => confirmNarrativeContent(button.dataset.confirmNarrative, button)));
  $$('[data-toggle-narrative-view]').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.toggleNarrativeView;
    appState.narrativeEditing = appState.narrativeEditing || {};
    appState.narrativeEditing[id] = !appState.narrativeEditing[id];
    renderNarrativeOutputPanel();
  }));
  $$('[data-export-narrative]').forEach(button => button.addEventListener('click', () => exportNarrative(button.dataset.exportNarrative, button)));
  $$('[data-save-narrative]').forEach(button => button.addEventListener('click', () => saveNarrative(button.dataset.saveNarrative, button)));
  $$('[data-regenerate-section]').forEach(button => button.addEventListener('click', () => regenerateSection(button.dataset.regenerateSection, button.dataset.sectionId, button)));
  $$('[data-export-section]').forEach(button => button.addEventListener('click', () => exportSection(button.dataset.exportSection, button.dataset.sectionId, button)));
  $$('[data-focus-section]').forEach(button => button.addEventListener('click', () => { appState.readingFocus[button.dataset.focusSection] = button.dataset.sectionId; renderNarrativeOutputPanel(); document.querySelector('.reading-main')?.scrollIntoView({ block: 'start' }); }));
  $$('[data-resume-learning], [data-open-learning-section]').forEach(button => button.addEventListener('click', () => { appState.readingFocus[button.dataset.resumeLearning || button.dataset.openLearningSection] = button.dataset.sectionId; saveReadingProgress(button.dataset.resumeLearning || button.dataset.openLearningSection, button.dataset.sectionId, null, true); }));
  $$('[data-toggle-learning-complete]').forEach(button => button.addEventListener('click', () => saveReadingProgress(button.dataset.toggleLearningComplete, button.dataset.sectionId, button.dataset.completed !== 'true', false)));
}

async function saveReadingProgress(contentId, sectionId, completed, jumpToSection) {
  try {
    const payload = { section_id: sectionId };
    if (completed !== null) payload.completed = completed;
    const saved = await request('/api/narrative-contents/' + contentId + '/progress', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const content = appState.selectedProject.narrative_contents.find(item => item.id === contentId);
    if (content) content.reading_progress = saved;
    renderNarrativeOutputPanel();
    if (jumpToSection) document.getElementById('read-' + contentId + '-' + sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { showMessage(error.message, true); }
}

async function regenerateSection(contentId, sectionId, button) {
  try {
    setBusy(button, true, '重写本节…');
    await request('/api/narrative-contents/' + contentId + '/sections/' + encodeURIComponent(sectionId) + '/regenerate', {method:'POST'});
    appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id);
    renderNarrativeOutputPanel(); showMessage('本节已重新生成，请重新审阅整篇讲稿。');
  } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); }
}

async function exportSection(contentId, sectionId, button) {
  try {
    setBusy(button, true, '导出本节…');
    const result = await request('/api/narrative-contents/' + contentId + '/sections/' + encodeURIComponent(sectionId) + '/export', {method:'POST'});
    if (result.download_url) window.location.assign(result.download_url);
  } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); }
}

function renderNarrativeOutline(record) {
  const area = $('#narrative-outline-area');
  if (!area) return;
  const outline = record.outline || {};
  const sections = outline.sections || [];
  const supplementSources = outline.supplemental_sources || {};
  const supplementDocs = appState.selectedProject.documents.filter(doc => Object.hasOwn(supplementSources, doc.id));
  const isConfirmed = record.status === 'confirmed';
  const statusBadge = isConfirmed ? '<span class="tag confirmed">● 大纲已确认</span>' : '<span class="tag">待确认大纲</span>';
  const actionButtons = isConfirmed ?
    '<button class="button button-outline button-small" id="reedit-narrative-outline">重新调整大纲</button><button class="button button-primary button-small" data-generate-narrative="' + record.id + '">生成讲稿</button>' :
    '<button class="button button-outline button-small" id="add-narrative-section" ' + (sections.length >= 8 ? 'disabled' : '') + '>新增章节</button><button class="button button-primary button-small" id="confirm-narrative-outline">确认大纲</button>';
  const disabled = isConfirmed ? 'disabled' : '';
  area.innerHTML = '<div class="outline-header"><div><p class="eyebrow">' + (isConfirmed ? '大纲已就绪' : '待确认大纲 · 可调整顺序、内容与补充来源') + '</p><label>标题<input id="outline-title" value="' + escapeHtml(outline.title || record.title) + '" ' + disabled + '/></label><label>开场思路<input id="outline-opening" value="' + escapeHtml(outline.opening_angle || '') + '" ' + disabled + '/></label><label>收束思路<input id="outline-closing" value="' + escapeHtml(outline.closing_angle || '') + '" ' + disabled + '/></label></div>' + statusBadge + '</div><div class="narrative-outline-list">' + sections.map((section, index) => {
    const supplementChecks = supplementDocs.length ? '<div class="outline-supplements"><small>本节补充资料</small>' + supplementDocs.map(doc => '<label class="check-label"><input type="checkbox" data-outline-supplement="' + doc.id + '" ' + (section.source_block_ids.some(id => supplementSources[doc.id].includes(id)) ? 'checked' : '') + ' ' + disabled + '/>' + escapeHtml(doc.original_name) + '</label>').join('') + '</div>' : '';
    return '<div class="narrative-outline-section" data-section-id="' + escapeHtml(section.id) + '"><span>' + String(index + 1).padStart(2, '0') + '</span><div><label>章节标题<input class="narrative-section-heading" value="' + escapeHtml(section.heading) + '" ' + disabled + '/></label><label>这一节要解决的问题<textarea class="narrative-section-purpose" ' + disabled + '>' + escapeHtml(section.purpose || '') + '</textarea></label><label>关键点（每行一项）<textarea class="narrative-section-points" ' + disabled + '>' + escapeHtml((section.key_points || []).join('\n')) + '</textarea></label><small>' + section.source_block_ids.length + ' 个材料块 · 目标约 ' + section.target_words + ' 字</small>' + supplementChecks + (!isConfirmed ? '<div class="outline-section-actions"><button type="button" class="button button-quiet button-small" data-move-section="up" ' + (index === 0 ? 'disabled' : '') + '>上移</button><button type="button" class="button button-quiet button-small" data-move-section="down" ' + (index === sections.length - 1 ? 'disabled' : '') + '>下移</button><button type="button" class="button button-quiet button-small" data-remove-section ' + (sections.length === 1 ? 'disabled' : '') + '>删除</button></div>' : '') + '</div></div>';
  }).join('') + '</div><div class="plan-actions">' + actionButtons + '</div>';

  if (!isConfirmed) {
    $('#add-narrative-section')?.addEventListener('click', () => {
      record.outline = readNarrativeOutlineFromUi(record);
      const previous = record.outline.sections.at(-1);
      record.outline.sections.push({ ...structuredClone(previous), id: 'new-' + crypto.randomUUID(), heading: '新章节', purpose: '', key_points: [] });
      renderNarrativeOutline(record);
      showMessage('新章节沿用上一节的材料范围。请修改标题、关键点及补充来源。');
    });
    $$('[data-move-section]', area).forEach(button => button.addEventListener('click', () => {
      record.outline = readNarrativeOutlineFromUi(record);
      const index = record.outline.sections.findIndex(section => section.id === button.closest('[data-section-id]').dataset.sectionId);
      const target = index + (button.dataset.moveSection === 'up' ? -1 : 1);
      [record.outline.sections[index], record.outline.sections[target]] = [record.outline.sections[target], record.outline.sections[index]];
      renderNarrativeOutline(record);
    }));
    $$('[data-remove-section]', area).forEach(button => button.addEventListener('click', () => {
      record.outline = readNarrativeOutlineFromUi(record);
      record.outline.sections = record.outline.sections.filter(section => section.id !== button.closest('[data-section-id]').dataset.sectionId);
      renderNarrativeOutline(record);
    }));
    $('#confirm-narrative-outline')?.addEventListener('click', () => confirmNarrativeOutline(record));
  } else {
    $('#reedit-narrative-outline')?.addEventListener('click', () => {
      record.status = 'draft';
      renderNarrativeOutline(record);
    });
    $('[data-generate-narrative]')?.addEventListener('click', event => generateNarrative(record.id, event.currentTarget));
  }
}

function readNarrativeOutlineFromUi(record) {
  const outline = structuredClone(record.outline);
  const sectionsById = new Map(outline.sections.map(section => [section.id, section]));
  const supplementSources = outline.supplemental_sources || {};
  const supplementIds = new Set(Object.values(supplementSources).flat());
  outline.title = $('#outline-title').value.trim() || outline.title;
  outline.opening_angle = $('#outline-opening').value.trim();
  outline.closing_angle = $('#outline-closing').value.trim();
  outline.sections = $$('.narrative-outline-section').map(row => {
    const section = sectionsById.get(row.dataset.sectionId);
    section.heading = $('.narrative-section-heading', row).value.trim();
    section.purpose = $('.narrative-section-purpose', row).value.trim();
    section.key_points = $('.narrative-section-points', row).value.split('\n').map(point => point.trim()).filter(Boolean).slice(0, 5);
    const baseIds = section.source_block_ids.filter(id => !supplementIds.has(id));
    const checkedIds = $$('[data-outline-supplement]:checked', row).flatMap(input => {
      const candidates = supplementSources[input.dataset.outlineSupplement];
      const alreadySelected = section.source_block_ids.filter(id => candidates.includes(id));
      return alreadySelected.length ? alreadySelected : candidates;
    });
    section.source_block_ids = [...new Set([...baseIds, ...checkedIds])];
    return section;
  });
  return outline;
}

let autoOutlineInFlight = false;
let autoOutlineDoneForPlan = '';

async function maybeAutoCreateOutline() {
  const plan = appState.activePlan?.status === 'confirmed' ? appState.activePlan : appState.selectedProject.plans.find(item => item.status === 'confirmed');
  if (!plan) return;
  if (appState.selectedProject.narrative_outlines?.length) return;
  if (autoOutlineInFlight || autoOutlineDoneForPlan === plan.id) return;
  autoOutlineDoneForPlan = plan.id;
  autoOutlineInFlight = true;
  try { await createNarrativeOutline({ auto: true }); } finally { autoOutlineInFlight = false; }
}

async function createNarrativeOutline(options = {}) {
  const auto = !!options.auto;
  const button = $('#create-narrative-outline');
  const project = appState.selectedProject.project;
  try {
    if (!$('#narrative-profile')?.value) await loadProfileOptions();
    setBusy(button, true, '正在整理大纲…');
    const outlineArea = $('#narrative-outline-area');
    if (outlineArea) { outlineArea.dataset.generating = '1'; outlineArea.innerHTML = '<h3>大纲</h3><p class="form-note">正在根据确认的章节生成写作大纲，一般需要几十秒…</p>'; }
    const documentId = $('#plan-document').value;
    const doc = await ensureDocumentLoaded(documentId);
    const scopedPlan = appState.activePlan?.status === 'confirmed' ? appState.activePlan : appState.selectedProject.plans.find(plan => plan.status === 'confirmed');
    const scope = $('input[name="narrative-scope"]:checked').value;
    let sourceBlockIds;
    if (scope === 'chapter' && scopedPlan?.document_id === documentId) {
      sourceBlockIds = [...new Set((scopedPlan.chapters || []).filter(chapter => chapter.enabled !== false).flatMap(chapter => chapter.source_block_ids || []))];
    } else if (scope === 'chapter') {
      throw new Error('当前素材没有匹配的结构，请先生成结构，或选择整份素材。');
    } else {
      sourceBlockIds = doc.blocks.filter(block => block.kind === 'paragraph').map(block => block.id);
    }
    if (!sourceBlockIds.length) throw new Error('当前范围内没有可用于写作的正文材料。');
    if (!$('#narrative-profile').value) throw new Error('画像列表未加载完成。请打开“模型设置”检查服务后，重新打开本页重试。');
    const targetWords = Number($('#narrative-target-words').value);
    if (!Number.isInteger(targetWords) || targetWords < 400 || targetWords > 8000) throw new Error('目标成稿字数须在 400–8000 字之间。');
    const webMode = $('#narrative-web-augment')?.checked ? 'augment' : (project.web_research_mode === 'discover' ? 'discover' : 'off');
    const supplementalDocumentIds = webMode === 'augment' ? $$('input[name="narrative-supplement"]:checked').map(input => input.value).filter(id => id !== documentId) : [];
    for (const supplementalId of supplementalDocumentIds) {
      const supplemental = await ensureDocumentLoaded(supplementalId);
      sourceBlockIds.push(...supplemental.blocks.filter(block => block.kind === 'paragraph').map(block => block.id));
    }
    const payload = { document_id: documentId, source_plan_id: scope === 'chapter' ? scopedPlan?.id || '' : '', title: $('#narrative-title').value.trim(), source_block_ids: [...new Set(sourceBlockIds)], supplemental_document_ids: supplementalDocumentIds, audience: $('#narrative-audience').value.trim() || '法律从业者与企业法务', style_profile: $('#narrative-profile').value, target_length: lengthOfWords(targetWords), target_words: targetWords, transform_mode: project.transform_mode, minimum_output_mode: project.minimum_output_mode || 'auto', minimum_output_ratio: Number(project.minimum_output_ratio || 0.3), web_research_mode: webMode };
    const outline = await request('/api/projects/' + appState.selectedProject.project.id + '/narrative-outlines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id);
    const record = appState.selectedProject.narrative_outlines.find(item => item.id === outline.id) || outline;
    if (outlineArea) delete outlineArea.dataset.generating;
    renderNarrativeOutline(record);
    showMessage(auto ? '已根据确认的章节自动生成写作大纲，可在下方检查调整。' : (scope === 'chapter' ? '已沿用你确认的章节结构。请检查并调整后再确认。' : '写作大纲已生成。请检查章节结构和材料范围。'));
  } catch (error) {
    showMessage(error.message, true);
    const area = $('#narrative-outline-area');
    if (area?.dataset.generating) {
      delete area.dataset.generating;
      area.innerHTML = '<h3>大纲</h3><p class="form-note">大纲生成失败：' + escapeHtml(error.message) + '</p><div style="margin-top:10px;"><button class="button button-outline button-small" id="retry-outline">重试</button></div>';
      $('#retry-outline')?.addEventListener('click', () => createNarrativeOutline({ auto }));
    }
  } finally { setBusy(button, false); }
}

async function confirmNarrativeOutline(record) {
  const button = $('#confirm-narrative-outline');
  try {
    const outline = readNarrativeOutlineFromUi(record);
    setBusy(button, true, '确认中…');
    await request('/api/narrative-outlines/' + record.id + '/confirm', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outline }) });
    appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id);
    const updated = appState.selectedProject.narrative_outlines.find(item => item.id === record.id);
    renderNarrativeOutline(updated);
    const hasTasks = (appState.selectedProject.tasks || []).some(task => task.status !== 'closed');
    appState.activeTab = hasTasks ? 'review' : 'narrative';
    renderProjectDetail();
    showMessage(hasTasks ? '大纲已确认。建议先过一遍材料核对清单，再进入主题讲稿逐节生成。' : '大纲已确认。可以直接逐节生成讲稿了。');
  } catch (error) { showMessage(error.message, true); } finally { if (button?.isConnected) setBusy(button, false); }
}

async function generateNarrative(outlineId, button) {
  let pollTimer = null;
  try {
    appState.activeTab = 'narrative';
    renderProjectDetail();
    const statusLine = () => $('#generation-status');
    const busyButton = () => $('[data-generate-from-outline]') || button;
    setBusy(busyButton(), true, '逐节写作中（较耗时）…');
    pollTimer = setInterval(async () => {
      try {
        const progress = await request('/api/narrative-outlines/' + outlineId + '/progress');
        if (progress.status === 'running' && progress.current > 0) {
          const line = statusLine();
          if (line) line.textContent = '正在写第 ' + progress.current + ' / ' + progress.total + ' 节：' + progress.heading;
        }
      } catch (error) { /* 进度查询失败不影响生成 */ }
    }, 4000);
    await request('/api/narrative-outlines/' + outlineId + '/contents', { method: 'POST' });
    appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id);
    renderProjectDetail();
    showMessage('知识转译成稿已生成！可直接阅读排版或导出 DOCX。');
  } catch (error) { showMessage(error.message, true); } finally { if (pollTimer) clearInterval(pollTimer); if (button?.isConnected) setBusy(button, false); }
}

function markdownSections(markdown = '') {
  const parts = []; let current = null;
  for (const line of markdown.split('\n')) {
    const match = line.match(/^##[ \t]+(.+)$/);
    if (match) { current = { id: 'section-' + (parts.length + 1), heading: match[1].trim(), lines: [line] }; parts.push(current); }
    else if (current) current.lines.push(line);
  }
  return parts.map(part => ({ id: part.id, heading: part.heading, text: part.lines.join('\n') }));
}

function renderNarrativeContentCard(content) {
  appState.narrativeEditing = appState.narrativeEditing || {};
  appState.readingFocus = appState.readingFocus || {};
  const isEditing = !!appState.narrativeEditing[content.id];
  const viewToggleText = isEditing ? '👁️ 查看排版' : '✏️ 修改正文';

  const reading = readingSections(content.markdown);
  const progress = content.reading_progress || { last_section_id: '', completed_section_ids: [] };
  const completed = new Set(progress.completed_section_ids || []);
  const doneCount = reading.filter(section => completed.has(section.id)).length;
  const lastIndex = reading.findIndex(section => section.id === progress.last_section_id);
  const resume = lastIndex >= 0 && !completed.has(reading[lastIndex].id) ? reading[lastIndex]
    : reading.slice(lastIndex + 1).find(section => !completed.has(section.id))
      || reading.find(section => !completed.has(section.id)) || reading[Math.max(lastIndex, 0)];

  // 侧边章节目录：始终可见，点击进入单章阅读，随时可回目录
  const focusId = appState.readingFocus[content.id] || '';
  const focused = reading.find(section => section.id === focusId);
  const toc = '<aside class="reading-toc"><div class="reading-toc-head"><div><b>章节目录</b><small>已学 ' + doneCount + ' / ' + reading.length + ' 节</small></div><button class="button button-primary button-small" data-resume-learning="' + content.id + '" data-section-id="' + resume.id + '">继续学习</button></div><div class="reading-toc-list">' + reading.map((section, index) => '<button class="reading-toc-item ' + (section.id === focusId ? 'active' : '') + (completed.has(section.id) ? ' done' : '') + '" data-focus-section="' + content.id + '" data-section-id="' + section.id + '"><span>' + String(index + 1).padStart(2, '0') + '</span><em>' + escapeHtml(section.heading) + '</em>' + (completed.has(section.id) ? '<i>✓</i>' : '') + '</button>').join('') + '</div></aside>';

  let bodyContent;
  if (isEditing) {
    bodyContent = '<textarea class="narrative-editor" data-narrative-editor="' + content.id + '">' + escapeHtml(content.markdown) + '</textarea>';
  } else if (focused) {
    const index = reading.indexOf(focused);
    const prev = reading[index - 1], next = reading[index + 1];
    const nav = '<div class="reading-focus-nav"><button class="button button-outline button-small" data-focus-section="' + content.id + '" data-section-id="">← 返回目录</button>' + (prev ? '<button class="button button-outline button-small" data-focus-section="' + content.id + '" data-section-id="' + prev.id + '">← 上一节</button>' : '') + (next ? '<button class="button button-outline button-small" data-focus-section="' + content.id + '" data-section-id="' + next.id + '">下一节 →</button>' : '') + '<span class="reading-nav-spacer"></span><button class="button button-quiet button-small" data-regenerate-section="' + content.id + '" data-section-id="' + focused.id + '">重做本节</button><button class="button button-quiet button-small" data-export-section="' + content.id + '" data-section-id="' + focused.id + '">导出本节</button><button class="button button-primary button-small" data-toggle-learning-complete="' + content.id + '" data-section-id="' + focused.id + '" data-completed="' + completed.has(focused.id) + '">' + (completed.has(focused.id) ? '✓ 已学' : '标记已学') + '</button></div>';
    bodyContent = '<div class="reading-focus">' + nav + '<div class="narrative-article">' + renderNarrativeHtml(focused.text, content.id) + '</div>' + nav + '</div>';
  } else {
    bodyContent = '<div class="narrative-article">' + renderNarrativeHtml(content.markdown, content.id) + '</div>';
  }

  const model = content.model || {};
  const floorText = model.output_floor ? ('长度检查：' + model.output_chars + ' / ' + model.output_floor + ' 字 · ' + (model.floor_status === 'pass' ? '通过' : '建议复核')) : '长度检查：未启用';
  const researchText = model.web_research_mode === 'augment' ? '联网：已选来源可补充' : model.web_research_mode === 'off' ? '联网：关闭' : '联网：仅发现候选来源';
const sectionOps = (content.section_sources || []).map((section, index) => '<div class="section-ops-row"><span class="section-ops-name">' + String(index + 1).padStart(2, '0') + '. ' + escapeHtml(section.heading || '未命名章节') + '</span><span class="section-ops-buttons"><button class="button button-quiet button-small" data-regenerate-section="' + content.id + '" data-section-id="' + escapeHtml(section.section_id) + '">重做本节</button><button class="button button-quiet button-small" data-export-section="' + content.id + '" data-section-id="' + escapeHtml(section.section_id) + '">导出本节</button></span></div>').join('');
  const scenario = SCENARIOS[appState.selectedProject.project.scenario] || SCENARIOS.topic_learning;
  const reviewNote = content.review_note || '请核对讲稿与材料的一致性。确认后再用于正式交付；长度检查只用于提醒。';
  return '<article class="narrative-content-card"><div class="content-card-header"><div><p class="doc-kicker">' + escapeHtml(scenario.narrativeLabel) + ' · ' + statusText(content.status) + '</p><h3>' + escapeHtml(content.title) + '</h3><small>模型：' + escapeHtml(model.model_name || '未记录') + ' · <span class="status ' + content.status + '">' + statusText(content.status) + '</span> · ' + escapeHtml(floorText) + ' · ' + escapeHtml(researchText) + '</small></div><div class="detail-actions"><button class="button button-outline button-small" data-toggle-narrative-view="' + content.id + '">' + viewToggleText + '</button><button class="button button-outline button-small" data-confirm-narrative="' + content.id + '">确认审阅</button><button class="button button-outline button-small" data-export-narrative="' + content.id + '">导出 ' + (content.status === 'confirmed' ? 'DOCX' : '审阅稿') + '</button>' + (isEditing ? '<button class="button button-primary button-small" data-save-narrative="' + content.id + '">保存修改</button>' : '') + '</div></div><div class="reading-layout">' + (isEditing ? '' : toc) + '<div class="reading-main">' + bodyContent + '</div></div><div class="review-bar"><span class="review-note">' + escapeHtml(reviewNote) + '</span><details class="section-ops"><summary>按节重做 / 导出（共 ' + (content.section_sources || []).length + ' 节）</summary><div class="section-ops-list">' + sectionOps + '</div></details></div></article>';
}

async function saveNarrative(contentId, button) {
  const editor = $('[data-narrative-editor="' + contentId + '"]');
  if (!editor) return;
  try {
    setBusy(button, true, '保存中…');
    await request('/api/narrative-contents/' + contentId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markdown: editor.value, review_note: '已保存人工审阅修改。', status: 'needs_revision' }) });
    appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id);
    showMessage('长文修改已保存。');
  } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); }
}

async function exportNarrative(contentId, button) {
  try {
    setBusy(button, true, '导出中…');
    const result = await request('/api/narrative-contents/' + contentId + '/export', { method: 'POST' });
    if (result.download_url) {
      window.location.assign(result.download_url);
    }
    showMessage('已导出 DOCX：' + (result.docx_path || '已开始下载'));
  } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); }
}

function renderAudioPanel() {
  const panel = $('#detail-panel');
  const contents = appState.selectedProject.narrative_contents || [];
  const outputs = appState.selectedProject.audio_outputs || [];
  panel.innerHTML = '<section class="panel-card audio-intro"><p class="eyebrow">音频输出</p><h3>先校对脚本，再生成最终音频</h3><p>讲稿草稿可以整理为口播脚本并试听；只有“已确认”的讲稿才能生成完整 MP3。浏览器朗读只用于校对，正式音质由所选 TTS 服务与音色决定。</p></section><section class="panel-card"><h3>从讲稿生成音频脚本</h3><p>可以整理整篇讲稿，也可以只整理其中一章。章节速听更适合通勤、运动等碎片时间逐节收听。</p><label class="audio-naturalize"><input type="checkbox" id="naturalize-audio"/><span>使用文本模型改善口语节奏<span class="audio-naturalize-note">额外调用一次模型；生成后仍需核对事实</span></span></label>' + (contents.length ? '<div class="audio-source-list">' + contents.map(renderAudioSourceRow).join('') + '</div>' : '<p class="form-note">请先在“' + (SCENARIOS[appState.selectedProject.project.scenario] || SCENARIOS.topic_learning).narrativeLabel + '”中生成讲稿。</p>') + '</section><section class="panel-card"><h3>音频脚本与文件</h3><div class="audio-output-list">' + (outputs.length ? outputs.map(renderAudioOutput).join('') : '<p class="form-note">尚未生成音频脚本。</p>') + '</div></section>';
  $$('[data-save-audio]').forEach(button => button.addEventListener('click', () => saveAudioScript(button.dataset.saveAudio, button)));
  $$('[data-preview-audio]').forEach(button => button.addEventListener('click', () => previewAudio(button.dataset.previewAudio, button)));
  $$('[data-create-audio-script]').forEach(button => button.addEventListener('click', () => createAudioScript(button.dataset.createAudioScript, button)));
  $$('[data-speak-script]').forEach(button => button.addEventListener('click', () => speakAudioScript(button.dataset.speakScript, button)));
  $$('[data-synthesize-audio]').forEach(button => button.addEventListener('click', () => synthesizeAudio(button.dataset.synthesizeAudio, button)));
  $$('[data-export-audio]').forEach(button => button.addEventListener('click', () => exportAudioOutput(button.dataset.exportAudio, button)));
  $$('.audio-script-details').forEach(details => details.addEventListener('toggle', () => {
    if (!details.dataset.audioId) return;
    if (details.open) appState.openAudioScript = details.dataset.audioId;
    else if (appState.openAudioScript === details.dataset.audioId) appState.openAudioScript = null;
  }));
}

function renderAudioSourceRow(content) {
  const sections = content.section_sources || [];
  const chapterList = sections.length > 1
    ? '<div class="chapter-audio"><p class="chapter-audio-title">按章节生成速听</p><div class="chapter-audio-list">' + sections.map((section, index) =>
        '<button class="button button-outline button-small" data-create-audio-script="' + content.id + '" data-section-heading="' + escapeHtml(section.heading) + '">' + (index + 1) + '. ' + escapeHtml(section.heading) + '</button>'
      ).join('') + '</div></div>'
    : '';
  const status = content.status === 'confirmed' ? '讲稿已确认，可生成正式 MP3' : '讲稿待确认，可先整理并试听脚本';
  return '<div class="doc-row audio-source-row"><div><b>' + escapeHtml(content.title) + '</b><small>' + status + '</small>' + chapterList + '</div><button class="button button-primary button-small" data-create-audio-script="' + content.id + '">生成整篇脚本</button></div>';
}

function renderAudioOutput(output) {
  const player = output.audio_available ? '<audio controls src="/api/audio-outputs/' + output.id + '/stream?v=' + encodeURIComponent(output.updated_at) + '"></audio>' : '';
  const source = (appState.selectedProject.narrative_contents || []).find(content => content.id === output.narrative_content_id);
  const readyForMp3 = source?.status === 'confirmed';
  const mp3Hint = readyForMp3 ? '' : '<small class="audio-gate-hint">确认对应讲稿后可生成完整 MP3</small>';
  const statusLabel = output.status === 'source_changed' ? '源讲稿已更新，请重新整理脚本' : output.status === 'ready' ? 'MP3 已生成 · ' + output.duration_seconds + ' 秒' : '脚本待校对';
  const script = output.script || '';
  const mediaMinutes = script.length ? Math.max(1, Math.round(script.length / 240)) : 0;
  const stats = script.length ? '共 ' + script.length + ' 字 · 预计朗读约 ' + mediaMinutes + ' 分钟' : '脚本为空';
  const opened = appState.openAudioScript === output.id ? ' open' : '';
  return '<article class="audio-output-card"><div class="audio-output-main"><div class="audio-output-head"><span class="tag">' + statusLabel + '</span><h4>' + escapeHtml(output.title) + '</h4></div><details class="audio-script-details" data-audio-id="' + output.id + '"' + opened + '><summary>查看 / 编辑完整口播脚本</summary><div class="audio-script-body"><textarea class="audio-script-editor" data-audio-editor="' + output.id + '">' + escapeHtml(script) + '</textarea><div class="audio-script-meta"><span class="audio-script-stats">' + stats + '</span><button class="button button-outline button-small" data-save-audio="' + output.id + '">保存脚本</button></div><p class="audio-script-hint">修改脚本后，原有 MP3 会失效，需要重新生成。</p></div></details></div><div class="audio-actions">' + player +
    '<div class="audio-action-group"><span class="audio-action-label">试听</span><button class="button button-outline button-small" data-speak-script="' + output.id + '">浏览器校对朗读</button><button class="button button-outline button-small" data-preview-audio="' + output.id + '">TTS 短片试听</button></div>' +
    '<div class="audio-action-group"><span class="audio-action-label">产出</span><button class="button button-primary button-small" data-synthesize-audio="' + output.id + '" ' + (readyForMp3 ? '' : 'disabled') + '>' + (output.audio_available ? '重新生成 MP3' : '生成 MP3') + '</button>' + mp3Hint + '<button class="button button-outline button-small" data-export-audio="' + output.id + '">导出脚本与音频</button></div>' +
    '<audio controls hidden data-preview-player="' + output.id + '"></audio></div></article>';
}

async function saveAudioScript(id, button) {
  try {
    setBusy(button, true);
    await request('/api/audio-outputs/' + id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({script: $('[data-audio-editor="' + id + '"]').value}) });
    appState.openAudioScript = id;
    appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id);
    renderAudioPanel(); showMessage('脚本已保存，请重新试听。');
  } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); }
}

async function previewAudio(id, button) {
  try {
    setBusy(button, true, '合成试听片段…');
    const response = await request('/api/audio-outputs/' + id + '/synthesize', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({preview:true})});
    const player = $('[data-preview-player="' + id + '"]');
    if (!player) return;
    if (player.src.startsWith('blob:')) URL.revokeObjectURL(player.src);
    player.src = URL.createObjectURL(await response.blob()); player.hidden = false;
    showMessage('试听片段已生成，请点击播放。使用的是已保存脚本的前 180 字。');
  } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); }
}

async function createAudioScript(contentId, button) {
  const sectionHeading = button?.dataset?.sectionHeading || '';
  const done = sectionHeading ? '章节速听脚本已生成：' + sectionHeading : '音频脚本已生成';
  try {
    setBusy(button, true, sectionHeading ? '整理该章脚本…' : '整理脚本…');
    const result = await request('/api/projects/' + appState.selectedProject.project.id + '/audio-scripts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ narrative_content_id: contentId, naturalize: !!$('#naturalize-audio')?.checked, section_heading: sectionHeading }) });
    appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id);
    renderAudioPanel();
    showMessage(result.naturalization_skipped ? done + '；未配置文本模型，本次保留基础口播版。' : done + '，可浏览器试听或调用 TTS。');
  } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); }
}

async function speakAudioScript(audioId, button) {
  try { const output = await request('/api/audio-outputs/' + audioId); if (!('speechSynthesis' in window)) throw new Error('当前浏览器不支持语音试听。'); window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(output.script); utterance.lang = 'zh-CN'; utterance.rate = 1; window.speechSynthesis.speak(utterance); button.textContent = '正在试听…'; utterance.onend = () => { button.textContent = '浏览器校对朗读'; }; } catch (error) { showMessage(error.message, true); }
}

async function synthesizeAudio(audioId, button) {
  try { setBusy(button, true, '生成 MP3…'); await request('/api/audio-outputs/' + audioId + '/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }); appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id); renderAudioPanel(); showMessage('MP3 已生成，可直接播放或导出。'); } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); }
}

async function exportAudioOutput(audioId, button) {
  try { setBusy(button, true, '导出中…'); const result = await request('/api/audio-outputs/' + audioId + '/export', { method: 'POST' }); showMessage('音频脚本已导出：' + result.script_path); } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); }
}

function renderTasksPanel() {
  const panel = $('#detail-panel'); const tasks = appState.selectedProject.tasks;
  const project = appState.selectedProject.project;
  const verification = project.verification_mode;
  const external = verification === 'external_verify';
  const title = external ? '发布前核验清单' : '待确认表述';
  const openCount = tasks.filter(task => task.status === 'open' || task.status === 'in_progress').length;
  const intro = external
    ? '对外培训、Speak Note 和公开播客发布前，逐条确认以下表述的事实与来源，全部处理完才能生成正式讲稿。'
    : '讲稿由 AI 依据材料转译，以下是转译前建议你亲自过目的表述。你的选择会实际影响生成：标记「存疑」的表述，讲稿中会保持谨慎措辞并标注（此点待核实）；标记「忽略」的表述，讲稿不再引用。';
  const statusLabel = { open: '待确认', in_progress: '存疑', done: '已确认', dismissed: '忽略' };
  const cards = tasks.map(task => {
    const pills = Object.entries(statusLabel).map(([value, label]) => '<button type="button" class="status-pill' + (task.status === value ? ' active' : '') + '" data-task-status="' + value + '">' + label + '</button>').join('');
    return '<div class="task-card" data-task-id="' + task.id + '">' +
      '<p class="task-card-text">' + escapeHtml(task.detail) + '</p>' +
      '<div class="task-card-foot">' +
        (external ? '<span class="risk-tag risk-' + task.risk_level + '">' + ({ high: '高风险', medium: '中风险', low: '低风险' }[task.risk_level] || task.risk_level) + '</span>' : '') +
        '<button class="button button-outline button-small" data-task-evidence="' + escapeHtml(task.evidence_block_ids.join(',')) + '">查看原文依据</button>' +
        '<span class="spacer"></span>' +
        '<span class="status-pills">' + pills + '</span>' +
        (external ? '<input class="task-owner" value="' + escapeHtml(task.owner) + '" placeholder="负责人"/><input class="task-due" type="date" value="' + escapeHtml(task.due_date) + '"/>' : '') +
      '</div></div>';
  }).join('');
  panel.innerHTML = '<section class="panel-card workflow-gate"><p class="eyebrow">第三步 · ' + (external ? '发布前核验' : '转译前把关') + '</p><h3>' + title + '</h3><p>' + intro + '</p>' +
    (tasks.length
      ? '<p class="form-note">' + (external ? '还有 ' + openCount + ' 项未处理。' : '共 ' + tasks.length + ' 条，已确认 ' + (tasks.length - openCount) + ' 条。逐条过一遍即可，全部处理或直接跳到下一步都行。') + '</p><div class="task-list">' + cards + '</div>'
      : '<p class="form-note">当前材料没有挑出需要特别确认的表述，可以直接进入下一步。</p>') + '</section>';
  $$('.task-card .status-pill').forEach(pill => pill.addEventListener('click', () => saveTask(pill.closest('.task-card'), pill.dataset.taskStatus)));
  $$('.task-card .task-owner, .task-card .task-due').forEach(input => input.addEventListener('change', () => saveTask(input.closest('.task-card'))));
  $$('[data-task-evidence]').forEach(button => button.addEventListener('click', async () => { const doc = currentDocument(); if (!doc) return; await ensureDocumentLoaded(doc.id); const ids = button.dataset.taskEvidence.split(',').filter(Boolean); const blocks = appState.selectedDocument.blocks.filter(block => ids.includes(block.id)); showSourceOverlay('表述的原文依据', blocks.map(block => '<h4>' + escapeHtml(block.source_locator) + '</h4><pre>' + escapeHtml(block.text) + '</pre>').join('')); }));
}
async function saveTask(card, status) { status = status || $('.status-pill.active', card)?.dataset.taskStatus || 'open'; try { await request('/api/tasks/' + card.dataset.taskId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, owner: ($('.task-owner', card)?.value || '').trim(), due_date: $('.task-due', card)?.value || '' }) }); appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id); renderProjectDetail(); showMessage('已保存。'); } catch (error) { showMessage(error.message, true); } }
async function exportProject() { const button = $('#export-project'); try { setBusy(button, true, '正在导出…'); const output = await request('/api/projects/' + appState.selectedProject.project.id + '/exports', { method: 'POST' }); showMessage('成果包已写入：' + output.output_dir); } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); } }
async function deleteProject() { const project = appState.selectedProject?.project; if (!project) return; const confirmed = window.confirm('删除项目“' + project.name + '”？\n\n项目中的原始材料、章节方案、讲稿、音频和任务记录将从本机工作目录删除。已经导出的成果包不会删除。'); if (!confirmed) return; const button = $('#delete-project'); try { setBusy(button, true, '删除中…'); await request('/api/projects/' + project.id, { method: 'DELETE' }); appState.selectedProjectId = null; appState.selectedProject = null; appState.selectedDocument = null; appState.activePlan = null; $('#project-detail').classList.add('hidden'); $('#project-detail').innerHTML = ''; document.body.classList.remove('in-project'); await loadProjects(); showShelf(); showMessage('项目及本地派生音频已删除。'); } catch (error) { showMessage(error.message, true); } finally { if (button?.isConnected) setBusy(button, false); } }
function showSourceOverlay(title, html) { const overlay = document.createElement('div'); overlay.className = 'source-modal'; overlay.innerHTML = '<div class="source-modal-card"><div class="source-modal-top"><div><p class="eyebrow">原始材料依据</p><h3>' + escapeHtml(title) + '</h3></div><button class="icon-button" aria-label="关闭">×</button></div><div>' + html + '</div></div>'; $('.icon-button', overlay).addEventListener('click', () => overlay.remove()); overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); }); document.body.appendChild(overlay); }

function bindDialogs() {
  const settingsForm = $('#settings-form');
  if (settingsForm && !$('#settings-update')) {
    const updateSection = document.createElement('section');
    updateSection.id = 'settings-update';
    updateSection.className = 'settings-update';
    updateSection.setAttribute('aria-label', '版本与更新');
    updateSection.innerHTML = '<h3>版本与更新</h3><div class="settings-update-row"><button type="button" class="button button-outline button-small" id="check-updates">检查更新</button><p class="settings-update-status" id="settings-update-status" role="status">正在读取当前版本…</p></div>';
    $('.dialog-actions', settingsForm).before(updateSection);
    $('#check-updates').addEventListener('click', async event => {
      const button = event.currentTarget;
      setBusy(button, true, '检查中…');
      try { await checkForUpdates(true); } finally { setBusy(button, false); }
    });
  }
  $('#collection-form').addEventListener('submit', event => { event.preventDefault(); saveProjectCollection(collectionDialogProjectId, event.currentTarget.elements.collection.value.trim()); });
  $('#collection-remove').addEventListener('click', () => saveProjectCollection(collectionDialogProjectId, ''));
  $('#new-project').addEventListener('click', () => { $('#collection-options').innerHTML = [...new Set(appState.projects.map(project => (project.collection || '').trim()).filter(Boolean))].map(name => '<option value="' + escapeHtml(name) + '"></option>').join(''); $('#project-dialog').showModal(); });
  $('#open-daily-brief').addEventListener('click', () => $('#daily-brief-dialog').showModal());
  $$('input[name="scenario"]').forEach(input => input.addEventListener('change', () => {
    const config = SCENARIOS[input.value];
    const form = $('#project-form');
    const modeRadio = form.querySelector('input[name="transform_mode"][value="' + config.transform + '"]');
    if (modeRadio) modeRadio.checked = true;
    form.elements.verification_mode.value = config.verification;
    form.elements.audio_enabled.checked = !!config.audio;
  }));
  $$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => {
    const dialog = $('#' + button.dataset.closeDialog);
    if (dialog?.open) dialog.close();
  }));
  $('#project-form').addEventListener('submit', async event => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const submit = $('button[type="submit"]', formEl);
    try {
      setBusy(submit, true, '创建中…');
      const body = Object.fromEntries(form);
      body.audio_enabled = formEl.elements.audio_enabled.checked;
      body.target_duration = Number(body.target_duration || 10);
      const sourceUrl = (body.source_url || '').trim();
      delete body.source_url;
      const project = await request('/api/projects', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
      if (sourceUrl) {
        setBusy(submit, true, '正在抓取文章…');
        await request('/api/projects/' + project.id + '/link-sources', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ url: sourceUrl, title: body.name }) });
      }
      $('#project-dialog').close();
      formEl.reset();
      await loadProjects();
      await openProject(project.id);
      showMessage(sourceUrl ? '链接已导入并拆成材料，可以确认大纲了。' : '项目已创建。现在可以导入材料。');
    } catch(error) {
      showMessage(error.message, true);
    } finally {
      setBusy(submit, false);
    }
  });
  $('#daily-brief-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const submit = $('button[type="submit"]', form);
    try {
      setBusy(submit, true, '校验订阅源…');
      const body = Object.fromEntries(new FormData(form)); body.max_items = Number(body.max_items || 3); body.auto_generate = form.elements.auto_generate.checked;
      await request('/api/daily-brief-subscriptions', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
      $('#daily-brief-dialog').close(); form.reset(); await loadDailyBriefSubscriptions(); showMessage('每日速听订阅已保存，到点后会自动收集；也可以立即手动收集。');
    } catch (error) { showMessage(error.message, true); } finally { setBusy(submit, false); }
  });
  $('#open-settings').addEventListener('click', async () => {
    try {
      const [config, exportConfig] = await Promise.all([request('/api/settings/provider'), request('/api/settings/export')]);
      const form = $('#settings-form');
      const settingsTitle = $('.dialog-header h2', form);
      if (settingsTitle) settingsTitle.textContent = '设置';
      const note = $('.form-note', form);
      if (note) note.textContent = '文本模型仅在生成或润色内容时需要；本地音频试听可单独使用。密钥仅保存在本机。';
      const modelLegend = $('fieldset legend', form);
      if (modelLegend) modelLegend.textContent = '文本模型（生成内容时需要）';
      const ttsHint = $('select[name="tts_provider"]', form)?.closest('fieldset')?.querySelector('.field-hint');
      if (ttsHint) ttsHint.textContent = 'macOS 本地语音无需云服务或密钥；生成 MP3 仍需本机安装 FFmpeg。Edge TTS 无需 Key，但属于实验性在线能力；正式对外内容请使用有授权的语音服务。';
      if (!$('#test-tts', form)) {
        const ttsFieldset = $('select[name="tts_provider"]', form)?.closest('fieldset');
        if (ttsFieldset) {
          const testRow = document.createElement('div');
          testRow.className = 'setting-test-row';
          testRow.innerHTML = '<button type="button" class="button button-outline button-small" id="test-tts">保存并试听音色</button><span id="tts-test-result" class="field-hint"></span><audio id="tts-test-player" controls hidden></audio>';
          ttsFieldset.querySelector('.field-hint')?.insertAdjacentElement('afterend', testRow);
        }
      }
      ['provider_preset','provider_name','base_url','model_name','api_key','tts_base_url','tts_model','tts_voice','tts_api_key','tts_provider','tts_speed','tts_instructions','asr_base_url','asr_model','asr_api_key'].forEach(key => { form.elements[key].value = config[key] ?? (key === 'provider_preset' ? 'openai' : key === 'tts_provider' ? 'compatible' : key === 'tts_speed' ? '1' : ''); });
      form.elements.allow_source_upload.checked = !!config.allow_source_upload;
      form.elements.output_directory.value = exportConfig.output_directory || exportConfig.default_directory || '';
      applyProviderPreset(form, false);
      $('#settings-dialog').showModal();
      checkForUpdates();
    } catch(error) {
      showMessage(error.message,true);
    }
  });
  $('#settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const body = Object.fromEntries(form);
    body.allow_source_upload = formEl.elements.allow_source_upload.checked;
    const submit = $('button[type="submit"]', formEl);
    try {
      setBusy(submit, true, '保存中…');
      const exportBody = { output_directory: body.output_directory || '' };
      delete body.output_directory;
      await Promise.all([
        request('/api/settings/provider', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }),
        request('/api/settings/export', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(exportBody) }),
      ]);
      $('#settings-dialog').close();
      showMessage('本机设置已保存。');
    } catch(error) {
      showMessage(error.message,true);
    } finally {
      setBusy(submit, false);
    }
  });
  $('#provider-preset').addEventListener('change', event => applyProviderPreset($('#settings-form'), event.target.value !== 'custom'));
  $('#test-provider').addEventListener('click', async event => {
    const button = event.currentTarget; const result = $('#provider-test-result');
    try {
      setBusy(button, true, '保存并测试…');
      const form = $('#settings-form'); const body = Object.fromEntries(new FormData(form)); body.allow_source_upload = form.elements.allow_source_upload.checked;
      const exportBody = {output_directory: body.output_directory || ''}; delete body.output_directory;
      await Promise.all([request('/api/settings/provider', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}), request('/api/settings/export', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(exportBody)})]);
      const test = await request('/api/settings/provider/test', {method:'POST'});
      const provider = typeof test.provider_name === 'string' ? test.provider_name : '已选服务商';
      const model = typeof test.model_name === 'string' ? test.model_name : '已配置模型';
      result.textContent = '连接成功：' + provider + ' / ' + model; result.className = 'field-hint success-hint';
    } catch (error) {
      const message = readableError(error);
      result.textContent = typeof message === 'string' ? message : '模型设置校验失败，请检查必填项。';
      result.className = 'field-hint error-hint';
    } finally { setBusy(button, false); }
  });
  document.addEventListener('click', async event => {
    if (event.target.id !== 'test-tts') return;
    const button = event.target; const result = $('#tts-test-result'); const player = $('#tts-test-player');
    try {
      setBusy(button, true, '保存并合成…');
      const form = $('#settings-form'); const body = Object.fromEntries(new FormData(form)); body.allow_source_upload = form.elements.allow_source_upload.checked;
      const exportBody = {output_directory: body.output_directory || ''}; delete body.output_directory;
      await Promise.all([request('/api/settings/provider', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}), request('/api/settings/export', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(exportBody)})]);
      const response = await request('/api/settings/tts/test', {method:'POST'});
      const audio = await response.blob();
      if (player.src.startsWith('blob:')) URL.revokeObjectURL(player.src);
      player.src = URL.createObjectURL(audio); player.hidden = false;
      await player.play().catch(() => {});
      result.textContent = '试听已生成，请播放确认音色和语速。'; result.className = 'field-hint success-hint';
    } catch (error) {
      result.textContent = readableError(error); result.className = 'field-hint error-hint';
    } finally { setBusy(button, false); }
  });
}
function applyProviderPreset(form, overwrite = false) {
  const preset = form.elements.provider_preset.value; const mapping = {openai:{name:'OpenAI',url:'https://api.openai.com/v1',model:'gpt-4.1-mini'},deepseek:{name:'DeepSeek',url:'https://api.deepseek.com/v1',model:'deepseek-chat'}};
  const item = mapping[preset]; const custom = preset === 'custom';
  ['provider_name','base_url','model_name'].forEach(key => { form.elements[key].closest('label').style.display = custom ? '' : 'none'; });
  if (item && (overwrite || !form.elements.base_url.value)) { form.elements.provider_name.value = item.name; form.elements.base_url.value = item.url; form.elements.model_name.value = item.model; }
}
async function initHomeSkillSection() {
  const tag = $('#home-skill-status');
  if (!tag) return;
  try {
    const status = await request('/api/skill/status');
    tag.textContent = status.app_api_ready ? 'App API 已就绪 · 宿主模型可用' : '宿主模型模式可用';
    tag.className = 'tag ' + (status.app_api_ready ? 'skill-ready' : '');
  } catch (error) {
    tag.textContent = '本地服务未连接';
  }
  const copy = $('#copy-skill-invoke');
  if (copy) copy.addEventListener('click', async () => { const example = '请读取并按此 Skill 执行：https://github.com/hey-elaine/lawflow/tree/main/skills/lawflow\n\n$lawflow 使用声息处理本地项目中的材料：先读取受控上下文，给出可确认的大纲，再将成稿回写并导出 DOCX。'; try { await navigator.clipboard.writeText(example); showMessage('已复制 GitHub Skill 链接与调用示例。'); } catch (_) { showMessage('浏览器未授权剪贴板，请手动复制。', true); } });
}
async function checkForUpdates(manual = false) {
  const notice = $('#update-notice');
  const settingsStatus = $('#settings-update-status');
  try {
    const status = await request('/api/app/version');
    const version = $('#app-version');
    if (version) version.textContent = '版本 ' + status.current_version + ' · 材料整理 · 讲稿审阅 · 按需核验';
    if (settingsStatus) {
      if (!status.check_succeeded) settingsStatus.textContent = '当前版本 ' + status.current_version + '。暂未获取到公开发布版本，请稍后重试。';
      else if (status.update_available && status.release_url) settingsStatus.innerHTML = '当前版本 ' + escapeHtml(status.current_version) + '，新版本 ' + escapeHtml(status.latest_version) + ' 已发布。<a class="settings-update-link" target="_blank" rel="noopener noreferrer" href="' + escapeHtml(status.release_url) + '">打开下载页</a>';
      else settingsStatus.textContent = '当前版本 ' + status.current_version + '，已是最新公开版本。';
    }
    if (!notice) return;
    notice.classList.add('hidden');
    if (!status.update_available || !status.release_url) return;
    notice.innerHTML = '<div class="shell"><span>声息 ' + escapeHtml(status.latest_version) + ' 已发布。</span><a class="button button-outline button-small" target="_blank" rel="noreferrer" href="' + escapeHtml(status.release_url) + '">前往 GitHub 下载</a><button class="icon-button" aria-label="关闭更新提示">×</button></div>';
    notice.classList.remove('hidden');
    $('.icon-button', notice)?.addEventListener('click', () => notice.classList.add('hidden'));
  } catch (_) {
    if (settingsStatus && manual) settingsStatus.textContent = '检查失败：本地服务暂时不可用，请稍后重试。';
  }
}
async function boot() {
  bindDialogs();
  enhanceSelects();
  new MutationObserver(() => { enhanceSelects(); $$('.select-box select').forEach(syncSelectBox); }).observe(document.body, { childList: true, subtree: true });
  $('#nav-shelf')?.addEventListener('click', event => { event.preventDefault(); showShelf(); });
  $('#back-home')?.addEventListener('click', goHome);
  $('#hero-open-shelf')?.addEventListener('click', event => { event.preventDefault(); showShelf(true); });
  $('.brand')?.addEventListener('click', event => { event.preventDefault(); goHome(); });
  if (window.location.protocol === 'file:') {
    showMessage('你正在打开源码页面。请打开已安装的声息 app 使用完整功能。', true);
    return;
  }
  initHomeSkillSection();
  initListenSection();
  checkForUpdates();
  try { await Promise.all([loadProjects(), loadDailyBriefSubscriptions()]); } catch (error) { showMessage('无法连接本地服务：' + readableError(error), true); }
}
document.addEventListener('DOMContentLoaded', boot);

/* ===== 首页试听段：用真实音频数据驱动播放器 ===== */
let listenState = { tracks: [], index: 0, audio: null };

function formatListenTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return m + ':' + String(s).padStart(2, '0');
}

async function initListenSection() {
  if (window.location.protocol === 'file:') return;
  const player = $('#listen-player'), empty = $('#listen-empty');
  if (!player) return;
  try {
    const projects = appState.projects?.length ? appState.projects : await request('/api/projects');
    for (const item of projects.slice(0, 8)) {
      const detail = await request('/api/projects/' + item.id);
      const ready = (detail.audio_outputs || []).filter(output => output.audio_available);
      if (!ready.length) continue;
      listenState.tracks = ready;
      renderListenPlayer(detail.project.name);
      return;
    }
    player.classList.add('hidden');
    empty?.classList.remove('hidden');
  } catch (error) { player.classList.add('hidden'); empty?.classList.remove('hidden'); }
}

function renderListenPlayer(projectName) {
  const list = $('#listen-chapters');
  if (!list) return;
  list.innerHTML = listenState.tracks.map((track, index) =>
    '<li><button type="button" class="listen-chapter" data-listen-index="' + index + '"><span class="listen-no">' + String(index + 1).padStart(2, '0') + '</span><span class="listen-name">' + escapeHtml(track.title || ('第 ' + (index + 1) + ' 章')) + '</span><span class="listen-duration" data-listen-duration="' + track.id + '">' + (track.duration_seconds ? formatListenTime(track.duration_seconds) : '') + '</span></button></li>'
  ).join('');
  $$('#listen-chapters .listen-chapter').forEach(button => button.addEventListener('click', () => playListenTrack(Number(button.dataset.listenIndex))));
  $('#listen-meta').textContent = '共 ' + listenState.tracks.length + ' 段 · ' + projectName;
  listenState.audio = new Audio('/api/audio-outputs/' + listenState.tracks[0].id + '/stream');
  const audio = listenState.audio;
  audio.playbackRate = getListenRate();
  syncListenRateButtons();
  $$('#listen-rate .listen-rate-btn').forEach(button => button.addEventListener('click', () => {
    const rate = Number(button.dataset.rate);
    localStorage.setItem('shengxi-listen-rate', String(rate));
    audio.playbackRate = rate;
    syncListenRateButtons();
  }));
  audio.addEventListener('loadedmetadata', () => { $('#listen-total').textContent = formatListenTime(audio.duration); });
  audio.addEventListener('timeupdate', () => {
    const ratio = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    $('#listen-bar').style.width = ratio + '%';
    $('#listen-current').textContent = formatListenTime(audio.currentTime);
  });
  audio.addEventListener('ended', () => { if (listenState.index < listenState.tracks.length - 1) playListenTrack(listenState.index + 1); else setListenToggle(false); });
  audio.addEventListener('play', () => setListenToggle(true));
  audio.addEventListener('pause', () => setListenToggle(false));
  syncListenUi();
  $('#listen-toggle')?.addEventListener('click', () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); });
  $('#listen-prev')?.addEventListener('click', () => playListenTrack((listenState.index - 1 + listenState.tracks.length) % listenState.tracks.length));
  $('#listen-next')?.addEventListener('click', () => playListenTrack((listenState.index + 1) % listenState.tracks.length));
}

function setListenToggle(playing) {
  const button = $('#listen-toggle');
  if (button) button.textContent = playing ? '❚❚' : '▶';
}

function getListenRate() {
  const saved = Number(localStorage.getItem('shengxi-listen-rate'));
  return [1, 1.25, 1.5, 2].includes(saved) ? saved : 1;
}

function syncListenRateButtons() {
  const rate = getListenRate();
  $$('#listen-rate .listen-rate-btn').forEach(button => button.classList.toggle('active', Number(button.dataset.rate) === rate));
}

function playListenTrack(index) {
  if (!listenState.tracks.length) return;
  listenState.index = index;
  listenState.audio.src = '/api/audio-outputs/' + listenState.tracks[index].id + '/stream';
  syncListenUi();
  listenState.audio.play().catch(() => {});
}

function syncListenUi() {
  const track = listenState.tracks[listenState.index];
  if (!track) return;
  $('#listen-title').textContent = track.title || ('第 ' + (listenState.index + 1) + ' 段');
  $('#listen-total').textContent = track.duration_seconds ? formatListenTime(track.duration_seconds) : '0:00';
  $$('#listen-chapters .listen-chapter').forEach((button, i) => button.classList.toggle('active', i === listenState.index));
}


async function loadProfileOptions(selectedId) {
  const select = $('#narrative-profile');
  if (!select) return;
  const profiles = await getNarrativeProfiles();
  if (!select.isConnected) return;
  appState.profiles = profiles;
  select.innerHTML = profiles.length
    ? profiles.map(profile => '<option value="' + escapeHtml(profile.id) + '">' + escapeHtml(profile.name) + (profile.builtin ? '' : '（自定义）') + '</option>').join('')
    : '<option value="" disabled selected>画像加载失败，请检查模型设置后重试</option>';
  if (selectedId) select.value = selectedId;
}

function openProfileEditor() {
  $('#profile-dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'profile-dialog'; dialog.className = 'dialog';
  dialog.innerHTML = '<form id="profile-form"><div class="dialog-header"><h2>写作画像</h2><button type="button" id="close-profile" class="icon-button" aria-label="关闭">×</button></div><p class="form-note">可以手工定义风格，或从播客片段提取结构、表达方式和节奏。不会克隆音色，也不会将素材事实作为新稿依据。</p><label>画像名称<input id="profile-name" required maxlength="100"/></label><label>简介<textarea id="profile-description" maxlength="1000"></textarea></label><label>写作指令<textarea id="profile-instruction" required minlength="10" maxlength="6000" rows="6"></textarea></label><details><summary>从播客素材提取</summary><label>上传音频片段（≤20 MB，需配置转写服务）<input id="profile-audio" type="file" accept=".mp3,.wav,.m4a,.webm,.mp4"/></label><button type="button" id="transcribe-profile" class="button button-outline">转写音频</button><label>播客转写文本（100–30000 字；可直接粘贴）<textarea id="profile-transcript" rows="7" maxlength="30000"></textarea></label><button type="button" id="extract-profile" class="button button-outline">提取画像草稿</button><p class="field-hint">转写与画像提取分别调用已配置服务。请核对文本和提取结果后再保存。</p></details><p id="profile-message" role="status"></p><div class="dialog-actions"><button type="button" id="update-profile" class="button button-outline">更新当前自定义画像</button><button type="submit" class="button button-primary">保存为新画像</button></div></form>';
  const profileTools = document.createElement('div');
  profileTools.className = 'profile-tools';
  profileTools.innerHTML = '<button type="button" class="button button-quiet button-small" id="export-profile">导出 Markdown</button><label class="button button-quiet button-small" for="import-profile-file">导入 Markdown<input id="import-profile-file" type="file" accept=".md,.markdown,text/markdown" hidden></label>';
  $('.dialog-header', dialog).after(profileTools);
  document.body.appendChild(dialog);
  const current = (appState.profiles || []).find(item => item.id === $('#narrative-profile').value);
  const isBuiltin = !!current?.builtin;
  $('#profile-name').value = current ? current.name : '';
  $('#profile-description').value = current?.description || '';
  $('#profile-instruction').value = current?.instruction || '';
  $('#update-profile').hidden = !current || isBuiltin;
  if (current) {
    $('#profile-message').textContent = isBuiltin
      ? '正在以内置画像「' + current.name + '」为起点。内置画像不可修改，点“保存为新画像”即可创建你的版本。'
      : '正在编辑自定义画像「' + current.name + '」。';
  }
  $('#close-profile').onclick = () => dialog.close();
  $('#export-profile').onclick = () => {
    if (!current) { $('#profile-message').textContent = '请先选择一个画像。'; return; }
    window.open('/api/narrative/profiles/' + encodeURIComponent(current.id) + '/export', '_blank');
  };
  $('#import-profile-file').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const result = await request('/api/narrative/profiles/import', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({markdown: await file.text()})});
      await loadProfileOptions(result.id); dialog.close(); showMessage('画像已导入并保存为自定义画像。');
    } catch (error) { $('#profile-message').textContent = error.message; }
  };
  dialog.showModal();
  async function save(update, button) {
    if (!$('#profile-form').reportValidity()) return;
    try {
      setBusy(button, true);
      const result = await request('/api/narrative/profiles' + (update ? '/' + current.id : ''), {method:update ? 'PUT' : 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:$('#profile-name').value.trim(), description:$('#profile-description').value.trim(), instruction:$('#profile-instruction').value.trim()})});
      await loadProfileOptions(result.id); dialog.close(); showMessage('画像已保存，后续大纲和讲稿将使用所选画像。');
    } catch (error) { $('#profile-message').textContent = error.message; } finally { setBusy(button, false); }
  }
  $('#profile-form').onsubmit = event => {event.preventDefault(); save(false, $('button[type="submit"]', dialog));};
  $('#update-profile').onclick = event => save(true, event.currentTarget);
  $('#transcribe-profile').onclick = async event => {
    const button = event.currentTarget;
    try {
      const file = $('#profile-audio').files[0];
      if (!file || file.size > 20 * 1024 * 1024) throw new Error('请选择不超过 20 MB 的音频片段。');
      setBusy(button, true, '正在转写…');
      const data = new FormData(); data.append('file', file);
      const result = await request('/api/narrative/transcribe', {method:'POST', body:data});
      $('#profile-transcript').value = result.transcript;
      $('#profile-message').textContent = '转写完成，请检查文本后提取画像。';
    } catch (error) { $('#profile-message').textContent = error.message; } finally { setBusy(button, false); }
  };
  $('#extract-profile').onclick = async event => {
    const button = event.currentTarget;
    try {
      const transcript = $('#profile-transcript').value.trim();
      if (transcript.length < 100 || transcript.length > 30000) throw new Error('请提供 100–30000 字的播客转写文本。');
      setBusy(button, true, '正在分析表达风格…');
      const result = await request('/api/narrative/profile-draft', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({transcript})});
      const hasDraft = ['profile-name', 'profile-description', 'profile-instruction'].some(id => $('#' + id).value.trim());
      if (hasDraft && !window.confirm('提取结果会覆盖当前填写的名称、简介和写作指令，继续吗？')) return;
      $('#profile-name').value = result.name; $('#profile-description').value = result.description; $('#profile-instruction').value = result.instruction;
      $('#profile-message').textContent = '画像草稿已填入，尚未保存。请编辑确认后保存为新画像。';
    } catch (error) { $('#profile-message').textContent = error.message; } finally { setBusy(button, false); }
  };
}

async function confirmNarrativeContent(id, button) {
  try {
    const content = appState.selectedProject.narrative_contents.find(item => item.id === id);
    const editor = $('[data-narrative-editor="' + id + '"]');
    if (editor && editor.value !== content.markdown) throw new Error('请先保存正文修改，再确认审阅。');
    setBusy(button, true);
    await request('/api/narrative-contents/' + id, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({markdown:content.markdown, status:'confirmed', review_note:'用户已确认讲稿审阅；核验任务状态单独管理。'})});
    appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id);
    renderProjectDetail(); showMessage('讲稿审阅已确认。');
  } catch (error) {showMessage(error.message, true);} finally {setBusy(button, false);}
}

/* 自定义下拉框：隐藏原生 select、用统一样式的弹出列表替代系统菜单。 */
function selectBoxSignature(select) { return select.options.length + ':' + select.selectedIndex + ':' + (select.disabled ? 1 : 0); }

function syncSelectBox(select) {
  const wrap = select.closest('.select-box');
  if (!wrap) return;
  const sig = selectBoxSignature(select);
  if (select.dataset.selectSig === sig && wrap.querySelector('.select-box-trigger').textContent) return;
  select.dataset.selectSig = sig;
  const trigger = wrap.querySelector('.select-box-trigger');
  const list = wrap.querySelector('.select-box-list');
  const options = [...select.options];
  const selected = options[select.selectedIndex] || null;
  const label = selected ? selected.textContent : (options[0]?.textContent || '请选择');
  trigger.innerHTML = '<span class="select-box-value">' + escapeHtml(label) + '</span><span class="select-box-arrow"></span>';
  wrap.classList.toggle('disabled', select.disabled);
  trigger.disabled = select.disabled;
  list.innerHTML = options.map((opt, index) => '<button type="button" class="select-box-option' + (opt === selected ? ' active' : '') + (opt.disabled ? ' disabled' : '') + '" data-option-index="' + index + '">' + (opt === selected ? '✓ ' : '') + escapeHtml(opt.textContent) + '</button>').join('');
}

function closeAllSelectBoxes() { $$('.select-box-list[data-open]').forEach(list => { delete list.dataset.open; }); }

function enhanceSelects(root) {
  $$('select:not([data-custom])', root || document).forEach(select => {
    if (select.multiple) { select.dataset.custom = '1'; return; }
    select.dataset.custom = '1';
    const wrap = document.createElement('span');
    wrap.className = 'select-box';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'select-box-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    const list = document.createElement('span');
    list.className = 'select-box-list';
    wrap.append(trigger, list);
    const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    try {
      Object.defineProperty(select, 'value', {
        configurable: true,
        get() { return valueDescriptor.get.call(this); },
        set(v) { valueDescriptor.set.call(this, v); syncSelectBox(this); },
      });
    } catch (error) { /* 极老内核不支持时退化为仅事件同步 */ }
    syncSelectBox(select);
    trigger.addEventListener('click', event => {
      event.stopPropagation();
      if (select.disabled) return;
      const willOpen = !list.dataset.open;
      closeAllSelectBoxes();
      if (willOpen) list.dataset.open = '1';
    });
    list.addEventListener('click', event => {
      const option = event.target.closest('.select-box-option');
      if (!option || option.classList.contains('disabled')) return;
      select.selectedIndex = Number(option.dataset.optionIndex);
      delete list.dataset.open;
      syncSelectBox(select);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}

document.addEventListener('click', event => { if (!event.target.closest('.select-box')) closeAllSelectBoxes(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeAllSelectBoxes(); });

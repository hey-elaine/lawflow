const appState = { projects: [], selectedProjectId: null, selectedProject: null, selectedDocument: null, activeTab: 'materials', activePlan: null, editingContentId: null };
const SCENARIOS = {
  daily_brief: { name: '晨间 / 晚间法律速听', transform: 'condense', verification: 'source_only', duration: 5, audio: true, audience: '个人学习', narrativeLabel: '速听讲稿' },
  topic_learning: { name: '多源主题学习', transform: 'adapt', verification: 'material_check', duration: 10, audio: true, audience: '法律从业者与企业法务', narrativeLabel: '主题讲稿' },
  speaking_note: { name: '客户培训 / Speak Note', transform: 'enrich', verification: 'external_verify', duration: 20, audio: false, audience: '客户法务与业务团队', narrativeLabel: 'Speak Note' },
  legal_podcast: { name: '法律科普播客', transform: 'enrich', verification: 'external_verify', duration: 20, audio: true, audience: '行业听众与潜在客户', narrativeLabel: '播客讲稿' },
};
const TRANSFORM_NAMES = { condense: '内容精炼', adapt: '正常转译', enrich: '内容丰富' };
const VERIFICATION_NAMES = { source_only: '资讯转译', material_check: '材料一致性检查', external_verify: '外部事实核验' };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

async function request(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let detail = '请求失败，请稍后重试。';
    try { detail = (await response.json()).detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  return (response.headers.get('content-type') || '').includes('application/json') ? response.json() : response;
}

function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function formatDate(value) { try { return value ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value)) : ''; } catch (_) { return value || ''; } }
function statusText(status) { return ({ draft: '草稿', pending_review: '待律师审核', confirmed: '已确认', needs_revision: '待修改', discarded: '已废弃', open: '待处理', in_progress: '处理中', done: '已完成', dismissed: '已关闭' })[status] || status; }
function showMessage(message, error = false) { const box = $('#workspace-message'); box.textContent = message; box.className = error ? 'message error' : 'message'; setTimeout(() => box.classList.add('hidden'), 4800); }
function setBusy(button, busy, label = '处理中…') { if (!button) return; if (busy) { button.dataset.label = button.textContent; button.textContent = label; button.disabled = true; } else { button.textContent = button.dataset.label || button.textContent; button.disabled = false; } }

async function loadProjects() { appState.projects = await request('/api/projects'); renderProjectList(); }
function renderProjectList() {
  const list = $('#project-list');
  if (!appState.projects.length) { list.innerHTML = '<div class="empty-state"><b>还没有内容任务</b><p>选择学习或表达场景，开始整理法律资讯与实务资料。</p></div>'; return; }
  list.innerHTML = appState.projects.map(project => { const scenario = SCENARIOS[project.scenario] || SCENARIOS.topic_learning; return '<button class="project-card" data-project-id="' + project.id + '"><div class="project-card-top"><span class="tag">' + escapeHtml(scenario.name) + '</span><small>' + formatDate(project.updated_at) + '</small></div><h3>' + escapeHtml(project.name) + '</h3><p>' + escapeHtml(project.description || project.client_name || scenario.name) + '</p><div class="meta"><span>' + project.document_count + ' 份素材</span><span>' + (project.verification_mode === 'source_only' ? '无需核验' : project.task_count + ' 项核验') + '</span><span>' + project.target_duration + ' 分钟</span></div></button>'; }).join('');
  $$('.project-card', list).forEach(card => card.addEventListener('click', () => openProject(card.dataset.projectId)));
}

async function openProject(projectId) {
  try {
    appState.selectedProjectId = projectId;
    appState.selectedProject = await request('/api/projects/' + projectId);
    appState.selectedDocument = null;
    appState.activePlan = appState.selectedProject.plans[0] || null;
    $('#project-detail').classList.remove('hidden');
    renderProjectDetail();
    $('#project-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { showMessage(error.message, true); }
}

function renderProjectDetail() {
  const detail = $('#project-detail'); const data = appState.selectedProject; if (!data) return;
  const scenario = SCENARIOS[data.project.scenario] || SCENARIOS.topic_learning;
  const tabs = [['materials','素材库'],['plan','主题与结构']];
  if (data.project.verification_mode !== 'source_only') tabs.push(['tasks', data.project.verification_mode === 'external_verify' ? '核验与来源' : '材料核对']);
  if (data.project.verification_mode !== 'source_only') tabs.push(['review','审阅底稿']);
  tabs.push(['narrative', scenario.narrativeLabel]);
  if (data.project.audio_enabled) tabs.push(['audio','音频与导出']);
  if (!tabs.some(item => item[0] === appState.activeTab)) appState.activeTab = 'materials';
  detail.innerHTML = '<div class="detail-header"><div><p class="eyebrow">' + escapeHtml(scenario.name) + '</p><h2>' + escapeHtml(data.project.name) + '</h2><p>' + escapeHtml(data.project.client_name || data.project.description || scenario.description) + '</p><div class="task-preferences"><span>' + TRANSFORM_NAMES[data.project.transform_mode] + '</span><span>' + VERIFICATION_NAMES[data.project.verification_mode] + '</span><span>' + data.project.target_duration + ' 分钟目标时长</span></div></div><div class="detail-actions"><button class="button button-outline button-small" id="export-project">导出至本机目录</button><button class="button button-outline button-small" id="reload-project">刷新任务</button><button class="button button-danger button-small" id="delete-project">删除任务</button></div></div><div class="tabbar">' + tabs.map(([key,label]) => '<button data-tab="' + key + '" class="' + (appState.activeTab === key ? 'active' : '') + '">' + label + '</button>').join('') + '</div><div id="detail-panel" class="detail-panel"></div>';
  $$('.tabbar button', detail).forEach(button => button.addEventListener('click', () => { appState.activeTab = button.dataset.tab; renderProjectDetail(); }));
  $('#reload-project').addEventListener('click', () => openProject(data.project.id)); $('#export-project').addEventListener('click', exportProject); $('#delete-project').addEventListener('click', deleteProject); renderActivePanel();
}
function renderActivePanel() { if (appState.activeTab === 'materials') return renderMaterialsPanel(); if (appState.activeTab === 'plan') return renderPlanPanel(); if (appState.activeTab === 'review') return renderReviewPanel(); if (appState.activeTab === 'narrative') return renderNarrativePanel(); if (appState.activeTab === 'audio') return renderAudioPanel(); return renderTasksPanel(); }
function currentDocument() { const docs = appState.selectedProject.documents; return appState.selectedDocument || docs[0] || null; }
async function ensureDocumentLoaded(documentId) { if (appState.selectedDocument?.id === documentId && appState.selectedDocument.blocks) return appState.selectedDocument; appState.selectedDocument = await request('/api/documents/' + documentId); return appState.selectedDocument; }

function renderMaterialsPanel() {
  const panel = $('#detail-panel'); const docs = appState.selectedProject.documents;
  const scenario = SCENARIOS[appState.selectedProject.project.scenario] || SCENARIOS.topic_learning;
  panel.innerHTML = '<section class="panel-card"><h3>输入素材</h3><p>' + (appState.selectedProject.project.scenario === 'daily_brief' ? '导入一篇行业资讯、报道或公开材料，系统会将其精炼为适合碎片化收听的短讲稿。' : '导入单篇或多篇文章、判决、法规和实务笔记，系统会识别主题与结构，整理为可学习或可表达的内容。') + '</p><div class="source-input-grid"><label class="upload-zone"><input type="file" id="document-upload" accept=".docx,.txt,.md"/><div><b>上传文件</b><span>DOCX、TXT、Markdown</span></div></label><div class="paste-source"><b>粘贴文章或公开材料</b><input id="text-source-title" placeholder="素材标题，例如：某监管动态解读"/><input id="text-source-url" placeholder="来源链接（可选）"/><textarea id="text-source-content" placeholder="粘贴公众号正文、新闻报道、公开判决摘要或你的实务笔记…"></textarea><button class="button button-outline button-small" id="create-text-source">保存为素材</button></div></div><div class="doc-list">' + (docs.length ? docs.map(doc => '<div class="doc-row"><div><b>' + escapeHtml(doc.original_name) + '</b><small>' + doc.paragraph_count + ' 个段落 · ' + doc.block_count + ' 个素材块' + (doc.source_url ? ' · 已记录来源' : '') + '</small></div><button class="button button-outline button-small" data-view-document="' + doc.id + '">查看主题地图</button></div>').join('') : '<p class="form-note">尚未导入素材。你可以先导入一篇资讯，或多篇围绕同一主题的资料。</p>') + '</div></section><section class="panel-card" id="material-map-panel"><h3>主题地图</h3><p>选择一份已导入素材后，查看结构、主题信号、规范名称和可展开的内容方向。</p></section>';
  $('#document-upload').addEventListener('change', event => uploadDocument(event.target.files[0]));
  $('#create-text-source').addEventListener('click', createTextSource);
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

async function viewDocumentMap(documentId) {
  const box = $('#material-map-panel'); if (!box) return;
  try {
    box.innerHTML = '<h3>材料地图</h3><p>正在读取材料结构…</p>'; const doc = await ensureDocumentLoaded(documentId); const map = doc.material_map;
    const outline = map.outline.slice(0,22).map(item => '<button class="outline-item level-' + item.level + '" data-block-id="' + item.id + '">' + escapeHtml(item.title) + '</button>').join('');
    const topics = map.topics.map(item => '<span class="signal">' + escapeHtml(item.name) + ' · ' + item.mentions + '</span>').join('') || '<span class="signal">暂未识别</span>';
    const regs = map.regulations.slice(0,10).map(item => '<span class="signal">' + escapeHtml(item) + '</span>').join('') || '<span class="signal">暂未识别</span>';
    const risks = map.risk_candidates.slice(0,6).map(item => '<button class="risk-candidate" data-block-id="' + item.block_id + '"><small>' + escapeHtml(item.locator) + '</small>' + escapeHtml(item.excerpt) + '</button>').join('') || '<p class="form-note">当前未找到明显候选项。仍建议由律师结合项目背景审阅全文。</p>';
    box.innerHTML = '<h3>材料地图：' + escapeHtml(doc.original_name) + '</h3><p>' + escapeHtml(map.summary) + '</p><div class="map-grid"><div><h4>结构导航</h4><div class="outline-list">' + outline + '</div></div><div><h4>关注信号</h4><div class="signal-list">' + topics + '</div><h4>识别到的规范名称</h4><div class="signal-list">' + regs + '</div></div></div><h4>待核验候选项</h4><div>' + risks + '</div>';
    $$('[data-block-id]', box).forEach(button => button.addEventListener('click', () => showSourceBlock(doc.id, button.dataset.blockId)));
  } catch (error) { box.innerHTML = '<h3>材料地图</h3><p class="message error">' + escapeHtml(error.message) + '</p>'; }
}

async function showSourceBlock(documentId, blockId) { try { const block = await request('/api/documents/' + documentId + '/blocks/' + blockId); showSourceOverlay('材料块依据', '<h4>' + escapeHtml(block.source_locator) + '</h4><pre>' + escapeHtml(block.text) + '</pre>'); } catch (error) { showMessage(error.message, true); } }

function renderPlanPanel() {
  const panel = $('#detail-panel'); const docs = appState.selectedProject.documents;
  if (!docs.length) { panel.innerHTML = '<section class="panel-card"><h3>先导入素材</h3><p>主题与结构依赖已整理的源素材。请先在“素材库”中导入 DOCX、TXT 或 Markdown。</p></section>'; return; }
  const plan = appState.activePlan;
  const project = appState.selectedProject.project;
  const scenario = SCENARIOS[project.scenario] || SCENARIOS.topic_learning;
  const currentStyle = plan?.style_name || (project.scenario === 'speaking_note' ? '专业、克制、适合口头培训' : project.scenario === 'legal_podcast' ? '海问合规播客 / 深度博客风格' : '深入浅出、适合朗读');
  const presets = project.scenario === 'speaking_note' ? ['专业、克制、适合口头培训', '商业导向、重决策风险', '严谨合规、重法条与留痕'] : project.scenario === 'daily_brief' ? ['简洁、信息密度高、适合晨间速听', '自然、口语化、适合晚间收听'] : ['海问合规播客 / 深度博客风格', '专业法律博客', '深入浅出、通俗业务化'];

  panel.innerHTML = '<section class="panel-card"><h3>' + (project.scenario === 'daily_brief' ? '确认速听结构' : '确认主题与内容结构') + '</h3><p>当前场景：<b>' + scenario.name + '</b>。加工方式：<b>' + TRANSFORM_NAMES[project.transform_mode] + '</b>；核验策略：<b>' + VERIFICATION_NAMES[project.verification_mode] + '</b>；目标时长：<b>' + project.target_duration + ' 分钟</b>。</p>' +
    '<div class="plan-settings">' +
      '<div class="field"><label>源材料</label><select id="plan-document">' + docs.map(doc => '<option value="' + doc.id + '" ' + (plan?.document_id === doc.id ? 'selected' : '') + '>' + escapeHtml(doc.original_name) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>目标听众 / 读者</label><input id="plan-audience" value="' + escapeHtml(plan?.audience || scenario.audience) + '" /></div>' +
      '<div class="field full"><label>风格画像（点击预设快捷填入，也可自主编辑）</label>' +
        '<div class="style-preset-chips">' + presets.map(p => '<button type="button" class="preset-chip ' + (currentStyle === p ? 'active' : '') + '" data-set-style="' + escapeHtml(p) + '">' + escapeHtml(p) + '</button>').join('') + '</div>' +
        '<input id="plan-style" value="' + escapeHtml(currentStyle) + '" placeholder="选择上方预设或输入自定义风格，如：面向业务高管汇报，突出处罚风险与整改成本"/>' +
        '<small class="field-hint">风格画像将指导讲稿的表达节奏、术语解释方式和内容密度。</small>' +
      '</div>' +
      (project.audio_enabled ? '<div class="field full"><label class="check-label"><input type="checkbox" id="plan-audio" ' + (plan?.include_audio !== false ? 'checked' : '') + '/> 生成可朗读的音频脚本；讲稿确认后可在“音频与导出”中试听或调用 TTS</label></div>' : '<input type="hidden" id="plan-audio" value="false"/>') +
    '</div>' +
    '<div class="plan-actions"><button class="button button-primary" id="create-plan">✨ 生成内容结构</button>' + (plan ? '<button class="button button-outline" id="confirm-plan">确认内容结构</button>' : '') + '</div>' +
    '<div id="chapter-list" class="chapter-list">' + (plan ? renderChapters(plan.chapters) : '<p class="form-note">系统会按当前场景生成可编辑的主题或节目结构建议。</p>') + '</div>' +
  '</section>';

  $$('[data-set-style]', panel).forEach(chip => chip.addEventListener('click', () => {
    $$('.preset-chip', panel).forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    $('#plan-style').value = chip.dataset.setStyle;
  }));

  $('#create-plan').addEventListener('click', createPlan);
  if (plan) $('#confirm-plan').addEventListener('click', confirmPlan);
  bindChapterControls();
}
function formatChapterQuestion(chapter) {
  const q = chapter.question || '';
  if (!q || q.includes('这一部分对目标读者意味着什么') || q.includes('核心事实如何界定？涉及哪些合规差距')) {
    const t = chapter.title || '';
    if (t.includes('AI') || t.includes('伦理') || t.includes('算法')) return '人工智能应用在研发与落地各环节面临哪些伦理合规与治理要求？';
    if (t.includes('涉外') || t.includes('反制') || t.includes('管辖') || t.includes('出海')) return '涉外法规与域外管辖冲突下，企业跨国经营涉及哪些合规风险点与应对措施？';
    if (t.includes('数据') || t.includes('安全') || t.includes('跨境')) return '本章涉及哪些数据安全、技术处理或跨境流转义务？哪些事实需要先核实？';
    if (t.includes('背景') || t.includes('框架') || t.includes('政策')) return '本章梳理了哪些关键监管动向和规则框架？背后的核心监管逻辑是什么？';
    if (t.includes('总体影响') || t.includes('趋势')) return '从本章规则与执法趋势看，企业未来的经营模式和治理重点会如何变化？';
    return '围绕本章梳理关键事实与规则表述，重点核查哪些边界条件与落地任务？';
  }
  return q;
}
function renderChapters(chapters) { return chapters.map(chapter => '<div class="chapter-row ' + (chapter.enabled === false ? 'disabled' : '') + '" data-chapter-id="' + chapter.id + '" data-source-blocks="' + escapeHtml(JSON.stringify(chapter.source_block_ids)) + '"><input class="chapter-enabled" type="checkbox" ' + (chapter.enabled !== false ? 'checked' : '') + '/><div><input class="chapter-title" type="text" value="' + escapeHtml(chapter.title) + '"/><small>' + escapeHtml(formatChapterQuestion(chapter)) + '</small><span class="source-count">' + chapter.source_block_ids.length + ' 个材料块</span></div><button class="button button-outline button-small chapter-preview" type="button">查看依据</button></div>').join(''); }
function bindChapterControls() { $$('.chapter-enabled').forEach(input => input.addEventListener('change', () => input.closest('.chapter-row').classList.toggle('disabled', !input.checked))); $$('.chapter-preview').forEach(button => button.addEventListener('click', async () => { const row = button.closest('.chapter-row'); const doc = await ensureDocumentLoaded($('#plan-document').value); const ids = JSON.parse(row.dataset.sourceBlocks); const blocks = doc.blocks.filter(block => ids.includes(block.id)).slice(0,10); showSourceOverlay('章节依据预览', blocks.map(block => '<h4>' + escapeHtml(block.source_locator) + '</h4><pre>' + escapeHtml(block.text) + '</pre>').join('')); })); }

async function createPlan() {
  const button = $('#create-plan'); try { const scenario = SCENARIOS[appState.selectedProject.project.scenario] || SCENARIOS.topic_learning; setBusy(button, true); const body = { source_document_id: $('#plan-document').value, audience: $('#plan-audience').value.trim() || scenario.audience, output_type: scenario.scenario === 'speaking_note' ? 'client_brief' : 'lexcast', style_name: $('#plan-style').value.trim() || '深入浅出、适合朗读', include_audio: $('#plan-audio')?.checked || false }; const plan = await request('/api/projects/' + appState.selectedProject.project.id + '/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id); appState.activePlan = appState.selectedProject.plans.find(item => item.id === plan.id) || plan; renderProjectDetail(); showMessage('已生成内容结构建议。请编辑、删减后确认。'); } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); }
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

function renderNarrativeHtml(markdown = '') {
  let html = '';
  markdown.split('\n').forEach(line => {
    const val = line.trim();
    if (!val) return;
    let match;
    if ((match = val.match(/^# (.+)$/))) html += '<h1>' + escapeHtml(match[1]) + '</h1>';
    else if ((match = val.match(/^## (.+)$/))) html += '<h2>' + escapeHtml(match[1]) + '</h2>';
    else if ((match = val.match(/^### (.+)$/))) html += '<h3>' + escapeHtml(match[1]) + '</h3>';
    else if ((match = val.match(/^- (.+)$/))) html += '<div class="memo-bullet"><span>—</span><span>' + escapeHtml(match[1]) + '</span></div>';
    else html += '<p>' + escapeHtml(val) + '</p>';
  });
  return html;
}

function renderNarrativePanel() {
  const panel = $('#detail-panel');
  const docs = appState.selectedProject.documents;
  const outlines = appState.selectedProject.narrative_outlines || [];
  const contents = appState.selectedProject.narrative_contents || [];
  const project = appState.selectedProject.project;
  const scenario = SCENARIOS[project.scenario] || SCENARIOS.topic_learning;
  if (!docs.length) {
    panel.innerHTML = '<section class="panel-card"><h3>' + scenario.narrativeLabel + '</h3><p>请先导入素材，并在“主题与结构”中确认需要展开的内容范围。</p></section>';
    return;
  }
  const latestPlan = appState.activePlan || appState.selectedProject.plans.find(plan => plan.status === 'confirmed');
  const defaultDocId = latestPlan?.document_id || docs[0].id;
  const defaultChapter = latestPlan?.chapters?.find(chapter => chapter.enabled !== false);
  const lengthOptions = project.target_duration <= 5 ? '<option value="short" selected>短篇 · 适合 ' + project.target_duration + ' 分钟收听</option><option value="standard">标准 · 适合主题学习</option>' : '<option value="short">短篇 · 约 1,800 字</option><option value="standard" selected>标准 · 约 3,800 字</option><option value="deep">深度 · 约 7,000 字</option>';
  panel.innerHTML = '<section class="panel-card narrative-intro"><div><p class="eyebrow">' + scenario.name + '</p><h3>' + scenario.narrativeLabel + '</h3><p>先为选定素材生成结构，再形成可修改的讲稿。当前将按“' + TRANSFORM_NAMES[project.transform_mode] + '”和“' + VERIFICATION_NAMES[project.verification_mode] + '”执行。</p></div><span class="tag">先结构 · 后讲稿</span></section>' +
    '<section class="panel-card"><h3>新建' + scenario.narrativeLabel + '</h3><div class="narrative-form"><div class="field"><label>源素材</label><select id="narrative-document">' + docs.map(doc => '<option value="' + doc.id + '" ' + (doc.id === defaultDocId ? 'selected' : '') + '>' + escapeHtml(doc.original_name) + '</option>').join('') + '</select></div><div class="field"><label>讲稿标题</label><input id="narrative-title" value="' + escapeHtml(defaultChapter?.title?.replace(/^第\d+章\s*·\s*/, '') || docs[0].original_name.replace(/\.[^.]+$/, '')) + '" /></div><div class="field"><label>目标听众</label><input id="narrative-audience" value="' + escapeHtml(scenario.audience) + '" /></div><div class="field"><label>内容深度</label><select id="narrative-length">' + lengthOptions + '</select></div><div class="field full"><label>写作画像</label><select id="narrative-profile"><option value="law_podcast_v4">海问合规播客 / 深度博客风格</option><option value="professional_blog">专业法律博客</option><option value="client_explainer">客户可读解读</option><option value="internal_training">内部培训讲稿</option></select><small class="field-hint">系统只把选定素材块发送给模型；对外交流内容仍需在核验与来源页完成审阅。</small></div><div class="field full"><label>素材范围</label><div class="narrative-scope"><label class="check-label"><input type="radio" name="narrative-scope" value="chapter" checked/> 使用当前结构范围</label><label class="check-label"><input type="radio" name="narrative-scope" value="document"/> 使用整份素材前 120 个正文块</label></div></div></div><div class="plan-actions"><button class="button button-primary" id="create-narrative-outline">✨ 生成内容结构</button></div></section>' +
    '<section class="panel-card" id="narrative-outline-area"><h3>内容结构</h3><p class="form-note">尚未生成结构。请确认已在“本地设置”中配置模型服务与允许发送原始材料。</p><div style="margin-top:10px;"><button class="button button-outline button-small" id="open-settings-narrative">⚙️ 打开模型设置</button></div></section>' +
    '<section class="panel-card"><h3>已生成的' + scenario.narrativeLabel + '</h3><div class="narrative-content-list">' + (contents.length ? contents.map(renderNarrativeContentCard).join('') : '<p class="form-note">尚未生成讲稿。请先生成并确认内容结构。</p>') + '</div></section>';

  $('#create-narrative-outline').addEventListener('click', createNarrativeOutline);
  $('#open-settings-narrative')?.addEventListener('click', () => $('#open-settings').click());

  if (outlines.length) {
    renderNarrativeOutline(outlines[0]);
  }
  bindNarrativeContentEvents();
}

function bindNarrativeContentEvents() {
  $$('[data-toggle-narrative-view]').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.toggleNarrativeView;
    appState.narrativeEditing = appState.narrativeEditing || {};
    appState.narrativeEditing[id] = !appState.narrativeEditing[id];
    renderNarrativePanel();
  }));
  $$('[data-export-narrative]').forEach(button => button.addEventListener('click', () => exportNarrative(button.dataset.exportNarrative, button)));
  $$('[data-save-narrative]').forEach(button => button.addEventListener('click', () => saveNarrative(button.dataset.saveNarrative, button)));
}

function renderNarrativeOutline(record) {
  const area = $('#narrative-outline-area');
  if (!area) return;
  const outline = record.outline || {};
  const sections = outline.sections || [];
  const isConfirmed = record.status === 'confirmed';
  const statusBadge = isConfirmed ? '<span class="tag confirmed">● 大纲已确认</span>' : '<span class="tag">待确认大纲</span>';
  const actionButtons = isConfirmed ?
    '<button class="button button-outline button-small" id="reedit-narrative-outline">重新调整大纲</button><button class="button button-primary button-small" data-generate-narrative="' + record.id + '">✨ 开始逐节生成长文</button>' :
    '<button class="button button-outline button-small" id="discard-narrative-outline">取消</button><button class="button button-primary button-small" id="confirm-narrative-outline">确认大纲并生成长文</button>';

  area.innerHTML = '<div class="outline-header"><div><p class="eyebrow">' + (isConfirmed ? '大纲已就绪' : '待确认大纲') + '</p><h3>' + escapeHtml(outline.title || record.title) + '</h3><p>' + escapeHtml(outline.opening_angle || '模型未返回开场角度。') + '</p></div>' + statusBadge + '</div><div class="narrative-outline-list">' + sections.map((section, index) => '<div class="narrative-outline-section"><span>' + String(index + 1).padStart(2, '0') + '</span><div><input class="narrative-section-heading" data-section-id="' + section.id + '" value="' + escapeHtml(section.heading) + '"/><p>' + escapeHtml(section.purpose || '') + '</p><small>' + section.source_block_ids.length + ' 个材料块 · 约 ' + section.target_words + ' 字</small></div></div>').join('') + '</div><div class="plan-actions">' + actionButtons + '</div>';

  if (!isConfirmed) {
    $('#discard-narrative-outline')?.addEventListener('click', () => { area.innerHTML = '<h3>写作大纲</h3><p class="form-note">已取消本次大纲。你可以调整标题、篇幅或材料范围后重新生成。</p>'; });
    $('#confirm-narrative-outline')?.addEventListener('click', () => confirmNarrativeOutline(record));
  } else {
    $('#reedit-narrative-outline')?.addEventListener('click', () => {
      record.status = 'draft';
      renderNarrativeOutline(record);
    });
    $('[data-generate-narrative]')?.addEventListener('click', event => generateNarrative(record.id, event.currentTarget));
  }
}

async function createNarrativeOutline() {
  const button = $('#create-narrative-outline');
  try {
    setBusy(button, true, '正在规划大纲…');
    const documentId = $('#narrative-document').value;
    const doc = await ensureDocumentLoaded(documentId);
    const scope = $('input[name="narrative-scope"]:checked').value;
    let sourceBlockIds;
    if (scope === 'chapter' && appState.activePlan?.document_id === documentId) {
      sourceBlockIds = (appState.activePlan.chapters || []).find(chapter => chapter.enabled !== false)?.source_block_ids || [];
    } else {
      sourceBlockIds = doc.blocks.filter(block => block.kind === 'paragraph').slice(0, 120).map(block => block.id);
    }
    if (!sourceBlockIds.length) throw new Error('当前范围内没有可用于写作的正文材料。');
    const payload = { document_id: documentId, source_plan_id: appState.activePlan?.id || '', title: $('#narrative-title').value.trim(), source_block_ids: sourceBlockIds, audience: $('#narrative-audience').value.trim() || '法律从业者与企业法务', style_profile: $('#narrative-profile').value, target_length: $('#narrative-length').value };
    const outline = await request('/api/projects/' + appState.selectedProject.project.id + '/narrative-outlines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id);
    const record = appState.selectedProject.narrative_outlines.find(item => item.id === outline.id) || outline;
    renderNarrativeOutline(record);
    showMessage('写作大纲已生成。请先检查章节结构和材料范围。');
  } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); }
}

async function confirmNarrativeOutline(record) {
  const button = $('#confirm-narrative-outline');
  try {
    const outline = structuredClone(record.outline);
    $$('.narrative-section-heading').forEach(input => { const section = outline.sections.find(item => item.id === input.dataset.sectionId); if (section) section.heading = input.value.trim() || section.heading; });
    setBusy(button, true, '确认中…');
    await request('/api/narrative-outlines/' + record.id + '/confirm', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outline }) });
    appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id);
    const updated = appState.selectedProject.narrative_outlines.find(item => item.id === record.id);
    renderNarrativeOutline(updated);
    showMessage('大纲已确认。你可以立即点击“开始逐节生成长文”。');
  } catch (error) { showMessage(error.message, true); } finally { if (button?.isConnected) setBusy(button, false); }
}

async function generateNarrative(outlineId, button) {
  try {
    setBusy(button, true, '逐节写作中（较耗时）…');
    await request('/api/narrative-outlines/' + outlineId + '/contents', { method: 'POST' });
    appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id);
    renderProjectDetail();
    showMessage('知识转译成稿已生成！可直接阅读排版或导出 DOCX。');
  } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); }
}

function renderNarrativeContentCard(content) {
  appState.narrativeEditing = appState.narrativeEditing || {};
  const isEditing = !!appState.narrativeEditing[content.id];
  const viewToggleText = isEditing ? '👁️ 查看排版' : '✏️ 修改正文';
  const bodyContent = isEditing ?
    '<textarea class="narrative-editor" data-narrative-editor="' + content.id + '">' + escapeHtml(content.markdown) + '</textarea>' :
    '<div class="narrative-article">' + renderNarrativeHtml(content.markdown) + '</div>';

  return '<article class="narrative-content-card"><div class="content-card-header"><div><p class="doc-kicker">知识转译成稿 · 深度长文</p><h3>' + escapeHtml(content.title) + '</h3><small>模型：' + escapeHtml(content.model?.model_name || '未记录') + ' · <span class="status ' + content.status + '">' + statusText(content.status) + '</span></small></div><div class="detail-actions"><button class="button button-outline button-small" data-toggle-narrative-view="' + content.id + '">' + viewToggleText + '</button><button class="button button-outline button-small" data-export-narrative="' + content.id + '">导出 DOCX</button>' + (isEditing ? '<button class="button button-primary button-small" data-save-narrative="' + content.id + '">保存修改</button>' : '') + '</div></div>' + bodyContent + '<div class="review-bar"><span class="review-note">' + escapeHtml(content.review_note || '已生成深度叙事稿，支持直接在线修改与导出 Word。') + '</span></div></article>';
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
  panel.innerHTML = '<section class="panel-card audio-intro"><p class="eyebrow">音频输出</p><h3>音频脚本与收听</h3><p>先将已确认的讲稿转换为适合朗读的音频脚本。可直接使用浏览器朗读试听；配置 TTS 服务后可生成并下载 MP3。</p></section><section class="panel-card"><h3>从讲稿生成音频脚本</h3>' + (contents.length ? '<div class="audio-source-list">' + contents.map(content => '<div class="doc-row"><div><b>' + escapeHtml(content.title) + '</b><small>' + escapeHtml(content.model?.scenario || '') + ' · ' + escapeHtml(content.model?.target_duration || '') + ' 分钟目标时长</small></div><button class="button button-primary button-small" data-create-audio-script="' + content.id + '">生成音频脚本</button></div>').join('') + '</div>' : '<p class="form-note">请先在“' + (SCENARIOS[appState.selectedProject.project.scenario] || SCENARIOS.topic_learning).narrativeLabel + '”中生成讲稿。</p>') + '</section><section class="panel-card"><h3>音频脚本与文件</h3><div class="audio-output-list">' + (outputs.length ? outputs.map(renderAudioOutput).join('') : '<p class="form-note">尚未生成音频脚本。</p>') + '</div></section>';
  $$('[data-create-audio-script]').forEach(button => button.addEventListener('click', () => createAudioScript(button.dataset.createAudioScript, button)));
  $$('[data-speak-script]').forEach(button => button.addEventListener('click', () => speakAudioScript(button.dataset.speakScript, button)));
  $$('[data-synthesize-audio]').forEach(button => button.addEventListener('click', () => synthesizeAudio(button.dataset.synthesizeAudio, button)));
  $$('[data-export-audio]').forEach(button => button.addEventListener('click', () => exportAudioOutput(button.dataset.exportAudio, button)));
}

function renderAudioOutput(output) {
  const player = output.audio_available ? '<audio controls src="/api/audio-outputs/' + output.id + '/stream"></audio>' : '';
  return '<article class="audio-output-card"><div><span class="tag">' + (output.status === 'ready' ? 'MP3 已生成' : '音频脚本') + '</span><h4>' + escapeHtml(output.title) + '</h4><p>' + escapeHtml(output.script.slice(0, 180)) + (output.script.length > 180 ? '…' : '') + '</p></div><div class="audio-actions">' + player + '<button class="button button-outline button-small" data-speak-script="' + output.id + '">浏览器试听</button>' + (output.audio_available ? '' : '<button class="button button-primary button-small" data-synthesize-audio="' + output.id + '">生成 MP3</button>') + '<button class="button button-outline button-small" data-export-audio="' + output.id + '">导出脚本</button></div></article>';
}

async function createAudioScript(contentId, button) {
  try { setBusy(button, true, '整理脚本…'); await request('/api/projects/' + appState.selectedProject.project.id + '/audio-scripts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ narrative_content_id: contentId }) }); appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id); renderAudioPanel(); showMessage('音频脚本已生成，可浏览器试听或调用 TTS。'); } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); }
}

async function speakAudioScript(audioId, button) {
  try { const output = await request('/api/audio-outputs/' + audioId); if (!('speechSynthesis' in window)) throw new Error('当前浏览器不支持语音试听。'); window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(output.script); utterance.lang = 'zh-CN'; utterance.rate = 1; window.speechSynthesis.speak(utterance); button.textContent = '正在试听…'; utterance.onend = () => { button.textContent = '浏览器试听'; }; } catch (error) { showMessage(error.message, true); }
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
  const title = verification === 'external_verify' ? '核验与来源' : '材料一致性检查';
  const intro = verification === 'external_verify' ? '对外培训、Speak Note 和公开播客应先确认关键事实、权威来源、责任人和完成时间。未确认项不应进入正式发布稿。' : '系统在已选素材中识别重复、冲突、日期差异和待确认表述，帮助你在转译前理顺资料边界。';
  const rows = tasks.map(task => '<tr data-task-id="' + task.id + '"><td><b>' + escapeHtml(task.title) + '</b><br/><small>' + escapeHtml(task.detail) + '</small></td><td class="risk-' + task.risk_level + '">' + ({ high:'高', medium:'中', low:'低' }[task.risk_level] || task.risk_level) + '</td><td><select class="task-status"><option value="open" ' + (task.status === 'open' ? 'selected' : '') + '>待处理</option><option value="in_progress" ' + (task.status === 'in_progress' ? 'selected' : '') + '>处理中</option><option value="done" ' + (task.status === 'done' ? 'selected' : '') + '>已完成</option><option value="dismissed" ' + (task.status === 'dismissed' ? 'selected' : '') + '>关闭</option></select></td><td><input class="task-owner" value="' + escapeHtml(task.owner) + '" placeholder="待分配"/></td><td><input class="task-due" type="date" value="' + escapeHtml(task.due_date) + '"/></td><td><button class="button button-outline button-small task-evidence" data-task-evidence="' + escapeHtml(task.evidence_block_ids.join(',')) + '">查看</button></td><td><button class="button button-primary button-small save-task">保存</button></td></tr>').join('');
  panel.innerHTML = '<section class="panel-card workflow-gate"><p class="eyebrow">第三步 · ' + (verification === 'external_verify' ? '发布前核验' : '素材一致性检查') + '</p><h3>' + title + '</h3><p>' + intro + '</p>' + (tasks.length ? '<div class="task-table-wrap"><table class="task-table"><thead><tr><th>事项</th><th>风险</th><th>状态</th><th>负责人</th><th>截止时间</th><th>材料依据</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="form-note">请先在“主题与结构”中确认范围，系统会在确认后自动生成检查清单。</p>') + '</section>';
  $$('.save-task').forEach(button => button.addEventListener('click', () => saveTask(button.closest('tr')))); $$('[data-task-evidence]').forEach(button => button.addEventListener('click', async () => { const doc = currentDocument(); if (!doc) return; await ensureDocumentLoaded(doc.id); const ids = button.dataset.taskEvidence.split(',').filter(Boolean); const blocks = appState.selectedDocument.blocks.filter(block => ids.includes(block.id)); showSourceOverlay('任务材料依据', blocks.map(block => '<h4>' + escapeHtml(block.source_locator) + '</h4><pre>' + escapeHtml(block.text) + '</pre>').join('')); }));
}
async function saveTask(row) { const button = $('.save-task', row); try { setBusy(button, true, '保存…'); await request('/api/tasks/' + row.dataset.taskId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: $('.task-status', row).value, owner: $('.task-owner', row).value.trim(), due_date: $('.task-due', row).value }) }); appState.selectedProject = await request('/api/projects/' + appState.selectedProject.project.id); renderProjectDetail(); showMessage('任务已保存。'); } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); } }
async function exportProject() { const button = $('#export-project'); try { setBusy(button, true, '正在导出…'); const output = await request('/api/projects/' + appState.selectedProject.project.id + '/exports', { method: 'POST' }); showMessage('成果包已写入：' + output.output_dir); } catch (error) { showMessage(error.message, true); } finally { setBusy(button, false); } }
async function deleteProject() { const project = appState.selectedProject?.project; if (!project) return; const confirmed = window.confirm('删除项目“' + project.name + '”？\n\n项目中的原始材料、章节方案、工作备忘录和任务记录将从本机工作目录删除。已经导出的成果包不会删除。'); if (!confirmed) return; const button = $('#delete-project'); try { setBusy(button, true, '删除中…'); await request('/api/projects/' + project.id, { method: 'DELETE' }); appState.selectedProjectId = null; appState.selectedProject = null; appState.selectedDocument = null; appState.activePlan = null; $('#project-detail').classList.add('hidden'); $('#project-detail').innerHTML = ''; await loadProjects(); showMessage('项目已删除。'); } catch (error) { showMessage(error.message, true); } finally { if (button?.isConnected) setBusy(button, false); } }
function showSourceOverlay(title, html) { const overlay = document.createElement('div'); overlay.className = 'source-modal'; overlay.innerHTML = '<div class="source-modal-card"><div class="source-modal-top"><div><p class="eyebrow">原始材料依据</p><h3>' + escapeHtml(title) + '</h3></div><button class="icon-button" aria-label="关闭">×</button></div><div>' + html + '</div></div>'; $('.icon-button', overlay).addEventListener('click', () => overlay.remove()); overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); }); document.body.appendChild(overlay); }

function bindDialogs() {
  $('#new-project').addEventListener('click', () => $('#project-dialog').showModal());
  $$('input[name="scenario"]').forEach(input => input.addEventListener('change', () => {
    const config = SCENARIOS[input.value];
    const form = $('#project-form');
    form.elements.transform_mode.value = config.transform;
    form.elements.verification_mode.value = config.verification;
    form.elements.target_duration.value = String(config.duration);
    form.elements.audio_enabled.value = String(config.audio);
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
      body.audio_enabled = body.audio_enabled === 'true';
      body.target_duration = Number(body.target_duration || 10);
      const project = await request('/api/projects', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
      $('#project-dialog').close();
      formEl.reset();
      await loadProjects();
      await openProject(project.id);
      showMessage('项目已创建。现在可以导入材料。');
    } catch(error) {
      showMessage(error.message, true);
    } finally {
      setBusy(submit, false);
    }
  });
  $('#open-settings').addEventListener('click', async () => {
    try {
      const [config, exportConfig] = await Promise.all([request('/api/settings/provider'), request('/api/settings/export')]);
      const form = $('#settings-form');
      ['provider_name','base_url','model_name','api_key','tts_base_url','tts_model','tts_voice','tts_api_key'].forEach(key => { if(config[key]) form.elements[key].value = config[key]; });
      form.elements.allow_source_upload.checked = !!config.allow_source_upload;
      form.elements.output_directory.value = exportConfig.output_directory || exportConfig.default_directory || '';
      $('#settings-dialog').showModal();
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
  if (copy) copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText('$lawflow'); showMessage('已复制 $lawflow。'); } catch (_) { showMessage('浏览器未授权剪贴板，请手动复制。', true); } });
}
async function boot() { bindDialogs(); initHomeSkillSection(); try { await loadProjects(); } catch (error) { showMessage('无法连接本地服务：' + error.message, true); } }
document.addEventListener('DOMContentLoaded', boot);

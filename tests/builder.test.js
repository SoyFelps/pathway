const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const builder = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

test('empty flow-canvas background pans both axes without hijacking node or connection gestures', () => {
  assert.match(builder, /bindCanvasPan\(workspace\)/);
  assert.match(builder, /event\.target\.closest\('\.node, \.port, \.target-port, \.edge-path, \.edge-hit, \.canvas-toolbar, button, input, textarea, select'\)/);
  assert.match(builder, /workspace\.scrollLeft = pan\.left - \(event\.clientX - pan\.x\)/);
  assert.match(builder, /workspace\.scrollTop = pan\.top - \(event\.clientY - pan\.y\)/);
  assert.match(builder, /setPointerCapture\(event\.pointerId\)/);
  assert.match(builder, /releasePointerCapture\(pointerId\)/);
  assert.match(builder, /Drag background to pan, nodes to arrange, ports to connect/);
  assert.match(styles, /\.workspace\{cursor:grab/);
  assert.match(styles, /\.workspace\.is-panning\{cursor:grabbing/);
});

test('canvas instruction behind Add a step is removed while transient status remains available', () => {
  assert.ok(builder.includes('<div class="canvas-status" id="canvas-status"></div>'));
  assert.doesNotMatch(builder, /Drag empty background to move around · Drag a connection point to another step/);
  assert.match(builder, /function setStatus\(text\)/);
  assert.match(styles, /#canvas-status:empty\{display:none\}/);
});

test('editor canvas element does not shadow workspace data used by its header', () => {
  const start = builder.indexOf('function renderEditor()');
  const end = builder.indexOf('function bindCanvasPan(', start);
  const editor = builder.slice(start, end);
  assert.match(builder, /let workspace = null;/);
  assert.match(editor, /workspaceSwitcherHtml\(\)/);
  assert.match(editor, /const workspaceElement = document\.getElementById\('workspace'\)/);
  assert.match(editor, /bindCanvasPan\(workspaceElement\)/);
  assert.doesNotMatch(editor, /const workspace\s*=/);
});

test('flow creation and editing hide the sidebar, restoring it when creation is cancelled', () => {
  const editorStart = builder.indexOf('function renderEditor()');
  const editorEnd = builder.indexOf('function bindCanvasPan(', editorStart);
  const editor = builder.slice(editorStart, editorEnd);
  const createStart = builder.indexOf('function showNewFlow()');
  const createEnd = builder.indexOf('function showFlowMenu(', createStart);
  const createFlow = builder.slice(createStart, createEnd);

  assert.doesNotMatch(editor, /renderSidebar\('dashboard'\)|bindSidebar\(\)/);
  assert.match(editor, /<div class="workspace-body"><main class="editor-main">/);
  assert.match(createFlow, /classList\.add\('is-creating-flow'\)/);
  assert.match(createFlow, /openFlow\(flow\.id\)/);
  assert.match(builder, /function closeModal\(\) \{[^}]*classList\.remove\('is-creating-flow'\)/);
  assert.match(styles, /\.app-shell\.is-creating-flow \.app-sidebar\{display:none\}/);
});

test('job details are shown only when the fixed candidate-details node is selected', () => {
  const start = builder.indexOf('function drawInspector()');
  const end = builder.indexOf('function updateNodeLabel(', start);
  const inspector = builder.slice(start, end);
  assert.match(inspector, /const roleSettings = selected\.type === 'candidateInfo'/);
  assert.match(inspector, /<h2>Job details<\/h2>/);
  assert.match(inspector, /panel\.innerHTML = `\$\{roleSettings\}/);
  assert.match(inspector, /<div class="inspector-kicker">Selected step<\/div>/);
  assert.match(inspector, /querySelector\('#role-company-profile'\)\?\./);
  assert.match(inspector, /companyOptionsHtml\(flow\.companyId/);
});

test('My Companies is permission-gated, limited to three profiles, and exposes capped image uploads', () => {
  assert.match(builder, /data-route="my-companies"/);
  assert.match(builder, /function renderMyCompanies\(\)/);
  assert.match(builder, /companies\.length >= 3/);
  assert.match(builder, /type="file" accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(builder, /Maximum 2 MB/);
  assert.match(builder, /company\.logoUrl/);
  assert.match(builder, /flow\.companyProfile = companySnapshot\(company\)/);
  assert.match(builder, /C\.createFlow\(company\?\.name \|\| workspace\.name/);
  assert.match(builder, /flow\.companyName = company\?\.name \|\| workspace\.name/);
});

test('short-answer nodes expose an accessible numeric-only switch', () => {
  const start = builder.indexOf('function drawInspector()');
  const end = builder.indexOf('function updateNodeLabel(', start);
  const inspector = builder.slice(start, end);
  assert.match(inspector, /selected\.type === 'shortText'[\s\S]*?class="numeric-only-toggle"[\s\S]*?role="switch"/);
  assert.match(inspector, /numericToggle\?\.addEventListener\('change',[\s\S]*selected\.numericOnly = event\.target\.checked/);
  assert.match(builder, /node\.numericOnly \? 'Number response'[\s\S]*?: 'Open-ended response'/);
  assert.match(styles, /\.numeric-only-switch input:checked\+\.numeric-only-track/);
  assert.match(styles, /\.answer-text\[data-numeric-only=true\]/);
});

test('the job editor has a Back button to the dashboard instead of the "My flows" breadcrumb', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
  assert.ok(src.includes('<button class="btn btn-sm crumb-back" id="dashboard-back" type="button" aria-label="Back to the dashboard">← Back</button><span class="crumb-title">'));
  assert.equal(src.includes('>My flows</button>'), false);
  assert.equal(src.includes('crumb-chevron'), false);
});

test('deleting a step offers an Undo that lasts only until the next action', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
  const del = src.slice(src.indexOf('function deleteNode(id) {'), src.indexOf('function openPreview() {'));
  assert.match(del, /const snapshot = JSON\.parse\(JSON\.stringify\(\{ nodes: flow\.nodes, edges: flow\.edges \}\)\)/, 'the flow is saved before the step goes away');
  assert.match(del, /offerUndoDelete\(currentId, snapshot, selectedBefore\)/);
  assert.equal(del.includes("showToast('Step deleted."), false, 'the old toast is replaced by the Undo bar');
  assert.match(src, /\['pointerdown', 'keydown'\]\.forEach\(type => document\.addEventListener\(type, event => \{[\s\S]*clearUndoDelete\(\);[\s\S]*\}, true\)\);/, 'a click on something else or a key removes the offer');
  const undoBlock = src.slice(src.indexOf('let undoDelete = null;'), src.indexOf("window.addEventListener('hashchange', clearUndoDelete);"));
  assert.equal(undoBlock.includes('wheel'), false, 'scrolling does not remove the offer');
  assert.match(src, /type === 'pointerdown' && target && target\.closest\('#workspace'\) && !target\.closest\(CANVAS_THINGS\)\) return;/, 'dragging the empty canvas background does not remove it');
  assert.match(src, /closest\('#undo-delete-bar'\)\) return;/, 'using the Undo button itself does not remove it first');
  assert.match(src, /window\.addEventListener\('hashchange', clearUndoDelete\);/);
  assert.match(src, /function setRoute\(route\) \{\n    const hash = `#\$\{route\}`;[\s\S]*?if \(window\.location\.hash !== hash\) clearUndoDelete\(\);/, 'another page removes it, but the automatic save refreshing the SAME address does not (that removed it after about a second)');
  assert.match(src, /clearUndoDelete\(\); currentId = id;/, 'opening a job removes it');
  assert.match(src, /flow\.nodes = state\.snapshot\.nodes; flow\.edges = state\.snapshot\.edges;/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8'), /\.undo-bar\{position:fixed;/);
});

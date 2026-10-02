const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const builder = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

test('empty flow-canvas background pans both axes without hijacking node or connection gestures', () => {
  assert.match(builder, /bindCanvasPan\(workspace\)/);
  assert.match(builder, /event\.target\.closest\('\.node, \.port, \.target-port, \.edge-path, \.canvas-toolbar, button, input, textarea, select'\)/);
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
  assert.match(editor, /esc\(workspace\.name\)/);
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
  assert.match(inspector, /querySelector\('#role-company'\)\?\./);
});

test('short-answer nodes expose an accessible numeric-only switch', () => {
  const start = builder.indexOf('function drawInspector()');
  const end = builder.indexOf('function updateNodeLabel(', start);
  const inspector = builder.slice(start, end);
  assert.match(inspector, /selected\.type === 'shortText'[\s\S]*?class="numeric-only-toggle"[\s\S]*?role="switch"/);
  assert.match(inspector, /numericToggle\?\.addEventListener\('change',[\s\S]*selected\.numericOnly = event\.target\.checked/);
  assert.match(builder, /node\.numericOnly \? 'Number response' : 'Open-ended response'/);
  assert.match(styles, /\.numeric-only-switch input:checked\+\.numeric-only-track/);
  assert.match(styles, /\.answer-text\[type=number\]/);
});

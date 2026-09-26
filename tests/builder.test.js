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

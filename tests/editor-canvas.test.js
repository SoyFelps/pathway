const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const builder = read('builder.js');
const styles = read('styles.css');

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const next = source.indexOf('\n  function ', start + 10);
  return source.slice(start, next > 0 ? next : undefined);
}

test('moving a step is saved quietly and never counts as an unpublished change', () => {
  assert.match(functionBody(builder, 'endDrag'), /save\(\{ internal: true \}\)/);
  const migration = read('supabase/migrations/20261022120000_flow_updated_at_ignores_layout.sql');
  assert.match(migration, /create or replace function public\.set_flow_updated_at\(\)/);
  assert.match(migration, /n - 'x' - 'y'/, 'the position of the steps is ignored by the database');
  assert.match(migration, /'responsible_user_ids'/, 'the responsible people stay ignored');
  assert.doesNotMatch(migration, /create table/i, 'no new table, so no new grants');
});

test('a new step appears loose in the visible part of the canvas: no connection is touched', () => {
  const body = functionBody(builder, 'addNode');
  assert.doesNotMatch(body, /edges/, 'adding a step never rewires the journey');
  assert.doesNotMatch(body, /primaryEnd/);
  assert.match(body, /newNodeSpot\(flow\)/);
  assert.doesNotMatch(body, /renderEditor\(\)/, 'redrawing the whole editor would reset the scroll position');
  const spot = functionBody(builder, 'newNodeSpot');
  assert.match(spot, /scrollLeft/);
  assert.match(spot, /clientWidth/);
});

test('connections arrive on the left of a step and leave on the right', () => {
  assert.match(styles, /\.target-port\{position:absolute;top:50%;left:-6px;transform:translateY\(-50%\)/);
  assert.match(styles, /\.node-ports\{position:absolute;top:0;bottom:0;right:0;width:0\}/);
  assert.match(builder, /node\.type === 'candidateInfo' \? '' : `<span class="target-port"/, 'the fixed first step receives nothing');
});

test('a connection has a wide invisible hit area and turns red when pointed at', () => {
  const wires = functionBody(builder, 'drawWires');
  assert.match(wires, /'edge-hit'/);
  assert.match(wires, /Click to remove · drag onto another step to move it/);
  assert.match(wires, /is-hover/);
  assert.match(styles, /\.edge-hit\{[^}]*stroke-width:18;pointer-events:stroke/);
  assert.match(styles, /\.edge-path\.is-hover\{stroke:var\(--red-soft\)/);
  assert.match(styles, /\.edge-path\{[^}]*pointer-events:none/, 'only the wide area takes the mouse');
});

test('"Add a step" does not move when pressed (it is centred with translate, not transform)', () => {
  assert.match(styles, /\.canvas-add\{position:fixed;bottom:24px;left:calc\(\(100vw - 340px\)\/2\);translate:-50% 0;transition:none/);
  assert.match(styles, /\.canvas-add:active\{transform:none\}/);
  assert.doesNotMatch(styles, /\.canvas-add\{[^}]*transform:translateX\(-50%\)/);
});

test('pressing on a connection does not start panning the canvas (pan would swallow the click that removes it)', () => {
  assert.match(functionBody(builder, 'bindCanvasPan'), /\.edge-hit/);
});

test('dragging a connection onto another step moves it; a plain click still removes it', () => {
  const wires = functionBody(builder, 'drawWires');
  assert.match(wires, /startEdgeGesture\(event, edge\)/);
  assert.match(wires, /reconnectingEdgeId/, 'the line being moved is hidden while its dashed copy follows the mouse');
  const gesture = functionBody(builder, 'startEdgeGesture');
  assert.match(gesture, /edge.toNodeId = target.id/, 'the same connection (and answer) keeps its start and only changes where it ends');
  assert.match(gesture, /type !== 'candidateInfo'/, 'nothing can lead back to the fixed first step');
  assert.match(gesture, /removeEdge\(flow, edge\)/, 'no movement = click = remove');
  assert.match(functionBody(builder, 'removeEdge'), /must always connect to the journey/);
  assert.match(styles, /\.node\.connect-target\{/);
});

test('no hint text is shown for connections, and the notices sit above the "Add a step" button', () => {
  const calls = builder.match(/setStatus\('/g) || [];
  assert.equal(calls.length, 0, 'the helper stays, but nothing writes hints with it');
  assert.match(styles, /body:has\(#canvas-stage\) \.toast\{bottom:80px\}/);
});

test('the dashed preview line follows the pointer even after the canvas was panned', () => {
  const wires = functionBody(builder, 'drawWires');
  assert.match(wires, /window.pendingPointer.x - stageBox.left/);
  assert.doesNotMatch(wires, /scrollLeft|scrollTop/, 'the stage box already includes the scroll position');
});

test('the canvas can be zoomed out to 40% (in steps of 20%) but never closer than the original 100%', () => {
  assert.match(builder, /const ZOOM_MIN = 0\.4, ZOOM_MAX = 1, ZOOM_STEP = 0\.2/);
  const apply = functionBody(builder, 'applyZoom');
  assert.match(apply, /Math\.min\(ZOOM_MAX, Math\.max\(ZOOM_MIN, next\)\)/, 'the limits are enforced in one place');
  assert.match(apply, /zin\.disabled = zoom >= ZOOM_MAX/, 'the + button is off at 100%');
  assert.match(apply, /out\.disabled = zoom <= ZOOM_MIN/);
  assert.match(builder, /id="zoom-out"/);
  assert.match(builder, /id="zoom-in"/);
  assert.match(builder, /id="zoom-reset"/);
  assert.match(builder, /passive: false/, 'ctrl/cmd + wheel zoom must be able to cancel the browser page zoom');
  assert.match(styles, /\.canvas-zoom-controls\{position:fixed;bottom:24px;left:calc\(\(100vw - 120px\)\/2 \+ 72px\)/, 'next to the Add a step button');
  assert.match(styles, /\.edge-path,\.edge-hit\{vector-effect:non-scaling-stroke\}/, 'lines keep a clickable width when zoomed out');
});

test('everything that reads the mouse or sizes on the canvas accounts for the zoom', () => {
  assert.match(functionBody(builder, 'moveDrag'), /\/ canvasZoom/);
  assert.match(builder, /function center\(element, relativeTo\) \{[^}]*\/ canvasZoom/);
  assert.match(functionBody(builder, 'drawWires'), /\/ canvasZoom/, 'the dashed preview line');
  assert.match(functionBody(builder, 'newNodeSpot'), /\/ canvasZoom/, 'a new step lands in the middle of what is visible');
});

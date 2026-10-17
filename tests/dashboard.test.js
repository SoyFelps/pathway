const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const builder = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');

test('Published flows metric has its own icon, different from Application flows', () => {
  const published = builder.match(/<span class="stat-icon">\$\{ICONS\.(\w+)\}<\/span><div><strong>\$\{published\}<\/strong>/)?.[1];
  const flows = builder.match(/<span class="stat-icon">\$\{ICONS\.(\w+)\}<\/span><div><strong>\$\{count\}<\/strong>/)?.[1];
  assert.equal(published, 'published');
  assert.equal(flows, 'flows');
  assert.notEqual(published, flows);
  assert.ok(builder.includes("published: '<svg"), 'published icon is defined');
});

test('sidebar no longer shows the workspace footer note', () => {
  assert.equal(builder.includes('sidebar-bottom'), false);
  assert.equal(builder.includes('Access follows your team permissions'), false);
});

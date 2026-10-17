const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('colours are defined once as design tokens in :root and used through var()', () => {
  const css = read('styles.css');
  const root = css.match(/:root\{[^}]*\}/)?.[0];
  assert.ok(root, ':root token block exists');
  const outside = css.replace(root, '');
  const raw = outside.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || [];
  assert.deepEqual(raw, [], 'styles.css must use var(--token) instead of raw colours; add or reuse a token in :root');
  const defined = new Set([...root.matchAll(/--([a-z0-9-]+):/g)].map(match => match[1]));
  const used = [...outside.matchAll(/var\(--([a-z0-9-]+)\)/g)].map(match => match[1]);
  const missing = [...new Set(used.filter(name => !defined.has(name)))];
  assert.deepEqual(missing, [], 'every var(--token) used in styles.css is defined in :root');
});

test('inline UI colours in the app scripts come from tokens', () => {
  for (const file of ['builder.js', 'candidate.js', 'auth.js']) {
    const source = read(file);
    const inline = source.match(/style="[^"]*#[0-9a-fA-F]{3,8}\b/g) || [];
    assert.deepEqual(inline, [], `${file} should not hard-code colours in inline styles`);
  }
});

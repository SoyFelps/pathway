const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

test('the sign-in screen uses the same headline and subtitle as the dashboard', () => {
  const dashboard = read('builder.js').match(/<h1>(Hiring made organized)<\/h1><p>([^<]+)<\/p>/);
  assert.ok(dashboard, 'dashboard title and subtitle found');
  assert.ok(read('auth.js').includes(`<h1>${dashboard[1]}</h1><p>${dashboard[2]}</p>`), 'same words on both screens');
  assert.equal(read('auth.js').includes('Make applying feel human'), false);
});

test('the sign-in screen lists what Pathway does, each with an icon that matches', () => {
  const auth = read('auth.js');
  const list = auth.slice(auth.indexOf('<div class="auth-feature-list">'), auth.indexOf('</div></div></section><section class="auth-card-wrap">'));
  const items = list.match(/<div class="auth-feature"><span><svg [^>]*>.*?<\/svg><\/span>[^<]+<\/div>/g) || [];
  assert.equal(items.length, 3, 'three items, each with an SVG icon');
  assert.ok(items[0].includes('Branching flows') && items[0].includes('<circle'), 'branching flows: a branch icon');
  assert.ok(items[1].includes('One public link per role') && items[1].includes('a4 4 0'), 'public link: a chain-link icon');
  assert.ok(items[2].includes('review candidates') && items[2].includes('<rect'), 'candidate board: a columns icon');
  assert.equal(/[✓↗⌁]/.test(list), false, 'the old text glyphs are gone');
});

test('the feature icons are drawn with the current text colour, not a fixed one', () => {
  const css = read('styles.css');
  assert.ok(css.includes('.auth-feature span svg{width:14px;height:14px;fill:none;stroke:currentColor;'));
});

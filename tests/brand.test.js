const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('the Nellio logo files exist and are valid SVG images', () => {
  for (const name of ['nellio-logo', 'nellio-logo-white', 'nellio-symbol', 'nellio-symbol-white', 'nellio-icon', 'nellio-icon-hollow']) {
    const svg = read(`brand/${name}.svg`);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[^"]+">/, name);
    assert.ok(!/<script|<image|href=|font-family/.test(svg), `${name} has no script, no embedded images and no fonts`);
  }
  assert.match(read('brand/nellio-logo.svg'), /#315f4a/, 'the logo uses the Nellio green');
});

test('every screen shows the new logo instead of the old arrow mark with the word', () => {
  for (const file of ['builder.js', 'auth.js', 'candidate.js', 'legal.html']) {
    const src = read(file);
    assert.ok(!src.includes('<span class="brand-mark">↗</span>'), `${file}: no old arrow mark left`);
    assert.ok(!src.includes('<span class="brand">nellio</span>'), `${file}: no plain text brand left`);
  }
  assert.ok(read('builder.js').split('src="brand/nellio-logo.svg"').length - 1 >= 14, 'every app header uses the logo');
  assert.ok(read('auth.js').includes('src="brand/nellio-logo.svg"'));
  assert.ok(read('candidate.js').includes('src="brand/nellio-logo.svg"'));
  assert.ok(read('legal.html').includes('src="brand/nellio-logo.svg"'));
  // the loading cards show the symbol alone
  assert.ok(read('builder.js').includes('src="brand/nellio-symbol.svg"'));
});

test('the favicon is the Nellio icon on every page, and the logo CSS is versioned for the legal page too', () => {
  for (const file of ['index.html', 'apply.html', 'legal.html']) {
    assert.ok(read(file).includes('<link rel="icon" type="image/svg+xml" href="brand/nellio-icon.svg">'), file);
  }
  const css = read('styles.css');
  assert.match(css, /\.brand-logo\{display:block;height:36px;width:auto\}/);
  assert.match(css, /\.brand-symbol\{/);
  assert.ok(read('legal.html').includes('styles.css?v=mw3-20261117f'));
});

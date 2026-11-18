const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const exists = file => fs.existsSync(path.join(__dirname, '..', file));

// Plus Jakarta Sans (2026-11-18, owner choice): hosted in the site itself, with the system font as the fallback.

test('the font files are in the site with their license, and are real WOFF2 files', () => {
  for (const file of ['fonts/plus-jakarta-sans-latin.woff2', 'fonts/plus-jakarta-sans-latin-ext.woff2']) {
    assert.ok(exists(file), file);
    assert.equal(fs.readFileSync(path.join(__dirname, '..', file)).subarray(0, 4).toString('latin1'), 'wOF2', file + ' is a WOFF2 file');
    assert.ok(fs.statSync(path.join(__dirname, '..', file)).size < 100 * 1024, file + ' stays small');
  }
  assert.ok(read('fonts/OFL.txt').includes('SIL Open Font License, Version 1.1'), 'the license travels with the font');
  assert.ok(read('fonts/README.md').includes('Plus Jakarta Sans'));
});

test('styles.css declares the font from the site itself (never from a third party) and keeps the system font as the fallback', () => {
  const css = read('styles.css');
  assert.ok(css.includes("--sans:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--display:var(--sans);"));
  assert.equal((css.match(/@font-face\{font-family:'Plus Jakarta Sans'/g) || []).length, 2, 'latin and latin-ext');
  assert.ok(css.includes('src:url(fonts/plus-jakarta-sans-latin.woff2) format(\'woff2\')') && css.includes('src:url(fonts/plus-jakarta-sans-latin-ext.woff2) format(\'woff2\')'));
  assert.ok(css.includes('font-display:swap'), 'text shows at once in the system font and swaps when the font is ready');
  assert.equal(/fonts\.googleapis|fonts\.gstatic|typekit/i.test(css), false, 'no third-party font service');
});

test('the app and the job page preload the main font file', () => {
  for (const file of ['index.html', 'apply.html']) {
    assert.ok(read(file).includes('<link rel="preload" href="fonts/plus-jakarta-sans-latin.woff2" as="font" type="font/woff2" crossorigin>'), file);
    assert.equal(/fonts\.googleapis|fonts\.gstatic/i.test(read(file)), false, file + ' has no third-party font');
  }
});

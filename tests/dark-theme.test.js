const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// Dark theme (2026-11-17): only the recruiter app; the light theme must stay exactly as it was.
test('theme.js is loaded first in the head of the app and not on the candidate or legal pages', () => {
  const html = read('index.html');
  assert.ok(/<script src="theme\.js\?v=[^"]+"><\/script>\s*<link rel="stylesheet" href="styles\.css/.test(html));
  assert.ok(!read('apply.html').includes('theme.js'));
  assert.ok(!read('legal.html').includes('theme.js'));
});

function loadTheme({ stored, dark, blocked } = {}) {
  const attributes = {}; const meta = { content: '', setAttribute(name, value) { this.content = value; } };
  const listeners = [];
  const store = { ...(stored ? { 'nellio-theme': stored } : {}) };
  const window = {
    matchMedia: () => ({ get matches() { return !!dark.value; }, addEventListener: (type, fn) => listeners.push(fn) }),
    localStorage: blocked ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } }
      : { getItem: key => (key in store ? store[key] : null), setItem: (key, value) => { store[key] = value; }, removeItem: key => { delete store[key]; } }
  };
  const document = { documentElement: { setAttribute: (name, value) => { attributes[name] = value; } }, querySelector: () => meta };
  vm.runInNewContext(read('theme.js'), { window, document });
  return { window, attributes, meta, store, listeners };
}

test('Automatic follows the device, Light and Dark are fixed, and the choice is kept in the browser', () => {
  const device = { value: true };
  const t = loadTheme({ dark: device });
  assert.equal(t.attributes['data-theme'], 'dark');
  assert.equal(t.meta.content, '#121c17');
  assert.equal(t.window.NellioTheme.set('light'), 'light');
  assert.equal(t.store['nellio-theme'], 'light');
  assert.equal(t.attributes['data-theme'], 'light');
  assert.equal(t.window.NellioTheme.set('dark'), 'dark');
  assert.equal(t.window.NellioTheme.set('auto'), 'dark');
  assert.equal('nellio-theme' in t.store, false, 'Automatic removes the saved choice');
  device.value = false;
  t.listeners.forEach(fn => fn());
  assert.equal(t.attributes['data-theme'], 'light', 'in Automatic the page follows the device when it changes');
  assert.equal(loadTheme({ stored: 'dark', dark: { value: false } }).attributes['data-theme'], 'dark');
  assert.equal(loadTheme({ stored: 'nonsense', dark: { value: false } }).attributes['data-theme'], 'light');
});

test('a browser that blocks storage still switches theme until the page closes', () => {
  const t = loadTheme({ dark: { value: false }, blocked: true });
  assert.equal(t.attributes['data-theme'], 'light');
  assert.equal(t.window.NellioTheme.set('dark'), 'dark');
});

test('every app header carries both logos and the theme shows one; the Settings screen has the Appearance choice in three languages', () => {
  const builder = read('builder.js');
  const both = '<img class="brand-logo logo-light" src="brand/nellio-logo.svg" alt="Nellio"><img class="brand-logo logo-dark" src="brand/nellio-logo-white.svg" alt="" aria-hidden="true">';
  assert.ok(builder.split(both).length - 1 >= 14);
  assert.ok(!builder.includes('<img class="brand-logo" src="brand/nellio-logo.svg"'));
  assert.ok(builder.includes('id="settings-theme"') && builder.includes('window.NellioTheme.set(themeSelect.value)'));
  assert.ok(builder.includes("theme: darkTheme ? 'night' : 'stripe'"), 'the card form follows the theme');
  const css = read('styles.css');
  assert.ok(css.includes('.logo-dark{display:none}') && css.includes(':root[data-theme="dark"] .logo-light{display:none}'));
  for (const file of ['locales/pt-BR.js', 'locales/es.js']) {
    const text = read(file);
    for (const key of ['Appearance', 'Automatic (follows your device)', 'Light', 'Dark']) assert.ok(text.includes("'" + key + "':"), file + ' ' + key);
  }
});

test('the sign-in panel and the lime and red fills keep their colours in both themes', () => {
  const css = read('styles.css');
  const dark = css.match(/:root\[data-theme="dark"\]\{[^}]*\}/)[0];
  for (const fixed of ['panel', 'panel-deep', 'on-panel', 'on-panel-soft', 'on-fill', 'on-lime', 'red-fill']) {
    assert.ok(!dark.includes('--' + fixed + ':'), fixed + ' is not redefined in dark');
  }
  assert.ok(dark.includes('color-scheme:dark'));
  assert.ok(!css.includes('background:white'), 'no hard-coded white backgrounds');
});

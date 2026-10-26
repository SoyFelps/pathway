const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

test('both pages try the settings file again (twice, with a different address) before giving up', () => {
  for (const page of ['index.html', 'apply.html']) {
    const html = read(page);
    assert.match(html, /<script src="supabase-config\.js"><\/script>\n\s*<script>window\.PATHWAY_SUPABASE_CONFIG\|\|document\.write\('<script src="supabase-config\.js\?retry=1"><\\\/script>'\);<\/script>\n\s*<script>window\.PATHWAY_SUPABASE_CONFIG\|\|document\.write\('<script src="supabase-config\.js\?retry=2"><\\\/script>'\);<\/script>/, page);
    // the retry sits before the scripts that need the settings, so the order is kept
    assert.ok(html.indexOf('retry=2') < html.indexOf('backend.js'), page + ': retry before backend.js');
  }
});

test('backend.js does not crash when the settings or the Supabase library are missing: it flags it and stays out of the way', () => {
  const code = read('backend.js');
  for (const window of [{}, { PATHWAY_SUPABASE_CONFIG: { url: 'https://x.supabase.co', publishableKey: 'k' } }, { supabase: {} }]) {
    const sandbox = { window, document: {}, console, URL, URLSearchParams, setTimeout, clearTimeout };
    assert.doesNotThrow(() => vm.runInNewContext(code, sandbox));
    assert.equal(window.PathwayBackend, undefined, 'no backend object');
    assert.equal(window.PathwayBackendUnavailable, true, 'flagged');
  }
});

test('the sign-in/invitation start shows a plain message and a retry button instead of a technical error', () => {
  const auth = read('auth.js');
  assert.match(auth, /const UNAVAILABLE_MESSAGE = 'A momentary instability occurred\. Please try again in a few seconds\.';/);
  assert.match(auth, /async function start\(callback\) \{\n\s*if \(!window\.PathwayBackend\) \{ renderUnavailable\(\); return; \}/, 'checked before anything uses the backend');
  assert.match(auth, /id="retry-load"/);
  assert.match(auth, /addEventListener\('click', \(\) => window\.location\.reload\(\)\)/);
  assert.match(read('styles.css'), /\.loading-card\.is-error\{/);
});

test('the public application page says the same thing when the backend did not load', () => {
  const html = read('apply.html');
  assert.match(html, /if \(!window\.PathwayBackend\) \{\n\s*PathwayCandidate\.renderInvalid\(root, 'A momentary instability occurred\. Please try again in a few seconds\.'\);\n\s*return;\n\s*\}/);
  assert.ok(html.indexOf('window.PathwayBackend') < html.indexOf('getPublishedFlow'), 'the guard comes before the first use');
});

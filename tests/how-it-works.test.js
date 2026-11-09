const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

test('the "How it works" and plans section is added below the existing sign-in screen, never on invitations', () => {
  const auth = read('auth.js');
  assert.ok(auth.includes("</section></main>${isInvite ? '' : howItWorksHtml()}`;"), 'it follows the existing <main>, so the current screen is untouched');
  const html = auth.slice(auth.indexOf('function howItWorksHtml()'), auth.indexOf('function renderAuth('));
  assert.ok(html.includes('id="how-it-works"') && html.includes('From a blank page to a shared job link'));
  assert.equal((html.match(/\+ row\(\d,/g) || []).length, 5, 'five steps, each with its own illustration');
  for (const key of ['build', 'branch', 'preview', 'publish', 'review']) assert.ok(html.includes('art.' + key), 'illustration for ' + key);
  for (const word of ['Build your flow', 'Branch on answers', 'Preview as a candidate', 'Publish and share', 'Review candidates']) assert.ok(html.includes(word), word);
});

test('the plans compare Free, Business and Agency and match what the product does', () => {
  const auth = read('auth.js');
  const html = auth.slice(auth.indexOf('function howItWorksHtml()'), auth.indexOf('function renderAuth('));
  assert.ok(html.includes('window.PathwayCore.planCardsHtml({ t, tn, esc }'), 'the sign-up page shows the three plan cards');
  const core = read('pathway.js');
  assert.ok(core.includes("free: { id: 'free', name: 'Free', price: 'US$ 0', companies: 1, seats: 0 }"));
  assert.ok(core.includes("business: { id: 'business', name: 'Business', price: 'US$ 24.90', companies: 1, seats: 3 }"));
  assert.ok(core.includes("agency: { id: 'agency', name: 'Agency', price: 'US$ 200', companies: 10, seats: 6 }"));
  assert.ok(core.includes('Publishing job links'), 'publishing is the thing Free does not include');
  assert.ok(core.includes("Up to {count} teammates at no extra seat charge"), 'same promise as the My Team page (the number comes from the plan)');
  assert.ok(read('README.md').includes('US$24.90/month'), 'the price shown matches the documented price');
});

test('"Start for free" returns to the top and opens the create-account form', () => {
  const auth = read('auth.js');
  assert.ok(auth.includes('id="start-free"'));
  const handler = auth.slice(auth.indexOf("root.querySelector('#start-free')"), auth.indexOf("root.querySelector('#auth-form').addEventListener('submit', submitAuth);"));
  assert.ok(handler.includes("state.mode = 'signup'; renderAuth();"), 'switches from Sign in to Create account');
  assert.ok(handler.includes("window.scrollTo({ top: 0, behavior: 'smooth' })"));
  assert.ok(handler.includes("#auth-workspace"), 'focuses the first field of the sign-up form');
});

test('the section is styled with colour tokens only and keeps the existing screen as it was', () => {
  const css = read('styles.css');
  const block = css.slice(css.indexOf('/* Sign-in screen: "How it works" and plans */'));
  assert.ok(block.includes('.plan-card-premium{background:var(--surface);border:2px solid var(--green)}'));
  assert.equal(/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(block), false);
  assert.ok(read('auth.js').includes("<h1>${t('Hiring made organized')}</h1>"), 'the headline from the previous change is intact');
});

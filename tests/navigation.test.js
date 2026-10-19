const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const builder = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');

test('each workspace page records itself in the URL hash so a refresh stays on the page', () => {
  for (const route of ['dashboard', 'applicants', 'my-companies', 'my-team', 'my-plan', 'settings']) {
    assert.ok(builder.includes(`setRoute('${route}')`), `page ${route} calls setRoute`);
  }
  assert.ok(builder.includes('setRoute(`flow=${flow.cloudId}`)'), 'the flow editor records the open flow');
  assert.ok(builder.includes('window.history.replaceState(null'), 'routes use replaceState so history is not polluted');
});

test('the startup router restores every recorded page and falls back to the dashboard', () => {
  for (const route of ['my-companies', 'applicants', 'my-plan', 'my-team', 'settings']) {
    assert.ok(builder.includes(`requestedPage === '${route}'`), `startup restores ${route}`);
  }
  assert.ok(builder.includes("requestedPage.startsWith('flow=')"), 'startup restores an open flow');
  assert.ok(builder.includes('openFlow(savedFlow.id); else renderDashboard();'), 'unknown or forbidden flows fall back to the dashboard');
});

test('signing out replaces the old page in the address with #login, so the next sign-in does not land on that page', () => {
  const builder = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8').replace(/\r\n/g, '\n');
  const signOut = builder.slice(builder.indexOf('async function doSignOut('), builder.indexOf('function showNewFlow('));
  assert.ok(signOut.includes("user = null; setRoute('login'); window.PathwayAuth.renderAuth();"), 'after a successful sign-out, before the sign-in screen is drawn');
  assert.ok(builder.includes("const hash = `#${route}`;") && builder.includes('window.history.replaceState('), 'setRoute replaces the entry instead of adding one, so Back is not trapped');
  const start = builder.slice(builder.indexOf("const requestedPage = window.location.hash.replace(/^#/, '');"));
  assert.equal(start.includes("requestedPage === 'login'"), false, 'login is not a page: after signing in the app opens the dashboard');
  const auth = fs.readFileSync(path.join(__dirname, '..', 'auth.js'), 'utf8');
  assert.equal(/setRoute|location\.hash\s*=|replaceState\([^)]*#login/.test(auth), false, 'the sign-in screen itself never rewrites the address, so a bookmarked page still opens after signing in');
});

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

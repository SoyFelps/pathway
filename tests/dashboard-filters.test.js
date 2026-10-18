const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

test('the dashboard no longer has the Workspace details button or its modal', () => {
  const builder = read('builder.js');
  assert.equal(builder.includes('workspace-details'), false);
  assert.equal(builder.includes('showWorkspaceDetails'), false);
  assert.ok(builder.includes('id="new-flow"'), 'the New flow button stays');
});

test('the dashboard has a search box and company and responsible filters above the flow grid', () => {
  const builder = read('builder.js');
  const markup = builder.slice(builder.indexOf('function flowFiltersHtml('), builder.indexOf('function flowCardHtml('));
  assert.ok(markup.includes('id="flow-search"') && markup.includes('placeholder="Search flows"'));
  assert.ok(markup.includes('id="flow-company-filter"') && markup.includes('id="flow-responsible-filter"'));
  assert.ok(builder.includes('${flowFiltersHtml()}<section class="flow-grid" id="flow-grid">${flowCardsHtml()}</section>'), 'filters sit right above the grid');
  assert.ok(builder.includes("<option value=\"\">All responsibles</option>") && builder.includes("['', 'All companies']"));
});

test('filtering narrows the cards by title or company, by company, and by responsible (All means everyone)', () => {
  const builder = read('builder.js');
  const filter = builder.slice(builder.indexOf('function filteredFlows('), builder.indexOf('function flowCompanyFilterOptionsHtml('));
  assert.ok(filter.includes("((flow.jobTitle || '') + ' ' + (flow.companyName || '')).toLowerCase().includes(term)"));
  assert.ok(filter.includes('if (flowFilters.company === WORKSPACE_FILTER) { if (flow.companyId) return false; }'), 'jobs without a company are grouped under the workspace name');
  assert.ok(filter.includes('flow.companyId !== flowFilters.company'));
  assert.ok(filter.includes('if (ids.length && !ids.includes(flowFilters.responsible)) return false;'), 'a job set to All appears for every responsible person');
});

test('typing in the search box repaints only the grid, and an empty result offers to clear the filters', () => {
  const builder = read('builder.js');
  assert.ok(builder.includes("flowFilters.search = event.target.value; paintFlowGrid();"));
  assert.ok(builder.includes("grid.innerHTML = flowCardsHtml();\n    bindFlowCards();"), 'cards are re-bound after the grid is repainted');
  assert.ok(builder.includes('No flows match these filters.') && builder.includes('id="flow-clear-filters"'));
  assert.ok(builder.includes("flowFilters = { search: '', company: '', responsible: '' };\n    startNotifications();"), 'filters reset on sign-in');
});

test('the clear (x) button of search fields is drawn in the app red, not the browser default blue', () => {
  const css = read('styles.css');
  const rule = css.slice(css.indexOf('input[type="search"]::-webkit-search-cancel-button{'));
  assert.ok(rule.includes('-webkit-appearance:none') && rule.includes('background:var(--red)'));
  assert.ok(rule.includes('mask:url("data:image/svg+xml'), 'the x shape comes from a mask, so the colour is the red token');
});

test('select fields draw their own arrow with space from the right border, using colour tokens only', () => {
  const css = read('styles.css');
  const rule = css.slice(css.indexOf('select.select-input,select.applicants-filter,select.applicant-status-select{-webkit-appearance:none'));
  assert.ok(rule.includes('padding-right:38px'), 'room for the arrow, and long option text never runs under it');
  assert.ok(rule.includes('background-position:calc(100% - 20px) 50%,calc(100% - 15px) 50%'), 'the arrow sits 15-20px from the border');
  assert.ok(rule.includes('var(--text-subtle)') && !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(rule.split('}')[0]));
});

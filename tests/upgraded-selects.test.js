const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

// The filter lists of the Dashboard, Reports and Diversity use the same list as the job filter of the Applicants page (2026-11-18).

test('one component puts our list in place of a native select and keeps the select working', () => {
  const builder = read('builder.js');
  const start = builder.indexOf('function upgradeSelect(select, options = {})');
  const body = builder.slice(start, builder.indexOf('async function renderApplicants()'));
  assert.ok(start > 0);
  assert.ok(body.includes("select.classList.add('is-upgraded')") && body.includes("select.dataset.upgraded = '1'"), 'the select is only hidden, and never upgraded twice');
  assert.ok(body.includes("wrap.className = 'job-combobox select-combobox'") && body.includes('class="job-combobox-list"') && body.includes('class="job-combobox-chevron"'), 'the same markup and classes as the job filter');
  assert.ok(body.includes("select.value = value; select.dispatchEvent(new Event('change', { bubbles: true }))"), 'choosing an item fires the select\'s change event, so the existing handlers keep working');
  assert.ok(body.includes('mountApplicantCombobox(wrap,'), 'the list behaviour is the one shared with the job and responsible filters');
  assert.ok(body.includes("attributeFilter: ['hidden', 'disabled', 'title']") && body.includes('childList: true'), 'options, hidden, disabled and title are mirrored');
  assert.ok(body.includes("input.setAttribute('aria-label', select.getAttribute('aria-label')"), 'the accessible name is kept');
});

test('every filter list outside the Applicants page is upgraded', () => {
  const builder = read('builder.js');
  assert.ok(builder.includes("root.querySelectorAll('.flow-filters select').forEach(select => upgradeSelect(select));"), 'Dashboard: company and responsible');
  assert.ok(builder.includes("upgradeSelect(root.querySelector('#report-company'));"), 'Reports: company');
  assert.ok(builder.includes("upgradeSelect(slot.querySelector('#rpt-steps-version'));"), 'Reports: form version');
  assert.ok(builder.includes("upgradeSelect(content.querySelector('#rpt-jobs-sort'));"), 'Reports: sort jobs');
  assert.ok(builder.includes("const select = root.querySelector('#diversity-job');\n    upgradeSelect(select);"), 'Diversity: job');
});

test('the hidden select stays hidden, and the lists have sizes for every screen', () => {
  const css = read('styles.css');
  assert.ok(css.includes('.is-upgraded{display:none!important}'));
  for (const rule of ['.select-combobox{flex:0 0 220px;min-width:160px}', '.flow-filters .select-combobox{flex:0 1 220px}', '.reports-tools .select-combobox{flex:0 0 190px}', '.rpt-version .select-combobox{width:320px;max-width:100%;flex:none}']) {
    assert.ok(css.includes(rule), rule);
  }
  assert.ok(css.includes('@media(max-width:760px){.reports-tools .select-combobox{flex:1;min-width:0}.flow-filters .select-combobox{flex:1 1 100%}.rpt-jobs-tools .select-combobox{flex:1;min-width:0}}'), 'phones');
});

test('the two lists of the interview window (format and time zone) are the application\'s own list, and the time zones can be searched', () => {
  const builder = read('builder.js');
  assert.ok(builder.includes("upgradeSelect(field('iv-kind'));"), 'format');
  assert.ok(builder.includes("upgradeSelect(field('iv-zone'), { search: true, empty: t('No time zones match') });"), 'time zone, searchable');
  assert.ok(builder.includes('if (options.search) input.readOnly = false;'), 'typing narrows the list only where asked');
  assert.ok(read('styles.css').includes('#schedule-interview-form .select-combobox{flex:none;width:100%;min-width:0}'), 'full width inside the window');
});

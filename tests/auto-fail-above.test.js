const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

function loadCore() {
  const sandbox = { window: {}, localStorage: { getItem: () => null, setItem() {} }, document: {} };
  new Function('window', 'localStorage', 'document', read('pathway.js'))(sandbox.window, sandbox.localStorage, sandbox.document);
  return sandbox.window.PathwayCore;
}

// Auto-fail "if above" (2026-11-18): a number question can fail candidates above a maximum, besides the existing minimum.

test('the number question has ONE auto-fail rule: a choice between below and above, and one number, only while Numbers only is on', () => {
  const builder = read('builder.js');
  const inspector = builder.slice(builder.indexOf('function drawInspector()'), builder.indexOf('function updateNodeLabel('));
  assert.ok(inspector.includes('id="autofail-mode"') && inspector.includes('id="autofail-value"'));
  assert.equal(inspector.includes('id="autofail-above"') || inspector.includes('id="autofail-below"'), false, 'no second number field');
  assert.ok(inspector.includes('<option value="below"') && inspector.includes('<option value="above"'));
  assert.ok(inspector.includes("t('Auto-fail if above')") && inspector.includes("t('Auto-fail if below')"));
  assert.ok(inspector.includes("<label for=\"autofail-mode\">${t('Auto-fail (optional)')}</label>"), 'the title says the rule is optional');
  const numberBlock = inspector.slice(inspector.indexOf("selected.type === 'shortText' && selected.numericOnly ? `"));
  assert.ok(numberBlock.indexOf('id="autofail-mode"') < numberBlock.indexOf('id="autofail-value"') && numberBlock.indexOf('id="autofail-value"') < numberBlock.indexOf('inspector-note'), 'the rule is inside the Numbers only block');
  assert.ok(inspector.includes('delete selected.autoFailBelow; delete selected.autoFailAbove;'), 'turning Numbers only off removes both rules');
  const changeHandler = inspector.slice(inspector.indexOf("'#autofail-mode'"));
  assert.ok(changeHandler.includes('delete selected.autoFailBelow; delete selected.autoFailAbove;'), 'switching the choice leaves only one rule');
  assert.ok(changeHandler.includes("selected[event.target.value === 'above' ? 'autoFailAbove' : 'autoFailBelow'] = current"), 'the typed number moves to the chosen rule');
  assert.equal(inspector.includes('autoFailChoice'), false, 'the choice of an empty rule is never saved in the flow');
});

test('the step card on the canvas shows the maximum too', () => {
  const builder = read('builder.js');
  assert.ok(builder.includes("t('auto-fail above {number}', { number: node.autoFailAbove })"));
});

test('only a well-formed maximum survives normalization, only on a number question, and never together with a minimum', () => {
  const C = loadCore();
  const flow = C.createFlow('Acme', 'Designer', 'desc');
  const info = flow.nodes.find(node => node.type === 'candidateInfo');
  const end = flow.nodes.find(node => node.type === 'end');
  const numeric = { id: 'n1', type: 'shortText', x: 0, y: 0, label: 'Salary', numericOnly: true, autoFailAbove: '6000', options: [] };
  const both = { id: 'n3', type: 'shortText', x: 0, y: 0, label: 'Both', numericOnly: true, autoFailAbove: 9, autoFailBelow: 2, options: [] };
  const bad = { id: 'n2', type: 'shortText', x: 0, y: 0, label: 'Years', numericOnly: true, autoFailAbove: -5, options: [] };
  const plain = { id: 't1', type: 'shortText', x: 0, y: 0, label: 'Free', numericOnly: false, autoFailAbove: 4, options: [] };
  const single = { id: 's1', type: 'singleChoice', x: 0, y: 0, label: 'Q', options: ['Yes', 'No'], autoFailAbove: 9 };
  flow.nodes = [info, numeric, both, bad, plain, single, end];
  flow.edges = [
    { id: 'e1', fromNodeId: info.id, toNodeId: 'n1' },
    { id: 'e2', fromNodeId: 'n1', toNodeId: 'n3' },
    { id: 'e2b', fromNodeId: 'n3', toNodeId: 'n2' },
    { id: 'e3', fromNodeId: 'n2', toNodeId: 't1' },
    { id: 'e4', fromNodeId: 't1', toNodeId: 's1' },
    { id: 'e5', fromNodeId: 's1', toNodeId: end.id, optionValue: 'Yes' },
    { id: 'e6', fromNodeId: 's1', toNodeId: end.id, optionValue: 'No' }
  ];
  const byId = Object.fromEntries(C.normalizeFlow(flow).nodes.map(node => [node.id, node]));
  assert.equal(byId.n1.autoFailAbove, 6000, 'a number typed as text becomes a whole number');
  assert.equal('autoFailBelow' in byId.n1, false);
  assert.equal(byId.n3.autoFailBelow, 2, 'one rule per question: the original minimum wins');
  assert.equal('autoFailAbove' in byId.n3, false);
  assert.equal('autoFailAbove' in byId.n2, false, 'a negative maximum is dropped');
  assert.equal('autoFailAbove' in byId.t1, false, 'a free-text answer cannot have a maximum');
  assert.equal('autoFailAbove' in byId.s1, false, 'a choice question cannot have a maximum');
});

test('the public copy of a job also never contains the maximum (migration of 2026-11-18)', () => {
  const sql = read('supabase/migrations/20261118120000_auto_fail_above.sql');
  assert.ok(sql.includes("((n.node - 'autoFailOptions') - 'autoFailBelow') - 'autoFailAbove'"), 'all three keys are removed from every node');
  const body = sql.replace(/^--.*$/gm, '');
  assert.ok(body.includes("jsonb_build_object('jobLanguage', f.interview_language)"), 'the job language is still returned');
  assert.ok(body.includes('and public.flow_data_is_valid(f.flow_data)') && body.includes('and public.workspace_has_active_subscription(pf.workspace_id)') && body.includes("f.publication_status = 'published'"), 'the same checks as before');
  assert.equal(/grant|revoke/.test(body), false, 'create or replace keeps the existing grants');
  // it is the same function as the previous one, except for the extra key
  const before = read('supabase/migrations/20261105150000_published_flow_language.sql').replace(/^--.*$/gm, '');
  const normalize = text => text.replace("((n.node - 'autoFailOptions') - 'autoFailBelow') - 'autoFailAbove'", "(n.node - 'autoFailOptions') - 'autoFailBelow'").replace(/\s+/g, ' ').trim();
  assert.equal(normalize(body), normalize(before));
});

test('the server fails a number above the maximum, strictly, and never tells the visitor', () => {
  const fn = read('supabase/functions/applications/index.ts');
  assert.ok(fn.includes('Number.isInteger(current.autoFailAbove) && Number((answer as string).trim()) > (current.autoFailAbove as number)'), 'strictly above the maximum fails');
  assert.ok(fn.includes('(maximum ${current.autoFailAbove})'));
  assert.ok(fn.includes('Number((answer as string).trim()) < (current.autoFailBelow as number)'), 'the minimum rule is unchanged');
  assert.equal(/return response\(req, 200, \{[^}]*autoFail/.test(fn), false);
});

test('the reason written by the server is translated on the screen, and the texts exist in both languages', () => {
  const builder = read('builder.js');
  assert.ok(builder.includes("t('Answered {answer} to “{question}” (maximum {maximum})'"));
  for (const file of ['locales/pt-BR.js', 'locales/es.js']) {
    const text = read(file);
    for (const key of ['Auto-fail (optional)', 'Auto-fail if above', 'e.g. 6000', 'Candidates who enter a larger number still finish the questions, then land in Failed.', 'auto-fail above {number}', 'Answered {answer} to “{question}” (maximum {maximum})']) {
      assert.ok(text.includes("'" + key + "':"), file + ' ' + key);
    }
  }
});

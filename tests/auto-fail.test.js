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

test('the final step is called "Result"', () => {
  const builder = read('builder.js');
  assert.ok(builder.includes('<label for="end-subtype">Result</label>'));
  assert.equal(builder.includes('End screen'), false);
});

test('choice questions can mark options as auto-fail, and a number question can set a minimum', () => {
  const builder = read('builder.js');
  const inspector = builder.slice(builder.indexOf('function drawInspector()'), builder.indexOf('function updateNodeLabel('));
  assert.ok(inspector.includes('class="option-autofail"') && inspector.includes('<span>Auto-fail</span>'), 'every option row has an Auto-fail box');
  assert.ok(inspector.includes('Auto-fail if below') && inspector.includes('id="autofail-below"'));
  assert.ok(inspector.includes("selected.type === 'shortText' && selected.numericOnly ? `<div class=\"field-group autofail-below\">"), 'the number rule only shows when Numbers only is on');
  assert.ok(inspector.includes('delete selected.autoFailBelow'), 'turning Numbers only off removes the rule');
  assert.ok(inspector.includes('does not need to connect to an ending'), 'the option can keep following the normal path');
});

test('renaming or removing an option keeps its auto-fail flag in step', () => {
  const builder = read('builder.js');
  assert.ok(builder.includes('node.autoFailOptions = node.autoFailOptions.map(option => option === old ? value : option);'));
  assert.ok(builder.includes('node.autoFailOptions = node.autoFailOptions.filter(option => option !== removed);'));
});

test('only well-formed auto-fail rules survive normalization', () => {
  const C = loadCore();
  const flow = C.createFlow('Acme', 'Designer', 'desc');
  const info = flow.nodes.find(node => node.type === 'candidateInfo');
  const end = flow.nodes.find(node => node.type === 'end');
  const single = { id: 's1', type: 'singleChoice', x: 0, y: 0, label: 'Q', options: ['Yes', 'No'], autoFailOptions: ['No', 'Maybe', 'No'], autoFailBelow: 3 };
  const multi = { id: 'm1', type: 'multiChoice', x: 0, y: 0, label: 'Q', options: ['A', 'B'], autoFailOptions: [] };
  const numeric = { id: 'n1', type: 'shortText', x: 0, y: 0, label: 'Years', numericOnly: true, autoFailBelow: '4', options: [], autoFailOptions: ['x'] };
  const plain = { id: 't1', type: 'shortText', x: 0, y: 0, label: 'Free', numericOnly: false, autoFailBelow: 4, options: [] };
  flow.nodes = [info, single, multi, numeric, plain, end];
  flow.edges = [
    { id: 'e1', fromNodeId: info.id, toNodeId: 's1' },
    { id: 'e2', fromNodeId: 's1', toNodeId: 'm1', optionValue: 'Yes' },
    { id: 'e3', fromNodeId: 's1', toNodeId: 'm1', optionValue: 'No' },
    { id: 'e4', fromNodeId: 'm1', toNodeId: 'n1' },
    { id: 'e5', fromNodeId: 'n1', toNodeId: 't1' },
    { id: 'e6', fromNodeId: 't1', toNodeId: end.id }
  ];
  const normalized = C.normalizeFlow(flow);
  const byId = Object.fromEntries(normalized.nodes.map(node => [node.id, node]));
  assert.deepEqual(byId.s1.autoFailOptions, ['No'], 'unknown options and duplicates are dropped');
  assert.equal('autoFailBelow' in byId.s1, false);
  assert.equal('autoFailOptions' in byId.m1, false, 'an empty list is removed');
  assert.equal(byId.n1.autoFailBelow, 4);
  assert.equal('autoFailOptions' in byId.n1, false);
  assert.equal('autoFailBelow' in byId.t1, false, 'a free-text answer cannot have a minimum');
});

test('the public copy of a job never contains the auto-fail rules, and the server applies them', () => {
  const sql = read('supabase/migrations/20261019190000_auto_fail.sql');
  assert.ok(sql.includes("(n.node - 'autoFailOptions') - 'autoFailBelow'"), 'both keys are removed from every node');
  assert.ok(sql.includes('and public.workspace_has_active_subscription(pf.workspace_id)') && sql.includes("f.publication_status = 'published'"), 'the same checks as before');
  assert.ok(sql.includes('add column auto_fail_reason text check'));
  assert.equal(/grant|revoke/.test(sql.replace(/^--.*$/gm, '')), false, 'create or replace keeps the existing grants');
  const fn = read('supabase/functions/applications/index.ts');
  assert.ok(fn.includes('current.autoFailOptions') && fn.includes('current.autoFailBelow'));
  assert.ok(fn.includes('outcomeStatus: autoFailReasons.length ? "failed" : "new"'), 'any rule, or a "Not a match this time" result, means Failed');
  assert.ok(fn.includes('Number((answer as string).trim()) < (current.autoFailBelow as number)'), 'strictly below the minimum fails');
  assert.ok(fn.includes('auto_fail_reason: inheritedStatus ? null : normalized.autoFailReason'), 'a repeat application inherits the stage and has no reason of its own');
  assert.equal(/return response\(req, 200, \{[^}]*autoFail/.test(fn), false, 'the visitor is never told');
});

test('the hiring team sees why a candidate was moved to Failed', () => {
  const builder = read('builder.js'), backend = read('backend.js');
  assert.ok(backend.includes('privacy_acknowledged_at,auto_fail_reason'));
  assert.ok(builder.includes("group.status === 'failed' ? (group.items.find(item => item.auto_fail_reason) || {}).auto_fail_reason"));
  assert.ok(builder.includes('Moved to Failed automatically:'));
});

test('the legal page explains answer-based auto-fail and keeps human responsibility with the employer', () => {
  const html = read('legal.html');
  assert.ok(html.includes('when an answer is marked “auto-fail” or a number is below a minimum you set'));
  assert.ok(html.includes('Pathway does not send automatic rejection messages'));
  assert.ok(html.includes('automatically place an application in a “Failed” list'));
  assert.ok(html.includes('LGPD art. 20 and GDPR art. 22'));
  assert.ok(html.includes('Version 2026-10-19-v3'));
});

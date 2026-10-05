const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {
  console,
  TextEncoder,
  TextDecoder,
  CompressionStream,
  DecompressionStream,
  Blob,
  Response,
  Uint8Array,
  Set,
  Date,
  Math,
  JSON,
  atob,
  btoa,
  localStorage: { getItem: () => null, setItem: () => {} }
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('../pathway.js'), 'utf8'), context);
const Core = context.PathwayCore;

test('new flow always starts with a fixed candidate-details node and a connected ending', () => {
  const flow = Core.createFlow('Acme', 'Designer', 'Build accessible software.');
  assert.equal(flow.companyId, null);
  assert.equal(flow.companyProfile, null);
  assert.equal(flow.publicationStatus, 'draft');
  assert.equal(flow.activePublishedFlowId, null);
  assert.equal(flow.nodes.filter(node => node.type === 'candidateInfo').length, 1);
  assert.equal(flow.nodes[0].type, 'candidateInfo');
  assert.equal(flow.edges.length, 1);
  assert.equal(flow.edges[0].fromNodeId, flow.nodes[0].id);
  assert.doesNotThrow(() => Core.normalizeFlow(flow));
});

test('selected company profile is normalized and preserved for public snapshots', async () => {
  const flow = Core.createFlow('Acme', 'Designer', 'Build accessible software.');
  flow.companyId = 'company-123';
  flow.companyName = 'Acme Labs';
  flow.companyProfile = { id: 'company-123', name: 'Acme Labs', description: 'A product studio.', logoUrl: 'https://example.com/logo.png', ignored: 'not retained' };
  const normalized = Core.normalizeFlow(flow);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.companyProfile)), { id: 'company-123', name: 'Acme Labs', description: 'A product studio.', logoUrl: 'https://example.com/logo.png' });
  const restored = await Core.decodeFlow(await Core.encodeFlow(normalized));
  assert.equal(restored.companyId, 'company-123');
  assert.equal(restored.companyProfile.name, 'Acme Labs');
  assert.equal(restored.companyProfile.description, 'A product studio.');
});

test('sample choice answers lead to distinct candidate paths', () => {
  const flow = Core.normalizeFlow(Core.createSampleFlow());
  const branch = flow.nodes.find(node => node.type === 'singleChoice');
  const yes = Core.nextNode(flow, branch, 'Yes, in production');
  const exploring = Core.nextNode(flow, branch, 'I’m exploring the space');
  assert.equal(yes.type, 'multiChoice');
  assert.equal(exploring.type, 'shortText');
  assert.notEqual(yes.id, exploring.id);
});

test('digits-only short answers default off for old flows and preserve the setting across publication encoding', async () => {
  const createdQuestion = Core.createNode('shortText', 400, 200);
  assert.equal(createdQuestion.numericOnly, false);
  assert.equal(Core.isDigitsOnlyAnswer('0'), true);
  assert.equal(Core.isDigitsOnlyAnswer('001234'), true);
  assert.equal(Core.isDigitsOnlyAnswer('-12'), false);
  assert.equal(Core.isDigitsOnlyAnswer('12.75'), false);
  assert.equal(Core.isDigitsOnlyAnswer('12,75'), false);
  assert.equal(Core.isDigitsOnlyAnswer('2.1e4'), false);
  assert.equal(Core.isDigitsOnlyAnswer('2E4'), false);
  assert.equal(Core.isDigitsOnlyAnswer('12abc'), false);
  assert.equal(Core.isDigitsOnlyAnswer(' 12 '), false);

  const flow = Core.createSampleFlow();
  const question = flow.nodes.find(node => node.type === 'shortText');
  question.numericOnly = true;
  const restored = await Core.decodeFlow(await Core.encodeFlow(flow));
  assert.equal(restored.nodes.find(node => node.id === question.id).numericOnly, true);

  delete question.numericOnly;
  assert.equal(Core.normalizeFlow(flow).nodes.find(node => node.id === question.id).numericOnly, false);
});

test('published flow compresses and decodes without losing branching', async () => {
  const flow = Core.createSampleFlow();
  const urlData = await Core.encodeFlow(flow);
  const restored = await Core.decodeFlow(urlData);
  assert.equal(restored.id, flow.id);
  assert.equal(restored.nodes.length, flow.nodes.length);
  assert.deepEqual(restored.edges.filter(edge => edge.optionValue).map(edge => edge.optionValue), ['Yes, in production', 'I’m exploring the space']);
});

test('flow validation rejects a single-choice option with no route', () => {
  const flow = Core.createSampleFlow();
  flow.edges = flow.edges.filter(edge => edge.optionValue !== 'I’m exploring the space');
  assert.throws(() => Core.normalizeFlow(flow), /every answer.*exactly one path/i);
});

test('flow validation rejects a cycle', () => {
  const flow = Core.createFlow('Acme', 'Designer', 'About the role.');
  const candidate = flow.nodes[0];
  const end = flow.nodes[1];
  const choice = Core.createNode('singleChoice', 400, 250);
  const question = Core.createNode('shortText', 750, 250);
  choice.options = ['Continue', 'Finish'];
  flow.nodes.push(choice, question);
  flow.edges = [
    { id: 'candidate-choice', fromNodeId: candidate.id, toNodeId: choice.id },
    { id: 'choice-loop', fromNodeId: choice.id, toNodeId: question.id, optionValue: 'Continue' },
    { id: 'choice-end', fromNodeId: choice.id, toNodeId: end.id, optionValue: 'Finish' },
    { id: 'question-loop', fromNodeId: question.id, toNodeId: choice.id }
  ];
  assert.throws(() => Core.normalizeFlow(flow), /journey contains a loop/i);
});

test('published-flow links reject invalid token formats', async () => {
  await assert.rejects(() => Core.decodeFlow('not-a-valid-flow'), /not recognized/i);
});

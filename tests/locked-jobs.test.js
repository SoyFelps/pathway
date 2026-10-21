const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const context = { console, TextEncoder, TextDecoder, CompressionStream, DecompressionStream, Blob, Response, Uint8Array, Set, Date, Math, JSON, atob, btoa, localStorage: { getItem: () => null, setItem: () => {} } };
context.window = context;
vm.createContext(context);
vm.runInContext(read('pathway.js'), context);
const Core = context.PathwayCore;

const good = () => ({
  nodes: [{ id: 'c', type: 'candidateInfo', options: [] }, { id: 'q', type: 'singleChoice', options: ['Yes', 'No'] }, { id: 'e', type: 'end', options: [] }],
  edges: [{ id: 'x1', fromNodeId: 'c', toNodeId: 'q' }, { id: 'x2', fromNodeId: 'q', toNodeId: 'e', optionValue: 'Yes' }]
});

test('every job the app creates passes the minimum-structure check', () => {
  assert.equal(Core.flowIsUsable(Core.createFlow('Acme', 'Designer', 'x')), true);
  assert.equal(Core.flowIsUsable(Core.createSampleFlow()), true);
  assert.equal(Core.flowIsUsable(good()), true);
});

test('an incomplete job is recognised (the same cases the database refuses)', () => {
  const broken = [
    null, undefined, 'text', [], {},
    { nodes: [], edges: [] },
    { nodes: good().nodes },
    { ...good(), edges: 'nope' },
    { ...good(), nodes: good().nodes.filter(node => node.type !== 'candidateInfo') },
    { ...good(), nodes: good().nodes.filter(node => node.type !== 'end') },
    { ...good(), nodes: [...good().nodes, { id: 'c2', type: 'candidateInfo' }] },
    { ...good(), nodes: [...good().nodes, { id: 'c', type: 'end' }] },
    { ...good(), nodes: [...good().nodes, { id: 'z', type: 'bogus' }] },
    { ...good(), nodes: good().nodes.map(node => node.type === 'singleChoice' ? { id: node.id, type: node.type } : node) },
    { ...good(), edges: [...good().edges, { id: 'x3', fromNodeId: 'c', toNodeId: 'ghost' }] },
    { ...good(), edges: [{ id: 'x1', fromNodeId: 'c' }] }
  ];
  broken.forEach((flow, index) => assert.equal(Core.flowIsUsable(flow), false, `case ${index} must be refused`));
});

test('the database refuses to save an incomplete job but still lets a damaged one be unpublished or deleted', () => {
  const sql = read('supabase/migrations/20261020170000_flow_data_minimum_structure.sql');
  assert.ok(sql.includes('create or replace function public.flow_data_is_valid(p jsonb)'));
  assert.ok(sql.includes("jsonb_array_length(p -> 'nodes') not between 2 and 200"));
  assert.ok(sql.includes("node_type not in ('candidateInfo', 'shortText', 'singleChoice', 'multiChoice', 'end')"));
  assert.ok(sql.includes('if info_count <> 1 or end_count < 1 then return false; end if;'));
  assert.ok(sql.includes("raise exception 'This job is incomplete and cannot be saved."));
  assert.ok(sql.includes("if tg_op = 'INSERT' or new.flow_data is distinct from old.flow_data then"), 'only runs when the content changes');
  assert.ok(sql.includes('before insert or update on public.application_flows'));
  assert.match(sql, /revoke all on function public\.flow_data_is_valid\(jsonb\) from public, anon, authenticated;/);
  assert.match(sql, /require_valid_flow_data\(\)\nreturns trigger\nlanguage plpgsql\nsecurity definer/);
});

test('the dashboard locks an incomplete job (red card, only Delete) instead of breaking', () => {
  const builder = read('builder.js');
  assert.ok(builder.includes('const flowIsDamaged = flow => !C.flowIsUsable(flow);'));
  assert.ok(builder.includes('if (flowIsDamaged(flow)) return damagedFlowCardHtml(flow);'));
  assert.ok(builder.includes('This job has incomplete data and is locked. It is not accepting applications. Contact support.'));
  assert.ok(builder.includes('and its public link is turned off so no new applications arrive'));
  assert.ok(builder.includes('flowIsDamaged(flow) && flow.publicationStatus === \'published\''), 'a damaged published job is unpublished as soon as the dashboard sees it');
  assert.ok(builder.includes('window.PathwayBackend.unpublishFlow(flow, workspace)'));
  assert.ok(builder.includes('if (flow && flowIsDamaged(flow)) return showFlowMenu(id);'), 'a locked job never opens in the editor');
  assert.ok(builder.includes('flowIsDamaged(flow) ? 0 : flow.nodes.length'), 'the totals skip it');
  const menu = builder.slice(builder.indexOf('function showFlowMenu(id)'), builder.indexOf('modalRoot.querySelector(\'#copy-flow-url\')'));
  assert.ok(menu.includes('const damaged = flowIsDamaged(flow);'));
  assert.ok(menu.includes('<button class="btn btn-danger" id="delete-flow">Delete flow</button><button class="btn" data-close>Close</button>'));
  assert.equal(/damaged[^\n]*id=\\"toggle-flow-status\\"/.test(menu.split('else setModal')[0]), false, 'no publish/unpublish for a locked job');
  assert.match(read('styles.css'), /\.flow-card\.is-damaged\{border-color:var\(--red-border\)/);
  assert.match(read('index.html'), /builder\.js\?v=versions-20261021/);
});

test('a damaged job cannot keep collecting candidate data: the database, the public page and the intake function all stop it', () => {
  const sql = read('supabase/migrations/20261020180000_unpublish_damaged_jobs.sql');
  assert.ok(sql.includes("or (new.publication_status = 'published' and old.publication_status is distinct from 'published')"), 'a damaged job cannot be published');
  assert.ok(sql.includes('and public.flow_data_is_valid(f.flow_data)\n    and public.workspace_has_active_subscription(pf.workspace_id)'), 'the public page does not serve it');
  assert.match(sql, /grant execute on function public\.application_flow_is_intact\(uuid\) to service_role;/);
  assert.match(sql, /grant execute on function public\.unpublish_damaged_flow\(uuid\) to service_role;/);
  assert.equal(/grant execute on function public\.(application_flow_is_intact|unpublish_damaged_flow)[^;]*(anon|authenticated)/.test(sql), false);
  assert.ok(sql.includes("where f.publication_status = 'published' and not public.flow_data_is_valid(f.flow_data);"), 'one-time sweep of jobs that are damaged and published');
  const edge = read('supabase/functions/applications/index.ts');
  const load = edge.slice(edge.indexOf('async function loadActiveFlow'), edge.indexOf('function parseJsonField'));
  assert.ok(load.includes('admin.rpc("application_flow_is_intact", { p_flow_id: flow.id })'));
  assert.ok(load.includes('admin.rpc("unpublish_damaged_flow", { p_flow_id: flow.id })'));
  assert.ok(load.indexOf('application_flow_is_intact') < load.indexOf('workspace_subscriptions'), 'checked before anything is accepted');
  assert.ok(load.includes('throw new Error("This job is no longer accepting applications.");'));
});

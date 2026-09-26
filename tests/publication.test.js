const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function createBackendHarness() {
  const calls = [];
  let snapshotSequence = 0;
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null }) },
    from(table) {
      const query = {
        payload: null,
        filters: [],
        insert(payload) { this.payload = payload; calls.push({ table, method: 'insert', payload }); return this; },
        update(payload) { this.payload = payload; calls.push({ table, method: 'update', payload }); return this; },
        delete() { calls.push({ table, method: 'delete' }); return this; },
        eq(field, value) { this.filters.push([field, value]); return this; },
        select() { return this; },
        single: async function () {
          if (table === 'published_flows' && this.payload) {
            snapshotSequence += 1;
            return { data: { id: `snapshot-${snapshotSequence}` }, error: null };
          }
          return { data: { id: this.filters.find(([field]) => field === 'id')?.[1] || 'flow-db-1' }, error: null };
        }
      };
      return query;
    },
    rpc: async () => ({ data: null, error: null })
  };
  const context = {
    console,
    PATHWAY_SUPABASE_CONFIG: { url: 'https://example.supabase.co', publishableKey: 'public-test-key' },
    supabase: { createClient: () => client }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../backend.js'), 'utf8'), context);
  return { backend: context.PathwayBackend, calls };
}

test('publishing saves the flow, inserts a snapshot, and activates its public token', async () => {
  const { backend, calls } = createBackendHarness();
  const flow = {
    id: 'flow-1', companyName: 'Acme', jobTitle: 'Designer', jobDescription: 'Create thoughtful products.',
    publicationStatus: 'draft', activePublishedFlowId: null, nodes: [], edges: []
  };
  const token = await backend.publishFlow(flow, { id: 'workspace-1' });
  assert.equal(token, 'snapshot-1');
  assert.equal(flow.cloudId, 'flow-db-1');
  assert.equal(flow.publicationStatus, 'published');
  assert.equal(flow.activePublishedFlowId, token);
  const snapshot = calls.find(call => call.table === 'published_flows' && call.method === 'insert');
  assert.equal(snapshot.payload.flow_id, flow.cloudId);
  const activation = calls.find(call => call.table === 'application_flows' && call.payload?.publication_status === 'published');
  assert.equal(activation.payload.active_published_flow_id, token);
  assert.equal(snapshot.payload.snapshot.publicationStatus, undefined);
});

test('unpublishing clears the active token and returns the flow to draft', async () => {
  const { backend, calls } = createBackendHarness();
  const flow = { id: 'flow-1', cloudId: 'flow-db-1', publicationStatus: 'published', activePublishedFlowId: 'snapshot-1' };
  await backend.unpublishFlow(flow, { id: 'workspace-1' });
  assert.equal(flow.publicationStatus, 'draft');
  assert.equal(flow.activePublishedFlowId, null);
  const change = calls.find(call => call.table === 'application_flows' && call.payload?.publication_status === 'draft');
  assert.equal(change.payload.active_published_flow_id, null);
});

test('published snapshot RPC only serves the currently active published snapshot', () => {
  const sql = fs.readFileSync(require.resolve('../supabase/migrations/20260926125422_add_flow_publication_lifecycle.sql'), 'utf8');
  assert.match(sql, /f\.publication_status\s*=\s*'published'/i);
  assert.match(sql, /f\.active_published_flow_id\s*=\s*pf\.id/i);
});

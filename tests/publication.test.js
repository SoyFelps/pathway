const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function createBackendHarness({ paid = true } = {}) {
  const calls = [];
  let snapshotSequence = 0;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    },
    from(table) {
      const query = {
        payload: null,
        filters: [],
        insert(payload) { this.payload = payload; calls.push({ table, method: 'insert', payload }); return this; },
        update(payload) { this.payload = payload; calls.push({ table, method: 'update', payload }); return this; },
        delete() { calls.push({ table, method: 'delete' }); return this; },
        eq(field, value) { this.filters.push([field, value]); return this; },
        select() { return this; },
        maybeSingle: async function () {
          if (table === 'workspace_subscriptions') return { data: paid ? { status: 'active', current_period_end: '2099-01-01T00:00:00.000Z', cancel_at_period_end: false } : null, error: null };
          return { data: null, error: null };
        },
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
    rpc: async (name, args) => {
      calls.push({ table: 'rpc', method: name, payload: args });
      if (name === 'update_published_flow_snapshot') return { data: '2026-10-01T14:00:00.000Z', error: null };
      return { data: null, error: null };
    }
  };
  const context = {
    console,
    PATHWAY_SUPABASE_CONFIG: { url: 'https://example.supabase.co', publishableKey: 'public-test-key' },
    supabase: { createClient: () => client },
    URL,
    location: { href: 'https://soyfelps.github.io/pathway/' }
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

test('publishing changes updates the existing snapshot and keeps its active public token', async () => {
  const { backend, calls } = createBackendHarness();
  const activeToken = 'snapshot-existing';
  const flow = {
    id: 'flow-1', cloudId: 'flow-db-1', companyName: 'Acme', jobTitle: 'Designer',
    jobDescription: 'Updated description.', publicationStatus: 'published', activePublishedFlowId: activeToken,
    publishedAt: '2026-10-01T12:00:00.000Z', nodes: [], edges: []
  };
  const publishedAt = await backend.updatePublishedFlow(flow, { id: 'workspace-1' });
  assert.equal(publishedAt, '2026-10-01T14:00:00.000Z');
  assert.equal(flow.activePublishedFlowId, activeToken);
  assert.equal(flow.publishedAt, publishedAt);
  assert.equal(calls.some(call => call.table === 'published_flows' && call.method === 'insert'), false);
  assert.equal(calls.some(call => call.table === 'application_flows' && call.method === 'update'), false);
  const rpc = calls.find(call => call.table === 'rpc' && call.method === 'update_published_flow_snapshot');
  assert.equal(rpc.payload.p_flow_id, 'flow-db-1');
});

test('republish RPC updates only the active snapshot and requires an authorized paid flow editor', () => {
  const sql = fs.readFileSync(require.resolve('../supabase/migrations/20261001132237_republish_flow_snapshots_in_place.sql'), 'utf8');
  const rpc = sql.slice(sql.indexOf('create or replace function public.update_published_flow_snapshot'));
  assert.match(sql, /add column if not exists published_at timestamptz/);
  assert.match(rpc, /auth\.uid\(\)/);
  assert.match(rpc, /workspace_user_has_permission\(v_workspace_id, 'flows'\)/);
  assert.match(rpc, /workspace_has_active_subscription\(v_workspace_id\)/);
  assert.match(rpc, /update public\.published_flows pf\s+set snapshot = v_snapshot[\s\S]*?pf\.id = v_publication_id/);
  assert.doesNotMatch(rpc, /insert into public\.published_flows/i);
  assert.match(rpc, /grant execute on function public\.update_published_flow_snapshot\(uuid\) to authenticated/);
});

test('free workspaces cannot publish through the authenticated backend adapter', async () => {
  const { backend, calls } = createBackendHarness({ paid: false });
  const flow = { id: 'flow-1', companyName: 'Acme', jobTitle: 'Designer', nodes: [], edges: [], publicationStatus: 'draft' };
  await assert.rejects(backend.publishFlow(flow, { id: 'workspace-1' }), /active subscription is required/i);
  assert.equal(calls.length, 0);
  assert.equal(flow.publicationStatus, 'draft');
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

test('published-flow RPC remains executable by candidates and signed-in workspace users', () => {
  const gateMigration = fs.readFileSync(require.resolve('../supabase/migrations/20260926195500_stripe_subscription_publication_gates.sql'), 'utf8');
  const permissionFix = fs.readFileSync(require.resolve('../supabase/migrations/20260927115500_restore_authenticated_published_flow_lookup.sql'), 'utf8');
  assert.match(gateMigration, /grant execute on function public\.get_published_flow\(uuid\) to anon/);
  assert.match(permissionFix, /grant execute on function public\.get_published_flow\(uuid\) to authenticated/);
});


test('published flow produces a public apply URL using the active snapshot token', () => {
  const { backend } = createBackendHarness();
  const link = backend.getPublishedJobUrl({
    publicationStatus: 'published', activePublishedFlowId: '11111111-1111-4111-8111-111111111111'
  });
  assert.equal(link, 'https://soyfelps.github.io/pathway/apply.html#id=11111111-1111-4111-8111-111111111111');
});

test('draft flows cannot produce a public job URL', () => {
  const { backend } = createBackendHarness();
  assert.throws(() => backend.getPublishedJobUrl({ publicationStatus: 'draft', activePublishedFlowId: null }), /publish this flow/i);
});

test('builder exposes the copy action only for published flows with an active token', () => {
  const source = fs.readFileSync(require.resolve('../builder.js'), 'utf8');
  assert.ok(source.includes("flow.publicationStatus === 'published' && flow.activePublishedFlowId ?"));
  assert.ok(source.includes('copy-job-url'));
});


test('dashboard flow menu replaces Keep flow with status-aware lifecycle and link actions', () => {
  const source = fs.readFileSync(require.resolve('../builder.js'), 'utf8');
  assert.ok(!source.includes('Keep flow'));
  assert.ok(source.includes("const isPublished = flow.publicationStatus === 'published'"));
  assert.ok(source.includes("isPublished ? 'Unpublish' : subscription?.active ? 'Publish' : 'Upgrade to publish'"));
  assert.ok(source.includes("isPublished || !subscription?.active ? '' : 'btn-primary'"));
  assert.ok(source.includes("id=\"copy-flow-url\">Copy job link"));
});

test('editor surfaces publish changes between workspace save status and candidate preview', () => {
  const source = fs.readFileSync(require.resolve('../builder.js'), 'utf8');
  assert.ok(source.includes("insertAdjacentHTML('afterend', '<div id=\"publish-changes-slot\"></div>')"));
  assert.ok(source.includes('You have changes that aren’t published yet.'));
  assert.ok(source.includes('Publish changes'));
  assert.ok(source.includes('function hasUnpublishedChanges(flow)'));
  assert.ok(source.includes("Date.parse(flow.updatedAt || '')"));
  assert.ok(source.includes('window.PathwayBackend.updatePublishedFlow(flow, workspace)'));
});

test('publish instructions explain that edits update the current public job link', () => {
  const source = fs.readFileSync(require.resolve('../builder.js'), 'utf8');
  assert.ok(source.includes('Use Publish changes to update this same job link after editing.'));
  assert.ok(!source.includes("New edits won't change this published snapshot."));
  assert.ok(!source.includes('this early release does not yet save or deliver application responses'));
});

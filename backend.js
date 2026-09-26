/* Authenticated Supabase data access for the static GitHub Pages client. */
(function () {
  const config = window.PATHWAY_SUPABASE_CONFIG;
  if (!config || !window.supabase || !window.supabase.createClient) throw new Error('Pathway could not load its Supabase settings.');
  const client = window.supabase.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const saveQueues = new Map();

  async function requireSession() {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error('Your session expired. Sign in again to continue.');
    return data.session;
  }

  async function bootstrap() {
    const { data: authData, error: authError } = await client.auth.getSession();
    if (authError) throw authError;
    if (!authData.session) return { session: null, workspace: null, flows: [] };
    const user = authData.session.user;
    const { data: workspace, error: workspaceError } = await client.from('workspaces').select('id,name,created_at').eq('owner_id', user.id).single();
    if (workspaceError) throw new Error(`Could not load your workspace: ${workspaceError.message}`);
    const flows = await listFlows(workspace.id);
    return { session: authData.session, user, workspace, flows };
  }

  async function listFlows(workspaceId) {
    await requireSession();
    const { data, error } = await client.from('application_flows').select('id,workspace_id,created_by,company_name,job_title,flow_data,created_at,updated_at').eq('workspace_id', workspaceId).order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(row => ({ ...row.flow_data, id: row.flow_data.id || row.id, cloudId: row.id, workspaceId: row.workspace_id, createdBy: row.created_by, companyName: row.company_name, jobTitle: row.job_title, updatedAt: row.updated_at }));
  }

  function saveFlow(flow, workspace) {
    const previous = saveQueues.get(flow.id) || Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      const session = await requireSession();
      const { cloudId, workspaceId, createdBy, ...flowData } = flow;
      const row = { workspace_id: workspace.id, created_by: session.user.id, company_name: flow.companyName, job_title: flow.jobTitle, flow_data: flowData };
      let result;
      if (cloudId) result = await client.from('application_flows').update(row).eq('id', cloudId).eq('workspace_id', workspace.id).select('id').single();
      else result = await client.from('application_flows').insert(row).select('id').single();
      if (result.error) throw result.error;
      flow.cloudId = result.data.id;
      flow.workspaceId = workspace.id;
      flow.createdBy = session.user.id;
      return flow;
    });
    saveQueues.set(flow.id, pending);
    pending.finally(() => { if (saveQueues.get(flow.id) === pending) saveQueues.delete(flow.id); }).catch(() => {});
    return pending;
  }

  async function deleteFlow(flow, workspace) {
    await requireSession();
    await saveQueues.get(flow.id)?.catch(() => {});
    if (!flow.cloudId) return;
    const { error } = await client.from('application_flows').delete().eq('id', flow.cloudId).eq('workspace_id', workspace.id);
    if (error) throw error;
  }

  async function publishFlow(flow, workspace) {
    await saveQueues.get(flow.id)?.catch(() => {});
    await saveFlow(flow, workspace);
    const session = await requireSession();
    const flowData = { ...flow };
    delete flowData.cloudId; delete flowData.workspaceId; delete flowData.createdBy;
    const { data, error } = await client.from('published_flows').insert({
      workspace_id: workspace.id,
      flow_id: flow.cloudId,
      created_by: session.user.id,
      snapshot: flowData
    }).select('id').single();
    if (error) throw error;
    return data.id;
  }

  async function getPublishedFlow(token) {
    const { data, error } = await client.rpc('get_published_flow', { p_token: token });
    if (error) throw error;
    if (!data) throw new Error('This application link is invalid or unavailable.');
    return data;
  }

  async function updateWorkspaceName(workspace, name) {
    const { data, error } = await client.from('workspaces').update({ name }).eq('id', workspace.id).select('id,name,created_at').single();
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }

  window.PathwayBackend = {
    client,
    bootstrap,
    listFlows,
    saveFlow,
    deleteFlow,
    publishFlow,
    getPublishedFlow,
    updateWorkspaceName,
    signOut,
    signIn: (email, password) => client.auth.signInWithPassword({ email, password }),
    signUp: (email, password, workspaceName) => client.auth.signUp({
      email,
      password,
      options: { data: { workspace_name: workspaceName }, emailRedirectTo: window.location.origin + window.location.pathname }
    })
  };
})();

/* Authenticated Supabase data access for the static GitHub Pages client. */
(function () {
  const config = window.PATHWAY_SUPABASE_CONFIG;
  if (!config || !window.supabase || !window.supabase.createClient) throw new Error('Pathway could not load its Supabase settings.');
  const client = window.supabase.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const saveQueues = new Map();
  const APPLICATIONS_FUNCTION = `${config.url.replace(/\/$/, '')}/functions/v1/applications`;
  const APPLICANT_STATUSES = new Set(['new', 'failed', 'promising', 'approved']);

  async function callApplications(body, accessToken = '') {
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    const headers = { apikey: config.publishableKey };
    if (!isFormData) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    let result;
    try { result = await fetch(APPLICATIONS_FUNCTION, { method: 'POST', headers, body: isFormData ? body : JSON.stringify(body) }); }
    catch (_) { throw new Error('Could not reach the application service. Check your connection and try again.'); }
    let payload = {};
    try { payload = await result.json(); } catch (_) { /* stable fallback below */ }
    if (!result.ok) throw new Error(payload.error || 'The application service could not complete this request.');
    return payload;
  }

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
    const { data, error } = await client.from('application_flows').select('id,workspace_id,created_by,company_name,job_title,flow_data,publication_status,active_published_flow_id,created_at,updated_at').eq('workspace_id', workspaceId).order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(row => ({ ...row.flow_data, id: row.flow_data.id || row.id, cloudId: row.id, workspaceId: row.workspace_id, createdBy: row.created_by, companyName: row.company_name, jobTitle: row.job_title, publicationStatus: row.publication_status || 'draft', activePublishedFlowId: row.active_published_flow_id || null, updatedAt: row.updated_at }));
  }

  function saveFlow(flow, workspace) {
    const previous = saveQueues.get(flow.id) || Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      const session = await requireSession();
      const { cloudId, workspaceId, createdBy, publicationStatus, activePublishedFlowId, ...flowData } = flow;
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
    const session = await requireSession();
    const cleanup = await callApplications({ action: 'deleteFlow', flowId: flow.cloudId }, session.access_token);
    if (!cleanup.deleted) throw new Error('The flow could not be deleted.');
    return cleanup;
  }

  async function publishFlow(flow, workspace) {
    await saveQueues.get(flow.id)?.catch(() => {});
    await saveFlow(flow, workspace);
    const session = await requireSession();
    const { cloudId, workspaceId, createdBy, publicationStatus, activePublishedFlowId, ...flowData } = flow;
    const { data, error } = await client.from('published_flows').insert({
      workspace_id: workspace.id,
      flow_id: flow.cloudId,
      created_by: session.user.id,
      snapshot: flowData
    }).select('id').single();
    if (error) throw error;
    const { error: stateError } = await client.from('application_flows')
      .update({ publication_status: 'published', active_published_flow_id: data.id })
      .eq('id', flow.cloudId).eq('workspace_id', workspace.id).select('id').single();
    if (stateError) {
      await client.from('published_flows').delete().eq('id', data.id).eq('workspace_id', workspace.id);
      throw stateError;
    }
    flow.publicationStatus = 'published';
    flow.activePublishedFlowId = data.id;
    return data.id;
  }

  async function unpublishFlow(flow, workspace) {
    await saveQueues.get(flow.id)?.catch(() => {});
    await requireSession();
    if (!flow.cloudId) throw new Error('This flow has not been saved to your workspace yet.');
    const { error } = await client.from('application_flows')
      .update({ publication_status: 'draft', active_published_flow_id: null })
      .eq('id', flow.cloudId).eq('workspace_id', workspace.id).select('id').single();
    if (error) throw error;
    flow.publicationStatus = 'draft';
    flow.activePublishedFlowId = null;
  }

  function getPublishedJobUrl(flow) {
    if (!flow || flow.publicationStatus !== 'published' || !flow.activePublishedFlowId) {
      throw new Error('Publish this flow to create a public job link.');
    }
    const url = new URL('apply.html', window.location.href);
    url.hash = `id=${encodeURIComponent(flow.activePublishedFlowId)}`;
    return url.href;
  }

  async function getPublishedFlow(token) {
    const { data, error } = await client.rpc('get_published_flow', { p_token: token });
    if (error) throw error;
    if (!data) throw new Error('This application link is invalid or unavailable.');
    return data;
  }

  async function listApplicants(workspaceId, flowId = '') {
    await requireSession();
    let query = client.from('applicants')
      .select('id,workspace_id,flow_id,published_flow_id,candidate_name,candidate_email,candidate_info,responses,resume_path,resume_filename,resume_content_type,status,submitted_at,updated_at,privacy_notice_version,privacy_acknowledged_at')
      .eq('workspace_id', workspaceId)
      .order('submitted_at', { ascending: false })
      .limit(1000);
    if (flowId) query = query.eq('flow_id', flowId);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function updateApplicantStatus(applicantId, status) {
    if (!APPLICANT_STATUSES.has(status)) throw new Error('Choose a valid applicant stage.');
    await requireSession();
    const { data, error } = await client.from('applicants').update({ status }).eq('id', applicantId).select('id,status,updated_at').single();
    if (error) throw error;
    return data;
  }

  async function getApplicantResumeUrl(path) {
    await requireSession();
    if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('..')) throw new Error('This resume link is not valid.');
    const { data, error } = await client.storage.from('applicant-resumes').createSignedUrl(path, 120, { download: true });
    if (error) throw error;
    return data.signedUrl;
  }

  async function submitApplication(application) {
    const resume = application && application.resume;
    if (!(resume instanceof File) || !resume.size) throw new Error('Select a PDF, DOC, or DOCX resume before continuing.');
    if (resume.size > 10 * 1024 * 1024) throw new Error('Your resume must be 10 MB or smaller.');
    const submissionKey = application.submissionKey || crypto.randomUUID();
    const form = new FormData();
    form.set('publishedFlowId', application.publishedFlowId);
    form.set('submissionKey', submissionKey);
    form.set('name', application.name);
    form.set('email', application.email);
    form.set('candidateInfo', JSON.stringify(application.candidateInfo || {}));
    form.set('answers', JSON.stringify(application.answers || []));
    form.set('privacyAcknowledged', String(Boolean(application.privacyAcknowledged)));
    form.set('website', application.website || '');
    form.set('resume', resume, resume.name);
    return await callApplications(form);
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
    unpublishFlow,
    getPublishedFlow,
    getPublishedJobUrl,
    listApplicants,
    updateApplicantStatus,
    getApplicantResumeUrl,
    submitApplication,
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

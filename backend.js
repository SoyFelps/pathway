/* Authenticated Supabase data access for the static GitHub Pages client. */
(function () {
  const config = window.PATHWAY_SUPABASE_CONFIG;
  if (!config || !window.supabase || !window.supabase.createClient) throw new Error('Pathway could not load its Supabase settings.');
  const client = window.supabase.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const saveQueues = new Map();
  const APPLICATIONS_FUNCTION = `${config.url.replace(/\/$/, '')}/functions/v1/applications`;
  const BILLING_FUNCTION = `${config.url.replace(/\/$/, '')}/functions/v1/billing`;
  const TEAM_FUNCTION = `${config.url.replace(/\/$/, '')}/functions/v1/team`;
  const DELETE_ACCOUNT_FUNCTION = `${config.url.replace(/\/$/, '')}/functions/v1/delete-account`;
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

  async function callTeam(body, accessToken = null) {
    const session = accessToken === null ? await requireSession() : null;
    const token = accessToken === null ? session.access_token : accessToken;
    const headers = { apikey: config.publishableKey, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    let result;
    try { result = await fetch(TEAM_FUNCTION, { method: 'POST', headers, body: JSON.stringify(body) }); }
    catch (_) { throw new Error('Could not reach the team service. Check your connection and try again.'); }
    let payload = {};
    try { payload = await result.json(); } catch (_) { /* stable fallback below */ }
    if (!result.ok) throw new Error(payload.error || 'The team service could not complete this request.');
    return payload;
  }

  async function previewTeamInvitation(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) throw new Error('This invitation link is invalid.');
    return callTeam({ action: 'previewInvitation', token }, '');
  }

  async function createTeamInvitation(email, permissions) {
    return callTeam({ action: 'createInvitation', email, permissions, appUrl: window.location.origin + window.location.pathname });
  }

  async function listTeam() { return callTeam({ action: 'listTeam' }); }
  async function acceptTeamInvitation(token) { return callTeam({ action: 'acceptInvitation', token }); }
  async function acceptPendingTeamInvitation() { return callTeam({ action: 'acceptPendingInvitation' }); }
  async function updateTeamMemberPermissions(memberId, permissions) { return callTeam({ action: 'updateMemberPermissions', memberId, permissions }); }
  async function updateTeamInvitationPermissions(invitationId, permissions) { return callTeam({ action: 'updateInvitationPermissions', invitationId, permissions }); }
  async function getTeamInvitationLink(invitationId) { return callTeam({ action: 'getInvitationLink', invitationId, appUrl: window.location.origin + window.location.pathname }); }
  async function revokeTeamInvitation(invitationId) { return callTeam({ action: 'revokeInvitation', invitationId }); }
  async function removeTeamMember(memberId) { return callTeam({ action: 'removeMember', memberId }); }
  async function leaveTeam() { return callTeam({ action: 'leaveTeam' }); }

  async function deleteWorkspace() {
    const session = await requireSession();
    let result;
    try {
      result = await fetch(BILLING_FUNCTION, {
        method: 'POST',
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteWorkspace' })
      });
    } catch (_) {
      throw new Error('Could not reach the workspace service. Check your connection and try again.');
    }
    let payload = {};
    try { payload = await result.json(); } catch (_) { /* stable fallback below */ }
    if (!result.ok) throw new Error(payload.error || 'The workspace could not be deleted.');
    if (!payload.deleted) throw new Error('The workspace deletion was not confirmed. Refresh the page before retrying.');
    return payload;
  }

  async function deleteAccount(password) {
    if (typeof password !== 'string' || !password.length) throw new Error('Enter your password to confirm account deletion.');
    const session = await requireSession();
    let result;
    try {
      result = await fetch(DELETE_ACCOUNT_FUNCTION, {
        method: 'POST',
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ password })
      });
    } catch (_) {
      throw new Error('Could not reach the account service. Check your connection and try again.');
    }
    let payload = {};
    try { payload = await result.json(); } catch (_) { /* stable fallback below */ }
    if (!result.ok) throw new Error(payload.error || 'Your account could not be deleted.');
    if (!payload.deleted) throw new Error('The account deletion was not confirmed. Refresh the page before retrying.');
    try { await client.auth.signOut({ scope: 'local' }); } catch (_) { /* the Auth user and refresh sessions were already deleted server-side */ }
    return payload;
  }

  async function createWorkspace(name) {
    const session = await requireSession();
    const cleanName = String(name || '').trim().slice(0, 120);
    if (!cleanName) throw new Error('Enter a name for your workspace.');
    const { data, error } = await client.from('workspaces').insert({ owner_id: session.user.id, name: cleanName }).select('id,name,created_at').single();
    if (error) throw error;
    return data;
  }

  async function getSubscriptionState(workspaceId) {
    const session = await requireSession();
    const { data, error } = await client.from('workspace_subscriptions')
      .select('status,current_period_end,cancel_at_period_end,stripe_customer_id,stripe_subscription_id')
      .eq('workspace_id', workspaceId).maybeSingle();
    if (error) throw error;
    const currentPeriodEnd = data?.current_period_end ? Date.parse(data.current_period_end) : 0;
    if (!data) {
      const { data: membership, error: membershipError } = await client.from('workspace_members').select('id').eq('workspace_id', workspaceId).eq('user_id', session.user.id).maybeSingle();
      if (membershipError) throw membershipError;
      if (membership) {
        const team = await callTeam({ action: 'context' });
        if (team.workspace?.id === workspaceId && team.isMember) {
          return { status: team.premiumActive ? 'active' : 'expired', currentPeriodEnd: null, cancelAtPeriodEnd: false, hasBillingHistory: false, active: Boolean(team.premiumActive) };
        }
      }
    }
    return {
      status: data?.status || 'free',
      currentPeriodEnd: data?.current_period_end || null,
      cancelAtPeriodEnd: Boolean(data?.cancel_at_period_end),
      hasBillingHistory: Boolean(data?.stripe_customer_id && data?.stripe_subscription_id),
      active: data?.status === 'active' && currentPeriodEnd > Date.now()
    };
  }

  async function createCheckoutSession() {
    const session = await requireSession();
    let result;
    try {
      result = await fetch(BILLING_FUNCTION, {
        method: 'POST',
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: '{}'
      });
    } catch (_) {
      throw new Error('Could not reach the billing service. Check your connection and try again.');
    }
    let payload = {};
    try { payload = await result.json(); } catch (_) { /* stable fallback below */ }
    if (!result.ok) throw new Error(payload.error || 'The subscription checkout could not be started.');
    if (!payload.client_secret) throw new Error('Stripe did not return a checkout form.');
    return payload.client_secret;
  }

  async function createPaymentMethodUpdateSession() {
    const session = await requireSession();
    let result;
    try {
      result = await fetch(BILLING_FUNCTION, {
        method: 'POST',
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'createPaymentMethodUpdateSession' })
      });
    } catch (_) {
      throw new Error('Could not reach the billing service. Check your connection and try again.');
    }
    let payload = {};
    try { payload = await result.json(); } catch (_) { /* stable fallback below */ }
    if (!result.ok) throw new Error(payload.error || 'The secure payment method update could not be opened.');
    if (typeof payload.url !== 'string') throw new Error('Stripe did not return a secure payment method update link.');
    let portalUrl;
    try { portalUrl = new URL(payload.url); } catch (_) { throw new Error('Stripe returned an invalid billing portal link.'); }
    if (portalUrl.protocol !== 'https:' || portalUrl.hostname !== 'billing.stripe.com') {
      throw new Error('Stripe returned an unexpected billing portal domain.');
    }
    return portalUrl.href;
  }

  async function getCurrentPaymentMethodSummary() {
    const session = await requireSession();
    let result;
    try {
      result = await fetch(BILLING_FUNCTION, {
        method: 'POST',
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getPaymentMethodSummary' })
      });
    } catch (_) {
      throw new Error('Could not reach the billing service. Check your connection and try again.');
    }
    let payload = {};
    try { payload = await result.json(); } catch (_) { /* stable fallback below */ }
    if (!result.ok) throw new Error(payload.error || 'The current payment method could not be loaded.');
    if (payload.payment_method == null) return null;
    const card = payload.payment_method;
    if (typeof card.brand !== 'string' || !/^\d{4}$/.test(card.last4) || !Number.isInteger(card.exp_month) || card.exp_month < 1 || card.exp_month > 12 || !Number.isInteger(card.exp_year) || card.exp_year < 2000) {
      throw new Error('Stripe returned incomplete payment method details.');
    }
    return { brand: card.brand, last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year };
  }

  async function listPaymentHistory(startingAfter = null) {
    const session = await requireSession();
    if (startingAfter != null && (typeof startingAfter !== 'string' || !/^in_[A-Za-z0-9]{1,64}$/.test(startingAfter))) {
      throw new Error('The invoice history cursor is invalid.');
    }
    let result;
    try {
      result = await fetch(BILLING_FUNCTION, {
        method: 'POST',
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'listPaymentHistory', ...(startingAfter ? { starting_after: startingAfter } : {}) })
      });
    } catch (_) {
      throw new Error('Could not reach the billing service. Check your connection and try again.');
    }
    let payload = {};
    try { payload = await result.json(); } catch (_) { /* stable fallback below */ }
    if (!result.ok) throw new Error(payload.error || 'Payment history could not be loaded.');
    if (!Array.isArray(payload.invoices) || payload.invoices.length > 10 || typeof payload.has_more !== 'boolean') {
      throw new Error('Stripe returned an invalid invoice history page.');
    }
    const allowedStatuses = new Set(['draft', 'open', 'paid', 'uncollectible', 'void']);
    const invoices = payload.invoices.map(invoice => {
      if (!invoice || typeof invoice.id !== 'string' || !/^in_[A-Za-z0-9]+$/.test(invoice.id)
        || typeof invoice.status !== 'string' || !allowedStatuses.has(invoice.status)
        || typeof invoice.currency !== 'string' || !/^[a-z]{3}$/.test(invoice.currency)
        || !Number.isSafeInteger(invoice.amount_minor) || !Number.isFinite(invoice.created_at)) {
        throw new Error('Stripe returned an invalid invoice record.');
      }
      const safeUrl = value => {
        if (typeof value !== 'string') return null;
        let url;
        try { url = new URL(value); } catch (_) { return null; }
        return url.protocol === 'https:' && (url.hostname === 'stripe.com' || url.hostname.endsWith('.stripe.com')) ? url.href : null;
      };
      return {
        id: invoice.id,
        number: typeof invoice.number === 'string' ? invoice.number : null,
        billingReason: typeof invoice.billing_reason === 'string' ? invoice.billing_reason : 'manual',
        status: invoice.status,
        currency: invoice.currency,
        amountMinor: invoice.amount_minor,
        createdAt: invoice.created_at,
        paidAt: Number.isFinite(invoice.paid_at) ? invoice.paid_at : null,
        hostedInvoiceUrl: safeUrl(invoice.hosted_invoice_url),
        invoicePdf: safeUrl(invoice.invoice_pdf)
      };
    });
    if (payload.has_more && (typeof payload.next_after !== 'string' || !/^in_[A-Za-z0-9]+$/.test(payload.next_after))) {
      throw new Error('Stripe returned an invalid invoice history cursor.');
    }
    return { invoices, hasMore: payload.has_more, nextAfter: payload.has_more ? payload.next_after : null };
  }

  async function syncPaymentMethodFromCustomer() {
    const session = await requireSession();
    let result;
    try {
      result = await fetch(BILLING_FUNCTION, {
        method: 'POST',
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'syncPaymentMethodFromCustomer' })
      });
    } catch (_) {
      throw new Error('Could not reach the billing service. Check your connection and try again.');
    }
    let payload = {};
    try { payload = await result.json(); } catch (_) { /* stable fallback below */ }
    if (!result.ok) throw new Error(payload.error || 'The updated payment method could not be applied to this subscription.');
    if (payload.payment_method == null) throw new Error('Stripe did not confirm a card for this subscription.');
    return payload.payment_method;
  }

  async function cancelSubscriptionAtPeriodEnd() {
    const session = await requireSession();
    let result;
    try {
      result = await fetch(BILLING_FUNCTION, {
        method: 'POST',
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancelSubscription' })
      });
    } catch (_) {
      throw new Error('Could not reach the billing service. Check your connection and try again.');
    }
    let payload = {};
    try { payload = await result.json(); } catch (_) { /* stable fallback below */ }
    if (!result.ok) throw new Error(payload.error || 'The cancellation request could not be completed.');
    if (!payload.cancel_at_period_end) throw new Error('Stripe did not confirm the scheduled cancellation.');
    return payload;
  }

  async function keepPremiumSubscription() {
    const session = await requireSession();
    let result;
    try {
      result = await fetch(BILLING_FUNCTION, {
        method: 'POST',
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resumeSubscription' })
      });
    } catch (_) {
      throw new Error('Could not reach the billing service. Check your connection and try again.');
    }
    let payload = {};
    try { payload = await result.json(); } catch (_) { /* stable fallback below */ }
    if (!result.ok) throw new Error(payload.error || 'The subscription renewal could not be restored.');
    if (payload.cancel_at_period_end !== false) throw new Error('Stripe did not confirm that cancellation was removed.');
    return payload;
  }

  async function bootstrap() {
    const { data: authData, error: authError } = await client.auth.getSession();
    if (authError) throw authError;
    if (!authData.session) return { session: null, workspace: null, flows: [], teamMember: null, canCreateWorkspace: false };
    const user = authData.session.user;
    const { data: ownedWorkspace, error: ownerError } = await client.from('workspaces').select('id,name,created_at').eq('owner_id', user.id).maybeSingle();
    if (ownerError) throw new Error(`Could not load your workspace: ${ownerError.message}`);
    if (ownedWorkspace) {
      const subscription = await getSubscriptionState(ownedWorkspace.id);
      const flows = await listFlows(ownedWorkspace.id);
      return { session: authData.session, user, workspace: ownedWorkspace, subscription, flows, isOwner: true, teamMember: null, canCreateWorkspace: false };
    }
    const team = await callTeam({ action: 'context' });
    if (team.workspace) {
      const subscription = { status: team.premiumActive ? 'active' : 'expired', currentPeriodEnd: null, cancelAtPeriodEnd: false, hasBillingHistory: false, active: Boolean(team.premiumActive) };
      const member = team.member || {};
      const flows = team.premiumActive && member.can_flows ? await listFlows(team.workspace.id) : [];
      return { session: authData.session, user, workspace: team.workspace, subscription, flows, isOwner: false, teamMember: member, canCreateWorkspace: false };
    }
    const { data: canCreateWorkspace, error: setupError } = await client.rpc('current_user_can_create_workspace');
    if (setupError) throw new Error(`Could not verify workspace setup: ${setupError.message}`);
    return { session: authData.session, user, workspace: null, subscription: null, flows: [], isOwner: false, teamMember: null, canCreateWorkspace: Boolean(canCreateWorkspace) };
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
      const row = { workspace_id: workspace.id, created_by: cloudId ? (createdBy || session.user.id) : session.user.id, company_name: flow.companyName, job_title: flow.jobTitle, flow_data: flowData };
      let result;
      if (cloudId) result = await client.from('application_flows').update(row).eq('id', cloudId).eq('workspace_id', workspace.id).select('id').single();
      else result = await client.from('application_flows').insert(row).select('id').single();
      if (result.error) throw result.error;
      flow.cloudId = result.data.id;
      flow.workspaceId = workspace.id;
      flow.createdBy = row.created_by;
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
    const subscription = await getSubscriptionState(workspace.id);
    if (!subscription.active) throw new Error('An active subscription is required to publish job flows.');
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

  async function countNewApplicants(workspaceId) {
    await requireSession();
    if (typeof workspaceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new Error('A valid workspace is required to count applicants.');
    const { count, error } = await client.from('applicants')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'new');
    if (error) throw error;
    return count || 0;
  }

  async function listApplicantFlowLabels() {
    const session = await requireSession();
    const payload = await callApplications({ action: 'listApplicantFlowLabels' }, session.access_token);
    if (!Array.isArray(payload.flows) || payload.flows.length > 1000) throw new Error('The applicant job filters could not be validated.');
    return payload.flows.map(flow => {
      if (!flow || typeof flow.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(flow.id) || typeof flow.jobTitle !== 'string' || typeof flow.companyName !== 'string') {
        throw new Error('The applicant job filters could not be validated.');
      }
      return { cloudId: flow.id, jobTitle: flow.jobTitle, companyName: flow.companyName };
    });
  }

  async function updateApplicantStatus(applicantId, status) {
    if (!APPLICANT_STATUSES.has(status)) throw new Error('Choose a valid applicant stage.');
    await requireSession();
    const { data, error } = await client.from('applicants').update({ status }).eq('id', applicantId).select('id,status,updated_at').single();
    if (error) throw error;
    return data;
  }

  async function getApplicantResumeUrl(path, download = false, filename = '') {
    await requireSession();
    if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('..')) throw new Error('This resume link is not valid.');
    const bucket = client.storage.from('applicant-resumes');
    const result = download
      ? await bucket.createSignedUrl(path, 120, { download: filename || true })
      : await bucket.createSignedUrl(path, 120);
    if (result.error) throw result.error;
    return result.data.signedUrl;
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
    getSubscriptionState,
    createWorkspace,
    previewTeamInvitation,
    createTeamInvitation,
    listTeam,
    acceptTeamInvitation,
    acceptPendingTeamInvitation,
    updateTeamMemberPermissions,
    updateTeamInvitationPermissions,
    getTeamInvitationLink,
    revokeTeamInvitation,
    removeTeamMember,
    leaveTeam,
    deleteWorkspace,
    deleteAccount,
    createCheckoutSession,
    createPaymentMethodUpdateSession,
    getCurrentPaymentMethodSummary,
    listPaymentHistory,
    syncPaymentMethodFromCustomer,
    cancelSubscriptionAtPeriodEnd,
    keepPremiumSubscription,
    listFlows,
    saveFlow,
    deleteFlow,
    publishFlow,
    unpublishFlow,
    getPublishedFlow,
    getPublishedJobUrl,
    listApplicants,
    countNewApplicants,
    listApplicantFlowLabels,
    updateApplicantStatus,
    getApplicantResumeUrl,
    submitApplication,
    updateWorkspaceName,
    signOut,
    signIn: (email, password) => client.auth.signInWithPassword({ email, password }),
    signUp: (email, password, workspaceName, inviteToken = '') => client.auth.signUp({
      email,
      password,
      options: {
        data: inviteToken ? { pathway_team_invite_pending: true } : { workspace_name: workspaceName },
        emailRedirectTo: window.location.origin + window.location.pathname
      }
    })
  };
})();

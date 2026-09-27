/* Pathway static flow builder. */
(function () {
  const C = window.PathwayCore;
  const root = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  const toast = document.getElementById('toast');
  const ICONS = {
    flows: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    node: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="8" height="6" rx="1.5"/><rect x="13" y="14" width="8" height="6" rx="1.5"/><path d="M11 7h3a2 2 0 0 1 2 2v5"/></svg>',
    arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h14M13 5l7 7-7 7"/></svg>',
    copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>'
  };
  let flows = [];
  let workspace = null;
  let user = null;
  let subscription = { status: 'free', active: false, currentPeriodEnd: null, cancelAtPeriodEnd: false };
  let subscriptionReturnPage = 'dashboard';
  let subscriptionReturnFlowId = null;
  let currentId = null;
  let selectedId = null;
  let connectFrom = null;
  let toastTimer;
  let saveTimer;
  let cloudSaveTimer;
  let previewController = null;
  let dragState = null;
  let applicants = [];
  let applicantFilter = '';
  let applicantSearch = '';
  const applicantStages = [
    { key: 'new', label: 'New', color: 'stage-new' },
    { key: 'failed', label: 'Failed', color: 'stage-failed' },
    { key: 'promising', label: 'Promising', color: 'stage-promising' },
    { key: 'approved', label: 'Approved', color: 'stage-approved' }
  ];

  const currentFlow = () => flows.find(flow => flow.id === currentId);
  const esc = C.esc;
  const save = () => {
    const flow = currentFlow();
    if (!flow || !workspace) return;
    flow.updatedAt = new Date().toISOString();
    const indicator = document.querySelector('.save-indicator');
    if (indicator) indicator.innerHTML = '<span class="status-dot"></span> Saving…';
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(async () => {
      try {
        await window.PathwayBackend.saveFlow(flow, workspace);
        const item = document.querySelector('.save-indicator');
        if (item) item.innerHTML = '<span class="status-dot"></span> Saved securely';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { const current = document.querySelector('.save-indicator'); if (current) current.innerHTML = '<span class="status-dot"></span> Saved to workspace'; }, 1800);
      } catch (error) {
        const item = document.querySelector('.save-indicator');
        if (item) item.innerHTML = '<span style="color:#b94841">Save failed</span>';
        showToast(`Could not save this flow: ${error.message || 'check your connection'}`);
      }
    }, 350);
  };
  function showToast(message) {
    toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  }
  function initials(name) { return (name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase(); }
  function nodeSummary(flow) { return `${flow.nodes.length} steps · ${flow.edges.length} connections`; }
  function ago(value) {
    if (!value) return 'Just created';
    const mins = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
    if (mins < 1) return 'Edited just now';
    if (mins < 60) return `Edited ${mins}m ago`;
    const hours = Math.floor(mins / 60); if (hours < 24) return `Edited ${hours}h ago`;
    return `Edited ${Math.floor(hours / 24)}d ago`;
  }
  function setModal(html) {
    const applicantReview = html.includes('applicant-review-layout');
    modalRoot.innerHTML = `<div class="modal-backdrop${applicantReview ? ' applicant-review-backdrop' : ''}" role="presentation"><section class="modal${applicantReview ? ' applicant-review-shell' : ''}" role="dialog" aria-modal="true">${html}</section></div>`;
    modalRoot.querySelector('.modal-backdrop').addEventListener('click', event => { if (event.target === event.currentTarget) closeModal(); });
    modalRoot.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', closeModal));
  }
  function closeModal() { modalRoot.innerHTML = ''; }

  function renderSidebar(active) {
    return `<aside class="app-sidebar" aria-label="Workspace navigation"><div class="sidebar-caption">Workspace</div><button class="sidebar-link ${active === 'dashboard' ? 'active' : ''}" data-route="dashboard"><span class="sidebar-icon" aria-hidden="true">▦</span>Dashboard</button><button class="sidebar-link ${active === 'applicants' ? 'active' : ''}" data-route="applicants"><span class="sidebar-icon" aria-hidden="true">♧</span>Applicants</button><div class="sidebar-bottom">Private workspace<br>Applicant data stays within this account.</div></aside>`;
  }

  function bindSidebar() {
    root.querySelector('[data-route="dashboard"]')?.addEventListener('click', () => renderDashboard());
    root.querySelector('[data-route="applicants"]')?.addEventListener('click', () => { void renderApplicants(); });
  }

  function renderPlanControl() {
    return subscription?.active
      ? '<span class="status-pill" title="Your workspace can publish job flows"><span class="status-dot"></span>Active subscription</span>'
      : '<button class="btn btn-sm btn-lime" id="upgrade-to-publish">Upgrade to publish</button>';
  }

  function bindPlanControl() {
    root.querySelector('#upgrade-to-publish')?.addEventListener('click', openSubscriptionPage);
  }

  function openSubscriptionPage() {
    if (root.querySelector('.editor-main')) {
      subscriptionReturnPage = 'editor';
      subscriptionReturnFlowId = currentId;
    } else if (root.querySelector('.applicants-page')) {
      subscriptionReturnPage = 'applicants';
      subscriptionReturnFlowId = null;
    } else {
      subscriptionReturnPage = 'dashboard';
      subscriptionReturnFlowId = null;
    }
    renderSubscriptionPage();
  }

  function returnFromSubscriptionPage() {
    if (subscriptionReturnPage === 'editor' && flows.some(flow => flow.id === subscriptionReturnFlowId)) {
      openFlow(subscriptionReturnFlowId);
    } else if (subscriptionReturnPage === 'applicants') {
      void renderApplicants();
    } else {
      renderDashboard();
    }
  }

  function renderSubscriptionPage() {
    const stripeConfig = window.PATHWAY_STRIPE_CONFIG || {};
    const configuredKey = typeof stripeConfig.publishableKey === 'string' && /^pk_(test|live)_/.test(stripeConfig.publishableKey) && !stripeConfig.publishableKey.includes('REPLACE_');
    const isTestMode = stripeConfig.publishableKey?.startsWith('pk_test_');
    root.innerHTML = `<main class="subscription-page"><header class="subscription-topbar"><div class="subscription-topbar-left"><button class="subscription-back" id="subscription-back">← <span>Back to workspace</span></button><a class="brand" href="#" id="subscription-brand"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a></div><div class="subscription-identity"><span>${esc(user.email)}</span><button class="btn btn-sm" id="subscription-signout">Sign out</button></div></header><div class="subscription-layout"><section class="subscription-story"><div class="subscription-eyebrow"><span class="subscription-eyebrow-dot"></span>Pathway for hiring teams</div><h1>Make every application feel like the start of a good conversation.</h1><p class="subscription-lead">Create thoughtful job journeys, collect complete applications, and keep every candidate moving through one clear hiring workspace.</p><div class="subscription-benefits"><div class="subscription-benefit"><span>01</span><div><strong>Build better application journeys</strong><p>Use clear, branching flows that fit each role and respect candidates' time.</p></div></div><div class="subscription-benefit"><span>02</span><div><strong>Keep applicants organized</strong><p>Review answers and resumes together, then move candidates through your pipeline.</p></div></div><div class="subscription-benefit"><span>03</span><div><strong>Publish when you're ready</strong><p>Share a dedicated job link and receive applications directly in Pathway.</p></div></div></div><div class="subscription-price-card"><div><span class="subscription-price-label">Pathway subscription</span><div class="subscription-price"><strong>${esc(stripeConfig.priceLabel || 'US$ 24.90')}</strong><span>/ month</span></div></div><span class="subscription-recurring">Recurring billing</span><p>The final amount and billing details are shown by Stripe before you confirm.</p></div>${isTestMode ? '<div class="subscription-test-note"><span>TEST MODE</span> Payments are simulated; no real charge will be made.</div>' : ''}<p class="subscription-trust">Secure payment processing by Stripe. Your card details are handled by Stripe and are not stored by Pathway.</p></section><section class="subscription-checkout-panel" aria-label="Stripe subscription checkout"><div class="checkout-panel-heading"><span class="checkout-panel-kicker">Secure checkout</span><h2>Subscribe to Pathway</h2><p>Enter your payment details below to unlock job publishing.</p></div>${configuredKey ? '<div class="checkout-status" id="checkout-status" aria-live="polite">Connecting securely to Stripe…</div><div class="subscription-checkout-form" id="subscription-checkout-form"></div>' : '<div class="subscription-setup-note">Checkout is not configured yet. Add the Stripe publishable key and server-side Stripe secrets listed in <strong>STRIPE_INTEGRATION_TODO.md</strong> before using this page.</div>'}<div class="subscription-error" id="checkout-error" role="alert" hidden></div><div class="checkout-panel-footer"><span>Encrypted, secure checkout</span><button class="btn btn-primary" id="retry-checkout" hidden>Try again</button></div></section></div></main>`;
    root.querySelector('#subscription-back')?.addEventListener('click', returnFromSubscriptionPage);
    root.querySelector('#subscription-brand')?.addEventListener('click', event => { event.preventDefault(); renderDashboard(); });
    root.querySelector('#subscription-signout')?.addEventListener('click', doSignOut);
    root.querySelector('#retry-checkout')?.addEventListener('click', renderSubscriptionPage);
    if (!configuredKey) return;

    const showError = message => {
      const errorBox = root.querySelector('#checkout-error');
      if (!errorBox) return;
      errorBox.textContent = message;
      errorBox.hidden = false;
      const status = root.querySelector('#checkout-status');
      if (status) status.hidden = true;
      const retryButton = root.querySelector('#retry-checkout');
      if (retryButton) retryButton.hidden = false;
    };

    void (async () => {
      try {
        if (!window.Stripe) throw new Error('Stripe.js did not load. Refresh the page and try again.');
        const clientSecret = await window.PathwayBackend.createCheckoutSession();
        if (!root.querySelector('#subscription-checkout-form')) return;
        const stripe = window.Stripe(stripeConfig.publishableKey, { betas: ['custom_checkout_payment_form_1'] });
        const checkout = stripe.initCheckoutFormSdk({
          clientSecret,
          appearance: {
            theme: 'stripe', labels: 'auto', inputs: 'spaced',
            variables: {
              borderRadius: '4px', colorBackground: '#ffffff', colorDanger: '#df1b41', colorPrimary: '#315f4a',
              colorSuccess: '#00c853', colorText: '#30313d', fontFamily: 'default', fontSizeBase: '16px', spacingUnit: '4px'
            }
          }
        });
        const form = checkout.createForm({ layout: 'expanded' });
        form.mount('#subscription-checkout-form');
        const loadActionsResult = await checkout.loadActions();
        if (loadActionsResult.type !== 'success') {
          throw new Error(loadActionsResult.error?.message || 'The secure checkout form could not be loaded.');
        }
        const status = root.querySelector('#checkout-status');
        if (status) status.hidden = true;
        form.on('confirm', async event => {
          const errorBox = root.querySelector('#checkout-error');
          if (errorBox) errorBox.hidden = true;
          try { await loadActionsResult.actions.confirm({ formConfirmEvent: event }); }
          catch (error) { showError(error.message || 'Payment could not be confirmed. Please try again.'); }
        });
      } catch (error) {
        showError(error.message || 'The subscription checkout could not be started.');
      }
    })();
  }

  function renderDashboard() {
    currentId = null; selectedId = null;
    const count = flows.length;
    const drafts = flows.filter(flow => flow.publicationStatus !== 'published').length;
    const published = count - drafts;
    const nodes = flows.reduce((sum, flow) => sum + flow.nodes.length, 0);
    root.innerHTML = `<div class="app-shell"><header class="topbar"><a class="brand" href="#"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="top-actions">${renderPlanControl()}<span class="workspace-name" title="${esc(workspace.name)}">${esc(workspace.name)}</span><span class="auth-user" title="${esc(user.email)}">${esc(user.email)}</span><button class="btn btn-sm" id="signout">Sign out</button></div></header><div class="workspace-body">${renderSidebar('dashboard')}<main class="dashboard"><div class="dash-greeting"><div><div class="eyebrow">Your workspace</div><h1>Make applying feel human.</h1><p>Design clear, considered journeys for the people behind every application.</p></div><div class="dash-action"><button class="btn" id="workspace-details">Workspace details</button><button class="btn btn-primary" id="new-flow">＋ &nbsp;New flow</button></div></div><section class="dash-stats"><div class="stat"><span class="stat-icon">${ICONS.flows}</span><div><strong>${count}</strong><span>Application ${count === 1 ? 'flow' : 'flows'}</span></div></div><div class="stat"><span class="stat-icon">${ICONS.node}</span><div><strong>${nodes}</strong><span>Steps in your journeys</span></div></div><div class="stat"><span class="stat-icon">⌁</span><div><strong>Cloud</strong><span>Saved to Supabase</span></div></div></section><div class="section-heading"><h2>Application flows</h2><span class="muted" style="font-size:12px">${drafts} draft${drafts === 1 ? '' : 's'} · ${published} published</span></div>${flows.length ? `<section class="flow-grid">${flows.map(flow => `<article class="flow-card" data-flow="${esc(flow.id)}" tabindex="0" role="button" aria-label="Edit ${esc(flow.jobTitle)}"><div class="flow-card-preview"><span class="flow-preview-label">A glimpse of your flow</span><span class="mini-node" style="left:9%;top:56px;width:93px"><i></i><b></b></span><span class="mini-wire" style="left:28%;top:73px;width:17%;transform:rotate(0deg)"></span><span class="mini-node" style="left:45%;top:43px;width:102px"><i style="width:49px"></i><b></b></span><span class="mini-wire" style="left:67%;top:58px;width:12%;transform:rotate(-25deg)"></span><span class="mini-node" style="left:78%;top:27px;width:77px"><i style="width:35px"></i><b style="width:49px"></b></span><span class="mini-wire" style="left:67%;top:67px;width:12%;transform:rotate(25deg)"></span><span class="mini-node" style="left:78%;top:77px;width:77px"><i style="width:35px"></i><b style="width:49px"></b></span></div><div class="flow-card-body"><div class="flow-card-top"><span class="${flow.publicationStatus === 'published' ? 'published-tag' : 'draft-tag'}"><span class="status-dot"></span>${flow.publicationStatus === 'published' ? 'Published' : 'Draft'}</span><button class="icon-btn flow-menu" data-menu="${esc(flow.id)}" aria-label="Flow actions">···</button></div><h3>${esc(flow.jobTitle || 'Untitled role')}</h3><div class="flow-company">${esc(flow.companyName || 'Your company')}</div><div class="flow-card-foot"><span class="flow-count">${ICONS.node}${nodeSummary(flow)}</span><span>${ago(flow.updatedAt)}</span></div></div></article>`).join('')}</section>` : `<section class="empty-state"><span class="brand-mark">↗</span><h3>Your next great flow starts here.</h3><p>Create a role page and shape a thoughtful path for applicants.</p><button class="btn btn-primary" id="empty-new-flow">＋ &nbsp;Create your first flow</button></section>`}</main></div></div>`;
    bindSidebar();
    bindPlanControl();
    root.querySelector('#empty-new-flow')?.addEventListener('click', showNewFlow);
    root.querySelector('#new-flow').addEventListener('click', showNewFlow);
    root.querySelector('#workspace-details').addEventListener('click', showWorkspaceDetails);
    root.querySelector('#signout').addEventListener('click', doSignOut);
    root.querySelectorAll('.flow-card').forEach(card => {
      card.addEventListener('click', event => { if (!event.target.closest('.flow-menu')) openFlow(card.dataset.flow); });
      card.addEventListener('keydown', event => { if (event.key === 'Enter') openFlow(card.dataset.flow); });
    });
    root.querySelectorAll('.flow-menu').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); showFlowMenu(button.dataset.menu); }));
  }

  async function renderApplicants() {
    currentId = null; selectedId = null;
    root.innerHTML = `<div class="app-shell"><header class="topbar"><a class="brand" href="#"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="top-actions">${renderPlanControl()}<span class="workspace-name" title="${esc(workspace.name)}">${esc(workspace.name)}</span><span class="auth-user" title="${esc(user.email)}">${esc(user.email)}</span><button class="btn btn-sm" id="signout">Sign out</button></div></header><div class="workspace-body">${renderSidebar('applicants')}<main class="applicants-page"><div class="applicants-heading"><div><div class="eyebrow">Hiring workspace</div><h1>Applicants</h1><p>Review applications and move candidates through your hiring stages.</p></div><div class="applicants-tools"><select id="applicant-flow-filter" class="applicants-filter" aria-label="Filter applicants by job"><option value="">All jobs</option>${flows.filter(flow => flow.cloudId).map(flow => `<option value="${esc(flow.cloudId)}" ${applicantFilter === flow.cloudId ? 'selected' : ''}>${esc(flow.jobTitle || 'Untitled role')}</option>`).join('')}</select><input id="applicant-search" class="applicants-search" type="search" placeholder="Search applicants" value="${esc(applicantSearch)}" aria-label="Search applicants"><button class="btn btn-sm" id="refresh-applicants" title="Refresh applicants">↻ Refresh</button></div></div><div id="applicants-content"><div class="loading-card"><span class="brand-mark">↗</span><span>Loading applicants…</span></div></div></main></div></div>`;
    bindSidebar();
    bindPlanControl();
    root.querySelector('#signout').addEventListener('click', doSignOut);
    root.querySelector('#applicant-flow-filter').addEventListener('change', event => { applicantFilter = event.target.value; void renderApplicants(); });
    root.querySelector('#applicant-search').addEventListener('input', event => {
      applicantSearch = event.target.value;
      renderApplicantBoard();
    });
    root.querySelector('#refresh-applicants').addEventListener('click', () => { void renderApplicants(); });
    try {
      applicants = await window.PathwayBackend.listApplicants(workspace.id, applicantFilter);
      renderApplicantBoard();
    } catch (error) {
      const content = root.querySelector('#applicants-content');
      if (content) content.innerHTML = `<div class="auth-error show" role="alert">${esc(`Could not load applicants: ${error.message || 'check your connection and try again'}`)}</div>`;
    }
  }

  function renderApplicantBoard() {
    const content = root.querySelector('#applicants-content');
    if (!content) return;
    const term = applicantSearch.trim().toLowerCase();
    const visible = applicants.filter(applicant => {
      const flow = flows.find(item => item.cloudId === applicant.flow_id);
      return !term || `${applicant.candidate_name} ${applicant.candidate_email} ${flow?.jobTitle || ''} ${flow?.companyName || ''}`.toLowerCase().includes(term);
    });
    const filterName = applicantFilter ? flows.find(flow => flow.cloudId === applicantFilter)?.jobTitle : '';
    if (!applicants.length && !applicantFilter && !term) {
      const published = flows.filter(flow => flow.publicationStatus === 'published' && flow.activePublishedFlowId);
      content.innerHTML = `<section class="applicants-empty"><span class="brand-mark">♧</span><h2>No applicants yet</h2><p>Applications for published jobs will appear here as candidates submit them. Review a test application before sharing your job links widely.</p>${published.length ? `<button class="btn btn-primary" id="open-published-flow">View published jobs</button>` : `<button class="btn btn-primary" id="open-flows">Go to dashboard</button>`}</section>`;
      content.querySelector('#open-published-flow')?.addEventListener('click', renderDashboard);
      content.querySelector('#open-flows')?.addEventListener('click', renderDashboard);
      return;
    }
    content.innerHTML = `<div class="kanban-summary"><strong>${visible.length}</strong> ${visible.length === 1 ? 'applicant' : 'applicants'}${filterName ? ` for <strong>${esc(filterName)}</strong>` : ' across all jobs'}${applicants.length >= 1000 ? ' · Showing the latest 1,000; filter by job to narrow the list.' : ''}</div><section class="kanban-board" aria-label="Applicant pipeline">${applicantStages.map(stage => {
      const cards = visible.filter(applicant => applicant.status === stage.key);
      return `<section class="kanban-column" data-stage="${stage.key}" aria-label="${stage.label}"><div class="kanban-column-head"><div class="kanban-column-title"><span class="stage-dot ${stage.color}"></span>${stage.label}</div><span class="kanban-count">${cards.length}</span></div><div class="applicant-list">${cards.length ? cards.map(applicant => `<article class="applicant-card" data-applicant="${esc(applicant.id)}" draggable="true" tabindex="0" role="button" aria-label="Review ${esc(applicant.candidate_name)}"><h3 class="applicant-card-name">${esc(applicant.candidate_name)}</h3><div class="applicant-card-email">${esc(applicant.candidate_email)}</div><div class="applicant-card-meta"><span class="resume-chip">↧ ${esc((applicant.resume_filename || 'Resume').split('.').pop().toUpperCase())}</span><span>${esc(formatApplicantDate(applicant.submitted_at))}</span></div></article>`).join('') : '<div class="board-empty">No applicants here</div>'}</div></section>`;
    }).join('')}</section>`;
    content.querySelectorAll('.applicant-card').forEach(card => {
      card.addEventListener('click', () => showApplicantDetails(card.dataset.applicant));
      card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showApplicantDetails(card.dataset.applicant); } });
      card.addEventListener('dragstart', event => {
        card.classList.add('dragging');
        event.dataTransfer.setData('text/plain', card.dataset.applicant);
        event.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });
    content.querySelectorAll('.kanban-column').forEach(column => {
      column.addEventListener('dragover', event => { event.preventDefault(); column.classList.add('drag-over'); event.dataTransfer.dropEffect = 'move'; });
      column.addEventListener('dragleave', event => { if (!column.contains(event.relatedTarget)) column.classList.remove('drag-over'); });
      column.addEventListener('drop', event => {
        event.preventDefault(); column.classList.remove('drag-over');
        const applicantId = event.dataTransfer.getData('text/plain');
        if (applicantId) void moveApplicant(applicantId, column.dataset.stage);
      });
    });
  }

  function formatApplicantDate(value) {
    if (!value) return 'Just now';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Just now' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  }

  async function moveApplicant(id, status) {
    const applicant = applicants.find(item => item.id === id);
    if (!applicant || applicant.status === status || !applicantStages.some(stage => stage.key === status)) return;
    const oldStatus = applicant.status;
    applicant.status = status;
    renderApplicantBoard();
    try {
      const updated = await window.PathwayBackend.updateApplicantStatus(id, status);
      applicant.status = updated.status;
      applicant.updated_at = updated.updated_at;
      renderApplicantBoard();
      if (modalRoot.querySelector(`[data-detail-applicant="${id}"]`)) showApplicantDetails(id);
      showToast(`Applicant moved to ${applicantStages.find(stage => stage.key === status).label}.`);
    } catch (error) {
      applicant.status = oldStatus;
      renderApplicantBoard();
      showToast(`Could not update applicant stage: ${error.message || 'please retry'}`);
    }
  }

  function showApplicantDetails(id) {
    const applicant = applicants.find(item => item.id === id);
    if (!applicant) return;
    const flow = flows.find(item => item.cloudId === applicant.flow_id);
    const detailFields = Object.entries(applicant.candidate_info || {}).filter(([, value]) => value !== null && value !== '' && value !== undefined);
    const answers = Array.isArray(applicant.responses) ? applicant.responses : [];
    const isPdf = applicant.resume_content_type === 'application/pdf';
    const filename = applicant.resume_filename || 'resume';
    const statusOptions = applicantStages.map(stage => `<option value="${stage.key}" ${applicant.status === stage.key ? 'selected' : ''}>${stage.label}</option>`).join('');

    setModal(`<div class="applicant-review-layout" data-detail-applicant="${esc(applicant.id)}">
      <section class="applicant-review-left" aria-label="Applicant details">
        <header class="modal-head applicant-detail-head">
          <div class="applicant-detail-title"><div class="applicant-avatar" aria-hidden="true">${esc(initials(applicant.candidate_name))}</div><div><div class="eyebrow" style="margin-bottom:5px">${esc(flow?.jobTitle || 'Application')}</div><h2>${esc(applicant.candidate_name)}</h2><div class="muted">${esc(applicant.candidate_email)}</div></div></div>
          <button class="modal-x" data-close aria-label="Close applicant details">×</button>
        </header>
        <div class="applicant-review-content">
          <section class="applicant-detail-section applicant-detail-actions-section"><div class="applicant-detail-actions">
            <label class="applicant-info-item"><span>Hiring stage</span><select class="applicant-status-select" id="applicant-status-select">${statusOptions}</select></label>
            <div class="applicant-resume-actions">${isPdf ? '<button class="btn applicant-resume-button" id="preview-applicant-resume" aria-expanded="false">▧ &nbsp;Preview resume</button>' : ''}<button class="btn applicant-resume-button" id="download-applicant-resume">↓ &nbsp;Download resume</button></div>
          </div></section>
          <section class="applicant-detail-section"><h3>Candidate details</h3><div class="applicant-info-grid"><div class="applicant-info-item"><span>Full name</span><strong>${esc(applicant.candidate_name)}</strong></div><div class="applicant-info-item"><span>Email address</span><a href="mailto:${esc(applicant.candidate_email)}">${esc(applicant.candidate_email)}</a></div>${detailFields.map(([key, value]) => `<div class="applicant-info-item"><span>${esc(C.OPTIONAL_FIELDS.find(field => field.key === key)?.label || key)}</span><strong>${esc(value)}</strong></div>`).join('')}</div></section>
          <section class="applicant-detail-section"><h3>Application answers · ${answers.length}</h3>${answers.length ? answers.map((answer, index) => `<div class="applicant-answer"><strong>${index + 1}. ${esc(answer.question || 'Application question')}</strong><p>${esc(Array.isArray(answer.answer) ? answer.answer.join(', ') : answer.answer)}</p></div>`).join('') : '<div class="board-empty">No written answers were submitted for this flow.</div>'}</section>
          <section class="applicant-detail-section"><h3>Application record</h3><div class="applicant-info-grid"><div class="applicant-info-item"><span>Submitted</span><strong>${esc(new Date(applicant.submitted_at).toLocaleString())}</strong></div><div class="applicant-info-item"><span>Privacy notice</span><strong>${esc(applicant.privacy_notice_version || 'Recorded')}</strong></div></div><p class="applicant-privacy-note">This applicant record is visible only to this workspace. Resume links are private and expire after two minutes.</p></section>
        </div>
      </section>
      <aside class="applicant-review-right" aria-label="Resume preview">
        <div class="applicant-preview-empty" id="applicant-preview-empty"><span class="applicant-preview-icon">▧</span><h3>${isPdf ? 'Resume preview' : 'Preview unavailable'}</h3><p>${isPdf ? 'Loading the private PDF preview beside the application details…' : 'This file type cannot be previewed in the browser. Download the resume to open it.'}</p></div>
        <section class="applicant-resume-preview is-hidden" id="applicant-resume-preview" aria-label="PDF resume preview">
          <div class="applicant-resume-preview-head"><div><span class="eyebrow">Private document</span><strong title="${esc(filename)}">${esc(filename)}</strong></div><button class="btn btn-sm" id="close-applicant-resume-preview">Close preview</button></div>
          <iframe id="applicant-resume-frame" title="PDF preview of ${esc(filename)}" loading="lazy" referrerpolicy="no-referrer"></iframe>
        </section>
      </aside>
    </div>`);

    modalRoot.querySelector('#applicant-status-select').addEventListener('change', event => { void moveApplicant(applicant.id, event.target.value); });
    const previewButton = modalRoot.querySelector('#preview-applicant-resume');
    const previewPanel = modalRoot.querySelector('#applicant-resume-preview');
    const previewFrame = modalRoot.querySelector('#applicant-resume-frame');
    const previewPlaceholder = modalRoot.querySelector('#applicant-preview-empty');
    const closePreview = () => {
      previewPanel.classList.add('is-hidden');
      previewPlaceholder.classList.remove('is-hidden');
      previewButton?.setAttribute('aria-expanded', 'false');
      previewFrame.removeAttribute('src');
      if (previewButton) previewButton.innerHTML = '▧ &nbsp;Preview resume';
    };
    const loadPreview = async () => {
      if (!previewButton || !previewPanel.classList.contains('is-hidden')) return;
      previewButton.disabled = true; previewButton.textContent = 'Preparing preview…';
      try {
        const url = await window.PathwayBackend.getApplicantResumeUrl(applicant.resume_path);
        previewFrame.src = url;
        previewPlaceholder.classList.add('is-hidden');
        previewPanel.classList.remove('is-hidden');
        previewButton.setAttribute('aria-expanded', 'true');
      } catch (error) { showToast(`Could not preview resume: ${error.message || 'please retry'}`); }
      finally { if (previewButton.isConnected) { previewButton.disabled = false; previewButton.innerHTML = previewPanel.classList.contains('is-hidden') ? '▧ &nbsp;Preview resume' : '▧ &nbsp;Hide preview'; } }
    };
    previewButton?.addEventListener('click', () => {
      if (!previewPanel.classList.contains('is-hidden')) closePreview();
      else void loadPreview();
    });
    if (previewButton) void loadPreview();
    modalRoot.querySelector('#close-applicant-resume-preview')?.addEventListener('click', closePreview);
    modalRoot.querySelector('#download-applicant-resume').addEventListener('click', async event => {
      const button = event.currentTarget;
      const tab = window.open('about:blank', '_blank');
      if (tab) tab.opener = null;
      button.disabled = true; button.textContent = 'Preparing download…';
      try {
        const url = await window.PathwayBackend.getApplicantResumeUrl(applicant.resume_path, true, filename);
        if (tab) tab.location.replace(url);
        else { await navigator.clipboard.writeText(url); showToast('Secure download link copied. It expires in two minutes.'); }
      } catch (error) {
        if (tab) tab.close();
        showToast(`Could not download resume: ${error.message || 'please retry'}`);
      } finally { if (button.isConnected) { button.disabled = false; button.innerHTML = '↓ &nbsp;Download resume'; } }
    });
  }
  function showWorkspaceDetails() {
    setModal(`<div class="modal-head"><div><div class="eyebrow" style="margin-bottom:8px">Private workspace</div><h2>${esc(workspace.name)}</h2><p>Signed in as ${esc(user.email)}.</p></div><button class="modal-x" data-close aria-label="Close">×</button></div><div class="prototype-note" style="margin:0">This first release gives each account one private workspace. Your job flows are saved in Supabase and isolated with row-level security. Inviting teammates is not available yet. Candidate applications are visible in the Applicants board and remain private to this workspace.</div><div class="modal-actions"><button class="btn btn-primary" data-close>Got it</button></div>`);
  }
  async function doSignOut() {
    try { await window.PathwayBackend.signOut(); flows = []; applicants = []; workspace = null; user = null; window.PathwayAuth.renderAuth(); }
    catch (error) { showToast(`Could not sign out: ${error.message || 'please retry'}`); }
  }

  function showNewFlow() {
    setModal(`<div class="modal-head"><div><div class="eyebrow" style="margin-bottom:8px">Start with the role</div><h2>Create a new application flow</h2><p>Give candidates a clear picture of the opportunity before they apply.</p></div><button class="modal-x" data-close aria-label="Close">×</button></div><form id="new-flow-form"><div class="field-group"><label for="new-company">Company name</label><input class="text-input" id="new-company" name="companyName" placeholder="e.g. Northstar Studio" required></div><div class="field-group"><label for="new-title">Job title</label><input class="text-input" id="new-title" name="jobTitle" placeholder="e.g. Senior Product Designer" required></div><div class="field-group"><label for="new-description">Job description</label><textarea class="text-area" id="new-description" name="jobDescription" placeholder="A short, welcoming overview of the role and the team…" required></textarea></div><div class="modal-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Create flow</button></div></form>`);
    modalRoot.querySelector('#new-flow-form').addEventListener('submit', event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      const flow = C.createFlow(data.get('companyName').trim(), data.get('jobTitle').trim(), data.get('jobDescription').trim());
      flows.unshift(flow); closeModal(); openFlow(flow.id); save();
    });
  }
  function showFlowMenu(id) {
    const flow = flows.find(item => item.id === id); if (!flow) return;
    const isPublished = flow.publicationStatus === 'published' && Boolean(flow.activePublishedFlowId);
    setModal(`<div class="modal-head"><div><div class="eyebrow" style="margin-bottom:8px">${isPublished ? 'Published flow' : 'Draft flow'}</div><h2>${esc(flow.jobTitle)}</h2><p>${esc(flow.companyName)}</p></div><button class="modal-x" data-close aria-label="Close">×</button></div><div class="danger-confirm"><strong>Permanent deletion.</strong> Removing this job also deletes every application and private resume submitted to it. This cannot be undone.</div><div class="modal-actions" style="justify-content:space-between;gap:10px;flex-wrap:wrap"><button class="btn btn-danger" id="delete-flow">Delete flow</button><div style="display:flex;gap:8px;flex-wrap:wrap">${isPublished ? '<button class="btn" id="copy-flow-url">Copy job link</button>' : ''}<button class="btn ${isPublished || !subscription?.active ? '' : 'btn-primary'}" id="toggle-flow-status">${isPublished ? 'Unpublish' : subscription?.active ? 'Publish' : 'Upgrade to publish'}</button></div></div>`);
    modalRoot.querySelector('#copy-flow-url')?.addEventListener('click', () => copyFlowUrl(flow, true));
    modalRoot.querySelector('#toggle-flow-status').addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true; button.textContent = isPublished ? 'Unpublishing…' : 'Opening editor…';
      if (!isPublished) {
        if (!subscription?.active) { closeModal(); openSubscriptionPage(); return; }
        closeModal(); openFlow(id); await publishFlow(); return;
      }
      try {
        await window.PathwayBackend.unpublishFlow(flow, workspace);
        flow.updatedAt = new Date().toISOString();
        closeModal(); renderDashboard(); showToast('Flow returned to draft. Existing public links are now inactive.');
      } catch (error) {
        button.disabled = false; button.textContent = 'Unpublish';
        showToast(error.message || 'This flow could not be unpublished.');
      }
    });
    modalRoot.querySelector('#delete-flow').addEventListener('click', async () => {
      const button = modalRoot.querySelector('#delete-flow'); button.disabled = true; button.textContent = 'Deleting…';
      try {
        const result = await window.PathwayBackend.deleteFlow(flow, workspace);
        flows = flows.filter(item => item.id !== id);
        applicants = applicants.filter(item => item.flow_id !== flow.cloudId);
        closeModal(); renderDashboard();
        showToast(result && result.resumesRemoved === false ? 'Flow and applications deleted. Some resume files may need cleanup.' : 'Flow, applications, and resumes deleted.');
      } catch (error) { button.disabled = false; button.textContent = 'Delete flow'; showToast(`Could not delete this flow: ${error.message || 'try again'}`); }
    });
  }

  function openFlow(id) {
    currentId = id; selectedId = currentFlow().nodes.find(node => node.type === 'candidateInfo').id; renderEditor();
  }

  function renderEditor() {
    const flow = currentFlow(); if (!flow) return renderDashboard();
    root.innerHTML = `<div class="app-shell"><header class="topbar"><a class="brand" href="#" id="brand-home"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="top-actions">${renderPlanControl()}<span class="workspace-name">${esc(workspace.name)}</span><span class="auth-user">${esc(user.email)}</span><button class="btn btn-sm" id="signout">Sign out</button></div></header><div class="workspace-body">${renderSidebar('dashboard')}<main class="editor-main"><div class="editor-top"><div class="crumbs"><button class="crumb-link" id="dashboard-back">My flows</button><span class="crumb-chevron">/</span><span class="crumb-title">${esc(flow.jobTitle)}</span></div><div class="editor-actions"><span class="save-indicator"><span class="status-dot"></span>${flow.cloudId ? 'Saved to workspace' : 'Not saved yet'}</span><button class="btn" id="preview-btn">▷ &nbsp;Preview as candidate</button>${flow.publicationStatus === 'published' && flow.activePublishedFlowId ? '<button class="btn" id="copy-job-url">Copy job link</button>' : ''}<button class="btn ${flow.publicationStatus === 'published' || !subscription?.active ? '' : 'btn-primary'}" id="publish-btn">${flow.publicationStatus === 'published' ? 'Unpublish' : subscription?.active ? 'Publish' : 'Upgrade to publish'} &nbsp;${flow.publicationStatus === 'published' ? '↘' : '↗'}</button></div></div><div class="editor-layout"><section class="workspace" id="workspace"><div class="canvas-toolbar"><div class="canvas-label">Application journey <span class="canvas-hint"> · Drag background to pan, nodes to arrange, ports to connect</span></div><span></span></div><div class="canvas-stage" id="canvas-stage"><svg class="wires" id="wires" aria-label="Flow connections"></svg><div id="nodes-layer"></div></div></section><aside class="inspector" id="inspector"></aside></div><button class="btn btn-primary canvas-add" id="add-node">＋ &nbsp;Add a step</button><div class="canvas-status" id="canvas-status">Drag empty background to move around · Drag a connection point to another step</div></main></div></div>`;
    bindSidebar();
    bindPlanControl();
    root.querySelector('#brand-home').addEventListener('click', event => { event.preventDefault(); renderDashboard(); });
    root.querySelector('#signout').addEventListener('click', doSignOut);
    root.querySelector('#dashboard-back').addEventListener('click', renderDashboard);
    root.querySelector('#preview-btn').addEventListener('click', openPreview);
    root.querySelector('#copy-job-url')?.addEventListener('click', copyJobUrl);
    root.querySelector('#publish-btn').addEventListener('click', () => currentFlow()?.publicationStatus === 'published' ? unpublishFlow() : subscription?.active ? publishFlow() : openSubscriptionPage());
    root.querySelector('#add-node').addEventListener('click', showNodePicker);
    const workspaceElement = document.getElementById('workspace');
    bindCanvasPan(workspaceElement);
    drawCanvas(); drawInspector();
  }

  function bindCanvasPan(workspace) {
    if (!workspace) return;
    let pan = null;
    const beginPan = event => {
      if (event.button !== 0 || event.target.closest('.node, .port, .target-port, .edge-path, .canvas-toolbar, button, input, textarea, select')) return;
      event.preventDefault();
      pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: workspace.scrollLeft, top: workspace.scrollTop };
      workspace.classList.add('is-panning');
      workspace.setPointerCapture(event.pointerId);
    };
    const movePan = event => {
      if (!pan || event.pointerId !== pan.pointerId) return;
      workspace.scrollLeft = pan.left - (event.clientX - pan.x);
      workspace.scrollTop = pan.top - (event.clientY - pan.y);
    };
    const endPan = event => {
      if (!pan || (event.pointerId != null && event.pointerId !== pan.pointerId)) return;
      const pointerId = pan.pointerId;
      pan = null;
      workspace.classList.remove('is-panning');
      if (workspace.hasPointerCapture(pointerId)) workspace.releasePointerCapture(pointerId);
    };
    workspace.addEventListener('pointerdown', beginPan);
    workspace.addEventListener('pointermove', movePan);
    workspace.addEventListener('pointerup', endPan);
    workspace.addEventListener('pointercancel', endPan);
    workspace.addEventListener('lostpointercapture', endPan);
  }

  function typeInfo(node) {
    return ({ candidateInfo: ['Candidate details', 'C'], shortText: ['Short answer', 'T'], singleChoice: ['Choose one', '◉'], multiChoice: ['Choose many', '☷'], end: ['End of journey', '✓'] })[node.type] || ['Step', '•'];
  }
  function outgoingPorts(node) {
    if (node.type === 'end') return [];
    if (node.type === 'singleChoice') return (node.options || []).map(option => ({ optionValue: option, label: option }));
    return [{ optionValue: null, label: '' }];
  }
  function drawCanvas() {
    const flow = currentFlow(); if (!flow) return;
    const layer = document.getElementById('nodes-layer'); if (!layer) return;
    layer.innerHTML = flow.nodes.map(node => {
      const [title, icon] = typeInfo(node); const selected = selectedId === node.id;
      const nodeClass = `node ${esc(node.type)}${node.type === 'end' ? ' end-node' : ''}${node.type === 'candidateInfo' ? ' fixed' : ''}${selected ? ' selected' : ''}`;
      let detail = '';
      if (node.type === 'candidateInfo') {
        const enabled = C.OPTIONAL_FIELDS.filter(field => flow.candidateInfoFields[field.key]).length;
        detail = `<div class="node-detail">Name · Email · Resume${enabled ? ` · +${enabled} more` : ''}</div>`;
      } else if (node.type === 'singleChoice' || node.type === 'multiChoice') {
        const ports = outgoingPorts(node); detail = `<div class="node-rows">${ports.map(port => {
          const edge = flow.edges.find(item => item.fromNodeId === node.id && item.optionValue === port.optionValue);
          const target = edge && flow.nodes.find(item => item.id === edge.toNodeId);
          return `<div class="node-option">${esc(port.label || 'Option')}<span class="node-detail" style="margin-left:auto;margin-right:5px;font-size:8px">${target ? esc(target.label.slice(0, 16)) : 'Connect'}</span><span class="port" data-from="${esc(node.id)}" data-option="${esc(port.optionValue)}" title="Drag to branch: ${esc(port.label)}"></span></div>`;
        }).join('')}</div>`;
      } else if (node.type === 'end') {
        detail = `<div class="node-detail">${node.subtype === 'disqualified' ? 'Polite disqualification' : 'Application confirmation'}</div>`;
      } else {
        const edge = flow.edges.find(item => item.fromNodeId === node.id); const target = edge && flow.nodes.find(item => item.id === edge.toNodeId);
        detail = `<div class="node-detail">${node.type === 'shortText' ? 'Open-ended response' : `${(node.options || []).length} choices`}${target ? ` · → ${esc(target.label.slice(0, 19))}` : ' · Not connected'}</div>`;
      }
      return `<article class="${nodeClass}" data-node="${esc(node.id)}" style="left:${Math.max(24, node.x)}px;top:${Math.max(24, node.y)}px"><span class="target-port" data-target="${esc(node.id)}" title="Drop a connection here"></span><header class="node-head" data-drag-handle="${esc(node.id)}"><span class="type-icon">${icon}</span><span class="node-type">${title}</span>${node.type === 'candidateInfo' ? '<span class="node-badge">Fixed</span>' : node.type !== 'end' ? `<button class="node-remove" data-delete="${esc(node.id)}" aria-label="Delete step">×</button>` : '<span class="node-badge">Finish</span>'}</header><div class="node-body"><div class="node-title">${esc(node.label)}</div>${detail}${node.type !== 'singleChoice' && node.type !== 'multiChoice' && node.type !== 'end' ? `<div class="node-ports"><span class="port" data-from="${esc(node.id)}" data-option="" title="Drag to connect"></span></div>` : ''}</div></article>`;
    }).join('');
    layer.querySelectorAll('.node').forEach(element => {
      element.addEventListener('click', event => {
        if (event.target.closest('.port') || event.target.closest('.node-remove') || dragState) return;
        selectedId = element.dataset.node; drawCanvas(); drawInspector();
      });
      const head = element.querySelector('.node-head');
      if (!element.classList.contains('fixed')) head.addEventListener('pointerdown', event => startDrag(event, element));
    });
    layer.querySelectorAll('.node-remove').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); deleteNode(button.dataset.delete); }));
    layer.querySelectorAll('.port').forEach(port => {
      port.addEventListener('pointerdown', event => startConnect(event, port));
    });
    layer.querySelectorAll('.target-port').forEach(port => port.addEventListener('pointerup', event => finishConnect(event, port.dataset.target)));
    drawWires();
  }

  function drawWires() {
    const flow = currentFlow(); const stage = document.getElementById('canvas-stage'); const svg = document.getElementById('wires'); if (!flow || !stage || !svg) return;
    svg.setAttribute('width', stage.offsetWidth); svg.setAttribute('height', stage.offsetHeight); svg.innerHTML = '';
    flow.edges.forEach(edge => {
      const source = stage.querySelector(`.port[data-from="${CSS.escape(edge.fromNodeId)}"][data-option="${CSS.escape(edge.optionValue || '')}"]`);
      const target = stage.querySelector(`.target-port[data-target="${CSS.escape(edge.toNodeId)}"]`);
      if (!source || !target) return;
      const a = center(source, stage); const b = center(target, stage);
      const bend = Math.max(42, (b.x - a.x) * .46); const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${a.x} ${a.y} C ${a.x + bend} ${a.y}, ${b.x - bend} ${b.y}, ${b.x} ${b.y}`); path.setAttribute('class', 'edge-path'); path.setAttribute('data-edge', edge.id); path.setAttribute('aria-label', `${edge.optionValue ? `${edge.optionValue}: ` : ''}connection`);
      path.addEventListener('click', () => { if (flow.nodes.find(node => node.id === edge.fromNodeId)?.type === 'candidateInfo') { showToast('The candidate-details step must always connect to the journey.'); return; } flow.edges = flow.edges.filter(item => item.id !== edge.id); save(); drawCanvas(); drawInspector(); showToast('Connection removed.'); }); svg.appendChild(path);
    });
    if (connectFrom && window.pendingPointer) {
      const source = stage.querySelector(`.port[data-from="${CSS.escape(connectFrom.id)}"][data-option="${CSS.escape(connectFrom.optionValue || '')}"]`);
      if (source) { const a = center(source, stage); const b = { x: window.pendingPointer.x - stage.getBoundingClientRect().left + document.getElementById('workspace').scrollLeft, y: window.pendingPointer.y - stage.getBoundingClientRect().top + document.getElementById('workspace').scrollTop }; const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', `M ${a.x} ${a.y} C ${a.x + 70} ${a.y}, ${b.x - 70} ${b.y}, ${b.x} ${b.y}`); path.setAttribute('class', 'edge-path edge-dash'); svg.appendChild(path); }
    }
  }
  function center(element, relativeTo) { const a = element.getBoundingClientRect(), b = relativeTo.getBoundingClientRect(); return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2 }; }
  function setStatus(text) { const status = document.getElementById('canvas-status'); if (status) status.textContent = text; }

  function startDrag(event, element) {
    if (event.button !== 0 || event.target.closest('button')) return;
    const flow = currentFlow(), node = flow.nodes.find(item => item.id === element.dataset.node); if (!node) return;
    event.preventDefault(); dragState = { type: 'move', node, element, x: event.clientX, y: event.clientY, left: node.x, top: node.y, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.addEventListener('pointermove', moveDrag); element.addEventListener('pointerup', endDrag, { once: true });
  }
  function moveDrag(event) {
    if (!dragState || dragState.type !== 'move') return;
    const dx = event.clientX - dragState.x, dy = event.clientY - dragState.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragState.moved = true;
    dragState.node.x = Math.max(24, dragState.left + dx); dragState.node.y = Math.max(24, dragState.top + dy);
    dragState.element.style.left = `${dragState.node.x}px`; dragState.element.style.top = `${dragState.node.y}px`; drawWires();
  }
  function endDrag() {
    if (!dragState || dragState.type !== 'move') return;
    const moved = dragState.moved; dragState = null;
    if (moved) { save(); drawWires(); }
  }
  function startConnect(event, port) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); connectFrom = { id: port.dataset.from, optionValue: port.dataset.option || null };
    port.setPointerCapture(event.pointerId); port.classList.add('connecting'); window.pendingPointer = { x: event.clientX, y: event.clientY }; drawWires();
    port.addEventListener('pointermove', moveConnect); port.addEventListener('pointerup', event => {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.node')?.dataset.node;
      if (target) finishConnect(event, target);
      else { connectFrom = null; window.pendingPointer = null; drawCanvas(); setStatus('Connection cancelled. Drag a port to a destination step.'); }
    }, { once: true });
  }
  function moveConnect(event) { if (!connectFrom) return; window.pendingPointer = { x: event.clientX, y: event.clientY }; drawWires(); }
  function finishConnect(event, targetId) {
    if (!connectFrom || !targetId) return;
    event.stopPropagation(); const flow = currentFlow(); const source = flow.nodes.find(node => node.id === connectFrom.id); const target = flow.nodes.find(node => node.id === targetId);
    if (!source || !target || source.id === target.id || target.type === 'candidateInfo') { connectFrom = null; window.pendingPointer = null; drawCanvas(); showToast('Choose a different destination.'); return; }
    const optionValue = source.type === 'singleChoice' ? connectFrom.optionValue : null;
    flow.edges = flow.edges.filter(edge => !(edge.fromNodeId === source.id && (source.type !== 'singleChoice' || edge.optionValue === optionValue)));
    flow.edges.push({ id: C.uid('edge'), fromNodeId: source.id, toNodeId: target.id, ...(source.type === 'singleChoice' ? { optionValue } : {}) });
    connectFrom = null; window.pendingPointer = null; save(); selectedId = source.id; drawCanvas(); drawInspector(); setStatus('Connected · click any line to remove it');
  }

  function drawInspector() {
    const flow = currentFlow(), panel = document.getElementById('inspector'); if (!flow || !panel) return;
    const selected = flow.nodes.find(node => node.id === selectedId) || flow.nodes[0];
    const [title] = typeInfo(selected);
    panel.innerHTML = `<div class="inspector-title"><div><div class="inspector-kicker">Flow settings</div><h2>Job details</h2></div><button class="icon-btn" id="edit-role" aria-label="Edit role details">✎</button></div><div class="field-group"><label for="role-company">Company</label><input class="text-input" id="role-company" value="${esc(flow.companyName)}"></div><div class="field-group"><label for="role-title">Job title</label><input class="text-input" id="role-title" value="${esc(flow.jobTitle)}"></div><div class="field-group"><label for="role-description">Job description</label><textarea class="text-area" id="role-description">${esc(flow.jobDescription)}</textarea></div><hr class="inspector-divider"><div class="inspector-title"><div><div class="inspector-kicker">Selected step</div><h2>${esc(title)}</h2></div>${selected.type === 'candidateInfo' ? '<span class="node-badge">Fixed start</span>' : ''}</div><div id="node-editor"></div>`;
    const syncRole = (key, value) => { flow[key] = value; const crumb = document.querySelector('.crumb-title'); if (crumb && key === 'jobTitle') crumb.textContent = value || 'Untitled role'; save(); };
    panel.querySelector('#role-company').addEventListener('input', event => syncRole('companyName', event.target.value));
    panel.querySelector('#role-title').addEventListener('input', event => syncRole('jobTitle', event.target.value));
    panel.querySelector('#role-description').addEventListener('input', event => syncRole('jobDescription', event.target.value));
    panel.querySelector('#edit-role').addEventListener('click', () => { panel.querySelector('#role-title').focus(); });
    const editor = panel.querySelector('#node-editor');
    if (selected.type === 'candidateInfo') {
      editor.innerHTML = `<div class="inspector-note">This is the fixed first step. Name, email, and resume are always included. Choose any extra details that make sense for this role.</div><div class="section-small">Always included</div>${[['name', 'Full name'], ['email', 'Email address'], ['resume', 'Resume link']].map(([key, label]) => `<label class="locked-field"><input type="checkbox" class="check" checked disabled><span>${label}</span><small>Required</small></label>`).join('')}<div class="section-small">Optional details</div>${C.OPTIONAL_FIELDS.map(field => `<label class="toggle-field"><span>${esc(field.label)}</span><input type="checkbox" class="check optional-field" data-field="${esc(field.key)}" ${flow.candidateInfoFields[field.key] ? 'checked' : ''}></label>`).join('')}<p class="connection-help">The selected details appear directly on the public job application page.</p>`;
      editor.querySelectorAll('.optional-field').forEach(input => input.addEventListener('change', event => { flow.candidateInfoFields[event.target.dataset.field] = event.target.checked; save(); drawCanvas(); }));
    } else if (selected.type === 'end') {
      editor.innerHTML = `<div class="field-group"><label for="node-label">Candidate-facing completion title</label><input class="text-input" id="node-label" value="${esc(selected.label)}"></div><div class="field-group"><label for="end-subtype">End screen</label><select class="select-input end-select" id="end-subtype"><option value="submitted" ${selected.subtype !== 'disqualified' ? 'selected' : ''}>Application received</option><option value="disqualified" ${selected.subtype === 'disqualified' ? 'selected' : ''}>Not a match this time</option></select></div><div class="inspector-note">This ending appears only to candidates who reach this step. You can create more than one ending.</div><button class="btn btn-sm btn-danger" id="remove-step" style="margin-top:14px">Delete end step</button>`;
      editor.querySelector('#node-label').addEventListener('input', event => { selected.label = event.target.value; save(); updateNodeLabel(selected); });
      editor.querySelector('#end-subtype').addEventListener('change', event => { selected.subtype = event.target.value; save(); drawCanvas(); });
      editor.querySelector('#remove-step').addEventListener('click', () => deleteNode(selected.id));
    } else {
      editor.innerHTML = `<div class="field-group"><label for="node-label">Question</label><textarea class="text-area" id="node-label" style="min-height:76px">${esc(selected.label)}</textarea></div>${selected.type === 'singleChoice' || selected.type === 'multiChoice' ? `<div class="section-small">Answer options</div><div id="options-editor">${selected.options.map((option, index) => `<div class="option-edit"><input class="text-input option-value" data-index="${index}" value="${esc(option)}" aria-label="Answer option ${index + 1}"><button class="icon-btn delete-option" data-index="${index}" aria-label="Remove option">×</button></div>`).join('')}</div><button class="add-option" id="add-option">＋ Add an option</button>` : ''}<div class="inspector-note">${selected.type === 'singleChoice' ? 'Each option needs its own connection. Drag a port from an answer row to the step that should follow it.' : selected.type === 'multiChoice' ? 'Candidates can select multiple answers. Connect this question to one next step.' : 'Candidates can enter a free-text answer. Connect this question to its next step.'}</div><button class="btn btn-sm btn-danger" id="remove-step" style="margin-top:14px">Delete step</button>`;
      editor.querySelector('#node-label').addEventListener('input', event => { selected.label = event.target.value; save(); updateNodeLabel(selected); });
      editor.querySelectorAll('.option-value').forEach(input => input.addEventListener('change', event => changeOption(selected, Number(event.target.dataset.index), event.target.value)));
      editor.querySelectorAll('.delete-option').forEach(button => button.addEventListener('click', () => removeOption(selected, Number(button.dataset.index))));
      const addOption = editor.querySelector('#add-option'); if (addOption) addOption.addEventListener('click', () => { selected.options.push(`Option ${selected.options.length + 1}`); save(); drawCanvas(); drawInspector(); });
      editor.querySelector('#remove-step').addEventListener('click', () => deleteNode(selected.id));
    }
  }
  function updateNodeLabel(node) { const element = document.querySelector(`.node[data-node="${CSS.escape(node.id)}"] .node-title`); if (element) element.textContent = node.label; }
  function changeOption(node, index, rawValue) {
    const value = rawValue.trim() || `Option ${index + 1}`; const old = node.options[index];
    if (node.options.some((option, i) => i !== index && option.toLowerCase() === value.toLowerCase())) { showToast('Each answer option needs a unique label.'); drawInspector(); return; }
    node.options[index] = value;
    currentFlow().edges.forEach(edge => { if (edge.fromNodeId === node.id && edge.optionValue === old) edge.optionValue = value; });
    save(); drawCanvas(); drawInspector();
  }
  function removeOption(node, index) {
    if (node.options.length <= 2) { showToast('Keep at least two answer options.'); return; }
    const [removed] = node.options.splice(index, 1); currentFlow().edges = currentFlow().edges.filter(edge => !(edge.fromNodeId === node.id && edge.optionValue === removed)); save(); drawCanvas(); drawInspector();
  }

  function showNodePicker() {
    setModal(`<div class="modal-head"><div><div class="eyebrow" style="margin-bottom:8px">Build your journey</div><h2>Add a step</h2><p>Pick the kind of answer you need from candidates.</p></div><button class="modal-x" data-close aria-label="Close">×</button></div><div class="type-picker"><button class="type-choice" data-type="shortText"><strong>Short answer</strong><span>An open-ended written response.</span></button><button class="type-choice" data-type="singleChoice"><strong>Choose one</strong><span>Route each answer down its own path.</span></button><button class="type-choice" data-type="multiChoice"><strong>Choose many</strong><span>Let candidates select all that apply.</span></button><button class="type-choice" data-type="end"><strong>Ending</strong><span>Show a final message and finish the flow.</span></button></div><div class="modal-actions"><button class="btn" data-close>Cancel</button></div>`);
    modalRoot.querySelectorAll('.type-choice').forEach(button => button.addEventListener('click', () => { addNode(button.dataset.type); closeModal(); }));
  }
  function addNode(type) {
    const flow = currentFlow(); const newNode = C.createNode(type, 390 + ((flow.nodes.length - 2) % 3) * 295, 145 + ((flow.nodes.length - 2) % 3) * 210);
    if (type === 'end') { newNode.label = 'Application received'; newNode.subtype = 'submitted'; }
    flow.nodes.push(newNode);
    const primaryEnd = flow.nodes.find(node => node.type === 'end' && node.id !== newNode.id && node.subtype !== 'disqualified');
    if (type === 'end') {
      // Keep existing paths intact; the new ending is available for a branch connection.
    } else if (primaryEnd) {
      const inbound = flow.edges.filter(edge => edge.toNodeId === primaryEnd.id);
      if (inbound.length) inbound.forEach(edge => { edge.toNodeId = newNode.id; });
      else {
        const info = flow.nodes.find(node => node.type === 'candidateInfo');
        const edge = flow.edges.find(item => item.fromNodeId === info.id);
        if (edge) edge.toNodeId = newNode.id;
      }
      if (type === 'singleChoice') {
        newNode.options.forEach(option => flow.edges.push({ id: C.uid('edge'), fromNodeId: newNode.id, toNodeId: primaryEnd.id, optionValue: option }));
      } else flow.edges.push({ id: C.uid('edge'), fromNodeId: newNode.id, toNodeId: primaryEnd.id });
    }
    selectedId = newNode.id; save(); renderEditor();
  }
  function deleteNode(id) {
    const flow = currentFlow(); const doomed = flow.nodes.find(node => node.id === id); if (!doomed || doomed.type === 'candidateInfo') return;
    if (doomed.type === 'end' && flow.nodes.filter(node => node.type === 'end').length === 1) { showToast('Keep at least one ending in the journey.'); return; }
    const incoming = flow.edges.filter(edge => edge.toNodeId === id);
    const outgoing = flow.edges.filter(edge => edge.fromNodeId === id);
    let bypass = null;
    if (doomed.type === 'end') bypass = flow.nodes.find(node => node.type === 'end' && node.id !== id);
    else if (outgoing.length === 1 && outgoing[0].optionValue == null) bypass = flow.nodes.find(node => node.id === outgoing[0].toNodeId);
    flow.nodes = flow.nodes.filter(node => node.id !== id);
    flow.edges = flow.edges.filter(edge => edge.fromNodeId !== id && edge.toNodeId !== id);
    if (bypass) incoming.forEach(edge => flow.edges.push({ ...edge, id: C.uid('edge'), toNodeId: bypass.id }));
    const info = flow.nodes.find(node => node.type === 'candidateInfo');
    if (!flow.edges.some(edge => edge.fromNodeId === info.id)) {
      const end = flow.nodes.find(node => node.type === 'end'); if (end) flow.edges.push({ id: C.uid('edge'), fromNodeId: info.id, toNodeId: end.id });
    }
    selectedId = info.id; save(); renderEditor(); showToast('Step deleted. Reconnect any remaining steps before publishing.');
  }

  function openPreview() {
    const flow = currentFlow();
    modalRoot.innerHTML = `<div class="preview-overlay"><div class="preview-window" id="preview-window"><div id="candidate-preview"></div></div><button class="preview-close" id="close-preview">✕ &nbsp;Exit preview</button></div>`;
    const finish = () => { if (previewController) previewController.destroy(); modalRoot.innerHTML = ''; previewController = null; };
    modalRoot.querySelector('#close-preview').addEventListener('click', finish);
    previewController = window.PathwayCandidate.mountCandidate(modalRoot.querySelector('#candidate-preview'), flow, { preview: true, onFinish: finish });
  }

  async function copyJobUrl() { return copyFlowUrl(currentFlow()); }
  async function copyFlowUrl(flow, closeOnSuccess = false) {
    let link;
    try { link = window.PathwayBackend.getPublishedJobUrl(flow); }
    catch (error) { showToast(error.message || 'This flow has no active public link.'); return; }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
      await navigator.clipboard.writeText(link);
      if (closeOnSuccess) closeModal();
      showToast('Public job link copied.');
    } catch (_) {
      setModal(`<div class="modal-head"><div><div class="eyebrow" style="margin-bottom:8px">Public job link</div><h2>Copy this link to share the role.</h2><p>This URL opens the published candidate experience.</p></div><button class="modal-x" data-close aria-label="Close">×</button></div><input class="text-input" id="job-link-fallback" aria-label="Public job link" readonly value="${esc(link)}"><div class="modal-actions"><button class="btn btn-primary" id="copy-job-link-fallback">Copy job link</button></div>`);
      const input = modalRoot.querySelector('#job-link-fallback'); input.focus(); input.select();
      modalRoot.querySelector('#copy-job-link-fallback').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(link); closeModal(); showToast('Public job link copied.'); }
        catch (_) { input.focus(); input.select(); showToast('Link selected. Copy it to your clipboard.'); }
      });
    }
  }

  async function unpublishFlow() {
    const flow = currentFlow();
    const button = root.querySelector('#publish-btn');
    if (!flow || !button) return;
    button.disabled = true; button.textContent = 'Unpublishing…';
    try {
      await window.PathwayBackend.unpublishFlow(flow, workspace);
      renderEditor();
      showToast('Flow returned to draft. Existing public links are now inactive.');
    } catch (error) {
      button.disabled = false; button.textContent = 'Unpublish ↘';
      showToast(error.message || 'This flow could not be unpublished.');
    }
  }

  async function publishFlow() {
    if (!subscription?.active) { openSubscriptionPage(); return; }
    const flow = currentFlow();
    try { C.normalizeFlow(flow); }
    catch (error) {
      setModal(`<div class="modal-head"><div><div class="eyebrow" style="margin-bottom:8px">Before you publish</div><h2>Your journey needs one more pass.</h2><p>${esc(error.message)}</p></div><button class="modal-x" data-close aria-label="Close">×</button></div><div class="modal-actions"><button class="btn btn-primary" data-close>Back to the builder</button></div>`); return;
    }
    const publishButton = root.querySelector('#publish-btn');
    if (publishButton) { publishButton.disabled = true; publishButton.textContent = 'Publishing…'; }
    let link;
    try { const token = await window.PathwayBackend.publishFlow(flow, workspace); renderEditor(); const url = new URL('apply.html', window.location.href); url.hash = `id=${encodeURIComponent(token)}`; link = url.href; }
    catch (error) { if (publishButton) { publishButton.disabled = false; publishButton.textContent = 'Publish ↗'; } showToast(error.message || 'This application could not be published.'); return; }
    setModal(`<div class="modal-head"><div><div class="eyebrow" style="margin-bottom:8px">Published snapshot</div><h2>Your job page is ready to share.</h2><p>This link opens a read-only version of the flow stored in your workspace. New edits won't change this published snapshot.</p></div><button class="modal-x" data-close aria-label="Close">×</button></div><div class="publish-link" id="share-url">${esc(link)}</div><div class="prototype-note">The candidate form is public, but this early release does not yet save or deliver application responses. Avoid using real applicant data.</div><div class="modal-actions"><button class="btn" id="open-link">Open candidate page</button><button class="btn btn-primary" id="copy-link">${ICONS.copy} &nbsp;Copy link</button></div>`);
    modalRoot.querySelector('#copy-link').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(link); showToast('Application link copied.'); closeModal(); }
      catch (_) { const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(modalRoot.querySelector('#share-url')); selection.removeAllRanges(); selection.addRange(range); showToast('Select and copy the highlighted link.'); }
    });
    modalRoot.querySelector('#open-link').addEventListener('click', () => window.open(link, '_blank', 'noopener'));
  }

  window.addEventListener('pointerup', () => { if (connectFrom && window.pendingPointer) { connectFrom = null; window.pendingPointer = null; drawCanvas(); } });
  window.PathwayAuth.start(context => {
    workspace = context.workspace;
    user = context.user;
    subscription = context.subscription || { status: 'free', active: false, currentPeriodEnd: null, cancelAtPeriodEnd: false };
    flows = context.flows;
    applicants = []; applicantFilter = ''; applicantSearch = '';
    const requestedPage = window.location.hash.replace(/^#/, '');
    if (new URLSearchParams(window.location.search).get('checkout') === 'complete') {
      window.history.replaceState({}, '', window.location.pathname + window.location.hash);
      setTimeout(() => showToast(subscription.active ? 'Subscription active. You can now publish job flows.' : 'Checkout received. Subscription access is syncing; refresh in a moment.'), 0);
    }
    if (requestedPage === 'applicants') void renderApplicants(); else renderDashboard();
  });
})();

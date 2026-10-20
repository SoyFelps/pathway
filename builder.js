/* Pathway static flow builder. */
(function () {
  const C = window.PathwayCore;
  const root = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  const toast = document.getElementById('toast');
  const ICONS = {
    published: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/></svg>',
    flows: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    applicants: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.1"/><path d="M3.4 20c.2-3.3 2.1-5.3 5.6-5.3s5.4 2 5.6 5.3M16 5.4a3 3 0 0 1 0 5.8M17 14.8c2.1.6 3.3 2.2 3.5 4.7"/></svg>',
    team: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="7.5" r="2.3"/><circle cx="12" cy="6.5" r="2.6"/><circle cx="18" cy="7.5" r="2.3"/><path d="M2.5 18.5c.2-2.3 1.5-3.6 3.5-3.6s3.3 1.3 3.5 3.6M8.5 20c.2-3.2 1.5-5 3.5-5s3.3 1.8 3.5 5M14.5 18.5c.2-2.3 1.5-3.6 3.5-3.6s3.3 1.3 3.5 3.6"/></svg>',
    node: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="8" height="6" rx="1.5"/><rect x="13" y="14" width="8" height="6" rx="1.5"/><path d="M11 7h3a2 2 0 0 1 2 2v5"/></svg>',
    arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h14M13 5l7 7-7 7"/></svg>',
    copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>'
  };
  let flows = [];
  let companies = [];
  let workspace = null;
  let user = null;
  let isOwner = false;
  let teamMember = null;
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
  let applicantFlowLabels = [];
  let applicantFilter = '';
  let failedColumnOpen = false;
  let applicantSearch = '';
  let applicantStagesEnabled = {};
  let applicantStageOrder = [];
  let currentCardSummaryRequest = 0;
  let paymentHistoryOpen = false;
  let paymentHistoryLoaded = false;
  let paymentHistoryLoading = false;
  let paymentHistoryRequestId = 0;
  let paymentHistoryInvoices = [];
  let paymentHistoryNextAfter = null;
  let paymentHistoryHasMore = false;
  let teamRenderRequestId = 0;
  let dashboardApplicantCountRequestId = 0;
  const locallyUnpublishedFlows = new WeakSet();
  const flowEditRevisions = new WeakMap();
  const applicantStages = [
    { key: 'failed', label: 'Failed', color: 'stage-failed', locked: true },
    { key: 'new', label: 'New', color: 'stage-new', locked: true },
    { key: 'screening', label: 'Screening', color: 'stage-screening', defaultOn: true },
    { key: 'team_fit', label: 'Team Fit', color: 'stage-team-fit' },
    { key: 'skill_fit', label: 'Skill Fit', color: 'stage-skill-fit' },
    { key: 'interview', label: 'Interview', color: 'stage-interview', defaultOn: true },
    { key: 'promising', label: 'Promising', color: 'stage-promising', defaultOn: true },
    { key: 'offer', label: 'Offer', color: 'stage-offer', defaultOn: true },
    { key: 'withdrawn', label: 'Withdrawn', color: 'stage-withdrawn' },
    { key: 'hired', label: 'Hired', color: 'stage-hired', defaultOn: true, pinnedLast: true }
  ];
  // Failed and New stay first and Hired stays last; the stages in between can be reordered in Customize.
  const movableApplicantStageKeys = applicantStages.filter(stage => !stage.locked && !stage.pinnedLast).map(stage => stage.key);
  function applicantStageOrderPreferenceKey() { return `pathway:applicant-stage-order:${workspace?.id || 'default'}`; }
  function loadApplicantStageOrderPreference() {
    try {
      const saved = JSON.parse(localStorage.getItem(applicantStageOrderPreferenceKey()) || 'null');
      if (Array.isArray(saved)) {
        const known = saved.filter((key, index) => movableApplicantStageKeys.includes(key) && saved.indexOf(key) === index);
        return [...known, ...movableApplicantStageKeys.filter(key => !known.includes(key))];
      }
    } catch (_) { /* Fall back to the standard order. */ }
    return [...movableApplicantStageKeys];
  }
  function saveApplicantStageOrderPreference() {
    try { localStorage.setItem(applicantStageOrderPreferenceKey(), JSON.stringify(applicantStageOrder)); }
    catch (_) { /* Keep the modal usable when browser storage is unavailable. */ }
  }
  function orderedApplicantStages() {
    const byKey = Object.fromEntries(applicantStages.map(stage => [stage.key, stage]));
    const order = applicantStageOrder.length ? applicantStageOrder : movableApplicantStageKeys;
    return [...applicantStages.filter(stage => stage.locked), ...order.map(key => byKey[key]), ...applicantStages.filter(stage => stage.pinnedLast)];
  }
  function applicantStagePreferenceKey() { return `pathway:applicant-stages:${workspace?.id || 'default'}`; }
  function defaultApplicantStagesEnabled() { return Object.fromEntries(applicantStages.map(stage => [stage.key, Boolean(stage.locked || stage.defaultOn)])); }
  function loadApplicantStagesPreference() {
    const enabled = defaultApplicantStagesEnabled();
    try {
      const saved = JSON.parse(localStorage.getItem(applicantStagePreferenceKey()) || 'null');
      if (saved && typeof saved === 'object') applicantStages.forEach(stage => { if (!stage.locked && typeof saved[stage.key] === 'boolean') enabled[stage.key] = saved[stage.key]; });
    } catch (_) { /* Fall back to the default columns when browser storage is unavailable. */ }
    return enabled;
  }
  function saveApplicantStagesPreference() {
    try { localStorage.setItem(applicantStagePreferenceKey(), JSON.stringify(applicantStagesEnabled)); }
    catch (_) { /* Keep the modal usable when browser storage is unavailable. */ }
  }
  function applicantHasStage(stageKey) { return C.groupApplicants(applicants).some(group => group.status === stageKey); }
  function visibleApplicantStages() {
    return orderedApplicantStages().filter(stage => stage.locked || applicantStagesEnabled[stage.key] || applicantHasStage(stage.key));
  }

  const currentFlow = () => flows.find(flow => flow.id === currentId);
  const hasPermission = permission => Boolean(isOwner || (subscription?.active && teamMember?.[`can_${permission}`]));
  const canManageTeam = () => Boolean(isOwner || (subscription?.active && teamMember?.can_manage_team));
  const esc = C.esc;
  function hasUnpublishedChanges(flow) {
    if (!flow || flow.publicationStatus !== 'published' || !flow.activePublishedFlowId) return false;
    if (locallyUnpublishedFlows.has(flow)) return true;
    const updatedAt = Date.parse(flow.updatedAt || '');
    const publishedAt = Date.parse(flow.publishedAt || '');
    return !Number.isFinite(publishedAt) || (Number.isFinite(updatedAt) && updatedAt > publishedAt);
  }
  const publishingFlows = new WeakSet();
  function updatePublicationNotice() {
    const slot = root.querySelector('#publish-changes-slot');
    if (!slot) return;
    const flow = currentFlow();
    if (!hasUnpublishedChanges(flow)) { slot.innerHTML = ''; return; }
    slot.innerHTML = `<div class="unpublished-changes" role="status"><span>You have changes that aren’t published yet.</span><button type="button" class="btn btn-sm btn-primary" id="publish-changes">Publish changes</button></div>`;
    const button = slot.querySelector('#publish-changes');
    button.disabled = publishingFlows.has(flow);
    if (button.disabled) button.textContent = 'Publishing…';
    button.addEventListener('click', publishFlowChanges);
  }
  // internal: true for changes candidates never see (the people responsible), which do not count as unpublished changes.
  const save = ({ internal = false } = {}) => {
    const flow = currentFlow();
    if (!flow || !workspace) return;
    flowEditRevisions.set(flow, (flowEditRevisions.get(flow) || 0) + 1);
    if (!internal && flow.publicationStatus === 'published' && flow.activePublishedFlowId) locallyUnpublishedFlows.add(flow);
    if (!internal) flow.updatedAt = new Date().toISOString();
    updatePublicationNotice();
    const indicator = document.querySelector('.save-indicator');
    if (indicator) indicator.innerHTML = '<span class="status-dot"></span> Saving…';
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(async () => {
      try {
        await window.PathwayBackend.saveFlow(flow, workspace);
        if (flow.cloudId && currentFlow() === flow) setRoute(`flow=${flow.cloudId}`); // a brand-new flow only gets its id after the first save
        const item = document.querySelector('.save-indicator');
        if (item) item.innerHTML = '<span class="status-dot"></span> Saved securely';
        updatePublicationNotice();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { const current = document.querySelector('.save-indicator'); if (current) current.innerHTML = '<span class="status-dot"></span> Saved to workspace'; }, 1800);
      } catch (error) {
        const item = document.querySelector('.save-indicator');
        if (item) item.innerHTML = '<span class="save-failed">Save failed</span>';
        showToast(`Could not save this flow: ${error.message || 'check your connection'}`);
      }
    }, 350);
  };
  // Keep the current page in the URL hash so a browser refresh returns to it. replaceState avoids polluting history.
  function setRoute(route) {
    try {
      const hash = `#${route}`;
      if (window.location.hash !== hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
    } catch (_) { /* Navigation still works without URL persistence. */ }
  }
  function cssToken(name, fallback) { return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim() || fallback; }
  function showToast(message, duration = 2400) {
    toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
  }
  function initials(name) { return (name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase(); }
  function companySnapshot(company) { return company ? { id: company.id, name: company.name, description: company.description || '', logoPath: company.logoPath || null, logoUrl: company.logoUrl || '' } : null; }
  // In-app notifications: one entry per job with new candidates; it disappears when this person opens that job's board.
  let notifications = [];
  let mentionNotifs = [];
  let pendingCandidateOpen = null;
  let notifLoadedAt = 0;
  let notifTimer = null;
  let notifObserver = null;
  const NOTIF_REFRESH_MS = 60000;
  const BELL_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
  async function refreshNotifications(force = false) {
    if (!workspace || !hasPermission('applicants')) { notifications = []; mentionNotifs = []; paintNotifications(); return; }
    if (!force && Date.now() - notifLoadedAt < 15000) return;
    try {
      notifications = await window.PathwayBackend.listFlowNotifications(workspace.id);
      notifLoadedAt = Date.now();
    } catch (error) { return; /* keep what we had; the next check tries again */ }
    try { mentionNotifs = await window.PathwayBackend.listCommentMentions(workspace.id); } catch (error) { /* keep what we had */ }
    // Already looking at that job's board: show the new candidates there instead of lighting the bell.
    const onBoard = root.querySelector('.applicants-page') && !modalRoot.innerHTML;
    const showingThatJob = applicantFilter && notifications.some(item => item.flowId === applicantFilter);
    const showingAllJobs = !applicantFilter && notifications.length && !applicantSearch.trim() && applicants.length < APPLICANT_LIST_LIMIT;
    if (onBoard && (showingThatJob || showingAllJobs)) { void renderApplicants(); return; }
    paintNotifications();
  }
  function paintNotifications() {
    const host = root.querySelector('#notif'); if (!host) return;
    const badge = host.querySelector('.notif-badge'), menu = host.querySelector('.notif-menu'), button = host.querySelector('#notif-bell');
    const total = notifications.length + mentionNotifs.length;
    badge.textContent = total > 9 ? '9+' : String(total);
    badge.hidden = !total;
    button.setAttribute('aria-label', total ? 'Notifications, ' + total + ' unread' : 'Notifications');
    const mentionItems = mentionNotifs.map(item => '<button type="button" class="notif-item" data-notif-mention-flow="' + esc(item.flowId) + '" data-notif-mention-email="' + esc(item.candidateEmail) + '"><span class="notif-text"><strong>' + esc(item.authorName) + '</strong> mentioned you in a comment</span><span class="notif-sub">' + esc(item.candidateName) + (item.jobTitle ? ' · ' + esc(item.jobTitle) : '') + '</span></button>').join('');
    menu.innerHTML = total
      ? mentionItems + notifications.map(item => '<button type="button" class="notif-item" data-notif-flow="' + esc(item.flowId) + '"><span class="notif-text">There are new applications for <strong>' + esc(item.jobTitle || 'Untitled role') + '</strong></span><span class="notif-sub">' + item.newCount + (item.newCount === 1 ? ' new candidate' : ' new candidates') + (item.companyName ? ' · ' + esc(item.companyName) : '') + '</span></button>').join('')
      : '<div class="notif-empty">You are all caught up.</div>';
  }
  function mountNotificationBell() {
    const actions = root.querySelector('.top-actions');
    if (!actions || actions.querySelector('#notif') || !workspace || !hasPermission('applicants')) return;
    actions.insertAdjacentHTML('afterbegin', '<div class="notif" id="notif"><button type="button" class="notif-btn" id="notif-bell" aria-haspopup="true" aria-expanded="false" aria-label="Notifications">' + BELL_ICON + '<span class="notif-badge" hidden></span></button><div class="notif-menu" role="menu" hidden></div></div>');
    const host = actions.querySelector('#notif'), button = host.querySelector('#notif-bell'), menu = host.querySelector('.notif-menu');
    const setOpen = open => { menu.hidden = !open; button.setAttribute('aria-expanded', String(open)); };
    button.addEventListener('click', () => { setOpen(menu.hidden); if (!menu.hidden) void refreshNotifications(true); });
    menu.addEventListener('click', event => {
      const mention = event.target.closest('[data-notif-mention-flow]');
      if (mention) {
        setOpen(false); pendingCandidateOpen = { flowId: mention.dataset.notifMentionFlow, email: String(mention.dataset.notifMentionEmail || '').trim().toLowerCase() };
        applicantFilter = pendingCandidateOpen.flowId; applicantSearch = ''; void renderApplicants(); return;
      }
      const item = event.target.closest('[data-notif-flow]'); if (!item) return;
      setOpen(false); applicantFilter = item.dataset.notifFlow; applicantSearch = ''; void renderApplicants();
    });
    host.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { setOpen(false); button.focus(); } });
    const closeOnOutside = event => {
      if (!host.isConnected) { document.removeEventListener('pointerdown', closeOnOutside, true); return; }
      if (!host.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside, true);
    paintNotifications();
    void refreshNotifications();
  }
  // Called when the board of one job has loaded: that is "opening" its notification.
  function markFlowSeen(flowId) {
    if (!flowId) return;
    if (notifications.some(item => item.flowId === flowId)) { notifications = notifications.filter(item => item.flowId !== flowId); paintNotifications(); }
    window.PathwayBackend.markFlowNotificationSeen(flowId).catch(() => {});
  }
  // "All jobs" shows every candidate of the workspace (the backend returns at most this many, newest first).
  // Only when the whole list was shown can every job's notification be cleared safely.
  const APPLICANT_LIST_LIMIT = 1000;
  function markAllFlowsSeen() {
    const flowIds = notifications.map(item => item.flowId);
    if (!flowIds.length) return;
    notifications = []; paintNotifications();
    flowIds.forEach(flowId => window.PathwayBackend.markFlowNotificationSeen(flowId).catch(() => {}));
  }
  function startNotifications() {
    if (!notifObserver) { notifObserver = new MutationObserver(() => mountNotificationBell()); notifObserver.observe(root, { childList: true }); }
    if (!notifTimer) {
      notifTimer = setInterval(() => { if (document.visibilityState === 'visible') void refreshNotifications(true); }, NOTIF_REFRESH_MS);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshNotifications(); });
    }
    notifications = []; notifLoadedAt = 0; mountNotificationBell();
  }
  let myProfile = null;
  let teamDirectory = [];
  // The header shows the person's name; the e-mail stays available as the tooltip.
  function headerUserHtml() {
    const name = personName(myProfile);
    return '<span class="auth-user" title="' + esc(user.email || '') + '">' + esc(name || user.email || '—') + '</span>';
  }
  function personName(person) {
    return [person?.firstName, person?.lastName].map(part => String(part || '').trim()).filter(Boolean).join(' ');
  }
  // The name shown for a teammate; when two people share the same name the e-mail is added so they can be told apart.
  function personLabel(person, list = people) {
    const name = personName(person);
    if (!name) return person.email;
    const clash = list.some(other => other !== person && other.userId !== person.userId && personName(other).toLowerCase() === name.toLowerCase());
    return clash ? name + ' (' + person.email + ')' : name;
  }
  let people = [];
  let peopleLoadedAt = 0;
  async function refreshPeople(force = false) {
    if (!workspace || (!force && Date.now() - peopleLoadedAt < 30000)) return;
    try { people = await window.PathwayBackend.listWorkspacePeople(workspace.id); peopleLoadedAt = Date.now(); }
    catch (error) { /* the field simply offers "All" when the team list cannot be loaded */ }
  }
  function currentResponsibleIds(ids) {
    const known = new Set(people.map(person => person.userId));
    return (ids || []).filter(id => known.has(id));
  }
  function mountResponsibleField(host, labelId, getIds, setIds) {
    host.classList.add('multi-select');
    host.innerHTML = '<button type="button" class="select-input multi-select-trigger" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="' + labelId + '"></button><div class="multi-select-menu" role="listbox" aria-multiselectable="true" hidden></div>';
    const trigger = host.querySelector('.multi-select-trigger'), menu = host.querySelector('.multi-select-menu');
    const summary = () => {
      const names = currentResponsibleIds(getIds()).map(id => people.find(person => person.userId === id)).filter(Boolean).map(person => personLabel(person));
      if (!names.length) return 'All';
      return names.length > 2 ? names[0] + ', ' + names[1] + ' +' + (names.length - 2) : names.join(', ');
    };
    const paintTrigger = () => { trigger.innerHTML = '<span class="multi-select-value">' + esc(summary()) + '</span><span class="multi-select-caret" aria-hidden="true">▾</span>'; };
    const paintMenu = () => {
      const ids = currentResponsibleIds(getIds());
      menu.innerHTML = '<label class="multi-select-option"><input type="checkbox" class="check" data-all-people ' + (ids.length ? '' : 'checked') + '><span>All</span></label>'
        + people.map(person => '<label class="multi-select-option"><input type="checkbox" class="check" value="' + esc(person.userId) + '" ' + (ids.includes(person.userId) ? 'checked' : '') + '><span class="multi-select-person"><span class="multi-select-name">' + esc(personName(person) || person.email) + '</span>' + (personName(person) ? '<small class="multi-select-email">' + esc(person.email) + '</small>' : '') + '</span>' + (person.isOwner ? '<small>Owner</small>' : '') + '</label>').join('');
    };
    const setOpen = open => { menu.hidden = !open; trigger.setAttribute('aria-expanded', String(open)); if (open) paintMenu(); };
    trigger.addEventListener('click', () => setOpen(menu.hidden));
    menu.addEventListener('change', event => {
      const input = event.target;
      let ids = currentResponsibleIds(getIds());
      if (input.hasAttribute('data-all-people')) ids = [];
      else ids = input.checked ? [...ids, input.value] : ids.filter(id => id !== input.value);
      setIds(ids); paintMenu(); paintTrigger();
    });
    const closeOnOutside = event => {
      if (!host.isConnected) { document.removeEventListener('pointerdown', closeOnOutside, true); return; }
      if (!host.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside, true);
    host.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { event.stopPropagation(); setOpen(false); trigger.focus(); } });
    paintTrigger();
    void refreshPeople().then(() => { if (host.isConnected) { paintTrigger(); if (!menu.hidden) paintMenu(); } });
  }
  function companyOptionsHtml(selectedId = '') {
    return `<option value="" ${selectedId ? '' : 'selected'}>Use workspace name (${esc(workspace.name)})</option>${companies.map(company => `<option value="${esc(company.id)}" ${company.id === selectedId ? 'selected' : ''}>${esc(company.name)}</option>`).join('')}`;
  }
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
  function closeModal() { modalRoot.innerHTML = ''; root.querySelector('.app-shell')?.classList.remove('is-creating-flow'); }

  function renderSidebar(active) {
    return `<aside class="app-sidebar" aria-label="Workspace navigation"><div class="sidebar-caption">Workspace</div><button class="sidebar-link ${active === 'dashboard' ? 'active' : ''}" data-route="dashboard"><span class="sidebar-icon" aria-hidden="true">▦</span>Dashboard</button><button class="sidebar-link ${active === 'applicants' ? 'active' : ''}" data-route="applicants"><span class="sidebar-icon" aria-hidden="true">${ICONS.applicants}</span>Applicants</button>${isOwner || teamMember ? `<button class="sidebar-link ${active === 'my-team' ? 'active' : ''}" data-route="my-team"><span class="sidebar-icon" aria-hidden="true">${ICONS.team}</span>My Team</button>` : ''}${hasPermission('flows') ? `<button class="sidebar-link ${active === 'my-companies' ? 'active' : ''}" data-route="my-companies"><span class="sidebar-icon" aria-hidden="true">▣</span>My Companies</button>` : ''}${isOwner ? `<button class="sidebar-link ${active === 'my-plan' ? 'active' : ''}" data-route="my-plan"><span class="sidebar-icon" aria-hidden="true">◈</span>My Plan</button>` : ''}<button class="sidebar-link ${active === 'settings' ? 'active' : ''}" data-route="settings"><span class="sidebar-icon" aria-hidden="true">⚙</span>Settings</button></aside>`;
  }

  function bindSidebar() {
    root.querySelector('[data-route="dashboard"]')?.addEventListener('click', () => renderDashboard());
    root.querySelector('[data-route="my-companies"]')?.addEventListener('click', renderMyCompanies);
    root.querySelector('[data-route="applicants"]')?.addEventListener('click', () => { void renderApplicants(); });
    root.querySelector('[data-route="my-plan"]')?.addEventListener('click', renderMyPlan);
    root.querySelector('[data-route="my-team"]')?.addEventListener('click', () => { void renderMyTeam(); });
    root.querySelector('[data-route="settings"]')?.addEventListener('click', renderSettings);
  }

  function companyCardHtml(company) {
    return `<article class="company-card"><div class="company-card-heading">${company.logoUrl ? `<img class="company-card-logo" src="${esc(company.logoUrl)}" alt="${esc(company.name)} logo">` : `<span class="company-card-logo company-card-logo-fallback" aria-hidden="true">${esc(initials(company.name))}</span>`}<div><h2>${esc(company.name)}</h2><span>Company profile</span></div></div><p title="${esc(company.description)}">${esc(company.description)}</p><div class="company-card-actions"><button type="button" class="btn btn-sm" data-edit-company="${esc(company.id)}">Edit</button><button type="button" class="btn btn-sm btn-danger" data-delete-company="${esc(company.id)}">Delete</button></div></article>`;
  }

  function renderMyCompanies() {
    if (!hasPermission('flows')) return renderAccessMessage('flows');
    setRoute('my-companies');
    currentId = null; selectedId = null;
    const atLimit = companies.length >= 3;
    root.innerHTML = `<div class="app-shell"><header class="topbar"><a class="brand" href="#" id="brand-home"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="top-actions">${renderPlanControl()}<span class="workspace-name" title="${esc(workspace.name)}">${esc(workspace.name)}</span>${headerUserHtml()}<button class="btn btn-sm" id="signout">Sign out</button></div></header><div class="workspace-body">${renderSidebar('my-companies')}<main class="companies-page"><div class="companies-heading"><div><div class="eyebrow">Hiring workspace</div><h1>My Companies</h1><p>Choose a company to represent a job on its public application page.</p></div><div class="companies-heading-actions"><span class="companies-count">${companies.length} / 3 companies</span><button class="btn btn-primary" id="new-company" ${atLimit ? 'disabled title="You can add up to three companies."' : ''}>＋ &nbsp;New company</button></div></div>${companies.length ? `<section class="companies-grid" aria-label="Your companies">${companies.map(companyCardHtml).join('')}</section>` : `<section class="companies-empty"><span class="brand-mark">↗</span><h2>No companies yet</h2><p>New flows will use ${esc(workspace.name)} until you add a company profile.</p><button class="btn btn-primary" id="empty-new-company">＋ &nbsp;New company</button></section>`}</main></div></div>`;
    bindSidebar(); bindPlanControl();
    root.querySelector('#brand-home')?.addEventListener('click', event => { event.preventDefault(); renderDashboard(); });
    root.querySelector('#signout')?.addEventListener('click', doSignOut);
    root.querySelector('#new-company')?.addEventListener('click', showNewCompany);
    root.querySelector('#empty-new-company')?.addEventListener('click', showNewCompany);
    root.querySelectorAll('[data-edit-company]').forEach(button => button.addEventListener('click', () => {
      const company = companies.find(item => item.id === button.dataset.editCompany);
      if (company) showEditCompany(company);
    }));
    root.querySelectorAll('[data-delete-company]').forEach(button => button.addEventListener('click', () => {
      const company = companies.find(item => item.id === button.dataset.deleteCompany);
      if (company) showDeleteCompany(company);
    }));
  }

  function showNewCompany() {
    if (!hasPermission('flows')) return renderAccessMessage('flows');
    if (companies.length >= 3) { showToast('You can add up to three companies to your workspace.'); return; }
    setModal(`<div class="modal-head"><div><div class="eyebrow" style="margin-bottom:8px">Company profile</div><h2>New company</h2><p>Details are shown to candidates when this company is selected for a job.</p></div><button class="modal-x" data-close aria-label="Close">×</button></div><form id="new-company-form"><div class="field-group"><label for="company-name">Company name</label><input class="text-input" id="company-name" name="name" maxlength="120" required placeholder="e.g. Northstar Studio"></div><div class="field-group"><label for="company-logo">Logo <span class="muted">(optional)</span></label><input class="text-input company-logo-upload" id="company-logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp"><small class="field-help">PNG, JPG, or WebP · Maximum 2 MB</small></div><div class="field-group"><label for="company-description">Company description</label><textarea class="text-area" id="company-description" name="description" maxlength="3000" required placeholder="Tell candidates about the company…"></textarea><small class="field-help">Up to 3,000 characters</small></div><div class="company-form-error auth-error" id="company-form-error" role="alert"></div><div class="modal-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit" id="create-company-submit">Save company</button></div></form>`);
    modalRoot.querySelector('#new-company-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget; const button = form.querySelector('#create-company-submit'); const errorBox = form.querySelector('#company-form-error');
      const file = form.elements.logo.files?.[0] || null;
      if (file && (file.size > 2 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) {
        errorBox.textContent = 'Choose a PNG, JPG, or WebP logo that is 2 MB or smaller.'; errorBox.classList.add('show'); return;
      }
      button.disabled = true; button.textContent = 'Saving…'; errorBox.classList.remove('show');
      try {
        const company = await window.PathwayBackend.createCompany({ name: form.elements.name.value, description: form.elements.description.value, logoFile: file }, workspace);
        companies.push(company); closeModal(); renderMyCompanies(); showToast('Company added.');
      } catch (error) {
        errorBox.textContent = error.message || 'The company could not be saved.'; errorBox.classList.add('show'); button.disabled = false; button.textContent = 'Save company';
      }
    });
  }

  function companyFormHtml(company, editing) {
    const title = editing ? 'Edit company' : 'New company';
    const action = editing ? 'Save changes' : 'Save company';
    const existingLogo = editing && company.logoUrl
      ? `<div class="company-logo-current" id="company-logo-current"><img src="${esc(company.logoUrl)}" alt="Current ${esc(company.name)} logo"><button class="icon-btn company-logo-remove" id="remove-company-logo" type="button" aria-label="Remove current logo" title="Remove current logo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></svg></button></div><div class="company-logo-removal-pending" id="company-logo-removal-pending" hidden><span id="company-logo-removal-message">Logo will be removed when you save.</span><button class="btn btn-sm" id="restore-company-logo" type="button">Undo</button></div><input type="hidden" name="removeLogo" value="false">`
      : '';
    const deleteButton = editing ? '<button class="btn btn-danger company-delete-from-edit" id="delete-company-from-edit" type="button">Delete</button>' : '';
    return `<div class="modal-head"><div><div class="eyebrow" style="margin-bottom:8px">Company profile</div><h2>${title}</h2><p>Details are shown to candidates when this company is selected for a job.</p></div><button class="modal-x" data-close aria-label="Close">×</button></div><form id="company-profile-form"><div class="field-group"><label for="company-name">Company name</label><input class="text-input" id="company-name" name="name" maxlength="120" required value="${editing ? esc(company.name) : ''}" placeholder="e.g. Northstar Studio"></div><div class="field-group"><label for="company-logo">${editing ? 'Replace logo' : 'Logo'} <span class="muted">(optional)</span></label>${existingLogo}<input class="text-input company-logo-upload" id="company-logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp"><small class="field-help">PNG, JPG, or WebP · Maximum 2 MB</small></div><div class="field-group"><label for="company-description">Company description</label><textarea class="text-area" id="company-description" name="description" maxlength="3000" required placeholder="Tell candidates about the company…">${editing ? esc(company.description) : ''}</textarea><small class="field-help">Up to 3,000 characters</small></div><div class="company-form-error auth-error" id="company-form-error" role="alert"></div><div class="modal-actions company-edit-actions">${deleteButton}<button class="btn" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit" id="company-profile-submit">${action}</button></div></form>`;
  }

  function validateCompanyLogo(file, errorBox) {
    if (file && (file.size > 2 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) {
      errorBox.textContent = 'Choose a PNG, JPG, or WebP logo that is 2 MB or smaller.';
      errorBox.classList.add('show');
      return false;
    }
    return true;
  }

  function showEditCompany(company) {
    if (!hasPermission('flows')) return renderAccessMessage('flows');
    setModal(companyFormHtml(company, true));
    const form = modalRoot.querySelector('#company-profile-form');
    const logoPreview = form.querySelector('#company-logo-current');
    const removalPending = form.querySelector('#company-logo-removal-pending');
    const removalMessage = form.querySelector('#company-logo-removal-message');
    const removeLogoInput = form.elements.removeLogo;
    form.querySelector('#remove-company-logo')?.addEventListener('click', () => {
      logoPreview.hidden = true;
      removalPending.hidden = false;
      removeLogoInput.value = 'true';
      removalMessage.textContent = form.elements.logo.files?.length ? 'Logo will be changed when you save.' : 'Logo will be removed when you save.';
    });
    form.elements.logo.addEventListener('change', () => {
      if (!logoPreview?.hidden || !removalPending) return;
      removalMessage.textContent = form.elements.logo.files?.length ? 'Logo will be changed when you save.' : 'Logo will be removed when you save.';
    });
    form.querySelector('#restore-company-logo')?.addEventListener('click', () => {
      form.elements.logo.value = '';
      logoPreview.hidden = false;
      removalPending.hidden = true;
      removeLogoInput.value = 'false';
    });
    form.querySelector('#delete-company-from-edit')?.addEventListener('click', () => showDeleteCompany(company));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('#company-profile-submit');
      const errorBox = form.querySelector('#company-form-error');
      const file = form.elements.logo.files?.[0] || null;
      if (!validateCompanyLogo(file, errorBox)) return;
      button.disabled = true; button.textContent = 'Saving…'; errorBox.classList.remove('show');
      try {
        const result = await window.PathwayBackend.updateCompany({
          name: form.elements.name.value,
          description: form.elements.description.value,
          logoFile: file,
          removeLogo: form.elements.removeLogo?.value === 'true'
        }, company, workspace);
        companies = companies.map(item => item.id === result.company.id ? result.company : item);
        const updatedAt = new Date().toISOString();
        flows.filter(flow => flow.companyId === result.company.id).forEach(flow => {
          flow.companyName = result.company.name;
          flow.companyProfile = companySnapshot(result.company);
          flow.updatedAt = updatedAt;
          if (flow.publicationStatus === 'published' && flow.activePublishedFlowId) flow.publishedAt = updatedAt;
        });
        closeModal(); renderMyCompanies();
        showToast(result.cleanupWarning ? 'Company updated. The previous logo could not be removed.' : 'Company updated in its linked flows.');
      } catch (error) {
        errorBox.textContent = error.message || 'The company could not be updated.'; errorBox.classList.add('show');
        button.disabled = false; button.textContent = 'Save changes';
      }
    });
  }

  function showDeleteCompany(company) {
    if (!hasPermission('flows')) return renderAccessMessage('flows');
    const linkedFlows = flows.filter(flow => flow.companyId === company.id);
    const flowList = linkedFlows.length
      ? `<ul class="company-delete-flow-list">${linkedFlows.slice(0, 8).map(flow => `<li>${esc(flow.jobTitle || 'Untitled role')}</li>`).join('')}${linkedFlows.length > 8 ? `<li>and ${linkedFlows.length - 8} more</li>` : ''}</ul>`
      : '';
    const consequences = linkedFlows.length
      ? `This also permanently deletes ${linkedFlows.length} linked ${linkedFlows.length === 1 ? 'flow' : 'flows'}, all candidate applications and answers, uploaded resumes, and their public job links. This cannot be undone.`
      : 'This permanently deletes this company profile. This cannot be undone.';
    setModal(`<div class="modal-head"><div><div class="eyebrow" style="margin-bottom:8px">Delete company</div><h2>Delete ${esc(company.name)}?</h2><p>${esc(consequences)}</p>${flowList}</div><button class="modal-x" data-close aria-label="Close">×</button></div><form id="delete-company-form"><div class="field-group"><label for="confirm-company-name">Type <strong>${esc(company.name)}</strong> to confirm</label><input class="text-input" id="confirm-company-name" name="confirmation" autocomplete="off" required></div><div class="company-form-error auth-error" id="company-form-error" role="alert"></div><div class="modal-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn btn-danger" type="submit" id="delete-company-submit" disabled>Delete company${linkedFlows.length ? ' and flows' : ''}</button></div></form>`);
    const form = modalRoot.querySelector('#delete-company-form');
    const confirmation = form.elements.confirmation;
    const button = form.querySelector('#delete-company-submit');
    confirmation.addEventListener('input', () => { button.disabled = confirmation.value !== company.name; });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (confirmation.value !== company.name) return;
      const errorBox = form.querySelector('#company-form-error');
      button.disabled = true; button.textContent = 'Deleting…'; errorBox.classList.remove('show');
      try {
        const result = await window.PathwayBackend.deleteCompany(company, workspace, linkedFlows, deletedFlow => {
          flows = flows.filter(flow => flow.id !== deletedFlow.id);
        });
        flows = flows.filter(flow => !result.deletedFlowIds.includes(flow.id));
        companies = companies.filter(item => item.id !== company.id);
        closeModal(); renderMyCompanies(); showToast('Company and linked flows deleted.');
      } catch (error) {
        const deleted = Array.isArray(error.deletedFlowIds) ? new Set(error.deletedFlowIds) : new Set();
        if (deleted.size) flows = flows.filter(flow => !deleted.has(flow.id));
        const message = `${deleted.size ? `${deleted.size} linked ${deleted.size === 1 ? 'flow was' : 'flows were'} deleted. ` : ''}${error.message || 'The company could not be deleted.'}`;
        if (deleted.size) { closeModal(); renderMyCompanies(); showToast(message); return; }
        errorBox.textContent = message;
        errorBox.classList.add('show'); button.disabled = false; button.textContent = `Delete company${linkedFlows.length ? ' and flows' : ''}`;
      }
    });
  }

  function renderPlanControl() {
    if (!isOwner) return '';
    return subscription?.active
      ? '<span class="status-pill" title="Your workspace can publish job flows"><span class="status-dot"></span>Premium</span>'
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
    } else if (root.querySelector('.my-plan-page')) {
      subscriptionReturnPage = 'my-plan';
      subscriptionReturnFlowId = null;
    } else if (root.querySelector('.companies-page')) {
      subscriptionReturnPage = 'my-companies';
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
    } else if (subscriptionReturnPage === 'my-plan') {
      renderMyPlan();
    } else if (subscriptionReturnPage === 'my-companies') {
      renderMyCompanies();
    } else {
      renderDashboard();
    }
  }

  async function refreshSubscriptionAfterCheckout() {
    showToast('Checkout received. Activating your Premium plan…');
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        subscription = await window.PathwayBackend.getSubscriptionState(workspace.id);
        if (subscription.active) {
          if (subscriptionReturnPage === 'my-plan') renderMyPlan();
          else renderDashboard();
          showToast('Premium is active. You can now publish job flows.');
          return;
        }
      } catch (_) {
        // A transient network or webhook delay is handled by the next bounded refresh.
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    showToast('Payment received, but plan activation is still syncing. Refresh this page in a moment.');
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
              // Stripe renders in an iframe and cannot read our CSS variables, so brand colours come from the tokens;
              // danger, success and text keep Stripe's own defaults.
              borderRadius: '4px', colorBackground: cssToken('surface', '#ffffff'), colorDanger: '#df1b41', colorPrimary: cssToken('green', '#315f4a'),
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

  // Dashboard filters: search text, company and responsible person. They only narrow what is shown.
  let flowFilters = { search: '', company: '', responsible: '' };
  const WORKSPACE_FILTER = '__workspace';
  function filteredFlows() {
    const term = flowFilters.search.trim().toLowerCase();
    return flows.filter(flow => {
      if (term && !((flow.jobTitle || '') + ' ' + (flow.companyName || '')).toLowerCase().includes(term)) return false;
      if (flowFilters.company === WORKSPACE_FILTER) { if (flow.companyId) return false; }
      else if (flowFilters.company && flow.companyId !== flowFilters.company) return false;
      if (flowFilters.responsible) {
        const ids = currentResponsibleIds(flow.responsibleIds);
        if (ids.length && !ids.includes(flowFilters.responsible)) return false; // an empty list means "All": everyone is responsible
      }
      return true;
    });
  }
  function flowCompanyFilterOptionsHtml() {
    const ids = [...new Set(flows.map(flow => flow.companyId).filter(Boolean))];
    const named = ids.map(id => ({ id, name: companies.find(item => item.id === id)?.name || flows.find(flow => flow.companyId === id)?.companyName || 'Company' })).sort((a, b) => a.name.localeCompare(b.name));
    const options = [['', 'All companies'], ...named.map(item => [item.id, item.name])];
    if (flows.some(flow => !flow.companyId)) options.push([WORKSPACE_FILTER, workspace.name]);
    if (!options.some(([value]) => value === flowFilters.company)) flowFilters.company = '';
    return options.map(([value, label]) => '<option value="' + esc(value) + '"' + (flowFilters.company === value ? ' selected' : '') + '>' + esc(label) + '</option>').join('');
  }
  function flowResponsibleFilterOptionsHtml() {
    if (people.length && flowFilters.responsible && !people.some(person => person.userId === flowFilters.responsible)) flowFilters.responsible = '';
    return '<option value="">All responsibles</option>' + people.map(person => '<option value="' + esc(person.userId) + '"' + (flowFilters.responsible === person.userId ? ' selected' : '') + '>' + esc(personLabel(person)) + (person.isOwner ? ' (owner)' : '') + '</option>').join('');
  }
  function flowFiltersHtml() {
    if (!flows.length) return '';
    return '<div class="flow-filters"><input class="text-input" type="search" id="flow-search" placeholder="Search flows" aria-label="Search flows" value="' + esc(flowFilters.search) + '"><select class="select-input" id="flow-company-filter" aria-label="Filter by company">' + flowCompanyFilterOptionsHtml() + '</select><select class="select-input" id="flow-responsible-filter" aria-label="Filter by responsible">' + flowResponsibleFilterOptionsHtml() + '</select></div>';
  }
  function flowCardHtml(flow) {
    return `<article class="flow-card" data-flow="${esc(flow.id)}" tabindex="0" role="button" aria-label="Edit ${esc(flow.jobTitle)}"><div class="flow-card-preview"><svg class="mini-svg" viewBox="0 0 400 120" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><path class="mw" d="M117 73C142.5 73 142.5 60 168 60"/><path class="mw" d="M270 60C285 60 285 44 300 44"/><path class="mw" d="M270 60C285 60 285 94 300 94"/><rect class="mn" x="24" y="56" width="93" height="36" rx="8"/><rect class="mb" x="36" y="65" width="46" height="4" rx="2"/><rect class="ms" x="36" y="74" width="62" height="3" rx="1.5"/><circle class="mp" cx="24" cy="73" r="3.5"/><circle class="mp" cx="117" cy="73" r="3.5"/><rect class="mn" x="168" y="43" width="102" height="36" rx="8"/><rect class="mb" x="180" y="52" width="49" height="4" rx="2"/><rect class="ms" x="180" y="61" width="62" height="3" rx="1.5"/><circle class="mp" cx="168" cy="60" r="3.5"/><circle class="mp" cx="270" cy="60" r="3.5"/><rect class="mn" x="300" y="27" width="77" height="36" rx="8"/><rect class="mb" x="312" y="36" width="35" height="4" rx="2"/><rect class="ms" x="312" y="45" width="49" height="3" rx="1.5"/><circle class="mp" cx="300" cy="44" r="3.5"/><circle class="mp" cx="377" cy="44" r="3.5"/><rect class="mn" x="300" y="77" width="77" height="36" rx="8"/><rect class="mb" x="312" y="86" width="35" height="4" rx="2"/><rect class="ms" x="312" y="95" width="49" height="3" rx="1.5"/><circle class="mp" cx="300" cy="94" r="3.5"/><circle class="mp" cx="377" cy="94" r="3.5"/></svg></div><div class="flow-card-body"><div class="flow-card-top"><span class="${flow.publicationStatus === 'published' ? 'published-tag' : 'draft-tag'}"><span class="status-dot"></span>${flow.publicationStatus === 'published' ? 'Published' : 'Draft'}</span><button class="icon-btn flow-menu" data-menu="${esc(flow.id)}" aria-label="Flow actions">···</button></div><h3>${esc(flow.jobTitle || 'Untitled role')}</h3><div class="flow-company">${esc(flow.companyName || 'Your company')}</div><div class="flow-card-foot"><span class="flow-count">${ICONS.node}${nodeSummary(flow)}</span><span>${ago(flow.updatedAt)}</span></div></div></article>`;
  }
  function flowCardsHtml() {
    const visible = filteredFlows();
    return visible.length ? visible.map(flowCardHtml).join('') : '<div class="flow-grid-empty"><p>No flows match these filters.</p><button class="btn btn-sm" type="button" id="flow-clear-filters">Clear filters</button></div>';
  }
  function bindFlowCards() {
    root.querySelectorAll('.flow-card').forEach(card => {
      card.addEventListener('click', event => { if (!event.target.closest('.flow-menu')) openFlow(card.dataset.flow); });
      card.addEventListener('keydown', event => { if (event.key === 'Enter') openFlow(card.dataset.flow); });
    });
    root.querySelectorAll('.flow-menu').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); showFlowMenu(button.dataset.menu); }));
    root.querySelector('#flow-clear-filters')?.addEventListener('click', () => { flowFilters = { search: '', company: '', responsible: '' }; renderDashboard(); });
  }
  function paintFlowGrid() {
    const grid = root.querySelector('#flow-grid'); if (!grid) return;
    grid.innerHTML = flowCardsHtml();
    bindFlowCards();
  }
  function bindFlowFilters() {
    root.querySelector('#flow-search')?.addEventListener('input', event => { flowFilters.search = event.target.value; paintFlowGrid(); });
    root.querySelector('#flow-company-filter')?.addEventListener('change', event => { flowFilters.company = event.target.value; paintFlowGrid(); });
    root.querySelector('#flow-responsible-filter')?.addEventListener('change', event => { flowFilters.responsible = event.target.value; paintFlowGrid(); });
    if (root.querySelector('#flow-responsible-filter')) {
      void refreshPeople().then(() => {
        const select = root.querySelector('#flow-responsible-filter'); if (!select) return;
        select.innerHTML = flowResponsibleFilterOptionsHtml(); paintFlowGrid();
      });
    }
  }
  function renderDashboard() {
    if (!hasPermission('flows')) return renderAccessMessage('flows');
    setRoute('dashboard');
    currentId = null; selectedId = null;
    const metricsRequestId = ++dashboardApplicantCountRequestId;
    const count = flows.length;
    const drafts = flows.filter(flow => flow.publicationStatus !== 'published').length;
    const published = count - drafts;
    const nodes = flows.reduce((sum, flow) => sum + flow.nodes.length, 0);
    root.innerHTML = `<div class="app-shell"><header class="topbar"><a class="brand" href="#"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="top-actions">${renderPlanControl()}<span class="workspace-name" title="${esc(workspace.name)}">${esc(workspace.name)}</span>${headerUserHtml()}<button class="btn btn-sm" id="signout">Sign out</button></div></header><div class="workspace-body">${renderSidebar('dashboard')}<main class="dashboard"><div class="dash-greeting"><div><div class="eyebrow">Your workspace</div><h1>Hiring made organized</h1><p>Build application flows, share role links and review every candidate in one place.</p></div><div class="dash-action"><button class="btn btn-primary" id="new-flow">＋ &nbsp;New flow</button></div></div><section class="dash-stats"><div class="stat"><span class="stat-icon">${ICONS.flows}</span><div><strong>${count}</strong><span>Application ${count === 1 ? 'flow' : 'flows'}</span></div></div><div class="stat"><span class="stat-icon">${ICONS.applicants}</span><div><strong id="dashboard-new-applicant-count" title="${hasPermission('applicants') ? 'Loading new applicants' : 'Candidates access required'}">—</strong><span>New applicants</span></div></div><div class="stat"><span class="stat-icon">${ICONS.published}</span><div><strong>${published}</strong><span>Published flows</span></div></div></section><div class="section-heading"><h2>Application flows</h2><span class="muted" style="font-size:12px">${drafts} draft${drafts === 1 ? '' : 's'} · ${published} published</span></div>${flows.length ? `${flowFiltersHtml()}<section class="flow-grid" id="flow-grid">${flowCardsHtml()}</section>` : `<section class="empty-state"><span class="brand-mark">↗</span><h3>Your next great flow starts here.</h3><p>Create a role page and shape a thoughtful path for applicants.</p><button class="btn btn-primary" id="empty-new-flow">＋ &nbsp;Create your first flow</button></section>`}</main></div></div>`;
    bindSidebar();
    bindPlanControl();
    root.querySelector('#empty-new-flow')?.addEventListener('click', showNewFlow);
    root.querySelector('#new-flow').addEventListener('click', showNewFlow);
    root.querySelector('#signout').addEventListener('click', doSignOut);
    bindFlowCards();
    bindFlowFilters();
    if (hasPermission('applicants')) void loadDashboardNewApplicantCount(metricsRequestId);
  }

  async function loadDashboardNewApplicantCount(requestId) {
    const countNode = root.querySelector('#dashboard-new-applicant-count');
    if (!countNode) return;
    try {
      const count = await window.PathwayBackend.countNewApplicants(workspace.id);
      if (requestId !== dashboardApplicantCountRequestId || !countNode.isConnected) return;
      countNode.textContent = String(count);
      countNode.title = `${count} new applicant${count === 1 ? '' : 's'}`;
    } catch (_) {
      if (requestId === dashboardApplicantCountRequestId && countNode.isConnected) {
        countNode.textContent = '—';
        countNode.title = 'New applicants could not be loaded';
      }
    }
  }

  async function renderApplicants() {
    if (!hasPermission('applicants')) return renderAccessMessage('applicants');
    setRoute('applicants');
    applicantStagesEnabled = loadApplicantStagesPreference();
    applicantStageOrder = loadApplicantStageOrderPreference();
    currentId = null; selectedId = null;
    applicantFlowLabels = flows;
    flowResponsiblesCache.clear();
    root.innerHTML = `<div class="app-shell"><header class="topbar"><a class="brand" href="#"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="top-actions">${renderPlanControl()}<span class="workspace-name" title="${esc(workspace.name)}">${esc(workspace.name)}</span>${headerUserHtml()}<button class="btn btn-sm" id="signout">Sign out</button></div></header><div class="workspace-body">${renderSidebar('applicants')}<main class="applicants-page"><div class="applicants-heading"><div><div class="eyebrow">Hiring workspace</div><h1>Applicants</h1><p>Review applications and move candidates through your hiring stages.</p></div><div class="applicants-tools"><select id="applicant-flow-filter" class="applicants-filter" aria-label="Filter applicants by job"><option value="">All jobs</option>${applicantFlowLabels.filter(flow => flow.cloudId).map(flow => `<option value="${esc(flow.cloudId)}" ${applicantFilter === flow.cloudId ? 'selected' : ''}>${esc(flow.jobTitle || 'Untitled role')}</option>`).join('')}</select><input id="applicant-search" class="applicants-search" type="search" placeholder="Search applicants" value="${esc(applicantSearch)}" aria-label="Search applicants"><button class="btn btn-sm" id="refresh-applicants" title="Refresh applicants">↻ Refresh</button></div></div><div class="applicant-stage-toggle-wrap" id="applicant-stage-toggle-wrap"><button class="btn btn-sm" type="button" id="customize-stages">Customize</button></div><div id="applicants-content"><div class="loading-card"><span class="brand-mark">↗</span><span>Loading applicants…</span></div></div></main></div></div>`;
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
      if (!hasPermission('flows')) {
        applicantFlowLabels = await window.PathwayBackend.listApplicantFlowLabels();
        if (!root.querySelector('.applicants-page')) return;
        const filter = root.querySelector('#applicant-flow-filter');
        if (filter) filter.insertAdjacentHTML('beforeend', applicantFlowLabels.filter(flow => flow.cloudId).map(flow => `<option value="${esc(flow.cloudId)}" ${applicantFilter === flow.cloudId ? 'selected' : ''}>${esc(flow.jobTitle || 'Untitled role')}</option>`).join(''));
      }
      applicants = await window.PathwayBackend.listApplicants(workspace.id, applicantFilter);
      if (!root.querySelector('.applicants-page')) return;
      renderApplicantBoard();
      if (pendingCandidateOpen) {
        const target = pendingCandidateOpen; pendingCandidateOpen = null;
        const match = applicants.find(item => item.flow_id === target.flowId && String(item.candidate_email || '').trim().toLowerCase() === target.email);
        if (match) showApplicantDetails(match.id);
      }
      if (applicantFilter) markFlowSeen(applicantFilter);
      else if (!applicantSearch.trim() && applicants.length < APPLICANT_LIST_LIMIT) markAllFlowsSeen();
    } catch (error) {
      const content = root.querySelector('#applicants-content');
      if (content) content.innerHTML = `<div class="auth-error show" role="alert">${esc(`Could not load applicants: ${error.message || 'check your connection and try again'}`)}</div>`;
    }
  }

  function formatPlanDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function paymentHistoryPanelMarkup() {
    return `<section class="payment-history-panel" id="payment-history-panel" ${paymentHistoryOpen ? '' : 'hidden'} aria-live="polite"><p class="payment-history-message" id="payment-history-message">Your invoices will appear here.</p><div class="payment-history-list" id="payment-history-list"></div><div class="payment-history-more-wrap" id="payment-history-more-wrap" hidden><button class="btn" id="load-more-payment-history">Load older invoices</button></div></section>`;
  }

  function renderAccessMessage(section) {
    currentId = null; selectedId = null;
    const area = section === 'flows' ? 'Flows' : 'Applicants';
    const permitted = Boolean(teamMember?.[`can_${section}`]);
    const message = !subscription?.active
      ? 'The workspace Premium plan is inactive. Access to shared workspace data is paused until the owner restores Premium.'
      : permitted ? 'This area is unavailable for this account.' : `The workspace owner has not enabled ${area} access for your account.`;
    root.innerHTML = `<div class="app-shell"><header class="topbar"><a class="brand" href="#" id="brand-home"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="top-actions"><span class="workspace-name">${esc(workspace.name)}</span>${headerUserHtml()}<button class="btn btn-sm" id="signout">Sign out</button></div></header><div class="workspace-body">${renderSidebar('')}<main class="my-team-page"><section class="team-empty-state"><div class="eyebrow">Workspace access</div><h1>${area} access is unavailable</h1><p>${esc(message)}</p>${teamMember ? '<button class="btn" id="open-my-team">Open My Team</button>' : ''}</section></main></div></div>`;
    bindSidebar();
    root.querySelector('#brand-home')?.addEventListener('click', event => { event.preventDefault(); if (hasPermission('flows')) renderDashboard(); });
    root.querySelector('#signout')?.addEventListener('click', doSignOut);
    root.querySelector('#open-my-team')?.addEventListener('click', () => { void renderMyTeam(); });
  }

  function teamPermissionControls(permissions = {}, disabled = false) {
    return `<div class="team-permission-grid"><label><input type="checkbox" data-permission="flows" ${permissions.can_flows !== false ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span>Flows</span></label><label><input type="checkbox" data-permission="applicants" ${permissions.can_applicants !== false ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span>Candidates</span></label><label><input type="checkbox" data-permission="team" ${permissions.can_manage_team !== false ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span>Team</span></label></div>`;
  }

  // Name on top and e-mail below it (the e-mail always stays visible in My Team). Without a known name only the e-mail shows.
  function teamPersonLines(userId, email) {
    const known = teamDirectory.find(person => person.userId === userId) || (userId === user.id ? myProfile : null);
    const name = personName(known);
    return name ? '<strong>' + esc(name) + '</strong><span class="team-person-email">' + esc(email) + '</span>' : '<strong>' + esc(email) + '</strong>';
  }
  function renderMyTeamMarkup(data) {
    const manager = Boolean(data.canManage);
    const describe = p => [p.can_flows && 'Flows', p.can_applicants && 'Candidates', p.can_manage_team && 'Team'].filter(Boolean).join(' · ') || 'No access';
    const members = manager ? (data.members || []).map(member => `<article class="team-person" data-member-id="${esc(member.user_id)}"><div class="team-person-heading"><div>${teamPersonLines(member.user_id, member.member_email)}<span>Member since ${esc(new Date(member.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }))}</span></div><button class="btn btn-danger btn-sm" data-remove-member="${esc(member.user_id)}">Remove</button></div>${teamPermissionControls(member)}<span class="team-save-status" aria-live="polite"></span></article>`).join('') : data.readOnlyTeam ? data.readOnlyTeam.filter(person => !person.isOwner).map(person => `<article class="team-person${person.userId === user.id ? ' team-self' : ''}"><div class="team-person-heading"><div>${teamPersonLines(person.userId, person.email)}<span>${person.userId === user.id ? 'You · ' : ''}Member since ${esc(new Date(person.memberSince).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }))}</span></div></div><div class="team-permission-summary">${esc(describe(person))}</div></article>`).join('') : teamMember ? `<article class="team-person team-self"><div class="team-person-heading"><div>${teamPersonLines(user.id, teamMember.email || user.email)}<span>You · ${data.premiumActive ? 'Team member' : 'Workspace access paused'}</span></div></div><div class="team-permission-summary">${esc(describe(teamMember))}</div></article>` : '';
    const pending = manager ? (data.invitations || []).map(invite => `<article class="team-invite-item" data-invitation-id="${esc(invite.id)}"><div class="team-person-heading"><div><strong>${esc(invite.invited_email)}</strong><span>Expires ${esc(new Date(invite.expires_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }))}</span></div><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${data.premiumActive ? `<button class="btn btn-sm" data-copy-invitation-link="${esc(invite.id)}">Copy invitation link</button>` : ''}<button class="btn btn-sm" data-revoke-invitation="${esc(invite.id)}">Revoke</button></div></div>${teamPermissionControls(invite)}<span class="team-save-status" aria-live="polite"></span></article>`).join('') : '';
    const paused = !subscription?.active;
    return `<div class="app-shell"><header class="topbar"><a class="brand" href="#" id="brand-home"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="top-actions">${renderPlanControl()}<span class="workspace-name" title="${esc(workspace.name)}">${esc(workspace.name)}</span>${headerUserHtml()}<button class="btn btn-sm" id="signout">Sign out</button></div></header><div class="workspace-body">${renderSidebar('my-team')}<main class="my-team-page"><div class="my-team-heading"><div><div class="eyebrow">Workspace access</div><h1>My Team</h1><p>${manager ? `Manage access to ${esc(workspace.name)}. Premium includes up to 3 additional members at no extra seat charge.` : `See who has access to ${esc(workspace.name)}.`}</p></div>${manager ? `<div class="team-seat-count"><strong>${data.seatsUsed || 0}<span> / 3</span></strong><small>member seats in use</small></div>` : ''}</div>${paused ? `<section class="team-notice is-paused"><strong>No team access</strong><p>The workspace needs an active Premium plan to restore member access to flows and candidates. Members can still leave, and the owner can remove members.</p>${isOwner ? '<button class="btn btn-primary" id="team-upgrade">Upgrade to Premium</button>' : ''}</section>` : ''}${!manager && !paused ? '<section class="team-notice"><strong>View only</strong><p>You can see who is on the team and what each person can access. Inviting, removing and changing permissions needs the Team permission: ask a team manager.</p></section>' : ''}${manager ? `<section class="team-card"><div class="team-card-heading"><div><h2>Invite a teammate</h2><p>Create a private link and share it directly. Pathway will not send an email.</p></div></div>${paused ? '<div class="team-inline-notice">An active Premium plan is required to invite additional members.</div>' : data.seatsUsed >= 3 ? '<div class="team-inline-notice">All 3 member seats are in use. Remove a member or revoke an invitation to free a seat.</div>' : `<form id="team-invite-form"><div class="field-group"><label for="team-invite-email">Work email</label><input class="text-input" id="team-invite-email" type="email" autocomplete="email" maxlength="254" required placeholder="teammate@company.com"></div><div class="team-permission-label">Access for this teammate <small>All three are enabled by default.</small></div><div class="team-permission-grid"><label><input type="checkbox" data-invite-permission="flows" checked><span>Flows</span></label><label><input type="checkbox" data-invite-permission="applicants" checked><span>Candidates</span></label><label><input type="checkbox" data-invite-permission="team" checked><span>Team</span></label></div><button class="btn btn-primary" id="create-team-invite" type="submit">Create invitation link</button><p class="team-form-error" id="team-form-error" role="alert" hidden></p></form>`}</section>` : ''}<section class="team-card"><div class="team-card-heading"><div><h2>People</h2><p>${manager ? 'The workspace owner cannot be removed. Members keep their own accounts when they leave.' : 'Your account stays yours if you leave this workspace.'}</p></div></div>${(data.isOwner || data.readOnlyTeam) ? `<article class="team-person team-owner"><div class="team-person-heading"><div>${teamPersonLines(teamDirectory.find(person => person.isOwner)?.userId || (isOwner ? user.id : ''), data.owner?.email || data.readOnlyTeam?.find(person => person.isOwner)?.email || user.email)}<span>Workspace owner · cannot be removed</span></div><span class="team-owner-badge">Owner</span></div><div class="team-permission-summary">Full workspace access · Billing owner</div></article>` : ''}${members || '<p class="team-empty-copy">No other team members to show here.</p>'}</section>${manager && data.invitations?.length ? `<section class="team-card"><div class="team-card-heading"><div><h2>Pending invitations</h2><p>Invitation links expire after 7 days and can be revoked at any time.</p></div></div><div class="team-invitation-list">${pending}</div></section>` : ''}<div class="team-leave-wrap">${!data.isOwner ? '<button class="btn btn-danger" id="leave-team">Leave this team</button>' : ''}</div></main></div></div>`;
  }

  function renderMyTeamLoadingMarkup() {
    return `<div class="app-shell"><header class="topbar"><a class="brand" href="#" id="brand-home"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="top-actions">${renderPlanControl()}<span class="workspace-name" title="${esc(workspace.name)}">${esc(workspace.name)}</span>${headerUserHtml()}<button class="btn btn-sm" id="signout">Sign out</button></div></header><div class="workspace-body">${renderSidebar('my-team')}<main class="my-team-page" aria-busy="true"><div class="my-team-heading"><div><div class="eyebrow">Workspace access</div><h1>My Team</h1><p>Loading team members and invitations…</p></div><div class="team-skeleton team-skeleton-seat" aria-hidden="true"></div></div><section class="team-card team-loading-card" aria-hidden="true"><div class="team-skeleton team-skeleton-title"></div><div class="team-skeleton team-skeleton-copy"></div><div class="team-skeleton team-skeleton-field"></div><div class="team-skeleton team-skeleton-button"></div></section><section class="team-card team-loading-card" aria-hidden="true"><div class="team-skeleton team-skeleton-title"></div><div class="team-skeleton team-skeleton-person"></div><div class="team-skeleton team-skeleton-person short"></div></section><p class="team-loading-status" role="status">Loading your team…</p></main></div></div>`;
  }

  function renderMyTeamLoading() {
    root.innerHTML = renderMyTeamLoadingMarkup();
    bindSidebar(); bindPlanControl();
    root.querySelector('#brand-home')?.addEventListener('click', event => { event.preventDefault(); hasPermission('flows') ? renderDashboard() : renderAccessMessage('flows'); });
    root.querySelector('#signout')?.addEventListener('click', doSignOut);
  }

  async function renderMyTeam() {
    currentId = null; selectedId = null;
    if (!isOwner && !teamMember) return renderDashboard();
    setRoute('my-team');
    const requestId = ++teamRenderRequestId;
    renderMyTeamLoading();
    try {
      let data = await window.PathwayBackend.listTeam();
      teamDirectory = [];
      try { teamDirectory = await window.PathwayBackend.listTeamOverview(workspace.id); }
      catch (error) { /* names are optional: fall back to e-mail addresses only */ }
      if (!data.canManage && !isOwner && teamMember && teamDirectory.length) data = { ...data, readOnlyTeam: teamDirectory };
      if (requestId !== teamRenderRequestId || !root.querySelector('[data-route="my-team"].active')) return;
      root.innerHTML = renderMyTeamMarkup(data);
      bindSidebar(); bindPlanControl();
      root.querySelector('#brand-home')?.addEventListener('click', event => { event.preventDefault(); hasPermission('flows') ? renderDashboard() : renderAccessMessage('flows'); });
      root.querySelector('#signout')?.addEventListener('click', doSignOut);
      root.querySelector('#team-upgrade')?.addEventListener('click', openSubscriptionPage);
      root.querySelector('#team-invite-form')?.addEventListener('submit', event => { void createTeamInvite(event); });
      root.querySelectorAll('[data-remove-member]').forEach(button => button.addEventListener('click', () => confirmRemoveTeamMember(button.dataset.removeMember)));
      root.querySelectorAll('[data-revoke-invitation]').forEach(button => button.addEventListener('click', () => { void revokeTeamInvite(button.dataset.revokeInvitation); }));
      root.querySelectorAll('[data-copy-invitation-link]').forEach(button => button.addEventListener('click', () => { void copyTeamInviteLink(button); }));
      root.querySelectorAll('[data-member-id] [data-permission]').forEach(input => input.addEventListener('change', () => { void saveMemberPermissions(input.closest('[data-member-id]')); }));
      root.querySelectorAll('[data-invitation-id] [data-permission]').forEach(input => input.addEventListener('change', () => { void saveInvitationPermissions(input.closest('[data-invitation-id]')); }));
      root.querySelector('#leave-team')?.addEventListener('click', showLeaveTeamConfirmation);
    } catch (error) {
      if (requestId !== teamRenderRequestId || !root.querySelector('[data-route="my-team"].active')) return;
      root.innerHTML = `<div class="app-shell"><header class="topbar"><span class="brand">pathway</span><div class="top-actions"><span class="workspace-name">${esc(workspace.name)}</span><button class="btn btn-sm" id="signout">Sign out</button></div></header><div class="workspace-body">${renderSidebar('my-team')}<main class="my-team-page"><section class="team-notice is-paused"><h1>Team data unavailable</h1><p>${esc(error.message || 'Please try again.')}</p><button class="btn" id="retry-team">Retry</button></section></main></div></div>`;
      bindSidebar(); root.querySelector('#retry-team')?.addEventListener('click', () => { void renderMyTeam(); }); root.querySelector('#signout')?.addEventListener('click', doSignOut);
    }
  }

  async function createTeamInvite(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('#create-team-invite');
    const errorBox = form.querySelector('#team-form-error');
    submit.disabled = true; submit.textContent = 'Creating link…'; errorBox.hidden = true;
    try {
      const permissions = Object.fromEntries([...form.querySelectorAll('[data-invite-permission]')].map(input => [input.dataset.invitePermission, input.checked]));
      const email = form.querySelector('#team-invite-email').value.trim();
      const result = await window.PathwayBackend.createTeamInvitation(email, permissions);
      setModal(`<div class="modal-head"><div><div class="eyebrow" style="margin-bottom:8px">Invitation created</div><h2>Share this secure link.</h2><p>The link is unique, can be used once, and expires in 7 days. It works only for <strong>${esc(email)}</strong>.</p></div><button class="modal-x" data-close aria-label="Close">×</button></div><label class="form-label" for="team-invite-link">Invitation link</label><input class="text-input" id="team-invite-link" readonly value="${esc(result.url)}"><div class="modal-actions"><button class="btn" data-close>Done</button><button class="btn btn-primary" id="copy-team-invite">Copy invitation link</button></div>`);
      modalRoot.querySelector('#copy-team-invite').addEventListener('click', async () => {
        const input = modalRoot.querySelector('#team-invite-link');
        try { await navigator.clipboard.writeText(result.url); showToast('Invitation link copied.'); closeModal(); }
        catch (_) { input.focus(); input.select(); showToast('Link selected. Copy it to your clipboard.'); }
      });
      void renderMyTeam();
    } catch (error) {
      errorBox.textContent = error.message || 'The invitation could not be created.'; errorBox.hidden = false;
      submit.disabled = false; submit.textContent = 'Create invitation link';
    }
  }

  async function saveMemberPermissions(card) {
    const inputs = [...card.querySelectorAll('[data-permission]')];
    const status = card.querySelector('.team-save-status');
    inputs.forEach(input => { input.disabled = true; });
    if (status) status.textContent = 'Saving…';
    try {
      const permissions = Object.fromEntries(inputs.map(input => [input.dataset.permission, input.checked]));
      await window.PathwayBackend.updateTeamMemberPermissions(card.dataset.memberId, permissions);
      if (card.dataset.memberId === user.id) { await renderMyTeam(); return; }
      if (status) status.textContent = 'Permissions saved';
    } catch (error) { if (status) status.textContent = error.message || 'Could not save'; }
    finally { inputs.forEach(input => { input.disabled = false; }); }
  }

  async function saveInvitationPermissions(card) {
    const inputs = [...card.querySelectorAll('[data-permission]')];
    const status = card.querySelector('.team-save-status');
    inputs.forEach(input => { input.disabled = true; });
    if (status) status.textContent = 'Saving…';
    try {
      const permissions = Object.fromEntries(inputs.map(input => [input.dataset.permission, input.checked]));
      await window.PathwayBackend.updateTeamInvitationPermissions(card.dataset.invitationId, permissions);
      if (status) status.textContent = 'Invitation permissions saved';
    } catch (error) { if (status) status.textContent = error.message || 'Could not save'; }
    finally { inputs.forEach(input => { input.disabled = false; }); }
  }

  async function revokeTeamInvite(id) {
    try { await window.PathwayBackend.revokeTeamInvitation(id); showToast('Invitation revoked.'); await renderMyTeam(); }
    catch (error) { showToast(error.message || 'Invitation could not be revoked.'); }
  }

  async function copyTeamInviteLink(button) {
    const id = button.dataset.copyInvitationLink;
    const card = button.closest('[data-invitation-id]');
    const email = card?.querySelector('.team-person-heading strong')?.textContent || 'this teammate';
    button.disabled = true; button.textContent = 'Preparing…';
    try {
      const result = await window.PathwayBackend.getTeamInvitationLink(id);
      const detail = result.refreshed
        ? 'This invitation predates secure link recovery, so a replacement was created and the previous link no longer works.'
        : 'This is the active link and remains valid until the invitation expires or is revoked.';
      setModal(`<div class="modal-head"><div><div class="eyebrow" style="margin-bottom:8px">Pending invitation</div><h2>Copy the invitation link.</h2><p>This link is for <strong>${esc(email)}</strong>. ${esc(detail)}</p></div><button class="modal-x" data-close aria-label="Close">×</button></div><label class="form-label" for="team-invite-link">Invitation link</label><input class="text-input" id="team-invite-link" readonly value="${esc(result.url)}"><div class="modal-actions"><button class="btn" data-close>Done</button><button class="btn btn-primary" id="copy-team-invite">Copy invitation link</button></div>`);
      modalRoot.querySelector('#copy-team-invite').addEventListener('click', async () => {
        const input = modalRoot.querySelector('#team-invite-link');
        try { await navigator.clipboard.writeText(result.url); showToast('Invitation link copied.'); closeModal(); }
        catch (_) { input.focus(); input.select(); showToast('Link selected. Copy it to your clipboard.'); }
      });
    } catch (error) {
      button.disabled = false; button.textContent = 'Copy invitation link';
      showToast(error.message || 'The invitation link could not be retrieved.');
    }
  }

  function confirmRemoveTeamMember(id) {
    setModal(`<div class="modal-head"><div><div class="eyebrow" style="margin-bottom:8px">Remove team member</div><h2>Revoke this person's workspace access?</h2><p>Their Pathway account and email remain intact. They can create their own workspace or join another team.</p></div><button class="modal-x" data-close aria-label="Close">×</button></div><div class="modal-actions"><button class="btn" data-close>Keep member</button><button class="btn btn-danger" id="confirm-remove-member">Remove member</button></div>`);
    modalRoot.querySelector('#confirm-remove-member').addEventListener('click', async event => {
      event.currentTarget.disabled = true; event.currentTarget.textContent = 'Removing…';
      try { await window.PathwayBackend.removeTeamMember(id); closeModal(); if (id === user.id) { await doSignOut(); return; } showToast('Team access removed.'); await renderMyTeam(); }
      catch (error) { closeModal(); showToast(error.message || 'Member could not be removed.'); }
    });
  }

  function showLeaveTeamConfirmation() {
    setModal(`<div class="modal-head"><div><div class="eyebrow" style="margin-bottom:8px">Leave workspace</div><h2>Leave ${esc(workspace.name)}?</h2><p>Your account will remain active, but you will immediately lose access to this workspace and its data. You can create a personal workspace or accept another team's invitation later.</p></div><button class="modal-x" data-close aria-label="Close">×</button></div><div class="modal-actions"><button class="btn" data-close>Stay on team</button><button class="btn btn-danger" id="confirm-leave-team">Leave team</button></div>`);
    modalRoot.querySelector('#confirm-leave-team').addEventListener('click', async event => {
      event.currentTarget.disabled = true; event.currentTarget.textContent = 'Leaving…';
      try { await window.PathwayBackend.leaveTeam(); closeModal(); await doSignOut(); }
      catch (error) { closeModal(); showToast(error.message || 'Could not leave the workspace.'); }
    });
  }

  // "Download my data": one flat CSV (section, record, field, value) that opens in any spreadsheet.
  function csvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    // A cell that starts like a formula could run in a spreadsheet; a leading apostrophe keeps it plain text.
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }
  function rowsToCsv(rows) { return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
  function myDataToCsv(data) {
    const rows = [['section', 'record', 'field', 'value']];
    // The database returns keys sorted by length; this puts the fields in a natural reading order.
    const ORDER = ['exportedAt', 'note', 'userId', 'email', 'firstName', 'lastName', 'name', 'workspaceName', 'title', 'company', 'job', 'status', 'text', 'writtenAt', 'canManageFlows', 'canReviewCandidates', 'canManageTeam', 'memberSince', 'planStatus', 'planCurrentPeriodEnd', 'planCancelAtPeriodEnd', 'createdAt', 'updatedAt', 'emailConfirmedAt', 'lastSignInAt'];
    const rank = field => { const i = ORDER.indexOf(field); return i < 0 ? ORDER.length : i; };
    const add = (section, record, object) => Object.entries(object || {}).sort((x, y) => rank(x[0]) - rank(y[0])).forEach(([field, value]) => rows.push([section, record, field, value]));
    add('export', '', { exportedAt: data?.exportedAt, note: 'Your account, profile, workspace and plan details and the jobs you created. Candidate details belong to the employer and are not included. A leading apostrophe on a value (for example a phone number starting with +) is added so spreadsheets do not treat it as a formula.' });
    add('account', '', data?.account);
    add('profile', '', data?.profile);
    if (data?.ownedWorkspace) add('ownedWorkspace', '', data.ownedWorkspace);
    if (data?.membership) add('membership', '', data.membership);
    (data?.jobsCreated || []).forEach((job, index) => add('jobsCreated', String(index + 1), job));
    return rowsToCsv(rows);
  }
  // "Export data" for one candidate: everything Pathway holds about them for this job, as the same flat CSV.
  function candidateDataToCsv({ person, items, jobTitle, stage, exportedAt }) {
    const rows = [['section', 'record', 'field', 'value']];
    const add = (section, record, object) => Object.entries(object || {}).forEach(([field, value]) => { if (value !== null && value !== undefined && value !== '') rows.push([section, record, field, value]); });
    add('export', '', { exportedAt, note: 'The application data Pathway holds about this candidate for this job. The resume file is not inside this CSV: download it from the candidate panel. A leading apostrophe on a value (for example a phone number starting with +) is added so spreadsheets do not treat it as a formula.' });
    add('candidate', '', { name: person.candidate_name, email: person.candidate_email, job: jobTitle, currentStage: stage, applications: items.length });
    [...items].reverse().forEach((item, index) => {
      const record = String(index + 1);
      add('application', record, { submittedAt: item.submitted_at, stage: item.status, whyMovedToFailed: item.auto_fail_reason, resumeFile: item.resume_filename, privacyNoticeVersion: item.privacy_notice_version, privacyAcknowledgedAt: item.privacy_acknowledged_at });
      add('details', record, item.candidate_info);
      (item.responses || []).forEach(response => add('answer', record + '.' + (response.order ?? ''), { question: response.question, answer: Array.isArray(response.answer) ? response.answer.join('; ') : response.answer }));
    });
    return rowsToCsv(rows);
  }
  function downloadTextFile(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.hidden = true;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function renderSettings() {
    currentId = null; selectedId = null;
    setRoute('settings');
    root.innerHTML = `<div class="app-shell"><header class="topbar"><a class="brand" href="#" id="brand-home"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="top-actions">${renderPlanControl()}<span class="workspace-name" title="${esc(workspace.name)}">${esc(workspace.name)}</span>${headerUserHtml()}<button class="btn btn-sm" id="signout">Sign out</button></div></header><div class="workspace-body">${renderSidebar('settings')}<main class="settings-page"><div class="settings-heading"><div><div class="eyebrow">Your account and workspace</div><h1>Settings</h1><p>View your account details and manage workspace access.</p></div></div><section class="settings-card" aria-labelledby="settings-profile-heading"><div class="settings-card-heading"><div><h2 id="settings-profile-heading">Name</h2></div><button class="btn" id="settings-profile-edit" type="button">Edit</button></div><div id="settings-profile-body"></div></section><section class="settings-card" aria-labelledby="settings-account-heading"><div class="settings-card-heading"><div><h2 id="settings-account-heading">Account and workspace</h2><p>These details are read-only.</p></div></div><div class="settings-info-grid"><div class="settings-info-item"><span>Email address</span><strong>${esc(user.email || '—')}</strong><small>Your sign-in email.</small></div><div class="settings-info-item"><span>Workspace</span><strong>${esc(workspace.name)}</strong><small>The workspace you currently belong to.</small></div></div></section><section class="settings-card settings-session-card"><div class="settings-card-heading"><div><h2>Sign out</h2><p>End your current Pathway session on this device.</p></div><button class="btn" id="settings-signout" type="button">Sign out</button></div></section><section class="settings-card settings-danger-card"><div class="settings-card-heading"><div><h2>Workspace access</h2><p>${isOwner ? 'Permanently remove this workspace and its data.' : 'Leave this workspace without deleting your Pathway account.'}</p></div></div>${isOwner ? '<button class="btn btn-danger" id="settings-delete-workspace" type="button">Delete workspace</button>' : teamMember ? '<button class="btn btn-danger" id="settings-leave-workspace" type="button">Leave workspace</button>' : ''}</section><section class="settings-card settings-account-delete-card"><div class="settings-card-heading"><div><h2>Delete account</h2><p>${isOwner ? 'This also deletes your workspace and all its data, and immediately cancels any subscription.' : 'Your workspace, flows, candidates and subscription will remain for the owner and team.'}</p></div><button class="btn btn-danger" id="settings-delete-account" type="button">Delete account</button></div></section><div class="settings-footer-row"><p class="settings-legal-note">Legal questions? Check our <a href="legal.html#terms" target="_blank" rel="noopener">Terms of Use</a> and <a href="legal.html#privacy" target="_blank" rel="noopener">Privacy Policy</a>.</p><button type="button" class="settings-link-button" id="settings-download-data">Download my data</button></div></main></div></div>`;
    bindSidebar(); bindPlanControl();
    root.querySelector('#brand-home')?.addEventListener('click', event => { event.preventDefault(); hasPermission('flows') ? renderDashboard() : renderAccessMessage('flows'); });
    root.querySelector('#signout')?.addEventListener('click', doSignOut);
    root.querySelector('#settings-signout')?.addEventListener('click', doSignOut);
    root.querySelector('#settings-download-data')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      if (button.disabled) return;
      const label = button.textContent;
      button.disabled = true; button.textContent = 'Preparing…';
      try {
        const data = await window.PathwayBackend.exportMyData();
        downloadTextFile('pathway-my-data-' + new Date().toISOString().slice(0, 10) + '.csv', myDataToCsv(data));
        showToast('Your data was downloaded.');
      } catch (error) {
        showToast('Could not prepare your data. Please try again.');
      } finally { button.disabled = false; button.textContent = label; }
    });
    const profileBody = root.querySelector('#settings-profile-body'), profileEdit = root.querySelector('#settings-profile-edit');
    const showProfileView = (message = '') => {
      profileEdit.hidden = false;
      profileBody.innerHTML = '<p class="settings-profile-name">' + esc(personName(myProfile) || '—') + '</p>' + (message ? '<p class="settings-profile-status is-ok" role="status">' + esc(message) + '</p>' : '');
    };
    const showProfileForm = () => {
      profileEdit.hidden = true;
      profileBody.innerHTML = '<form id="settings-profile-form" class="settings-profile-form" novalidate><div class="field-row"><div class="field-group"><label for="settings-first-name">First name</label><input class="text-input" id="settings-first-name" name="firstName" maxlength="60" autocomplete="given-name" required value="' + esc(myProfile?.firstName || '') + '"></div><div class="field-group"><label for="settings-last-name">Last name</label><input class="text-input" id="settings-last-name" name="lastName" maxlength="60" autocomplete="family-name" required value="' + esc(myProfile?.lastName || '') + '"></div></div><div class="settings-profile-actions"><button class="btn btn-primary" type="submit" id="settings-profile-save">Save name</button><button class="btn" type="button" id="settings-profile-cancel">Cancel</button><span class="settings-profile-status" id="settings-profile-status" role="status" aria-live="polite"></span></div></form>';
      root.querySelector('#settings-first-name').focus();
      root.querySelector('#settings-profile-cancel').addEventListener('click', () => showProfileView());
      root.querySelector('#settings-profile-form').addEventListener('submit', async event => {
        event.preventDefault();
        const status = root.querySelector('#settings-profile-status'), button = root.querySelector('#settings-profile-save');
        const first = root.querySelector('#settings-first-name').value, last = root.querySelector('#settings-last-name').value;
        status.className = 'settings-profile-status'; status.textContent = '';
        if (!first.trim() || !last.trim()) { status.className = 'settings-profile-status is-error'; status.textContent = 'Enter your first and last name.'; return; }
        button.disabled = true;
        try {
          myProfile = await window.PathwayBackend.updateMyProfile(first, last);
          peopleLoadedAt = 0; flowResponsiblesCache.clear();
          const headerUser = root.querySelector('.topbar .auth-user'); if (headerUser) headerUser.textContent = personName(myProfile) || user.email;
          showProfileView('Name saved.');
        } catch (error) {
          status.className = 'settings-profile-status is-error'; status.textContent = error.message || 'Could not save your name. Please try again.';
          button.disabled = false;
        }
      });
    };
    profileEdit.addEventListener('click', showProfileForm);
    showProfileView();
    root.querySelector('#settings-leave-workspace')?.addEventListener('click', showLeaveTeamConfirmation);
    root.querySelector('#settings-delete-workspace')?.addEventListener('click', showDeleteWorkspaceConfirmation);
    root.querySelector('#settings-delete-account')?.addEventListener('click', () => window.PathwayAuth.showAccountDeletionConfirmation({ isOwner, workspaceName: workspace.name, email: user.email }));
  }

  function showDeleteWorkspaceConfirmation() {
    const name = String(workspace?.name || '');
    setModal(`<div class="modal-head"><div><div class="eyebrow" style="margin-bottom:8px">Delete workspace</div><h2>Permanently delete ${esc(name)}?</h2><p>This removes the workspace, job flows and public pages, candidate applications and private resumes, pending invitations, and all member access. Other members' Pathway accounts will remain active.</p><p>Any Stripe subscription will be canceled immediately. This stops future renewals; unused paid time is not automatically refunded. Your own Pathway account will remain, and you can create another workspace.</p><p><strong>This action is irreversible.</strong></p></div><button class="modal-x" data-close aria-label="Close">×</button></div><div class="field-group settings-delete-confirmation"><label for="delete-workspace-name">Type <strong>${esc(name)}</strong> to enable deletion.</label><input class="text-input" id="delete-workspace-name" autocomplete="off" autocapitalize="off" spellcheck="false"></div><p class="settings-delete-error" id="delete-workspace-error" role="alert" hidden></p><div class="modal-actions"><button class="btn" data-close>Keep workspace</button><button class="btn btn-danger" id="confirm-delete-workspace" type="button" disabled>Delete workspace permanently</button></div>`);
    const input = modalRoot.querySelector('#delete-workspace-name');
    const button = modalRoot.querySelector('#confirm-delete-workspace');
    const errorBox = modalRoot.querySelector('#delete-workspace-error');
    input.addEventListener('input', () => { button.disabled = input.value.trim() !== name; });
    button.addEventListener('click', async () => {
      if (input.value.trim() !== name || button.disabled) return;
      input.disabled = true; button.disabled = true; button.textContent = 'Deleting workspace…'; errorBox.hidden = true;
      try {
        await window.PathwayBackend.deleteWorkspace();
        closeModal(); window.location.hash = ''; window.location.reload();
      } catch (error) {
        errorBox.textContent = error.message || 'Workspace deletion could not be completed. Refresh the page or retry.';
        errorBox.hidden = false; input.disabled = false; button.disabled = input.value.trim() !== name; button.textContent = 'Delete workspace permanently';
      }
    });
    input.focus();
  }

  function formatInvoiceAmount(invoice) {
    try {
      const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: invoice.currency.toUpperCase() });
      const divisor = 10 ** formatter.resolvedOptions().maximumFractionDigits;
      return formatter.format(invoice.amountMinor / divisor);
    } catch (_) { return `${invoice.currency.toUpperCase()} ${(invoice.amountMinor / 100).toFixed(2)}`; }
  }

  function paymentHistoryRowsMarkup() {
    const labels = { draft: 'Draft', open: 'Payment due', paid: 'Paid', uncollectible: 'Uncollectible', void: 'Voided' };
    const reasons = { subscription_create: 'Subscription started', subscription_cycle: 'Subscription renewal', subscription_update: 'Subscription updated', manual: 'Invoice' };
    return paymentHistoryInvoices.map(invoice => {
      const timestamp = invoice.paidAt || invoice.createdAt;
      const date = timestamp ? new Date(timestamp * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Date unavailable';
      const links = [
        invoice.hostedInvoiceUrl ? `<a href="${esc(invoice.hostedInvoiceUrl)}" target="_blank" rel="noopener noreferrer">View invoice</a>` : '',
        invoice.invoicePdf ? `<a href="${esc(invoice.invoicePdf)}" target="_blank" rel="noopener noreferrer">PDF</a>` : ''
      ].filter(Boolean).join('');
      return `<article class="payment-history-item"><div class="payment-history-main"><strong>${esc(invoice.number || reasons[invoice.billingReason] || 'Invoice')}</strong><span>${esc(date)}</span></div><div class="payment-history-total"><strong>${esc(formatInvoiceAmount(invoice))}</strong><span class="payment-status is-${esc(invoice.status)}">${esc(labels[invoice.status] || 'Invoice')}</span></div><div class="payment-history-links">${links || '<span class="payment-history-no-link">No invoice link available</span>'}</div></article>`;
    }).join('');
  }

  function renderMyPlan() {
    if (!isOwner) return hasPermission('flows') ? renderDashboard() : renderAccessMessage('flows');
    setRoute('my-plan');
    currentId = null; selectedId = null;
    paymentHistoryRequestId += 1;
    paymentHistoryOpen = false; paymentHistoryLoaded = false; paymentHistoryLoading = false;
    paymentHistoryInvoices = []; paymentHistoryNextAfter = null; paymentHistoryHasMore = false;
    const premium = Boolean(subscription?.active);
    const periodEnd = formatPlanDate(subscription?.currentPeriodEnd);
    const statusText = premium
      ? subscription.cancelAtPeriodEnd && periodEnd ? `Scheduled to end on ${periodEnd}` : periodEnd ? `Renews on ${periodEnd}` : 'Your Premium subscription is active.'
      : 'You are currently on the Free plan.';
    const management = premium
      ? `<section class="plan-management-card"><div class="plan-section-heading"><div><div class="eyebrow">Subscription management</div><h2>Billing details</h2><p>Manage the payment method and history for this workspace.</p></div></div><div class="plan-action-list"><div class="plan-action-row"><div class="plan-action-copy"><strong>Payment history</strong><span>View invoices and previous payments.</span></div><button class="btn plan-placeholder" disabled>Loading history</button></div><div class="plan-action-row"><div class="plan-action-copy"><strong>Payment method</strong><span>Change the card used for your subscription.</span></div><button class="btn plan-placeholder" disabled>Coming soon</button></div><div class="plan-action-row plan-cancel-row"><div class="plan-action-copy"><strong>Cancel subscription</strong><span>${subscription.cancelAtPeriodEnd && periodEnd ? `Premium will remain active until ${esc(periodEnd)}.` : `Schedule cancellation for the end of your paid period${periodEnd ? ` (${esc(periodEnd)})` : ''}.`}</span></div><button class="btn btn-danger" id="cancel-subscription" ${subscription.cancelAtPeriodEnd ? 'disabled' : ''}>${subscription.cancelAtPeriodEnd ? 'Cancellation scheduled' : 'Cancel subscription'}</button></div></div><p class="plan-placeholder-note">Invoices and receipts are retrieved securely from Stripe. Card details are managed there; Pathway never stores your card number. If you cancel, Premium and published jobs remain active through the date shown above.</p></section>`
      : `<section class="plan-free-note"><div class="plan-free-mark" aria-hidden="true">↗</div><div><strong>Build and preview for free</strong><p>Create and refine application flows at no cost. Upgrade when you are ready to publish a job.</p></div></section>`;
    const freeBenefits = !premium
      ? `<section class="premium-benefits-card"><div class="premium-benefits-heading"><span class="premium-benefits-mark" aria-hidden="true">✦</span><div><div class="eyebrow">Premium plan</div><h2>Everything you need to move from job post to decision</h2><p>Publish a role and manage the full applicant journey in Pathway.</p></div></div><ul class="premium-benefits-list"><li><span aria-hidden="true">↗</span><div><strong>Publish your job flow</strong><p>Turn your application journey into a live job posting.</p></div></li><li><span aria-hidden="true">⤴</span><div><strong>Share a public job link</strong><p>Send one simple link to candidates wherever you recruit.</p></div></li><li><span aria-hidden="true">＋</span><div><strong>Receive applications in Pathway</strong><p>Collect candidate details and answers in your workspace.</p></div></li><li><span aria-hidden="true">▤</span><div><strong>Review candidates and resumes</strong><p>See application responses and preview or download resumes.</p></div></li><li><span aria-hidden="true">✓</span><div><strong>Approve or reject candidates</strong><p>Organize your pipeline and make hiring decisions as applications come in.</p></div></li></ul><button class="btn btn-primary" id="my-plan-benefits-upgrade">Upgrade to Premium</button></section>`
      : '';
    root.innerHTML = `<div class="app-shell"><header class="topbar"><a class="brand" href="#" id="brand-home"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="top-actions">${renderPlanControl()}<span class="workspace-name" title="${esc(workspace.name)}">${esc(workspace.name)}</span>${headerUserHtml()}<button class="btn btn-sm" id="signout">Sign out</button></div></header><div class="workspace-body">${renderSidebar('my-plan')}<main class="my-plan-page"><div class="my-plan-heading"><div class="eyebrow">Workspace billing</div><h1>My Plan</h1><p>View your plan and manage billing for ${esc(workspace.name)}.</p></div><section class="plan-overview-card ${premium ? 'is-premium' : 'is-free'}"><div class="plan-overview-copy"><h2>${premium ? 'Premium' : 'Free'}</h2><p>${statusText}</p></div>${premium ? `<div class="plan-overview-price"><strong>US$ 24.90</strong><span>per month</span></div>` : '<button class="btn btn-primary" id="my-plan-upgrade">Upgrade to Premium</button>'}</section>${premium ? '<section class="plan-benefit-strip"><span class="plan-benefit-icon">✓</span><div><strong>Job publishing is enabled</strong><p>You can publish and manage job application links while your subscription is active.</p></div></section>' : ''}${freeBenefits}${management}</main></div></div>`;
    if (premium) {
      const historyRow = [...root.querySelectorAll('.plan-action-row')].find(row => row.querySelector('strong')?.textContent === 'Payment history');
      const historyButton = historyRow?.querySelector('button');
      if (historyRow && historyButton) {
        historyButton.className = 'btn'; historyButton.disabled = false; historyButton.id = 'payment-history-toggle';
        historyButton.textContent = 'View history'; historyButton.setAttribute('aria-expanded', 'false');
        historyRow.insertAdjacentHTML('afterend', paymentHistoryPanelMarkup());
      }
      const note = root.querySelector('.plan-placeholder-note');
      if (note) note.textContent = 'Invoices and receipts are retrieved securely from Stripe. Card details are managed there; Pathway never stores your card number.';
    } else if (subscription?.hasBillingHistory) {
      root.querySelector('.my-plan-page')?.insertAdjacentHTML('beforeend', `<section class="plan-management-card payment-history-standalone"><div class="plan-section-heading"><div class="eyebrow">Billing records</div><h2>Payment history</h2><p>Invoices for this workspace’s previous subscription.</p></div><button class="btn payment-history-free-toggle" id="payment-history-toggle-free" data-closed-label="View history" aria-expanded="false">View history</button>${paymentHistoryPanelMarkup()}</section>`);
    }
    bindSidebar();
    bindPlanControl();
    root.querySelector('#brand-home')?.addEventListener('click', event => { event.preventDefault(); renderDashboard(); });
    root.querySelector('#signout')?.addEventListener('click', doSignOut);
    root.querySelector('#my-plan-upgrade')?.addEventListener('click', openSubscriptionPage);
    root.querySelector('#my-plan-benefits-upgrade')?.addEventListener('click', openSubscriptionPage);
    root.querySelector('#cancel-subscription')?.addEventListener('click', showCancelSubscriptionConfirmation);
    bindPaymentHistory();
    const paymentMethodRow = [...root.querySelectorAll('.plan-action-row')].find(row => row.querySelector('strong')?.textContent === 'Payment method');
    const paymentMethodButton = paymentMethodRow?.querySelector('button');
    if (premium && paymentMethodButton) {
      paymentMethodButton.disabled = false;
      paymentMethodButton.className = 'btn';
      paymentMethodButton.id = 'update-payment-method';
      paymentMethodButton.textContent = 'Update payment method';
      paymentMethodRow.querySelector('.plan-action-copy span').textContent = 'Update your card securely through Stripe. Pathway never stores your card details.';
      paymentMethodRow.querySelector('.plan-action-copy').insertAdjacentHTML('beforeend', '<small class="plan-card-summary" id="current-payment-method" aria-live="polite">Loading current card…</small>');
      paymentMethodButton.addEventListener('click', openPaymentMethodPortal);
      void loadCurrentCardSummary();
    }
    if (premium && subscription.cancelAtPeriodEnd) {
      root.querySelector('.plan-action-list')?.insertAdjacentHTML('beforeend', '<div class="plan-action-row plan-keep-row"><div class="plan-action-copy"><strong>Keep Premium</strong><span>Remove the scheduled cancellation and restore automatic renewal at US$ 24.90 per month.</span></div><button class="btn" id="keep-premium">Keep Premium</button></div>');
      root.querySelector('#keep-premium')?.addEventListener('click', showKeepPremiumConfirmation);
    }
  }

  function bindPaymentHistory() {
    const toggle = root.querySelector('#payment-history-toggle, #payment-history-toggle-free');
    const panel = root.querySelector('#payment-history-panel');
    toggle?.addEventListener('click', () => {
      paymentHistoryOpen = !paymentHistoryOpen;
      panel.hidden = !paymentHistoryOpen;
      toggle.setAttribute('aria-expanded', String(paymentHistoryOpen));
      toggle.textContent = paymentHistoryOpen ? 'Hide history' : (toggle.dataset.closedLabel || 'View history');
      if (paymentHistoryOpen && !paymentHistoryLoaded) void loadPaymentHistory(false);
    });
    root.querySelector('#load-more-payment-history')?.addEventListener('click', () => void loadPaymentHistory(true));
  }

  async function loadPaymentHistory(append) {
    if (paymentHistoryLoading) return;
    const requestId = paymentHistoryRequestId;
    paymentHistoryLoading = true;
    const message = root.querySelector('#payment-history-message');
    const list = root.querySelector('#payment-history-list');
    const moreWrap = root.querySelector('#payment-history-more-wrap');
    const moreButton = root.querySelector('#load-more-payment-history');
    if (!message || !list) { paymentHistoryLoading = false; return; }
    if (!append) {
      paymentHistoryInvoices = []; paymentHistoryNextAfter = null; paymentHistoryHasMore = false;
      list.innerHTML = ''; message.hidden = false; message.textContent = 'Loading invoices…';
    }
    if (moreButton) { moreButton.disabled = true; moreButton.textContent = 'Loading…'; }
    try {
      const page = await window.PathwayBackend.listPaymentHistory(append ? paymentHistoryNextAfter : null);
      if (requestId !== paymentHistoryRequestId) return;
      paymentHistoryInvoices = append ? [...paymentHistoryInvoices, ...page.invoices] : page.invoices;
      paymentHistoryLoaded = true; paymentHistoryHasMore = page.hasMore; paymentHistoryNextAfter = page.nextAfter;
      list.innerHTML = paymentHistoryRowsMarkup();
      message.hidden = paymentHistoryInvoices.length > 0;
      message.textContent = paymentHistoryHasMore
        ? 'No invoices on this page belong to Pathway. Load older invoices to continue.'
        : 'No invoices have been created for this subscription yet.';
      if (moreWrap) moreWrap.hidden = !paymentHistoryHasMore;
      if (moreButton) { moreButton.disabled = false; moreButton.textContent = 'Load older invoices'; }
    } catch (error) {
      if (requestId !== paymentHistoryRequestId) return;
      message.hidden = false;
      message.textContent = error.message || 'Payment history could not be loaded. Please try again.';
      if (moreButton) { moreButton.disabled = false; moreButton.textContent = 'Retry'; }
      if (moreWrap) moreWrap.hidden = false;
    } finally {
      if (requestId === paymentHistoryRequestId) paymentHistoryLoading = false;
    }
  }

  async function loadCurrentCardSummary() {
    const summary = root.querySelector('#current-payment-method');
    if (!summary) return;
    const requestId = ++currentCardSummaryRequest;
    try {
      const card = await window.PathwayBackend.getCurrentPaymentMethodSummary();
      if (!summary.isConnected || requestId !== currentCardSummaryRequest) return;
      summary.textContent = card
        ? `${card.brand} ending in ${card.last4} · Expires ${String(card.expMonth).padStart(2, '0')}/${card.expYear}`
        : 'Stripe does not report a default card for this subscription.';
      summary.classList.toggle('is-unavailable', !card);
    } catch (_) {
      if (summary.isConnected && requestId === currentCardSummaryRequest) {
        summary.textContent = 'Card details could not be loaded. You can still update your payment method.';
        summary.classList.add('is-unavailable');
      }
    }
  }

  async function openPaymentMethodPortal(event) {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Opening Stripe…';
    try {
      const portalUrl = await window.PathwayBackend.createPaymentMethodUpdateSession();
      window.location.assign(portalUrl);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Update payment method';
      showToast(error.message || 'Could not open Stripe. Please try again.');
    }
  }

  function showCancelSubscriptionConfirmation() {
    if (!subscription?.active || subscription.cancelAtPeriodEnd) return;
    const periodEnd = formatPlanDate(subscription.currentPeriodEnd);
    setModal(`<div class="modal-head"><div><h2>Schedule subscription cancellation?</h2><p>Your Premium plan will remain active through the end of the paid period.</p></div><button class="modal-x" data-close aria-label="Close">×</button></div><div class="danger-confirm"><strong>What happens next:</strong> Pathway will turn off renewal with Stripe. You will keep Premium access and published job links until ${esc(periodEnd || 'the end of your current billing period')}. After that date, the subscription ends and published jobs are automatically unpublished.</div><div class="modal-actions"><button class="btn" data-close>Keep Premium</button><button class="btn btn-danger" id="confirm-subscription-cancel">Schedule cancellation</button></div>`);
    const confirmButton = modalRoot.querySelector('#confirm-subscription-cancel');
    confirmButton.addEventListener('click', async () => {
      confirmButton.disabled = true;
      confirmButton.textContent = 'Scheduling…';
      try {
        const result = await window.PathwayBackend.cancelSubscriptionAtPeriodEnd();
        subscription = {
          ...subscription,
          status: result.status || 'active',
          currentPeriodEnd: result.current_period_end || subscription.currentPeriodEnd,
          cancelAtPeriodEnd: true,
          active: true
        };
        closeModal();
        renderMyPlan();
        showToast(`Cancellation scheduled. Premium remains active until ${formatPlanDate(subscription.currentPeriodEnd)}.`);
      } catch (error) {
        confirmButton.disabled = false;
        confirmButton.textContent = 'Schedule cancellation';
        const message = modalRoot.querySelector('.cancellation-error');
        if (message) message.textContent = error.message || 'Could not schedule cancellation. Try again.';
        else confirmButton.closest('.modal').insertAdjacentHTML('beforeend', `<div class="auth-error show cancellation-error" role="alert">${esc(error.message || 'Could not schedule cancellation. Try again.')}</div>`);
      }
    });
  }

  function showKeepPremiumConfirmation() {
    if (!subscription?.active || !subscription.cancelAtPeriodEnd) return;
    const periodEnd = formatPlanDate(subscription.currentPeriodEnd);
    setModal(`<div class="modal-head"><div><h2>Keep your Premium plan?</h2><p>Your cancellation is scheduled${periodEnd ? ` for ${esc(periodEnd)}` : ' for the end of your paid period'}.</p></div><button class="modal-x" data-close aria-label="Close">×</button></div><div class="renewal-confirm"><strong>Automatic renewal will resume:</strong> The cancellation will be removed, your Premium access will continue, and your subscription will renew at US$ 24.90 per month. There is no immediate charge.</div><div class="modal-actions"><button class="btn" data-close>Not now</button><button class="btn btn-primary" id="confirm-keep-premium">Keep Premium</button></div>`);
    const confirmButton = modalRoot.querySelector('#confirm-keep-premium');
    confirmButton.addEventListener('click', async () => {
      confirmButton.disabled = true;
      confirmButton.textContent = 'Updating…';
      try {
        const result = await window.PathwayBackend.keepPremiumSubscription();
        subscription = {
          ...subscription,
          status: result.status || 'active',
          currentPeriodEnd: result.current_period_end || subscription.currentPeriodEnd,
          cancelAtPeriodEnd: false,
          active: true
        };
        closeModal();
        renderMyPlan();
        showToast('Cancellation removed. Your Premium plan will renew at US$ 24.90 per month.');
      } catch (error) {
        confirmButton.disabled = false;
        confirmButton.textContent = 'Keep Premium';
        const message = modalRoot.querySelector('.renewal-error');
        if (message) message.textContent = error.message || 'Could not restore automatic renewal. Try again.';
        else confirmButton.closest('.modal').insertAdjacentHTML('beforeend', `<div class="auth-error show renewal-error" role="alert">${esc(error.message || 'Could not restore automatic renewal. Try again.')}</div>`);
      }
    });
  }

  function openCustomizeStages() {
    const rows = orderedApplicantStages().map(stage => {
      const occupied = applicantHasStage(stage.key);
      const locked = stage.locked || occupied;
      const reason = stage.locked ? 'This column is always on.' : (occupied ? 'This column contains applicants. Move them to another stage before disabling it.' : '');
      const movable = movableApplicantStageKeys.includes(stage.key);
      const handle = movable ? `<button class="stage-drag" type="button" data-drag-handle aria-label="Reorder ${stage.label}. Use the up and down arrow keys." title="Drag to reorder">${'⠿'}</button>` : '<span class="stage-drag is-fixed" aria-hidden="true"></span>';
      return `<label class="stage-option${locked ? ' is-locked' : ''}${movable ? ' is-movable' : ''}" data-stage-row="${stage.key}" ${movable ? 'draggable="true"' : ''} ${reason ? `title="${reason}"` : ''}><span class="stage-option-name">${handle}<span class="stage-dot ${stage.color}"></span>${stage.label}</span><input type="checkbox" data-stage-key="${stage.key}" ${stage.locked || applicantStagesEnabled[stage.key] || occupied ? 'checked' : ''} ${locked ? 'disabled' : ''}></label>`;
    }).join('');
    const isDefaultOrder = applicantStageOrder.every((key, index) => key === movableApplicantStageKeys[index]);
    setModal(`<div class="modal-head"><div><div class="eyebrow" style="margin-bottom:8px">Applicant board</div><h2>Customize stages</h2><p>Choose which columns appear and drag the handles to reorder them. Failed and New stay first and Hired stays last.</p></div><button class="modal-x" data-close aria-label="Close">×</button></div><div class="stage-options">${rows}</div><div class="modal-actions stage-modal-actions"><button class="stage-reset" type="button" id="reset-stage-order" ${isDefaultOrder ? 'disabled' : ''}>Reset to default order</button><button class="btn btn-primary" data-close>Done</button></div>`);
    modalRoot.querySelectorAll('.stage-option input').forEach(toggle => toggle.addEventListener('change', event => {
      const stageKey = event.target.dataset.stageKey;
      if (!event.target.checked && applicantHasStage(stageKey)) { event.target.checked = true; return; }
      applicantStagesEnabled[stageKey] = event.target.checked;
      saveApplicantStagesPreference();
      renderApplicantBoard();
    }));
    const moveStage = (key, targetKey, after) => {
      if (key === targetKey) return;
      const next = applicantStageOrder.filter(item => item !== key);
      const index = next.indexOf(targetKey);
      next.splice(index + (after ? 1 : 0), 0, key);
      applicantStageOrder = next;
      saveApplicantStageOrderPreference();
      renderApplicantBoard();
      openCustomizeStages();
    };
    let dragKey = '';
    const clearDropMarks = () => modalRoot.querySelectorAll('.drop-before, .drop-after').forEach(item => item.classList.remove('drop-before', 'drop-after'));
    modalRoot.querySelectorAll('.stage-option.is-movable').forEach(row => {
      const key = row.dataset.stageRow;
      row.addEventListener('dragstart', event => { dragKey = key; row.classList.add('is-dragging'); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', key); });
      row.addEventListener('dragend', () => { dragKey = ''; row.classList.remove('is-dragging'); clearDropMarks(); });
      row.addEventListener('dragover', event => {
        if (!dragKey || dragKey === key) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const rect = row.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        clearDropMarks();
        row.classList.add(after ? 'drop-after' : 'drop-before');
      });
      row.addEventListener('dragleave', event => { if (!row.contains(event.relatedTarget)) row.classList.remove('drop-before', 'drop-after'); });
      row.addEventListener('drop', event => {
        if (!dragKey || dragKey === key) return;
        event.preventDefault();
        const rect = row.getBoundingClientRect();
        clearDropMarks();
        moveStage(dragKey, key, event.clientY > rect.top + rect.height / 2);
      });
      row.querySelector('[data-drag-handle]')?.addEventListener('keydown', event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const index = applicantStageOrder.indexOf(key);
        const target = applicantStageOrder[index + (event.key === 'ArrowUp' ? -1 : 1)];
        if (!target) return;
        moveStage(key, target, event.key === 'ArrowDown');
        modalRoot.querySelector(`[data-stage-row="${key}"] [data-drag-handle]`)?.focus();
      });
    });
    modalRoot.querySelector('#reset-stage-order')?.addEventListener('click', () => {
      applicantStageOrder = [...movableApplicantStageKeys];
      saveApplicantStageOrderPreference();
      renderApplicantBoard();
      openCustomizeStages();
    });
  }

  function renderApplicantBoard() {
    const content = root.querySelector('#applicants-content');
    if (!content) return;
    for (const stage of applicantStages) {
      if (!stage.locked && applicantHasStage(stage.key) && !applicantStagesEnabled[stage.key]) {
        applicantStagesEnabled[stage.key] = true;
        saveApplicantStagesPreference();
      }
    }
    root.querySelector('#customize-stages')?.addEventListener('click', openCustomizeStages);
    const term = applicantSearch.trim().toLowerCase();
    const allGroups = C.groupApplicants(applicants);
    const visible = allGroups.filter(group => !term || group.items.some(applicant => {
      const flow = flows.find(item => item.cloudId === applicant.flow_id) || applicantFlowLabels.find(item => item.cloudId === applicant.flow_id);
      return `${applicant.candidate_name} ${applicant.candidate_email} ${flow?.jobTitle || ''} ${flow?.companyName || ''}`.toLowerCase().includes(term);
    }));
    const filterName = applicantFilter ? applicantFlowLabels.find(flow => flow.cloudId === applicantFilter)?.jobTitle : '';
    if (!applicants.length && !applicantFilter && !term) {
      const published = flows.filter(flow => flow.publicationStatus === 'published' && flow.activePublishedFlowId);
      content.innerHTML = `<section class="applicants-empty"><span class="applicant-empty-icon" aria-hidden="true">${ICONS.applicants}</span><h2>No applicants yet</h2><p>${hasPermission('flows') ? 'Applications for published jobs will appear here as candidates submit them. Review a test application before sharing your job links widely.' : 'Applications will appear here as candidates submit them. Ask a team manager if you need access to the job flows.'}</p>${hasPermission('flows') ? (published.length ? `<button class="btn btn-primary" id="open-published-flow">View published jobs</button>` : `<button class="btn btn-primary" id="open-flows">Go to dashboard</button>`) : ''}</section>`;
      content.querySelector('#open-published-flow')?.addEventListener('click', renderDashboard);
      content.querySelector('#open-flows')?.addEventListener('click', renderDashboard);
      return;
    }
    const stages = visibleApplicantStages();
    const otherStageCount = stages.length - 1;
    const applicationTotal = visible.reduce((total, group) => total + group.count, 0);
    content.innerHTML = `<div class="kanban-summary"><strong>${visible.length}</strong> ${visible.length === 1 ? 'applicant' : 'applicants'}${applicationTotal > visible.length ? ` <span class="kanban-summary-extra">· ${applicationTotal} applications</span>` : ''}${filterName ? ` for <strong>${esc(filterName)}</strong>` : ' across all jobs'}${applicants.length >= 1000 ? ' · Showing the latest 1,000; filter by job to narrow the list.' : ''}</div><section class="kanban-board failed-board${failedColumnOpen ? ' failed-open' : ''}" style="--other-stages:${otherStageCount}" aria-label="Applicant pipeline">${stages.map(stage => {
      const cards = visible.filter(group => group.status === stage.key);
      const cardHtml = group => {
        const applicant = group.latest;
        const repeat = group.count > 1 ? `<span class="repeat-chip" title="This candidate applied ${group.count} times">↻ ${group.count} applications</span>` : '';
        return `<article class="applicant-card" data-applicant="${esc(applicant.id)}" draggable="true" tabindex="0" role="button" aria-label="Review ${esc(applicant.candidate_name)}${group.count > 1 ? `, ${group.count} applications` : ''}"><h3 class="applicant-card-name">${esc(applicant.candidate_name)}</h3><div class="applicant-card-email">${esc(applicant.candidate_email)}</div><div class="applicant-card-meta"><span class="applicant-card-tags"><span class="resume-chip">↧ ${esc((applicant.resume_filename || 'Resume').split('.').pop().toUpperCase())}</span>${repeat}</span><span>${esc(formatApplicantDate(applicant.submitted_at))}</span></div></article>`;
      };
      if (stage.key === 'failed') {
        const head = `<div class="kanban-column-head"><div class="kanban-column-title"><span class="stage-dot ${stage.color}"></span>${stage.label}</div><span class="kanban-count">${cards.length}</span></div>`;
        if (!failedColumnOpen) return `<section class="kanban-column failed-column is-collapsed" data-stage="failed" aria-label="Failed">${head}<button class="btn btn-sm failed-toggle" type="button" data-failed-toggle aria-expanded="false">Open &gt;</button><div class="failed-drop">Drag here</div></section>`;
        const hasFailed = allGroups.some(group => group.status === 'failed');
        return `<section class="kanban-column failed-column is-open" data-stage="failed" aria-label="Failed">${head}<div class="failed-actions"><button class="btn btn-sm failed-toggle" type="button" data-failed-toggle aria-expanded="true">&lt; Collapse</button>${hasFailed ? '<button class="btn btn-sm failed-clear" type="button" data-failed-clear>Clear all failed</button>' : ''}</div><div class="applicant-list">${cards.length ? cards.map(cardHtml).join('') : '<div class="board-empty">No applicants here</div>'}</div></section>`;
      }
      return `<section class="kanban-column" data-stage="${stage.key}" aria-label="${stage.label}"><div class="kanban-column-head"><div class="kanban-column-title"><span class="stage-dot ${stage.color}"></span>${stage.label}</div><span class="kanban-count">${cards.length}</span></div><div class="applicant-list">${cards.length ? cards.map(cardHtml).join('') : '<div class="board-empty">No applicants here</div>'}</div></section>`;
    }).join('')}</section>`;
    content.querySelectorAll('[data-failed-toggle]').forEach(button => button.addEventListener('click', () => { failedColumnOpen = !failedColumnOpen; renderApplicantBoard(); }));
    content.querySelector('[data-failed-clear]')?.addEventListener('click', confirmClearFailedApplicants);
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

  function confirmClearFailedApplicants() {
    const failed = C.groupApplicants(applicants).filter(group => group.status === 'failed');
    if (!failed.length) return;
    const applicationCount = failed.reduce((total, group) => total + group.count, 0);
    const jobCount = new Set(failed.map(group => group.latest.flow_id)).size;
    const filterName = applicantFilter ? applicantFlowLabels.find(flow => flow.cloudId === applicantFilter)?.jobTitle : '';
    const scope = filterName ? `for ${filterName}` : `across ${jobCount} ${jobCount === 1 ? 'job' : 'jobs'}`;
    const noun = failed.length === 1 ? 'failed applicant' : 'failed applicants';
    setModal(`<div class="modal-head"><div><div class="eyebrow" style="margin-bottom:8px">Clear failed applicants</div><h2>Permanently delete ${failed.length} ${noun}?</h2><p>This removes ${applicationCount > failed.length ? `all ${applicationCount} applications and their uploaded resumes` : failed.length === 1 ? 'the application and its resume' : 'their applications and uploaded resumes'} ${esc(scope)}. This can't be undone.</p></div><button class="modal-x" data-close aria-label="Close">×</button></div><div class="modal-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn btn-danger" type="button" id="confirm-clear-failed">Delete ${failed.length} ${noun}</button></div>`);
    const button = modalRoot.querySelector('#confirm-clear-failed');
    button.addEventListener('click', async () => {
      button.disabled = true; button.textContent = 'Deleting…';
      try {
        const result = await window.PathwayBackend.deleteFailedApplicants(applicantFilter);
        applicants = applicants.filter(applicant => applicant.status !== 'failed');
        closeModal(); renderApplicantBoard();
        showToast(result && result.resumesRemoved === false ? 'Failed applicants deleted. Some resume files may need cleanup.' : 'Failed applicants deleted.');
      } catch (error) { button.disabled = false; button.textContent = `Delete ${failed.length} ${noun}`; showToast(`Could not delete failed applicants: ${error.message || 'try again'}`); }
    });
  }

  function formatApplicantDate(value) {
    if (!value) return 'Just now';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Just now' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  }

  async function moveApplicant(id, status) {
    const group = C.groupApplicants(applicants).find(item => item.items.some(member => member.id === id));
    if (!group || group.status === status || !applicantStages.some(stage => stage.key === status)) return;
    // The stage belongs to the candidate: every application from the same address to the same job moves together.
    const members = group.items;
    const previous = members.map(member => member.status);
    members.forEach(member => { member.status = status; });
    renderApplicantBoard();
    let boardOutOfDate = false;
    try {
      const updated = await window.PathwayBackend.updateApplicantStatuses(members.map(member => member.id), status);
      if (updated.length !== members.length) { boardOutOfDate = true; throw new Error('some applications could not be updated'); }
      updated.forEach(row => {
        const member = members.find(item => item.id === row.id);
        if (member) { member.status = row.status; member.updated_at = row.updated_at; }
      });
      renderApplicantBoard();
      const open = modalRoot.querySelector('[data-detail-applicant]');
      if (open && members.some(member => member.id === open.dataset.detailApplicant)) showApplicantDetails(open.dataset.detailApplicant, Number(open.dataset.detailTab) || 0);
      showToast(`Applicant moved to ${applicantStages.find(stage => stage.key === status).label}.`);
    } catch (error) {
      members.forEach((member, index) => { member.status = previous[index]; });
      renderApplicantBoard();
      // The board is not refreshed for the person: they press Refresh when they are ready.
      if (boardOutOfDate) showToast('This candidate was removed or changed by someone else, so the stage was not updated. Press Refresh to update the board.', 7000);
      else showToast(`Could not update applicant stage: ${error.message || 'please retry'}`);
    }
  }

  // Phones (for example Chrome on Android) cannot show a PDF inside a page. There the pages are drawn by pdf.js, which is
  // hosted in this repository (vendor/pdfjs) and loaded only when needed.
  const PDFJS_VERSION = '3.11.174';
  let pdfJsLoading = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfJsLoading) {
      pdfJsLoading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'vendor/pdfjs/pdf.min.js?v=' + PDFJS_VERSION;
        script.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js?v=' + PDFJS_VERSION; resolve(window.pdfjsLib); };
        script.onerror = () => { pdfJsLoading = null; reject(new Error('The PDF viewer could not be loaded.')); };
        document.head.appendChild(script);
      });
    }
    return pdfJsLoading;
  }
  function needsDrawnPdf() {
    return window.matchMedia('(max-width: 760px), (pointer: coarse)').matches || navigator.pdfViewerEnabled === false;
  }
  async function drawPdfPages(container, blob) {
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    const width = Math.max(container.clientWidth - 24, 200);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    container.textContent = '';
    for (let number = 1; number <= Math.min(doc.numPages, 30); number++) {
      if (!container.isConnected || container.hidden) return;
      const page = await doc.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width / base.width) * ratio });
      const canvas = document.createElement('canvas');
      canvas.className = 'applicant-pdf-page';
      canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
      canvas.style.width = width + 'px'; canvas.style.height = Math.floor(viewport.height / ratio) + 'px';
      container.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
  }
  // Open parameters for the browser's own PDF viewer: start without the page-thumbnails column, so it looks the same in every browser. Browsers that do not know them ignore them; the part after # never reaches the server.
  const PDF_VIEWER_PARAMS = '#navpanes=0&pagemode=none';
  // Small explanation next to a value: shown while the mouse is over it, or for 5 seconds after a click / tap; Escape or leaving closes it.
  function bindInfoTooltip(trigger, tip) {
    let hideTimer = null;
    const hide = () => { clearTimeout(hideTimer); tip.hidden = true; };
    trigger.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') tip.hidden = false; });
    trigger.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') hide(); });
    trigger.addEventListener('click', () => { tip.hidden = false; clearTimeout(hideTimer); hideTimer = setTimeout(hide, 5000); });
    trigger.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
    trigger.addEventListener('blur', hide);
  }
  // Who is responsible for each job, as shown (read only) in the applicant panel.
  const flowResponsiblesCache = new Map();
  function flowResponsiblesText(result) {
    if (!result || result.everyone) return 'All team members';
    return (result.people || []).map(person => personLabel(person, result.people) + (person.isOwner ? ' (owner)' : '')).join(', ') || 'All team members';
  }
  // Internal comments on a candidate: who wrote them and when is stored with each one. Add-only.
  const applicantCommentsCache = new Map();
  const commentTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const canDeleteComment = comment => Boolean(isOwner || (comment.authorId && user && comment.authorId === user.id));
  function commentBodyHtml(comment) {
    let html = esc(comment.body);
    // Longer names first, so "@Ana Souza" wins over "@Ana".
    [...(comment.mentions || [])].filter(item => item.name).sort((a, b) => b.name.length - a.name.length).forEach(item => {
      html = html.split('@' + esc(item.name)).join('<span class="comment-mention">@' + esc(item.name) + '</span>');
    });
    return html;
  }
  function commentHtml(comment) {
    return '<article class="comment" data-comment-id="' + esc(comment.id) + '"><p class="comment-meta">' + esc(comment.authorName) + ' · <time datetime="' + esc(comment.createdAt) + '">' + esc(commentTimeFormat.format(new Date(comment.createdAt))) + '</time>' + (canDeleteComment(comment) ? ' · <button type="button" class="comment-delete" data-delete-comment="' + esc(comment.id) + '">Delete</button>' : '') + '</p><p class="comment-body">' + commentBodyHtml(comment) + '</p></article>';
  }
  function mountApplicantComments(host, flowId, email) {
    const list = host.querySelector('#applicant-comment-list'), form = host.querySelector('#applicant-comment-form');
    const input = host.querySelector('#applicant-comment-input'), status = host.querySelector('#applicant-comment-status'), submit = host.querySelector('#applicant-comment-submit');
    const heading = host.querySelector('#applicant-comments-heading');
    if (!list || !form) return;
    // Opening a candidate counts as reading the mentions of this person on it.
    const mentionKey = String(email || '').trim().toLowerCase();
    if (mentionNotifs.some(item => item.flowId === flowId && item.candidateEmail === mentionKey)) { mentionNotifs = mentionNotifs.filter(item => !(item.flowId === flowId && item.candidateEmail === mentionKey)); paintNotifications(); }
    window.PathwayBackend.markCommentMentionsSeen(flowId, email).catch(() => {});
    // @mentions: typing "@" opens a list of teammates who can open applicants; the chosen name is written after the "@".
    const mentionMenu = host.querySelector('#applicant-mention-menu');
    const chosen = new Map();
    let mentionPeople = [], mentionMatches = [], mentionActive = 0, mentionStart = -1;
    window.PathwayBackend.listTeamOverview(workspace.id)
      .then(rows => { mentionPeople = rows.filter(row => (row.isOwner || row.can_applicants) && row.userId !== user.id).map(row => ({ userId: row.userId, name: personName(row) || row.email, email: row.email })); })
      .catch(() => { /* without the team list the "@" menu simply stays closed */ });
    const closeMentionMenu = () => { mentionMenu.hidden = true; mentionMatches = []; mentionStart = -1; };
    const paintMentionMenu = () => {
      mentionMenu.innerHTML = mentionMatches.map((person, index) => '<button type="button" role="option" class="mention-option' + (index === mentionActive ? ' is-active' : '') + '" aria-selected="' + (index === mentionActive) + '" data-mention-index="' + index + '"><span>' + esc(person.name) + '</span>' + (person.name !== person.email ? '<small>' + esc(person.email) + '</small>' : '') + '</button>').join('');
      mentionMenu.hidden = !mentionMatches.length;
    };
    const updateMentionMenu = () => {
      const before = input.value.slice(0, input.selectionStart);
      const found = /(^|\s)@([^\s@]*)$/.exec(before);
      if (!found) { closeMentionMenu(); return; }
      const query = found[2].toLowerCase();
      mentionStart = before.length - found[2].length - 1;
      mentionMatches = mentionPeople.filter(person => !query || person.name.toLowerCase().includes(query) || person.email.toLowerCase().includes(query)).slice(0, 6);
      mentionActive = 0;
      paintMentionMenu();
    };
    const pickMention = index => {
      const person = mentionMatches[index];
      if (!person || mentionStart < 0) return;
      const after = input.value.slice(input.selectionStart);
      const text = input.value.slice(0, mentionStart) + '@' + person.name + ' ';
      input.value = text + after;
      input.setSelectionRange(text.length, text.length);
      chosen.set(person.userId, person.name);
      closeMentionMenu();
      input.focus();
    };
    input.addEventListener('input', updateMentionMenu);
    input.addEventListener('click', updateMentionMenu);
    input.addEventListener('blur', () => setTimeout(closeMentionMenu, 150));
    mentionMenu.addEventListener('pointerdown', event => event.preventDefault());
    mentionMenu.addEventListener('click', event => { const option = event.target.closest('[data-mention-index]'); if (option) pickMention(Number(option.dataset.mentionIndex)); });
    input.addEventListener('keydown', event => {
      if (mentionMenu.hidden || !mentionMatches.length) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); mentionActive = (mentionActive + 1) % mentionMatches.length; paintMentionMenu(); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); mentionActive = (mentionActive - 1 + mentionMatches.length) % mentionMatches.length; paintMentionMenu(); }
      else if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); event.stopImmediatePropagation(); pickMention(mentionActive); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMentionMenu(); }
    }, true);
    const key = flowId + '|' + String(email || '').trim().toLowerCase();
    const paint = comments => {
      heading.textContent = comments.length ? 'Team comments · ' + comments.length : 'Team comments';
      list.innerHTML = comments.length ? comments.map(commentHtml).join('') : '<p class="comment-empty">No comments yet.</p>';
    };
    if (applicantCommentsCache.has(key)) paint(applicantCommentsCache.get(key));
    window.PathwayBackend.listApplicantComments(flowId, email)
      .then(comments => { applicantCommentsCache.set(key, comments); if (list.isConnected) paint(comments); })
      .catch(() => { if (list.isConnected && !applicantCommentsCache.has(key)) list.innerHTML = '<p class="comment-empty is-error">Comments could not be loaded. Refresh the page and try again.</p>'; });
    const send = async () => {
      status.className = 'comment-status'; status.textContent = '';
      if (!input.value.trim()) { status.className = 'comment-status is-error'; status.textContent = 'Write a comment first.'; return; }
      submit.disabled = true;
      try {
        const mentionedIds = [...chosen].filter(([, name]) => input.value.includes('@' + name)).map(([id]) => id);
        const comment = await window.PathwayBackend.addApplicantComment(flowId, email, input.value, mentionedIds);
        chosen.clear();
        const comments = [...(applicantCommentsCache.get(key) || []), comment];
        applicantCommentsCache.set(key, comments);
        input.value = '';
        if (list.isConnected) { paint(comments); list.lastElementChild?.scrollIntoView({ block: 'nearest' }); }
      } catch (error) {
        status.className = 'comment-status is-error'; status.textContent = error.message || 'Could not add the comment. Please try again.';
      } finally { submit.disabled = false; }
    };
    // Deleting asks for a second click right on the comment (the candidate panel is already a dialog).
    list.addEventListener('click', async event => {
      const askButton = event.target.closest('[data-delete-comment]');
      const confirmButton = event.target.closest('[data-confirm-delete-comment]');
      const cancelButton = event.target.closest('[data-cancel-delete-comment]');
      if (askButton) {
        askButton.outerHTML = '<span class="comment-delete-confirm">Delete? <button type="button" class="comment-delete is-danger" data-confirm-delete-comment="' + esc(askButton.dataset.deleteComment) + '">Yes</button> <button type="button" class="comment-delete" data-cancel-delete-comment>Cancel</button></span>';
      } else if (cancelButton) {
        paint(applicantCommentsCache.get(key) || []);
      } else if (confirmButton) {
        confirmButton.disabled = true;
        try {
          await window.PathwayBackend.deleteApplicantComment(confirmButton.dataset.confirmDeleteComment);
          const comments = (applicantCommentsCache.get(key) || []).filter(item => item.id !== confirmButton.dataset.confirmDeleteComment);
          applicantCommentsCache.set(key, comments);
          if (list.isConnected) paint(comments);
        } catch (error) {
          confirmButton.disabled = false;
          status.className = 'comment-status is-error'; status.textContent = 'Could not delete the comment. Refresh the page and try again.';
        }
      }
    });
    form.addEventListener('submit', event => { event.preventDefault(); void send(); });
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } });
  }
  // The candidate's data tools: export everything about them (CSV), or delete them for good (needs a second click).
  function mountCandidateDeletion(host, flowId, person, group, jobTitle) {
    const row = host.querySelector('#applicant-delete-row');
    if (!row) return;
    const applicationCount = group.count;
    const email = String(person.candidate_email || '').trim().toLowerCase();
    const showButtons = () => {
      row.innerHTML = '<div class="applicant-row-actions"><button type="button" class="applicant-export-link" id="export-candidate">Export data</button><button type="button" class="applicant-delete-link" id="delete-candidate">Delete candidate</button></div>';
      row.querySelector('#delete-candidate').addEventListener('click', showConfirm);
      row.querySelector('#export-candidate').addEventListener('click', async event => {
        const button = event.currentTarget;
        if (button.disabled) return;
        button.disabled = true; button.textContent = 'Preparing…';
        try {
          const csv = candidateDataToCsv({ person, items: group.items, jobTitle, stage: group.status, exportedAt: new Date().toISOString() });
          downloadTextFile('pathway-candidate-data-' + new Date().toISOString().slice(0, 10) + '.csv', csv);
          showToast('Candidate data downloaded.');
        } catch (error) {
          showToast('Could not prepare the candidate data. Please try again.');
        } finally { button.disabled = false; button.textContent = 'Export data'; }
      });
    };
    const showConfirm = () => {
      row.innerHTML = '<div class="applicant-delete-confirm" role="alertdialog" aria-label="Delete this candidate"><p><strong>Delete ' + esc(person.candidate_name) + ' permanently?</strong> This removes ' + (applicationCount > 1 ? 'all ' + applicationCount + ' of their applications' : 'their application') + ', the resume file and the team comments about them. This cannot be undone.</p><div class="applicant-delete-actions"><button type="button" class="btn btn-sm btn-danger" id="confirm-delete-candidate">Yes, delete</button><button type="button" class="btn btn-sm" id="cancel-delete-candidate">Cancel</button><span class="applicant-delete-status" id="delete-candidate-status" role="status" aria-live="polite"></span></div></div>';
      row.querySelector('#cancel-delete-candidate').addEventListener('click', showButtons);
      row.querySelector('#confirm-delete-candidate').addEventListener('click', async event => {
        const button = event.currentTarget, status = row.querySelector('#delete-candidate-status');
        button.disabled = true; row.querySelector('#cancel-delete-candidate').disabled = true; status.textContent = 'Deleting…';
        try {
          await window.PathwayBackend.deleteCandidate(flowId, email);
          applicants = applicants.filter(item => !(item.flow_id === flowId && String(item.candidate_email || '').trim().toLowerCase() === email));
          applicantCommentsCache.delete(flowId + '|' + email);
          closeModal(); renderApplicantBoard(); showToast('Candidate deleted.');
        } catch (error) {
          status.textContent = error.message || 'Could not delete the candidate. Please try again.';
          button.disabled = false; row.querySelector('#cancel-delete-candidate').disabled = false;
        }
      });
    };
    showButtons();
  }
  function showApplicantDetails(id, tabIndex = 0) {
    const group = C.groupApplicants(applicants).find(item => item.items.some(member => member.id === id));
    if (!group) return;
    const tab = Math.min(Math.max(Number(tabIndex) || 0, 0), group.count - 1);
    const applicant = group.items[tab];
    const person = group.latest;
    const tabLabel = (member, index) => `${index === 0 ? 'Latest · ' : ''}${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(member.submitted_at))}`;
    const tabs = group.count > 1
      ? `<div class="applicant-tabs" role="tablist" aria-label="Applications from this candidate">${group.items.map((member, index) => `<button class="applicant-tab" type="button" role="tab" aria-selected="${index === tab}" data-tab="${index}">${esc(tabLabel(member, index))}</button>`).join('')}</div>`
      : '';
    const flow = flows.find(item => item.cloudId === applicant.flow_id) || applicantFlowLabels.find(item => item.cloudId === applicant.flow_id);
    const applicantSubtitle = [flow?.companyName ? `applying for ${flow.companyName}` : '', group.count > 1 ? `Applied ${group.count} times` : ''].filter(Boolean).join(' · ');
    const detailFields = Object.entries(applicant.candidate_info || {}).filter(([, value]) => value !== null && value !== '' && value !== undefined);
    const answers = Array.isArray(applicant.responses) ? applicant.responses : [];
    const isPdf = applicant.resume_content_type === 'application/pdf';
    const filename = applicant.resume_filename || 'resume';
    // Why the system moved this candidate to Failed (only while the candidate is still in Failed).
    const autoFailReason = group.status === 'failed' ? (group.items.find(item => item.auto_fail_reason) || {}).auto_fail_reason || '' : '';
    const statusOptions = visibleApplicantStages().map(stage => `<option value="${stage.key}" ${group.status === stage.key ? 'selected' : ''}>${stage.label}</option>`).join('');

    setModal(`<div class="applicant-review-layout" data-detail-applicant="${esc(person.id)}" data-detail-tab="${tab}">
      <section class="applicant-review-left" aria-label="Applicant details">
        <header class="modal-head applicant-detail-head">
          <div class="applicant-detail-title"><div class="applicant-avatar" aria-hidden="true">${esc(initials(person.candidate_name))}</div><div><div class="eyebrow" style="margin-bottom:5px">${esc(flow?.jobTitle || 'Application')}</div><h2>${esc(person.candidate_name)}</h2>${applicantSubtitle ? `<div class="muted">${esc(applicantSubtitle)}</div>` : ''}</div></div>
          <button class="modal-x" data-close aria-label="Close applicant details">×</button>
        </header>
        ${tabs}
        <div class="applicant-review-content">
          <section class="applicant-detail-section applicant-detail-actions-section"><div class="applicant-detail-actions">
            <label class="applicant-info-item"><span>Hiring stage</span><select class="applicant-status-select" id="applicant-status-select">${statusOptions}</select>${group.count > 1 ? `<small class="applicant-stage-note">Applies to all ${group.count} applications</small>` : ''}</label>${autoFailReason ? `<p class="applicant-autofail-note"><strong>Moved to Failed automatically:</strong> ${esc(autoFailReason)}</p>` : ''}
          </div></section>
          <section class="applicant-detail-section"><h3>Candidate details</h3><div class="applicant-info-grid"><div class="applicant-info-item"><span>Full name</span><strong>${esc(applicant.candidate_name)}</strong></div><div class="applicant-info-item"><span>Email address</span><a href="mailto:${esc(applicant.candidate_email)}">${esc(applicant.candidate_email)}</a></div>${detailFields.map(([key, value]) => `<div class="applicant-info-item"><span>${esc(C.OPTIONAL_FIELDS.find(field => field.key === key)?.label || key)}</span><strong>${esc(value)}</strong></div>`).join('')}</div></section>
          <section class="applicant-detail-section"><h3>Application answers · ${answers.length}</h3>${answers.length ? answers.map((answer, index) => `<div class="applicant-answer"><strong>${index + 1}. ${esc(answer.question || 'Application question')}</strong><p>${esc(Array.isArray(answer.answer) ? answer.answer.join(', ') : answer.answer)}</p></div>`).join('') : '<div class="board-empty">No written answers were submitted for this flow.</div>'}</section>
          <section class="applicant-detail-section"><h3>Application record</h3><div class="applicant-info-grid"><div class="applicant-info-item"><span>Submitted</span><strong>${esc(new Date(applicant.submitted_at).toLocaleString())}</strong></div><div class="applicant-info-item"><span>Privacy notice</span><strong>${esc(applicant.privacy_notice_version || 'Recorded')}</strong></div><div class="applicant-info-item applicant-responsible-item"><span>Responsible</span><button type="button" class="applicant-responsible-trigger" id="applicant-responsible" aria-describedby="applicant-responsible-tip">${esc(flowResponsiblesCache.has(applicant.flow_id) ? flowResponsiblesText(flowResponsiblesCache.get(applicant.flow_id)) : 'Loading…')}</button><div class="applicant-tooltip" id="applicant-responsible-tip" role="tooltip" hidden>These are the people responsible for this job. To change them, edit the job details.</div></div></div></section>
          <section class="applicant-detail-section applicant-comments" aria-labelledby="applicant-comments-heading"><h3 id="applicant-comments-heading">Team comments</h3><div class="comment-list" id="applicant-comment-list" aria-live="polite"><p class="comment-empty">Loading comments…</p></div><form class="comment-form" id="applicant-comment-form" novalidate><label class="visually-hidden" for="applicant-comment-input">Add a comment</label><textarea class="text-area" id="applicant-comment-input" maxlength="2000" rows="3" placeholder="Write a comment for your team… Type @ to mention someone."></textarea><div class="mention-menu" id="applicant-mention-menu" role="listbox" aria-label="Mention a teammate" hidden></div><div class="comment-form-actions"><span class="comment-status" id="applicant-comment-status" role="status" aria-live="polite"></span><button class="btn btn-primary btn-sm" type="submit" id="applicant-comment-submit">Add comment</button></div></form></section>
          <section class="applicant-delete-row" id="applicant-delete-row"></section>
        </div>
        <div class="applicant-mobile-bar">${isPdf ? '<button class="btn" id="mobile-preview-resume" type="button">▧ &nbsp;Preview resume</button>' : ''}<button class="btn js-download-resume" type="button">↓ &nbsp;Download resume</button></div>
      </section>
      <aside class="applicant-review-right" aria-label="Resume preview">
        <div class="applicant-preview-empty" id="applicant-preview-empty"><span class="applicant-preview-icon">▧</span><h3>${isPdf ? 'Resume preview' : 'Preview unavailable'}</h3>${isPdf ? '<button class="btn applicant-resume-button" id="preview-applicant-resume" type="button">▧ &nbsp;Preview resume</button>' : '<p>This file type cannot be previewed in the browser. Download the resume to open it.</p><button class="btn applicant-resume-button js-download-resume" type="button">↓ &nbsp;Download resume</button>'}</div>
        <section class="applicant-resume-preview is-hidden" id="applicant-resume-preview" aria-label="PDF resume preview">
          <div class="applicant-resume-preview-head"><div><span class="eyebrow">Private document</span><strong title="${esc(filename)}">${esc(filename)}</strong></div><div class="applicant-resume-preview-actions"><button class="btn btn-sm js-download-resume" type="button">↓ &nbsp;Download resume</button><button class="btn btn-sm" id="close-applicant-resume-preview" type="button">Close preview</button></div></div>
          <iframe id="applicant-resume-frame" title="PDF preview of ${esc(filename)}" loading="lazy" referrerpolicy="no-referrer"></iframe>
          <div class="applicant-pdf-pages" id="applicant-pdf-pages" role="document" aria-label="PDF preview of ${esc(filename)}" hidden></div>
        </section>
      </aside>
    </div>`);

    mountApplicantComments(modalRoot, applicant.flow_id, person.candidate_email);
    mountCandidateDeletion(modalRoot, applicant.flow_id, person, group, flow?.jobTitle || '');
    const responsibleNode = modalRoot.querySelector('#applicant-responsible');
    if (responsibleNode) bindInfoTooltip(responsibleNode, modalRoot.querySelector('#applicant-responsible-tip'));
    if (responsibleNode && !flowResponsiblesCache.has(applicant.flow_id)) {
      window.PathwayBackend.getFlowResponsibles(applicant.flow_id)
        .then(result => { flowResponsiblesCache.set(applicant.flow_id, result); if (responsibleNode.isConnected) responsibleNode.textContent = flowResponsiblesText(result); })
        .catch(() => { responsibleNode.closest('.applicant-responsible-item')?.remove(); });
    }
    modalRoot.querySelector('#applicant-status-select').addEventListener('change', event => { void moveApplicant(applicant.id, event.target.value); });
    modalRoot.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => showApplicantDetails(person.id, Number(button.dataset.tab))));
    const previewButton = modalRoot.querySelector('#preview-applicant-resume');
    const previewPanel = modalRoot.querySelector('#applicant-resume-preview');
    const previewFrame = modalRoot.querySelector('#applicant-resume-frame');
    const pdfPages = modalRoot.querySelector('#applicant-pdf-pages');
    const previewPlaceholder = modalRoot.querySelector('#applicant-preview-empty');
    const reviewLayout = modalRoot.querySelector('.applicant-review-layout');
    const mobilePreviewButton = modalRoot.querySelector('#mobile-preview-resume');
    const phoneLayout = window.matchMedia('(max-width: 760px)').matches;
    const closePreview = () => {
      previewPanel.classList.add('is-hidden');
      previewPlaceholder.classList.remove('is-hidden');
      reviewLayout.classList.remove('is-previewing');
      previewFrame.removeAttribute('src');
      pdfPages.hidden = true; pdfPages.textContent = '';
    };
    const loadPreview = async (trigger = previewButton) => {
      if (!trigger || !previewPanel.classList.contains('is-hidden')) return;
      trigger.disabled = true; trigger.textContent = 'Preparing preview…';
      try {
        if (needsDrawnPdf()) {
          const blob = await window.PathwayBackend.downloadApplicantResume(applicant.resume_path);
          previewFrame.hidden = true; pdfPages.hidden = false; pdfPages.textContent = 'Loading the resume…';
          previewPlaceholder.classList.add('is-hidden');
          previewPanel.classList.remove('is-hidden');
          reviewLayout.classList.add('is-previewing');
          try { await drawPdfPages(pdfPages, blob); }
          catch (drawError) { pdfPages.textContent = 'This resume could not be displayed here. Use Download resume to open it.'; }
        } else {
          const url = await window.PathwayBackend.getApplicantResumeUrl(applicant.resume_path);
          previewFrame.hidden = false; pdfPages.hidden = true;
          previewFrame.src = url.split('#')[0] + PDF_VIEWER_PARAMS;
          previewPlaceholder.classList.add('is-hidden');
          previewPanel.classList.remove('is-hidden');
          reviewLayout.classList.add('is-previewing');
        }
      } catch (error) { showToast(`Could not preview resume: ${error.message || 'please retry'}`); }
      finally { if (trigger.isConnected) { trigger.disabled = false; trigger.innerHTML = '▧ &nbsp;Preview resume'; } }
    };
    previewButton?.addEventListener('click', () => { void loadPreview(previewButton); });
    mobilePreviewButton?.addEventListener('click', () => { void loadPreview(mobilePreviewButton); });
    if (previewButton && !phoneLayout) void loadPreview(previewButton);
    modalRoot.querySelector('#close-applicant-resume-preview')?.addEventListener('click', closePreview);
    modalRoot.querySelectorAll('.js-download-resume').forEach(downloadButton => downloadButton.addEventListener('click', async event => {
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
    }));
  }
  async function doSignOut() {
    try { await window.PathwayBackend.signOut(); flows = []; companies = []; applicants = []; workspace = null; user = null; setRoute('login'); window.PathwayAuth.renderAuth(); }
    catch (error) { showToast(`Could not sign out: ${error.message || 'please retry'}`); }
  }

  function showNewFlow() {
    root.querySelector('.app-shell')?.classList.add('is-creating-flow');
    setModal(`<div class="modal-head"><div><div class="eyebrow" style="margin-bottom:8px">Start with the role</div><h2>Create a new application flow</h2><p>Give candidates a clear picture of the opportunity before they apply.</p></div><button class="modal-x" data-close aria-label="Close">×</button></div><form id="new-flow-form">${companies.length ? `<div class="field-group"><label for="new-company-id">Company</label><select class="select-input" id="new-company-id" name="companyId">${companyOptionsHtml()}</select></div>` : `<p class="field-help">This job will use your workspace name: ${esc(workspace.name)}. Add a company profile from My Companies to choose another.</p>`}<div class="field-group"><label for="new-title">Job title</label><input class="text-input" id="new-title" name="jobTitle" placeholder="e.g. Senior Product Designer" required></div><div class="field-group"><label for="new-description">Job description</label><textarea class="text-area" id="new-description" name="jobDescription" placeholder="A short, welcoming overview of the role and the team…" required></textarea></div><div class="field-group"><span class="form-label" id="new-responsible-label">Responsible</span><div id="new-responsible"></div></div><div class="modal-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Create flow</button></div></form>`);
    let newResponsible = [];
    mountResponsibleField(modalRoot.querySelector('#new-responsible'), 'new-responsible-label', () => newResponsible, ids => { newResponsible = ids; });
    modalRoot.querySelector('#new-flow-form').addEventListener('submit', event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      const company = companies.find(item => item.id === data.get('companyId')) || null;
      const flow = C.createFlow(company?.name || workspace.name, data.get('jobTitle').trim(), data.get('jobDescription').trim());
      flow.companyId = company?.id || null; flow.companyProfile = companySnapshot(company);
      flow.responsibleIds = currentResponsibleIds(newResponsible);
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
    if (!hasPermission('flows')) return renderAccessMessage('flows');
    currentId = id; selectedId = currentFlow().nodes.find(node => node.type === 'candidateInfo').id; renderEditor();
  }

  function renderEditor() {
    const flow = currentFlow(); if (!flow) return renderDashboard();
    if (flow.cloudId) setRoute(`flow=${flow.cloudId}`);
    root.innerHTML = `<div class="app-shell"><header class="topbar"><a class="brand" href="#" id="brand-home"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="top-actions">${renderPlanControl()}<span class="workspace-name">${esc(workspace.name)}</span>${headerUserHtml()}<button class="btn btn-sm" id="signout">Sign out</button></div></header><div class="workspace-body"><main class="editor-main"><div class="editor-top"><div class="crumbs"><button class="crumb-link" id="dashboard-back">My flows</button><span class="crumb-chevron">/</span><span class="crumb-title">${esc(flow.jobTitle)}</span></div><div class="editor-actions"><span class="save-indicator"><span class="status-dot"></span>${flow.cloudId ? 'Saved to workspace' : 'Not saved yet'}</span><button class="btn" id="preview-btn">▷ &nbsp;Preview as candidate</button>${flow.publicationStatus === 'published' && flow.activePublishedFlowId ? '<button class="btn" id="copy-job-url">Copy job link</button>' : ''}<button class="btn ${flow.publicationStatus === 'published' || !subscription?.active ? '' : 'btn-primary'}" id="publish-btn">${flow.publicationStatus === 'published' ? 'Unpublish' : subscription?.active ? 'Publish' : 'Upgrade to publish'} &nbsp;${flow.publicationStatus === 'published' ? '↘' : '↗'}</button></div></div><div class="editor-layout"><section class="workspace" id="workspace"><div class="canvas-toolbar"><div class="canvas-label">Application journey <span class="canvas-hint"> · Drag background to pan, nodes to arrange, ports to connect</span></div><span></span></div><div class="canvas-stage" id="canvas-stage"><svg class="wires" id="wires" aria-label="Flow connections"></svg><div id="nodes-layer"></div></div></section><aside class="inspector" id="inspector"></aside></div><button class="btn btn-primary canvas-add" id="add-node">＋ &nbsp;Add a step</button><div class="canvas-status" id="canvas-status"></div></main></div></div>`;
    bindPlanControl();
    root.querySelector('.save-indicator')?.insertAdjacentHTML('afterend', '<div id="publish-changes-slot"></div>');
    updatePublicationNotice();
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
          return `<div class="node-option">${esc(port.label || 'Option')}${node.type === 'singleChoice' && (node.autoFailOptions || []).includes(port.optionValue) ? '<span class="node-autofail" title="Auto-fail">Auto-fail</span>' : ''}<span class="node-detail" style="margin-left:auto;margin-right:5px;font-size:8px">${target ? esc(target.label.slice(0, 16)) : 'Connect'}</span><span class="port" data-from="${esc(node.id)}" data-option="${esc(port.optionValue)}" title="Drag to branch: ${esc(port.label)}"></span></div>`;
        }).join('')}</div>${node.type === 'multiChoice' && (node.autoFailOptions || []).length ? `<div class="node-detail">${node.autoFailOptions.length} auto-fail ${node.autoFailOptions.length === 1 ? 'option' : 'options'}</div>` : ''}`;
      } else if (node.type === 'end') {
        detail = `<div class="node-detail">${node.subtype === 'disqualified' ? 'Polite disqualification' : 'Application confirmation'}</div>`;
      } else {
        const edge = flow.edges.find(item => item.fromNodeId === node.id); const target = edge && flow.nodes.find(item => item.id === edge.toNodeId);
        detail = `<div class="node-detail">${node.type === 'shortText' ? (node.numericOnly ? 'Number response' + (Number.isInteger(node.autoFailBelow) ? ' · auto-fail below ' + node.autoFailBelow : '') : 'Open-ended response') : `${(node.options || []).length} choices`}${target ? ` · → ${esc(target.label.slice(0, 19))}` : ' · Not connected'}</div>`;
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
    const roleSettings = selected.type === 'candidateInfo'
      ? `<div class="inspector-title"><div><div class="inspector-kicker">Flow settings</div><h2>Job details</h2></div><button class="icon-btn" id="edit-role" aria-label="Edit role details">✎</button></div><div class="field-group"><label for="role-company-profile">Company</label><select class="select-input" id="role-company-profile">${companyOptionsHtml(flow.companyId || '')}</select></div><div class="field-group"><label for="role-title">Job title</label><input class="text-input" id="role-title" value="${esc(flow.jobTitle)}"></div><div class="field-group"><label for="role-description">Job description</label><textarea class="text-area" id="role-description">${esc(flow.jobDescription)}</textarea></div><div class="field-group"><span class="form-label" id="role-responsible-label">Responsible</span><div id="role-responsible"></div></div><hr class="inspector-divider">`
      : '';
    panel.innerHTML = `${roleSettings}<div class="inspector-title"><div><div class="inspector-kicker">Selected step</div><h2>${esc(title)}</h2></div>${selected.type === 'candidateInfo' ? '<span class="node-badge">Fixed start</span>' : ''}</div><div id="node-editor"></div>`;
    const syncRole = (key, value) => { flow[key] = value; const crumb = document.querySelector('.crumb-title'); if (crumb && key === 'jobTitle') crumb.textContent = value || 'Untitled role'; save(); };
    panel.querySelector('#role-company-profile')?.addEventListener('change', event => { const company = companies.find(item => item.id === event.target.value) || null; flow.companyId = company?.id || null; flow.companyProfile = companySnapshot(company); flow.companyName = company?.name || workspace.name; save(); });
    panel.querySelector('#role-title')?.addEventListener('input', event => syncRole('jobTitle', event.target.value));
    panel.querySelector('#role-description')?.addEventListener('input', event => syncRole('jobDescription', event.target.value));
    const responsibleHost = panel.querySelector('#role-responsible');
    if (responsibleHost) mountResponsibleField(responsibleHost, 'role-responsible-label', () => flow.responsibleIds || [], ids => { flow.responsibleIds = ids; save({ internal: true }); });
    panel.querySelector('#edit-role')?.addEventListener('click', () => { panel.querySelector('#role-title')?.focus(); });
    const editor = panel.querySelector('#node-editor');
    if (selected.type === 'candidateInfo') {
      editor.innerHTML = `<div class="inspector-note">This is the fixed first step. Name, email, and resume are always included. Choose any extra details that make sense for this role.</div><div class="section-small">Always included</div>${[['name', 'Full name'], ['email', 'Email address'], ['resume', 'Resume link']].map(([key, label]) => `<label class="locked-field"><input type="checkbox" class="check" checked disabled><span>${label}</span><small>Required</small></label>`).join('')}<div class="section-small">Optional details</div>${C.OPTIONAL_FIELDS.map(field => `<label class="toggle-field"><span>${esc(field.label)}</span><input type="checkbox" class="check optional-field" data-field="${esc(field.key)}" ${flow.candidateInfoFields[field.key] ? 'checked' : ''}></label>`).join('')}<p class="connection-help">The selected details appear directly on the public job application page.</p>`;
      editor.querySelectorAll('.optional-field').forEach(input => input.addEventListener('change', event => { flow.candidateInfoFields[event.target.dataset.field] = event.target.checked; save(); drawCanvas(); }));
    } else if (selected.type === 'end') {
      editor.innerHTML = `<div class="field-group"><label for="node-label">Candidate-facing completion title</label><input class="text-input" id="node-label" value="${esc(selected.label)}"></div><div class="field-group"><label for="end-subtype">Result</label><select class="select-input end-select" id="end-subtype"><option value="submitted" ${selected.subtype !== 'disqualified' ? 'selected' : ''}>Application received</option><option value="disqualified" ${selected.subtype === 'disqualified' ? 'selected' : ''}>Not a match this time</option></select></div><div class="inspector-note">This ending appears only to candidates who reach this step. You can create more than one ending.</div><button class="btn btn-sm btn-danger" id="remove-step" style="margin-top:14px">Delete end step</button>`;
      editor.querySelector('#node-label').addEventListener('input', event => { selected.label = event.target.value; save(); updateNodeLabel(selected); });
      editor.querySelector('#end-subtype').addEventListener('change', event => { selected.subtype = event.target.value; save(); drawCanvas(); });
      editor.querySelector('#remove-step').addEventListener('click', () => deleteNode(selected.id));
    } else {
      editor.innerHTML = `<div class="field-group"><label for="node-label">Question</label><textarea class="text-area" id="node-label" style="min-height:76px">${esc(selected.label)}</textarea></div>${selected.type === 'shortText' ? `<label class="numeric-only-toggle"><span>Numbers only</span><span class="numeric-only-switch"><input id="numeric-only" type="checkbox" role="switch" ${selected.numericOnly ? 'checked' : ''}><span class="numeric-only-track" aria-hidden="true"></span></span></label>` : ''}${selected.type === 'singleChoice' || selected.type === 'multiChoice' ? `<div class="section-small">Answer options</div><div id="options-editor">${selected.options.map((option, index) => `<div class="option-edit has-autofail"><input class="text-input option-value" data-index="${index}" value="${esc(option)}" aria-label="Answer option ${index + 1}"><label class="option-autofail" title="Candidates who give this answer still finish the questions, then land in Failed."><input type="checkbox" class="check option-autofail-check" data-index="${index}" ${(selected.autoFailOptions || []).includes(option) ? 'checked' : ''}><span>Auto-fail</span></label><button class="icon-btn delete-option" data-index="${index}" aria-label="Remove option">×</button></div>`).join('')}</div><button class="add-option" id="add-option">＋ Add an option</button><p class="connection-help autofail-help">Auto-fail: candidates who give that answer still finish all the questions, then land in Failed. The option does not need to connect to an ending.</p>` : ''}${selected.type === 'shortText' && selected.numericOnly ? `<div class="field-group autofail-below"><label for="autofail-below">Auto-fail if below</label><input class="text-input" id="autofail-below" type="number" inputmode="numeric" min="0" step="1" placeholder="e.g. 4" value="${selected.autoFailBelow ?? ''}"><p class="connection-help">Candidates who enter a smaller number still finish the questions, then land in Failed.</p></div>` : ''}<div class="inspector-note">${selected.type === 'singleChoice' ? 'Each option needs its own connection. Drag a port from an answer row to the step that should follow it.' : selected.type === 'multiChoice' ? 'Candidates can select multiple answers. Connect this question to one next step.' : selected.numericOnly ? 'Candidates must enter a number. Connect this question to its next step.' : 'Candidates can enter a free-text answer. Connect this question to its next step.'}</div><button class="btn btn-sm btn-danger" id="remove-step" style="margin-top:14px">Delete step</button>`;
      editor.querySelector('#node-label').addEventListener('input', event => { selected.label = event.target.value; save(); updateNodeLabel(selected); });
      const numericToggle = editor.querySelector('#numeric-only');
      numericToggle?.addEventListener('change', event => { selected.numericOnly = event.target.checked; if (!selected.numericOnly) delete selected.autoFailBelow; save(); drawCanvas(); drawInspector(); });
      editor.querySelector('#autofail-below')?.addEventListener('input', event => {
        const raw = event.target.value.trim(), value = Math.floor(Number(raw));
        if (raw === '' || !Number.isFinite(value) || value < 0) delete selected.autoFailBelow; else selected.autoFailBelow = value;
        save(); drawCanvas();
      });
      editor.querySelectorAll('.option-autofail-check').forEach(box => box.addEventListener('change', event => {
        const option = selected.options[Number(event.target.dataset.index)];
        const flagged = new Set(selected.autoFailOptions || []);
        if (event.target.checked) flagged.add(option); else flagged.delete(option);
        if (flagged.size) selected.autoFailOptions = [...flagged]; else delete selected.autoFailOptions;
        save(); drawCanvas();
      }));
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
    if (Array.isArray(node.autoFailOptions)) node.autoFailOptions = node.autoFailOptions.map(option => option === old ? value : option);
    currentFlow().edges.forEach(edge => { if (edge.fromNodeId === node.id && edge.optionValue === old) edge.optionValue = value; });
    save(); drawCanvas(); drawInspector();
  }
  function removeOption(node, index) {
    if (node.options.length <= 2) { showToast('Keep at least two answer options.'); return; }
    const [removed] = node.options.splice(index, 1);
    if (Array.isArray(node.autoFailOptions)) { node.autoFailOptions = node.autoFailOptions.filter(option => option !== removed); if (!node.autoFailOptions.length) delete node.autoFailOptions; }
    currentFlow().edges = currentFlow().edges.filter(edge => !(edge.fromNodeId === node.id && edge.optionValue === removed)); save(); drawCanvas(); drawInspector();
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
    setModal(`<div class="modal-head"><div><div class="eyebrow" style="margin-bottom:8px">Published snapshot</div><h2>Your job page is ready to share.</h2><p>Candidates see the currently published version. Use Publish changes to update this same job link after editing.</p></div><button class="modal-x" data-close aria-label="Close">×</button></div><div class="publish-link" id="share-url">${esc(link)}</div><div class="modal-actions"><button class="btn" id="open-link">Open candidate page</button><button class="btn btn-primary" id="copy-link">${ICONS.copy} &nbsp;Copy link</button></div>`);
    modalRoot.querySelector('#copy-link').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(link); showToast('Application link copied.'); closeModal(); }
      catch (_) { const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(modalRoot.querySelector('#share-url')); selection.removeAllRanges(); selection.addRange(range); showToast('Select and copy the highlighted link.'); }
    });
    modalRoot.querySelector('#open-link').addEventListener('click', () => window.open(link, '_blank', 'noopener'));
  }

  async function publishFlowChanges(event) {
    const flow = currentFlow();
    if (!flow || !event?.currentTarget || publishingFlows.has(flow)) return;
    try { C.normalizeFlow(flow); }
    catch (error) { showToast(error.message || 'This flow needs a fix before it can be published.'); return; }
    const editRevision = flowEditRevisions.get(flow) || 0;
    publishingFlows.add(flow);
    clearTimeout(cloudSaveTimer);
    clearTimeout(saveTimer);
    updatePublicationNotice();
    const indicator = root.querySelector('.save-indicator');
    if (indicator) indicator.innerHTML = '<span class="status-dot"></span> Saving & publishing…';
    let savedToWorkspace = false;
    try {
      await window.PathwayBackend.saveFlow(flow, workspace);
      savedToWorkspace = true;
      if (indicator?.isConnected) indicator.innerHTML = '<span class="status-dot"></span> Saved to workspace';
      const publishedAt = await window.PathwayBackend.updatePublishedFlow(flow, workspace);
      flow.publishedAt = publishedAt;
      if ((flowEditRevisions.get(flow) || 0) === editRevision) {
        flow.updatedAt = publishedAt;
        locallyUnpublishedFlows.delete(flow);
      }
      updatePublicationNotice();
      showToast((flowEditRevisions.get(flow) || 0) === editRevision
        ? 'Changes published to your existing job link.'
        : 'Changes published. Newer edits still need to be published.');
    } catch (error) {
      if (indicator?.isConnected) indicator.innerHTML = savedToWorkspace
        ? '<span class="status-dot"></span> Saved to workspace'
        : '<span class="save-failed">Save failed</span>';
      showToast(`Could not publish changes: ${error.message || 'please try again'}`);
    } finally {
      publishingFlows.delete(flow);
      updatePublicationNotice();
    }
  }

  window.addEventListener('pointerup', () => { if (connectFrom && window.pendingPointer) { connectFrom = null; window.pendingPointer = null; drawCanvas(); } });
  window.PathwayAuth.start(context => {
    workspace = context.workspace;
    user = context.user;
    myProfile = context.profile || null;
    isOwner = Boolean(context.isOwner);
    teamMember = context.teamMember || null;
    subscription = context.subscription || { status: 'free', active: false, currentPeriodEnd: null, cancelAtPeriodEnd: false };
    flows = context.flows;
    companies = context.companies || [];
    applicants = []; applicantFilter = ''; applicantSearch = '';
    flowFilters = { search: '', company: '', responsible: '' };
    startNotifications();
    const requestedPage = window.location.hash.replace(/^#/, '');
    const query = new URLSearchParams(window.location.search);
    const checkoutComplete = query.get('checkout') === 'complete';
    const paymentMethodUpdated = query.get('billing') === 'payment-method-updated';
    if (checkoutComplete || paymentMethodUpdated) {
      window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    }
    if (requestedPage === 'my-companies') renderMyCompanies();
    else if (requestedPage === 'applicants') void renderApplicants();
    else if (requestedPage === 'my-plan') renderMyPlan();
    else if (requestedPage === 'my-team') void renderMyTeam();
    else if (requestedPage === 'settings') renderSettings();
    else if (requestedPage.startsWith('flow=')) {
      const savedFlow = flows.find(item => item.cloudId === requestedPage.slice(5));
      if (savedFlow && hasPermission('flows')) openFlow(savedFlow.id); else renderDashboard();
    }
    else if (requestedPage === 'dashboard' && !hasPermission('flows')) renderAccessMessage('flows');
    else renderDashboard();
    if (checkoutComplete) void refreshSubscriptionAfterCheckout();
    if (paymentMethodUpdated) void syncPaymentMethodAfterPortal();
  });

  async function syncPaymentMethodAfterPortal() {
    try {
      await window.PathwayBackend.syncPaymentMethodFromCustomer();
      await loadCurrentCardSummary();
      showToast('Payment method updated for this subscription.');
    } catch (error) {
      showToast(error.message || 'The updated card could not be applied. Please try again.');
    }
  }
})();

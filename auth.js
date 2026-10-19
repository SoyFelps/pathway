/* Pathway account screens and Supabase Auth bootstrap. */
(function () {
  const root = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  let onAuthenticated = null;
  let busy = false;
  let state = { mode: 'signup', workspaceName: '', firstName: '', lastName: '', email: '', password: '' };
  let inviteToken = '';
  let invitePreview = null;

  function getInviteToken() {
    const query = new URLSearchParams(window.location.search);
    const fromQuery = query.get('team_invite');
    if (fromQuery) return fromQuery;
    const hash = window.location.hash.replace(/^#/, '');
    return new URLSearchParams(hash).get('team-invite') || '';
  }
  function clearInviteUrl() {
    window.history.replaceState({}, '', window.location.pathname);
    inviteToken = '';
  }
  function showLoading() {
    root.innerHTML = '<main class="loading-screen"><div class="loading-card"><span class="brand-mark">↗</span><span>Opening your workspace…</span></div></main>';
  }
  function friendlyError(error) {
    const message = String(error && error.message || error || 'Something went wrong.');
    if (/Invalid login credentials/i.test(message)) return 'That email and password do not match. Check them and try again.';
    if (/User already registered/i.test(message)) return 'An account with this email already exists. Switch to Sign in to accept your invitation.';
    if (/Password should be at least/i.test(message)) return 'Choose a longer password and try again.';
    if (/rate limit/i.test(message)) return 'Too many attempts in a short time. Please wait a moment and try again.';
    if (/Failed to fetch|NetworkError/i.test(message)) return 'Could not reach the account service. Check your connection and try again.';
    return message;
  }
  // Shown under the main button: using Pathway means accepting the Terms of Use and the Privacy Policy (legal.html).
  function legalConsentHtml(action) {
    return 'By ' + action + ', you agree to our <a href="legal.html#terms" target="_blank" rel="noopener">Terms of Use</a> and <a href="legal.html#privacy" target="_blank" rel="noopener">Privacy Policy</a>.';
  }
  // "How it works" and plans, shown below the sign-in / sign-up screen.
  function howItWorksHtml() {
    const row = (number, title, text, art) => '<li class="how-row"><div class="how-copy"><span class="how-num">Step ' + number + '</span><h3>' + title + '</h3><p>' + text + '</p></div><div class="how-art" aria-hidden="true">' + art + '</div></li>';
    const art = {
      build: '<div class="mk"><div class="mk-step mk-fixed"><span class="mk-tag">Fixed start</span><strong>Your details</strong><small>Name · Email · Resume</small></div><i class="mk-line"></i><div class="mk-step"><span class="mk-tag">Short answer</span><strong>Tell us about your experience</strong></div><i class="mk-line"></i><div class="mk-step"><span class="mk-tag">Single choice</span><strong>Can you work remotely?</strong></div><div class="mk-add">+ Add a step</div></div>',
      branch: '<div class="mk"><div class="mk-step"><span class="mk-tag">Single choice</span><strong>Do you have the right to work in Brazil?</strong></div><div class="mk-split"><div class="mk-path"><span class="mk-opt">Yes</span><i class="mk-arrow"></i><div class="mk-step mk-ok"><strong>Next question</strong></div></div><div class="mk-path"><span class="mk-opt">No</span><i class="mk-arrow"></i><div class="mk-step mk-end"><strong>Not a match this time</strong></div></div></div></div>',
      preview: '<div class="mk mk-center"><div class="mk-phone"><div class="mk-progress"><i></i></div><small>Question 2 of 4</small><strong>Can you work remotely?</strong><div class="mk-radio is-on"><b></b>Yes</div><div class="mk-radio"><b></b>No</div><div class="mk-btn">Continue</div></div></div>',
      publish: '<div class="mk"><div class="mk-share"><span class="mk-status"><i></i>Published</span><strong>Product Designer</strong><div class="mk-url"><span>…/apply.html#id=7c2f9e41</span><b>Copy link</b></div><small>Edit anytime and publish the changes to the same link.</small></div></div>',
      review: '<div class="mk"><div class="mk-boardtop"><span>Applicants</span><span class="mk-bell"><svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg><b>2</b></span></div><div class="mk-cols"><div class="mk-col"><h4>New</h4><div class="mk-card"><i></i><i></i></div><div class="mk-card"><i></i><i></i></div></div><div class="mk-col"><h4>Promising</h4><div class="mk-card"><i></i><i></i></div></div><div class="mk-col"><h4>Approved</h4><div class="mk-card"><i></i><i></i></div></div></div></div>'
    };
    const check = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    const feature = text => '<li>' + check + text + '</li>';
    return '<section class="auth-info" id="how-it-works" aria-labelledby="how-title"><div class="auth-info-inner">'
      + '<div class="eyebrow">How it works</div><h2 id="how-title">From a blank page to a shared job link</h2>'
      + '<p class="auth-info-lead">Design the application once, publish it as a link and review everyone who applies in one private workspace.</p>'
      + '<ol class="how-rows">'
      + row(1, 'Build your flow', 'Start with the role: job title, company and description. Then lay out your application on a visual canvas, one step at a time: short answers, single choice or multiple choice.', art.build)
      + row(2, 'Branch on answers', 'Connect the steps so each answer leads somewhere: ask a follow-up, move on, or end the application early with a polite “not a match this time” screen.', art.branch)
      + row(3, 'Preview as a candidate', 'Walk through your flow exactly as a candidate will see it, and fix anything before anyone else does.', art.preview)
      + row(4, 'Publish and share', 'Publish to get a stable public link for the role and share it anywhere. Edit later and publish the changes to the same link, or unpublish whenever you like.', art.publish)
      + row(5, 'Review candidates', 'Candidates upload a resume and get a confirmation e-mail. You see them on a private board, move them between stages and get a notification when new people apply.', art.review)
      + '</ol>'
      + '<div class="eyebrow auth-info-plans-eyebrow">Plans</div><h2 id="plans-title">Start free. Upgrade when you are ready to publish.</h2>'
      + '<p class="auth-info-lead">Building is free. Publishing a job and receiving applications is what Premium is for.</p>'
      + '<div class="plan-grid">'
      + '<article class="plan-card"><h3>Free</h3><div class="plan-price">US$0</div><p class="plan-tagline">Design and test your flows.</p><ul class="plan-features">'
      + feature('Visual flow builder with branching steps') + feature('Preview as a candidate') + feature('Everything saved in your private workspace')
      + '<li class="plan-missing"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>Publishing job links</li></ul>'
      + '<button class="btn btn-primary plan-cta" id="start-free" type="button">Start for free</button></article>'
      + '<article class="plan-card plan-card-premium"><h3>Premium</h3><div class="plan-price">US$24.90<span> / month</span></div><p class="plan-tagline">Publish jobs and hire with your team.</p><ul class="plan-features">'
      + feature('Everything in Free') + feature('Public job links that accept applications') + feature('Applicant board with stages and private resume storage')
      + feature('Confirmation e-mails to candidates and new-application notifications') + feature('Up to 3 teammates at no extra seat charge, with the permissions you choose') + feature('Cancel any time and keep access until the end of the period')
      + '</ul><p class="plan-note">Start free and upgrade from My Plan inside the app whenever you are ready to publish.</p></article>'
      + '</div></div></section>';
  }
  function renderAuth(errorMessage = '', successMessage = '') {
    const isInvite = Boolean(inviteToken && invitePreview);
    const email = state.email || (isInvite ? invitePreview.invitedEmail : '');
    root.innerHTML = `<main class="auth-screen"><section class="auth-story"><a class="brand" href="#"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="auth-story-main"><div class="eyebrow">A calmer way to hire</div><h1>Hiring made organized</h1><p>Build application flows, share role links and review every candidate in one place.</p><div class="auth-feature-list"><div class="auth-feature"><span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 7v10M18 11c0 4-6 3-12 6"/></svg></span>Branching flows that adapt to every answer</div><div class="auth-feature"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg></span>One public link per role, ready to share</div><div class="auth-feature"><span><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/></svg></span>A shared board to review candidates with your team</div></div></div></section><section class="auth-card-wrap"><div class="auth-card"><div class="eyebrow">${isInvite ? 'Workspace invitation' : state.mode === 'signup' ? 'Get started' : 'Welcome back'}</div><h2>${isInvite ? `Join ${window.PathwayCore.esc(invitePreview.workspaceName)}` : state.mode === 'signup' ? 'Create your account' : 'Sign in to Pathway'}</h2><p class="auth-card-intro">${isInvite ? `Use the invited email address to join ${window.PathwayCore.esc(invitePreview.workspaceName)}. Your account can belong to one workspace at a time.` : state.mode === 'signup' ? 'Start with a private workspace for your company.' : 'Pick up where you left off.'}</p>${isInvite ? '<div class="auth-success" role="status">This link is valid for the invited email address. It expires in 7 days and can be revoked by a team manager.</div>' : `<div class="auth-tabs"><button class="auth-tab ${state.mode === 'signup' ? 'active' : ''}" data-mode="signup" type="button">Create account</button><button class="auth-tab ${state.mode === 'signin' ? 'active' : ''}" data-mode="signin" type="button">Sign in</button></div>`}${successMessage ? `<div class="auth-success" role="status">${window.PathwayCore.esc(successMessage)}</div>` : ''}<div class="auth-error ${errorMessage ? 'show' : ''}" role="alert">${errorMessage ? window.PathwayCore.esc(errorMessage) : ''}</div><form id="auth-form">${state.mode === 'signup' && !isInvite ? `<div class="field-group"><label for="auth-workspace">Company / workspace name</label><input id="auth-workspace" class="text-input" name="workspaceName" autocomplete="organization" placeholder="e.g. Northstar Studio" value="${window.PathwayCore.esc(state.workspaceName)}" required maxlength="120"></div>` : ''}${state.mode === 'signup' ? `<div class="field-row"><div class="field-group"><label for="auth-first-name">First name</label><input id="auth-first-name" class="text-input" name="firstName" autocomplete="given-name" value="${window.PathwayCore.esc(state.firstName)}" required maxlength="60"></div><div class="field-group"><label for="auth-last-name">Last name</label><input id="auth-last-name" class="text-input" name="lastName" autocomplete="family-name" value="${window.PathwayCore.esc(state.lastName)}" required maxlength="60"></div></div>` : ''}<div class="field-group"><label for="auth-email">${isInvite ? 'Invited email' : 'Work email'}</label><input id="auth-email" class="text-input" name="email" type="email" autocomplete="email" placeholder="you@company.com" value="${window.PathwayCore.esc(email)}" ${isInvite ? 'readonly' : ''} required></div><div class="field-group"><label for="auth-password">Password</label><input id="auth-password" class="text-input" name="password" type="password" autocomplete="${state.mode === 'signup' ? 'new-password' : 'current-password'}" minlength="8" placeholder="At least 8 characters" required></div><button class="btn btn-primary auth-submit" id="auth-submit" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Please wait…' : state.mode === 'signup' ? isInvite ? 'Create account and join →' : 'Create account →' : isInvite ? 'Sign in and join →' : 'Sign in →'}</button></form><p class="auth-legal">${isInvite ? 'Pathway will only add you to the invited workspace after you confirm the invited email address. You can leave later without deleting your account.' + (state.mode === 'signup' ? ' ' + legalConsentHtml('creating an account') : '') : legalConsentHtml(state.mode === 'signup' ? 'creating an account' : 'signing in')}</p></div></section></main>${isInvite ? '' : howItWorksHtml()}`;
    if (isInvite) root.querySelector('.auth-success')?.insertAdjacentHTML('afterend', `<div class="auth-tabs"><button class="auth-tab ${state.mode === 'signup' ? 'active' : ''}" data-mode="signup" type="button">New account</button><button class="auth-tab ${state.mode === 'signin' ? 'active' : ''}" data-mode="signin" type="button">Already registered? Sign in</button></div>`);
    root.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
      if (busy || state.mode === button.dataset.mode) return;
      captureForm(); state.mode = button.dataset.mode; renderAuth();
    }));
    if (isInvite) {
      root.querySelector('.auth-legal')?.insertAdjacentHTML('afterend', '<button class="btn btn-quiet auth-submit" id="continue-without-invite" type="button">Continue without this invitation</button>');
      root.querySelector('#continue-without-invite')?.addEventListener('click', async () => {
        clearInviteUrl(); invitePreview = null; state.mode = 'signup'; state.password = '';
        const context = await window.PathwayBackend.bootstrap();
        if (context.session && context.workspace) onAuthenticated(context);
        else if (context.session) { state.email = context.user?.email || state.email; renderWorkspaceSetup(); }
        else renderAuth();
      });
    }
    root.querySelector('#start-free')?.addEventListener('click', () => {
      if (busy) return;
      if (state.mode !== 'signup') { captureForm(); state.mode = 'signup'; renderAuth(); }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => root.querySelector('#auth-workspace')?.focus({ preventScroll: true }), 350);
    });
    root.querySelector('#auth-form').addEventListener('submit', submitAuth);
    if (!isInvite && state.mode === 'signin') {
      const forgotPassword = document.createElement('button');
      forgotPassword.className = 'auth-forgot-link';
      forgotPassword.type = 'button';
      forgotPassword.textContent = 'Forgot your password?';
      root.querySelector('#auth-password')?.closest('.field-group')?.insertAdjacentElement('afterend', forgotPassword);
      forgotPassword.addEventListener('click', () => {
        captureForm(); state.password = '';
        renderPasswordResetRequest();
      });
    }
  }
  function renderWorkspaceSetup(errorMessage = '') {
    root.innerHTML = `<main class="auth-screen"><section class="auth-story"><a class="brand" href="#"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="auth-story-main"><div class="eyebrow">Your next chapter</div><h1>Create your own workspace.</h1><p>Your Pathway account remains yours. Choose a workspace name to get started as its owner.</p></div></section><section class="auth-card-wrap"><div class="auth-card"><div class="eyebrow">Workspace setup</div><h2>Start a private workspace</h2><p class="auth-card-intro">You are signed in as ${window.PathwayCore.esc(state.email)}. Creating a workspace does not delete your existing account.</p><div class="auth-error ${errorMessage ? 'show' : ''}" role="alert">${errorMessage ? window.PathwayCore.esc(errorMessage) : ''}</div><form id="workspace-form"><div class="field-group"><label for="setup-workspace">Company / workspace name</label><input id="setup-workspace" class="text-input" name="workspaceName" autocomplete="organization" maxlength="120" required placeholder="e.g. Northstar Studio" value="${window.PathwayCore.esc(state.workspaceName)}"></div><button class="btn btn-primary auth-submit" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Please wait…' : 'Create workspace →'}</button></form><button class="btn btn-quiet auth-submit" id="setup-signout" type="button">Sign out</button><p class="auth-legal">You can join an existing team from an invitation link, or create your own workspace.</p></div></section></main>`;
    root.querySelector('#workspace-form').addEventListener('submit', async event => {
      event.preventDefault(); if (busy) return;
      const data = new FormData(event.currentTarget);
      state.workspaceName = String(data.get('workspaceName') || '').trim();
      busy = true; renderWorkspaceSetup();
      try {
        await window.PathwayBackend.createWorkspace(state.workspaceName);
        const context = await window.PathwayBackend.bootstrap();
        busy = false; onAuthenticated(context);
      } catch (error) { busy = false; renderWorkspaceSetup(friendlyError(error)); }
    });
    root.querySelector('#setup-signout').addEventListener('click', async () => {
      await window.PathwayBackend.signOut(); state = { mode: 'signup', workspaceName: '', firstName: '', lastName: '', email: '', password: '' }; inviteToken = ''; invitePreview = null; renderAuth();
    });
    const deleteAccountButton = document.createElement('button');
    deleteAccountButton.className = 'btn btn-quiet auth-submit';
    deleteAccountButton.id = 'setup-delete-account';
    deleteAccountButton.type = 'button';
    deleteAccountButton.textContent = 'Delete account…';
    root.querySelector('#setup-signout')?.insertAdjacentElement('afterend', deleteAccountButton);
    deleteAccountButton.addEventListener('click', () => showAccountDeletionConfirmation({ isOwner: false, workspaceName: '', email: state.email }));
  }
  function renderInviteConflict(message) {
    root.innerHTML = `<main class="auth-screen"><section class="auth-story"><a class="brand" href="#"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="auth-story-main"><div class="eyebrow">Workspace invitation</div><h1>One workspace per account.</h1><p>To join this team, this account must first leave its current workspace. The existing workspace owner cannot leave their own workspace.</p></div></section><section class="auth-card-wrap"><div class="auth-card"><div class="eyebrow">Invitation not accepted</div><h2>Check your account</h2><div class="auth-error show" role="alert">${window.PathwayCore.esc(message)}</div><p class="auth-card-intro">Sign out, then sign in with the email address invited to this workspace.</p><button class="btn btn-primary auth-submit" id="invite-conflict-signout">Sign out</button></div></section></main>`;
    root.querySelector('#invite-conflict-signout').addEventListener('click', async () => {
      try { await window.PathwayBackend.signOut(); } finally { state = { mode: 'signup', workspaceName: '', firstName: '', lastName: '', email: '', password: '' }; renderAuth(); }
    });
  }
  function renderInviteAcceptanceFailure(message) {
    root.innerHTML = `<main class="auth-screen"><section class="auth-story"><a class="brand" href="#"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="auth-story-main"><div class="eyebrow">Workspace invitation</div><h1>Your account is ready.</h1><p>Pathway couldn't finish adding this account to the invited workspace automatically.</p></div></section><section class="auth-card-wrap"><div class="auth-card"><div class="eyebrow">Finish joining your team</div><h2>We couldn't join this workspace</h2><div class="auth-error show" role="alert">${window.PathwayCore.esc(message)}</div><p class="auth-card-intro">Try again. If the invitation expired, was revoked, or the workspace no longer has Premium access, ask its manager to send a new invitation.</p><button class="btn btn-primary auth-submit" id="retry-team-acceptance" type="button">Try again</button><button class="btn btn-quiet auth-submit" id="team-acceptance-signout" type="button">Sign out</button></div></section></main>`;
    root.querySelector('#retry-team-acceptance')?.addEventListener('click', () => window.location.reload());
    root.querySelector('#team-acceptance-signout')?.addEventListener('click', async () => {
      await window.PathwayBackend.signOut(); state = { mode: 'signup', workspaceName: '', firstName: '', lastName: '', email: '', password: '' }; clearInviteUrl(); renderAuth();
    });
  }
  function renderInvalidInvite(message) {
    root.innerHTML = `<main class="auth-screen"><section class="auth-story"><a class="brand" href="#"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="auth-story-main"><div class="eyebrow">Workspace invitation</div><h1>This link needs attention.</h1><p>Invitation links are single-use, expire after seven days, and can be revoked by a team manager.</p></div></section><section class="auth-card-wrap"><div class="auth-card"><div class="eyebrow">Invitation unavailable</div><h2>We couldn't verify this invitation</h2><div class="auth-error show" role="alert">${window.PathwayCore.esc(message)}</div><p class="auth-card-intro">Ask the team manager for a new link, or continue without this invitation.</p><button class="btn btn-primary auth-submit" id="continue-without-invite">Continue to Pathway</button></div></section></main>`;
    root.querySelector('#continue-without-invite').addEventListener('click', async () => {
      clearInviteUrl(); invitePreview = null; state.mode = 'signup';
      try {
        const context = await window.PathwayBackend.bootstrap();
        if (context.session && context.workspace) onAuthenticated(context);
        else if (context.session) { state.email = context.user?.email || state.email; renderWorkspaceSetup(); }
        else renderAuth();
      } catch (error) { renderAuth(friendlyError(error)); }
    });
  }
  function captureForm() {
    const form = root.querySelector('#auth-form'); if (!form) return;
    const data = new FormData(form);
    state.workspaceName = String(data.get('workspaceName') || state.workspaceName).trim();
    state.firstName = String(data.get('firstName') ?? state.firstName).trim();
    state.lastName = String(data.get('lastName') ?? state.lastName).trim();
    state.email = String(data.get('email') || state.email).trim();
    state.password = String(data.get('password') || '');
  }
  async function finishAuthentication() {
    let context = await window.PathwayBackend.bootstrap();
    if (!context.session) throw new Error('Please sign in again to continue.');
    if (inviteToken) {
      if (context.workspace) throw new Error('This account already belongs to a workspace. Leave it first, or sign in with the invited email account.');
      await window.PathwayBackend.acceptTeamInvitation(inviteToken);
      clearInviteUrl();
      context = await window.PathwayBackend.bootstrap();
    }
    context = await acceptPendingTeamIfNeeded(context);
    if (!context.workspace) {
      busy = false;
      state.email = context.user?.email || state.email;
      renderWorkspaceSetup();
      return;
    }
    busy = false;
    onAuthenticated(context);
  }
  async function acceptPendingTeamIfNeeded(context) {
    if (context.workspace || context.user?.user_metadata?.pathway_team_invite_pending !== true) return context;
    const result = await window.PathwayBackend.acceptPendingTeamInvitation();
    clearInviteUrl();
    if (!result.accepted) return context;
    const joined = await window.PathwayBackend.bootstrap();
    if (!joined.workspace) throw new Error('Your invitation was accepted, but the workspace could not be loaded yet.');
    return joined;
  }
  async function submitAuth(event) {
    event.preventDefault(); if (busy) return;
    captureForm();
    busy = true; renderAuth();
    try {
      if (state.mode === 'signup') {
        if (!state.firstName || !state.lastName) throw new Error('Enter your first and last name.');
        const { data, error } = await window.PathwayBackend.signUp(state.email, state.password, state.workspaceName, inviteToken, state.firstName, state.lastName);
        if (error) throw error;
        if (!data.session) {
          busy = false; state.password = '';
          renderAuth('', inviteToken ? 'Check your email to confirm your account. After confirmation, Pathway will add you to the invited workspace automatically.' : 'Check your email for the confirmation link. Your private workspace will be ready once you confirm your account.');
          return;
        }
      } else {
        const { error } = await window.PathwayBackend.signIn(state.email, state.password);
        if (error) throw error;
      }
      state.password = '';
      await finishAuthentication();
    } catch (error) {
      busy = false;
      const message = friendlyError(error);
      if (inviteToken && /already belongs to a workspace/i.test(message)) renderInviteConflict(message);
      else renderAuth(message);
    }
  }
  function clearPasswordRecoveryUrl() {
    try {
      const url = new URL(window.location.href);
      ['type', 'code', 'access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'token_hash', 'password_recovery', 'error', 'error_description'].forEach(key => url.searchParams.delete(key));
      url.hash = '';
      window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    } catch (_) { window.history.replaceState({}, '', window.location.pathname); }
  }
  function renderPasswordResetRequest(errorMessage = '', successMessage = '') {
    root.innerHTML = `<main class="auth-screen"><section class="auth-story"><a class="brand" href="#"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="auth-story-main"><div class="eyebrow">Account recovery</div><h1>Get back on your path.</h1><p>Reset your password securely using the email address connected to your Pathway account.</p></div></section><section class="auth-card-wrap"><div class="auth-card"><div class="eyebrow">Password recovery</div><h2>Forgot your password?</h2><p class="auth-card-intro">Enter your work email and we’ll send a link to choose a new password.</p>${successMessage ? `<div class="auth-success" role="status">${window.PathwayCore.esc(successMessage)}</div>` : ''}<div class="auth-error ${errorMessage ? 'show' : ''}" role="alert">${errorMessage ? window.PathwayCore.esc(errorMessage) : ''}</div><form id="password-reset-request-form"><div class="field-group"><label for="password-reset-email">Work email</label><input id="password-reset-email" class="text-input" name="email" type="email" autocomplete="email" value="${window.PathwayCore.esc(state.email)}" required></div><button class="btn btn-primary auth-submit" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Sending link…' : 'Send reset link →'}</button></form><button class="btn btn-quiet auth-submit" id="password-reset-back" type="button">Back to sign in</button><p class="auth-legal">For your privacy, this page gives the same confirmation whether or not an account uses that email.</p></div></section></main>`;
    root.querySelector('#password-reset-request-form')?.addEventListener('submit', submitPasswordResetRequest);
    root.querySelector('#password-reset-back')?.addEventListener('click', () => {
      state.email = String(root.querySelector('#password-reset-email')?.value || state.email).trim();
      state.mode = 'signin'; state.password = ''; renderAuth();
    });
  }
  async function submitPasswordResetRequest(event) {
    event.preventDefault(); if (busy) return;
    state.email = String(new FormData(event.currentTarget).get('email') || '').trim();
    state.password = ''; busy = true; renderPasswordResetRequest();
    try {
      await window.PathwayBackend.sendPasswordReset(state.email);
      busy = false;
      renderPasswordResetRequest('', 'If an account exists for this email, a password reset link is on its way. Check your inbox and spam folder.');
    } catch (error) { busy = false; renderPasswordResetRequest(friendlyError(error)); }
  }
  function renderPasswordUpdate(errorMessage = '') {
    root.innerHTML = `<main class="auth-screen"><section class="auth-story"><a class="brand" href="#"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="auth-story-main"><div class="eyebrow">Account recovery</div><h1>A fresh start.</h1><p>Choose a strong new password to secure your Pathway account.</p></div></section><section class="auth-card-wrap"><div class="auth-card"><div class="eyebrow">Password recovery</div><h2>Choose a new password</h2><p class="auth-card-intro">${state.email ? `Set a new password for ${window.PathwayCore.esc(state.email)}.` : 'Set a new password for your Pathway account.'} Use at least 8 characters.</p><div class="auth-error ${errorMessage ? 'show' : ''}" role="alert">${errorMessage ? window.PathwayCore.esc(errorMessage) : ''}</div><form id="password-update-form"><div class="field-group"><label for="new-password">New password</label><input id="new-password" class="text-input" name="password" type="password" autocomplete="new-password" minlength="8" required></div><div class="field-group"><label for="confirm-new-password">Confirm new password</label><input id="confirm-new-password" class="text-input" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required></div><button class="btn btn-primary auth-submit" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Updating password…' : 'Update password →'}</button></form><button class="btn btn-quiet auth-submit" id="password-update-back" type="button" ${busy ? 'disabled' : ''}>Back to sign in</button></div></section></main>`;
    root.querySelector('#password-update-form')?.addEventListener('submit', submitPasswordUpdate);
    root.querySelector('#password-update-back')?.addEventListener('click', leavePasswordRecovery);
  }
  async function leavePasswordRecovery() {
    try { await window.PathwayBackend.signOutLocal(); } catch (_) { /* The local recovery session can expire independently. */ }
    clearPasswordRecoveryUrl(); state.mode = 'signin'; state.password = ''; renderAuth();
  }
  async function submitPasswordUpdate(event) {
    event.preventDefault(); if (busy) return;
    const values = new FormData(event.currentTarget);
    const password = String(values.get('password') || '');
    const confirmation = String(values.get('confirmPassword') || '');
    if (password !== confirmation) { renderPasswordUpdate('The passwords do not match.'); return; }
    busy = true; renderPasswordUpdate();
    try {
      await window.PathwayBackend.updatePassword(password);
      try { await window.PathwayBackend.signOutLocal(); } catch (_) { /* Password has already been updated; continue to sign-in. */ }
      clearPasswordRecoveryUrl(); busy = false; state.mode = 'signin'; state.password = '';
      renderAuth('', 'Your password has been updated. Sign in with your new password.');
    } catch (error) { busy = false; renderPasswordUpdate(friendlyError(error)); }
  }
  async function start(callback) {
    onAuthenticated = callback; inviteToken = getInviteToken(); showLoading();
    try {
      if (inviteToken) {
        invitePreview = await window.PathwayBackend.previewTeamInvitation(inviteToken);
        state.email = invitePreview.invitedEmail || '';
      }
      const context = await window.PathwayBackend.bootstrap();
      const passwordRecoveryState = window.PathwayBackend.consumePasswordRecovery();
      if (passwordRecoveryState) {
        if (passwordRecoveryState === 'recovery' && context.session) {
          state.mode = 'signin'; state.email = context.user?.email || ''; state.password = '';
          renderPasswordUpdate();
        } else {
          clearPasswordRecoveryUrl(); state.mode = 'signin';
          renderAuth('This password reset link is invalid or expired. Request a new one.');
        }
        return;
      }
      if (context.session) {
        if (inviteToken && !context.workspace) {
          try {
            await window.PathwayBackend.acceptTeamInvitation(inviteToken);
            clearInviteUrl();
            onAuthenticated(await window.PathwayBackend.bootstrap());
            return;
          } catch (error) {
            renderAuth(friendlyError(error));
            return;
          }
        }
        if (inviteToken && context.workspace) { renderInviteConflict('This account already belongs to a workspace. Leave it first, or sign out and reopen the invitation with the invited account.'); return; }
        if (!context.workspace) {
          state.email = context.user?.email || '';
          if (context.user?.user_metadata?.pathway_team_invite_pending === true) {
            try {
              const joined = await acceptPendingTeamIfNeeded(context);
              if (joined.workspace) onAuthenticated(joined);
              else renderWorkspaceSetup();
            } catch (error) { renderInviteAcceptanceFailure(friendlyError(error)); }
            return;
          }
          renderWorkspaceSetup();
          return;
        }
        onAuthenticated(context); return;
      }
      renderAuth();
    } catch (error) {
      if (inviteToken && !invitePreview) renderInvalidInvite(friendlyError(error));
      else renderAuth(friendlyError(error));
    }
  }
  function showAccountDeletionConfirmation(options = {}) {
    if (!modalRoot) return;
    const isOwner = Boolean(options.isOwner);
    const workspaceName = String(options.workspaceName || '');
    const email = String(options.email || state.email || '');
    const workspaceLabel = workspaceName ? ` ${window.PathwayCore.esc(workspaceName)}` : '';
    const title = isOwner ? `Delete your account and${workspaceLabel}?` : 'Permanently delete your account?';
    const explanation = isOwner
      ? `This permanently deletes your Pathway account and workspace${workspaceLabel}, including job flows, public job pages, candidate applications, private resumes, invitations, and all member access. Any subscription attached to the workspace will be canceled immediately; unused paid time is not automatically refunded. This action is irreversible.`
      : workspaceName
        ? `This permanently deletes your Pathway account and removes your access and membership from${workspaceLabel}. The workspace, job flows, candidate applications, private resumes, and subscription remain for the owner and team. Any pending invitations you sent will be revoked. This action is irreversible.`
        : 'This permanently deletes your Pathway account. There is no workspace attached to this account right now. Any pending invitations you sent will be revoked. This action is irreversible.';
    modalRoot.innerHTML = `<div class="modal-backdrop account-delete-backdrop" role="presentation"><section class="modal account-delete-modal" role="dialog" aria-modal="true" aria-labelledby="account-delete-title"><div class="modal-head"><div><div class="eyebrow" style="margin-bottom:8px">Delete account</div><h2 id="account-delete-title">${title}</h2><p>${explanation}</p>${email ? `<p class="account-delete-email">Account: <strong>${window.PathwayCore.esc(email)}</strong></p>` : ''}</div><button class="modal-x" data-account-delete-close type="button" aria-label="Close">×</button></div><div class="account-delete-warning"><strong>Confirm with your current password.</strong> Pathway verifies it with Supabase Auth and does not store it.</div><form id="account-delete-form"><div class="field-group"><label for="account-delete-password">Current password</label><input class="text-input" id="account-delete-password" name="password" type="password" autocomplete="current-password" maxlength="1024" required></div><p class="account-delete-error" id="account-delete-error" role="alert" hidden></p><div class="modal-actions"><button class="btn" data-account-delete-close type="button">Keep my account</button><button class="btn btn-danger" id="confirm-delete-account" type="submit" disabled>Delete account permanently</button></div></form></section></div>`;
    let submitting = false;
    let escapeHandler = null;
    const previousFocus = document.activeElement;
    const cleanupEscapeHandler = () => { if (escapeHandler) document.removeEventListener('keydown', escapeHandler); escapeHandler = null; };
    const close = () => {
      if (submitting) return;
      cleanupEscapeHandler(); modalRoot.innerHTML = '';
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
    escapeHandler = event => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', escapeHandler);
    const backdrop = modalRoot.querySelector('.account-delete-backdrop');
    backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
    modalRoot.querySelectorAll('[data-account-delete-close]').forEach(button => button.addEventListener('click', close));
    const form = modalRoot.querySelector('#account-delete-form');
    const passwordInput = modalRoot.querySelector('#account-delete-password');
    const confirmButton = modalRoot.querySelector('#confirm-delete-account');
    const errorBox = modalRoot.querySelector('#account-delete-error');
    passwordInput.addEventListener('input', () => { confirmButton.disabled = passwordInput.value.length === 0 || submitting; errorBox.hidden = true; errorBox.textContent = ''; });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submitting || !passwordInput.value) return;
      submitting = true; passwordInput.disabled = true; confirmButton.disabled = true; confirmButton.textContent = 'Deleting account…'; errorBox.hidden = true;
      try {
        const result = await window.PathwayBackend.deleteAccount(passwordInput.value);
        if (!result.deleted) throw new Error('The account deletion was not confirmed.');
        cleanupEscapeHandler(); modalRoot.innerHTML = '';
        state = { mode: 'signup', workspaceName: '', firstName: '', lastName: '', email: '', password: '' }; inviteToken = ''; invitePreview = null;
        renderAuth('', 'Your Pathway account has been permanently deleted.');
      } catch (error) {
        submitting = false; passwordInput.disabled = false; confirmButton.disabled = passwordInput.value.length === 0; confirmButton.textContent = 'Delete account permanently';
        errorBox.textContent = String(error && error.message || 'Your account could not be deleted.'); errorBox.hidden = false;
        passwordInput.focus();
      }
    });
    passwordInput.focus();
  }
  window.PathwayAuth = { start, renderAuth, renderWorkspaceSetup, showLoading, showAccountDeletionConfirmation };
})();

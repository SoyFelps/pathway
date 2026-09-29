/* Pathway account screens and Supabase Auth bootstrap. */
(function () {
  const root = document.getElementById('app');
  let onAuthenticated = null;
  let busy = false;
  let state = { mode: 'signup', workspaceName: '', email: '', password: '' };
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
  function renderAuth(errorMessage = '', successMessage = '') {
    const isInvite = Boolean(inviteToken && invitePreview);
    const email = state.email || (isInvite ? invitePreview.invitedEmail : '');
    root.innerHTML = `<main class="auth-screen"><section class="auth-story"><a class="brand" href="#"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="auth-story-main"><div class="eyebrow">A calmer way to hire</div><h1>Make applying feel human.</h1><p>Design welcoming job pages and clear application journeys, all in one private workspace for your company.</p><div class="auth-feature-list"><div class="auth-feature"><span>✓</span>Thoughtful candidate experiences</div><div class="auth-feature"><span>↗</span>Your own workspace and saved flows</div><div class="auth-feature"><span>⌁</span>Private by default, protected by access rules</div></div></div><div class="muted" style="font-size:11px">Pathway · Early access</div></section><section class="auth-card-wrap"><div class="auth-card"><div class="eyebrow">${isInvite ? 'Workspace invitation' : state.mode === 'signup' ? 'Get started' : 'Welcome back'}</div><h2>${isInvite ? `Join ${window.PathwayCore.esc(invitePreview.workspaceName)}` : state.mode === 'signup' ? 'Create your account' : 'Sign in to Pathway'}</h2><p class="auth-card-intro">${isInvite ? `Use the invited email address to join ${window.PathwayCore.esc(invitePreview.workspaceName)}. Your account can belong to one workspace at a time.` : state.mode === 'signup' ? 'Start with a private workspace for your company.' : 'Pick up where you left off.'}</p>${isInvite ? '<div class="auth-success" role="status">This link is valid for the invited email address. It expires in 7 days and can be revoked by a team manager.</div>' : `<div class="auth-tabs"><button class="auth-tab ${state.mode === 'signup' ? 'active' : ''}" data-mode="signup" type="button">Create account</button><button class="auth-tab ${state.mode === 'signin' ? 'active' : ''}" data-mode="signin" type="button">Sign in</button></div>`}${successMessage ? `<div class="auth-success" role="status">${window.PathwayCore.esc(successMessage)}</div>` : ''}<div class="auth-error ${errorMessage ? 'show' : ''}" role="alert">${errorMessage ? window.PathwayCore.esc(errorMessage) : ''}</div><form id="auth-form">${state.mode === 'signup' && !isInvite ? `<div class="field-group"><label for="auth-workspace">Company / workspace name</label><input id="auth-workspace" class="text-input" name="workspaceName" autocomplete="organization" placeholder="e.g. Northstar Studio" value="${window.PathwayCore.esc(state.workspaceName)}" required maxlength="120"></div>` : ''}<div class="field-group"><label for="auth-email">${isInvite ? 'Invited email' : 'Work email'}</label><input id="auth-email" class="text-input" name="email" type="email" autocomplete="email" placeholder="you@company.com" value="${window.PathwayCore.esc(email)}" ${isInvite ? 'readonly' : ''} required></div><div class="field-group"><label for="auth-password">Password</label><input id="auth-password" class="text-input" name="password" type="password" autocomplete="${state.mode === 'signup' ? 'new-password' : 'current-password'}" minlength="8" placeholder="At least 8 characters" required></div><button class="btn btn-primary auth-submit" id="auth-submit" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Please wait…' : state.mode === 'signup' ? isInvite ? 'Create account and join →' : 'Create account →' : isInvite ? 'Sign in and join →' : 'Sign in →'}</button></form><p class="auth-legal">${isInvite ? 'Pathway will only add you to the invited workspace after you confirm the invited email address. You can leave later without deleting your account.' : 'One account creates one private workspace. Team access is available on Premium; former team members can create their own workspace with the same account.'}</p></div></section></main>`;
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
    root.querySelector('#auth-form').addEventListener('submit', submitAuth);
  }
  function renderWorkspaceSetup(errorMessage = '') {
    root.innerHTML = `<main class="auth-screen"><section class="auth-story"><a class="brand" href="#"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="auth-story-main"><div class="eyebrow">Your next chapter</div><h1>Create your own workspace.</h1><p>Your Pathway account remains yours. Choose a workspace name to get started as its owner.</p></div><div class="muted" style="font-size:11px">Pathway · Early access</div></section><section class="auth-card-wrap"><div class="auth-card"><div class="eyebrow">Workspace setup</div><h2>Start a private workspace</h2><p class="auth-card-intro">You are signed in as ${window.PathwayCore.esc(state.email)}. Creating a workspace does not delete your existing account.</p><div class="auth-error ${errorMessage ? 'show' : ''}" role="alert">${errorMessage ? window.PathwayCore.esc(errorMessage) : ''}</div><form id="workspace-form"><div class="field-group"><label for="setup-workspace">Company / workspace name</label><input id="setup-workspace" class="text-input" name="workspaceName" autocomplete="organization" maxlength="120" required placeholder="e.g. Northstar Studio" value="${window.PathwayCore.esc(state.workspaceName)}"></div><button class="btn btn-primary auth-submit" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Please wait…' : 'Create workspace →'}</button></form><button class="btn btn-quiet auth-submit" id="setup-signout" type="button">Sign out</button><p class="auth-legal">If you were invited to a team, open the original invitation link while signed in with the invited email.</p></div></section></main>`;
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
      await window.PathwayBackend.signOut(); state = { mode: 'signup', workspaceName: '', email: '', password: '' }; inviteToken = ''; invitePreview = null; renderAuth();
    });
  }
  function renderInviteConflict(message) {
    root.innerHTML = `<main class="auth-screen"><section class="auth-story"><a class="brand" href="#"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="auth-story-main"><div class="eyebrow">Workspace invitation</div><h1>One workspace per account.</h1><p>To join this team, this account must first leave its current workspace. The existing workspace owner cannot leave their own workspace.</p></div><div class="muted" style="font-size:11px">Pathway · Early access</div></section><section class="auth-card-wrap"><div class="auth-card"><div class="eyebrow">Invitation not accepted</div><h2>Check your account</h2><div class="auth-error show" role="alert">${window.PathwayCore.esc(message)}</div><p class="auth-card-intro">If you meant to use a different account, sign out and reopen the invitation link.</p><button class="btn btn-primary auth-submit" id="invite-conflict-signout">Sign out</button></div></section></main>`;
    root.querySelector('#invite-conflict-signout').addEventListener('click', async () => {
      try { await window.PathwayBackend.signOut(); } finally { state = { mode: 'signup', workspaceName: '', email: '', password: '' }; renderAuth(); }
    });
  }
  function renderInviteConfirmationNeeded() {
    root.innerHTML = `<main class="auth-screen"><section class="auth-story"><a class="brand" href="#"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="auth-story-main"><div class="eyebrow">Email confirmed</div><h1>Your account is ready.</h1><p>Return to the original team invitation link in this browser to join the workspace. The link is single-use and works only for your confirmed email address.</p></div><div class="muted" style="font-size:11px">Pathway · Early access</div></section><section class="auth-card-wrap"><div class="auth-card"><div class="eyebrow">Finish joining your team</div><h2>Open your invitation link</h2><p class="auth-card-intro">You are signed in. Reopen the copied invitation link to finish joining. If the invite has expired or was revoked, ask the team manager for a new one.</p><button class="btn btn-quiet auth-submit" id="invite-confirmation-signout" type="button">Sign out</button></div></section></main>`;
    root.querySelector('#invite-confirmation-signout')?.addEventListener('click', async () => {
      await window.PathwayBackend.signOut(); state = { mode: 'signup', workspaceName: '', email: '', password: '' }; renderAuth();
    });
  }
  function renderInvalidInvite(message) {
    root.innerHTML = `<main class="auth-screen"><section class="auth-story"><a class="brand" href="#"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="auth-story-main"><div class="eyebrow">Workspace invitation</div><h1>This link needs attention.</h1><p>Invitation links are single-use, expire after seven days, and can be revoked by a team manager.</p></div><div class="muted" style="font-size:11px">Pathway · Early access</div></section><section class="auth-card-wrap"><div class="auth-card"><div class="eyebrow">Invitation unavailable</div><h2>We couldn't verify this invitation</h2><div class="auth-error show" role="alert">${window.PathwayCore.esc(message)}</div><p class="auth-card-intro">Ask the team manager for a new link, or continue without this invitation.</p><button class="btn btn-primary auth-submit" id="continue-without-invite">Continue to Pathway</button></div></section></main>`;
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
    if (!context.workspace) {
      busy = false;
      state.email = context.user?.email || state.email;
      renderWorkspaceSetup();
      return;
    }
    busy = false;
    onAuthenticated(context);
  }
  async function submitAuth(event) {
    event.preventDefault(); if (busy) return;
    captureForm();
    busy = true; renderAuth();
    try {
      if (state.mode === 'signup') {
        const { data, error } = await window.PathwayBackend.signUp(state.email, state.password, state.workspaceName, inviteToken);
        if (error) throw error;
        if (!data.session) {
          busy = false; state.password = '';
          renderAuth('', inviteToken ? 'Check your email to confirm your account, then reopen the invitation link. Your team access begins after you sign in and accept it.' : 'Check your email for the confirmation link. Your private workspace will be ready once you confirm your account.');
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
  async function start(callback) {
    onAuthenticated = callback; inviteToken = getInviteToken(); showLoading();
    try {
      if (inviteToken) {
        invitePreview = await window.PathwayBackend.previewTeamInvitation(inviteToken);
        state.email = invitePreview.invitedEmail || '';
      }
      const context = await window.PathwayBackend.bootstrap();
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
          if (context.user?.user_metadata?.pathway_team_invite_pending === true) renderInviteConfirmationNeeded();
          else renderWorkspaceSetup();
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
  window.PathwayAuth = { start, renderAuth, renderWorkspaceSetup, showLoading };
})();

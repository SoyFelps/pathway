/* Pathway account screens and Supabase Auth bootstrap. */
(function () {
  const root = document.getElementById('app');
  let onAuthenticated = null;
  let busy = false;
  let state = { mode: 'signup', workspaceName: '', email: '', password: '' };

  function showLoading() {
    root.innerHTML = '<main class="loading-screen"><div class="loading-card"><span class="brand-mark">↗</span><span>Opening your workspace…</span></div></main>';
  }
  function friendlyError(error) {
    const message = String(error && error.message || error || 'Something went wrong.');
    if (/Invalid login credentials/i.test(message)) return 'That email and password do not match. Check them and try again.';
    if (/User already registered/i.test(message)) return 'An account with this email already exists. Try signing in instead.';
    if (/Password should be at least/i.test(message)) return 'Choose a longer password and try again.';
    if (/rate limit/i.test(message)) return 'Too many attempts in a short time. Please wait a moment and try again.';
    if (/Failed to fetch|NetworkError/i.test(message)) return 'Could not reach the account service. Check your connection and try again.';
    return message;
  }
  function renderAuth(errorMessage = '', successMessage = '') {
    root.innerHTML = `<main class="auth-screen"><section class="auth-story"><a class="brand" href="#"><span class="brand-mark">↗</span>pathway<span class="brand-sub">Studio</span></a><div class="auth-story-main"><div class="eyebrow">A calmer way to hire</div><h1>Make applying feel human.</h1><p>Design welcoming job pages and clear application journeys, all in one private workspace for your company.</p><div class="auth-feature-list"><div class="auth-feature"><span>✓</span>Thoughtful candidate experiences</div><div class="auth-feature"><span>↗</span>Your own workspace and saved flows</div><div class="auth-feature"><span>⌁</span>Private by default, protected by access rules</div></div></div><div class="muted" style="font-size:11px">Pathway · Early access</div></section><section class="auth-card-wrap"><div class="auth-card"><div class="eyebrow">${state.mode === 'signup' ? 'Get started' : 'Welcome back'}</div><h2>${state.mode === 'signup' ? 'Create your account' : 'Sign in to Pathway'}</h2><p class="auth-card-intro">${state.mode === 'signup' ? 'Start with a private workspace for your company.' : 'Pick up where you left off.'}</p><div class="auth-tabs"><button class="auth-tab ${state.mode === 'signup' ? 'active' : ''}" data-mode="signup" type="button">Create account</button><button class="auth-tab ${state.mode === 'signin' ? 'active' : ''}" data-mode="signin" type="button">Sign in</button></div>${successMessage ? `<div class="auth-success" role="status">${successMessage}</div>` : ''}<div class="auth-error ${errorMessage ? 'show' : ''}" role="alert">${errorMessage ? window.PathwayCore.esc(errorMessage) : ''}</div><form id="auth-form">${state.mode === 'signup' ? `<div class="field-group"><label for="auth-workspace">Company / workspace name</label><input id="auth-workspace" class="text-input" name="workspaceName" autocomplete="organization" placeholder="e.g. Northstar Studio" value="${window.PathwayCore.esc(state.workspaceName)}" required maxlength="120"></div>` : ''}<div class="field-group"><label for="auth-email">Work email</label><input id="auth-email" class="text-input" name="email" type="email" autocomplete="email" placeholder="you@company.com" value="${window.PathwayCore.esc(state.email)}" required></div><div class="field-group"><label for="auth-password">Password</label><input id="auth-password" class="text-input" name="password" type="password" autocomplete="${state.mode === 'signup' ? 'new-password' : 'current-password'}" minlength="8" placeholder="At least 8 characters" required></div><button class="btn btn-primary auth-submit" id="auth-submit" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Please wait…' : state.mode === 'signup' ? 'Create account →' : 'Sign in →'}</button></form><p class="auth-legal">One account creates one private workspace. Team invitations are not available yet. Use test data only while Pathway is in early access; each account has one workspace.</p></div></section></main>`;
    root.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
      if (busy || state.mode === button.dataset.mode) return;
      captureForm(); state.mode = button.dataset.mode; renderAuth();
    }));
    root.querySelector('#auth-form').addEventListener('submit', submitAuth);
  }
  function captureForm() {
    const form = root.querySelector('#auth-form'); if (!form) return;
    const data = new FormData(form);
    state.workspaceName = String(data.get('workspaceName') || state.workspaceName).trim();
    state.email = String(data.get('email') || state.email).trim();
    state.password = String(data.get('password') || '');
  }
  async function submitAuth(event) {
    event.preventDefault(); if (busy) return;
    captureForm();
    busy = true; renderAuth();
    try {
      if (state.mode === 'signup') {
        const { data, error } = await window.PathwayBackend.signUp(state.email, state.password, state.workspaceName);
        if (error) throw error;
        if (!data.session) {
          busy = false; state.password = '';
          renderAuth('', 'Check your email for the confirmation link. Your private workspace will be ready once you confirm your account.');
          return;
        }
      } else {
        const { error } = await window.PathwayBackend.signIn(state.email, state.password);
        if (error) throw error;
      }
      state.password = '';
      const context = await window.PathwayBackend.bootstrap();
      if (!context.session) throw new Error('Please sign in again to continue.');
      busy = false;
      onAuthenticated(context);
    } catch (error) {
      busy = false; renderAuth(friendlyError(error));
    }
  }
  async function start(callback) {
    onAuthenticated = callback; showLoading();
    try {
      const context = await window.PathwayBackend.bootstrap();
      if (context.session) { onAuthenticated(context); return; }
      renderAuth();
    } catch (error) {
      renderAuth(friendlyError(error));
    }
  }
  window.PathwayAuth = { start, renderAuth, showLoading };
})();

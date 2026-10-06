const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('sign-in exposes Forgot your password only outside invitation and signup flows', () => {
  const auth = read('auth.js');
  assert.match(auth, /if \(!isInvite && state\.mode === 'signin'\)/);
  assert.match(auth, /forgotPassword\.textContent = 'Forgot your password\?'/);
  assert.match(auth, /forgotPassword\.addEventListener\('click',[\s\S]*renderPasswordResetRequest\(\)/);
  assert.match(auth, /function renderPasswordResetRequest\(/);
});

test('reset request uses the signup redirect URL and does not disclose whether an email is registered', () => {
  const backend = read('backend.js');
  const auth = read('auth.js');
  assert.match(backend, /client\.auth\.resetPasswordForEmail\(cleanEmail,[\s\S]*redirectTo: window\.location\.origin \+ window\.location\.pathname/);
  assert.match(auth, /If an account exists for this email, a password reset link is on its way/);
  assert.match(auth, /For your privacy, this page gives the same confirmation whether or not an account uses that email/);
});

test('Supabase recovery links are detected and shown a set-new-password form before normal workspace routing', () => {
  const backend = read('backend.js');
  const auth = read('auth.js');
  assert.match(backend, /onAuthStateChange\(event => \{ if \(event === 'PASSWORD_RECOVERY'\)/);
  assert.match(backend, /hashType === 'recovery'/);
  assert.match(backend, /if \(expiredLink && !eventPending\) return 'expired'/);
  assert.match(auth, /const passwordRecoveryState = window\.PathwayBackend\.consumePasswordRecovery\(\);[\s\S]*passwordRecoveryState === 'recovery' && context\.session[\s\S]*renderPasswordUpdate\(\)/);
});

test('new password must match, meet minimum length, and is updated through Supabase Auth', () => {
  const backend = read('backend.js');
  const auth = read('auth.js');
  assert.match(backend, /client\.auth\.updateUser\(\{ password \}\)/);
  assert.match(backend, /password\.length < 8/);
  assert.match(auth, /password !== confirmation/);
  assert.match(auth, /await window\.PathwayBackend\.updatePassword\(password\)/);
  assert.match(auth, /await window\.PathwayBackend\.signOutLocal\(\)/);
});

test('password recovery styles and cache-busted assets are included in the static app', () => {
  const html = read('index.html');
  const css = read('styles.css');
  assert.match(html, /styles\.css\?v=workspace-nav-order-20261006/);
  assert.match(html, /backend\.js\?v=workspace-nav-order-20261006/);
  assert.match(html, /auth\.js\?v=password-recovery-20261001/);
  assert.match(css, /\.auth-forgot-link/);
});

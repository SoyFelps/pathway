const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('the account screens load the shared CAPTCHA helper after the language file and before auth.js', () => {
  const html = read('index.html');
  const at = name => html.indexOf(`${name}?v=`);
  assert.ok(at('turnstile-config.js') > at('i18n.js') && at('captcha.js') > at('turnstile-config.js') && at('auth.js') > at('captcha.js'));
  const helper = read('captcha.js');
  assert.ok(helper.includes('window.PathwayCaptcha = { requestToken }'));
  assert.ok(helper.includes("execution: 'execute'") && helper.includes("appearance: 'interaction-only'"), 'invisible unless Cloudflare wants a check');
  assert.ok(helper.includes('if (!siteKey || !container) return \'\''), 'no site key: no token, no failure');
});

test('sign up, sign in, forgot password and delete account each ask for a token at submission and pass it on', () => {
  const auth = read('auth.js'), backend = read('backend.js');
  assert.equal((auth.match(/window\.PathwayCaptcha\.requestToken\(/g) || []).length, 3);
  assert.ok(auth.includes('id="auth-captcha"') && auth.includes('id="account-delete-captcha"'));
  assert.ok(auth.includes('state.firstName, state.lastName, captchaToken)'));
  assert.ok(auth.includes('signIn(state.email, state.password, captchaToken)'));
  assert.ok(auth.includes('sendPasswordReset(state.email, captchaToken)'));
  assert.ok(auth.includes('deleteAccount(passwordInput.value, captchaToken)'));
  // the token goes to Supabase only when there is one
  assert.ok(backend.includes('...(captchaToken ? { captchaToken } : {})'));
  assert.ok(backend.includes('signInWithPassword({ email, password, ...(captchaToken ? { options: { captchaToken } } : {}) })'));
  assert.ok(backend.includes('JSON.stringify({ password, ...(captchaToken ? { captchaToken } : {}) })'));
});

test('delete-account forwards the token to Supabase Auth, because its password check is refused without it once the CAPTCHA protection is on', () => {
  const edge = read('supabase/functions/delete-account/index.ts');
  assert.ok(edge.includes('const captchaToken = typeof body.captchaToken === "string" ? body.captchaToken.slice(0, 2048) : "";'));
  assert.ok(edge.includes('signInWithPassword({ email: auth.user.email, password, ...(captchaToken ? { options: { captchaToken } } : {}) })'));
});

test('the widget container takes no room while it is empty', () => {
  const css = read('styles.css');
  assert.ok(css.includes('.auth-captcha:empty { display: none; }'));
});

test('the delete-account confirmation never names the technical service behind the password check', () => {
  const auth = read('auth.js');
  const modal = auth.slice(auth.indexOf('account-delete-warning'), auth.indexOf('account-delete-warning') + 300);
  assert.ok(modal.includes("t('Confirm with your current password.')"));
  assert.ok(!modal.includes('Supabase'));
  for (const file of ['locales/pt-BR.js', 'locales/es.js']) assert.ok(!read(file).includes('Supabase Auth'));
});

test('the wait between e-mails and the CAPTCHA refusal that Supabase sends in English are shown in the language of the screen', () => {
  const auth = read('auth.js');
  assert.ok(auth.includes(String.raw`only request this after (\d+) seconds?`));
  assert.ok(auth.includes("t('For security, wait {seconds} seconds before asking again.', { seconds: wait[1] })"));
  assert.ok(auth.includes("if (/captcha/i.test(message)) return t('We could not confirm that you are not a robot. Please try again.');"));
  for (const file of ['locales/pt-BR.js', 'locales/es.js']) assert.ok(read(file).includes("'For security, wait {seconds} seconds before asking again.':"));
});

test('the language choice on the account screens sits centred, with room above it', () => {
  const css = read('styles.css');
  assert.ok(css.includes('.auth-language{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:40px;'));
});

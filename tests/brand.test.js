const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('the Nellio logo files exist and are valid SVG images', () => {
  for (const name of ['nellio-logo', 'nellio-logo-white', 'nellio-symbol', 'nellio-symbol-white', 'nellio-icon', 'nellio-icon-hollow']) {
    const svg = read(`brand/${name}.svg`);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[^"]+">/, name);
    assert.ok(!/<script|<image|href=|font-family/.test(svg), `${name} has no script, no embedded images and no fonts`);
  }
  assert.match(read('brand/nellio-logo.svg'), /#315f4a/, 'the logo uses the Nellio green');
});

test('every screen shows the new logo instead of the old arrow mark with the word', () => {
  for (const file of ['builder.js', 'auth.js', 'candidate.js', 'legal.html']) {
    const src = read(file);
    assert.ok(!src.includes('<span class="brand-mark">↗</span>'), `${file}: no old arrow mark left`);
    assert.ok(!src.includes('<span class="brand">nellio</span>'), `${file}: no plain text brand left`);
  }
  assert.ok(read('builder.js').split('src="brand/nellio-logo.svg"').length - 1 >= 14, 'every app header uses the logo');
  // o painel verde escuro das telas de entrada usa o logo branco
  assert.equal(read('auth.js').split('<section class="auth-story"><a class="brand" href="#"><img class="brand-logo" src="brand/nellio-logo-white.svg"').length - 1, 5);
  assert.ok(read('styles.css').includes('.auth-story{background:var(--green);color:var(--surface)}'));
  assert.ok(read('candidate.js').includes('src="brand/nellio-logo.svg"'));
  assert.ok(read('legal.html').includes('src="brand/nellio-logo.svg"'));
  // the loading cards show the symbol alone
  assert.ok(read('builder.js').includes('src="brand/nellio-symbol.svg"'));
});

test('the favicon is the Nellio icon on every page, and the logo CSS is versioned for the legal page too', () => {
  for (const file of ['index.html', 'apply.html', 'legal.html']) {
    assert.ok(read(file).includes('<link rel="icon" type="image/svg+xml" href="brand/nellio-icon.svg">'), file);
  }
  const css = read('styles.css');
  assert.match(css, /\.brand-logo\{display:block;height:36px;width:auto\}/);
  assert.match(css, /\.brand-symbol\{/);
  assert.ok(read('legal.html').includes('styles.css?v=mw3-20261117i'));
});

// ---- E-mails (2026-11-17): the logo is a PNG hosted on the Nellio site, because e-mail clients do not show SVG ----
const EMAIL_LOGO = 'https://nellio.app/brand/nellio-logo-email.png';
const logoTag = html => html.match(/<img src="https:\/\/nellio\.app\/brand\/nellio-logo-email\.png"[^>]*>/)?.[0] || '';

test('the e-mail logo is a transparent PNG of 360 x 115 pixels', () => {
  const png = fs.readFileSync(path.join(root, 'brand/nellio-logo-email.png'));
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  assert.equal(png.readUInt32BE(16), 360);
  assert.equal(png.readUInt32BE(20), 115);
  assert.equal(png[25], 6, 'colour type 6 = RGBA, so the background is transparent');
  assert.ok(png.length < 40 * 1024, 'light file');
});

test('the candidate confirmation e-mail and the downgrade e-mails start with the logo, in every language', async () => {
  const { buildConfirmationEmail, LOGO_URL } = await import('../supabase/functions/applications/email.ts');
  assert.equal(LOGO_URL, EMAIL_LOGO);
  for (const language of ['en', 'pt', 'es']) {
    const mail = buildConfirmationEmail({ name: 'Alex', jobTitle: 'Designer', companyName: 'Acme', language });
    const tag = logoTag(mail.html);
    assert.ok(tag, `confirmation ${language} has the logo`);
    assert.match(tag, /width="120" height="38" alt="Nellio"/);
    assert.ok(mail.html.indexOf('<img') < mail.html.indexOf('<h1'), 'the logo comes before the heading');
    assert.ok(!mail.text.includes('<img'), 'the plain-text part has no markup');
  }
  const { buildDowngradeEmail } = await import('../supabase/functions/billing/downgrade-email.ts');
  for (const language of ['en', 'pt-BR', 'es']) {
    const mail = buildDowngradeEmail({ kind: 'confirmation', workspaceName: 'Acme', effectiveAt: '2026-12-09T12:27:29Z', keepCompanyName: 'Keep', removedCompanyNames: ['Old'], planUrl: 'https://example.test/index.html#my-plan', language });
    assert.ok(logoTag(mail.html), `downgrade ${language} has the logo`);
  }
  assert.equal(read('supabase/functions/billing/downgrade-email.ts'), read('supabase/functions/billing-reconcile/downgrade-email.ts'), 'the two copies stay identical');
});

test('the Supabase Auth templates show the logo instead of the plain "Nellio" label', () => {
  for (const name of ['confirm-signup', 'reset-password']) {
    const html = read(`supabase/auth-templates/${name}.html`);
    assert.ok(logoTag(html), `${name} has the logo`);
    assert.match(logoTag(html), /alt="Nellio"/);
    assert.ok(!/text-transform:uppercase;color:#315f4a;font-weight:700;">Nellio<\/p>/.test(html), `${name}: the text label is gone`);
  }
});

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
  // the symbol is for the favicon and brand files only: no symbol on loading or empty screens
  assert.ok(!read('builder.js').includes('brand-symbol'));
  assert.ok(!read('auth.js').includes('brand-symbol'));
});

test('the favicon is the Nellio icon on every page, and the logo CSS is versioned for the legal page too', () => {
  for (const file of ['index.html', 'apply.html', 'legal.html']) {
    assert.ok(read(file).includes('<link rel="icon" type="image/svg+xml" href="brand/nellio-icon.svg">'), file);
  }
  const css = read('styles.css');
  assert.match(css, /\.brand-logo\{display:block;height:36px;width:auto\}/);
  assert.ok(!css.includes('.brand-symbol'));
  assert.ok(read('legal.html').includes('styles.css?v=mw3-20261117j'));
});

// ---- E-mails (2026-11-17): the header is a PNG hosted on the Nellio site (dark green, curved bottom edge, white logo), because e-mail clients do not show SVG ----
const EMAIL_HEADER = 'https://nellio.app/brand/nellio-email-header.png';
const headerTag = html => html.match(/<img src="https:\/\/nellio\.app\/brand\/nellio-email-header\.png"[^>]*>/)?.[0] || '';

test('the e-mail header is a transparent PNG of 1040 x 220 pixels', () => {
  const png = fs.readFileSync(path.join(root, 'brand/nellio-email-header.png'));
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  assert.equal(png.readUInt32BE(16), 1040);
  assert.equal(png.readUInt32BE(20), 220);
  assert.equal(png[25], 6, 'colour type 6 = RGBA, so the corners and the curve are transparent');
  assert.ok(png.length < 40 * 1024, 'light file');
  assert.ok(!fs.existsSync(path.join(root, 'brand/nellio-logo-email.png')), 'the first small logo PNG is gone');
});

test('the candidate confirmation e-mail and the downgrade e-mails start with the header, in every language', async () => {
  const { buildConfirmationEmail, HEADER_URL } = await import('../supabase/functions/applications/email.ts');
  assert.equal(HEADER_URL, EMAIL_HEADER);
  for (const language of ['en', 'pt', 'es']) {
    const mail = buildConfirmationEmail({ name: 'Alex', jobTitle: 'Designer', companyName: 'Acme', language });
    const tag = headerTag(mail.html);
    assert.ok(tag, `confirmation ${language} has the header`);
    assert.match(tag, /width="520" height="110" alt="Nellio"/);
    assert.equal(mail.html.split('<img').length - 1, 1, 'the header is the only image');
    assert.ok(mail.html.indexOf('<img') < mail.html.indexOf('<h1'), 'the header comes before the heading');
    assert.ok(!mail.text.includes('<img'), 'the plain-text part has no markup');
  }
  const { buildDowngradeEmail } = await import('../supabase/functions/billing/downgrade-email.ts');
  for (const language of ['en', 'pt-BR', 'es']) {
    const mail = buildDowngradeEmail({ kind: 'confirmation', workspaceName: 'Acme', effectiveAt: '2026-12-09T12:27:29Z', keepCompanyName: 'Keep', removedCompanyNames: ['Old'], planUrl: 'https://example.test/index.html#my-plan', language });
    assert.ok(headerTag(mail.html), `downgrade ${language} has the header`);
  }
  assert.equal(read('supabase/functions/billing/downgrade-email.ts'), read('supabase/functions/billing-reconcile/downgrade-email.ts'), 'the two copies stay identical');
});

test('the Supabase Auth templates start with the header', () => {
  for (const name of ['confirm-signup', 'reset-password']) {
    const html = read(`supabase/auth-templates/${name}.html`);
    assert.ok(headerTag(html), `${name} has the header`);
    assert.match(headerTag(html), /alt="Nellio"/);
    assert.ok(html.indexOf('nellio-email-header.png') < html.indexOf('<h1'), 'the header comes before the heading');
    assert.ok(!/text-transform:uppercase;color:#315f4a;font-weight:700;">Nellio<\/p>/.test(html), `${name}: the text label is gone`);
  }
});

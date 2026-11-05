const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const LOCALES = ['pt-BR', 'es'];

// Loads the dictionaries and i18n.js in a small fake browser.
function loadI18n({ languages = ['en-US'], stored = null } = {}) {
  const storage = new Map(stored ? [['pathway_ui_language', stored]] : []);
  const window = {
    localStorage: { getItem: key => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) }
  };
  const document = { documentElement: { lang: 'en' } };
  const context = vm.createContext({ window, document, navigator: { languages, language: languages[0] }, Intl });
  for (const file of ['locales/pt-BR.js', 'locales/es.js', 'i18n.js']) vm.runInContext(read(file), context, { filename: file });
  return { i18n: window.PathwayI18n, locales: window.PathwayLocales, storage, document };
}

// Every t('…') / tn('…', '…', n) key written in the code that is already translated.
const TRANSLATED_FILES = ['builder.js', 'candidate.js', 'geo.js', 'auth.js'];
// Where a dictionary key may come from: t() calls, but also English texts passed to t() as values (field labels, list options,
// server messages shown through t(error.message)). A key that appears in none of these files is an old, unused translation.
const SOURCE_FILES = ['builder.js', 'candidate.js', 'geo.js', 'auth.js', 'pathway.js', 'backend.js', 'apply.html', 'supabase/functions/applications/index.ts', 'supabase/functions/billing/index.ts'];
function keysUsed(source) {
  const keys = new Set();
  const literal = String.raw`'((?:[^'\\]|\\.)*)'`;
  for (const match of source.matchAll(new RegExp(String.raw`\bt\(\s*` + literal, 'g'))) keys.add(match[1].replace(/\\'/g, "'"));
  for (const match of source.matchAll(new RegExp(String.raw`\btn\(\s*` + literal + String.raw`\s*,\s*` + literal, 'g'))) keys.add(match[1].replace(/\\'/g, "'"));
  return keys;
}
const placeholders = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('the browser language is used until the person chooses one, and pt/es variants map to the supported codes', () => {
  assert.equal(loadI18n({ languages: ['pt-PT', 'en'] }).i18n.language, 'pt-BR');
  assert.equal(loadI18n({ languages: ['es-MX'] }).i18n.language, 'es');
  assert.equal(loadI18n({ languages: ['fr-FR', 'de'] }).i18n.language, 'en');
  const { i18n, document } = loadI18n({ languages: ['en-US'], stored: 'es' });
  assert.equal(i18n.language, 'es');
  assert.equal(document.documentElement.lang, 'es');
});

test('setPreference saves the choice for the sign-in screens and null goes back to the browser language', () => {
  const { i18n, storage, document } = loadI18n({ languages: ['es-AR'] });
  assert.equal(i18n.setPreference('pt-BR'), 'pt-BR');
  assert.equal(storage.get('pathway_ui_language'), 'pt-BR');
  assert.equal(document.documentElement.lang, 'pt-BR');
  assert.equal(i18n.preference, 'pt-BR');
  assert.equal(i18n.setPreference(null), 'es');
  assert.equal(storage.has('pathway_ui_language'), false);
  assert.equal(i18n.preference, null);
  assert.equal(i18n.setPreference('klingon'), 'es', 'an unknown code is treated as automatic');
});

test('t() translates, fills variables and falls back to English; tn() picks the plural form', () => {
  const { i18n } = loadI18n();
  assert.equal(i18n.t('Settings'), 'Settings');
  assert.equal(i18n.t('Rename {name}', { name: 'Acme' }), 'Rename Acme');
  i18n.setPreference('pt-BR');
  assert.equal(i18n.t('Settings'), 'Configurações');
  assert.equal(i18n.t('Rename {name}', { name: 'Acme' }), 'Renomear Acme');
  assert.equal(i18n.t('A text nobody translated yet'), 'A text nobody translated yet');
  const one = 'This also deletes your workspace and all its data, and immediately cancels its subscription.';
  const other = 'This also deletes all {count} workspaces you own and all their data, and immediately cancels their subscriptions.';
  assert.match(i18n.tn(one, other, 1), /^Isso também exclui o seu workspace/);
  assert.match(i18n.tn(one, other, 3), /os 3 workspaces/);
  i18n.setPreference('en');
  assert.equal(i18n.tn(one, other, 1), one);
  assert.equal(i18n.tn(one, other, 2), other.replace('{count}', '2'));
});

test('dates and numbers follow the interface language', () => {
  const { i18n } = loadI18n();
  assert.equal(i18n.formatNumber(1234.5), '1,234.5');
  i18n.setPreference('pt-BR');
  assert.equal(i18n.formatNumber(1234.5), '1.234,5');
  assert.equal(i18n.formatDate('2026-11-05T12:00:00Z', { day: 'numeric', month: 'long', timeZone: 'UTC' }), '5 de novembro');
  assert.equal(i18n.formatDate('not a date'), '');
});

test('both dictionaries have the same keys, the same {variables} as the English key, and only safe characters', () => {
  const { locales } = loadI18n();
  const [pt, es] = LOCALES.map(code => locales[code]);
  assert.deepEqual(Object.keys(pt).sort(), Object.keys(es).sort(), 'pt-BR and es must translate the same texts');
  for (const code of LOCALES) {
    for (const [key, value] of Object.entries(locales[code])) {
      const forms = typeof value === 'string' ? [value] : Object.values(value);
      if (typeof value !== 'string') assert.ok(value.one && value.other, `${code}: plural "${key}" needs one and other`);
      for (const form of forms) {
        assert.equal(typeof form, 'string', `${code}: "${key}"`);
        assert.doesNotMatch(form, /[<>"`]/, `${code}: "${key}" must not contain < > " or \``);
        const expected = typeof value === 'string' ? placeholders(key) : null;
        if (expected) assert.deepEqual(placeholders(form), expected, `${code}: "${key}" must keep the same {variables}`);
      }
    }
  }
});

test('every text the translated screens send through t()/tn() exists in both dictionaries, and no translation is left unused', () => {
  const { locales } = loadI18n();
  const used = new Set();
  for (const file of TRANSLATED_FILES) for (const key of keysUsed(read(file))) used.add(key);
  assert.ok(used.size > 50, 'the scan finds the keys');
  const sources = SOURCE_FILES.map(read).join('\n');
  const appears = key => ["'", '"', '`'].some(quote => sources.includes(quote + key + quote));
  for (const code of LOCALES) {
    const missing = [...used].filter(key => !(key in locales[code]));
    assert.deepEqual(missing, [], `${code} is missing translations`);
    const unused = Object.keys(locales[code]).filter(key => !used.has(key) && !appears(key));
    assert.deepEqual(unused, [], `${code} has translations no code uses (old English text?)`);
  }
});

test('the candidate page translates every field label, list option and candidate-facing server message', () => {
  const { locales } = loadI18n();
  const sandbox = { window: {}, document: {}, fetch() {}, Intl };
  vm.runInNewContext(read('pathway.js'), sandbox);
  vm.runInNewContext(read('geo.js'), sandbox);
  const C = sandbox.window.PathwayCore, G = sandbox.window.PathwayGeo;
  const texts = new Set([
    ...C.OPTIONAL_FIELDS.filter(field => field.type !== 'diversity').map(field => field.label),
    ...Object.values(C.FIELD_META).map(meta => meta.label),
    ...G.PRONOUNS, G.PRONOUN_OTHER,
    ...G.DIVERSITY_KEYS.flatMap(key => [G.DIVERSITY[key].label, ...G.DIVERSITY[key].options])
  ]);
  // Errors the applications function sends back to the candidate's page (internal errors are left out on purpose).
  const internal = new Set(['Invalid body', 'Application service is not configured.']);
  for (const match of read('supabase/functions/applications/index.ts').matchAll(/new Error\("([^"$]+)"\)/g)) if (!internal.has(match[1])) texts.add(match[1]);
  for (const code of LOCALES) {
    const missing = [...texts].filter(text => !(text in locales[code]));
    assert.deepEqual(missing, [], `${code} is missing candidate texts`);
  }
});

test('forLanguage gives a translator fixed to the job language without touching the person\'s choice', () => {
  const { i18n, storage } = loadI18n({ languages: ['en-US'] });
  const pt = i18n.forLanguage('pt');
  assert.equal(pt.language, 'pt-BR');
  assert.equal(pt.t('Apply for this role'), 'Candidatar-se a esta vaga');
  assert.equal(i18n.forLanguage('es').t('Question {number}', { number: 2 }), 'Pregunta 2');
  assert.equal(i18n.forLanguage(null).t('Apply for this role'), 'Apply for this role', 'a job without a language is in English');
  assert.equal(i18n.language, 'en');
  assert.equal(storage.has('pathway_ui_language'), false);
});

test('country names are shown in the job language but stored and checked in English', () => {
  const sandbox = { window: {}, document: {}, fetch() {}, Intl };
  vm.runInNewContext(read('geo.js'), sandbox);
  const G = sandbox.window.PathwayGeo;
  const brazil = G.countryItems('pt-BR').find(item => item.value === 'Brazil');
  assert.equal(brazil.label, 'Brasil');
  assert.equal(G.countryItems('en').find(item => item.value === 'Germany').label, 'Germany', 'English stays as before');
  assert.equal(G.countryValue('Estados Unidos', 'pt-BR'), 'United States');
  assert.equal(G.countryValue('united states', 'pt-BR'), 'United States', 'the English name is accepted too');
  assert.equal(G.countryLabel('Germany', 'es'), 'Alemania');
  assert.equal(G.countryValue('Atlantis', 'es'), 'Atlantis', 'unknown text is kept (the server rejects it)');
  assert.ok(G.countryItems('pt-BR').every(item => G.COUNTRY_NAMES.includes(item.value)));
  const candidate = read('candidate.js');
  assert.match(candidate, /state\.info\.country = G\.countryValue\(state\.info\.country, tr\.language\)/);
  assert.match(candidate, /<option value="\$\{C\.esc\(option\)\}">\$\{C\.esc\(t\(option\)\)\}<\/option>/, 'list values stay in English, only the text is translated');
});

test('the public page and the editor preview follow the job language, never the recruiter\'s', () => {
  const sql = read('supabase/migrations/20261105150000_published_flow_language.sql');
  assert.match(sql, /\|\| jsonb_build_object\('jobLanguage', f\.interview_language\)/);
  for (const filter of ["f.publication_status = 'published'", 'f.active_published_flow_id = pf.id', 'public.flow_data_is_valid(f.flow_data)', 'public.workspace_has_active_subscription(pf.workspace_id)']) assert.ok(sql.includes(filter), filter);
  assert.match(sql, /\(n\.node - 'autoFailOptions'\) - 'autoFailBelow'/, 'auto-fail rules stay hidden from candidates');
  const candidate = read('candidate.js');
  assert.match(candidate, /const jobLanguage = options\.language !== undefined \? options\.language : sourceFlow && sourceFlow\.jobLanguage;/);
  assert.match(candidate, /if \(I18N\) tr = I18N\.forLanguage\(jobLanguage\);/);
  assert.match(candidate, /G\.enhanceForm\(form, tr\)/);
  assert.ok(read('builder.js').includes("{ preview: true, onFinish: finish, language: flow.interviewLanguage || null }"), 'the editor preview uses the job language');
  const html = read('apply.html');
  const at = name => html.indexOf(`<script src="${name}?v=mw3-20261105y"></script>`);
  for (const file of ['locales/pt-BR.js', 'locales/es.js', 'i18n.js']) assert.ok(at(file) > 0 && at(file) < at('candidate.js'), `${file} loads before candidate.js`);
});

test('the confirmation e-mail is written in the job language; English stays exactly as before', async () => {
  const { buildConfirmationEmail, emailLanguage } = await import('../supabase/functions/applications/email.ts');
  assert.equal(emailLanguage('pt'), 'pt');
  assert.equal(emailLanguage(null), 'en');
  assert.equal(emailLanguage('fr'), 'en');
  const en = buildConfirmationEmail({ name: 'Alex', jobTitle: 'Cook', companyName: 'Acme', language: null });
  assert.equal(en.subject, 'We received your application for Cook at Acme');
  const pt = buildConfirmationEmail({ name: 'Ana', jobTitle: 'Advogada', companyName: 'Acme', language: 'pt' });
  assert.equal(pt.subject, 'Recebemos sua candidatura para Advogada – Acme');
  assert.match(pt.text, /^Olá, Ana,/);
  assert.match(pt.html, /<html lang="pt-BR">/);
  assert.match(pt.html, /Obrigado por se candidatar, Ana\./);
  const es = buildConfirmationEmail({ name: '', jobTitle: 'Chef', companyName: 'Acme', language: 'es' });
  assert.equal(es.subject, 'Recibimos su postulación para Chef – Acme');
  assert.match(es.text, /^Hola:/);
  assert.match(es.html, /Gracias por postularse\./);
  const index = read('supabase/functions/applications/index.ts');
  assert.match(index, /select\("id,workspace_id,publication_status,active_published_flow_id,interview_language"\)/);
  assert.match(index, /sendApplicationConfirmation\(submissionKey, normalized\.email, normalized\.name, active\.snapshot, active\.flow\.interview_language\)/);
});

test('the hiring app loads the dictionaries and i18n.js before the app code, and Settings saves the language in the profile', () => {
  const html = read('index.html');
  const at = name => html.indexOf(`<script src="${name}?v=mw3-20261105y"></script>`);
  for (const file of ['locales/pt-BR.js', 'locales/es.js', 'i18n.js']) assert.ok(at(file) > 0, `${file} is loaded`);
  assert.ok(at('i18n.js') < at('backend.js') && at('i18n.js') < at('auth.js') && at('i18n.js') < at('builder.js'));
  const builder = read('builder.js');
  assert.match(builder, /const \{ t, tn \} = window\.PathwayI18n;/);
  assert.match(builder, /id="settings-language"/);
  assert.match(builder, /window\.PathwayBackend\.updateMyLanguage\(chosen\)/);
  assert.match(builder, /if \(myProfile\) window\.PathwayI18n\.setPreference\(myProfile\.uiLanguage \|\| null\);/);
  const backend = read('backend.js');
  assert.match(backend, /select\('first_name,last_name,ui_language'\)/);
  assert.match(backend, /update\(\{ ui_language: value \}\)/);
  assert.match(backend, /updateMyLanguage,/);
});

test('the migration limits the language to the three codes and lets a person update only that column of their own row', () => {
  const sql = read('supabase/migrations/20261105120000_profile_ui_language.sql');
  assert.match(sql, /add column if not exists ui_language text/);
  assert.match(sql, /check \(ui_language is null or ui_language in \('en', 'pt-BR', 'es'\)\)/);
  assert.match(sql, /grant update \(ui_language\) on public\.profiles to authenticated;/);
  assert.doesNotMatch(sql, /grant update on public\.profiles/);
});

test('the standard board stages and the AI interview tags of the cards are translated (their keys never change)', () => {
  const { locales } = loadI18n();
  const builder = read('builder.js');
  const stages = builder.match(/const standardApplicantStages = \[([\s\S]*?)\n  \];/)[1];
  const labels = [...stages.matchAll(/label: '([^']+)'/g)].map(match => match[1]);
  assert.equal(labels.length, 11);
  const tagBlock = builder.slice(builder.indexOf('const AI_BLOCK_TEXT = {'), builder.indexOf('// The impression is shown as a thumb'));
  const tags = [...tagBlock.matchAll(/\['([^']+)', '(?:wait|ok|warn|muted)'\]|\[\s*'([^']+)', '[^']+'\]|\['(Interview waiting)'\]/g)].map(match => match[1] || match[2] || match[3]);
  assert.ok(tags.length >= 13, 'the tag texts are found');
  for (const code of LOCALES) {
    const missing = [...labels, ...tags].filter(text => !(text in locales[code]));
    assert.deepEqual(missing, [], `${code} is missing stage or tag texts`);
  }
  assert.match(builder, /standardApplicantStages\.forEach\(stage => \{ const english = stage\.label; Object\.defineProperty\(stage, 'label', \{ get: \(\) => t\(english\), enumerable: true \}\); \}\);/);
});

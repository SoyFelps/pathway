const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

function loadGeo(fetchImpl) {
  const sandbox = { window: {}, document: {}, fetch: fetchImpl || (() => Promise.reject(new Error('no network in tests'))), Intl, Event: class {} };
  vm.runInNewContext(read('geo.js'), sandbox);
  return sandbox.window.PathwayGeo;
}
function loadCore() {
  const sandbox = { window: {}, document: {}, localStorage: { getItem() { return null; }, setItem() {} }, crypto: { randomUUID: () => 'x' }, TextEncoder, TextDecoder, btoa, atob };
  vm.runInNewContext(read('pathway.js'), sandbox);
  return sandbox.window.PathwayCore;
}
const G = loadGeo();
const plain = value => JSON.parse(JSON.stringify(value)); // values made inside the vm have their own Array type

test('the details an employer can ask for: work authorization and address are gone, the rest are lists where it matters', () => {
  const core = loadCore();
  const byKey = Object.fromEntries(core.OPTIONAL_FIELDS.map(field => [field.key, field]));
  assert.deepEqual(plain(core.OPTIONAL_FIELDS.map(field => field.key)), ['phone', 'country', 'city', 'linkedin', 'portfolio', 'pronouns']);
  assert.equal(byKey.country.label, 'Country of birth');
  assert.equal(byKey.country.type, 'country');
  assert.equal(byKey.city.label, 'Current location', 'one field: the current location is a city');
  assert.equal(byKey.currentCountry, undefined, 'the separate country-only list is gone');
  assert.equal(byKey.city.type, 'city');
  assert.equal(byKey.city.type, 'city');
  assert.equal(byKey.pronouns.type, 'pronouns');
  assert.equal(byKey.workAuthorization, undefined);
  assert.equal(byKey.address, undefined);
});

test('answers given before the change stay readable in the candidate panel', () => {
  const core = loadCore();
  assert.equal(core.infoFieldLabel('address'), 'Address');
  assert.equal(core.infoFieldLabel('workAuthorization'), 'Work authorization');
  assert.equal(core.infoFieldLabel('currentCountry'), 'Current country');
  assert.equal(core.infoFieldLabel('city'), 'Current location');
  assert.equal(core.infoFieldLabel('somethingElse'), 'somethingElse');
  assert.match(read('builder.js'), /C\.infoFieldLabel\(key\)/);
});

test('the country list has every country once and each name is something people recognise', () => {
  assert.ok(G.COUNTRIES.length >= 249);
  assert.equal(new Set(G.COUNTRIES.map(country => country[0])).size, G.COUNTRIES.length, 'no repeated ISO code');
  assert.equal(new Set(G.COUNTRY_NAMES).size, G.COUNTRY_NAMES.length, 'no repeated name');
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const unknown = G.COUNTRIES.filter(([code]) => code !== 'XK').filter(([code]) => { try { return names.of(code) === code; } catch { return true; } });
  assert.deepEqual(plain(unknown.map(country => country[0])), [], 'every code is a real region code');
  ['Brazil', 'United States', 'United Kingdom', 'Türkiye', 'Czechia', 'South Korea'].forEach(name => assert.ok(G.COUNTRY_NAMES.includes(name), name));
});

test('typing finds countries however people spell them (accents, short names, old names)', () => {
  const items = G.countryItems();
  const first = query => (G.rankItems(items, query, 300)[0] || {}).label;
  assert.equal(first('bra'), 'Brazil');
  assert.equal(first('brasil'), 'Brazil');
  assert.equal(first('usa'), 'United States');
  assert.equal(first('uk'), 'United Kingdom');
  assert.equal(first('turkey'), 'Türkiye');
  assert.equal(first('czech republic'), 'Czechia');
  assert.equal(first('sao tome'), 'São Tomé and Príncipe');
  assert.equal(first('ivory coast'), 'Côte d’Ivoire');
  assert.deepEqual(plain(G.rankItems(items, 'zzzz', 10)), []);
  assert.equal(G.rankItems(items, '', 300).length, items.length, 'an empty search shows the whole list');
  assert.ok(G.rankItems(items, 'united', 300).map(item => item.label).includes('United Arab Emirates'));
});

test('the pronoun options, with "Other" for anything else', () => {
  assert.deepEqual(plain(G.PRONOUNS.slice(0, 3)), ['He/him', 'She/her', 'They/them']);
  assert.ok(G.PRONOUNS.includes('Prefer not to say'));
  assert.equal(G.joinPronouns('She/her', ''), 'She/her');
  assert.equal(G.joinPronouns('Other', '  fae/faer  '), 'Other: fae/faer');
  assert.equal(G.joinPronouns('Other', ''), 'Other');
  assert.equal(G.joinPronouns('Other', 'x'.repeat(100)).length, 'Other: '.length + G.PRONOUN_OTHER_MAX);
  assert.equal(G.joinPronouns('', ''), '');
  assert.equal(G.joinPronouns('Made up', ''), '', 'only listed values');
  assert.deepEqual({ ...G.splitPronouns('Other: fae/faer') }, { choice: 'Other', other: 'fae/faer' });
  assert.deepEqual({ ...G.splitPronouns('They/them') }, { choice: 'They/them', other: '' });
  assert.deepEqual({ ...G.splitPronouns('whatever') }, { choice: '', other: '' });
});

test('city search runs on the bundled list: ranking, state and country in the label, accents ignored', async () => {
  const data = JSON.parse(read('vendor/geonames/cities15000.json'));
  const geo = loadGeo(() => Promise.resolve({ ok: true, json: () => Promise.resolve(data) }));
  const cities = await geo.loadCityItems();
  assert.ok(cities.length > 30000);
  const top = (query, n = 1) => geo.rankItems(cities, query, 8).slice(0, n).map(item => item.label);
  assert.match(top('sao paulo')[0], /^São Paulo, .*Brazil$/);
  assert.match(top('munich')[0], /^Munich, Bavaria, Germany$/);
  assert.match(top('lisbon')[0], /Portugal$/);
  assert.match(top('new york')[0], /United States$/);
  assert.match(top('london, canada')[0], /Ontario, Canada$/, 'a country (or state) typed after the name narrows the search');
  assert.ok(top('springfield', 8).length >= 5, 'several cities with the same name are all offered');
  assert.equal(top('qqqqqq').length, 0);
  assert.ok(top('rio de').some(label => /Rio de Janeiro/.test(label)));
});

test('the city list file credits its source and says how it was built', () => {
  const readme = read('vendor/geonames/README.md');
  assert.match(readme, /CC BY 4\.0/);
  assert.match(readme, /geonames\.org/);
  assert.match(read('legal.html'), /GeoNames/);
  assert.match(read('legal.html'), /phone number, country of birth, current location \(city\), LinkedIn profile, portfolio website, pronouns/);
  const data = JSON.parse(read('vendor/geonames/cities15000.json'));
  assert.equal(data.v, 1);
  assert.ok(Array.isArray(data.cities) && Array.isArray(data.regions) && Array.isArray(data.countries));
  const known = new Set(G.COUNTRIES.map(country => country[0]));
  assert.deepEqual(plain(data.countries.filter(code => !known.has(code))), [], 'every country code in the city list is in the country list');
});

test('the server uses the very same lists as the form and refuses anything else', () => {
  const ts = read('supabase/functions/applications/geo.ts');
  const names = JSON.parse(ts.match(/COUNTRY_NAMES: string\[\] = (\[[^;]*\]);/)[1]);
  assert.deepEqual(names, plain(G.COUNTRY_NAMES), 'geo.ts is out of date: run node supabase/functions/applications/make-geo.js');
  assert.deepEqual(JSON.parse(ts.match(/PRONOUNS: string\[\] = (\[[^;]*\]);/)[1]), plain(G.PRONOUNS));
  assert.match(ts, /PRONOUN_OTHER_MAX = 40/);
  const index = read('supabase/functions/applications/index.ts');
  assert.match(index, /import \{ COUNTRY_NAMES, PRONOUNS, PRONOUN_OTHER, PRONOUN_OTHER_MAX \} from "\.\/geo\.ts"/);
  assert.match(index, /new Set\(\["phone", "country", "city", "linkedin", "portfolio", "pronouns"\]\)/);
  assert.doesNotMatch(index, /workAuthorization|"address"/, 'work authorization and address are not accepted any more');
  assert.match(index, /countries\.has\(text\)/);
  assert.match(index, /Choose your pronouns from the list/);
});

test('both pages load geo.js before candidate.js, with the shared version string', () => {
  for (const page of ['index.html', 'apply.html']) {
    const html = read(page);
    const geo = html.indexOf('<script src="geo.js?v=');
    const candidate = html.indexOf('<script src="candidate.js?v=');
    assert.ok(geo > 0 && geo < candidate, page + ': geo.js comes first');
    assert.equal(html.match(/geo\.js\?v=([^"]+)/)[1], html.match(/candidate\.js\?v=([^"]+)/)[1]);
  }
});

test('the form builds the right control for each kind of detail', () => {
  const candidate = read('candidate.js');
  assert.match(candidate, /data-geo="\$\{meta\.type\}"/, 'country and city: a searchable text box');
  assert.match(candidate, /<select id="candidate-pronouns" name="pronouns" data-geo="pronouns">/);
  assert.match(candidate, /G\.joinPronouns\(/);
  assert.match(candidate, /G\.enhanceForm\(form\)/);
  const css = read('styles.css');
  assert.match(css, /\.combo-list\{position:absolute/);
  assert.match(css, /\.candidate-field select/);
});

test('the resume field is a drop area with the real file input inside it (no browser-language button)', () => {
  const candidate = read('candidate.js');
  const html = candidate.slice(candidate.indexOf('function resumeUploadHtml'), candidate.indexOf('function formatFileSize'));
  assert.match(html, /<input id="candidate-resume" name="resume" type="file"/, 'the real input keeps the name the server expects');
  assert.match(html, /required class="upload-native"/);
  assert.match(html, /PDF, DOC or DOCX · up to 10 MB/);
  assert.match(candidate, /if \(key === 'resume'\) return resumeUploadHtml\(meta\);/);
  assert.match(candidate, /bindResumeUpload\(form, \(\) => state\.resumeFile\);/);
  assert.match(candidate, /Your resume must be 10 MB or smaller\./);
  assert.match(candidate, /Upload your resume as a PDF, DOC or DOCX file\./);
  const css = read('styles.css');
  assert.match(css, /\.upload-native\{position:absolute!important;inset:0;[^}]*opacity:0/, 'invisible input covering the whole area: click, drop, keyboard and validation still work');
  assert.match(css, /\.upload-box\.has-file\{/);
  assert.match(css, /\.upload-drop:focus-within \.upload-box\{/, 'keyboard focus is visible');
});

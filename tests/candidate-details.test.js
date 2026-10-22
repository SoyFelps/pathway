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
  assert.deepEqual(plain(core.OPTIONAL_FIELDS.map(field => field.key)), ['phone', 'country', 'city', 'linkedin', 'portfolio', 'pronouns', 'diversity']);
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
  assert.match(index, /import \{ COUNTRY_NAMES, DIVERSITY, DIVERSITY_KEYS, PRONOUNS, PRONOUN_OTHER, PRONOUN_OTHER_MAX \} from "\.\/geo\.ts"/);
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
  assert.match(candidate, /<select id="candidate-pronouns" name="pronouns" data-geo="pronouns" required>/);
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

test('every detail the employer ticks is required (no asterisks: they would mark everything)', () => {
  const candidate = read('candidate.js');
  assert.match(candidate, /const required = 'required';/);
  assert.doesNotMatch(candidate, /\(!optional \|\| key === 'resume'\)/, 'no detail is optional any more');
  assert.match(candidate, /placeholder="Type or select" required>/, 'country and city lists are required');
  assert.doesNotMatch(candidate, /<span aria-hidden="true">\*<\/span>/, 'no asterisks anywhere in the candidate form');
  assert.match(read('geo.js'), /other\.required = !other\.hidden/, 'the "Other" pronouns box is required while it is shown');
  const index = read('supabase/functions/applications/index.ts');
  assert.match(index, /if \(!text\) throw new Error\(`Enter your \$\{detailNames\[key\]\}\.`\);/, 'the server enforces it too');
});

test('the diversity questions: a second, voluntary page with "Prefer not to say" in every list', () => {
  const core = loadCore();
  const field = core.OPTIONAL_FIELDS.find(item => item.key === 'diversity');
  assert.ok(field && field.type === 'diversity');
  assert.deepEqual(plain(G.DIVERSITY_KEYS), ['genderIdentity', 'sexualOrientation', 'raceEthnicity', 'disability', 'disabilityType']);
  G.DIVERSITY_KEYS.forEach(key => assert.ok(G.DIVERSITY[key].options.includes('Prefer not to say'), key + ' offers "Prefer not to say"'));
  assert.deepEqual(plain(G.DIVERSITY.disability.options), ['Yes', 'No', 'Prefer not to say']);
  assert.ok(G.DIVERSITY.raceEthnicity.options.includes('Hispanic or Latino'));
  const candidate = read('candidate.js');
  assert.match(candidate, /if \(meta\.type === 'diversity'\) return '';/, 'it is not a field of the first page');
  assert.match(candidate, /if \(askDiversity\) \{ state\.screen = 'diversity'; render\(\); return; \}/, 'the first page leads to the diversity page, then to the questions');
  assert.match(candidate, /function afterDetails\(\)/);
  assert.match(candidate, /askDiversity \? 'Continue' : live \? 'Apply for this role'/, 'the first button says Continue when another page follows');
  assert.match(candidate, /diversity: state\.diversity,/, 'the answers travel with the application');
  assert.match(candidate, /form\.elements\.disabilityType\.required = yes;/, 'the type of disability is asked only for "Yes"');
  assert.match(read('backend.js'), /form\.set\('diversity', JSON\.stringify\(application\.diversity\)\)/);
  assert.match(read('builder.js'), /field\.hint \?/, 'the editor explains it is a second page');
});

test('the diversity answers are validated by the server and kept apart from candidate_info (hidden from reviewers)', () => {
  const ts = read('supabase/functions/applications/geo.ts');
  assert.deepEqual(JSON.parse(ts.match(/DIVERSITY_KEYS: string\[\] = (\[[^;]*\]);/)[1]), plain(G.DIVERSITY_KEYS));
  const served = JSON.parse(ts.match(/DIVERSITY: Record<string, string\[\]> = (\{[^;]*\});/)[1]);
  G.DIVERSITY_KEYS.forEach(key => assert.deepEqual(served[key], plain(G.DIVERSITY[key].options), key));
  const index = read('supabase/functions/applications/index.ts');
  assert.match(index, /if \(configured\.diversity === true\)/, 'only when the employer asked');
  assert.match(index, /if \(key === "disabilityType" && answers\.disability !== "Yes"\) \{ answers\[key\] = ""; continue; \}/);
  assert.match(index, /if \(!DIVERSITY\[key\]\.includes\(value\)\) throw new Error/);
  assert.match(index, /admin\.from\("applicant_diversity"\)\.insert\(/);
  assert.doesNotMatch(index, /candidateInfo\.(genderIdentity|raceEthnicity|sexualOrientation)/, 'never mixed into candidate_info');
  const migration = read('supabase/migrations/20261022150000_applicant_diversity.sql');
  assert.match(migration, /create table public\.applicant_diversity/);
  assert.match(migration, /applicant_id uuid primary key references public\.applicants\(id\) on delete cascade/, 'deleted together with the candidate');
  assert.match(migration, /alter table public\.applicant_diversity enable row level security;/);
  assert.match(migration, /revoke all on public\.applicant_diversity from public, anon, authenticated;/, 'no reviewer can read it');
  assert.match(migration, /grant all on public\.applicant_diversity to service_role;/);
  assert.doesNotMatch(migration, /grant (select|insert|update|delete)[^;]* to authenticated/i);
  const builder = read('builder.js');
  assert.doesNotMatch(builder, /applicant_diversity|raceEthnicity|sexualOrientation/, 'the candidate panel and exports never show them');
});

test('the phone number: a country (calling code) list and a field written the way that country writes numbers', () => {
  const lib = require('../vendor/libphonenumber/libphonenumber-max.js');
  // typing digits gives the national format of the chosen country
  assert.equal(G.phoneNational(lib, 'BR', '31999998888'), '(31) 99999-8888', 'Brazil: (31) 99999-9999');
  assert.equal(G.phoneNational(lib, 'US', '2025550123'), '(202) 555-0123');
  assert.equal(G.phoneNational(lib, 'PT', '912345678'), '912 345 678');
  assert.equal(G.phoneNational(lib, 'BR', 'abc (31) 9.9999-8888 x'), '(31) 99999-8888', 'only the digits count');
  assert.equal(G.phoneExample(lib, 'BR'), '(31) 99999-9999', 'the placeholder shows the format');
  assert.equal(G.phoneExample(lib, 'ZZ'), '', 'no example for a country without one');
  // checking: valid for the chosen country only, stored with the country code
  const ok = G.phoneCheck(lib, 'BR', '(31) 99999-8888');
  assert.equal(ok.ok, true);
  assert.equal(ok.text, '+55 31 99999 8888');
  assert.equal(G.phoneCheck(lib, 'BR', '(31) 9999').ok, false, 'too short');
  assert.equal(G.phoneCheck(lib, 'PT', '(31) 99999-8888').ok, false, 'a Brazilian number is not a Portuguese one');
  assert.equal(G.phoneCheck(lib, 'BR', '').ok, false);
  // a number written with its country code says which country it is
  assert.deepEqual(plain(G.phoneParse(lib, '+55 31 99999 8888')), { iso: 'BR', national: '(31) 99999-8888' });
  assert.equal(G.phoneParse(lib, 'not a number'), null);
  const geo = read('geo.js');
  assert.match(geo, /PHONE_LIB_URL = 'vendor\/libphonenumber\/libphonenumber-max\.js\?v=1\.12\.10'/, 'self-hosted, not a third-party script');
  assert.match(geo, /PHONE_MAIN_COUNTRY = \{[^}]*44: 'GB'/, 'a shared calling code picks the main country');
  assert.match(geo, /setupPhone\(phoneCountry, phoneNumber\)/);
  const candidate = read('candidate.js');
  assert.match(candidate, /data-geo="phone-country"/);
  assert.match(candidate, /name="phone" type="tel" inputmode="tel" autocomplete="tel-national" data-geo="phone-number"/);
  assert.match(candidate, /state\.info\.phone = G\.readPhone\(form\)/, 'what is sent includes the country code');
  assert.match(candidate, /G\.fillPhone\(form, state\.info\.phone\)/, 'going back restores country and number');
});

test('the phone library is hosted on this site with its MIT license, and the server insists on a country code', () => {
  assert.ok(fs.existsSync(path.join(root, 'vendor/libphonenumber/libphonenumber-max.js')));
  assert.match(read('vendor/libphonenumber/LICENSE'), /MIT License/);
  assert.match(read('vendor/libphonenumber/README.md'), /libphonenumber-js@1\.12\.10/);
  const index = read('supabase/functions/applications/index.ts');
  assert.match(index, /key === "phone" && \(!\/\^\\\+\[0-9 \(\)-\]\+\$\/\.test\(text\)/);
  assert.match(index, /Enter a valid phone number, with its country code\./);
  // the rule, run for real
  const valid = text => /^\+[0-9 ()-]+$/.test(text) && text.replace(/[^0-9]/g, '').length >= 7 && text.replace(/[^0-9]/g, '').length <= 15;
  assert.equal(valid('+55 31 99999 8888'), true);
  assert.equal(valid('+1 202 555 0123'), true);
  assert.equal(valid('31999998888'), false, 'no country code');
  assert.equal(valid('+55 12'), false, 'too short');
  assert.equal(valid('+55 31 99999 8888 ext 12'), false, 'letters');
});

test('phone mask and digit limit: the field shows the shape of a number of the chosen country and takes no more digits than it can have', () => {
  const lib = require('../vendor/libphonenumber/libphonenumber-max.js');
  Object.assign(G.phoneExamples, require('../vendor/libphonenumber/examples.mobile.json'));
  assert.equal(G.phoneMask(lib, 'BR'), '(__) _____-____');
  assert.equal(G.phoneMask(lib, 'US'), '(___) ___-____');
  assert.equal(G.phoneMask(lib, 'PT'), '___ ___ ___');
  assert.equal(G.phoneMask(lib, 'GB'), '_____ ______', 'the way the country writes it, with the 0 people type in front');
  assert.ok(/^[_ ()-]+$/.test(G.phoneMask(lib, 'BG')), 'every country has a mask made of underscores');
  assert.equal(G.phoneMaxDigits(lib, 'BR'), 11);
  assert.equal(G.phoneMaxDigits(lib, 'US'), 10);
  // too many digits are dropped, letters never get in
  assert.equal(G.phoneNational(lib, 'BR', '3199998888812345'), '(31) 99998-8888');
  assert.equal(G.phoneNational(lib, 'US', '2025550123999'), '(202) 555-0123');
  assert.equal(G.phoneNational(lib, 'BR', '31a99b99-8888'), '(31) 99998-888');
  // too few digits are not a number
  assert.equal(G.phoneCheck(lib, 'BR', '(31) 9999-88').ok, false);
  assert.equal(G.phoneCheck(lib, 'BR', '(31) 99999-888').ok, false, 'a 10-digit number that starts like a mobile is not a number');
  assert.equal(G.phoneCheck(lib, 'BR', '(31) 99999-8888').ok, true, 'mobile: 11 digits');
  assert.equal(G.phoneCheck(lib, 'BR', '(31) 3333-4444').ok, true, 'landline: 10 digits');
  assert.equal(G.phoneCheck(lib, 'US', '(555) 555-0123').ok, false, 'an area code that does not exist');
  assert.equal(G.phoneCheck(lib, 'US', '(202) 555-012').ok, false);
  assert.equal(G.phoneCheck(lib, 'US', '(202) 555-0123').ok, true);
  assert.ok(fs.existsSync(path.join(root, 'vendor/libphonenumber/examples.mobile.json')));
  assert.match(read('geo.js'), /PHONE_EXAMPLES_URL = 'vendor\/libphonenumber\/examples\.mobile\.json/);
});

test('a country list opens whole when it is clicked, with the chosen text selected, so another country can be typed straight away', () => {
  const geo = read('geo.js');
  assert.match(geo, /fullListOnFocus = strict/, 'on for the lists where only a listed value is accepted');
  assert.match(geo, /input\.addEventListener\('focus', \(\) => \{ pristine = fullListOnFocus; if \(pristine\) setTimeout\(\(\) => \{ if \(document\.activeElement === input\) input\.select\(\); \}, 0\); open\(\); \}\);/);
  assert.match(geo, /rankItems\(all, pristine \? '' : value, maxResults\)/, 'an untouched list is not filtered by the value that is already there');
  assert.match(geo, /input\.addEventListener\('mouseup', event => \{ if \(pristine\) event\.preventDefault\(\); \}\)/, 'the click does not undo the selection');
  assert.match(geo, /input\.addEventListener\('input', \(\) => \{ pristine = false;/, 'typing filters as usual');
});

test('the country of the phone number is a button that opens a list with its own search box (not an editable text field)', () => {
  const geo = read('geo.js');
  const picker = geo.slice(geo.indexOf('function attachCountryPicker'), geo.indexOf('function setupPhone'));
  assert.match(picker, /<button type="button" class="country-picker-btn" aria-haspopup="listbox" aria-expanded="false"/);
  assert.match(picker, /<input type="search" class="country-picker-search" placeholder="Search country or code"/, 'the search box lives inside the list');
  assert.match(picker, /role="listbox"/);
  assert.match(picker, /search\.value = initial \|\| '';/, 'it always opens with an empty search and the whole list');
  assert.match(picker, /active = Math\.max\(0, !search\.value && selected \? shown\.indexOf\(selected\) : 0\);/, 'the chosen country is highlighted');
  assert.match(picker, /event\.key\.length === 1 && !event\.ctrlKey && !event\.metaKey && !event\.altKey[^)]*\) \{ event\.preventDefault\(\); open\(event\.key\); \}/, 'typing while the button is focused starts a search');
  assert.match(picker, /event\.key === 'Enter'[^}]*pick\(shown\[active\]\)/);
  assert.match(picker, /event\.key === 'Escape'[^}]*close\(true\)/, 'Escape closes and gives the focus back to the button');
  assert.match(picker, /document\.addEventListener\('mousedown', outside, true\)/, 'a click outside closes it');
  assert.match(geo, /onPick: item => \{ if \(item\.iso !== state\.iso\) setCountry\(item\.iso\); numberInput\.focus\(\{ preventScroll: true \}\); \}/, 'after choosing, the cursor goes to the number');
  assert.match(read('candidate.js'), /<div class="phone-country-wrap" data-geo="phone-country"><\/div>/);
  assert.match(read('styles.css'), /\.country-picker-btn\{[^}]*background-image:url\(/, 'same arrow as the other selects');
});

test('in a country list that is already focused, a new click selects all the text and opens the whole list', () => {
  const geo = read('geo.js');
  assert.match(geo, /const choose = item => \{ input\.value = item\.label; pristine = fullListOnFocus;/, 'after a pick the list is untouched again');
  assert.match(geo, /input\.addEventListener\('click', \(\) => \{ if \(pristine\) \{ input\.select\(\); if \(list\.hidden\) open\(\); \} \}\);/);
});

test('phone field audit: in EVERY country of the list a real number can be typed (national format, with its trunk prefix) without being cut or refused', () => {
  const lib = require('../vendor/libphonenumber/libphonenumber-max.js');
  const examples = require('../vendor/libphonenumber/examples.mobile.json');
  Object.assign(G.phoneExamples, examples);
  const supported = new Set(lib.getCountries());
  const countries = G.COUNTRIES.filter(country => supported.has(country[0]));
  assert.ok(countries.length >= 240, 'the whole list is covered');
  const digits = text => String(text).replace(/[^0-9]/g, '');
  let seed = 424242; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const problems = [];
  let numbers = 0;
  for (const [iso, name] of countries) {
    const example = examples[iso];
    if (!example) { problems.push(name + ': no example number'); continue; }
    // valid numbers of every kind: the example and variations of it (other first digits, other lengths)
    const valid = new Map();
    const parsedExample = lib.parsePhoneNumberFromString(example, iso);
    if (!parsedExample || !parsedExample.isValid()) { problems.push(name + ': the example is not valid'); continue; }
    valid.set(parsedExample.nationalNumber, parsedExample);
    for (let trial = 0; trial < 400; trial += 1) {
      const target = Math.max(4, Math.min(17, example.length + rnd(9) - 4));
      const n = example.split('');
      while (n.length < target) n.push(String(rnd(10)));
      n.length = target;
      for (let i = 0, k = rnd(4); i < k && i < n.length; i += 1) n[i] = String(rnd(10));
      for (let i = Math.min(n.length, 3 + rnd(2)); i < n.length; i += 1) n[i] = String(rnd(10));
      const parsed = lib.parsePhoneNumberFromString(n.join(''), iso);
      if (parsed && parsed.isValid() && String(parsed.countryCallingCode) === String(lib.getCountryCallingCode(iso))) valid.set(parsed.nationalNumber, parsed);
    }
    for (const [national, parsed] of valid) {
      numbers += 1;
      for (const typed of [digits(parsed.formatNational()), national]) {
        const shown = G.phoneNational(lib, iso, typed);
        if (digits(shown) !== typed) problems.push(name + ': typing ' + typed + ' was cut to ' + digits(shown));
        else if (!G.phoneCheck(lib, iso, shown).ok) problems.push(name + ': ' + shown + ' was refused');
      }
    }
    // the shape shown has room for the number written the national way
    const maskPlaces = (G.phoneMask(lib, iso).match(/_/g) || []).length;
    assert.equal(maskPlaces, digits(parsedExample.formatNational()).length, name + ': the mask is the national way of writing the example');
  }
  assert.deepEqual(problems.slice(0, 5), [], 'no valid number blocked (' + numbers + ' numbers tried)');
  assert.ok(numbers > 5000, "a large sample of valid numbers: " + numbers);
});

test('opening a country list never scrolls the page (only the list scrolls)', () => {
  const geo = read('geo.js');
  assert.doesNotMatch(geo.replace(/\/\/[^\n]*/g, ''), /scrollIntoView\(/, 'scrollIntoView moves every scrollable ancestor, the page included');
  assert.match(geo, /function scrollListTo\(list, item, center\)/);
  assert.match(geo, /search\.focus\(\{ preventScroll: true \}\)/);
});

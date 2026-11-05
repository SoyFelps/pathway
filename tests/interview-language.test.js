const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const load = file => import(require('node:url').pathToFileURL(path.join(root, file)).href);
const L = require('../interview-language.js');

const COOK_EN = `About Us. Le Lyon is a vibrant, high-energy dining spot known for our commitment to fresh ingredients, exceptional flavors, and a great atmosphere. We pride ourselves on creating memorable culinary experiences for our guests, and we are looking for a passionate and reliable Cook to join our culinary team! Position Summary: As a Cook, you will play a crucial role in delivering high-quality, delicious dishes according to our recipe standards and presentation guidelines. You will handle prep work, manage line execution during peak hours, and maintain strict food safety and cleanliness protocols.`;
const COOK_PT = `Sobre nós. O Le Lyon é um restaurante vibrante, conhecido pelo nosso compromisso com ingredientes frescos, sabores excepcionais e um ótimo ambiente. Estamos procurando um cozinheiro apaixonado e confiável para fazer parte da nossa equipe. Você será responsável pelo preparo dos alimentos e pela execução da linha nos horários de pico, e vai trabalhar com a equipe do salão para garantir a satisfação dos clientes. Requisitos: experiência de pelo menos um ano em restaurantes, conhecimento de técnicas de cozinha e disponibilidade para trabalhar à noite e aos fins de semana.`;
const COOK_ES = `Sobre nosotros. Le Lyon es un restaurante vibrante, conocido por nuestro compromiso con ingredientes frescos, sabores excepcionales y un gran ambiente. Buscamos un cocinero apasionado y confiable para formar parte de nuestro equipo. Usted será responsable de la preparación de los alimentos y de la ejecución de la línea en las horas pico, y trabajará con el equipo de sala para garantizar la satisfacción de los clientes. Requisitos: experiencia de al menos un año en restaurantes, conocimientos de técnicas de cocina y disponibilidad para trabajar de noche y los fines de semana.`;

test('the detector tells English, Portuguese and Spanish job descriptions apart', () => {
  for (const [text, code] of [[COOK_EN, 'en'], [COOK_PT, 'pt'], [COOK_ES, 'es']]) {
    const found = L.detect(text);
    assert.equal(found.code, code, `${code}: ${JSON.stringify(found.scores)}`);
    assert.equal(found.confidence, 'high');
  }
  assert.deepEqual(L.LANGUAGES, ['en', 'pt', 'es']);
  assert.equal(L.NAMES.pt, 'Português (Brasil)');
  assert.ok(L.isSupported('es') && !L.isSupported('fr') && !L.isSupported(null));
});

test('the detector says "unsure" instead of guessing: short, empty, mixed or meaningless texts', () => {
  for (const text of ['', '   ', 'Cook', 'Cook needed for our restaurant', null, undefined, 123456]) assert.equal(L.detect(text).code, null, String(text));
  const lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';
  assert.equal(L.detect(lorem).code, null, 'placeholder text is not a language');
  const mixed = COOK_EN.slice(0, 200) + ' ' + COOK_PT.slice(0, 200);
  assert.equal(L.detect(mixed).code, null, 'half English and half Portuguese is not sure');
  assert.equal(L.detect('12345 67890 !!! ??? ... --- 000 111 222 333 444 555 666 777 888 999 000 111 222 333').code, null, 'numbers and symbols');
});

test('a few words of another language inside a description do not change the result', () => {
  const portuguese = COOK_PT + ' Experience with POS systems and food safety is a plus; knowledge of English is welcome.';
  assert.equal(L.detect(portuguese).code, 'pt');
  const english = COOK_EN + ' Se você fala português, será um diferencial.';
  assert.equal(L.detect(english).code, 'en');
});

test('detection is the same every time and uses no network', () => {
  assert.deepEqual(L.detect(COOK_PT), L.detect(COOK_PT));
  const src = read('interview-language.js');
  assert.equal(/fetch\(|XMLHttpRequest|localStorage/.test(src), false);
});

test('the migration adds the language of the interview and the new blocked reason, without touching the public snapshot', () => {
  const sql = read('supabase/migrations/20261104210000_interview_language.sql');
  assert.match(sql, /add column if not exists interview_language text;/);
  assert.match(sql, /add column if not exists interview_language_manual boolean not null default false;/);
  assert.match(sql, /check \(interview_language is null or interview_language in \('en', 'pt', 'es'\)\)/);
  assert.match(sql, /blocked_reason in \('no_questions', 'no_plan', 'no_company_name', 'no_language'\)/);
  assert.match(sql, /- 'interview_questions' - 'interview_language' - 'interview_language_manual' - 'updated_at' - 'flow_data'/, 'editing the language is not a change of the job');
  assert.equal(/flow_data\s*(=|\|\|)\s*.*interview_language/.test(sql), false, 'the language never goes into flow_data');
  assert.equal(/drop table|delete from|truncate/i.test(sql), false, 'additive: nothing is dropped or deleted');
});

test('the webhook function sends the language of the job and the job editor shows and saves it', async () => {
  const hook = read('supabase/functions/ai-interview-webhook/index.ts').split('\r\n').join('\n');
  assert.ok(hook.includes('"id,job_title,interview_questions,interview_language,company_id,workspace_id"'));
  assert.ok(hook.includes('language: flow.interview_language,\n  });'), 'checkSendable gets the language');
  assert.ok(hook.includes('language: flow.interview_language,\n    }));'), 'create sends it');
  const { INTERVIEW_LANGUAGES, isInterviewLanguage } = await load('supabase/functions/ai-interview-webhook/logic.ts');
  assert.deepEqual([...INTERVIEW_LANGUAGES], ['en', 'pt', 'es']);
  assert.ok(isInterviewLanguage('pt') && !isInterviewLanguage('PT') && !isInterviewLanguage(null) && !isInterviewLanguage('fr'));

  const builder = read('builder.js');
  assert.ok(builder.includes("no_language: ['Choose the interview language'"), 'the card explains why the interview waits');
  assert.ok(builder.includes('id="role-interview-language"') && builder.includes('id="role-language-help"'));
  assert.ok(builder.includes('refreshLanguage = mountInterviewLanguageField(panel, flow, save);'));
  assert.ok(builder.includes('window.PathwayLanguage'));
  assert.ok(builder.includes("flow.interviewLanguageManual = true; saveFlow({ internal: true });"), 'a language chosen by a person is remembered as chosen');
  assert.ok(builder.includes("if (!flow.interviewLanguageManual) {"), 'detection never overwrites a choice made on purpose');
  assert.ok(builder.includes('saveFlow({ internal: true })'), 'the language is not an unpublished change');
  assert.ok(builder.includes("answeredInJobLanguage"), 'the data export no longer says English');
  assert.equal(builder.includes('answeredInEnglishOnly'), false);
  const html = read('index.html');
  assert.ok(html.indexOf('interview-language.js') < html.indexOf('builder.js'), 'the detector loads before the editor');
  assert.match(html, /interview-language\.js\?v=[\w-]+/);
  const backend = read('backend.js').split('\r\n').join('\n');
  assert.ok(backend.includes('function cleanInterviewLanguage(value)') && backend.includes('cleanInterviewLanguage,\n'));
});

test('the job editor field works end to end in a small browser-like harness', () => {
  // The editor function is exercised with a stand-in for the page: detection fills the language, a choice sticks, an unsure text warns.
  const src = read('builder.js');
  const start = src.indexOf('function mountInterviewLanguageField(');
  const end = src.indexOf('function mountInterviewQuestionsField(', start);
  const body = src.slice(start, end);
  const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const factory = new Function('esc', 'window', 't', `${body}; return mountInterviewLanguageField;`);
  // English t(): fills {variables}, like i18n.js without a dictionary.
  const t = (text, vars) => String(text).replace(/\{(\w+)\}/g, (match, name) => (vars && vars[name] != null ? String(vars[name]) : match));
  const make = text => {
    const listeners = {};
    const select = { innerHTML: '', value: '', addEventListener: (type, fn) => { listeners['select:' + type] = fn; } };
    const help = { textContent: '', classList: { classes: new Set(), toggle(name, on) { on ? this.classes.add(name) : this.classes.delete(name); } } };
    const description = { value: text, addEventListener: (type, fn) => { listeners['description:' + type] = fn; } };
    const panel = { querySelector: selector => ({ '#role-interview-language': select, '#role-language-help': help, '#role-description': description }[selector] || null) };
    const flow = { jobDescription: text };
    const saves = [];
    const detect = factory(esc, { PathwayLanguage: L }, t)(panel, flow, options => saves.push(options));
    return { flow, select, help, description, listeners, saves, detect };
  };

  const pt = make(COOK_PT);
  assert.equal(pt.flow.interviewLanguage, 'pt', 'detected while the panel opens');
  assert.equal(pt.flow.interviewLanguageManual || false, false);
  assert.match(pt.help.textContent, /Detected from the job description\./);
  assert.match(pt.select.innerHTML, /<option value="pt" selected>Português \(Brasil\)<\/option>/);
  assert.equal(pt.help.classList.classes.has('is-warning'), false);
  assert.deepEqual(pt.saves, [{ internal: true }], 'saved without counting as a change of the job');

  pt.select.value = 'en'; pt.listeners['select:change']();
  assert.equal(pt.flow.interviewLanguage, 'en');
  assert.equal(pt.flow.interviewLanguageManual, true, 'a choice is remembered as a choice');
  assert.match(pt.help.textContent, /Chosen by you\. The description looks like Português \(Brasil\)\./, 'the person is told when the text looks different');

  pt.description.value = COOK_ES; pt.detect();
  assert.equal(pt.flow.interviewLanguage, 'en', 'editing the description never changes a language chosen on purpose');

  const unsure = make('Cook needed');
  assert.equal(unsure.flow.interviewLanguage, undefined, 'nothing is guessed from a short text');
  assert.equal(unsure.help.textContent, 'We could not tell the language of the job description. Choose it manually. Until then the job page and the confirmation e-mail are in English, and AI interviews are not sent.');
  assert.equal(unsure.help.classList.classes.has('is-warning'), true);
  assert.match(unsure.select.innerHTML, /<option value="" selected disabled>Choose the language…<\/option>/);
  assert.equal(unsure.saves.length, 0);
  unsure.description.value = COOK_EN; unsure.listeners['description:input'] && unsure.listeners['description:input']();
  unsure.detect();
  assert.equal(unsure.flow.interviewLanguage, 'en', 'typing a real description fills the language in');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const js = read('interview.js');
const html = read('interview.html');

test('the answer page is private: not indexed, no referrer, the secret only in the part after the #', () => {
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.ok(js.includes("window.location.hash"), 'the secret is read from the hash');
  assert.equal(/localStorage|sessionStorage|document\.cookie/.test(js), false, 'the secret is never stored in the browser');
  assert.equal(/console\.(log|error)/.test(js), false);
});

test('opening the page only shows the interview; an answer is sent only when a button is pressed', () => {
  const start = js.slice(js.indexOf('async function start()'));
  assert.ok(start.includes("action: 'get'"));
  assert.equal(start.includes("action: 'respond'"), false, 'start() never answers');
  const sends = js.match(/action: 'respond'/g) || [];
  assert.equal(sends.length, 1, 'one place sends an answer: answer()');
  for (const id of ['act-confirm', 'decline-form', 'reschedule-form']) assert.ok(js.includes(id));
  // the calls to answer() are inside click and submit handlers
  assert.ok(/on\('act-confirm', \(\) => answer\(\{ response: 'confirm' \}\)\)/.test(js));
});

test('the page follows the language of the job and does not show the e-mail address', () => {
  assert.ok(js.includes('I18N.forLanguage(view.language)'));
  assert.equal(/candidateEmail|candidate_email|\.email\b/.test(js), false, 'the address of the candidate is never shown');
  assert.ok(js.includes("document.documentElement.lang = tr.language"));
});

test('the suggestion fields only allow days from today until 30 days after the interview', () => {
  assert.ok(js.includes('min="${esc(todayInZone())}" max="${esc(view.suggestUntilDate)}"'));
  assert.ok(js.includes('for (const slot of root.querySelectorAll'), 'up to three slots');
  assert.equal((js.match(/\[0, 1, 2\]\.map\(slotHtml\)/g) || []).length, 1);
});

test('what the person typed is not lost when sending fails', () => {
  const answer = js.slice(js.indexOf('async function answer'), js.indexOf('function bind()'));
  assert.ok(answer.includes("button.disabled = true"), 'buttons are switched off, the form is not redrawn while sending');
  assert.ok(answer.includes("slot.textContent = message"), 'the error appears inside the form');
});

test('every fixed text of the page that does not go through t() literally has a translation too', () => {
  const locales = { 'pt-BR': read('locales/pt-BR.js'), es: read('locales/es.js') };
  const banners = [...js.slice(js.indexOf('const BANNERS'), js.indexOf('function detailsHtml')).matchAll(/: '([^']*)'/g)].map(m => m[1]).filter(text => text.includes(' '));
  assert.ok(banners.length >= 5, 'the banners are found');
  const extra = ['Could not reach the interview service. Check your connection and try again.', 'This interview has already taken place.', 'The time of this interview has come. If you have any questions, contact the hiring team.', 'This invitation was not found.'];
  for (const code of Object.keys(locales)) for (const text of [...banners, ...extra]) assert.ok(locales[code].includes(`'${text}':`), `${code} is missing: ${text}`);
});

test('the page reuses the candidate page components instead of inventing new ones', () => {
  for (const cls of ['candidate-app', 'candidate-header', 'candidate-form-card', 'candidate-field', 'candidate-apply', 'candidate-back', 'prototype-note', 'invalid-screen', 'btn btn-primary']) assert.ok(js.includes(cls), cls);
  for (const file of ['interview.js', 'i18n.js']) assert.ok(html.includes(file), file + ' is loaded');
  assert.equal(html.includes('backend.js') || html.includes('candidate.js'), false, 'only what the page needs is loaded');
});

test('joining is obvious: a big button at the top from 30 minutes before until 2 hours after the start (owner, 2026-11-27)', () => {
  assert.ok(js.includes('JOIN_BEFORE_MS = 30 * 60000') && js.includes('JOIN_AFTER_MS = 120 * 60000'), 'the time the button is shown');
  assert.ok(js.includes('${intro}</p>${joinHtml()}${detailsHtml()}'), 'the button comes right under the greeting, before the details');
  assert.ok(js.includes('class="btn btn-primary interview-join"'), 'a primary button');
  assert.ok(js.includes("btn${joinPhase() === 'now' ? '' : ' btn-primary'}"), 'Confirm attendance does not compete with it');
  assert.ok(js.includes('scheduleJoinRedraw();') && js.includes('if (panel || busy)'), 'a page left open turns into the join page, never while the person is typing');
});

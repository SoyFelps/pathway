const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').split('\r\n').join('\n');
const builder = read('builder.js');
const css = read('styles.css');

// The real field function, run against a stand-in for the page that records what it writes.
const fieldSource = builder.slice(builder.indexOf('function mountInterviewQuestionsField('), builder.indexOf('  let myProfile = null;'));
const makeField = new Function('esc', 'window', 'showToast', `${fieldSource}; return mountInterviewQuestionsField;`);
const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clean = values => values.map(item => String(item ?? '').replace(/\s+/g, ' ').trim()).filter(item => item.length >= 3).slice(0, 5);
const mount = (saved, options) => {
  const html = [];
  const host = { set innerHTML(value) { html.push(value); }, get innerHTML() { return html[html.length - 1] || ''; }, querySelector: () => null, querySelectorAll: () => [], closest: () => null, isConnected: true };
  const controller = makeField(esc, { PathwayBackend: { cleanInterviewQuestions: clean } }, () => {})(host, () => saved, () => {}, options);
  return { host, controller, html };
};

test('the interview questions have an expander next to the title, like the job description', () => {
  assert.ok(builder.includes('<div class="field-label-row"><span class="form-label" id="role-ai-questions-label">AI interview questions</span><button type="button" class="icon-btn expand-btn" id="expand-ai-questions" aria-label="Open the AI interview questions in a larger window" title="Larger window">'));
  assert.ok(builder.includes("panel.querySelector('#expand-ai-questions')?.addEventListener('click', () => openInterviewQuestionsEditor(questionsField, questionsGet, questionsSet, questionsOptions));"));
  assert.match(css, /@media\(max-width:760px\)\{\.expand-btn\{display:none\}\}/, 'desktop only, like the description');
});

test('the large window runs the same field with the same options: write with AI, add, remove, Revert and Save questions', () => {
  const start = builder.indexOf('function openInterviewQuestionsEditor(');
  const body = builder.slice(start, builder.indexOf('function drawInspector()', start));
  assert.ok(body.includes('<h2>AI interview questions</h2>') && body.includes('id="ai-questions-modal"') && body.includes('id="ai-questions-modal-field"'));
  assert.ok(body.includes('mountInterviewQuestionsField(host, getList, setList, { ...options, large: true, initialDraft: panelField ? panelField.getDraft() : null })'), 'same getList, setList and options (so the sparkles button and the draft mode come along)');
  assert.ok(body.includes('<button class="btn btn-primary" data-close type="button">Close</button>'), 'the button says Close');
  assert.equal(body.includes('>Done<'), false);
  assert.match(css, /#ai-questions-modal \+ \.modal-actions\{[^}]*border-top:1px solid var\(--border-subtle\)\}/, 'a dividing line above the Close button, like the one in the company form');
  assert.ok(body.includes("if (event.key === 'Escape') closeModal();"));
  assert.ok(builder.includes('const wideModal = html.includes(\'id="job-description-modal"\') || html.includes(\'id="ai-questions-modal"\');'));
});

test('what is still unsaved when the window closes goes back to the panel, so nothing typed there is lost', () => {
  assert.ok(builder.includes('modalCloseHook = () => { if (panelField && bigField) panelField.setDraft(bigField.getDraft()); };'));
  assert.ok(builder.includes('function closeModal() { const hook = modalCloseHook; modalCloseHook = null; modalRoot.innerHTML = \'\';'));
  assert.ok(builder.includes("if (hook) hook(); }"), 'every way of closing runs it: Done, the cross, the backdrop and Escape all call closeModal');
});

test('in the panel the questions stay in one-line boxes; in the large window each one gets a wide, wrapping box with its number', () => {
  const small = mount(['Describe your approach to deadlines.', 'Tell us about a team project.'], { saveButtons: true });
  assert.match(small.host.innerHTML, /<input class="text-input ai-question-input" data-index="0"/);
  assert.equal(small.host.innerHTML.includes('<textarea'), false);
  assert.equal(small.host.innerHTML.includes('is-large'), false);

  const big = mount(['Describe your approach to deadlines.', 'Tell us about a team project.'], { saveButtons: true, large: true });
  assert.equal((big.host.innerHTML.match(/<textarea class="text-area ai-question-input"/g) || []).length, 2, 'one box per question');
  assert.equal((big.host.innerHTML.match(/class="ai-question-row is-large"/g) || []).length, 2);
  assert.match(big.host.innerHTML, /<span class="ai-question-number" aria-hidden="true">1<\/span>/);
  assert.match(big.host.innerHTML, /<span class="ai-question-number" aria-hidden="true">2<\/span>/);
  assert.match(big.host.innerHTML, /maxlength="300" rows="3"/, 'the same 300 characters limit');
  assert.match(big.host.innerHTML, />Describe your approach to deadlines\.<\/textarea>/);
  assert.match(big.host.innerHTML, /id="ai-questions-save"/, 'Save questions is in the large window too');
  assert.match(big.host.innerHTML, /id="ai-questions-revert"/);
  assert.match(big.host.innerHTML, /id="ai-question-add"/);
  assert.match(big.host.innerHTML, /ai-question-remove/);
  assert.match(css, /\.ai-question-row\.is-large \.text-area\{[^}]*font-size:15px[^}]*resize:vertical\}/);
});

test('the large window starts from the draft of the panel, not from what is saved, and the draft can be handed back', () => {
  const saved = ['Saved question one here.'];
  const panel = mount(saved, { saveButtons: true });
  panel.controller.setDraft(['Saved question one here.', 'A new, still unsaved question.']);
  assert.deepEqual(panel.controller.getDraft(), ['Saved question one here.', 'A new, still unsaved question.']);

  const bigWindow = mount(saved, { saveButtons: true, large: true, initialDraft: panel.controller.getDraft() });
  assert.match(bigWindow.host.innerHTML, /A new, still unsaved question\./, 'the unsaved line is there');
  assert.deepEqual(bigWindow.controller.getDraft(), ['Saved question one here.', 'A new, still unsaved question.']);

  bigWindow.controller.setDraft(['Saved question one here.', 'A new, still unsaved question.', 'And one more written in the window.']);
  panel.controller.setDraft(bigWindow.controller.getDraft());
  assert.match(panel.host.innerHTML, /And one more written in the window\./, 'back in the panel');
  assert.equal(panel.controller.getDraft().length, 3);

  const normal = mount(['Only the saved one.'], { saveButtons: true });
  assert.deepEqual(normal.controller.getDraft(), ['Only the saved one.'], 'without a draft handed in, the saved list is used');
});

test('the large window works in the job editor only: the new-job form keeps its own simple field', () => {
  assert.equal(builder.includes('#new-ai-questions'), false);
  assert.ok(builder.includes("saveButtons: true,\n      generate: others => window.PathwayBackend.generateInterviewQuestion("));
});

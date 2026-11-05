const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const builder = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

test('empty flow-canvas background pans both axes without hijacking node or connection gestures', () => {
  assert.match(builder, /bindCanvasPan\(workspace\)/);
  assert.match(builder, /event\.target\.closest\('\.node, \.port, \.target-port, \.edge-path, \.edge-hit, \.canvas-toolbar, button, input, textarea, select'\)/);
  assert.match(builder, /workspace\.scrollLeft = pan\.left - \(event\.clientX - pan\.x\)/);
  assert.match(builder, /workspace\.scrollTop = pan\.top - \(event\.clientY - pan\.y\)/);
  assert.match(builder, /setPointerCapture\(event\.pointerId\)/);
  assert.match(builder, /releasePointerCapture\(pointerId\)/);
  assert.match(builder, /Drag background to pan, nodes to arrange, ports to connect/);
  assert.match(styles, /\.workspace\{cursor:grab/);
  assert.match(styles, /\.workspace\.is-panning\{cursor:grabbing/);
});

test('canvas instruction behind Add a step is removed while transient status remains available', () => {
  assert.ok(builder.includes('<div class="canvas-status" id="canvas-status"></div>'));
  assert.doesNotMatch(builder, /Drag empty background to move around · Drag a connection point to another step/);
  assert.match(builder, /function setStatus\(text\)/);
  assert.match(styles, /#canvas-status:empty\{display:none\}/);
});

test('editor canvas element does not shadow workspace data used by its header', () => {
  const start = builder.indexOf('function renderEditor()');
  const end = builder.indexOf('function bindCanvasPan(', start);
  const editor = builder.slice(start, end);
  assert.match(builder, /let workspace = null;/);
  assert.match(editor, /workspaceSwitcherHtml\(\)/);
  assert.match(editor, /const workspaceElement = document\.getElementById\('workspace'\)/);
  assert.match(editor, /bindCanvasPan\(workspaceElement\)/);
  assert.doesNotMatch(editor, /const workspace\s*=/);
});

test('flow creation and editing hide the sidebar, restoring it when creation is cancelled', () => {
  const editorStart = builder.indexOf('function renderEditor()');
  const editorEnd = builder.indexOf('function bindCanvasPan(', editorStart);
  const editor = builder.slice(editorStart, editorEnd);
  const createStart = builder.indexOf('function showNewFlow()');
  const createEnd = builder.indexOf('function showFlowMenu(', createStart);
  const createFlow = builder.slice(createStart, createEnd);

  assert.doesNotMatch(editor, /renderSidebar\('dashboard'\)|bindSidebar\(\)/);
  assert.match(editor, /<div class="workspace-body"><main class="editor-main">/);
  assert.match(createFlow, /classList\.add\('is-creating-flow'\)/);
  assert.match(createFlow, /openFlow\(flow\.id\)/);
  assert.match(builder, /function closeModal\(\) \{[^}]*classList\.remove\('is-creating-flow'\)/);
  assert.match(styles, /\.app-shell\.is-creating-flow \.app-sidebar\{display:none\}/);
});

test('job details are shown only when the fixed candidate-details node is selected', () => {
  const start = builder.indexOf('function drawInspector()');
  const end = builder.indexOf('function updateNodeLabel(', start);
  const inspector = builder.slice(start, end);
  assert.match(inspector, /const roleSettings = selected\.type === 'candidateInfo'/);
  assert.match(inspector, /<h2>\$\{t\('Job details'\)\}<\/h2>/);
  assert.match(inspector, /panel\.innerHTML = `<div class="mobile-details-bar">[\s\S]*?<\/div>\$\{roleSettings\}/);
  assert.match(inspector, /<div class="inspector-kicker">\$\{t\('Selected step'\)\}<\/div>/);
  assert.match(inspector, /querySelector\('#role-company-profile'\)\?\./);
  assert.match(inspector, /companyOptionsHtml\(flow\.companyId/);
});

test('My Companies is permission-gated, limited to three profiles, and exposes capped image uploads', () => {
  assert.match(builder, /data-route="my-companies"/);
  assert.match(builder, /function renderMyCompanies\(\)/);
  assert.match(builder, /companies\.length >= 3/);
  assert.match(builder, /type="file" accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(builder, /Maximum 2 MB/);
  assert.match(builder, /company\.logoUrl/);
  assert.match(builder, /flow\.companyProfile = companySnapshot\(company\)/);
  assert.match(builder, /C\.createFlow\(company\?\.name \|\| workspace\.name/);
  assert.match(builder, /flow\.companyName = company\?\.name \|\| workspace\.name/);
});

test('short-answer nodes expose an accessible numeric-only switch', () => {
  const start = builder.indexOf('function drawInspector()');
  const end = builder.indexOf('function updateNodeLabel(', start);
  const inspector = builder.slice(start, end);
  assert.match(inspector, /selected\.type === 'shortText'[\s\S]*?class="numeric-only-toggle"[\s\S]*?role="switch"/);
  assert.match(inspector, /numericToggle\?\.addEventListener\('change',[\s\S]*selected\.numericOnly = event\.target\.checked/);
  assert.match(builder, /node\.numericOnly \? t\('Number response'\)[\s\S]*?: t\('Open-ended response'\)/);
  assert.match(styles, /\.numeric-only-switch input:checked\+\.numeric-only-track/);
  assert.match(styles, /\.answer-text\[data-numeric-only=true\]/);
});

test('the job editor has a Back button to the dashboard instead of the "My flows" breadcrumb', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
  assert.ok(src.includes("<button class=\"btn btn-sm crumb-back\" id=\"dashboard-back\" type=\"button\" aria-label=\"${t('Back to the dashboard')}\">← ${t('Back')}</button><span class=\"crumb-title\">"));
  assert.equal(src.includes('>My flows</button>'), false);
  assert.equal(src.includes('crumb-chevron'), false);
});

test('deleting a step offers an Undo that lasts only until the next action', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
  const del = src.slice(src.indexOf('function deleteNode(id) {'), src.indexOf('function openPreview() {'));
  assert.match(del, /const snapshot = JSON\.parse\(JSON\.stringify\(\{ nodes: flow\.nodes, edges: flow\.edges \}\)\)/, 'the flow is saved before the step goes away');
  assert.match(del, /offerUndoDelete\(currentId, snapshot, selectedBefore\)/);
  assert.equal(del.includes("showToast('Step deleted."), false, 'the old toast is replaced by the Undo bar');
  assert.match(src, /\['pointerdown', 'keydown'\]\.forEach\(type => document\.addEventListener\(type, event => \{[\s\S]*clearUndoDelete\(\);[\s\S]*\}, true\)\);/, 'a click on something else or a key removes the offer');
  const undoBlock = src.slice(src.indexOf('let undoDelete = null;'), src.indexOf("window.addEventListener('hashchange', clearUndoDelete);"));
  assert.equal(undoBlock.includes('wheel'), false, 'scrolling does not remove the offer');
  assert.match(src, /type === 'pointerdown' && target && target\.closest\('#workspace'\) && !target\.closest\(CANVAS_THINGS\)\) return;/, 'dragging the empty canvas background does not remove it');
  assert.match(src, /closest\('#undo-delete-bar'\)\) return;/, 'using the Undo button itself does not remove it first');
  assert.match(src, /window\.addEventListener\('hashchange', clearUndoDelete\);/);
  assert.match(src, /function setRoute\(route\) \{\n    const hash = `#\$\{route\}`;[\s\S]*?if \(window\.location\.hash !== hash\) clearUndoDelete\(\);/, 'another page removes it, but the automatic save refreshing the SAME address does not (that removed it after about a second)');
  assert.match(src, /clearUndoDelete\(\); currentId = id;/, 'opening a job removes it');
  assert.match(src, /flow\.nodes = state\.snapshot\.nodes; flow\.edges = state\.snapshot\.edges;/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8'), /\.undo-bar\{position:fixed;/);
});

test('the Undo bar is centred in the canvas area, not in the whole window', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
  assert.match(src, /const view = document\.getElementById\('workspace'\);[\s\S]*bar\.style\.left = \(box\.left \+ view\.clientWidth \/ 2\) \+ 'px';/);
  assert.match(src, /window\.addEventListener\('resize', place\);/, 'stays centred when the window is resized');
  assert.match(src, /window\.removeEventListener\('resize', undoDelete\.onResize\)/, 'the listener goes away with the bar');
});

test('"Add a step" and the zoom controls are centred together in the canvas area', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
  assert.match(src, /function placeCanvasControls\(\) \{/);
  assert.match(src, /const center = view\.getBoundingClientRect\(\)\.left \+ view\.clientWidth \/ 2;/);
  assert.match(src, /add\.style\.left = \(center - total \/ 2\) \+ 'px';/);
  assert.match(src, /zoom\.style\.left = \(center - total \/ 2 \+ add\.offsetWidth \+ gap\) \+ 'px';/);
  assert.match(src, /window\.addEventListener\('resize', placeCanvasControls\);/);
  assert.match(src, /bindCanvasZoom\(workspaceElement\);\n\s+placeCanvasControls\(\);/, 'placed when the editor opens');
});

test('drawing the same job again keeps the position the person had on the canvas', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
  const render = src.slice(src.indexOf('function renderEditor() {'), src.indexOf('// Zoom of the flow canvas'));
  assert.match(render, /const keepView = oldView && lastEditorFlowId === currentId \? \{ left: oldView\.scrollLeft, top: oldView\.scrollTop \} : null;/);
  assert.match(render, /workspaceElement\.scrollLeft = keepView\.left; workspaceElement\.scrollTop = keepView\.top;/);
  assert.match(src, /let lastEditorFlowId = null;/);
});

test('phone editor: board OR step details (never both), Back to board, no pencil button, controls that do not overlap', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.equal(src.includes('id="edit-role"'), false, 'the pencil button is gone');
  assert.equal(src.includes("querySelector('#edit-role')"), false);
  assert.match(src, /let mobileEditorView = 'board';/);
  assert.match(src, /if \(lastEditorFlowId !== currentId\) mobileEditorView = 'board';/, 'opening a job on a phone starts on the board');
  assert.match(src, /selectedId = element\.dataset\.node; drawCanvas\(\); drawInspector\(\);\n\s+openNodeDetailsOnPhone\(\);/, 'tapping a step opens its details');
  assert.match(src, /selectedId = info\.id; mobileEditorView = 'board'; save\(\); renderEditor\(\);/, 'after deleting a step the board comes back');
  assert.match(src, /id="close-node-details">← \$\{t\('Back to board'\)\}<\/button>/);
  assert.match(css, /\.editor-layout\.is-mobile-board \.inspector\{display:none\}/);
  assert.match(css, /\.editor-layout\.is-mobile-details \.workspace\{display:none\}/);
  assert.match(css, /\.editor-main\.is-mobile-details \.canvas-add,\.editor-main\.is-mobile-details \.canvas-zoom-controls/);
  assert.match(src, /zoom\.style\.bottom = \(16 \+ add\.offsetHeight \+ 10\) \+ 'px';/, 'too narrow for both side by side: zoom goes above Add a step');
});

test('phone editor: inside a step only "Back to board" is left at the top (the job header and the app header are hidden)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.match(src, /document\.querySelector\('\.app-shell'\)\?\.classList\.toggle\('is-mobile-details', details\);/);
  assert.match(css, /\.app-shell\.is-mobile-details \.topbar,\.editor-main\.is-mobile-details \.editor-top\{display:none\}/);
});

test('phone editor: the "Back to board" bar stays fixed at the top while the details scroll', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.match(css, /\.mobile-details-bar\{display:block;position:fixed;top:0;left:0;right:0;/);
  assert.match(css, /\.editor-layout\.is-mobile-details \.inspector\{padding-top:74px\}/);
});

test('the AI interview questions help text is accurate (no "out loud", no "leave them empty")', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
  assert.ok(src.includes('These are the questions the AI asks the candidate in the AI Interview, with one follow-up for each.'));
  assert.equal(src.includes('out loud'), false);
  assert.equal(src.includes('Leave them empty'), false);
});

test('the AI interview questions come last in the job details, below the candidate-details step', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
  const inspector = src.slice(src.indexOf('function drawInspector()'), src.indexOf('function updateNodeLabel(', src.indexOf('function drawInspector()')));
  assert.ok(inspector.includes(`const aiSection = selected.type === 'candidateInfo' ? '<hr class="inspector-divider"><div class="field-group" id="role-language-group">`), 'the language of the interview comes first');
  assert.ok(inspector.includes("<div class=\"field-group\"><div class=\"field-label-row\"><span class=\"form-label\" id=\"role-ai-questions-label\">' + t('AI interview questions') + '</span><button type=\"button\" class=\"icon-btn expand-btn\" id=\"expand-ai-questions\""), 'the questions have an expander next to the title');
  assert.ok(inspector.indexOf('id="role-language-group"') < inspector.indexOf('id="role-ai-questions-label"'), 'the language comes right above the questions');
  assert.match(inspector, /<div id="node-editor"><\/div>\$\{aiSection\}`;/, 'after the step editor');
  const roleSettings = inspector.slice(inspector.indexOf('const roleSettings'), inspector.indexOf('const aiSection'));
  assert.equal(roleSettings.includes('role-ai-questions'), false, 'no longer between the job fields and the step');
});

test('each AI interview question has a sparkles button next to the remove button; it writes THAT line with the AI', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
  const field = src.slice(src.indexOf('function mountInterviewQuestionsField('), src.indexOf('let myProfile = null;'));
  assert.match(field, /\(options && options\.generate \? '<button type="button" class="icon-btn ai-question-sparkles"[^>]*aria-label="' \+ t\('Write question \{number\} with AI', number\(index\)\) \+ '"/, 'only where the AI is wired (the job editor)');
  assert.ok(field.indexOf('ai-question-sparkles') < field.indexOf('ai-question-remove'), 'sparkles come right before the remove button');
  assert.match(field, /host\.querySelectorAll\('\.ai-question-sparkles'\)\.forEach\(button => button\.addEventListener\('click', async event => \{/);
  assert.match(field, /const others = list\.filter\(\(text, position\) => position !== index && String\(text\)\.trim\(\)\);/, 'the lines in the field now (the draft), without the line being replaced');
  assert.match(field, /list\[index\] = result\.question; paint\(\); syncActions\(\);/, 'the question goes into that line of the draft, to be saved by the person');
  assert.match(field, /We couldn’t generate a question from the job description\. Add more detail about the role and try again\./, 'the notification when there is not enough information');
  assert.match(field, /Writing questions with AI is part of the Premium plan\./);
  assert.match(field, /AI is unavailable right now\. Try again in a moment\./);
});

test('AI interview questions in the job editor are a draft: they only reach the job on "Save questions"', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
  const field = src.slice(src.indexOf('function mountInterviewQuestionsField('), src.indexOf('let myProfile = null;'));
  assert.match(field, /const draftMode = Boolean\(options && options\.saveButtons\);/);
  assert.match(field, /if \(draftMode\) syncActions\(\); else setList\(list\.slice\(\)\);/, 'typing does not save in draft mode');
  assert.match(field, /if \(!draftMode\) setList\(list\.slice\(\)\); paint\(\);/, 'removing a line does not save in draft mode');
  assert.match(field, /id="ai-questions-revert">' \+ t\('Revert'\) \+ '<\/button><span class="ai-questions-status"[^>]*><\/span><button type="button" class="btn btn-sm btn-primary ai-questions-save" id="ai-questions-save">' \+ t\('Save questions'\) \+ '<\/button>/);
  assert.match(field, /setList\(kept\); list = padded\(kept\); paint\(\);/, 'saving sends the cleaned list once');
  assert.match(field, /Lines shorter than 3 characters were left out\./, 'the person is told what was left out');
  assert.match(field, /list = padded\(clean\(getList\(\) \|\| \[\]\)\); paint\(\);/, 'Revert goes back to the saved list');
  const questionsBlock = src.slice(src.indexOf('const questionsOptions = {'), src.indexOf("panel.querySelector('#expand-ai-questions')"));
  assert.ok(questionsBlock.includes('saveButtons: true,') && questionsBlock.includes("generate: others => window.PathwayBackend.generateInterviewQuestion({ workspaceId: workspace.id, jobTitle: flow.jobTitle, description: panel.querySelector('#role-description')?.value ?? flow.jobDescription, existing: others })"));
  assert.ok(questionsBlock.includes("mountInterviewQuestionsField(panel.querySelector('#role-ai-questions'), questionsGet, questionsSet, questionsOptions)"), 'the panel field and the large window share the same options');
  assert.equal(src.includes('#new-ai-questions'), false, 'the new-job form has no questions field');
});

test('the Save questions button is pushed to the right end of the actions row', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.match(css, /\.ai-questions-actions \.ai-questions-save\{margin-left:auto\}/);
});

test('unsaved AI interview questions are highlighted (amber status and a subtle outline) until saved or reverted', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.match(src, /\(host\.closest\('\.field-group'\) \|\| host\)\.classList\.toggle\('has-unsaved', changed\);/);
  assert.match(css, /#inspector \.field-group\.has-unsaved\{outline:1px solid var\(--amber-border\);outline-offset:8px;/);
  assert.match(css, /#inspector \.field-group\.has-unsaved \.ai-questions-status\{color:var\(--amber-dark\);font-weight:700\}/);
});

test('the job editor shows only the saved AI interview questions (even none, and the last one can be removed), never empty lines added on its own', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
  const field = src.slice(src.indexOf('function mountInterviewQuestionsField('), src.indexOf('let myProfile = null;'));
  assert.match(field, /const minRows = options && options\.saveButtons \? 0 : 3;/, 'no minimum in the editor, three lines in the new-job form');
  assert.match(field, /\(list\.length > \(options && options\.saveButtons \? 0 : 1\) \? '<button type="button" class="icon-btn ai-question-remove"/, 'the last question can be removed in the editor');
  assert.match(field, /while \(list\.length < minRows\) list\.push\(''\);/);
  assert.match(field, /while \(copy\.length < minRows\) copy\.push\(''\);/, 'saving or reverting does not add empty lines either');
  assert.equal(/length < 3\)/.test(field), false, 'no fixed three lines left');
});

test('the job description can be opened in a larger window (desktop only) that edits the same text', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.match(src, /id="expand-description" aria-label="\$\{t\('Open the job description in a larger window'\)\}"/);
  assert.match(src, /function openJobDescriptionEditor\(initial, onChange\) \{/);
  assert.match(src, /area\.addEventListener\('input', event => onChange\(event\.target\.value\)\);/, 'every key updates the job, like the small field');
  assert.match(src, /openJobDescriptionEditor\(flow\.jobDescription \|\| '', value => \{ syncRole\('jobDescription', value\); const small = panel\.querySelector\('#role-description'\); if \(small\) small\.value = value; refreshLanguage\(\); \}\)/, 'the small field follows the large one, and the language is detected again');
  assert.ok(src.includes(`const wideModal = html.includes('id="job-description-modal"') || html.includes('id="ai-questions-modal"');`), 'the interview questions window is as wide as the description window');
  assert.match(css, /@media\(max-width:760px\)\{\.expand-btn\{display:none\}\}/, 'not on phones');
  assert.match(css, /\.modal\.modal-wide\{width:min\(100%,820px\)\}/);
});

test('the interview question field accepts at most 300 characters and tells the person when the AI could not stay short', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
  const field = src.slice(src.indexOf('function mountInterviewQuestionsField('), src.indexOf('let myProfile = null;'));
  assert.match(field, /class="text-input ai-question-input" data-index="' \+ index \+ '" maxlength="300"/);
  assert.equal(field.includes('maxlength="500"'), false);
  assert.match(field, /result\.reason === 'long'\) showToast\(t\('We couldn’t write a question short enough\. Try again\.'\)/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const details = () => { const b = read('builder.js'); return b.slice(b.indexOf('function showApplicantDetails('), b.indexOf('async function doSignOut(')); };

test('the left side of the applicant panel has no resume buttons and no privacy sentence', () => {
  const d = details();
  assert.equal(d.includes('applicant-resume-actions'), false, 'no Preview/Hide/Download buttons next to the hiring stage');
  assert.equal(d.includes('applicant-privacy-note'), false);
  assert.equal(d.includes('Resume links are private and expire after two minutes'), false, 'the sentence under Application record is gone');
  assert.ok(d.includes('<h3>Application record</h3>'), 'the Application record section itself stays');
});

test('with the preview open, Download resume sits next to Close preview', () => {
  const d = details();
  const head = d.slice(d.indexOf('<div class="applicant-resume-preview-head">'), d.indexOf('<iframe id="applicant-resume-frame"'));
  assert.ok(head.indexOf('js-download-resume') > 0 && head.indexOf('js-download-resume') < head.indexOf('id="close-applicant-resume-preview"'), 'Download comes right before Close');
  assert.ok(head.includes('class="applicant-resume-preview-actions"'), 'both buttons are grouped on the right of the header');
});

test('with the preview closed, a "Preview resume" button replaces the old sentence', () => {
  const d = details();
  const empty = d.slice(d.indexOf('<div class="applicant-preview-empty"'), d.indexOf('<section class="applicant-resume-preview is-hidden"'));
  assert.equal(empty.includes('Loading the private PDF preview'), false, 'the old sentence is gone');
  assert.ok(empty.includes('id="preview-applicant-resume"') && empty.includes('Preview resume'), 'the button is in the placeholder');
});

test('files that cannot be previewed still offer the download, in the placeholder', () => {
  const d = details();
  const empty = d.slice(d.indexOf('<div class="applicant-preview-empty"'), d.indexOf('<section class="applicant-resume-preview is-hidden"'));
  assert.ok(empty.includes('This file type cannot be previewed in the browser.') && empty.includes('js-download-resume'));
  assert.ok(d.includes("modalRoot.querySelectorAll('.js-download-resume').forEach("), 'one handler wires every Download button');
});

test('on desktop the preview still opens by itself, and Preview resume reopens it after Close preview', () => {
  const d = details();
  assert.ok(d.includes('if (previewButton && !phoneLayout) void loadPreview(previewButton);'), 'auto-open only when the screen is not a phone');
  assert.ok(d.includes("previewButton?.addEventListener('click', () => { void loadPreview(previewButton); });"));
  assert.ok(d.includes("modalRoot.querySelector('#close-applicant-resume-preview')?.addEventListener('click', closePreview);"));
});

test('on phones the preview starts closed and the information is the only thing on screen', () => {
  const d = details();
  assert.ok(d.includes("const phoneLayout = window.matchMedia('(max-width: 760px)').matches;"));
  const css = read('styles.css');
  const phone = css.slice(css.indexOf('/* Applicant panel on phones'));
  assert.ok(phone.includes('.applicant-review-right{display:none}'), 'the resume column is not shown next to the information');
  assert.ok(phone.includes('.applicant-review-layout{grid-template-rows:minmax(0,1fr)}'), 'the information gets the whole screen, no split');
});

test('on phones a bottom menu offers Preview resume and Download resume; the preview fills the screen until Close preview', () => {
  const d = details();
  const barStart = d.indexOf('<div class="applicant-mobile-bar">');
  const bar = d.slice(barStart, d.indexOf('</section>', barStart));
  assert.ok(bar.includes('id="mobile-preview-resume"') && bar.includes('js-download-resume'), 'both options are in the bar');
  assert.ok(bar.indexOf('Preview resume') < bar.indexOf('Download resume'), 'preview first, then download');
  assert.ok(d.includes("mobilePreviewButton?.addEventListener('click', () => { void loadPreview(mobilePreviewButton); });"));
  assert.ok(d.includes("reviewLayout.classList.add('is-previewing');") && d.includes("reviewLayout.classList.remove('is-previewing');"), 'Close preview returns to the information');
  const css = read('styles.css');
  const phone = css.slice(css.indexOf('/* Applicant panel on phones'));
  assert.ok(phone.includes('.applicant-review-layout.is-previewing .applicant-review-left{display:none}') && phone.includes('.applicant-review-layout.is-previewing .applicant-review-right{display:flex}'), 'the preview replaces the information on the whole screen');
  assert.ok(phone.includes('.applicant-mobile-bar{display:grid;') && css.includes('.applicant-mobile-bar{display:none}'), 'the bar exists on phones only');
});

test('moving a candidate that no longer exists tells the person to press Refresh, without refreshing for them', () => {
  const builder = read('builder.js');
  const move = builder.slice(builder.indexOf('async function moveApplicant('), builder.indexOf('function showApplicantDetails('));
  assert.ok(move.includes("if (updated.length !== members.length) { boardOutOfDate = true; throw new Error('some applications could not be updated'); }"));
  assert.ok(move.includes('This candidate was removed or changed by someone else, so the stage was not updated. Press Refresh to update the board.'));
  assert.ok(move.includes('members.forEach((member, index) => { member.status = previous[index]; });'), 'the card goes back to where it was');
  assert.equal(/renderApplicants\(\)|listApplicants\(/.test(move), false, 'no automatic reload of the board');
  assert.ok(move.includes("else showToast(`Could not update applicant stage:"), 'other failures keep the generic message');
  assert.ok(builder.includes('function showToast(message, duration = 2400)'), 'a message that asks for an action stays longer on screen');
});

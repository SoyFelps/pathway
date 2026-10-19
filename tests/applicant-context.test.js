const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const details = () => { const b = read('builder.js'); return b.slice(b.indexOf('function flowResponsiblesText('), b.indexOf('async function doSignOut(')); };

test('the applicant panel header shows "applying for <company>" instead of repeating the e-mail', () => {
  const d = details();
  const header = d.slice(d.indexOf('<div class="applicant-detail-title">'), d.indexOf('<button class="modal-x"'));
  assert.equal(header.includes('candidate_email'), false, 'the e-mail is no longer in the header (it is in Candidate details)');
  assert.ok(d.includes("const applicantSubtitle = [flow?.companyName ? `applying for ${flow.companyName}` : '', group.count > 1 ? `Applied ${group.count} times` : ''].filter(Boolean).join(' · ');"));
  assert.ok(header.includes('${applicantSubtitle ? `<div class="muted">${esc(applicantSubtitle)}</div>` : \'\'}'));
  assert.ok(d.includes('<span>Email address</span><a href="mailto:'), 'the e-mail is still shown, once, in Candidate details');
});

test('Application record shows who is responsible for the job, read only', () => {
  const d = details();
  const record = d.slice(d.indexOf('<h3>Application record</h3>'), d.indexOf('</section>', d.indexOf('<h3>Application record</h3>')));
  assert.ok(record.includes('<span>Responsible</span><button type="button" class="applicant-responsible-trigger" id="applicant-responsible"'), 'a Responsible line in the record');
  assert.equal(/<(input|select)/.test(record), false, 'view only: nothing to edit');
  assert.ok(d.includes("window.PathwayBackend.getFlowResponsibles(applicant.flow_id)"));
  assert.ok(d.includes("return 'All team members'") || d.includes("'All team members'"), 'a job set to All reads "All team members"');
  assert.ok(d.includes("person.email + (person.isOwner ? ' (owner)' : '')"));
  assert.ok(d.includes(".catch(() => { responsibleNode.closest('.applicant-responsible-item')?.remove(); });"), 'if it cannot be loaded the line disappears instead of showing an error');
  assert.ok(read('builder.js').includes('flowResponsiblesCache.clear();'), 'Refresh reloads it');
});

test('reviewers who cannot read the flows table get the responsible people through a read-only function', () => {
  const sql = read('supabase/migrations/20261019100000_flow_responsibles_for_reviewers.sql');
  assert.ok(sql.includes("not public.workspace_user_has_permission(v_workspace, 'applicants')"), 'only people who can review candidates');
  assert.equal(/\b(insert|update|delete)\b\s+(into\s+)?public\./i.test(sql), false, 'it never writes');
  assert.match(sql, /revoke all on function public\.get_flow_responsibles\(uuid\) from public, anon, authenticated;\s*grant execute on function public\.get_flow_responsibles\(uuid\) to authenticated, service_role;/);
  assert.equal(/to anon/.test(sql), false);
  assert.ok(read('backend.js').includes("client.rpc('get_flow_responsibles', { p_flow_id: flowId })"));
});

test('the responsible people explain themselves: tooltip on hover, or for 5 seconds after a click or tap', () => {
  const d = read('builder.js');
  assert.ok(d.includes('These are the people responsible for this job. To change them, edit the job details.'));
  const tip = d.slice(d.indexOf('function bindInfoTooltip('), d.indexOf('// Who is responsible for each job'));
  assert.ok(tip.includes("trigger.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') tip.hidden = false; });"), 'hover opens it, for a mouse only');
  assert.ok(tip.includes("trigger.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') hide(); });"), 'the mouse leaving closes it');
  assert.ok(tip.includes("tip.hidden = false; clearTimeout(hideTimer); hideTimer = setTimeout(hide, 5000);"), 'a click or tap shows it and closes it after 5 seconds');
  assert.ok(tip.includes("event.key === 'Escape'") && tip.includes("addEventListener('blur', hide)"), 'Escape and leaving the field also close it');
  assert.ok(d.includes("bindInfoTooltip(responsibleNode, modalRoot.querySelector('#applicant-responsible-tip'))"));
  const css = read('styles.css');
  assert.ok(css.includes('.applicant-tooltip[hidden]{display:none}') && css.includes('background:var(--forest);color:var(--surface)'), 'drawn with colour tokens');
  assert.ok(d.includes('role="tooltip"') && d.includes('aria-describedby="applicant-responsible-tip"'), 'announced to screen readers');
});

test('the PDF preview asks the browser viewer to start without the page-thumbnails column, and only for the preview', () => {
  const builder = read('builder.js');
  assert.ok(builder.includes("const PDF_VIEWER_PARAMS = '#navpanes=0&pagemode=none';"));
  assert.ok(builder.includes("previewFrame.src = url.split('#')[0] + PDF_VIEWER_PARAMS;"), 'appended after the signed address, never inside it');
  assert.equal(/getApplicantResumeUrl\([^)]*true[^)]*\)[^;]*PDF_VIEWER_PARAMS/.test(builder), false, 'the download link is left untouched');
  assert.equal(builder.split('PDF_VIEWER_PARAMS').length - 1, 2, 'one definition and one use');
});

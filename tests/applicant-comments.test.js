const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const sql = read('supabase/migrations/20261019160000_applicant_comments.sql');

test('comments belong to a candidate (job + e-mail) and keep who wrote them and when', () => {
  assert.match(sql, /create table public\.applicant_comments/);
  assert.match(sql, /flow_id uuid not null references public\.application_flows\(id\) on delete cascade/);
  assert.match(sql, /candidate_email text not null/);
  assert.match(sql, /author_id uuid references auth\.users\(id\) on delete set null/, 'the comment survives the author leaving');
  assert.match(sql, /author_name text not null/, 'the name is stored with the comment');
  assert.match(sql, /body text not null check \(char_length\(body\) between 1 and 2000\)/);
  assert.match(sql, /created_at timestamptz not null default now\(\)/);
});

test('only people with the Applicants permission read comments, and nobody edits or deletes them directly', () => {
  assert.match(sql, /alter table public\.applicant_comments enable row level security/);
  assert.match(sql, /for select to authenticated\s+using \(public\.workspace_user_has_permission\(workspace_id, 'applicants'\)\)/);
  assert.match(sql, /revoke all on public\.applicant_comments from public, anon, authenticated;\s*grant select on public\.applicant_comments to authenticated;/);
  assert.equal(/grant (insert|update|delete|all)[^;]*applicant_comments to authenticated/.test(sql), false);
  assert.equal(/to anon/.test(sql), false);
});

test('adding a comment goes through one checked function', () => {
  assert.match(sql, /create or replace function public\.add_applicant_comment\(p_flow_id uuid, p_candidate_email text, p_body text\)/);
  assert.match(sql, /security definer\s+set search_path = ''/);
  assert.match(sql, /workspace_user_has_permission\(v_workspace, 'applicants'\)/);
  assert.match(sql, /between|char_length\(v_body\) < 1 or char_length\(v_body\) > 2000/);
  assert.match(sql, /Candidate not found/, 'the candidate must exist in that job');
  assert.match(sql, /author_id, author_name, body\)\s+values \(v_workspace, p_flow_id, v_email, auth\.uid\(\)/, 'the author comes from the session, never from the caller');
  assert.match(sql, /revoke all on function public\.add_applicant_comment\(uuid, text, text\) from public, anon, authenticated;\s*grant execute on function public\.add_applicant_comment\(uuid, text, text\) to authenticated, service_role;/);
});

test('the backend lists and adds comments for a candidate', () => {
  const backend = read('backend.js');
  assert.ok(backend.includes("from('applicant_comments').select('id,author_id,author_name,body,created_at,mentions')"));
  assert.ok(backend.includes(".eq('flow_id', flowId).eq('candidate_email', String(email || '').trim().toLowerCase())"));
  assert.ok(backend.includes("client.rpc('add_applicant_comment', { p_flow_id: flowId, p_candidate_email: email, p_body: text, p_mentions: mentionedUserIds })"));
  assert.ok(backend.includes('listApplicantComments,') && backend.includes('addApplicantComment,'));
});

test('the applicant panel has a Team comments section with a plain text box', () => {
  const builder = read('builder.js');
  assert.ok(builder.includes('id="applicant-comments-heading">Team comments</h3>'));
  assert.ok(builder.includes('<textarea class="text-area" id="applicant-comment-input" maxlength="2000"'));
  assert.ok(builder.includes('mountApplicantComments(modalRoot, applicant.flow_id, person.candidate_email);'), 'keyed by candidate, shared by repeat applications');
  const card = builder.slice(builder.indexOf('function commentHtml('), builder.indexOf('function mountApplicantComments('));
  assert.ok(card.includes('esc(comment.authorName)') && card.includes('<time datetime=') && card.includes('commentTimeFormat.format'), 'author, date and time are shown');
  assert.ok(card.indexOf('comment-meta') < card.indexOf('comment-body'), 'a small line with name and time sits above the comment text');
  assert.ok(builder.includes('let html = esc(comment.body);') && card.includes('commentBodyHtml(comment)'), 'the text is escaped before the mentions are highlighted');
  assert.ok(builder.includes("event.key === 'Enter' && (event.ctrlKey || event.metaKey)"), 'Ctrl+Enter sends');
  assert.ok(builder.includes("'Write a comment first.'"));
  const css = read('styles.css');
  assert.ok(css.includes('.comment-body{') && css.includes('white-space:pre-wrap') && css.includes('.visually-hidden{'));
});

test('the legal page lists the team comments as processed candidate data', () => {
  assert.ok(/internal comments/i.test(read('legal.html')));
});

test('the comments come last, below Application record', () => {
  const builder = read('builder.js');
  const record = builder.indexOf('<h3>Application record</h3>'), comments = builder.indexOf('id="applicant-comments-heading"'), bar = builder.indexOf('class="applicant-mobile-bar"');
  assert.ok(record > 0 && record < comments && comments < bar);
});

test('a comment can be deleted by its author or the workspace owner only', () => {
  const del = read('supabase/migrations/20261019170000_delete_applicant_comment.sql');
  assert.match(del, /create or replace function public\.delete_applicant_comment\(p_comment_id uuid\)/);
  assert.match(del, /security definer\s+set search_path = ''/);
  assert.ok(del.includes('w.owner_id = auth.uid()') && del.includes('v_comment.author_id = auth.uid()'), 'the owner or the author');
  assert.ok(del.includes("workspace_user_has_permission(v_comment.workspace_id, 'applicants')"), 'an author who lost access cannot delete');
  assert.match(del, /revoke all on function public\.delete_applicant_comment\(uuid\) from public, anon, authenticated;\s*grant execute on function public\.delete_applicant_comment\(uuid\) to authenticated, service_role;/);
  assert.equal(/to anon/.test(del), false);
  const backend = read('backend.js'), builder = read('builder.js');
  assert.ok(backend.includes("client.rpc('delete_applicant_comment', { p_comment_id: commentId })") && backend.includes('deleteApplicantComment,'));
  assert.ok(backend.includes(".select('id,author_id,author_name,body,created_at,mentions')"));
  assert.ok(builder.includes('const canDeleteComment = comment => Boolean(isOwner || (comment.authorId && user && comment.authorId === user.id));'));
  assert.ok(builder.includes('canDeleteComment(comment) ?') && builder.includes('data-delete-comment='), 'the button only shows for them');
  assert.ok(builder.includes('Delete? <button') && builder.includes('data-confirm-delete-comment'), 'a second click confirms');
});

const mentions = read('supabase/migrations/20261019180000_comment_mentions.sql');

test('@mentions are stored on the comment and notify only people who can open applicants', () => {
  assert.match(mentions, /add column mentions jsonb not null default '\[\]'::jsonb check \(jsonb_typeof\(mentions\) = 'array'\)/);
  assert.match(mentions, /create table public\.applicant_comment_mentions/);
  assert.match(mentions, /alter table public\.applicant_comment_mentions enable row level security;\s*revoke all on public\.applicant_comment_mentions from public, anon, authenticated;/);
  assert.equal(/grant (select|insert|update|delete)[^;]*applicant_comment_mentions to authenticated/.test(mentions), false, 'no direct access');
  assert.ok(mentions.includes('w.owner_id = u.id') && mentions.includes('m.can_applicants'), 'only the owner and members with the Applicants permission can be mentioned');
  assert.ok(mentions.includes('limit 10'), 'at most 10 people per comment');
  assert.ok(mentions.includes("where (m ->> 'userId')::uuid <> auth.uid()"), 'the author is not notified about their own comment');
  assert.ok(mentions.includes('on delete cascade') && mentions.includes('references public.applicant_comments(id)'), 'deleting the comment removes the notification');
  assert.ok(mentions.includes('m.user_id = auth.uid() and m.seen_at is null'), 'each person only sees their own unseen mentions');
  assert.match(mentions, /grant execute on function public\.get_comment_mentions\(uuid\) to authenticated, service_role;/);
  assert.equal(/to anon/.test(mentions), false);
});

test('typing @ in a comment opens a teammate list, and the bell shows who mentioned you', () => {
  const builder = read('builder.js'), backend = read('backend.js'), css = read('styles.css');
  assert.ok(builder.includes("id=\"applicant-mention-menu\"") && builder.includes('role="listbox"'));
  assert.ok(builder.includes(String.raw`/(^|\s)@([^\s@]*)$/`), '@ at the start or after a space');
  assert.ok(builder.includes("(row.isOwner || row.can_applicants) && row.userId !== user.id"), 'the list has people with access, not yourself');
  assert.ok(builder.includes("event.key === 'ArrowDown'") && builder.includes("event.key === 'Enter' || event.key === 'Tab'") && builder.includes("event.key === 'Escape'"), 'keyboard works');
  assert.ok(builder.includes("input.value.includes('@' + name)"), 'a person whose @name was erased is not mentioned');
  assert.ok(builder.includes('comment-mention'), 'the mention is highlighted in the comment');
  assert.ok(builder.includes('mentioned you in a comment') && builder.includes('mentionNotifs.length'), 'the bell lists mentions and counts them');
  assert.ok(builder.includes('data-notif-mention-flow') && builder.includes('pendingCandidateOpen'), 'clicking it opens the candidate');
  assert.ok(builder.includes("markCommentMentionsSeen(flowId, email)"), 'opening the candidate clears it');
  assert.ok(backend.includes("client.rpc('get_comment_mentions'") && backend.includes("client.rpc('mark_comment_mentions_seen'"));
  assert.ok(css.includes('.mention-menu{') && css.includes('.comment-mention{'));
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

test('the database lists the last 30 days of the three kinds of notification, seen or not, with the same rules as the bell', () => {
  const sql = read('supabase/migrations/20261103140000_notification_history.sql');
  assert.match(sql, /function public\.get_notification_history\(p_workspace_id uuid, p_utc_offset_minutes integer default 0\)/);
  assert.match(sql, /v_since timestamptz := now\(\) - interval '30 days'/);
  assert.match(sql, /not public\.workspace_user_has_permission\(p_workspace_id, 'applicants'\)/, 'only people with the Candidates permission');
  assert.match(sql, /cardinality\(f\.responsible_user_ids\) = 0 or auth\.uid\(\) = any \(f\.responsible_user_ids\)/, 'only the responsible people of a job');
  assert.match(sql, /timestamptz '2026-10-18 12:30:00\+00'/, 'nothing from before the feature existed');
  assert.match(sql, /'new_candidates'::text/);
  assert.match(sql, /'mention'::text/);
  assert.match(sql, /'ai_interview'::text/);
  assert.match(sql, /group by mine\.fid, mine\.title, mine\.company, date_trunc\('day', cand\.first_at \+ v_offset\)/, 'one entry per job and per day of the person');
  assert.match(sql, /cand\.first_fail is null/, 'candidates failed automatically never notified');
  assert.match(sql, /limit 500/);
  assert.match(sql, /revoke all on function public\.get_notification_history\(uuid, integer\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.get_notification_history\(uuid, integer\) to authenticated, service_role;/);
  assert.doesNotMatch(sql, /\binsert\b|\bupdate public\.|\bdelete\b|create table/i, 'read only, nothing new is stored');
});

test('the backend asks for the history with the person\'s own time zone offset', () => {
  const backend = read('backend.js');
  assert.match(backend, /rpc\('get_notification_history', \{ p_workspace_id: workspaceId, p_utc_offset_minutes: -new Date\(\)\.getTimezoneOffset\(\) \}\)/);
  assert.match(backend, /listFlowNotifications,\n\s+listNotificationHistory,/);
});

test('the bell has a "See all" link that opens the notifications page, also when there is nothing unread', () => {
  const builder = read('builder.js');
  assert.match(builder, /menu\.innerHTML = \(total[\s\S]*?: '<div class="notif-empty">You are all caught up\.<\/div>'\) \+ '<div class="notif-footer"><button type="button" class="notif-see-all" data-notif-all>See all<\/button><\/div>';/);
  assert.match(builder, /if \(event\.target\.closest\('\[data-notif-all\]'\)\) \{ setOpen\(false\); void renderNotifications\(\); return; \}/);
  assert.match(builder, /else if \(requestedPage === 'notifications'\) void renderNotifications\(\);/, 'the page has its own address');
});

test('the page has Today and This week open, and Last 30 days folded until the person opens it', () => {
  const builder = read('builder.js');
  assert.match(builder, /startOfWeek\.setDate\(startOfWeek\.getDate\(\) - 6\)/, 'this week = today and the six days before');
  assert.match(builder, /\(at >= startOfToday \? today : at >= startOfWeek \? week : month\)\.push\(item\)/);
  assert.match(builder, /let notificationMonthOpen = false;/, 'folded by default');
  assert.match(builder, /id="notif-month-toggle" aria-expanded="' \+ notificationMonthOpen \+ '" aria-controls="notif-month-list"/);
  assert.match(builder, /id="notif-month-list"' \+ \(notificationMonthOpen \? '' : ' hidden'\)/);
  assert.match(builder, /open\('Today', today, 'today', 'Nothing new today\.'\)/);
  assert.match(builder, /open\('This week', week, 'week', 'Nothing else this week\.'\)/);
  assert.match(builder, /<span class="notif-unread-dot" role="img" aria-label="Unread">/, 'what was not seen yet is marked');
});

test('a notification opens the same thing from the bell and from the page', () => {
  const builder = read('builder.js');
  assert.match(builder, /function openNotificationTarget\(target\)/);
  assert.match(builder, /if \(row\) openNotificationTarget\(row\);/);
  assert.match(builder, /if \(openNotificationTarget\(event\.target\)\) setOpen\(false\);/);
  // the three kinds carry the same data attributes in the bell and in the page
  for (const attr of ['data-notif-ai=', 'data-notif-mention-flow=', 'data-notif-flow=']) {
    assert.ok(builder.split(attr).length >= 3, attr + ' is written for the bell and for the page');
  }
});

test('"X new candidates" counts only candidates still in the New column, in the bell and in the page, whether or not the notification was opened', () => {
  const sql = read('supabase/migrations/20261103160000_notification_counts_new_only.sql');
  const bell = sql.slice(sql.indexOf('function public.get_flow_notifications'), sql.indexOf('function public.get_notification_history'));
  const page = sql.slice(sql.indexOf('function public.get_notification_history'));
  for (const [name, body] of [['bell', bell], ['page', page]]) {
    assert.match(body, /current_status = 'new' and cand\.first_fail is null/, name + ': only candidates still in New, never the ones failed automatically');
    assert.doesNotMatch(body, /current_status <> 'failed'/, name + ': the old rule (only Failed left out) is gone');
    assert.match(body, /\(array_agg\(a\.status order by a\.submitted_at desc\)\)\[1\] as current_status/, name + ': the stage of the candidate is the latest application\'s');
    assert.match(body, /coalesce\(wc\.name, w\.name\)/, name + ': the same company label');
  }
  // the seen state must not keep a candidate who left New: the stage filter is in the same WHERE as the date rule, not behind the seen flag
  assert.match(page, /where cand\.first_at > mine\.base and cand\.first_at >= v_since\s+and cand\.current_status = 'new' and cand\.first_fail is null/);
});

test('the days of the person are cut on a timestamp without time zone, so the database session time zone does not matter', () => {
  const sql = read('supabase/migrations/20261103160000_notification_counts_new_only.sql');
  assert.match(sql, /date_trunc\('day', \(cand\.first_at at time zone 'UTC'\) \+ v_offset\)/);
  assert.doesNotMatch(sql, /date_trunc\('day', cand\.first_at \+ v_offset\)/);
});

test('the page follows the bell while it is open, starts folded on every visit and has a real heading for Last 30 days', () => {
  const builder = read('builder.js');
  assert.match(builder, /if \(root\.querySelector\('\.notifications-page'\)\) void refreshNotificationPage\(\);/, 'the bell\'s check refreshes the open page');
  assert.match(builder, /async function refreshNotificationPage\(\)/);
  assert.match(builder, /=== notificationPageSignature\) return;/, 'nothing is redrawn when nothing changed');
  assert.match(builder, /notificationMonthOpen = false; \/\/ every visit starts with "Last 30 days" folded/);
  assert.match(builder, /<h2 class="notif-section-heading"><button type="button" class="notif-section-toggle" id="notif-month-toggle"/);
  assert.match(read('styles.css'), /\.notif-section-heading\{margin:0;font:inherit;line-height:inherit\}/);
});

test('the "Last 30 days" toggle uses a drawn chevron icon (not a text glyph) that turns when opened', () => {
  const src = read('builder.js');
  assert.match(src, /<span class="notif-chevron" aria-hidden="true"><svg viewBox="0 0 20 20"/);
  assert.equal(src.includes('▸'), false);
  const css = read('styles.css');
  assert.match(css, /\.notif-section-toggle\[aria-expanded="true"\] \.notif-chevron\{transform:rotate\(90deg\)\}/);
});

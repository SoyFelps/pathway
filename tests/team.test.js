const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('team schema reserves at most three Premium member seats and stores only invitation-token hashes', () => {
  const sql = read('supabase/migrations/20260929150000_my_team.sql');
  const invitationFix = read('supabase/migrations/20260929185600_fix_team_invitation_expiry_column.sql');
  assert.match(sql, /create table public\.workspace_members/);
  assert.match(sql, /user_id uuid not null unique references auth\.users/);
  assert.match(sql, /index workspace_invitations_pending_email_idx/);
  assert.match(sql, /token_hash text not null unique check \(token_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  assert.match(sql, /interval '7 days'/);
  assert.match(sql, /if seat_count >= 3/);
  assert.match(sql, /if seat_count >= 3 then raise exception 'This workspace no longer has an available member seat\.'/);
  assert.match(sql, /public\.workspace_has_active_subscription\(p_workspace_id\)/);
  assert.match(sql, /pathway_team_invite_pending/);
  assert.match(invitationFix, /wi\.expires_at <= now\(\)/);
});

test('team permissions independently gate flows, candidates, team administration, and resume access', () => {
  const sql = read('supabase/migrations/20260929150000_my_team.sql');
  assert.match(sql, /when 'flows' then m\.can_flows/);
  assert.match(sql, /when 'applicants' then m\.can_applicants/);
  assert.match(sql, /when 'team' then m\.can_manage_team/);
  assert.match(sql, /workspace flow editors can (read|create|update|delete) flows/);
  assert.match(sql, /workspace applicant reviewers can (read|update applicant status)/);
  assert.match(sql, /workspace applicant reviewers can view applicant resumes/);
  assert.match(sql, /can_manage_team and public\.workspace_has_active_subscription/);
  assert.match(sql, /f\.id = published_flows\.flow_id and f\.workspace_id = published_flows\.workspace_id/);
});

test('members cannot read subscription records and My Plan is rendered only for the owner', () => {
  const sql = read('supabase/migrations/20260929150000_my_team.sql');
  const billingSql = read('supabase/migrations/20260926195500_stripe_subscription_publication_gates.sql');
  const builder = read('builder.js');
  assert.match(billingSql, /workspace owners can read their subscription status/);
  assert.doesNotMatch(sql, /create policy[^;]+workspace_subscriptions/is);
  assert.match(builder, /if \(!isOwner\) return hasPermission\('flows'\) \? renderDashboard\(\) : renderAccessMessage\('flows'\)/);
  assert.match(builder, /\$\{isOwner \? `<button class="sidebar-link \$\{active === 'my-plan'/);
  assert.match(builder, /if \(!isOwner\) return '';/);
});

test('invitation auth accepts the invited email, allows existing-account sign-in, and keeps former accounts reusable', () => {
  const auth = read('auth.js');
  const backend = read('backend.js');
  const sql = read('supabase/migrations/20260929150000_my_team.sql');
  assert.match(auth, /getInviteToken\(\)/);
  assert.match(auth, /Already registered\? Sign in/);
  assert.match(auth, /Create account and join/);
  assert.match(auth, /acceptTeamInvitation\(inviteToken\)/);
  assert.match(auth, /Create your own workspace/);
  assert.match(auth, /renderInviteConfirmationNeeded/);
  assert.match(backend, /pathway_team_invite_pending/);
  assert.match(backend, /emailRedirectTo: window\.location\.origin \+ window\.location\.pathname/);
  assert.match(sql, /u\.email_confirmed_at is not null into actor_email, actor_email_verified/);
  assert.doesNotMatch(backend, /pathway_team_invite_token/);
  assert.match(sql, /delete from public\.workspace_members where workspace_id = p_workspace_id and user_id = auth\.uid\(\)/);
  assert.doesNotMatch(sql, /auth\.admin|delete from auth\.users/i);
});

test('team Edge Function separates public invite preview from authenticated membership changes', () => {
  const edge = read('supabase/functions/team/index.ts');
  assert.match(edge, /action === "previewInvitation"/);
  assert.match(edge, /action === "acceptInvitation"/);
  assert.match(edge, /action === "createInvitation"/);
  assert.match(edge, /action === "updateMemberPermissions"/);
  assert.match(edge, /action === "updateInvitationPermissions"/);
  assert.match(edge, /action === "revokeInvitation"/);
  assert.match(edge, /action === "removeMember"/);
  assert.match(edge, /action === "leaveTeam"/);
  assert.match(edge, /admin\.auth\.getUser\(token\)/);
  assert.match(edge, /if \(!user\.email_confirmed_at\)/);
  assert.match(edge, /const canManage = isOwner \|\| \(context\.premiumActive && Boolean\(context\.member\?\.can_manage_team\)\)/);
  assert.match(edge, /inviteUrl\.hash = `team-invite=\$\{token\}`/);
  assert.match(edge, /workspace_invitations.*select\("workspace_id,invited_email,expires_at,status"\)/s);
});

test('My Team shows up to three included seats, defaults permissions on, and supports leave without deleting account', () => {
  const builder = read('builder.js');
  const sql = read('supabase/migrations/20260929150000_my_team.sql');
  assert.match(builder, /Premium includes up to 3 additional members at no extra seat charge/);
  assert.match(builder, /data\.seatsUsed >= 3/);
  assert.match(builder, /data-invite-permission="flows" checked/);
  assert.match(builder, /data-invite-permission="applicants" checked/);
  assert.match(builder, /data-invite-permission="team" checked/);
  assert.match(builder, /async function showLeaveTeamConfirmation|function showLeaveTeamConfirmation/);
  assert.match(builder, /Your account will remain active/);
  assert.match(builder, /id="leave-team"/);
  assert.match(builder, /data-route="my-team"/);
  assert.match(builder, /if \(!isOwner\) return '';/);
  assert.match(builder, /if \(!hasPermission\('flows'\)\) return renderAccessMessage\('flows'\)/);
  assert.match(sql, /The workspace owner cannot leave their own workspace/);
  assert.match(sql, /The workspace owner cannot be removed/);
  assert.match(sql, /lower\(invited_email\) = \(\s*select lower\(m\.member_email\) from public\.workspace_members m\s*where m\.workspace_id = p_workspace_id and m\.user_id = auth\.uid\(\)/);
  assert.match(builder, /if \(id === user\.id\) \{ await doSignOut\(\); return; \}/);
  assert.match(builder, /if \(card\.dataset\.memberId === user\.id\) \{ await renderMyTeam\(\); return; \}/);
});

test('My Team stylesheet and static page load are versioned for immediate deployment', () => {
  const html = read('index.html');
  const css = read('styles.css');
  assert.match(html, /auth\.js\?v=my-team-20260929/);
  assert.match(html, /builder\.js\?v=my-team-20260929/);
  assert.match(css, /\/\* My Team \*\//);
  assert.match(css, /\.my-team-page/);
});

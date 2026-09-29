const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('team schema reserves three Premium seats and supports hashed acceptance with encrypted link recovery', () => {
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
  const recoverableLinks = read('supabase/migrations/20260929194000_recoverable_team_invite_links.sql');
  assert.match(recoverableLinks, /encrypted_token text/);
  assert.match(recoverableLinks, /Acceptance still uses only token_hash/);
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
  assert.match(auth, /acceptPendingTeamInvitation\(\)/);
  assert.match(auth, /Create your own workspace/);
  assert.match(auth, /After confirmation, Pathway will add you to the invited workspace automatically/);
  assert.doesNotMatch(auth, /reopen the copied invitation link to finish joining/i);
  assert.match(backend, /pathway_team_invite_pending/);
  assert.match(backend, /emailRedirectTo: window\.location\.origin \+ window\.location\.pathname/);
  assert.match(sql, /u\.email_confirmed_at is not null into actor_email, actor_email_verified/);
  assert.doesNotMatch(backend, /pathway_team_invite_token/);
  assert.match(sql, /delete from public\.workspace_members where workspace_id = p_workspace_id and user_id = auth\.uid\(\)/);
  assert.doesNotMatch(sql, /auth\.admin|delete from auth\.users/i);
});

test('confirmed invite signups are joined automatically from the standard app URL using the verified email', () => {
  const auth = read('auth.js');
  const backend = read('backend.js');
  const edge = read('supabase/functions/team/index.ts');
  assert.match(auth, /if \(context\.user\?\.user_metadata\?\.pathway_team_invite_pending === true\)/);
  assert.match(auth, /const result = await window\.PathwayBackend\.acceptPendingTeamInvitation\(\)/);
  assert.match(auth, /context = await acceptPendingTeamIfNeeded\(context\)/);
  assert.match(auth, /clearInviteUrl\(\)/);
  assert.match(backend, /acceptPendingTeamInvitation\(\) \{ return callTeam\(\{ action: 'acceptPendingInvitation' \}\); \}/);
  assert.match(edge, /body\.action === "acceptPendingInvitation"/);
  assert.match(edge, /if \(!user\.email_confirmed_at\) return fail\(req, 403, "Confirm your email address before joining a workspace\."\)/);
  assert.match(edge, /user\.user_metadata\?\.pathway_team_invite_pending !== true/);
  assert.match(edge, /\.eq\("invited_email", email\)\.eq\("status", "pending"\)/);
  assert.match(edge, /userClient\.rpc\("accept_team_invitation", \{ p_token_hash: invitation\.token_hash \}\)/);
  assert.match(edge, /pathway_team_invite_pending: false/);
});

test('pending invitations can copy their active link from encrypted token storage', () => {
  const backend = read('backend.js');
  const builder = read('builder.js');
  const edge = read('supabase/functions/team/index.ts');
  const migration = read('supabase/migrations/20260929194000_recoverable_team_invite_links.sql');
  assert.match(builder, /data-copy-invitation-link="\$\{esc\(invite\.id\)\}"/);
  assert.match(builder, /copyTeamInviteLink\(button\)/);
  assert.match(builder, /previous link no longer works/);
  assert.match(backend, /getTeamInvitationLink\(invitationId\) \{ return callTeam\(\{ action: 'getInvitationLink', invitationId, appUrl: window\.location\.origin \+ window\.location\.pathname \}\); \}/);
  assert.match(edge, /body\.action === "getInvitationLink"/);
  assert.match(edge, /const permissionDenied = requireManager\(\);[\s\S]{0,120}if \(!context\.premiumActive\)/);
  assert.match(edge, /\.eq\("id", invitationId\)\.eq\("workspace_id", workspaceId\)\.eq\("status", "pending"\)/);
  assert.match(edge, /async function encryptInviteToken\(token: string\)/);
  assert.match(edge, /async function decryptInviteToken\(encrypted: string\)/);
  assert.match(edge, /\[A-Za-z0-9_-\]\{107\}/);
  assert.match(edge, /p_encrypted_token: await encryptInviteToken\(token\)/);
  assert.match(edge, /let token = "";[\s\S]*if \(existing\.encrypted_token\)[\s\S]*await decryptInviteToken\(existing\.encrypted_token\)/);
  assert.match(migration, /add column if not exists encrypted_token text/);
  assert.match(migration, /encrypted_token ~ '\^v1\[\.\]\[A-Za-z0-9_-\]\{16\}\[\.\]\[A-Za-z0-9_-\]\{107\}\$'/);
  assert.match(migration, /insert into public\.workspace_invitations as i \([\s\S]*token_hash, encrypted_token, can_flows/);
  assert.match(migration, /grant execute on function public\.create_team_invitation\(uuid, text, text, text, boolean, boolean, boolean\) to authenticated/);
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
  assert.match(html, /auth\.js\?v=team-auto-accept-20260929/);
  assert.match(html, /backend\.js\?v=team-invite-recovery-20260929/);
  assert.match(html, /builder\.js\?v=team-invite-recovery-20260929/);
  assert.match(css, /\/\* My Team \*\//);
  assert.match(css, /\.my-team-page/);
});

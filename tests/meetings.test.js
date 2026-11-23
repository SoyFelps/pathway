const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const loadLogic = () => import('../supabase/functions/meetings/logic.ts');

test('the room opens 30 minutes before the interview and closes one day after it; cancelled or unscheduled never opens', async () => {
  const { roomStatus, roomWindow } = await loadLogic();
  const start = new Date('2026-12-01T17:00:00Z');
  const at = iso => new Date(iso);
  assert.equal(roomStatus('confirmed', start.toISOString(), at('2026-12-01T16:29:00Z')), 'early');
  assert.equal(roomStatus('confirmed', start.toISOString(), at('2026-12-01T16:30:00Z')), 'open');
  assert.equal(roomStatus('invited', start.toISOString(), at('2026-12-02T16:59:00Z')), 'open', 'the day after, still open');
  assert.equal(roomStatus('finished', start.toISOString(), at('2026-12-02T17:01:00Z')), 'closed');
  assert.equal(roomStatus('cancelled', start.toISOString(), at('2026-12-01T17:00:00Z')), 'cancelled');
  assert.equal(roomStatus('awaiting_schedule', null, at('2026-12-01T17:00:00Z')), 'unscheduled');
  assert.equal(roomWindow(start).opensAt.toISOString(), '2026-12-01T16:30:00.000Z');
});

test('the secret of a room link is long and random, only its hash is stored, and the Realtime channel is unrelated to it', async () => {
  const { newSecret, hashSecret, looksLikeSecret, newChannelKey } = await loadLogic();
  const secret = newSecret();
  assert.equal(secret.length, 43);
  assert.ok(looksLikeSecret(secret) && !looksLikeSecret('short') && !looksLikeSecret(secret + 'x'));
  assert.notEqual(newSecret(), secret);
  assert.match(await hashSecret(secret), /^[0-9a-f]{64}$/);
  assert.match(newChannelKey(), /^[0-9a-f]{40}$/);
  const sql = read('supabase/migrations/20261123100000_meeting_rooms.sql');
  assert.ok(sql.includes('secret_hash text not null unique') && !/\bsecret text\b/.test(sql), 'the plain secret is never stored');
  assert.ok(sql.includes('alter table public.meeting_rooms enable row level security') && sql.includes('revoke all on public.meeting_rooms from public, anon, authenticated') && sql.includes('grant all on public.meeting_rooms to service_role'));
  assert.equal(/grant [^;]*meeting_rooms to authenticated/.test(sql), false, 'the browser never reads the rooms');
});

test('the function hands out the channel and TURN only to someone with the secret, inside the window, who presses "join"', () => {
  const index = read('supabase/functions/meetings/index.ts');
  assert.ok(index.includes('if (status === "open" && body.enter === true)'), 'opening the page only shows the room');
  assert.ok(index.includes('view.channel = `meeting:${room.channel_key}`') && index.includes('view.iceServers = await turnServers()'));
  assert.ok(!/CLOUDFLARE_TURN_API_TOKEN[^\n]*response\(/.test(index), 'the TURN key never goes to the browser');
  assert.ok(index.includes('await userClient.from("candidate_interviews").select("id,workspace_id,state,kind")'), 'creating a room needs a person who can see the interview');
  assert.ok(index.includes('Only online interviews have a meeting room.') && index.includes('planActive(seen.workspace_id)'));
});

test('the room page asks for the camera only after a click, follows the job language and starts phones at a lower quality', () => {
  const page = read('meeting.js');
  const html = read('meeting.html');
  assert.ok(html.indexOf('meeting-room.js') < html.indexOf('meeting.js?') && html.includes('noindex') && html.includes('no-referrer'));
  assert.ok(!/^\s*(await\s+)?startDevices\(\);?\s*$/m.test(page.split('async function load()')[1] || ''), 'loading the page never turns the camera on');
  assert.ok(page.includes("I18N.forLanguage(view.language)"));
  assert.ok(page.includes("frameRate: { ideal: 24, max: 24 }") && page.includes('videoMaxBitrate: PHONE ? 600000 : 0'));
  assert.ok(page.includes("call({ action: 'join', secret, enter: true })"), 'the channel is asked for only when entering');
  const room = read('meeting-room.js');
  assert.ok(room.includes('const MAX_PEOPLE = 4') && room.includes('polite: myId > id') && room.includes('pc.restartIce()'));
});

test('a tile with no picture shows the initials and the name; camera and microphone changes travel as messages, never as presence updates', () => {
  const room = read('meeting-room.js');
  const page = read('meeting.js');
  assert.ok(room.includes("channel.send({ type: 'broadcast', event: 'state'") && !/setTrack[\s\S]{0,300}announce\(\)/.test(room), 'turning the camera off must not update presence (that dropped the connection of the others)');
  assert.ok(room.includes('missing.set(id, setTimeout('), 'someone absent from the presence list for a moment is not dropped at once');
  assert.ok(room.includes("event: 'bye'"), 'pressing Leave removes the tile at once');
  assert.ok(room.includes('lastState.get(person.id)'), 'a newcomer sees the current camera state of the others');
  assert.ok(page.includes("tile.classList.toggle('is-off', !person.cam || !picture)") && page.includes('const initials = name =>') && page.includes(".split(/\\s+/)"));
  assert.ok(read('styles.css').includes('.meeting-tile.is-off .meeting-avatar{display:flex}'));
});

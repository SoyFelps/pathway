const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

function loadCore() {
  const sandbox = { window: {}, localStorage: { getItem() { return null; }, setItem() {} }, console };
  vm.createContext(sandbox);
  vm.runInContext(read('pathway.js'), sandbox);
  return sandbox.window.PathwayCore;
}
const person = (n, extra = {}) => ({ id: 'id-' + n, flow_id: 'job', candidate_email: `p${n}@example.test`, status: 'new', submitted_at: `2026-10-${String(10 + n).padStart(2, '0')}T10:00:00Z`, board_position: null, ...extra });

test('cards nobody placed keep the old order: newest first', () => {
  const Core = loadCore();
  const groups = Core.groupApplicants([person(1), person(3), person(2)]);
  assert.deepEqual(Array.from(groups, g => g.latest.id), ['id-3', 'id-2', 'id-1']);
  assert.ok(groups.every(g => g.position === null));
});

test('cards placed by hand follow their position, after the new ones (which stay on top, newest first)', () => {
  const Core = loadCore();
  const groups = Core.groupApplicants([
    person(1, { board_position: 3000 }), person(2, { board_position: 1000 }), person(3, { board_position: 2000 }), // placed by hand
    person(4), person(5) // arrived later: nobody placed them
  ]);
  assert.deepEqual(Array.from(groups, g => g.latest.id), ['id-5', 'id-4', 'id-2', 'id-3', 'id-1']);
});

test('every application of one candidate shares one place: a new repeat application does not move the card', () => {
  const Core = loadCore();
  const first = person(1, { board_position: 2000, submitted_at: '2026-10-11T10:00:00Z' });
  const repeat = { ...person(1), id: 'id-1b', submitted_at: '2026-10-20T10:00:00Z', board_position: null }; // same job and e-mail
  const other = person(2, { board_position: 1000 });
  const groups = Core.groupApplicants([first, repeat, other]);
  assert.equal(groups.length, 2);
  assert.equal(groups.find(g => g.count === 2).position, 2000);
  assert.deepEqual(Array.from(groups, g => g.position), [1000, 2000], 'it stays where the person put it');
});

test('the database: a nullable column, a column grant, and a function that respects row level security and never touches the stage', () => {
  const sql = read('supabase/migrations/20261103120000_applicant_board_order.sql');
  assert.match(sql, /add column if not exists board_position double precision;/);
  assert.match(sql, /grant update \(board_position\) on public\.applicants to authenticated;/);
  assert.match(sql, /function public\.set_applicant_order\(p_items jsonb\)[\s\S]*security invoker/, 'invoker: the policies (permission and active plan) apply');
  assert.doesNotMatch(sql, /set\s+status|status\s*=/i, 'the stage is never written, so the stage-change triggers do not fire');
  assert.match(sql, /jsonb_array_length\(p_items\) > 2000/);
  assert.match(sql, /revoke all on function public\.set_applicant_order\(jsonb\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.set_applicant_order\(jsonb\) to authenticated;/);
});

test('the backend loads the position, clears it when a card changes stage, and saves a new order through the function', () => {
  const backend = read('backend.js');
  assert.match(backend, /auto_fail_reason,board_position'\)/);
  assert.match(backend, /update\(\{ status, board_position: null \}\)\.in\('id', applicantIds\)/);
  assert.match(backend, /rpc\('set_applicant_order', \{ p_items:/);
  assert.match(backend, /updateApplicantStatuses,\n\s+setApplicantOrder,/);
});

test('the board: a green line shows where the card will land, and a drop gives the column its new order', () => {
  const builder = read('builder.js');
  const styles = read('styles.css');
  assert.match(builder, /const dropIndex = \(column, clientY\) =>/);
  assert.match(builder, /clientY < rect\.top \+ rect\.height \/ 2/, 'the card goes above the first card whose middle is below the pointer');
  assert.match(builder, /void moveApplicant\(applicantId, column\.dataset\.stage, hasList \? order : null\);/);
  assert.match(builder, /current\.join\(\) === order\.join\(\)\) return;/, 'dropping where it already was does nothing');
  assert.match(builder, /async function moveApplicant\(id, status, orderIds = null\)/);
  assert.match(builder, /\(index \+ 1\) \* 1000/);
  assert.match(builder, /if \(sameColumn && !orderIds\) return;/, 'dropping in the same column without an order still does nothing');
  assert.match(builder, /if \(workspaceIsFree\(\)\) \{ showToast\(FREE_MOVE_NOTE, 6000\); return; \}/, 'same plan rule as moving between stages');
  assert.match(styles, /\.applicant-card\.drop-before::before,\.applicant-card\.drop-after::after\{content:""/);
});

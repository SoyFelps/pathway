const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../supabase/functions/interviews/calendar.ts');

const ev = {
  uid: 'abc-123', sequence: 2, startsAt: new Date('2026-12-01T17:00:00Z'), durationMinutes: 30,
  title: 'Interview: Product Designer, CoreFront', description: 'Bring an ID; arrive early\nSecond line',
  location: 'Av. Paulista, 1000 – São Paulo', url: 'https://nellio.app/interview.html',
};

test('the .ics has CRLF lines, UTC times, a stable UID, the sequence and no METHOD', async () => {
  const { buildIcs } = await load();
  const ics = buildIcs(ev, new Date('2026-11-19T10:00:00Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(ics.includes('\n') && ics.replace(/\r\n/g, '').includes('\n'), false, 'only CRLF line breaks');
  assert.match(ics, /UID:abc-123@nellio\.app\r\n/);
  assert.match(ics, /SEQUENCE:2\r\n/);
  assert.match(ics, /DTSTART:20261201T170000Z\r\n/);
  assert.match(ics, /DTEND:20261201T173000Z\r\n/);
  assert.match(ics, /DTSTAMP:20261119T100000Z\r\n/);
  assert.equal(/METHOD:/.test(ics), false);
});

test('text is escaped and long lines are folded at 75 octets without cutting a character', async () => {
  const { buildIcs, icsEscape, icsFold } = await load();
  assert.equal(icsEscape('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  const ics = buildIcs({ ...ev, description: 'ção '.repeat(60) });
  const enc = new TextEncoder();
  for (const line of ics.split('\r\n')) assert.ok(enc.encode(line).length <= 75, 'line too long: ' + line);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('DESCRIPTION:' + 'ção '.repeat(60)), 'unfolding gives back the original text');
  assert.equal(icsFold('short'), 'short');
});

test('the time is the same moment whatever the time zone: UTC only, no TZID', async () => {
  const { buildIcs } = await load();
  assert.equal(/TZID/.test(buildIcs(ev)), false);
});

test('Google and Outlook links carry title, time, place and the interview page', async () => {
  const { googleCalendarUrl, outlookCalendarUrl } = await load();
  const g = new URL(googleCalendarUrl(ev));
  assert.equal(g.origin + g.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(g.searchParams.get('action'), 'TEMPLATE');
  assert.equal(g.searchParams.get('text'), ev.title);
  assert.equal(g.searchParams.get('dates'), '20261201T170000Z/20261201T173000Z');
  assert.equal(g.searchParams.get('location'), ev.location);
  assert.ok(g.searchParams.get('details').includes(ev.url));
  const o = new URL(outlookCalendarUrl(ev));
  assert.equal(o.origin, 'https://outlook.live.com');
  assert.equal(o.searchParams.get('startdt'), '2026-12-01T17:00:00Z');
  assert.equal(o.searchParams.get('enddt'), '2026-12-01T17:30:00Z');
  assert.equal(o.searchParams.get('subject'), ev.title);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Cal = require('../interviews-calendar.js');

const at = (year, month, day, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute);
const event = (id, start, minutes = 30) => ({ id, start, end: new Date(start.getTime() + minutes * 60000) });

test('weeks start on Monday', () => {
  assert.equal(Cal.dayKey(Cal.weekStart(at(2026, 11, 20))), '2026-11-16', 'Friday 20 Nov 2026 -> Monday 16');
  assert.equal(Cal.dayKey(Cal.weekStart(at(2026, 11, 22, 23, 59))), '2026-11-16', 'Sunday belongs to the week that started on Monday');
  assert.equal(Cal.dayKey(Cal.weekStart(at(2026, 11, 16))), '2026-11-16');
  assert.equal(Cal.weekdayIndex(at(2026, 11, 21)), 5, 'Saturday');
});

test('Saturday and Sunday are only shown when an interview falls on them', () => {
  const anchor = at(2026, 11, 18);
  assert.deepEqual(Cal.weekDays(anchor, []).map(Cal.dayKey), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'], 'no interview: Monday to Friday');
  assert.deepEqual(Cal.weekDays(anchor, [event('a', at(2026, 11, 21, 10))]).map(Cal.dayKey).slice(-2), ['2026-11-20', '2026-11-21'], 'a Saturday interview adds Saturday only');
  assert.equal(Cal.weekDays(anchor, [event('a', at(2026, 11, 22, 10))]).length, 6, 'a Sunday interview adds Sunday (Saturday stays hidden)');
  assert.equal(Cal.weekDays(anchor, [event('a', at(2026, 11, 21, 9)), event('b', at(2026, 11, 22, 9))]).length, 7);
  assert.equal(Cal.weekDays(anchor, [event('a', at(2026, 11, 30, 9))]).length, 5, 'an interview of another week does not matter');
});

test('the month grid: Monday first, whole weeks, weekend columns only with an interview in that month', () => {
  const plain = Cal.monthGrid(at(2026, 11, 10), []);
  assert.deepEqual(plain.columns, [0, 1, 2, 3, 4]);
  assert.ok(plain.weeks.every(week => week.length === 5), 'five columns in every row');
  assert.equal(Cal.dayKey(plain.weeks[0][0]), '2026-10-26', 'November 2026 starts on a Sunday: the first row starts on the Monday before');
  assert.equal(plain.weeks.length, 6, 'Nov 2026 spans six Monday-based weeks');
  const withSaturday = Cal.monthGrid(at(2026, 11, 10), [event('a', at(2026, 11, 14, 9))]);
  assert.deepEqual(withSaturday.columns, [0, 1, 2, 3, 4, 5]);
  assert.ok(withSaturday.weeks.every(week => week.length === 6));
  const neighbour = Cal.monthGrid(at(2026, 11, 10), [event('a', at(2026, 12, 5, 9))]);
  assert.deepEqual(neighbour.columns, [0, 1, 2, 3, 4], 'an interview of the next month, even in a filler day, does not widen this month');
  const feb = Cal.monthGrid(at(2021, 2, 1), []);
  assert.equal(feb.weeks.length, 4, 'February 2021 starts on a Monday and has 28 days: exactly four weeks');
  assert.equal(Cal.monthGrid(at(2026, 2, 1), []).weeks.length, 5, 'February 2026 starts on a Sunday: five Monday-based weeks');
});

test('stepping a day skips a weekend without interviews', () => {
  assert.equal(Cal.dayKey(Cal.stepDay(at(2026, 11, 20), 1, [])), '2026-11-23', 'Friday -> Monday');
  assert.equal(Cal.dayKey(Cal.stepDay(at(2026, 11, 23), -1, [])), '2026-11-20', 'Monday -> Friday');
  assert.equal(Cal.dayKey(Cal.stepDay(at(2026, 11, 20), 1, [event('a', at(2026, 11, 21, 9))])), '2026-11-21', 'a Saturday with an interview is a stop');
  assert.equal(Cal.dayKey(Cal.stepDay(at(2026, 11, 21), 1, [event('a', at(2026, 11, 21, 9))])), '2026-11-23', 'Sunday without one is skipped');
});

test('hours of the grid and the side-by-side lanes of overlapping interviews', () => {
  assert.deepEqual(Cal.hourRange([]), { from: 8, to: 18 }, 'a working day by default');
  assert.deepEqual(Cal.hourRange([event('a', at(2026, 11, 20, 6, 30), 90), event('b', at(2026, 11, 20, 19, 15), 60)]), { from: 6, to: 21 }, 'wider when an interview needs it');
  const lanes = Cal.layoutDay([event('a', at(2026, 11, 20, 10), 120), event('b', at(2026, 11, 20, 10, 30), 30), event('c', at(2026, 11, 20, 11), 30), event('d', at(2026, 11, 20, 14), 30)]);
  const byId = Object.fromEntries(lanes.map(item => [item.event.id, item]));
  assert.equal(byId.a.lanes, 2); assert.equal(byId.b.lanes, 2);
  assert.notEqual(byId.a.lane, byId.b.lane, 'two interviews at the same time sit side by side');
  assert.equal(byId.c.lane, byId.b.lane, 'c starts when b ends: it takes the lane b freed, while a still runs');
  assert.equal(byId.c.lanes, 2);
  assert.equal(byId.d.lanes, 1, 'an interview alone takes the whole width');
  assert.equal(byId.a.group, byId.c.group, 'the overlapping ones form one group');
  assert.notEqual(byId.a.group, byId.d.group, 'and the lone one another');
  assert.equal(Cal.span(event('x', at(2026, 11, 20, 9, 0), 5)).to - Cal.span(event('x', at(2026, 11, 20, 9, 0), 5)).from, 25, 'a very short interview is still drawn tall enough to read');
});

test('index.html loads the calendar before the page that uses it', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.indexOf('interviews-calendar.js') > -1 && html.indexOf('interviews-calendar.js') < html.indexOf('builder.js'));
});

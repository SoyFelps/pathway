/* Date arithmetic of the Interviews calendar (day, week and month views). Pure functions: no screen, no network, so they can be tested.
   Everything works in the time zone of the person looking (their own clock), weeks start on MONDAY, and Saturday and Sunday are only shown when
   an interview falls on them (owner decision, 2026-11-21). An event is { id, start: Date, end: Date, ... }. */
(function (root) {
  const MINUTE = 60000;
  const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const addDays = (date, count) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
  const pad = number => String(number).padStart(2, '0');
  const dayKey = date => date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  const sameDay = (a, b) => dayKey(a) === dayKey(b);
  /** 0 = Monday ... 6 = Sunday. */
  const weekdayIndex = date => (date.getDay() + 6) % 7;
  const weekStart = date => addDays(startOfDay(date), -weekdayIndex(date));

  /** The events of each day (key yyyy-mm-dd of the START), earliest first. */
  function eventsByDay(events) {
    const map = new Map();
    for (const event of events) {
      const key = dayKey(event.start);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(event);
    }
    for (const list of map.values()) list.sort((a, b) => a.start - b.start || a.end - b.end);
    return map;
  }

  /** Which of the seven weekday columns (0 = Monday ... 6 = Sunday) are shown for these days: Monday to Friday always; Saturday and Sunday only with an event. */
  function visibleColumns(days, events) {
    const byDay = eventsByDay(events);
    const columns = [0, 1, 2, 3, 4];
    for (const index of [5, 6]) if (days.some(day => weekdayIndex(day) === index && byDay.has(dayKey(day)))) columns.push(index);
    return columns;
  }

  /** The days of the week of `anchor`, Monday first; Saturday and Sunday only when they have an interview. */
  function weekDays(anchor, events) {
    const start = weekStart(anchor);
    const all = [0, 1, 2, 3, 4, 5, 6].map(index => addDays(start, index));
    const columns = visibleColumns(all, events);
    return all.filter(day => columns.includes(weekdayIndex(day)));
  }

  /** The month of `anchor` as weeks (Monday first): { weeks: [[Date x shown columns]], columns, month }. Days of the neighbour months fill the rows. */
  function monthGrid(anchor, events) {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    const start = weekStart(first);
    const all = [];
    for (let day = start; day <= last || weekdayIndex(day) !== 0; day = addDays(day, 1)) all.push(day);
    const columns = visibleColumns(all.filter(day => day.getMonth() === anchor.getMonth()), events);
    const weeks = [];
    for (let index = 0; index < all.length; index += 7) weeks.push(all.slice(index, index + 7).filter(day => columns.includes(weekdayIndex(day))));
    return { weeks, columns, month: anchor.getMonth() };
  }

  /** Next or previous day (step +1 / -1), skipping a Saturday or Sunday that has no interview (it would not be shown). */
  function stepDay(date, step, events) {
    const byDay = eventsByDay(events);
    let next = addDays(date, step);
    for (let guard = 0; guard < 3 && weekdayIndex(next) >= 5 && !byDay.has(dayKey(next)); guard++) next = addDays(next, step);
    return next;
  }

  const minutesOfDay = date => date.getHours() * 60 + date.getMinutes();
  /** Minutes from midnight at which an event is drawn: the start, and the end (at least `minimum` minutes later, never past the end of its day). */
  function span(event, minimum = 25) {
    const from = minutesOfDay(event.start);
    const sameDayEnd = sameDay(event.start, event.end) ? minutesOfDay(event.end) : 24 * 60;
    return { from, to: Math.min(24 * 60, Math.max(sameDayEnd, from + minimum)) };
  }

  /** The hours the day / week grid covers: `from`..`to` (whole hours), at least `defaults`, wider if an event needs it. */
  function hourRange(events, defaults = { from: 8, to: 18 }) {
    let from = defaults.from, to = defaults.to;
    for (const event of events) {
      const s = span(event);
      from = Math.min(from, Math.floor(s.from / 60));
      to = Math.max(to, Math.ceil(s.to / 60));
    }
    return { from: Math.max(0, from), to: Math.min(24, to) };
  }

  /** Side-by-side lanes for the events of ONE day: [{ event, from, to, lane, lanes, group }]. Events that overlap share the width of their group (all of them carry the same group number). */
  function layoutDay(events) {
    const items = events.map(event => ({ event, ...span(event) })).sort((a, b) => a.from - b.from || b.to - a.to);
    const out = [];
    let group = [];
    let groupEnd = -1;
    let groupNumber = 0;
    const closeGroup = () => {
      const lanes = group.reduce((most, item) => Math.max(most, item.lane + 1), 1);
      for (const item of group) out.push({ event: item.event, from: item.from, to: item.to, lane: item.lane, lanes, group: groupNumber });
      groupNumber++;
      group = []; groupEnd = -1;
    };
    for (const item of items) {
      if (group.length && item.from >= groupEnd) closeGroup();
      const taken = new Set(group.filter(other => other.to > item.from).map(other => other.lane));
      let lane = 0;
      while (taken.has(lane)) lane++;
      item.lane = lane;
      group.push(item);
      groupEnd = Math.max(groupEnd, item.to);
    }
    if (group.length) closeGroup();
    return out;
  }

  const api = { startOfDay, addDays, dayKey, sameDay, weekdayIndex, weekStart, eventsByDay, visibleColumns, weekDays, monthGrid, stepDay, span, hourRange, layoutDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PathwayInterviewsCalendar = api;
})(typeof window !== 'undefined' ? window : globalThis);

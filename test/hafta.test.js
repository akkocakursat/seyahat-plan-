import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoWeekOf, isoWeekStart, weeksInYear, yearRange, weekDays, parseWeeks } from '../public/js/hafta.js';

test('ISO hafta hesapları', () => {
  assert.equal(weeksInYear(2026), 53);
  assert.equal(weeksInYear(2027), 52);
  assert.equal(weeksInYear(2020), 53);
  assert.deepEqual(yearRange(2026), { bas: '2025-12-29', bit: '2027-01-03' });
  assert.deepEqual(isoWeekOf('2026-01-01'), { year: 2026, week: 1 });
  assert.deepEqual(isoWeekOf('2025-12-29'), { year: 2026, week: 1 });
  assert.deepEqual(isoWeekOf('2025-12-28'), { year: 2025, week: 52 });
  assert.deepEqual(isoWeekOf('2026-10-22'), { year: 2026, week: 43 });
  assert.deepEqual(isoWeekOf('2027-01-03'), { year: 2026, week: 53 });
  assert.deepEqual(isoWeekOf('2027-01-04'), { year: 2027, week: 1 });
  assert.equal(isoWeekStart(2026, 35).toISOString().slice(0, 10), '2026-08-24');
  assert.deepEqual(weekDays(2026, 35), ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30']);
  for (let w = 1; w <= 53; w += 1) {
    for (const d of weekDays(2026, w)) assert.deepEqual(isoWeekOf(d), { year: 2026, week: w }, d);
  }
});

test('hafta listesi ayrıştırma', () => {
  const list = (t) => [...parseWeeks(t, 52).weeks].sort((a, b) => a - b);
  assert.deepEqual(list('1-2-3-4-5-35-37'), [1, 2, 3, 4, 5, 35, 37]);
  assert.deepEqual(list('1-5, 35, 37'), [1, 2, 3, 4, 5, 35, 37]);
  assert.deepEqual(list('35-37'), [35, 36, 37]);
  assert.deepEqual(list(' 7 9;11 '), [7, 9, 11]);
  assert.deepEqual(list(''), []);
  assert.ok(parseWeeks('0', 52).error);
  assert.ok(parseWeeks('53', 52).error);
  assert.ok(parseWeeks('10-5', 52).error);
  assert.ok(parseWeeks('a-b', 52).error);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoWeekOf, isoWeekStart, weeksInYear, yearRange, weekDays, parseWeeks, tripWeeks } from '../public/js/hafta.js';
import { daysWithin, summarize } from '../public/js/ozet.js';
import { tripDays } from '../public/js/ortak.js';

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

test('çok günlük seyahat: gün sayısı ve kapsadığı haftalar', () => {
  assert.equal(tripDays({ date: '2026-10-21' }), 1);
  assert.equal(tripDays({ date: '2026-10-21', endDate: '2026-10-23' }), 3);
  assert.equal(tripDays({ date: '2026-02-27', endDate: '2026-03-02' }), 4);
  assert.deepEqual(tripWeeks({ date: '2026-10-23', endDate: '2026-10-27' }), [{ year: 2026, week: 43 }, { year: 2026, week: 44 }]);
  assert.deepEqual(tripWeeks({ date: '2026-12-31', endDate: '2027-01-05' }).map((w) => `${w.year}-${w.week}`), ['2026-53', '2027-1']);
});

test('özet: döneme düşen günler, planlanan / gerçekleşen ve toplam', () => {
  assert.equal(daysWithin({ date: '2026-10-30', endDate: '2026-11-02' }, '2026-10-01', '2026-10-31'), 2);
  assert.equal(daysWithin({ date: '2026-10-30', endDate: '2026-11-02' }, '2026-11-01', '2026-11-30'), 2);
  assert.equal(daysWithin({ date: '2026-12-30', endDate: '2027-01-02' }, '2026-01-01', '2026-12-31'), 2);
  assert.equal(daysWithin({ date: '2026-09-01' }, '2026-10-01', '2026-10-31'), 0);
  const people = [{ id: 1 }, { id: 2 }];
  const trips = [
    { personId: 1, date: '2026-03-02', endDate: '2026-03-04', status: 'done' },
    { personId: 1, date: '2026-11-10', endDate: '2026-11-14', status: 'planned' },
    { personId: 2, date: '2026-12-30', endDate: '2027-01-03', status: 'planned' },
    { personId: 2, date: '2025-06-01', endDate: '2025-06-02', status: 'done' },
  ];
  const { rows, total } = summarize(trips, people, '2026-01-01', '2026-12-31');
  const { overdue, ...r1 } = rows.get(1); // "tarihi geçti" bugüne bağlı olduğundan karşılaştırılmaz
  assert.equal(typeof overdue, 'number');
  assert.deepEqual(r1, { trips: 2, days: 8, doneTrips: 1, doneDays: 3, planTrips: 1, planDays: 5 });
  assert.equal(rows.get(2).days, 2);
  assert.equal(rows.get(2).trips, 1);
  assert.equal(total.days, 10);
  assert.equal(total.doneDays, 3);
});

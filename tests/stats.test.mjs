// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeProgress, goalPeriod } from '../js/stats.js';
import { plural, fmtHM, fmtShort } from '../js/util.js';
import { serviceYearOf, toKey } from '../js/dates.js';

const S = (o) => ({ goalType: 'month', goals: { month: 50, year: 600, custom: 100 }, ...o });
const e = (date, minutes) => ({ id: date + minutes, date, minutes, createdAt: 0 });

test('month goal: remaining and weekly pace', () => {
  const today = new Date(2026, 10, 22); // 22 Nov 2026, Sunday
  const p = computeProgress([e('2026-11-01', 600), e('2026-11-20', 450), e('2026-10-31', 999)], S(), today);
  assert.equal(p.done, 1050);                 // October entry ignored
  assert.equal(p.remaining, 3000 - 1050);
  assert.equal(p.totalDays, 30);
  assert.equal(p.elapsed, 21);
  assert.equal(p.daysLeft, 9);                // 22..30 inclusive
  assert.ok(Math.abs(p.perWeek - 1950 / (9 / 7)) < 1e-9);
  assert.ok(Math.abs(p.perDay - 1950 / 9) < 1e-9);
  assert.ok(p.pace < 0);                      // behind: expected 2100
});

test('service year runs Sep → Aug', () => {
  assert.equal(serviceYearOf(new Date(2026, 8, 1)), 2026);
  assert.equal(serviceYearOf(new Date(2026, 7, 31)), 2025);
  const per = goalPeriod(S({ goalType: 'year' }), new Date(2027, 0, 10));
  assert.equal(toKey(per.start), '2026-09-01');
  assert.equal(toKey(per.end), '2027-08-31');
});

test('last days: per-week equals remaining', () => {
  const p = computeProgress([], S(), new Date(2026, 10, 28));
  assert.equal(p.daysLeft, 3);
  assert.equal(p.perWeek, 3000);
});

test('goal reached', () => {
  const p = computeProgress([e('2026-11-02', 3100)], S(), new Date(2026, 10, 10));
  assert.equal(p.reached, true);
  assert.equal(p.remaining, 0);
});

test('custom period before it starts', () => {
  const p = computeProgress([], S({ goalType: 'custom', customStart: '2026-12-01', customEnd: '2026-12-31' }), new Date(2026, 10, 22));
  assert.equal(p.started, false);
  assert.equal(p.elapsed, 0);
  assert.equal(p.daysLeft, 31);
});

test('ukrainian plurals and formatting', () => {
  assert.equal(plural(1, ['день', 'дні', 'днів']), 'день');
  assert.equal(plural(3, ['день', 'дні', 'днів']), 'дні');
  assert.equal(plural(11, ['день', 'дні', 'днів']), 'днів');
  assert.equal(plural(22, ['день', 'дні', 'днів']), 'дні');
  assert.equal(fmtHM(90), '1 год 30 хв');
  assert.equal(fmtHM(45), '45 хв');
  assert.equal(fmtShort(105), '1:45');
  assert.equal(fmtShort(120), '2');
});

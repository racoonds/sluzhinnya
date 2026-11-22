// Goal maths: period, remaining hours, required pace.
import {
  toKey, fromKey, addDays, diffDays, startOfMonth, endOfMonth, startOfWeek,
  serviceYearOf, MONTHS, fmtDateShort, isKey,
} from './dates.js';

export function goalPeriod(settings, today = new Date()) {
  const type = settings.goalType;
  if (type === 'year') {
    const y = serviceYearOf(today);
    return { type, start: new Date(y, 8, 1), end: new Date(y + 1, 7, 31), label: `Службовий рік ${y}/${String(y + 1).slice(2)}` };
  }
  if (type === 'custom' && isKey(settings.customStart) && isKey(settings.customEnd) && settings.customEnd >= settings.customStart) {
    const start = fromKey(settings.customStart), end = fromKey(settings.customEnd);
    return { type, start, end, label: `${fmtDateShort(start)} – ${fmtDateShort(end)}` };
  }
  const start = startOfMonth(today);
  return { type: 'month', start, end: endOfMonth(today), label: `${MONTHS[today.getMonth()]} ${today.getFullYear()}` };
}

export function goalMinutes(settings) {
  const t = settings.goalType === 'custom' && !(isKey(settings.customStart) && isKey(settings.customEnd)) ? 'month' : settings.goalType;
  return Math.max(0, Math.round((Number(settings.goals?.[t]) || 0) * 60));
}

export function sumRange(entries, startKey, endKey) {
  let s = 0;
  for (const e of entries) if (e.date >= startKey && e.date <= endKey) s += e.minutes;
  return s;
}

/**
 * Everything the home screen needs.
 * "elapsed" = full days of the period before today; today counts as a day still left.
 */
export function computeProgress(entries, settings, today = new Date()) {
  const p = goalPeriod(settings, today);
  const sk = toKey(p.start), ek = toKey(p.end);
  const goal = goalMinutes(settings);
  const done = sumRange(entries, sk, ek);
  const remaining = Math.max(0, goal - done);
  const totalDays = diffDays(p.start, p.end) + 1;
  const elapsed = Math.min(totalDays, Math.max(0, diffDays(p.start, today)));
  const daysLeft = totalDays - elapsed;
  const started = diffDays(p.start, today) >= 0;
  const finished = daysLeft <= 0;

  const expected = goal * (elapsed / totalDays);           // where you "should" be by this morning
  const pace = done - expected;                            // + ahead / − behind
  const perDay = daysLeft > 0 ? remaining / daysLeft : remaining;
  const perWeek = daysLeft >= 7 ? remaining / (daysLeft / 7) : remaining;
  const plannedPerWeek = goal / (totalDays / 7);           // even pace from the beginning

  // This calendar week
  const ws = startOfWeek(today);
  const weekDone = sumRange(entries, toKey(ws), toKey(addDays(ws, 6)));
  // Days of this week still inside the period (including today)
  const weekEnd = addDays(ws, 6) < p.end ? addDays(ws, 6) : p.end;
  const weekDaysLeft = Math.max(0, diffDays(today, weekEnd) + 1);
  const weekTarget = Math.min(remaining + weekDone, weekDone + perDay * weekDaysLeft);

  return {
    period: p, goal, done, remaining, pct: goal ? Math.min(1, done / goal) : 0,
    totalDays, elapsed, daysLeft, started, finished,
    expected, pace, perDay, perWeek, plannedPerWeek,
    weekDone, weekTarget, weekDaysLeft,
    reached: goal > 0 && done >= goal,
  };
}

export function weekDays(byDay, weekStart) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekStart, i);
    const key = toKey(d);
    return { d, key, min: byDay.get(key) || 0 };
  });
}

/** Totals per month for a service year (Sep → Aug). */
export function serviceYearMonths(entries, syStart) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const m = new Date(syStart, 8 + i, 1);
    out.push({ m, min: sumRange(entries, toKey(m), toKey(endOfMonth(m))) });
  }
  return out;
}

export function streak(byDay, today = new Date()) {
  let n = 0;
  let d = byDay.get(toKey(today)) ? today : addDays(today, -1);
  while (byDay.get(toKey(d))) { n++; d = addDays(d, -1); }
  return n;
}

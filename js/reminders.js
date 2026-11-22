// Reminders without any server:
//  1) a recurring event with an alarm for the phone's own calendar (.ics) — works on iPhone and Android;
//  2) system notifications from the installed app (periodic background sync, Android/Chrome);
//  3) an in-app banner on the home screen.
import { db } from './db.js';
import { state } from './store.js';
import { computeProgress } from './stats.js';
import { toKey, todayKey, addDays, weekday, WD_ICS } from './dates.js';
import { fmtDec, pad } from './util.js';

/* ---------- .ics ---------- */

function fold(line) {
  // RFC 5545: lines longer than 75 octets are folded (CRLF + space).
  const enc = new TextEncoder();
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ch; } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const escText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

function stamp(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
const local = (d, hhmm) => `${toKey(d).replace(/-/g, '')}T${hhmm.replace(':', '')}00`;

export function buildICS(settings, appUrl) {
  const r = settings.reminder;
  const days = (r.days?.length ? r.days : [0, 1, 2, 3, 4, 5, 6]).slice().sort();
  const now = new Date();
  // first occurrence: today or the next selected weekday
  let first = now;
  for (let i = 0; i < 7; i++) { const d = addDays(now, i); if (days.includes(weekday(d))) { first = d; break; } }
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sluzhinnya//Reminder//UK', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Служіння — нагадування',
    'BEGIN:VEVENT',
    `UID:daily-${Date.now()}@sluzhinnya.local`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${local(first, r.time)}`,
    'DURATION:PT10M',
    `RRULE:FREQ=WEEKLY;BYDAY=${days.map((d) => WD_ICS[d]).join(',')}`,
    `SUMMARY:${escText('Служіння: внеси години')}`,
    `DESCRIPTION:${escText(`Запиши, скільки годин послужив сьогодні, і перевір, скільки лишилось до цілі.\n${appUrl}`)}`,
    `URL:${appUrl}`,
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escText('Внеси години служіння')}`, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT',
  ];
  if (r.weekly) {
    const sat = addDays(now, (5 - weekday(now) + 7) % 7);
    lines.push(
      'BEGIN:VEVENT',
      `UID:weekly-${Date.now()}@sluzhinnya.local`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${local(sat, '10:00')}`,
      'DURATION:PT10M',
      'RRULE:FREQ=WEEKLY;BYDAY=SA',
      `SUMMARY:${escText('Служіння: план на вихідні')}`,
      `DESCRIPTION:${escText(`Перевір у застосунку, скільки годин треба цього тижня, щоб встигнути до цілі.\n${appUrl}`)}`,
      `URL:${appUrl}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escText('Перевір тижневу ціль служіння')}`, 'TRIGGER:PT0M', 'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Share (mobile) or download a generated file. */
export async function deliverFile(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'aborted'; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}

export function downloadICS() {
  const url = new URL('./', location.href).href;
  const blob = new Blob([buildICS(state.settings, url)], { type: 'text/calendar;charset=utf-8' });
  return deliverFile(blob, 'sluzhinnya-nagaduvannya.ics', 'Нагадування');
}

/* ---------- notifications ---------- */

export const notifSupported = () => 'Notification' in window && 'serviceWorker' in navigator;
export const notifPermission = () => (notifSupported() ? Notification.permission : 'unsupported');

export async function enableNotifications() {
  if (!notifSupported()) return { ok: false, reason: 'unsupported' };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: perm };
  const periodic = await registerPeriodic();
  return { ok: true, periodic };
}

export async function registerPeriodic() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!('periodicSync' in reg)) return false;
    const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (st.state !== 'granted') return false;
    await reg.periodicSync.register('sluzhinnya-reminder', { minInterval: 6 * 60 * 60 * 1000 });
    return true;
  } catch { return false; }
}

export async function unregisterPeriodic() {
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.periodicSync?.unregister('sluzhinnya-reminder');
  } catch { /* ignore */ }
}

export function reminderText() {
  const p = computeProgress(state.entries, state.settings);
  if (!p.goal) return 'Не забудьте внести години служіння.';
  if (p.reached) return 'Ціль уже виконано — так тримати! Не забудьте внести сьогоднішні години.';
  return `До цілі ${fmtDec(p.remaining)} год. Щоб встигнути: ≈ ${fmtDec(p.perWeek)} год/тиж (≈ ${fmtDec(p.perDay)} на день).`;
}

export async function showNotification(title, body) {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification(title, {
    body, tag: 'sluzhinnya', renotify: true,
    icon: new URL('icons/icon-192.png', location.href).href,
    badge: new URL('icons/badge-96.png', location.href).href,
    data: { url: new URL('./', location.href).href },
  });
}

/** While the app is open: fire today's reminder at the chosen time (if nothing logged yet). */
let inAppTimer;
export function scheduleInApp() {
  clearTimeout(inAppTimer);
  const r = state.settings.reminder;
  if (!r.enabled || notifPermission() !== 'granted') return;
  const now = new Date();
  const [h, m] = r.time.split(':').map(Number);
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  if (at <= now || !r.days.includes(weekday(now))) return;
  inAppTimer = setTimeout(async () => {
    const tk = todayKey();
    if (state.entries.some((e) => e.date === tk)) return;
    if ((await db.getKV('notified')) === tk) return;
    await db.setKV('notified', tk);
    showNotification('Служіння', `Сьогодні ще не внесено годин. ${reminderText()}`);
  }, at - now);
}

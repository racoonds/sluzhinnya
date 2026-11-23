// Home: hours left (dot ring), weekly pace, this week as a dot matrix.
import { $, html, raw, mount, fmtShort, fmtClock, fmtDec, pad, haptic } from '../util.js';
import { icon, pixelIcon } from '../icons.js';
import { state, minutesByDay, saveSettings } from '../store.js';
import { computeProgress, weekDays } from '../stats.js';
import { todayKey, addDays, startOfWeek, fmtDateShort, WD_SHORT, MONTHS_GEN, weekday } from '../dates.js';
import { openEntrySheet } from '../entry-sheet.js';
import { openGoalSheet } from '../goal-sheet.js';
import { installable, install } from '../install.js';
import { toast } from '../ui.js';
import { isSignedIn, syncStatus } from '../sync.js';
import { exportBackup } from '../backup.js';
import { syncIcon } from './settings.js';

let weekOffset = 0;
const DOTS = 60;
const DAY = 86400000;

export function render(root) {
  const now = new Date();
  const s = state.settings;
  const tk = todayKey();
  const p = computeProgress(state.entries, s, now);
  const byDay = minutesByDay();
  const ws = addDays(startOfWeek(now), weekOffset * 7);
  const days = weekDays(byDay, ws);
  const weekTotal = days.reduce((a, d) => a + d.min, 0);
  const remH = Math.floor(p.remaining / 60), remM = Math.round(p.remaining % 60);

  const firstData = Math.min(...state.entries.map((e) => e.createdAt || Date.now()), Date.now());
  const backupDue = !isSignedIn() && state.entries.length > 0 && Date.now() - firstData > 3 * DAY
    && Date.now() - (s.lastBackup || 0) > 30 * DAY && Date.now() - (s.backupSnoozedAt || 0) > 7 * DAY;
  const showInstall = installable() && !s.installDismissed;
  const pace = paceInfo(p);

  // Week matrix: one cell = 30 minutes.
  const target = weekOffset === 0 && p.goal && !p.reached ? p.perDay : 0;
  const rows = Math.min(12, Math.max(6, Math.ceil(Math.max(target, ...days.map((d) => d.min)) / 30)));
  const weekLabel = weekOffset === 0 ? 'цей тиждень' : weekOffset === -1 ? 'минулий' : weekOffset === 1 ? 'наступний'
    : `${fmtDateShort(ws)} – ${fmtDateShort(addDays(ws, 6))}`;

  mount(root, html`
    <header class="top">
      <div class="top-title">
        <span class="mono-cap">${WD_SHORT[weekday(now)]} · ${now.getDate()} ${MONTHS_GEN[now.getMonth()]}</span>
        <h1>Служіння</h1>
      </div>
      <div class="top-actions">
        ${isSignedIn() ? html`<a class="icon-btn ghost sync-ind" href="#/settings" data-sync-ind data-state="${syncStatus().state}" aria-label="Синхронізація">${icon(syncIcon(syncStatus().state))}</a>` : ''}
        <a class="icon-btn ghost" href="#/settings" aria-label="Налаштування">${icon('settings')}</a>
      </div>
    </header>

    ${backupDue || showInstall ? html`
      <div class="pills">
        ${backupDue ? html`<span class="pill-act"><button type="button" data-backup>${icon('download')}Резервна копія</button><button type="button" class="pill-x" data-snooze-backup aria-label="Пізніше">${icon('x')}</button></span>` : ''}
        ${showInstall ? html`<span class="pill-act"><button type="button" data-install>${icon('phone')}Встановити</button><button type="button" class="pill-x" data-dismiss-install aria-label="Сховати">${icon('x')}</button></span>` : ''}
      </div>` : ''}

    <section class="card hero">
      <div class="card-head">
        <span class="card-tag">${pixelIcon('goal', 'px-accent')}<span class="label">${p.period.label}</span></span>
        <span class="label">${p.goal ? `ціль ${fmtShort(p.goal)} год` : ''}</span>
      </div>
      <button type="button" class="ring-btn" data-goal aria-label="Ціль: ${fmtShort(p.goal)} год">
        ${dotRing(p)}
        <span class="ring-center">
          ${p.goal === 0 ? html`
            <span class="label">ціль</span>
            <span class="ring-cta">${icon('plus')}</span>` : p.reached ? html`
            <span class="label">виконано</span>
            <span class="big">${icon('check', 'ring-check')}</span>
            <span class="ring-sub">${fmtClock(p.done)} / ${fmtShort(p.goal)} год</span>` : html`
            <span class="label">залишилось</span>
            <span class="big">${remH}${remM ? html`<i>:${pad(remM)}</i>` : ''}</span>
            <span class="ring-sub">год</span>`}
        </span>
      </button>
      ${p.goal ? html`
      <div class="tgrid">
        <div class="tcell"><span class="label">на тиждень</span><b>${p.reached ? '0' : `≈${fmtDec(p.perWeek)}`}</b></div>
        <div class="tcell"><span class="label">графік</span><b class="${pace.cls}">${pace.text}</b></div>
        <div class="tcell"><span class="label">днів</span><b>${Math.max(0, p.daysLeft)}</b></div>
      </div>` : ''}
    </section>

    <section class="card week" aria-label="Тиждень">
      <div class="card-head">
        <button type="button" class="card-tag week-title" data-week="0">${pixelIcon('week', 'px-accent')}<span class="label">${weekLabel}</span></button>
        <span class="card-nav">
          <b class="num">${fmtClock(weekTotal)}</b>
          <button type="button" class="nav-btn" data-week="-1" aria-label="Попередній тиждень">${icon('left')}</button>
          <button type="button" class="nav-btn" data-week="1" aria-label="Наступний тиждень">${icon('right')}</button>
        </span>
      </div>
      <div class="matrix" data-vars="--rows:${rows}">
        ${days.map((d, i) => {
          const filled = Math.round(d.min / 30);
          const goalCells = d.key >= tk ? Math.round(target / 30) : 0;
          const cells = [];
          for (let c = 0; c < rows; c++) {
            const cls = c < filled ? (c === rows - 1 && filled > rows ? 'on more' : 'on') : c < goalCells ? 'goal' : '';
            cells.push(`<i class="${cls}"></i>`);
          }
          const cls = [d.key === tk && 'is-today', d.key > tk && 'is-future'].filter(Boolean).join(' ');
          return html`
          <button type="button" class="mx-col ${cls}" data-day="${d.key}" aria-label="${WD_SHORT[i]} ${d.d.getDate()}: ${fmtClock(d.min)}">
            <span class="mx-val">${d.min ? fmtClock(d.min) : ''}</span>
            <span class="mx-cells">${raw(cells.join(''))}</span>
            <span class="mx-day">${WD_SHORT[i]}</span>
            <span class="mx-date">${d.d.getDate()}</span>
          </button>`;
        })}
      </div>
    </section>

  `);

  root.onclick = async (e) => {
    const t = e.target;
    const w = t.closest('[data-week]');
    if (w) { weekOffset = w.dataset.week === '0' ? 0 : weekOffset + Number(w.dataset.week); haptic(); render(root); return; }
    const d = t.closest('[data-day]');
    if (d) {
      if (d.dataset.day > tk) { toast('Цей день ще не настав'); return; }
      haptic();
      openEntrySheet({ date: d.dataset.day });
      return;
    }
    if (t.closest('[data-goal]')) { openGoalSheet(); return; }
    if (t.closest('[data-install]')) { install(); return; }
    if (t.closest('[data-dismiss-install]')) { saveSettings({ installDismissed: true }); return; }
    if (t.closest('[data-snooze-backup]')) { saveSettings({ backupSnoozedAt: Date.now() }); return; }
    if (t.closest('[data-backup]')) {
      try { const r = await exportBackup(); if (r !== 'aborted') toast('Копію збережено'); } catch (err) { toast(`Помилка: ${err.message}`, { kind: 'warn' }); }
      return;
    }
  };

  const onSync = (ev) => {
    const el = $('[data-sync-ind]', root);
    if (!el) return;
    el.dataset.state = ev.detail.state;
    mount(el, icon(syncIcon(ev.detail.state)));
  };
  window.addEventListener('sync-status', onSync);
  return () => { root.onclick = null; window.removeEventListener('sync-status', onSync); };
}

/* Progress as a ring of 60 dots; the outlined dot marks where an even pace would be today. */
function dotRing(p) {
  const on = p.goal ? Math.round(Math.min(1, p.done / p.goal) * DOTS) : 0;
  const mark = p.goal && p.started && !p.finished && !p.reached ? Math.min(DOTS - 1, Math.round((p.expected / p.goal) * DOTS)) : -1;
  let out = '<svg class="ring" viewBox="0 0 240 240" aria-hidden="true"><circle class="ring-line" cx="120" cy="120" r="90"/><circle class="ring-line dash" cx="120" cy="120" r="80"/>';
  for (let i = 0; i < DOTS; i++) {
    const a = (i / DOTS) * 2 * Math.PI - Math.PI / 2;
    const x = (120 + 106 * Math.cos(a)).toFixed(2), y = (120 + 106 * Math.sin(a)).toFixed(2);
    const cls = i < on ? `d on${p.reached ? ' done' : ''}` : 'd';
    const sz = i === mark ? 8.4 : 6.4;
    out += `<rect class="${cls}${i === mark ? ' mark' : ''}" x="${(x - sz / 2).toFixed(2)}" y="${(y - sz / 2).toFixed(2)}" width="${sz}" height="${sz}" rx="1.6" data-vars="--i:${i}"/>`;
  }
  return raw(`${out}</svg>`);
}

function paceInfo(p) {
  if (!p.goal || !p.started) return { cls: '', text: '—' };
  if (p.reached) return { cls: 'good', text: p.done > p.goal ? `+${fmtDec(p.done - p.goal)}` : '✓' };
  if (Math.abs(p.pace) < 30) return { cls: 'good', text: '✓' };
  return p.pace > 0 ? { cls: 'good', text: `+${fmtDec(p.pace)}` } : { cls: 'warn', text: `−${fmtDec(-p.pace)}` };
}

export const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

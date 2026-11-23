// Calendar: month heat-map, the selected day's entries, service-year overview.
import { $, html, mount, fmtShort, fmtClock, haptic } from '../util.js';
import { icon, pixelIcon } from '../icons.js';
import { state, minutesByDay, entriesOn } from '../store.js';
import { serviceYearMonths, sumRange } from '../stats.js';
import {
  toKey, todayKey, fromKey, isKey, startOfMonth, endOfMonth, weekday,
  WD_SHORT, MONTHS, MONTHS_SHORT, serviceYearOf,
} from '../dates.js';
import { openEntrySheet, dayTitle } from '../entry-sheet.js';

let month = startOfMonth(new Date());
let selected = todayKey();

export function render(root, params = []) {
  if (params[0] && isKey(params[0])) {
    selected = params[0];
    month = startOfMonth(fromKey(selected));
  }
  const byDay = minutesByDay();
  const tk = todayKey();
  const first = startOfMonth(month), last = endOfMonth(month);
  const offset = weekday(first);
  const n = last.getDate();
  const monthMin = sumRange(state.entries, toKey(first), toKey(last));
  let activeDays = 0;
  for (let d = 1; d <= n; d++) if (byDay.get(toKey(new Date(month.getFullYear(), month.getMonth(), d)))) activeDays++;
  const s = state.settings;
  const isCurMonth = toKey(first) === toKey(startOfMonth(new Date()));
  const monthGoal = s.goalType === 'month' ? (s.goals.month || 0) * 60 : s.goalType === 'year' ? (s.goals.year || 0) * 60 / 12 : 0;

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(html`<span class="cal-cell is-blank" aria-hidden="true"></span>`);
  for (let d = 1; d <= n; d++) {
    const k = toKey(new Date(month.getFullYear(), month.getMonth(), d));
    const m = byDay.get(k) || 0;
    const lvl = m === 0 ? 0 : m < 60 ? 1 : m < 120 ? 2 : m < 180 ? 3 : 4;
    const cls = [k === tk && 'is-today', k === selected && 'is-sel', k > tk && 'is-future'].filter(Boolean).join(' ');
    cells.push(html`
      <button type="button" class="cal-cell ${cls}" data-k="${k}" data-level="${lvl}" aria-label="${d}: ${fmtClock(m)}">
        <span class="cal-d">${d}</span>
        <span class="cal-h">${m ? fmtClock(m) : ''}</span>
      </button>`);
  }

  const dayEntries = entriesOn(selected);
  const dayTotal = dayEntries.reduce((a, e) => a + e.minutes, 0);
  const sy = serviceYearOf(fromKey(selected));
  const months = serviceYearMonths(state.entries, sy);
  const syTotal = months.reduce((a, m) => a + m.min, 0);
  const maxM = Math.max(60, ...months.map((m) => m.min), s.goalType === 'year' ? (s.goals.year || 0) * 5 : 0);

    mount(root, html`
    <header class="top">
      <div class="top-title"><span class="mono-cap">${fmtClock(monthMin)} год</span><h1>Календар</h1></div>
      ${!isCurMonth || selected !== tk ? html`<button type="button" class="pill-btn" data-today>Сьогодні</button>` : ''}
    </header>

    <section class="card cal">
      <div class="card-head">
        <span class="card-tag">${pixelIcon('day', 'px-accent')}<span class="cal-title">${MONTHS[month.getMonth()]}${month.getFullYear() !== new Date().getFullYear() ? html` <span>${month.getFullYear()}</span>` : ''}</span></span>
        <span class="card-nav">
          <button type="button" class="nav-btn" data-m="-1" aria-label="Попередній місяць">${icon('left')}</button>
          <button type="button" class="nav-btn" data-m="1" aria-label="Наступний місяць">${icon('right')}</button>
        </span>
      </div>
      <div class="tgrid tgrid-flat">
        <div class="tcell"><span class="label">години</span><b>${fmtClock(monthMin)}</b></div>
        ${monthGoal ? html`<div class="tcell"><span class="label">ціль</span><b>${fmtShort(monthGoal)}</b></div>` : ''}
        <div class="tcell"><span class="label">днів</span><b>${activeDays}</b></div>
      </div>
      ${monthGoal ? html`<div class="meter"><span class="meter-fill" data-vars="--p:${Math.min(100, (monthMin / monthGoal) * 100).toFixed(1)}%"></span></div>` : ''}
      <div class="cal-grid" data-swipe>
        ${WD_SHORT.map((w) => html`<span class="cal-wd">${w}</span>`)}
        ${cells}
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <span class="label">${dayTitle(selected)}</span>
        <span class="num">${dayTotal ? fmtClock(dayTotal) : ''}</span>
      </div>
      ${dayEntries.length ? html`
        <div class="day-list">${dayEntries.map((e) => html`
          <button type="button" class="day-item" data-edit="${e.id}">
            <span class="num">${fmtClock(e.minutes)}</span>
            <span class="day-note">${e.note}</span>
            ${icon('edit', 'day-edit')}
          </button>`)}
        </div>` : ''}
      ${selected <= tk ? html`<button type="button" class="btn btn-block btn-soft" data-add>${icon('plus')}Додати</button>` : ''}
    </section>

    <section class="section">
      <div class="section-head">
        <span class="label">службовий рік ${sy}/${String(sy + 1).slice(2)}</span>
        <span class="num">${fmtClock(syTotal)}${s.goalType === 'year' && s.goals.year ? html`<em> / ${s.goals.year}</em>` : ''}</span>
      </div>
      <div class="card year">
        ${months.map((m) => {
          const k = toKey(m.m);
          const cur = k === toKey(startOfMonth(new Date()));
          return html`
          <button type="button" class="year-row ${cur ? 'is-cur' : ''}" data-month="${k}">
            <span class="year-m">${MONTHS_SHORT[m.m.getMonth()]}</span>
            <span class="year-bar"><span class="year-fill" data-vars="--w:${m.min ? Math.max(2, (m.min / maxM) * 100).toFixed(1) : 0}%"></span></span>
            <span class="year-v">${m.min ? fmtClock(m.min) : '·'}</span>
          </button>`;
        })}
      </div>
    </section>
  `);

  root.onclick = (e) => {
    const t = e.target;
    const m = t.closest('[data-m]');
    if (m) { shift(Number(m.dataset.m)); render(root); return; }
    const c = t.closest('[data-k]');
    if (c) { selected = c.dataset.k; haptic(); render(root); history.replaceState(null, '', `#/calendar/${selected}`); return; }
    if (t.closest('[data-today]')) { month = startOfMonth(new Date()); selected = todayKey(); render(root); history.replaceState(null, '', '#/calendar'); return; }
    if (t.closest('[data-add]')) { openEntrySheet({ date: selected }); return; }
    const ed = t.closest('[data-edit]');
    if (ed) { const en = state.entries.find((x) => x.id === ed.dataset.edit); if (en) openEntrySheet({ entry: en }); return; }
    const ym = t.closest('[data-month]');
    if (ym) { month = fromKey(ym.dataset.month); selected = toKey(month) > todayKey() ? selected : toKey(month); render(root); root.scrollIntoView?.({ behavior: 'smooth' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  };

  // Swipe left/right to change month.
  const grid = $('[data-swipe]', root);
  let sx = 0, sy0 = 0;
  grid.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy0 = e.touches[0].clientY; }, { passive: true });
  grid.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy0;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) { shift(dx < 0 ? 1 : -1); haptic(); render(root); }
  }, { passive: true });

  return () => { root.onclick = null; };
}

function shift(n) {
  month = new Date(month.getFullYear(), month.getMonth() + n, 1);
}

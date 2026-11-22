// Home: this week, hours left (ring), weekly pace, timer, recent entries.
import { $, html, raw, mount, fmtHM, fmtShort, fmtDec, pad, haptic, plural } from '../util.js';
import { icon } from '../icons.js';
import { state, minutesByDay, setTimer, timerMs, saveSettings } from '../store.js';
import { computeProgress, weekDays, sumRange } from '../stats.js';
import { toKey, todayKey, addDays, startOfWeek, fmtDate, fmtDateShort, WD_SHORT, startOfMonth, endOfMonth, weekday } from '../dates.js';
import { openEntrySheet } from '../entry-sheet.js';
import { openGoalSheet } from '../goal-sheet.js';
import { installable, install } from '../install.js';
import { toast } from '../ui.js';
import { isSignedIn, syncStatus } from '../sync.js';
import { syncIcon } from './settings.js';

let weekOffset = 0;
let lastPct = 0;
const R = 100, C = 2 * Math.PI * R;

export function render(root) {
  const now = new Date();
  const s = state.settings;
  const p = computeProgress(state.entries, s, now);
  const byDay = minutesByDay();
  const ws = addDays(startOfWeek(now), weekOffset * 7);
  const days = weekDays(byDay, ws);
  const weekTotal = days.reduce((a, d) => a + d.min, 0);
  const tk = todayKey();
  const scaleMax = Math.max(60, p.perDay * 1.25, ...days.map((d) => d.min));
  const targetPct = p.perDay > 0 && !p.reached && weekOffset === 0 ? Math.min(100, (p.perDay / scaleMax) * 100) : null;

  const weekLabel = weekOffset === 0 ? 'Цей тиждень' : weekOffset === -1 ? 'Минулий тиждень' : weekOffset === 1 ? 'Наступний тиждень'
    : `${fmtDateShort(ws)} – ${fmtDateShort(addDays(ws, 6))}`;

  const remH = Math.floor(p.remaining / 60), remM = Math.round(p.remaining % 60);
  const dot = p.goal ? markerPos(p.expected / p.goal) : null;

  const pace = paceInfo(p);
  const monthMin = sumRange(state.entries, toKey(startOfMonth(now)), toKey(endOfMonth(now)));
  const todayMin = byDay.get(tk) || 0; // used by the reminder banner
  const remindToday = reminderDue(now, todayMin);
  const recent = [...state.entries].sort((a, b) => (b.date === a.date ? b.createdAt - a.createdAt : b.date < a.date ? -1 : 1)).slice(0, 5);

  mount(root, html`
    <header class="top">
      <div>
        <div class="eyebrow">${capital(fmtDate(tk, { weekday: true }))}</div>
        <h1>Служіння</h1>
      </div>
      <div class="top-actions">
        ${isSignedIn() ? html`<a class="icon-btn sync-ind" href="#/settings" data-sync-ind data-state="${syncStatus().state}" aria-label="Синхронізація з Google">${icon(syncIcon(syncStatus().state))}</a>` : ''}
        <a class="icon-btn" href="#/settings" aria-label="Налаштування">${icon('settings')}</a>
      </div>
    </header>

    ${installable() && !s.installDismissed ? html`
      <div class="banner">
        ${icon('phone', 'banner-i')}
        <div class="banner-text"><b>Встановіть на телефон</b><span>Іконка на робочому столі, робота без інтернету.</span></div>
        <button type="button" class="btn btn-sm btn-primary" data-install>Як?</button>
        <button type="button" class="icon-btn icon-btn-sm" data-dismiss-install aria-label="Сховати">${icon('x')}</button>
      </div>` : ''}

    ${remindToday ? html`
      <button type="button" class="banner banner-accent" data-add-today>
        ${icon('bell', 'banner-i')}
        <div class="banner-text"><b>Сьогодні ще не внесено годин</b><span>Щоб встигнути: ≈ ${fmtDec(p.perDay)} год на день.</span></div>
        ${icon('plus', 'banner-go')}
      </button>` : ''}

    <section class="card week" aria-label="Тиждень">
      <div class="week-head">
        <button type="button" class="icon-btn icon-btn-sm" data-week="-1" aria-label="Попередній тиждень">${icon('left')}</button>
        <button type="button" class="week-title" data-week="0">
          <span>${weekLabel}</span>
          <b>${fmtHM(weekTotal)}</b>
        </button>
        <button type="button" class="icon-btn icon-btn-sm" data-week="1" aria-label="Наступний тиждень">${icon('right')}</button>
      </div>
      <div class="bars ${targetPct != null ? 'has-target' : ''}" ${targetPct != null ? html`data-vars="--t:${targetPct.toFixed(1)}%"` : ''}>
        ${days.map((d, i) => {
          const h = d.min ? Math.max(6, (d.min / scaleMax) * 100) : 0;
          const cls = [d.key === tk && 'is-today', d.key > tk && 'is-future', d.min && 'has'].filter(Boolean).join(' ');
          return html`
          <button type="button" class="bar-col ${cls}" data-day="${d.key}" aria-label="${WD_SHORT[i]} ${d.d.getDate()}: ${d.min ? fmtHM(d.min) : 'немає'}">
            <span class="bar-val">${d.min ? fmtShort(d.min) : ''}</span>
            <span class="bar"><span class="bar-fill" data-vars="--h:${h.toFixed(1)}%"></span></span>
            <span class="bar-wd">${WD_SHORT[i]}</span>
            <span class="bar-d">${d.d.getDate()}</span>
          </button>`;
        })}
      </div>
      ${weekOffset === 0 && !p.reached && p.goal ? html`
        <div class="week-foot">
          <span><i class="dash-key"></i>Норма тижня ≈ <b>${fmtDec(p.weekTarget)} год</b> · ${fmtDec(p.perDay)}/день</span>
          <span class="week-foot-r">${p.weekTarget > 0 ? Math.min(100, Math.round((p.weekDone / p.weekTarget) * 100)) : 100}%</span>
        </div>` : ''}
    </section>

    <section class="ring-wrap" aria-label="Прогрес цілі">
      <button type="button" class="ring-btn" data-goal aria-label="Змінити ціль">
        <svg class="ring" viewBox="0 0 240 240" aria-hidden="true">
          <defs>
            <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" class="rg-a"/><stop offset="1" class="rg-b"/>
            </linearGradient>
          </defs>
          <circle class="ring-track" cx="120" cy="120" r="${R}"/>
          ${ticks()}
          <circle class="ring-prog ${p.reached ? 'is-done' : ''}" cx="120" cy="120" r="${R}" transform="rotate(-90 120 120)"
            data-vars="--dash:${(lastPct * C).toFixed(1)} ${C.toFixed(1)}"/>
          ${dot && !p.reached && p.started && !p.finished ? html`<circle class="ring-marker" cx="${dot.x}" cy="${dot.y}" r="4.5"/>` : ''}
        </svg>
        <div class="ring-center">
          ${p.goal === 0 ? html`
            <div class="ring-label">Ціль не задана</div>
            <div class="ring-cta">${icon('target')} Задати ціль</div>` : p.reached ? html`
            <div class="ring-label">Ціль виконано</div>
            <div class="ring-value">${icon('check', 'ring-check')}</div>
            <div class="ring-sub">${fmtHM(p.done)} з ${fmtHM(p.goal)}</div>` : html`
            <div class="ring-label">Залишилось</div>
            <div class="ring-value">${remH}<small>год</small>${remM ? html`<span class="ring-min">${remM}<small>хв</small></span>` : ''}</div>
            <div class="ring-sub">з ${fmtHM(p.goal)} · ${Math.round(p.pct * 100)}%</div>`}
        </div>
      </button>
      <div class="ring-period">${p.period.label}${p.daysLeft > 0 ? html` · ще ${p.daysLeft} ${plural(p.daysLeft, ['день', 'дні', 'днів'])}` : ''}</div>
      ${pace ? html`<div class="pace pace-${pace.kind}">${icon(pace.icon)}<span>${pace.text}</span></div>` : ''}
    </section>

    ${p.goal ? html`
    <section class="stats">
      <div class="stat stat-main">
        <span class="stat-label">${p.daysLeft >= 7 ? 'Треба в середньому на тиждень' : 'Треба до кінця періоду'}</span>
        <span class="stat-value">≈ ${fmtDec(p.reached ? 0 : p.perWeek)}<small>год</small></span>
        <span class="stat-note">Рівномірний план — ${fmtDec(p.plannedPerWeek)} год/тиж</span>
      </div>
      <div class="stat">
        <span class="stat-label">На день</span>
        <span class="stat-value">≈ ${fmtDec(p.reached ? 0 : p.perDay)}<small>год</small></span>
      </div>
      <div class="stat">
        <span class="stat-label">Виконано</span>
        <span class="stat-value">${fmtShort(p.done)}<small>год</small></span>
      </div>
      ${s.goalType !== 'month' ? html`
      <div class="stat">
        <span class="stat-label">Цей місяць</span>
        <span class="stat-value">${fmtShort(monthMin)}<small>год</small></span>
      </div>` : html`
      <div class="stat">
        <span class="stat-label">Днів лишилось</span>
        <span class="stat-value">${Math.max(0, p.daysLeft)}<small>з ${p.totalDays}</small></span>
      </div>`}
    </section>` : ''}

    ${timerCard()}

    <section class="section">
      <div class="section-head">
        <h2>Останні записи</h2>
        <a href="#/calendar" class="link">Календар ${icon('right', 'link-i')}</a>
      </div>
      ${recent.length ? html`
        <div class="list">
          ${recent.map((e) => html`
            <button type="button" class="row" data-edit="${e.id}">
              <span class="row-ic">${icon('clock')}</span>
              <span class="row-main">
                <span class="row-title">${e.date === tk ? 'Сьогодні' : capital(fmtDate(e.date, { weekday: true }))}</span>
                ${e.note ? html`<span class="row-sub">${e.note}</span>` : ''}
              </span>
              <span class="row-val">${fmtHM(e.minutes)}</span>
            </button>`)}
        </div>` : html`
        <div class="empty-inline">Ще немає записів. Натисніть <b>+</b> внизу, щоб додати перші години.</div>`}
    </section>
  `);

  // Animate the ring from the previous value.
  const prog = $('.ring-prog', root);
  const target = p.pct;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    prog?.style.setProperty('--dash', `${(target * C).toFixed(1)} ${C.toFixed(1)}`);
    lastPct = target;
  }));

  root.onclick = async (e) => {
    const t = e.target;
    const w = t.closest('[data-week]');
    if (w) { weekOffset = w.dataset.week === '0' ? 0 : weekOffset + Number(w.dataset.week); haptic(); render(root); return; }
    const d = t.closest('[data-day]');
    if (d) {
      if (d.dataset.day > tk) { toast('Цей день ще не настав'); return; }
      location.hash = `#/calendar/${d.dataset.day}`;
      return;
    }
    if (t.closest('[data-goal]')) { openGoalSheet(); return; }
    if (t.closest('[data-install]')) { install(); return; }
    if (t.closest('[data-dismiss-install]')) { saveSettings({ installDismissed: true }); return; }
    if (t.closest('[data-add-today]')) { openEntrySheet(); return; }
    const ed = t.closest('[data-edit]');
    if (ed) { const en = state.entries.find((x) => x.id === ed.dataset.edit); if (en) openEntrySheet({ entry: en }); return; }
    const act = t.closest('[data-timer]');
    if (act) timerAction(act.dataset.timer);
  };

  // Live timer
  const tick = () => {
    const el = $('[data-timer-val]', root);
    if (el) el.textContent = clock(timerMs());
  };
  const iv = state.timer?.running ? setInterval(tick, 1000) : null;
  const onSync = (ev) => {
    const el = $('[data-sync-ind]', root);
    if (!el) return;
    el.dataset.state = ev.detail.state;
    mount(el, icon(syncIcon(ev.detail.state)));
  };
  window.addEventListener('sync-status', onSync);
  return () => { if (iv) clearInterval(iv); root.onclick = null; window.removeEventListener('sync-status', onSync); };
}

function timerCard() {
  const t = state.timer;
  const active = t && (t.running || t.accMs > 0);
  if (!active) {
    return html`
      <section class="card timer">
        <div class="timer-row">
          <span class="timer-ic">${icon('clock')}</span>
          <div class="timer-text"><b>Таймер служіння</b><span>Запустіть, коли виходите — потім збережіть одним дотиком.</span></div>
          <button type="button" class="round-btn round-primary" data-timer="start" aria-label="Почати">${icon('play')}</button>
        </div>
      </section>`;
  }
  return html`
    <section class="card timer is-active ${t.running ? 'is-running' : 'is-paused'}">
      <div class="timer-top">
        <span class="timer-state"><i class="pulse"></i>${t.running ? 'Іде служіння' : 'Пауза'}</span>
        <button type="button" class="link link-muted" data-timer="discard">Скинути</button>
      </div>
      <div class="timer-clock" data-timer-val>${clock(timerMs())}</div>
      <div class="btn-row">
        ${t.running
          ? html`<button type="button" class="btn" data-timer="pause">${icon('pause')}Пауза</button>`
          : html`<button type="button" class="btn" data-timer="resume">${icon('play')}Продовжити</button>`}
        <button type="button" class="btn btn-primary btn-grow" data-timer="save">${icon('check')}Зберегти</button>
      </div>
    </section>`;
}

async function timerAction(a) {
  const t = state.timer;
  haptic(12);
  if (a === 'start') return setTimer({ running: true, startedAt: Date.now(), accMs: 0, date: todayKey() });
  if (!t) return;
  if (a === 'pause') return setTimer({ ...t, running: false, accMs: timerMs(t), startedAt: null });
  if (a === 'resume') return setTimer({ ...t, running: true, startedAt: Date.now() });
  if (a === 'discard') {
    const prev = { ...t };
    await setTimer(null);
    toast('Таймер скинуто', { action: 'Повернути', onAction: () => setTimer(prev) });
    return;
  }
  if (a === 'save') {
    const mins = Math.max(5, Math.round(timerMs(t) / 60000 / 5) * 5);
    openEntrySheet({ minutes: mins, date: t.date || todayKey(), title: 'Зберегти час з таймера', onSaved: () => setTimer(null) });
  }
}

function paceInfo(p) {
  if (!p.goal) return null;
  if (!p.started) return { kind: 'neutral', icon: 'clock', text: 'Період ще не почався' };
  if (p.reached) return { kind: 'good', icon: 'sparkle', text: p.done > p.goal ? `Понад ціль на ${fmtHM(p.done - p.goal)}` : 'Чудово! Ціль досягнуто' };
  if (p.finished) return { kind: 'bad', icon: 'flag', text: `Період завершено. Не вистачило ${fmtHM(p.remaining)}` };
  if (Math.abs(p.pace) < 30) return { kind: 'good', icon: 'check', text: 'Ви точно за графіком' };
  if (p.pace > 0) return { kind: 'good', icon: 'trend', text: `Випереджаєте графік на ${fmtHM(p.pace)}` };
  return { kind: 'bad', icon: 'clock', text: `Відстаєте від графіка на ${fmtHM(-p.pace)}` };
}

function reminderDue(now, todayMin) {
  const r = state.settings.reminder;
  if (!r.enabled || todayMin > 0) return false;
  if (!r.days.includes(weekday(now))) return false;
  const [h, m] = r.time.split(':').map(Number);
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
}

function markerPos(frac) {
  const a = 2 * Math.PI * Math.min(1, Math.max(0, frac)) - Math.PI / 2;
  return { x: (120 + R * Math.cos(a)).toFixed(1), y: (120 + R * Math.sin(a)).toFixed(1) };
}

function ticks() {
  let out = '';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * 2 * Math.PI;
    const r1 = i % 5 === 0 ? 84 : 87, r2 = 90;
    out += `<line class="ring-tick${i % 5 === 0 ? ' major' : ''}" x1="${(120 + r1 * Math.sin(a)).toFixed(2)}" y1="${(120 - r1 * Math.cos(a)).toFixed(2)}" x2="${(120 + r2 * Math.sin(a)).toFixed(2)}" y2="${(120 - r2 * Math.cos(a)).toFixed(2)}"/>`;
  }
  return raw(out);
}

const clock = (ms) => {
  const t = Math.floor(ms / 1000);
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
};
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export { capital };

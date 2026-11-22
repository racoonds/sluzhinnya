// Goal setup sheet (also used as first-run onboarding).
import { $, $$, html, mount, fmtDec, haptic } from './util.js';
import { icon } from './icons.js';
import { openSheet, segmented, toast } from './ui.js';
import { state, saveSettings } from './store.js';
import { goalPeriod, computeProgress } from './stats.js';
import { todayKey, addKey, isKey, fmtDate, toKey } from './dates.js';

const PRESETS = { month: [15, 30, 50], year: [600], custom: [] };
const HINT = {
  month: 'поточний місяць',
  year: 'вересень — серпень',
  custom: 'свої дати',
};

export function openGoalSheet({ first = false } = {}) {
  const s = state.settings;
  let type = s.goalType;
  const goals = { ...s.goals };
  let cs = s.customStart || todayKey();
  let ce = s.customEnd || addKey(todayKey(), 90);

  openSheet({
    title: 'Ціль',
    body: html`
      <form class="form" novalidate>
        ${segmented('type', [['month', 'Місяць'], ['year', 'Рік'], ['custom', 'Свій період']], type)}
        <p class="label hint-c" data-hint></p>
        <div class="goal-input">
          <input name="hours" type="number" inputmode="decimal" min="1" max="5000" step="1" aria-label="Годин">
          <span>год</span>
        </div>
        <div class="chips" data-presets></div>
        <div class="grid2" data-custom>
          <label class="field"><span class="label">від</span><input type="date" name="cs" value="${cs}"></label>
          <label class="field"><span class="label">до</span><input type="date" name="ce" value="${ce}"></label>
        </div>
        <div class="kv-row preview" data-preview></div>
        <button type="submit" class="btn btn-primary btn-block">Зберегти</button>
      </form>`,
    onMount(el, close) {
      const form = $('form', el);
      const hours = form.elements.hours;
      const draw = () => {
        hours.value = goals[type] ?? '';
        $('[data-hint]', el).textContent = HINT[type];
        mount($('[data-presets]', el), html`${PRESETS[type].map((v) => html`<button type="button" class="chip ${Number(goals[type]) === v ? 'on' : ''}" data-v="${v}">${v} год</button>`)}`);
        $('[data-custom]', el).hidden = type !== 'custom';
        preview();
      };
      const preview = () => {
        const tmp = { ...state.settings, goalType: type, goals, customStart: cs, customEnd: ce };
        if (!goals[type]) { $('[data-preview]', el).textContent = ''; return; }
        const p = computeProgress(state.entries, tmp);
        const per = goalPeriod(tmp);
        mount($('[data-preview]', el), html`
          <div class="kv"><span class="label">на тиждень</span><b>≈${fmtDec(p.perWeek)}</b></div>
          <div class="kv"><span class="label">на день</span><b>≈${fmtDec(p.perDay)}</b></div>
          <div class="kv"><span class="label">днів</span><b>${p.daysLeft}</b></div>`);
      };
      draw();
      $$('input[name=type]', el).forEach((r) => r.addEventListener('change', () => { type = r.value; draw(); haptic(); }));
      hours.addEventListener('input', () => {
        goals[type] = Math.max(0, Math.min(5000, Number(String(hours.value).replace(',', '.')) || 0));
        $$('[data-presets] .chip', el).forEach((c) => c.classList.toggle('on', Number(c.dataset.v) === goals[type]));
        preview();
      });
      $('[data-presets]', el).addEventListener('click', (e) => {
        const c = e.target.closest('[data-v]');
        if (!c) return;
        goals[type] = Number(c.dataset.v);
        haptic();
        draw();
      });
      form.elements.cs.addEventListener('change', () => { cs = form.elements.cs.value; preview(); });
      form.elements.ce.addEventListener('change', () => { ce = form.elements.ce.value; preview(); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!goals[type] || goals[type] <= 0) { toast('Вкажіть кількість годин', { kind: 'warn' }); hours.focus(); return; }
        if (type === 'custom' && (!isKey(cs) || !isKey(ce) || ce < cs)) { toast('Перевірте дати періоду', { kind: 'warn' }); return; }
        await saveSettings({ goalType: type, goals, customStart: cs, customEnd: ce, onboarded: true });
        haptic(15);
        close();
        toast('Ціль збережено');
      });
    },
    onClose() {
      if (first && !state.settings.onboarded) saveSettings({ onboarded: true });
    },
  });
}

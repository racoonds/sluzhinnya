// Add / edit hours.
import { $, $$, html, fmtHM, haptic, clamp } from './util.js';
import { icon } from './icons.js';
import { openSheet, toast, confirmDialog } from './ui.js';
import { addEntry, updateEntry, deleteEntry } from './store.js';
import { todayKey, fmtDate, isKey } from './dates.js';

const QUICK = [[30, '30 хв'], [60, '1 год'], [90, '1,5 год'], [120, '2 год'], [180, '3 год'], [240, '4 год']];

export function openEntrySheet({ entry = null, date = null, minutes = null, title = null, onSaved = null } = {}) {
  let min = entry ? entry.minutes : (minutes ?? 60);
  const day = entry?.date || date || todayKey();
  openSheet({
    title: title || (entry ? 'Редагувати запис' : 'Додати години'),
    body: html`
      <form class="form" novalidate>
        <div class="dur">
          <button type="button" class="round-btn" data-step="-15" aria-label="Мінус 15 хвилин">${icon('minus')}</button>
          <div class="dur-value">
            <label><input class="dur-in" name="h" type="number" inputmode="numeric" min="0" max="24" aria-label="Години"><span>год</span></label>
            <label><input class="dur-in" name="m" type="number" inputmode="numeric" min="0" max="59" step="5" aria-label="Хвилини"><span>хв</span></label>
          </div>
          <button type="button" class="round-btn" data-step="15" aria-label="Плюс 15 хвилин">${icon('plus')}</button>
        </div>
        <div class="chips">${QUICK.map(([v, l]) => html`<button type="button" class="chip" data-set="${v}">${l}</button>`)}</div>
        <label class="field"><span class="field-label">Дата</span>
          <input type="date" name="date" value="${day}" max="${todayKey()}" required></label>
        <label class="field"><span class="field-label">Нотатка <em>необовʼязково</em></span>
          <textarea name="note" rows="2" maxlength="500" placeholder="Напр.: служіння з групою, повторні відвідини">${entry?.note || ''}</textarea></label>
        <div class="btn-row">
          ${entry ? html`<button type="button" class="btn btn-ghost-danger" data-del>${icon('trash')}Видалити</button>` : ''}
          <button type="submit" class="btn btn-primary btn-grow">${icon('check')}${entry ? 'Зберегти' : 'Додати'}</button>
        </div>
      </form>`,
    onMount(el, close) {
      const form = $('form', el);
      const hIn = form.elements.h, mIn = form.elements.m;
      const sync = () => {
        hIn.value = String(Math.floor(min / 60));
        mIn.value = String(min % 60);
        $$('.chip', el).forEach((c) => c.classList.toggle('on', Number(c.dataset.set) === min));
      };
      const read = () => {
        const h = clamp(parseInt(hIn.value, 10) || 0, 0, 24);
        const m = clamp(parseInt(mIn.value, 10) || 0, 0, 59);
        min = clamp(h * 60 + m, 0, 24 * 60);
        $$('.chip', el).forEach((c) => c.classList.toggle('on', Number(c.dataset.set) === min));
      };
      sync();
      hIn.addEventListener('input', read);
      mIn.addEventListener('input', read);
      hIn.addEventListener('blur', sync);
      mIn.addEventListener('blur', sync);
      for (const inp of [hIn, mIn]) inp.addEventListener('focus', () => inp.select());
      el.addEventListener('click', (e) => {
        const st = e.target.closest('[data-step]');
        if (st) { read(); min = clamp(min + Number(st.dataset.step), 0, 24 * 60); sync(); haptic(); }
        const set = e.target.closest('[data-set]');
        if (set) { min = Number(set.dataset.set); sync(); haptic(); }
      });
      $('[data-del]', el)?.addEventListener('click', async () => {
        if (!(await confirmDialog(`Видалити запис ${fmtHM(entry.minutes)} за ${fmtDate(entry.date)}?`))) return;
        const removed = await deleteEntry(entry.id);
        close();
        toast('Запис видалено', { action: 'Повернути', onAction: () => updateEntry(removed) });
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        read();
        const date = form.elements.date.value;
        if (!isKey(date)) { toast('Вкажіть дату', { kind: 'warn' }); return; }
        if (date > todayKey()) { toast('Дата не може бути в майбутньому', { kind: 'warn' }); return; }
        if (min <= 0) { toast('Вкажіть кількість часу', { kind: 'warn' }); hIn.focus(); return; }
        const note = form.elements.note.value;
        haptic(15);
        if (entry) {
          await updateEntry({ ...entry, date, minutes: min, note: note.trim() });
          close();
          toast('Збережено');
        } else {
          const added = await addEntry({ date, minutes: min, note });
          close();
          onSaved?.(added);
          toast(`Додано ${fmtHM(min)}${date !== todayKey() ? ` · ${fmtDate(date)}` : ''}`, {
            action: 'Скасувати', onAction: () => deleteEntry(added.id),
          });
        }
      });
    },
  });
}

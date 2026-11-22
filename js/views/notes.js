// Notes: list with search + simple autosaving editor.
import { $, html, mount, debounce, haptic } from '../util.js';
import { icon } from '../icons.js';
import { state, saveNote, deleteNote, newNote } from '../store.js';
import { confirmDialog, toast, emptyState } from '../ui.js';
import { toKey, relDays, fmtDateShort } from '../dates.js';

let query = '';

const firstLine = (t) => (t.split('\n').find((l) => l.trim()) || '').trim();
const rest = (t) => {
  const lines = t.split('\n');
  const i = lines.findIndex((l) => l.trim());
  return lines.slice(i + 1).join(' ').trim();
};

export function renderList(root) {
  const q = query.trim().toLowerCase();
  const notes = [...state.notes]
    .filter((n) => n.text.trim() && (!q || n.text.toLowerCase().includes(q)))
    .sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
  const total = state.notes.filter((n) => n.text.trim()).length;

  mount(root, html`
    <header class="top">
      <div><div class="eyebrow">${total ? `${total} збережено` : 'Особисте'}</div><h1>Нотатки</h1></div>
      <a class="icon-btn icon-btn-accent" href="#/note/new" aria-label="Нова нотатка">${icon('plus')}</a>
    </header>
    ${total ? html`
      ${total > 4 ? html`<label class="search">${icon('search')}<input type="search" placeholder="Пошук у нотатках" value="${query}" data-q></label>` : ''}
      <div class="notes">
        ${notes.length ? notes.map((n) => html`
          <a class="note-card" href="#/note/${n.id}">
            <span class="note-title">${n.pinned ? icon('pin', 'note-pin') : ''}${firstLine(n.text)}</span>
            ${rest(n.text) ? html`<span class="note-prev">${rest(n.text)}</span>` : ''}
            <span class="note-date">${relDays(toKey(new Date(n.updatedAt)))}</span>
          </a>`) : html`<div class="empty-inline">Нічого не знайдено.</div>`}
      </div>` : emptyState('note', 'Тут будуть ваші нотатки', 'Повторні відвідини, адреси, думки для бесід, плани на тиждень — усе зберігається лише на цьому телефоні.',
      html`<a class="btn btn-primary" href="#/note/new">${icon('plus')}Нова нотатка</a>`)}
  `);

  const qi = $('[data-q]', root);
  qi?.addEventListener('input', debounce(() => {
    query = qi.value;
    const pos = qi.selectionStart;
    renderList(root);
    const n = $('[data-q]', root);
    n?.focus(); n?.setSelectionRange(pos, pos);
  }, 200));
}

export function renderEditor(root, [id]) {
  let note = id !== 'new' ? state.notes.find((n) => n.id === id) : null;
  const isNew = !note;
  if (!note) note = newNote();

  mount(root, html`
    <header class="top top-back">
      <a class="icon-btn" href="#/notes" aria-label="Назад">${icon('left')}</a>
      <div class="top-title"><div class="eyebrow" data-saved>${isNew ? 'Нова нотатка' : `Змінено ${fmtDateShort(toKey(new Date(note.updatedAt)))}`}</div></div>
      <button type="button" class="icon-btn ${note.pinned ? 'is-on' : ''}" data-pin aria-label="Закріпити" aria-pressed="${!!note.pinned}">${icon('pin')}</button>
      <button type="button" class="icon-btn" data-del aria-label="Видалити">${icon('trash')}</button>
    </header>
    <textarea class="editor" data-text maxlength="20000" placeholder="Почніть писати…&#10;&#10;Перший рядок стане заголовком.">${note.text}</textarea>
  `);

  const ta = $('[data-text]', root);
  const mark = $('[data-saved]', root);
  const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.max(ta.scrollHeight, innerHeight * 0.6)}px`; };
  const persist = async () => {
    if (!ta.value.trim() && !state.notes.some((n) => n.id === note.id)) return;
    note.text = ta.value;
    await saveNote(note, { silent: true });
    // A brand-new note gets its real address — but only while we are still on that editor.
    if (location.hash === '#/note/new') history.replaceState(null, '', `#/note/${note.id}`);
    mark.textContent = 'Збережено';
  };
  const d = debounce(persist, 450);
  ta.addEventListener('input', () => { grow(); mark.textContent = 'Збереження…'; d(); });
  requestAnimationFrame(grow);
  if (isNew) setTimeout(() => ta.focus(), 250);

  root.onclick = async (e) => {
    if (e.target.closest('[data-pin]')) {
      note.pinned = !note.pinned;
      haptic();
      e.target.closest('[data-pin]').classList.toggle('is-on', note.pinned);
      if (ta.value.trim()) { note.text = ta.value; await saveNote(note, { silent: true }); }
      toast(note.pinned ? 'Закріплено зверху' : 'Відкріплено');
    }
    if (e.target.closest('[data-del]')) {
      if (ta.value.trim() && !(await confirmDialog('Видалити цю нотатку?'))) return;
      const removed = state.notes.some((n) => n.id === note.id) ? await deleteNote(note.id) : null;
      ta.value = '';
      location.hash = '#/notes';
      if (removed) toast('Нотатку видалено', { action: 'Повернути', onAction: () => saveNote(removed) });
    }
  };

  return () => {
    root.onclick = null;
    if (ta.value.trim()) d.flush();
    else if (state.notes.some((n) => n.id === note.id)) deleteNote(note.id);
  };
}

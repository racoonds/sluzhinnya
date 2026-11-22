// App state kept in memory and mirrored to IndexedDB.
import { db } from './db.js';
import { uid } from './util.js';
import { todayKey } from './dates.js';

export const DEFAULTS = {
  goalType: 'month',               // 'month' | 'year' | 'custom'
  goals: { month: 50, year: 600, custom: 100 },
  customStart: null,
  customEnd: null,
  reminder: { enabled: false, time: '20:00', days: [0, 1, 2, 3, 4, 5, 6], weekly: true },
  theme: 'dark',                   // 'system' | 'dark' | 'light'
  autoLock: 1,                     // minutes in background before PIN is required again
  onboarded: false,
};

export const state = {
  entries: [],
  notes: [],
  territories: [],
  settings: structuredClone(DEFAULTS),
  timer: null,                     // { running, startedAt, accMs, date }
};

const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = () => { for (const fn of listeners) fn(); };

function mergeSettings(saved) {
  const s = { ...structuredClone(DEFAULTS), ...(saved || {}) };
  s.goals = { ...DEFAULTS.goals, ...(saved?.goals || {}) };
  s.reminder = { ...DEFAULTS.reminder, ...(saved?.reminder || {}) };
  return s;
}

export async function load() {
  const [entries, notes, territories, settings, timer] = await Promise.all([
    db.all('entries'), db.all('notes'), db.all('territories'), db.getKV('settings'), db.getKV('timer'),
  ]);
  state.entries = entries || [];
  state.notes = notes || [];
  state.territories = territories || [];
  state.settings = mergeSettings(settings);
  state.timer = timer;
}

export async function saveSettings(patch) {
  state.settings = mergeSettings({ ...state.settings, ...patch });
  await db.setKV('settings', state.settings);
  emit();
}

/* ---------- hours ---------- */

export async function addEntry({ date = todayKey(), minutes, note = '' }) {
  const e = { id: uid(), date, minutes: Math.round(minutes), note: note.trim(), createdAt: Date.now() };
  state.entries.push(e);
  await db.put('entries', e);
  emit();
  return e;
}

export async function updateEntry(e) {
  const i = state.entries.findIndex((x) => x.id === e.id);
  if (i >= 0) state.entries[i] = e; else state.entries.push(e);
  await db.put('entries', e);
  emit();
}

export async function deleteEntry(id) {
  const e = state.entries.find((x) => x.id === id);
  state.entries = state.entries.filter((x) => x.id !== id);
  await db.del('entries', id);
  emit();
  return e;
}

export function minutesByDay() {
  const m = new Map();
  for (const e of state.entries) m.set(e.date, (m.get(e.date) || 0) + e.minutes);
  return m;
}

export const entriesOn = (key) =>
  state.entries.filter((e) => e.date === key).sort((a, b) => a.createdAt - b.createdAt);

/* ---------- timer ---------- */

export async function setTimer(t) {
  state.timer = t;
  await db.setKV('timer', t);
  emit();
}

export function timerMs(t = state.timer) {
  if (!t) return 0;
  return (t.accMs || 0) + (t.running && t.startedAt ? Date.now() - t.startedAt : 0);
}

/* ---------- notes ---------- */

export async function saveNote(n, { silent = false } = {}) {
  n.updatedAt = Date.now();
  const i = state.notes.findIndex((x) => x.id === n.id);
  if (i >= 0) state.notes[i] = n; else state.notes.push(n);
  await db.put('notes', n);
  if (!silent) emit();
  return n;
}

export async function deleteNote(id) {
  const n = state.notes.find((x) => x.id === id);
  state.notes = state.notes.filter((x) => x.id !== id);
  await db.del('notes', id);
  emit();
  return n;
}

export const newNote = () => ({ id: uid(), text: '', pinned: false, createdAt: Date.now(), updatedAt: Date.now() });

/* ---------- territories ---------- */

export const newTerritory = () => ({
  id: uid(), number: '', name: '', status: 'new', assignedAt: todayKey(), completedAt: null,
  notes: '', photoId: null, history: [], createdAt: Date.now(), updatedAt: Date.now(),
});

export async function saveTerritory(t, { silent = false } = {}) {
  t.updatedAt = Date.now();
  const i = state.territories.findIndex((x) => x.id === t.id);
  if (i >= 0) state.territories[i] = t; else state.territories.push(t);
  await db.put('territories', t);
  if (!silent) emit();
  return t;
}

export async function deleteTerritory(id) {
  const t = state.territories.find((x) => x.id === id);
  state.territories = state.territories.filter((x) => x.id !== id);
  await db.del('territories', id);
  if (t?.photoId) await deletePhoto(t.photoId);
  emit();
}

export function lastWorked(t) {
  const dates = (t.history || []).map((h) => h.date).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/* ---------- photos ---------- */

const urlCache = new Map();

export async function savePhoto({ blob, thumb, width, height }) {
  const p = { id: uid(), blob, thumb, width, height, createdAt: Date.now() };
  await db.put('photos', p);
  return p.id;
}

export async function deletePhoto(id) {
  for (const kind of ['thumb', 'full']) {
    const k = `${id}:${kind}`;
    if (urlCache.has(k)) { URL.revokeObjectURL(urlCache.get(k)); urlCache.delete(k); }
  }
  await db.del('photos', id);
}

export async function photoURL(id, kind = 'thumb') {
  if (!id) return null;
  const k = `${id}:${kind}`;
  if (urlCache.has(k)) return urlCache.get(k);
  const p = await db.get('photos', id);
  if (!p) return null;
  const b = kind === 'thumb' ? (p.thumb || p.blob) : p.blob;
  const url = URL.createObjectURL(b);
  urlCache.set(k, url);
  return url;
}

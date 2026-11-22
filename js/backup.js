// Backup to a file you keep yourself (no cloud). Import restores everything.
import { db } from './db.js';
import { state, load, emit, saveSettings } from './store.js';
import { deliverFile } from './reminders.js';
import { todayKey, isKey } from './dates.js';
import { uid } from './util.js';

const FORMAT = 'sluzhinnya-backup';

const blobToB64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

function b64ToBlob(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || '');
  if (!m) return null;
  const bin = atob(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] || 'image/jpeg' });
}

export async function exportBackup() {
  const photos = await db.all('photos');
  const out = {
    format: FORMAT, version: 1, exportedAt: new Date().toISOString(),
    settings: state.settings,
    entries: state.entries, notes: state.notes, territories: state.territories,
    photos: await Promise.all(photos.map(async (p) => ({
      id: p.id, width: p.width, height: p.height, createdAt: p.createdAt,
      blob: await blobToB64(p.blob), thumb: p.thumb ? await blobToB64(p.thumb) : null,
    }))),
  };
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const res = await deliverFile(blob, `sluzhinnya-${todayKey()}.json`, 'Резервна копія');
  if (res !== 'aborted') { await db.setKV('lastBackup', Date.now()); await saveSettings({ lastBackup: Date.now() }); }
  return res;
}

const str = (v, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/* Normalisers shared by backup import and cloud sync: return a clean record or null. */
export function normEntry(e) {
  if (!e || !isKey(e.date) || !(num(e.minutes) > 0)) return null;
  const createdAt = num(e.createdAt) || Date.now();
  return { id: str(e.id, 64) || uid(), date: e.date, minutes: Math.min(1440, Math.round(num(e.minutes))), note: str(e.note, 500), createdAt, updatedAt: num(e.updatedAt) || createdAt };
}
export function normNote(n) {
  if (!n || typeof n.text !== 'string') return null;
  return { id: str(n.id, 64) || uid(), text: str(n.text), pinned: !!n.pinned, createdAt: num(n.createdAt) || Date.now(), updatedAt: num(n.updatedAt) || Date.now() };
}
export function normTerritory(t, photoIds = null) {
  if (!t || typeof t !== 'object') return null;
  const pid = str(t.photoId, 64) || null;
  return {
    id: str(t.id, 64) || uid(), number: str(t.number, 20), name: str(t.name, 80),
    status: ['new', 'progress', 'done'].includes(t.status) ? t.status : 'new',
    assignedAt: isKey(t.assignedAt) ? t.assignedAt : null, completedAt: isKey(t.completedAt) ? t.completedAt : null,
    notes: str(t.notes, 5000), photoId: pid && (!photoIds || photoIds.has(pid)) ? pid : null,
    history: (Array.isArray(t.history) ? t.history : []).filter((h) => h && isKey(h.date)).map((h) => ({ id: str(h.id, 64) || uid(), date: h.date, note: str(h.note, 500) })),
    createdAt: num(t.createdAt) || Date.now(), updatedAt: num(t.updatedAt) || Date.now(),
  };
}
export function normGoal(g) {
  if (!g || typeof g !== 'object') return null;
  return {
    goalType: ['month', 'year', 'custom'].includes(g.goalType) ? g.goalType : 'month',
    goals: { month: num(g.goals?.month) || 50, year: num(g.goals?.year) || 600, custom: num(g.goals?.custom) || 100 },
    customStart: isKey(g.customStart) ? g.customStart : null,
    customEnd: isKey(g.customEnd) ? g.customEnd : null,
  };
}

/** Validates and normalises an imported file. Throws with a readable message. */
export function parseBackup(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('Це не файл резервної копії (пошкоджений JSON)'); }
  if (!d || d.format !== FORMAT) throw new Error('Файл не схожий на резервну копію «Служіння»');
  const entries = (Array.isArray(d.entries) ? d.entries : []).map(normEntry).filter(Boolean);
  const notes = (Array.isArray(d.notes) ? d.notes : []).map(normNote).filter(Boolean);
  const photos = (Array.isArray(d.photos) ? d.photos : [])
    .map((p) => ({ id: str(p.id, 64), width: num(p.width), height: num(p.height), createdAt: num(p.createdAt), blob: b64ToBlob(p.blob), thumb: p.thumb ? b64ToBlob(p.thumb) : null }))
    .filter((p) => p.id && p.blob && /^image\//.test(p.blob.type));
  const photoIds = new Set(photos.map((p) => p.id));
  const territories = (Array.isArray(d.territories) ? d.territories : []).map((t) => normTerritory(t, photoIds)).filter(Boolean);
  const settings = d.settings && typeof d.settings === 'object' ? d.settings : {};
  const safeSettings = {
    ...normGoal(settings),
    theme: ['system', 'dark', 'light'].includes(settings.theme) ? settings.theme : 'system',
    onboarded: true,
  };
  return { entries, notes, territories, photos, settings: safeSettings, exportedAt: str(d.exportedAt, 40) };
}

export async function importBackup(parsed) {
  const keep = { ...state.settings };
  await db.replaceAll({ entries: parsed.entries, notes: parsed.notes, territories: parsed.territories, photos: parsed.photos });
  await db.setKV('settings', { ...keep, ...parsed.settings, reminder: keep.reminder, autoLock: keep.autoLock });
  await load();
  emit();
  hooks.afterImport?.();
}

let hooks = {};
export const setBackupHooks = (h) => { hooks = h || {}; };

export async function wipeAll() {
  await db.replaceAll({ entries: [], notes: [], territories: [], photos: [], kv: [] });
  hooks.afterWipe?.();
  await load();
  emit();
}

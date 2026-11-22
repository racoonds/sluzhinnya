// Sign in with Google + cloud sync to the owner's own Firebase project (Firestore).
// Plain REST calls — no SDK and no third-party scripts, so the strict CSP stays intact.
//
// Model: the app stays local-first (IndexedDB). Every local change is marked "dirty" with its timestamp,
// pushed as one Firestore document per record, and other devices pull documents newer than their cursor.
// Conflicts: the newest change wins (per record). Deletions are kept as tombstones so they propagate.
import { CLOUD, cloudConfigured } from './config.js';
import { db } from './db.js';
import { state, load, emit, setChangeHook, forgetPhotoURL } from './store.js';
import { normEntry, normNote, normTerritory, normGoal, setBackupHooks } from './backup.js';
import { shrinkToFit } from './photos.js';

const STORES = ['entries', 'notes', 'territories'];
const NORM = { entries: normEntry, notes: normNote, territories: (t) => normTerritory(t) };
const PHOTO_MAX = 850 * 1024;

let session = null;   // { uid, email, name, idToken, refreshToken, expiresAt, cursor, photoCursor, lastSync, relogin }
let dirty = {};       // "store:id" -> timestamp of the local change not yet uploaded
let status = { state: 'off', at: 0, error: '' };
let timer = null;
let running = null;
let again = false;

export { cloudConfigured };
export const isSignedIn = () => !!session;
export const pendingCount = () => Object.keys(dirty).length;
export const syncStatus = () => ({ ...status, signedIn: !!session, email: session?.email || '', name: session?.name || '', pending: pendingCount() });

function setStatus(patch) {
  status = { ...status, ...patch };
  window.dispatchEvent(new CustomEvent('sync-status', { detail: syncStatus() }));
}

const redirectUri = () => new URL('./', location.href.split('#')[0]).href;
const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/* ---------- HTTP ---------- */

async function api(url, body, { token, form = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; payload = body; } else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(url, { method: 'POST', headers, body: payload, cache: 'no-store', referrerPolicy: 'strict-origin', credentials: 'omit' });
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!r.ok) {
    const err = new Error(j?.error?.message || j?.error_description || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return j;
}

const docsBase = () => `https://firestore.googleapis.com/v1/projects/${CLOUD.projectId}/databases/(default)/documents`;
const docName = (path) => `projects/${CLOUD.projectId}/databases/(default)/documents/${path}`;

const F = {
  s: (v) => ({ stringValue: String(v) }),
  i: (v) => ({ integerValue: String(Math.round(Number(v) || 0)) }),
  b: (v) => ({ booleanValue: !!v }),
  bytes: (v) => ({ bytesValue: v }),
};
function val(f) {
  if (!f) return undefined;
  if ('stringValue' in f) return f.stringValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('booleanValue' in f) return f.booleanValue;
  if ('bytesValue' in f) return f.bytesValue;
  if ('timestampValue' in f) return f.timestampValue;
  return undefined;
}
const safeJSON = (s) => { try { return JSON.parse(s); } catch { return null; } };

function blobB64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
function b64Blob(b64, type = 'image/jpeg') {
  if (!b64) return null;
  try {
    const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  } catch { return null; }
}
function jwtClaims(t) {
  try {
    const p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p), (c) => c.charCodeAt(0))));
  } catch { return null; }
}

/* ---------- auth ---------- */

export async function signIn() {
  if (!cloudConfigured()) throw new Error('Вхід через Google ще не налаштовано');
  const nonce = rand(), st = rand();
  await db.setKV('oauth', { nonce, state: st, at: Date.now(), back: location.hash || '#/settings' });
  const p = new URLSearchParams({
    client_id: CLOUD.clientId, redirect_uri: redirectUri(), response_type: 'id_token',
    scope: 'openid email profile', nonce, state: st, prompt: 'select_account',
  });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
}

/** Called on boot, before routing: finishes a Google sign-in that came back in the URL fragment. */
export async function handleAuthRedirect() {
  const h = location.hash;
  if (!/(?:^#|&)(?:id_token|error)=/.test(h)) return null;
  const params = new URLSearchParams(h.slice(1));
  const saved = await db.getKV('oauth');
  await db.setKV('oauth', null);
  history.replaceState(null, '', location.pathname + location.search + (saved?.back || '#/settings'));
  if (!cloudConfigured()) return null;
  if (params.get('error')) return { error: params.get('error') === 'access_denied' ? 'Вхід скасовано' : `Google: ${params.get('error')}` };
  if (!saved || params.get('state') !== saved.state || Date.now() - saved.at > 15 * 60000) return { error: 'Сеанс входу застарів — спробуйте ще раз' };
  const idt = params.get('id_token') || '';
  const claims = jwtClaims(idt);
  if (!claims || claims.nonce !== saved.nonce || claims.aud !== CLOUD.clientId) return { error: 'Не вдалося перевірити вхід — спробуйте ще раз' };
  try {
    const j = await api(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(CLOUD.apiKey)}`, {
      postBody: `id_token=${encodeURIComponent(idt)}&providerId=google.com`,
      requestUri: redirectUri(), returnSecureToken: true, returnIdpCredential: true,
    });
    session = {
      uid: j.localId, email: j.email || claims.email || '', name: j.displayName || j.fullName || claims.name || '',
      idToken: j.idToken, refreshToken: j.refreshToken, expiresAt: Date.now() + Number(j.expiresIn || 3600) * 1000 - 120000,
      cursor: null, photoCursor: null, lastSync: 0, relogin: false,
    };
    await db.setKV('cloud', session);
    await markAll();
    setStatus({ state: 'idle', error: '' });
    syncSoon(100);
    return { ok: true, email: session.email };
  } catch (e) {
    return { error: `Не вдалося увійти: ${e.message}` };
  }
}

export async function signOut() {
  session = null;
  dirty = {};
  clearTimeout(timer);
  await db.setKV('cloud', null);
  await db.setKV('dirty', {});
  setStatus({ state: 'off', at: 0, error: '' });
}

async function getToken() {
  if (session.idToken && Date.now() < session.expiresAt) return session.idToken;
  try {
    const j = await api(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(CLOUD.apiKey)}`,
      `grant_type=refresh_token&refresh_token=${encodeURIComponent(session.refreshToken)}`, { form: true });
    session = { ...session, idToken: j.id_token, refreshToken: j.refresh_token || session.refreshToken, expiresAt: Date.now() + Number(j.expires_in || 3600) * 1000 - 120000, relogin: false };
    await db.setKV('cloud', session);
    return session.idToken;
  } catch (e) {
    if (e.status >= 400 && e.status < 500) {
      session = { ...session, idToken: null, relogin: true };
      await db.setKV('cloud', session);
      const err = new Error('relogin');
      err.relogin = true;
      throw err;
    }
    throw e;
  }
}

/* ---------- change tracking ---------- */

let dirtyWrite = Promise.resolve();
function saveDirty() {
  const snap = { ...dirty };
  dirtyWrite = dirtyWrite.then(() => db.setKV('dirty', snap)).catch(() => {});
  return dirtyWrite;
}

function onLocalChange(store, id, ts) {
  if (!session) return;
  dirty[`${store}:${id}`] = ts;
  saveDirty();
  setStatus({});
  syncSoon(4000);
}

/** Queue every local record for upload (first sign-in on a device, or after restoring a backup). */
async function markAll() {
  for (const st of STORES) for (const r of state[st]) dirty[`${st}:${r.id}`] = r.updatedAt || r.createdAt || 1;
  for (const t of state.territories) if (t.photoId) dirty[`photos:${t.photoId}`] = t.updatedAt || 1;
  dirty['settings:goal'] = state.settings.goalUpdatedAt || 1;
  await saveDirty();
}

/* ---------- sync ---------- */

export async function initSync() {
  if (!cloudConfigured()) return;
  session = session || (await db.getKV('cloud'));
  dirty = { ...((await db.getKV('dirty')) || {}), ...dirty };
  setChangeHook(onLocalChange);
  setBackupHooks({
    afterImport: () => { if (session) markAll().then(() => syncSoon(500)); },
    afterWipe: () => { session = null; dirty = {}; setStatus({ state: 'off', at: 0, error: '' }); },
  });
  window.addEventListener('online', () => syncSoon(500));
  if (session) {
    setStatus({ state: session.relogin ? 'relogin' : 'idle', at: session.lastSync || 0 });
    syncSoon(300);
  }
}

export function syncSoon(ms = 0) {
  if (!session || !cloudConfigured()) return;
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow(); }, ms);
}

export async function syncNow() {
  if (!session) return;
  if (running) { again = true; return running; }
  running = (async () => {
    if (!navigator.onLine) { setStatus({ state: 'offline' }); return; }
    if (session.relogin) { setStatus({ state: 'relogin' }); return; }
    setStatus({ state: 'syncing', error: '' });
    try {
      const token = await getToken();
      const changedLocal = await pull(token);
      if (changedLocal) await load(); // push must see what we just pulled
      await push(token);
      if (!session) return;
      session.lastSync = Date.now();
      await db.setKV('cloud', session);
      if (changedLocal) emit();
      setStatus({ state: 'idle', at: session.lastSync, error: '' });
    } catch (e) {
      if (!session) return;
      if (e.relogin) setStatus({ state: 'relogin', error: '' });
      else setStatus({ state: navigator.onLine ? 'error' : 'offline', error: e.message });
    }
  })();
  try { await running; } finally {
    running = null;
    if (again) { again = false; syncSoon(800); }
  }
}

async function runQuery(token, collection, cursor) {
  const q = { from: [{ collectionId: collection }] };
  if (cursor) q.where = { fieldFilter: { field: { fieldPath: 'serverTime' }, op: 'GREATER_THAN', value: { timestampValue: cursor } } };
  const res = await api(`${docsBase()}/users/${session.uid}:runQuery`, { structuredQuery: q }, { token });
  let readTime = cursor;
  const docs = [];
  for (const r of res || []) {
    if (r.readTime) readTime = r.readTime; // the same for every row of one query
    if (r.document) docs.push(r.document);
  }
  return { docs, readTime };
}

/** Apply remote changes newer than our cursor. Returns true when local data changed. */
async function pull(token) {
  let changedAny = false;
  const rec = await runQuery(token, 'records', session.cursor);
  for (const d of rec.docs) {
    const f = d.fields || {};
    const store = val(f.store), id = val(f.id), ts = val(f.updatedAt) || 0, deleted = val(f.deleted);
    if (!store || !id) continue;
    const key = `${store}:${id}`;
    if (dirty[key] != null) {
      if (dirty[key] >= ts) continue; // our own pending change is newer — it will be uploaded
      delete dirty[key];               // the cloud has a newer version: drop our stale pending upload
    }
    if (store === 'settings' && id === 'goal') {
      const g = deleted ? null : normGoal(safeJSON(val(f.json)));
      if (g && ts > (state.settings.goalUpdatedAt || 0)) {
        const cur = (await db.getKV('settings')) || state.settings;
        await db.setKV('settings', { ...cur, ...g, goalUpdatedAt: ts, onboarded: true });
        changedAny = true;
      }
      continue;
    }
    if (!STORES.includes(store)) continue;
    const local = state[store].find((x) => x.id === id);
    const localTs = local ? (local.updatedAt || local.createdAt || 0) : 0;
    if (local && localTs >= ts) continue; // same version (our own echo) or newer here
    if (deleted) {
      if (local) { await db.del(store, id); changedAny = true; }
      continue;
    }
    const r = NORM[store](safeJSON(val(f.json)));
    if (!r || r.id !== id) continue;
    await db.put(store, r);
    changedAny = true;
  }
  session.cursor = rec.readTime;

  const ph = await runQuery(token, 'photos', session.photoCursor);
  for (const d of ph.docs) {
    const f = d.fields || {};
    const id = d.name.split('/').pop();
    const ts = val(f.updatedAt) || 0;
    const key = `photos:${id}`;
    if (dirty[key] != null) {
      if (dirty[key] >= ts) continue;
      delete dirty[key];
    }
    const have = await db.get('photos', id);
    if (val(f.deleted)) {
      if (have) { forgetPhotoURL(id); await db.del('photos', id); changedAny = true; }
      continue;
    }
    if (have) continue; // photos never change once saved
    const blob = b64Blob(val(f.full));
    if (!blob) continue;
    await db.put('photos', { id, blob, thumb: b64Blob(val(f.thumb)), width: val(f.width) || 0, height: val(f.height) || 0, createdAt: val(f.createdAt) || ts });
    changedAny = true;
  }
  session.photoCursor = ph.readTime;
  await db.setKV('cloud', session);
  await saveDirty();
  return changedAny;
}

const write = (path, fields) => ({
  update: { name: docName(path), fields },
  updateTransforms: [{ fieldPath: 'serverTime', setToServerValue: 'REQUEST_TIME' }],
});
const commit = (token, writes) => api(`${docsBase()}:commit`, { writes }, { token });

function clean(done) {
  for (const [k, ts] of done) if (dirty[k] === ts) delete dirty[k];
  saveDirty();
}

/** Upload everything marked dirty. */
async function push(token) {
  const keys = Object.keys(dirty);
  if (!keys.length || !session) return;
  const uid = session.uid;
  const writes = [], done = [];
  for (const key of keys) {
    const i = key.indexOf(':');
    const store = key.slice(0, i), id = key.slice(i + 1), ts = dirty[key];
    if (store === 'photos') continue;
    let json = '', deleted = false;
    if (store === 'settings') json = JSON.stringify(normGoal(state.settings));
    else {
      const r = state[store]?.find((x) => x.id === id);
      if (r) json = JSON.stringify(r); else deleted = true;
    }
    writes.push(write(`users/${uid}/records/${store}_${id}`, { store: F.s(store), id: F.s(id), json: F.s(json), updatedAt: F.i(ts), deleted: F.b(deleted) }));
    done.push([key, ts]);
  }
  for (let i = 0; i < writes.length; i += 200) await commit(token, writes.slice(i, i + 200));
  clean(done);

  for (const key of keys.filter((k) => k.startsWith('photos:'))) {
    if (!session) return;
    const id = key.slice(7), ts = dirty[key];
    const p = await db.get('photos', id);
    let fields;
    if (p) {
      const full = await shrinkToFit(p.blob, PHOTO_MAX);
      fields = {
        full: F.bytes(await blobB64(full)), thumb: F.bytes(p.thumb ? await blobB64(p.thumb) : ''),
        width: F.i(p.width), height: F.i(p.height), createdAt: F.i(p.createdAt), updatedAt: F.i(ts), deleted: F.b(false),
      };
    } else {
      fields = { updatedAt: F.i(ts), deleted: F.b(true) };
    }
    await commit(token, [write(`users/${uid}/photos/${id}`, fields)]);
    clean([[key, ts]]);
  }
}

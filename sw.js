/* Service worker: offline app shell + local reminders. No data ever leaves the device. */
const VERSION = 'v2.0.0';
const CACHE = `sluzhinnya-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'fonts/inter-latin.woff2',
  'fonts/inter-cyrillic.woff2',
  'icons/favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/badge-96.png',
  'js/main.js',
  'js/util.js',
  'js/icons.js',
  'js/dates.js',
  'js/db.js',
  'js/store.js',
  'js/stats.js',
  'js/ui.js',
  'js/theme.js',
  'js/entry-sheet.js',
  'js/goal-sheet.js',
  'js/install.js',
  'js/lock.js',
  'js/photos.js',
  'js/reminders.js',
  'js/backup.js',
  'js/config.js',
  'js/sync.js',
  'js/auth-gate.js',
  'js/views/home.js',
  'js/views/calendar.js',
  'js/views/territories.js',
  'js/views/notes.js',
  'js/views/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('sluzhinnya-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // the app never talks to other origins
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cached = await caches.match('index.html', { ignoreSearch: true });
      if (cached) return cached;
      return fetch(req);
    })());
    return;
  }
  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      const c = await caches.open(CACHE);
      c.put(req, res.clone());
    }
    return res;
  })());
});

/* ---------- reminders (Android / Chromium: periodic background sync) ---------- */

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('sluzhinnya');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onupgradeneeded = () => { r.transaction.abort(); reject(new Error('no db')); };
  });
}
function get(db, store, key) {
  return new Promise((resolve, reject) => {
    const q = db.transaction(store).objectStore(store)[key === undefined ? 'getAll' : 'get'](key);
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}
function put(db, store, val) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).put(val);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}
const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dec = (min) => (Math.round(min / 6) / 10).toString().replace('.', ',');

async function checkReminder() {
  const db = await idb();
  const s = (await get(db, 'kv', 'settings'))?.value;
  if (!s?.reminder?.enabled) return;
  const now = new Date();
  const wd = (now.getDay() + 6) % 7;
  if (!(s.reminder.days || []).includes(wd)) return;
  const [h, m] = String(s.reminder.time || '20:00').split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;
  const today = key(now);
  if ((await get(db, 'kv', 'notified'))?.value === today) return;
  const entries = (await get(db, 'entries')) || [];
  if (entries.some((e) => e.date === today)) return;

  // Same maths as js/stats.js (simplified)
  let start, end, goalH = s.goals?.[s.goalType] || 0;
  if (s.goalType === 'year') {
    const y = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    start = new Date(y, 8, 1); end = new Date(y + 1, 7, 31);
  } else if (s.goalType === 'custom' && s.customStart && s.customEnd) {
    const [a, b, c] = s.customStart.split('-').map(Number); start = new Date(a, b - 1, c);
    const [x, y2, z] = s.customEnd.split('-').map(Number); end = new Date(x, y2 - 1, z);
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), 1); end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    goalH = s.goals?.month || 0;
  }
  const sk = key(start), ek = key(end);
  const done = entries.filter((e) => e.date >= sk && e.date <= ek).reduce((a, e) => a + e.minutes, 0);
  const remaining = Math.max(0, goalH * 60 - done);
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysLeft = Math.max(1, Math.round((end - t0) / 86400000) + 1);
  const perWeek = daysLeft >= 7 ? remaining / (daysLeft / 7) : remaining;
  const body = goalH && remaining
    ? `Сьогодні ще не внесено годин. До цілі ${dec(remaining)} год — ≈ ${dec(perWeek)} год/тиж.`
    : 'Сьогодні ще не внесено годин служіння.';

  await put(db, 'kv', { key: 'notified', value: today });
  await self.registration.showNotification('Служіння', {
    body, tag: 'sluzhinnya', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { url: './' },
  });
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'sluzhinnya-reminder') e.waitUntil(checkReminder().catch(() => {}));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) if ('focus' in c) return c.focus();
    return self.clients.openWindow(new URL('./', self.registration.scope).href);
  })());
});

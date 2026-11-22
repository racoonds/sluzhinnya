// Two-device sync test against a fake Google/Firebase (no real network).
// Usage: serve the repo at http://127.0.0.1:8080/sluzhinnya/ then: node tests/e2e/sync.cjs <shots-dir> <some.jpg>
// Needs Playwright with Chromium installed.
const { chromium, devices } = require('playwright');
const APP = 'http://127.0.0.1:8080/sluzhinnya/';
const SHOTS = process.argv[2], MAP = process.argv[3];

/* ---------- fake Google + Firebase ---------- */
const docs = new Map();            // name -> { fields, t }
let clock = Date.now() * 1000;     // microseconds, strictly increasing
const iso = (us) => new Date(Math.floor(us / 1000)).toISOString().replace(/\.\d+Z$/, '.' + String(us % 1000000).padStart(6, '0') + 'Z');
const parseIso = (s) => { const m = /^(.*?)(?:\.(\d+))?Z$/.exec(s); return Date.parse(m[1] + 'Z') * 1000 + Number(((m[2] || '') + '000000').slice(0, 6)); };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
let commits = 0, queries = 0, refreshes = 0;

async function google(route) {
  const u = new URL(route.request().url());
  const q = u.searchParams;
  const jwt = `${b64u({ alg: 'none' })}.${b64u({ aud: q.get('client_id'), nonce: q.get('nonce'), sub: 'g-42', email: 'tester@gmail.com', name: 'Денис' })}.sig`;
  await route.fulfill({ status: 302, headers: { location: `${q.get('redirect_uri')}#state=${q.get('state')}&id_token=${jwt}&authuser=0` } });
}
async function firebase(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const url = new URL(req.url());
  const json = (body, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (url.host === 'identitytoolkit.googleapis.com') {
    const b = JSON.parse(req.postData());
    const tok = new URLSearchParams(b.postBody).get('id_token');
    const claims = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url'));
    return json({ localId: 'uid-' + claims.sub, email: claims.email, displayName: claims.name, idToken: 'fb-token', refreshToken: 'refresh-1', expiresIn: '3600' });
  }
  if (url.host === 'securetoken.googleapis.com') { refreshes++; return json({ id_token: 'fb-token-2', refresh_token: 'refresh-2', expires_in: '3600' }); }
  // Firestore
  const auth = req.headers()['authorization'];
  if (!auth?.startsWith('Bearer fb-token')) return json({ error: { message: 'unauthenticated' } }, 401);
  const b = JSON.parse(req.postData());
  if (url.pathname.endsWith(':commit')) {
    commits++;
    for (const w of b.writes) {
      clock += 1;
      const fields = { ...w.update.fields };
      for (const tr of w.updateTransforms || []) fields[tr.fieldPath] = { timestampValue: iso(clock) };
      docs.set(w.update.name, { fields, t: clock });
    }
    return json({ writeResults: b.writes.map(() => ({ updateTime: iso(clock) })), commitTime: iso(clock) });
  }
  if (url.pathname.endsWith(':runQuery')) {
    queries++;
    const parent = decodeURIComponent(url.pathname.replace(/^\/v1\//, '').replace(/:runQuery$/, ''));
    const coll = b.structuredQuery.from[0].collectionId;
    const since = b.structuredQuery.where ? parseIso(b.structuredQuery.where.fieldFilter.value.timestampValue) : -1;
    const readTime = iso(clock);
    const rows = [...docs].filter(([name, d]) => name.startsWith(`${parent}/${coll}/`) && d.t > since)
      .map(([name, d]) => ({ document: { name, fields: d.fields }, readTime }));
    return json(rows.length ? rows : [{ readTime }]);
  }
  return json({ error: { message: 'unknown' } }, 404);
}

async function device(browser, name) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1, serviceWorkers: 'block' });
  await ctx.route('**/sluzhinnya/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const CLOUD = { apiKey: 'test-key', projectId: 'demo-proj', clientId: 'cid.apps.googleusercontent.com' };\nexport const cloudConfigured = () => true;` }));
  await ctx.route('https://accounts.google.com/**', google);
  await ctx.route(/https:\/\/(identitytoolkit|securetoken|firestore)\.googleapis\.com\/.*/, firebase);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(`${name} console: ${m.text()}`); });
  return page;
}
const waitIdle = async (page) => {
  await page.waitForFunction(() => { const el = document.querySelector('[data-sync-line]'); return el && /Синхронізовано/.test(el.textContent) && !/черзі/.test(el.textContent); }, null, { timeout: 20000 });
};
const syncNow = async (page) => { await page.goto(APP + '#/settings'); await page.waitForSelector('[data-sync-now]'); await page.click('[data-sync-now]'); await page.waitForTimeout(300); await waitIdle(page); };

(async () => {
  const browser = await chromium.launch();
  const A = await device(browser, 'A');
  await A.goto(APP);
  await A.waitForSelector('.sheet');
  await A.click('.chip[data-v="30"]');
  await A.click('form button[type=submit]');
  await A.waitForTimeout(400);
  await A.click('[data-add-hours]'); await A.click('.chip[data-set="120"]'); await A.fill('textarea[name=note]', 'З групою'); await A.click('.sheet form button[type=submit]'); await A.waitForTimeout(400);
  await A.goto(APP + '#/territories'); await A.click('[data-add]'); await A.fill('.sheet input[name=number]', '14');
  await A.setInputFiles('.sheet [data-file]', MAP); await A.waitForSelector('.photo-pick-empty.has-img img'); await A.click('.sheet form button[type=submit]'); await A.waitForTimeout(500);
  await A.goto(APP + '#/note/new'); await A.waitForSelector('.editor'); await A.fill('.editor', 'Повторні відвідини\nОлена, кв. 5'); await A.waitForTimeout(800);
  await A.goto(APP + '#/settings');
  await A.waitForSelector('[data-signin]');
  await A.screenshot({ path: `${SHOTS}/s1-signed-out.png` });
  await A.click('[data-signin]');
  await A.waitForTimeout(2500);
  await A.waitForSelector('[data-sync-line]');
  await waitIdle(A);
  await A.waitForTimeout(300);
  await A.screenshot({ path: `${SHOTS}/s2-signed-in.png` });
  console.log('A after sign-in: hash', await A.evaluate(() => location.hash), '| cloud docs', docs.size, [...docs.keys()].map((k) => k.split('/').slice(-2).join('/').replace(/_[0-9a-f-]{36}$/, '_…')).join(', '));

  const B = await device(browser, 'B');
  await B.goto(APP);
  await B.waitForSelector('.sheet');
  await B.keyboard.press('Escape');
  await B.waitForTimeout(400);
  await B.goto(APP + '#/settings');
  await B.click('[data-signin]');
  await B.waitForSelector('[data-sync-line]');
  await waitIdle(B);
  await B.goto(APP + '#/home'); await B.waitForTimeout(800);
  await B.screenshot({ path: `${SHOTS}/s3-B-home.png` });
  const bState = await B.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('sluzhinnya'); q.onsuccess = () => r(q.result); });
    const all = (s) => new Promise((r) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); });
    const kv = await all('kv');
    return { entries: (await all('entries')).map((e) => `${e.minutes}m ${e.note}`), terr: (await all('territories')).map((t) => t.number + ' photo:' + !!t.photoId), photos: (await all('photos')).map((p) => p.blob.size), notes: (await all('notes')).map((n) => n.text.split('\n')[0]), goal: kv.find((k) => k.key === 'settings')?.value.goals.month + '/' + kv.find((k) => k.key === 'settings')?.value.goalType };
  });
  console.log('B pulled:', JSON.stringify(bState));
  const goalDoc = [...docs].find(([k]) => k.endsWith('/records/settings_goal'))[1].fields;
  console.log('cloud goal after B joined:', JSON.parse(goalDoc.json.stringValue).goals.month, 'ts>1:', Number(goalDoc.updatedAt.integerValue) > 1);
  await B.goto(APP + '#/territories'); await B.waitForTimeout(600);
  console.log('B territory thumb loaded:', await B.$$eval('.terr-thumb img[src^="blob:"]', (x) => x.length));
  await B.screenshot({ path: `${SHOTS}/s4-B-territories.png` });

  // B edits: delete the entry, change the note
  await B.goto(APP + '#/home'); await B.waitForTimeout(400);
  await B.click('[data-edit]'); await B.click('.sheet [data-del]'); await B.click('.sheet [data-ok]'); await B.waitForTimeout(500);
  await B.goto(APP + '#/notes'); await B.click('.note-card'); await B.waitForSelector('.editor'); await B.fill('.editor', 'Повторні відвідини\nОлена, кв. 5 — прийти в суботу'); await B.waitForTimeout(800);
  await syncNow(B);
  await syncNow(A);
  const aState = await A.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('sluzhinnya'); q.onsuccess = () => r(q.result); });
    const all = (s) => new Promise((r) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); });
    return { entries: (await all('entries')).length, note: (await all('notes'))[0]?.text };
  });
  console.log('A after B changes:', JSON.stringify(aState));
  await A.goto(APP + '#/home'); await A.waitForTimeout(600);
  console.log('A home indicator state:', await A.getAttribute('[data-sync-ind]', 'data-state'));
  await A.screenshot({ path: `${SHOTS}/s5-A-home.png` });

  // expired token -> refresh
  await A.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('sluzhinnya'); q.onsuccess = () => r(q.result); });
    const get = () => new Promise((r) => { const q = db.transaction('kv').objectStore('kv').get('cloud'); q.onsuccess = () => r(q.result.value); });
    const s = await get(); s.expiresAt = 0;
    await new Promise((r) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put({ key: 'cloud', value: s }); t.oncomplete = r; });
  });
  await A.reload(); await A.waitForTimeout(400);
  await syncNow(A);
  console.log('token refreshes:', refreshes);

  // sign out on B
  await B.goto(APP + '#/settings'); await B.click('[data-signout]'); await B.click('.sheet [data-ok]'); await B.waitForTimeout(600);
  console.log('B after sign-out shows sign-in button:', !!(await B.$('[data-signin]')), '| local entries kept:', await B.evaluate(async () => { const db = await new Promise((r) => { const q = indexedDB.open('sluzhinnya'); q.onsuccess = () => r(q.result); }); return new Promise((r) => { const q = db.transaction('notes').objectStore('notes').getAll(); q.onsuccess = () => r(q.result.length); }); }));
  console.log('requests: commits', commits, 'queries', queries);
  console.log('ERRORS:', [...A.errors, ...B.errors].join('\n') || 'none');
  await browser.close();
})().catch((e) => { console.error('TEST FAILED', e); process.exit(1); });

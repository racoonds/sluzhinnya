// Accounts + two-device sync test against a fake Firebase (no real network).
// Usage: serve the repo at http://127.0.0.1:8080/sluzhinnya/ then: node tests/e2e/sync.cjs <shots-dir> <some.jpg>
// Needs Playwright with Chromium installed.
const { chromium, devices } = require('playwright');
const APP = 'http://127.0.0.1:8080/sluzhinnya/';
const SHOTS = process.argv[2], MAP = process.argv[3];

/* ---------- fake Firebase (Auth + Firestore REST) ---------- */
const docs = new Map();            // name -> { fields, t }
const users = new Map();           // email -> { uid, password }
const revoked = new Set();         // refresh tokens that no longer work
let clock = Date.now() * 1000;     // microseconds, strictly increasing
const iso = (us) => new Date(Math.floor(us / 1000)).toISOString().replace(/\.\d+Z$/, '.' + String(us % 1000000).padStart(6, '0') + 'Z');
const parseIso = (s) => { const m = /^(.*?)(?:\.(\d+))?Z$/.exec(s); return Date.parse(m[1] + 'Z') * 1000 + Number(((m[2] || '') + '000000').slice(0, 6)); };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, x-firebase-locale', 'access-control-allow-methods': 'POST, OPTIONS' };
const tokens = new Map();          // idToken -> uid
let n = 0, commits = 0, queries = 0, refreshes = 0, resets = 0;
const issue = (uid, email) => { const t = `id-${++n}`; tokens.set(t, uid); return { localId: uid, email, idToken: t, refreshToken: `rt-${uid}-${n}`, expiresIn: '3600' }; };

async function firebase(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const url = new URL(req.url());
  const json = (body, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const fail = (message, status = 400) => json({ error: { code: status, message } }, status);
  if (url.host === 'identitytoolkit.googleapis.com') {
    const b = JSON.parse(req.postData());
    if (url.pathname.endsWith(':signUp')) {
      if (users.has(b.email)) return fail('EMAIL_EXISTS');
      if (b.password.length < 6) return fail('WEAK_PASSWORD : Password should be at least 6 characters');
      const uid = `uid-${users.size + 1}`;
      users.set(b.email, { uid, password: b.password });
      return json(issue(uid, b.email));
    }
    if (url.pathname.endsWith(':signInWithPassword')) {
      const u = users.get(b.email);
      if (!u || u.password !== b.password) return fail('INVALID_LOGIN_CREDENTIALS');
      return json(issue(u.uid, b.email));
    }
    if (url.pathname.endsWith(':sendOobCode')) { resets++; return json({ email: b.email }); }
  }
  if (url.host === 'securetoken.googleapis.com') {
    refreshes++;
    const rt = new URLSearchParams(req.postData()).get('refresh_token');
    if (revoked.has(rt)) return fail('TOKEN_EXPIRED');
    const uid = rt.split('-').slice(1, 3).join('-');
    const t = issue(uid, '');
    return json({ id_token: t.idToken, refresh_token: rt, expires_in: '3600', user_id: uid });
  }
  // Firestore — enforce the same rule as firestore.rules: only users/{own uid}/...
  const uid = tokens.get((req.headers().authorization || '').replace('Bearer ', ''));
  if (!uid) return fail('unauthenticated', 401);
  const b = JSON.parse(req.postData());
  const own = (name) => name.includes(`/documents/users/${uid}/`);
  if (url.pathname.endsWith(':commit')) {
    if (!b.writes.every((w) => own(w.update.name))) return fail('PERMISSION_DENIED', 403);
    commits++;
    for (const w of b.writes) {
      clock += 1;
      const fields = { ...w.update.fields };
      for (const tr of w.updateTransforms || []) fields[tr.fieldPath] = { timestampValue: iso(clock) };
      docs.set(w.update.name, { fields, t: clock });
    }
    return json({ commitTime: iso(clock) });
  }
  if (url.pathname.endsWith(':runQuery')) {
    const parent = decodeURIComponent(url.pathname.replace(/^\/v1\//, '').replace(/:runQuery$/, ''));
    if (!parent.endsWith(`/users/${uid}`)) return fail('PERMISSION_DENIED', 403);
    queries++;
    const coll = b.structuredQuery.from[0].collectionId;
    const since = b.structuredQuery.where ? parseIso(b.structuredQuery.where.fieldFilter.value.timestampValue) : -1;
    const readTime = iso(clock);
    const rows = [...docs].filter(([name, d]) => name.startsWith(`${parent}/${coll}/`) && d.t > since).map(([name, d]) => ({ document: { name, fields: d.fields }, readTime }));
    return json(rows.length ? rows : [{ readTime }]);
  }
  return fail('unknown', 404);
}

const CONFIG = `export const CLOUD = { apiKey: 'test-key', projectId: 'demo-proj' };\nexport const cloudConfigured = () => true;`;
const NO_CONFIG = `export const CLOUD = { apiKey: '', projectId: '' };\nexport const cloudConfigured = () => false;`;

async function device(browser, name, { configured = true } = {}) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1, serviceWorkers: 'block' });
  ctx.cfg = configured;
  await ctx.route('**/sluzhinnya/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: ctx.cfg ? CONFIG : NO_CONFIG }));
  await ctx.route(/https:\/\/(identitytoolkit|securetoken|firestore)\.googleapis\.com\/.*/, firebase);
  const page = await ctx.newPage();
  page.ctx = ctx;
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) page.errors.push(`${name} console: ${m.text()}`); });
  return page;
}
const local = (page) => page.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open('sluzhinnya'); q.onsuccess = () => r(q.result); });
  const all = (s) => new Promise((r) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); });
  const kv = await all('kv');
  const st = kv.find((k) => k.key === 'settings')?.value;
  return { entries: (await all('entries')).map((e) => `${e.minutes}m ${e.note}`), terr: (await all('territories')).map((t) => `${t.number} photo:${!!t.photoId}`), photos: (await all('photos')).length, notes: (await all('notes')).map((x) => x.text), goal: st ? `${st.goals?.month}/${st.goalType}` : null };
});
const waitIdle = (page) => page.waitForFunction(() => { const el = document.querySelector('[data-sync-line]'); return el && /Синхронізовано/.test(el.textContent) && !/черзі/.test(el.textContent); }, null, { timeout: 20000 });
const syncNow = async (page) => { await page.goto(APP + '#/settings'); await page.waitForSelector('[data-sync-now]'); await page.click('[data-sync-now]'); await page.waitForTimeout(300); await waitIdle(page); };
const authMsg = (page) => page.textContent('[data-msg]');
async function fillAuth(page, mode, email, pw, pw2 = pw) {
  await page.click(`#auth .seg-item:has(input[value=${mode}]) span`);
  await page.fill('#auth input[name=email]', email);
  await page.fill('#auth input[name=password]', pw);
  if (mode === 'register') await page.fill('#auth input[name=password2]', pw2);
  await page.click('#auth [data-submit]');
  await page.waitForTimeout(700);
}
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };

(async () => {
  const browser = await chromium.launch();

  /* A: the gate shows straight away; register */
  const A = await device(browser, 'A');
  await A.goto(APP);
  await A.waitForSelector('#auth');
  check('gate shown on first open, app hidden', await A.evaluate(() => document.body.classList.contains('is-gated') && getComputedStyle(document.querySelector('.app')).visibility === 'hidden'));
  await A.screenshot({ path: `${SHOTS}/a1-gate-register.png` });
  await fillAuth(A, 'register', 'denys@example.com', 'secret123', 'secret124');
  check('password mismatch message', (await authMsg(A)) === 'Паролі не збігаються');
  await fillAuth(A, 'register', 'denys@example.com', 'short', 'short');
  check('short password message', /8 символів/.test(await authMsg(A)));
  await fillAuth(A, 'register', 'denys@example.com', 'secret123');
  await A.waitForSelector('#auth', { state: 'detached' });
  await A.waitForSelector('.sheet'); // onboarding goal for a brand-new account
  await A.click('.chip[data-v="30"]'); await A.click('form button[type=submit]'); await A.waitForTimeout(400);
  await A.click('[data-add-hours]'); await A.click('.chip[data-set="120"]'); await A.fill('textarea[name=note]', 'З групою'); await A.click('.sheet form button[type=submit]'); await A.waitForTimeout(400);
  await A.goto(APP + '#/territories'); await A.click('[data-add]'); await A.fill('.sheet input[name=number]', '14');
  await A.setInputFiles('.sheet [data-file]', MAP); await A.waitForSelector('.photo-pick-empty.has-img img'); await A.click('.sheet form button[type=submit]'); await A.waitForTimeout(400);
  await A.goto(APP + '#/note/new'); await A.waitForSelector('.editor'); await A.fill('.editor', 'Повторні відвідини\nОлена, кв. 5'); await A.waitForTimeout(700);
  await syncNow(A);
  await A.screenshot({ path: `${SHOTS}/a2-settings-account.png` });
  check('cloud has entry, note, territory, goal, photo', docs.size === 5);

  /* B: second phone logs in */
  const B = await device(browser, 'B');
  await B.goto(APP);
  await B.waitForSelector('#auth');
  await fillAuth(B, 'register', 'denys@example.com', 'whatever1');
  check('register with existing email → message', /уже зареєстровано/.test(await authMsg(B)));
  await fillAuth(B, 'login', 'denys@example.com', 'wrongpass');
  check('wrong password → message', (await authMsg(B)) === 'Неправильний email або пароль');
  await B.screenshot({ path: `${SHOTS}/b1-gate-login-error.png` });
  await fillAuth(B, 'login', 'denys@example.com', 'secret123');
  await B.waitForSelector('#auth', { state: 'detached' });
  await B.waitForTimeout(600);
  check('no onboarding on B (goal came from the account)', !(await B.$('.sheet')));
  const b = await local(B);
  check(`B got A's data ${JSON.stringify(b)}`, b.entries[0] === '120m З групою' && b.terr[0] === '14 photo:true' && b.photos === 1 && b.notes.length === 1 && b.goal === '30/month');
  await B.screenshot({ path: `${SHOTS}/b2-home.png` });

  /* B edits → A receives */
  await B.click('[data-edit]'); await B.click('.sheet [data-del]'); await B.click('.sheet [data-ok]'); await B.waitForTimeout(400);
  await B.goto(APP + '#/notes'); await B.click('.note-card'); await B.waitForSelector('.editor'); await B.fill('.editor', 'Повторні відвідини\nОлена, кв. 5 — субота'); await B.waitForTimeout(700);
  await syncNow(B); await syncNow(A);
  const a = await local(A);
  check('A sees deletion + edited note', a.entries.length === 0 && a.notes[0].endsWith('субота'));

  /* Password reset request */
  const C = await device(browser, 'C');
  await C.goto(APP); await C.waitForSelector('#auth');
  await C.click('#auth .seg-item:has(input[value=login]) span'); await C.click('[data-forgot]');
  await C.fill('#auth input[name=email]', 'denys@example.com'); await C.click('#auth [data-submit]'); await C.waitForTimeout(500);
  check('reset email sent', resets === 1 && /надіслали лист/.test(await authMsg(C)));
  await C.screenshot({ path: `${SHOTS}/c1-reset.png` });

  /* Session revoked on A (e.g. password changed) → gate again, local data kept */
  await A.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('sluzhinnya'); q.onsuccess = () => r(q.result); });
    const s = await new Promise((r) => { const q = db.transaction('kv').objectStore('kv').get('cloud'); q.onsuccess = () => r(q.result.value); });
    s.expiresAt = 0;
    await new Promise((r) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put({ key: 'cloud', value: s }); t.oncomplete = r; });
    window.__rt = s.refreshToken;
  });
  revoked.add(await A.evaluate(() => window.__rt));
  await A.reload();
  await A.waitForSelector('#auth', { timeout: 10000 });
  check('revoked session → sign-in screen with reason', /Сеанс завершився/.test(await A.textContent('.auth-sub')) && (await A.inputValue('#auth input[name=email]')) === 'denys@example.com');
  await fillAuth(A, 'login', 'denys@example.com', 'secret123');
  await A.waitForSelector('#auth', { state: 'detached' });
  check('A data still there after re-login', (await local(A)).notes.length === 1);

  /* Sign out on B → data removed from the phone, gate shown */
  await B.goto(APP + '#/settings'); await B.click('[data-signout]'); await B.click('.sheet [data-ok]');
  await B.waitForSelector('#auth');
  const bOut = await local(B);
  check('sign-out wipes phone and shows gate', bOut.entries.length === 0 && bOut.notes.length === 0 && bOut.photos === 0);

  /* D: someone who used the app before accounts existed → data moves into the new account */
  const D = await device(browser, 'D', { configured: false });
  await D.goto(APP); await D.waitForSelector('.sheet'); await D.keyboard.press('Escape'); await D.waitForTimeout(300);
  check('no gate while accounts are not configured', !(await D.$('#auth')));
  await D.click('[data-add-hours]'); await D.click('.chip[data-set="90"]'); await D.click('.sheet form button[type=submit]'); await D.waitForTimeout(400);
  D.ctx.cfg = true;
  await D.reload(); await D.waitForSelector('#auth');
  await fillAuth(D, 'register', 'olena@example.com', 'password9');
  await D.waitForSelector('#auth', { state: 'detached' });
  await D.waitForTimeout(800);
  const dDocs = [...docs.keys()].filter((k) => k.includes('/users/uid-2/records/entries_'));
  check('pre-account hours uploaded into the new account', dDocs.length === 1);
  check('accounts are isolated (uid-2 has no access to uid-1 docs)', ![...docs.keys()].some((k) => k.includes('/users/uid-2/') && k.includes('territories')));

  console.log(`requests: commits ${commits}, queries ${queries}, refreshes ${refreshes}`);
  const errs = [A, B, C, D].flatMap((p) => p.errors);
  check(`no page errors ${errs.join(' | ')}`, errs.length === 0);
  await browser.close();
})().catch((e) => { console.error('TEST CRASHED', e); process.exit(1); });

// Optional PIN lock. The PIN itself is never stored — only a salted PBKDF2 hash.
// Wrong attempts trigger growing lockouts (persisted, so reloading does not reset them).
import { db } from './db.js';
import { $, html, mount, haptic } from './util.js';
import { icon } from './icons.js';

const ITER = 210000;
const LEN = 4;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin, salt, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return b64(bits);
}

function sameHash(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const hasPin = async () => !!(await db.getKV('pin'));

export async function setPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await db.setKV('pin', { salt: b64(salt), hash: await derive(pin, salt, ITER), iter: ITER });
  await db.setKV('lockout', { fails: 0, until: 0 });
}

export const removePin = () => db.setKV('pin', null);

export async function verifyPin(pin) {
  const p = await db.getKV('pin');
  if (!p) return true;
  return sameHash(await derive(pin, unb64(p.salt), p.iter || ITER), p.hash);
}

async function lockoutState() {
  return (await db.getKV('lockout')) || { fails: 0, until: 0 };
}

async function registerFail() {
  const s = await lockoutState();
  s.fails += 1;
  if (s.fails >= 5) s.until = Date.now() + 30000 * 2 ** Math.min(6, s.fails - 5); // 30 s, 1 min, 2 min … 32 min
  await db.setKV('lockout', s);
  return s;
}

/* ---------- keypad UI ---------- */

export function pinPad(container, { title, subtitle = '', onComplete }) {
  let value = '';
  mount(container, html`
    <div class="pin">
      <div class="pin-logo">${icon('lock')}</div>
      <h2 class="pin-title" data-title>${title}</h2>
      <p class="pin-sub" data-sub>${subtitle}</p>
      <div class="pin-dots" data-dots>${Array.from({ length: LEN }, () => html`<i></i>`)}</div>
      <div class="pin-pad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => html`<button type="button" class="pin-key" data-n="${n}">${n}</button>`)}
        <span></span>
        <button type="button" class="pin-key" data-n="0">0</button>
        <button type="button" class="pin-key pin-key-fn" data-back aria-label="Стерти">${icon('backspace')}</button>
      </div>
      <div class="pin-extra" data-extra></div>
    </div>`);
  const dots = $('[data-dots]', container);
  let busy = false;
  const draw = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i < value.length));
  const api = {
    reset() { value = ''; draw(); },
    shake() {
      dots.classList.remove('shake');
      void dots.offsetWidth;
      dots.classList.add('shake');
      haptic([30, 40, 30]);
    },
    setTitle(t) { $('[data-title]', container).textContent = t; },
    setSub(t, warn = false) { const s = $('[data-sub]', container); s.textContent = t; s.classList.toggle('is-warn', warn); },
    setBusy(b) { busy = b; container.classList.toggle('is-busy', b); },
    extra: $('[data-extra]', container),
  };
  const press = async (n) => {
    if (busy) return;
    if (n === 'back') value = value.slice(0, -1);
    else if (value.length < LEN) value += n;
    haptic(6);
    draw();
    if (value.length === LEN) {
      const v = value;
      busy = true;
      setTimeout(async () => { await onComplete(v, api); busy = false; }, 90);
    }
  };
  container.addEventListener('click', (e) => {
    const k = e.target.closest('[data-n]');
    if (k) press(k.dataset.n);
    if (e.target.closest('[data-back]')) press('back');
  });
  const onKey = (e) => {
    if (!container.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (/^\d$/.test(e.key)) press(e.key);
    if (e.key === 'Backspace') press('back');
  };
  document.addEventListener('keydown', onKey);
  return api;
}

/* ---------- lock screen ---------- */

let locked = false;
export const isLocked = () => locked;

/** First launch: the PIN is created here (the app's "registration"). */
export function showPinSetup() {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.id = 'pinsetup';
    el.className = 'lock';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Створення PIN-коду');
    document.body.append(el);
    document.body.classList.add('is-locked');
    const intro = 'Запамʼятайте — відновити неможливо';
    let first = null;
    pinPad(el, {
      title: 'Новий PIN',
      subtitle: intro,
      async onComplete(p, api) {
        if (!first) { first = p; api.reset(); api.setTitle('Ще раз'); api.setSub(''); return; }
        if (p !== first) { first = null; api.shake(); api.reset(); api.setTitle('Новий PIN'); api.setSub('Не збігся', true); return; }
        api.setBusy(true);
        await setPin(p);
        haptic(15);
        el.classList.add('unlocking');
        document.body.classList.remove('is-locked');
        setTimeout(() => el.remove(), 260);
        resolve();
      },
    });
  });
}

export function showLock({ onWipe } = {}) {
  if (locked || $('#lock')) return Promise.resolve();
  locked = true;
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.id = 'lock';
    el.className = 'lock';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Застосунок заблоковано');
    document.body.append(el);
    document.body.classList.add('is-locked');
    let timer;

    const pad = pinPad(el, {
      title: 'PIN',
      subtitle: '',
      async onComplete(pin, api) {
        const lo = await lockoutState();
        if (lo.until > Date.now()) { api.reset(); return; }
        api.setBusy(true);
        const ok = await verifyPin(pin);
        api.setBusy(false);
        if (ok) {
          await db.setKV('lockout', { fails: 0, until: 0 });
          haptic(12);
          el.classList.add('unlocking');
          document.body.classList.remove('is-locked');
          setTimeout(() => el.remove(), 260);
          locked = false;
          clearInterval(timer);
          resolve();
          return;
        }
        const s = await registerFail();
        api.shake();
        api.reset();
        if (s.until > Date.now()) countdown();
        else api.setSub(`Неправильно · ще ${5 - s.fails}`, true);
      },
    });

    const countdown = async () => {
      clearInterval(timer);
      const tick = async () => {
        const s = await lockoutState();
        const left = Math.ceil((s.until - Date.now()) / 1000);
        if (left <= 0) { clearInterval(timer); el.classList.remove('is-wait'); pad.setSub(''); return; }
        el.classList.add('is-wait');
        pad.setSub(`Зачекайте ${left >= 60 ? `${Math.ceil(left / 60)} хв` : `${left} с`}`, true);
      };
      await tick();
      timer = setInterval(tick, 1000);
    };
    lockoutState().then((s) => { if (s.until > Date.now()) countdown(); });

    if (onWipe) {
      mount(pad.extra, html`<button type="button" class="link link-muted" data-forgot>Забули PIN?</button>`);
      pad.extra.addEventListener('click', async (e) => {
        if (!e.target.closest('[data-forgot]')) return;
        const msg = 'PIN не зберігається у відкритому вигляді, тож відновити його неможливо. Можна лише видалити ВСІ дані на цьому пристрої та почати спочатку (потім їх можна повернути з резервної копії). Видалити все?';
        if (window.confirm(msg) && window.confirm('Точно? Години, території, фото і нотатки буде стерто назавжди.')) {
          await onWipe();
        }
      });
    }
  });
}

// Boot, routing, tab bar, lock handling, service worker.
import { load, state, subscribe } from './store.js';
import { $, $$, html, mount, haptic } from './util.js';
import { icon } from './icons.js';
import * as home from './views/home.js';
import * as calendar from './views/calendar.js';
import * as terr from './views/territories.js';
import * as notes from './views/notes.js';
import * as settings from './views/settings.js';
import { closeAllOverlays, toast } from './ui.js';
import { hasPin, showLock, isLocked } from './lock.js';
import { openEntrySheet } from './entry-sheet.js';
import { openGoalSheet } from './goal-sheet.js';
import { scheduleInApp, registerPeriodic, notifPermission } from './reminders.js';
import { wipeAll } from './backup.js';
import { applyTheme } from './theme.js';

// Refuse to run inside someone else's frame (clickjacking).
if (window.top !== window.self) {
  document.documentElement.hidden = true;
  throw new Error('framed');
}

const routes = {
  home: { tab: 'home', render: home.render },
  calendar: { tab: 'calendar', render: calendar.render },
  territories: { tab: 'territories', render: terr.renderList },
  territory: { tab: 'territories', render: terr.renderDetail },
  notes: { tab: 'notes', render: notes.renderList },
  note: { tab: 'notes', render: notes.renderEditor },
  settings: { tab: 'home', render: settings.render },
};

const TABS = [
  ['home', 'Головна', 'home'],
  ['calendar', 'Календар', 'calendar'],
  ['add'],
  ['territories', 'Території', 'map'],
  ['notes', 'Нотатки', 'note'],
];

let cleanup = null;
let currentKey = '';
let rendering = Promise.resolve();

function parseHash() {
  const [name = 'home', ...params] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  return { name: routes[name] ? name : 'home', params };
}

function render({ keepScroll = false } = {}) {
  rendering = rendering.then(async () => {
    const { name, params } = parseHash();
    const r = routes[name];
    if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
    const view = $('#view');
    const key = `${name}/${params.join('/')}`;
    const changed = key !== currentKey;
    currentKey = key;
    view.dataset.route = name;
    try {
      const res = await r.render(view, params);
      cleanup = typeof res === 'function' ? res : null;
    } catch (e) {
      console.error(e);
      mount(view, html`<div class="empty"><h3>Щось пішло не так</h3><p>${String(e.message || e)}</p><a class="btn" href="#/home">На головну</a></div>`);
    }
    $$('.tab', $('#tabbar')).forEach((t) => t.classList.toggle('on', t.dataset.tab === r.tab));
    if (changed && !keepScroll) window.scrollTo(0, 0);
    if (changed) { view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter'); }
  });
  return rendering;
}

function renderTabs() {
  mount($('#tabbar'), html`${TABS.map(([k, label, ic]) => (k === 'add'
    ? html`<button type="button" class="tab-add" data-add-hours aria-label="Додати години">${icon('plus')}</button>`
    : html`<a class="tab" href="#/${k}" data-tab="${k}">${icon(ic)}<span>${label}</span></a>`))}`);
  $('#tabbar').addEventListener('click', (e) => {
    if (e.target.closest('[data-add-hours]')) {
      haptic(10);
      const sel = parseHash();
      openEntrySheet({ date: sel.name === 'calendar' && sel.params[0] ? sel.params[0] : undefined });
    } else if (e.target.closest('.tab')) haptic(6);
  });
}

/* ---------- lock ---------- */

let pinOn = false;
let hiddenAt = 0;
const lock = () => { closeAllOverlays(); return showLock({ onWipe: async () => { await wipeAll(); location.reload(); } }); };

document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    pinOn = await hasPin();
    if (pinOn && state.settings.autoLock === 0 && !isLocked()) lock();
    return;
  }
  if (pinOn && !isLocked() && Date.now() - hiddenAt >= state.settings.autoLock * 60000) lock();
  scheduleInApp();
  if (['home', 'calendar'].includes(parseHash().name)) render({ keepScroll: true }); // the date may have changed
});

/* ---------- service worker ---------- */

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js', { scope: './' }).then((reg) => {
    const offer = (w) => toast('Доступна нова версія', { action: 'Оновити', ms: 15000, onAction: () => w.postMessage('skipWaiting') });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch((e) => console.warn('SW', e));
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

/* ---------- boot ---------- */

async function boot() {
  try {
    await load();
  } catch (e) {
    mount($('#view'), html`<div class="empty"><h3>Не вдалося відкрити сховище</h3><p>Можливо, увімкнено приватний режим браузера. ${String(e.message || e)}</p></div>`);
    return;
  }
  applyTheme();
  renderTabs();
  pinOn = await hasPin();
  if (pinOn) lock();

  let queued = false;
  subscribe(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; render({ keepScroll: true }); });
  });
  window.addEventListener('hashchange', () => render());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

  await render();
  document.body.classList.add('ready');

  if (pinOn) await new Promise((res) => { const iv = setInterval(() => { if (!isLocked()) { clearInterval(iv); res(); } }, 150); });

  const params = new URLSearchParams(location.search);
  if (params.get('action') === 'add') openEntrySheet();
  else if (!state.settings.onboarded) setTimeout(() => openGoalSheet({ first: true }), 350);
  if (params.has('action')) history.replaceState(null, '', location.pathname + location.hash);

  navigator.storage?.persist?.().catch(() => {});
  registerSW();
  scheduleInApp();
  if (state.settings.reminder.enabled && notifPermission() === 'granted') registerPeriodic();
}

boot();

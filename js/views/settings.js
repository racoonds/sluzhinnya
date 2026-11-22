// Settings: Google account sync, goal, reminders, PIN, backup, theme, privacy info.
import { $, $$, html, mount, haptic, bytes, fmtHM, isStandalone, plural } from '../util.js';

const n = (x, forms) => `${x} ${plural(x, forms)}`;
import { icon } from '../icons.js';
import { state, saveSettings } from '../store.js';
import { goalPeriod, goalMinutes } from '../stats.js';
import { openSheet, confirmDialog, toast, segmented } from '../ui.js';
import { openGoalSheet } from '../goal-sheet.js';
import { pinPad, hasPin, setPin, removePin, verifyPin } from '../lock.js';
import {
  downloadICS, enableNotifications, notifPermission, notifSupported, showNotification, reminderText,
  registerPeriodic, unregisterPeriodic, scheduleInApp,
} from '../reminders.js';
import { exportBackup, parseBackup, importBackup, wipeAll } from '../backup.js';
import { installable, install } from '../install.js';
import { db } from '../db.js';
import { WD_SHORT, fmtDate, toKey } from '../dates.js';
import { applyTheme, APP_VERSION } from '../theme.js';
import { cloudConfigured, isSignedIn, signIn, signOut, syncNow, syncStatus } from '../sync.js';

const GOAL_NAME = { month: 'на місяць', year: 'на службовий рік', custom: 'на свій період' };

export async function render(root) {
  const s = state.settings;
  const r = s.reminder;
  const pin = await hasPin();
  const perm = notifPermission();
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const lastBackup = await db.getKV('lastBackup');
  const per = goalPeriod(s);
  const st = syncStatus();

  mount(root, html`
    <header class="top top-back">
      <a class="icon-btn" href="#/home" aria-label="Назад">${icon('left')}</a>
      <div class="top-title"><div class="eyebrow">Служіння</div><h1>Налаштування</h1></div>
    </header>

    <h3 class="group-title">Акаунт</h3>
    ${!cloudConfigured() ? html`
    <div class="group">
      <div class="group-row is-dim">
        <span class="gr-ic">${icon('cloud')}</span>
        <span class="gr-main"><b>Вхід через Google</b><span>Ще не налаштовано (потрібне одноразове налаштування Firebase)</span></span>
      </div>
    </div>` : !st.signedIn ? html`
    <div class="group">
      <button type="button" class="group-row" data-signin>
        <span class="gr-ic gr-ic-accent">${icon('cloud')}</span>
        <span class="gr-main"><b>Увійти через Google</b><span>Дані збережуться у вашому акаунті й зʼявляться на інших пристроях</span></span>
        ${icon('right', 'gr-chev')}
      </button>
    </div>
    <p class="group-hint">Без входу все працює як раніше — дані лише на цьому телефоні.</p>` : html`
    <div class="group">
      <div class="group-row">
        <span class="avatar">${(st.name || st.email || '?').trim().charAt(0).toUpperCase()}</span>
        <span class="gr-main"><b>${st.name || 'Google-акаунт'}</b><span>${st.email}</span></span>
      </div>
      ${st.state === 'relogin' ? html`
      <button type="button" class="group-row" data-signin>
        <span class="gr-ic gr-ic-warn">${icon('cloudOff')}</span>
        <span class="gr-main"><b>Увійти ще раз</b><span>Сеанс завершився — зміни зберігаються на телефоні й надішлються після входу</span></span>
        ${icon('right', 'gr-chev')}
      </button>` : html`
      <button type="button" class="group-row" data-sync-now>
        <span class="gr-ic" data-sync-ic>${icon(syncIcon(st.state))}</span>
        <span class="gr-main"><b>Синхронізація</b><span data-sync-line>${syncLine(st)}</span></span>
        <span class="gr-act ${st.state === 'syncing' ? 'is-spin' : ''}" data-sync-spin>${icon('refresh')}</span>
      </button>`}
      <button type="button" class="group-row" data-signout>
        <span class="gr-ic">${icon('logout')}</span>
        <span class="gr-main"><b>Вийти з акаунта</b><span>Дані на цьому телефоні залишаться</span></span>
      </button>
    </div>`}

    <h3 class="group-title">Ціль</h3>
    <div class="group">
      <button type="button" class="group-row" data-goal>
        <span class="gr-ic">${icon('target')}</span>
        <span class="gr-main"><b>${fmtHM(goalMinutes(s))} ${GOAL_NAME[s.goalType]}</b><span>${per.label}</span></span>
        ${icon('right', 'gr-chev')}
      </button>
    </div>

    <h3 class="group-title">Нагадування</h3>
    <div class="group">
      <label class="group-row">
        <span class="gr-ic">${icon('bell')}</span>
        <span class="gr-main"><b>Нагадувати вносити години</b><span>Якщо за день ще нічого не внесено</span></span>
        <span class="switch"><input type="checkbox" role="switch" data-rem ${r.enabled ? html`checked` : ''}><i></i></span>
      </label>
      <div class="group-row ${r.enabled ? '' : 'is-dim'}">
        <span class="gr-ic">${icon('clock')}</span>
        <span class="gr-main"><b>Час</b></span>
        <input type="time" class="time-in" value="${r.time}" data-time ${r.enabled ? '' : html`disabled`}>
      </div>
      <div class="group-row group-row-col ${r.enabled ? '' : 'is-dim'}">
        <span class="gr-label">Дні</span>
        <div class="days">${WD_SHORT.map((w, i) => html`<button type="button" class="day-chip ${r.days.includes(i) ? 'on' : ''}" data-dayc="${i}" ${r.enabled ? '' : html`disabled`}>${w}</button>`)}</div>
      </div>
      <label class="group-row ${r.enabled ? '' : 'is-dim'}">
        <span class="gr-ic">${icon('flag')}</span>
        <span class="gr-main"><b>План на вихідні</b><span>У суботу о 10:00 — перевірити тижневу норму</span></span>
        <span class="switch"><input type="checkbox" role="switch" data-weekly ${r.weekly ? html`checked` : ''} ${r.enabled ? '' : html`disabled`}><i></i></span>
      </label>
    </div>
    ${r.enabled ? html`
    <div class="group">
      <button type="button" class="group-row" data-ics>
        <span class="gr-ic gr-ic-accent">${icon('calendar')}</span>
        <span class="gr-main"><b>Додати в календар телефону</b><span>Найнадійніше: працює на iPhone і Android, навіть коли застосунок закрито</span></span>
        ${icon('download', 'gr-chev')}
      </button>
      <button type="button" class="group-row" data-notif>
        <span class="gr-ic">${icon('bell')}</span>
        <span class="gr-main"><b>Сповіщення від застосунку</b><span>${notifLabel(perm)}</span></span>
        ${perm === 'granted' ? html`<span class="pill pill-good">Увімкнено</span>` : icon('right', 'gr-chev')}
      </button>
      ${perm === 'granted' ? html`
      <button type="button" class="group-row" data-test>
        <span class="gr-ic">${icon('sparkle')}</span>
        <span class="gr-main"><b>Надіслати тестове сповіщення</b></span>
      </button>` : ''}
    </div>
    <p class="group-hint">Застосунок не має сервера (тому ваші дані нікуди не передаються), а без сервера браузер не може гарантовано будити застосунок у точний час. Тому найкраще — додати нагадування в календар телефону. На головному екрані також зʼявиться підказка, якщо за день нічого не внесено.</p>` : ''}

    <h3 class="group-title">Захист</h3>
    <div class="group">
      <button type="button" class="group-row" data-pin>
        <span class="gr-ic">${icon('lock')}</span>
        <span class="gr-main"><b>${pin ? 'PIN-код увімкнено' : 'Увімкнути PIN-код'}</b><span>${pin ? 'Змінити або вимкнути' : 'Запитувати PIN при відкритті'}</span></span>
        ${pin ? html`<span class="pill pill-good">Увімкнено</span>` : icon('right', 'gr-chev')}
      </button>
      ${pin ? html`
      <div class="group-row group-row-col">
        <span class="gr-label">Блокувати після виходу з застосунку</span>
        ${segmented('autolock', [['0', 'Одразу'], ['1', 'Через 1 хв'], ['5', 'Через 5 хв']], String(s.autoLock))}
      </div>` : ''}
    </div>
    <div class="privacy card">
      <div class="privacy-head">${icon('shield')}<b>Як захищені ваші дані</b></div>
      <ul>
        <li><b>Без входу все зберігається лише на цьому телефоні.</b> Немає нашого сервера чи спільної бази — нічого «злити».</li>
        <li><b>З входом через Google</b> копія зберігається у вашому власному проєкті Firebase. Правила безпеки дозволяють читати й змінювати її лише вашому Google-акаунту, а зʼєднання завжди зашифроване.</li>
        <li><b>Атаки DDoS не страшні.</b> Сторінка — це статичні файли на CDN GitHub Pages, а встановлений застосунок працює навіть без інтернету.</li>
        <li><b>Жодних сторонніх скриптів, аналітики чи шрифтів з інтернету.</b> Сувора політика безпеки (CSP) дозволяє звертатися лише до сервісів входу та бази Google.</li>
        <li><b>Фото очищаються від метаданих</b> (зокрема GPS) під час збереження.</li>
        <li><b>PIN</b> зберігається лише як криптографічний хеш, а після 5 помилок вмикається пауза, що зростає.</li>
      </ul>
    </div>

    <h3 class="group-title">Дані</h3>
    <div class="group">
      <button type="button" class="group-row" data-export>
        <span class="gr-ic">${icon('download')}</span>
        <span class="gr-main"><b>Зберегти резервну копію</b><span>${lastBackup ? `Остання: ${fmtDate(toKey(new Date(lastBackup)), { year: true })}` : 'Файл з усіма даними та фото'}</span></span>
      </button>
      <label class="group-row">
        <span class="gr-ic">${icon('upload')}</span>
        <span class="gr-main"><b>Відновити з копії</b><span>Замінить поточні дані</span></span>
        <input type="file" accept="application/json,.json" hidden data-import>
      </label>
      <div class="group-row">
        <span class="gr-ic">${icon('phone')}</span>
        <span class="gr-main"><b>Місце на пристрої</b><span>${est ? `Використано ${bytes(est.usage || 0)}` : 'Невідомо'} · ${persisted ? 'захищено від автоочищення' : 'браузер може очистити при нестачі місця'}</span></span>
      </div>
    </div>
    <p class="group-hint">Порада: раз на місяць зберігайте копію (напр. у «Файли» чи Google Диск). Якщо телефон загубиться або браузер очистить дані — ви все відновите.</p>

    <h3 class="group-title">Вигляд</h3>
    <div class="group">
      <div class="group-row group-row-col">
        ${segmented('theme', [['system', 'Як у системі'], ['dark', 'Темна'], ['light', 'Світла']], s.theme)}
      </div>
    </div>

    ${installable() ? html`
    <h3 class="group-title">Встановлення</h3>
    <div class="group">
      <button type="button" class="group-row" data-install>
        <span class="gr-ic gr-ic-accent">${icon('phone')}</span>
        <span class="gr-main"><b>Додати на головний екран</b><span>Як звичайний застосунок, працює офлайн</span></span>
        ${icon('right', 'gr-chev')}
      </button>
    </div>` : ''}

    <div class="group group-danger">
      <button type="button" class="group-row" data-wipe>
        <span class="gr-ic">${icon('trash')}</span>
        <span class="gr-main"><b>Видалити всі дані</b><span>Години, території, фото, нотатки</span></span>
      </button>
    </div>
    <p class="version">Служіння · версія ${APP_VERSION}${isStandalone() ? ' · встановлено' : ''}</p>
  `);

  const rerender = () => render(root);
  const saveRem = async (patch) => {
    await saveSettings({ reminder: { ...state.settings.reminder, ...patch } });
    scheduleInApp();
  };

  $('[data-rem]', root).addEventListener('change', async (e) => {
    haptic();
    await saveRem({ enabled: e.target.checked });
    if (e.target.checked) { if (notifPermission() === 'granted') registerPeriodic(); } else unregisterPeriodic();
    rerender();
  });
  $('[data-time]', root).addEventListener('change', (e) => { if (/^\d{2}:\d{2}$/.test(e.target.value)) saveRem({ time: e.target.value }); });
  $('[data-weekly]', root).addEventListener('change', (e) => saveRem({ weekly: e.target.checked }));
  $$('input[name=autolock]', root).forEach((i) => i.addEventListener('change', () => saveSettings({ autoLock: Number(i.value) })));
  $$('input[name=theme]', root).forEach((i) => i.addEventListener('change', async () => { await saveSettings({ theme: i.value }); applyTheme(); }));

  $('[data-import]', root).addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = parseBackup(await file.text());
      const ok = await confirmDialog(
        `У копії: ${n(parsed.entries.length, ['запис', 'записи', 'записів'])} годин, ${n(parsed.territories.length, ['територія', 'території', 'територій'])}, ${n(parsed.notes.length, ['нотатка', 'нотатки', 'нотаток'])}, ${parsed.photos.length} фото. Поточні дані буде замінено.`,
        { title: 'Відновити з копії?', ok: 'Відновити' },
      );
      if (!ok) return;
      await importBackup(parsed);
      toast('Дані відновлено');
      rerender();
    } catch (err) { toast(err.message, { kind: 'warn', ms: 5000 }); }
  });

  const onSync = (ev) => {
    const d = ev.detail;
    if (d.signedIn !== st.signedIn || (d.state === 'relogin') !== (st.state === 'relogin')) { rerender(); return; }
    const line = $('[data-sync-line]', root);
    if (line) line.textContent = syncLine(d);
    const ic = $('[data-sync-ic]', root);
    if (ic) mount(ic, icon(syncIcon(d.state)));
    $('[data-sync-spin]', root)?.classList.toggle('is-spin', d.state === 'syncing');
  };
  window.addEventListener('sync-status', onSync);
  const tick = setInterval(() => { const line = $('[data-sync-line]', root); if (line) line.textContent = syncLine(syncStatus()); }, 30000);

  root.onclick = async (e) => {
    const t = e.target;
    if (t.closest('[data-signin]')) {
      try { await signIn(); } catch (err) { toast(err.message, { kind: 'warn' }); }
      return;
    }
    if (t.closest('[data-sync-now]')) { haptic(); syncNow(); return; }
    if (t.closest('[data-signout]')) {
      if (!(await confirmDialog('Синхронізацію буде вимкнено. Дані на цьому телефоні та копія в Google-акаунті залишаться.', { title: 'Вийти з акаунта?', ok: 'Вийти', danger: false }))) return;
      await signOut();
      toast('Ви вийшли з акаунта');
      return rerender();
    }
    if (t.closest('[data-goal]')) return openGoalSheet();
    const dc = t.closest('[data-dayc]');
    if (dc) {
      const i = Number(dc.dataset.dayc);
      const days = new Set(state.settings.reminder.days);
      if (days.has(i)) { if (days.size > 1) days.delete(i); } else days.add(i);
      haptic();
      await saveRem({ days: [...days].sort() });
      return rerender();
    }
    if (t.closest('[data-ics]')) {
      const res = await downloadICS();
      if (res !== 'aborted') {
        openSheet({
          title: 'Як додати в календар',
          className: 'sheet-compact',
          body: html`<ol class="steps">
            <li><span class="step-n">1</span><div>Відкрийте завантажений файл <b>sluzhinnya-nagaduvannya.ics</b> (у «Завантаженнях» / «Файлах» або через щойно відкрите меню).</div></li>
            <li><span class="step-n">2</span><div>Оберіть <b>Календар</b> → <b>«Додати все»</b>.</div></li>
            <li><span class="step-n">3</span><div>Готово — телефон нагадуватиме о ${state.settings.reminder.time}. Змінили час чи дні — додайте файл ще раз, а старі події видаліть.</div></li>
          </ol>`,
        });
      }
      return;
    }
    if (t.closest('[data-notif]')) {
      if (notifPermission() === 'granted') { toast('Сповіщення вже увімкнено'); return; }
      if (!notifSupported()) { toast(isStandaloneHint(), { ms: 6000 }); return; }
      const res = await enableNotifications();
      if (res.ok) { toast(res.periodic ? 'Сповіщення увімкнено' : 'Сповіщення увімкнено (поки застосунок відкритий)'); scheduleInApp(); } else if (res.reason === 'denied') toast('Сповіщення заборонено в налаштуваннях браузера', { kind: 'warn', ms: 5000 });
      return rerender();
    }
    if (t.closest('[data-test]')) { await showNotification('Служіння', reminderText()); return; }
    if (t.closest('[data-pin]')) return pinFlow(await hasPin(), rerender);
    if (t.closest('[data-export]')) {
      try { const r2 = await exportBackup(); if (r2 !== 'aborted') { toast('Резервну копію збережено'); rerender(); } } catch (err) { toast(`Помилка: ${err.message}`, { kind: 'warn' }); }
      return;
    }
    if (t.closest('[data-install]')) return install();
    if (t.closest('[data-wipe]')) {
      if (!(await confirmDialog(`Буде видалено всі години, території, фото та нотатки на цьому пристрої${isSignedIn() ? ' і виконано вихід з акаунта (копія в Google-акаунті залишиться)' : ''}. Радимо спершу зберегти резервну копію.`, { title: 'Видалити всі дані?', ok: 'Видалити все' }))) return;
      if (!(await confirmDialog('Це остаточно. Продовжити?', { title: 'Точно?', ok: 'Так, видалити' }))) return;
      await wipeAll();
      toast('Усі дані видалено');
      location.hash = '#/home';
    }
  };
  return () => { root.onclick = null; window.removeEventListener('sync-status', onSync); clearInterval(tick); };
}

export function syncIcon(state) {
  return state === 'offline' || state === 'error' || state === 'relogin' ? 'cloudOff' : state === 'syncing' ? 'cloud' : 'cloudCheck';
}

function ago(t) {
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 45) return 'щойно';
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} хв тому`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} год тому`;
  return fmtDate(toKey(new Date(t)));
}

export function syncLine(st) {
  if (st.state === 'syncing') return 'Синхронізація…';
  if (st.state === 'offline') return 'Немає інтернету — синхронізую, щойно зʼявиться';
  if (st.state === 'relogin') return 'Сеанс завершився — увійдіть ще раз';
  if (st.state === 'error') return `Не вдалося: ${st.error}. Спробую пізніше`;
  const p = st.pending ? ` · змін у черзі: ${st.pending}` : '';
  return st.at ? `Синхронізовано ${ago(st.at)}${p}` : `Ще не синхронізовано${p}`;
}

function notifLabel(perm) {
  if (perm === 'granted') return 'Нагадування, поки застосунок встановлено (Android) або відкрито';
  if (perm === 'denied') return 'Заборонено — увімкніть у налаштуваннях браузера';
  if (perm === 'unsupported') return isStandaloneHint();
  return 'Дозволити сповіщення';
}
function isStandaloneHint() {
  return isStandalone() ? 'Цей браузер не підтримує сповіщення' : 'На iPhone сповіщення доступні після додавання на головний екран';
}

function pinFlow(enabled, done) {
  openSheet({
    title: enabled ? 'PIN-код' : 'Новий PIN-код',
    className: 'sheet-pin',
    body: html`<div data-pad></div>`,
    onMount(el, close) {
      const box = $('[data-pad]', el);
      if (!enabled) return createPin(box, close, done);
      pinPad(box, {
        title: 'Поточний PIN',
        subtitle: 'Щоб змінити або вимкнути',
        async onComplete(p, api) {
          api.setBusy(true);
          const ok = await verifyPin(p);
          api.setBusy(false);
          if (!ok) { api.shake(); api.reset(); api.setSub('Неправильний PIN', true); return; }
          mount(box, html`
            <div class="pin-choice">
              <button type="button" class="btn btn-block" data-change>${icon('edit')}Змінити PIN</button>
              <button type="button" class="btn btn-block btn-ghost-danger" data-off>${icon('x')}Вимкнути PIN</button>
            </div>`);
          $('[data-change]', box).addEventListener('click', () => createPin(box, close, done));
          $('[data-off]', box).addEventListener('click', async () => { await removePin(); close(); toast('PIN вимкнено'); done(); });
        },
      });
    },
  });
}

function createPin(box, close, done) {
  let first = null;
  pinPad(box, {
    title: 'Придумайте PIN',
    subtitle: '4 цифри. Запамʼятайте його — відновити неможливо.',
    async onComplete(p, api) {
      if (!first) { first = p; api.reset(); api.setTitle('Повторіть PIN'); api.setSub(''); return; }
      if (p !== first) { first = null; api.shake(); api.reset(); api.setTitle('Придумайте PIN'); api.setSub('PIN не збігся, спробуйте ще раз', true); return; }
      api.setBusy(true);
      await setPin(p);
      haptic(15);
      close();
      toast('PIN-код увімкнено');
      done();
    },
  });
}

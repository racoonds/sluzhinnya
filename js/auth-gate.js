// Full-screen "Sign in / Create account" gate shown before the app when accounts are enabled.
import { $, $$, html, mount, haptic } from './util.js';
import { icon } from './icons.js';
import { login, register, resetPassword, syncNow, sessionEmail } from './sync.js';

let open = false;
export const gateOpen = () => open;

export function showAuthGate({ reason = '', email = '' } = {}) {
  if (open) return Promise.resolve();
  open = true;
  document.body.classList.add('is-gated');
  const el = document.createElement('div');
  el.id = 'auth';
  el.className = 'auth';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Вхід');
  document.body.append(el);

  let mode = reason ? 'login' : 'register';
  let mail = email || sessionEmail();

  return new Promise((resolve) => {
    const draw = () => {
      const isReg = mode === 'register', isReset = mode === 'reset';
      mount(el, html`
        <div class="auth-box">
          <img class="auth-logo" src="icons/icon-192.png" alt="" width="64" height="64">
          <h1 class="auth-title">Служіння</h1>
          <p class="auth-sub">${isReset ? 'Введіть email — надішлемо лист, щоб задати новий пароль.'
            : reason || 'Облік годин, територій і нотаток. Ваші дані зберігаються в акаунті й доступні з будь-якого телефона.'}</p>
          ${isReset ? '' : html`
          <div class="seg auth-tabs" role="tablist">
            <label class="seg-item"><input type="radio" name="mode" value="login" ${mode === 'login' ? html`checked` : ''}><span>Вхід</span></label>
            <label class="seg-item"><input type="radio" name="mode" value="register" ${isReg ? html`checked` : ''}><span>Реєстрація</span></label>
          </div>`}
          <form class="form auth-form" novalidate>
            <label class="field"><span class="field-label">Email</span>
              <input type="email" name="email" autocomplete="${isReg ? 'email' : 'username'}" inputmode="email" autocapitalize="off" spellcheck="false" maxlength="200" value="${mail}" required></label>
            ${isReset ? '' : html`
            <label class="field"><span class="field-label">Пароль${isReg ? html` <em>мінімум 8 символів</em>` : ''}</span>
              <span class="pw">
                <input type="password" name="password" autocomplete="${isReg ? 'new-password' : 'current-password'}" minlength="8" maxlength="128" required>
                <button type="button" class="pw-eye" data-eye aria-label="Показати пароль">${icon('eye')}</button>
              </span></label>`}
            ${isReg ? html`
            <label class="field"><span class="field-label">Повторіть пароль</span>
              <input type="password" name="password2" autocomplete="new-password" maxlength="128" required></label>` : ''}
            <p class="auth-msg" role="alert" data-msg></p>
            <button type="submit" class="btn btn-primary btn-block" data-submit>
              ${isReset ? 'Надіслати лист' : isReg ? 'Створити акаунт' : 'Увійти'}
            </button>
            ${mode === 'login' ? html`<button type="button" class="link link-muted auth-link" data-forgot>Забули пароль?</button>` : ''}
            ${isReset ? html`<button type="button" class="link link-muted auth-link" data-back>${icon('left', 'link-i')}Назад до входу</button>` : ''}
          </form>
          <p class="auth-foot">${icon('shield', 'inline-i')} Пароль перевіряє Firebase (Google); на телефоні він не зберігається.</p>
        </div>`);

      const form = $('form', el);
      const msg = $('[data-msg]', el);
      const btn = $('[data-submit]', el);
      const say = (t, ok = false) => { msg.textContent = t; msg.classList.toggle('is-ok', ok); };

      $$('input[name=mode]', el).forEach((r) => r.addEventListener('change', () => { mail = form.elements.email.value; mode = r.value; draw(); }));
      $('[data-forgot]', el)?.addEventListener('click', () => { mail = form.elements.email.value; mode = 'reset'; draw(); });
      $('[data-back]', el)?.addEventListener('click', () => { mail = form.elements.email.value; mode = 'login'; draw(); });
      $('[data-eye]', el)?.addEventListener('click', (e) => {
        const show = form.elements.password.type === 'password';
        for (const n of ['password', 'password2']) if (form.elements[n]) form.elements[n].type = show ? 'text' : 'password';
        mount(e.currentTarget, icon(show ? 'eyeOff' : 'eye'));
        e.currentTarget.setAttribute('aria-label', show ? 'Сховати пароль' : 'Показати пароль');
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const em = form.elements.email.value.trim();
        mail = em;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { say('Перевірте email — схоже, у ньому помилка'); form.elements.email.focus(); return; }
        if (!navigator.onLine) { say('Немає інтернету. Для входу потрібне зʼєднання.'); return; }
        if (mode !== 'reset') {
          const pw = form.elements.password.value;
          if (pw.length < 8) { say('Пароль має містити щонайменше 8 символів'); form.elements.password.focus(); return; }
          if (mode === 'register' && pw !== form.elements.password2.value) { say('Паролі не збігаються'); form.elements.password2.focus(); return; }
        }
        btn.disabled = true;
        el.classList.add('is-busy');
        say('');
        try {
          if (mode === 'reset') {
            await resetPassword(em);
            say('Якщо такий акаунт існує, ми надіслали лист. Перевірте пошту (і папку «Спам»).', true);
            return;
          }
          if (mode === 'register') await register(em, form.elements.password.value);
          else await login(em, form.elements.password.value);
          haptic(15);
          btn.textContent = 'Завантажуємо ваші дані…';
          await Promise.race([syncNow(), new Promise((r) => setTimeout(r, 15000))]);
          open = false;
          el.classList.add('leaving');
          document.body.classList.remove('is-gated');
          setTimeout(() => el.remove(), 260);
          resolve();
        } catch (err) {
          say(err.message);
          haptic([30, 40, 30]);
        } finally {
          btn.disabled = false;
          el.classList.remove('is-busy');
        }
      });
    };
    draw();
    setTimeout(() => $(mail ? 'input[name=password]' : 'input[name=email]', el)?.focus(), 300);
  });
}

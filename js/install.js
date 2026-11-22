// "Add to home screen" helpers for Android (prompt) and iOS (instructions).
import { html, isIOS, isStandalone } from './util.js';
import { icon } from './icons.js';
import { openSheet } from './ui.js';
import { emit } from './store.js';

let deferred = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  emit();
});
window.addEventListener('appinstalled', () => { deferred = null; emit(); });

export const installable = () => !isStandalone();

export async function install() {
  if (deferred) {
    deferred.prompt();
    try { await deferred.userChoice; } catch { /* ignore */ }
    deferred = null;
    emit();
    return;
  }
  showHelp();
}

function showHelp() {
  const ios = isIOS();
  openSheet({
    title: 'Додати на головний екран',
    body: ios ? html`
      <ol class="steps">
        <li><span class="step-n">1</span><div>Відкрийте цю сторінку в <b>Safari</b>.</div></li>
        <li><span class="step-n">2</span><div>Натисніть <b>«Поділитися»</b> ${icon('share', 'inline-i')} внизу екрана.</div></li>
        <li><span class="step-n">3</span><div>Оберіть <b>«На початковий екран»</b> (Add to Home Screen).</div></li>
        <li><span class="step-n">4</span><div>Натисніть <b>«Додати»</b>. Іконка «Служіння» зʼявиться на робочому столі.</div></li>
      </ol>
      <p class="hint">Після встановлення застосунок працює без інтернету, а iOS не видаляє його дані.</p>` : html`
      <ol class="steps">
        <li><span class="step-n">1</span><div>Відкрийте меню браузера ${icon('more', 'inline-i')} (три крапки).</div></li>
        <li><span class="step-n">2</span><div>Оберіть <b>«Встановити застосунок»</b> або <b>«Додати на головний екран»</b>.</div></li>
        <li><span class="step-n">3</span><div>Підтвердіть. Іконка зʼявиться на робочому столі.</div></li>
      </ol>
      <p class="hint">Після встановлення застосунок працює без інтернету і може надсилати нагадування.</p>`,
  });
}

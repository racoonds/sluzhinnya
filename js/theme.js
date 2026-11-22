// Theme + version (kept separate to avoid circular imports).
import { state } from './store.js';

export const APP_VERSION = '1.0.0';

const BG = { dark: '#08090a', light: '#f7f7f8' };

export function applyTheme() {
  const t = state.settings.theme;
  const root = document.documentElement;
  if (t === 'dark' || t === 'light') root.dataset.theme = t;
  else delete root.dataset.theme;
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  metas.forEach((m) => {
    if (!m.dataset.orig) m.dataset.orig = m.getAttribute('content');
    m.setAttribute('content', t === 'dark' || t === 'light' ? BG[t] : m.dataset.orig);
  });
}

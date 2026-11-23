// Theme + version (kept separate to avoid circular imports).

export const APP_VERSION = '2.1.0';

// The app is dark-only.
export function applyTheme() {
  document.documentElement.dataset.theme = 'dark';
}

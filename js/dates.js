// Local-date helpers. Dates are stored as 'YYYY-MM-DD' strings in local time.
import { pad, plural } from './util.js';

export const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
export const MONTHS_GEN = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
export const MONTHS_SHORT = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
export const WD_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
export const WD_LONG = ['понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота', 'неділя'];
export const WD_ICS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function fromKey(k) {
  const [y, m, d] = String(k).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export const isKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);
export const todayKey = () => toKey(new Date());
export const day0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function addDays(d, n) {
  const x = day0(d);
  x.setDate(x.getDate() + n);
  return x;
}
export const addKey = (k, n) => toKey(addDays(fromKey(k), n));

/** Whole days from a to b (b − a). DST-safe. */
export const diffDays = (a, b) => Math.round((day0(b) - day0(a)) / 86400000);

/** 0 = Monday … 6 = Sunday */
export const weekday = (d) => (d.getDay() + 6) % 7;
export const startOfWeek = (d) => addDays(d, -weekday(d));
export const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

/** Service year runs 1 September → 31 August. Returns the starting calendar year. */
export const serviceYearOf = (d) => (d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1);

export function fmtDate(k, { weekday: wd = false, year = 'auto' } = {}) {
  const d = typeof k === 'string' ? fromKey(k) : k;
  let s = `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
  if (year === true || (year === 'auto' && d.getFullYear() !== new Date().getFullYear())) s += ` ${d.getFullYear()}`;
  if (wd) s = `${WD_LONG[weekday(d)]}, ${s}`;
  return s;
}

export function fmtDateShort(k) {
  const d = typeof k === 'string' ? fromKey(k) : k;
  const s = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() !== new Date().getFullYear() ? `${s} ${String(d.getFullYear()).slice(2)}` : s;
}

export function relDays(k) {
  const n = diffDays(fromKey(k), new Date());
  if (n === 0) return 'сьогодні';
  if (n === 1) return 'вчора';
  if (n === -1) return 'завтра';
  if (n < 0) return `через ${-n} ${plural(-n, ['день', 'дні', 'днів'])}`;
  if (n < 45) return `${n} ${plural(n, ['день', 'дні', 'днів'])} тому`;
  const m = Math.round(n / 30.4);
  if (m < 12) return `${m} ${plural(m, ['місяць', 'місяці', 'місяців'])} тому`;
  const y = Math.round(n / 365);
  return `${y} ${plural(y, ['рік', 'роки', 'років'])} тому`;
}

export const monthTitle = (d) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

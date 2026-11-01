/**
 * Ngày dương dạng chuỗi "YYYY-MM-DD", không mang múi giờ.
 * Mọi phép tính đi qua UTC nên không phụ thuộc múi giờ của máy chạy.
 */
export type ISODate = string;

const VN_OFFSET_MS = 7 * 3600 * 1000;
const DAY_MS = 86400 * 1000;

export function toISODate(year: number, month: number, day: number): ISODate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseISODate(iso: ISODate): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

export function isValidISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = parseISODate(value);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** Ngày hiện tại theo giờ Việt Nam (UTC+7). */
export function todayInVietnam(now: Date = new Date()): ISODate {
  return new Date(now.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function toUTC(iso: ISODate): number {
  const { year, month, day } = parseISODate(iso);
  return Date.UTC(year, month - 1, day);
}

export function addDays(iso: ISODate, days: number): ISODate {
  return new Date(toUTC(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Số ngày từ `from` đến `to` (dương nếu `to` ở sau). */
export function diffDays(from: ISODate, to: ISODate): number {
  return Math.round((toUTC(to) - toUTC(from)) / DAY_MS);
}

export function daysInSolarMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function solarMonthRange(year: number, month: number): { from: ISODate; to: ISODate } {
  return { from: toISODate(year, month, 1), to: toISODate(year, month, daysInSolarMonth(year, month)) };
}

export function nextSolarMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/** Thứ trong tuần: 0 = Chủ nhật ... 6 = Thứ bảy. */
export function weekdayOf(iso: ISODate): number {
  return new Date(toUTC(iso)).getUTCDay();
}

/** Tuần Thứ hai - Chủ nhật chứa ngày đã cho. */
export function weekRange(iso: ISODate): { from: ISODate; to: ISODate } {
  const from = addDays(iso, -((weekdayOf(iso) + 6) % 7));
  return { from, to: addDays(from, 6) };
}

const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

export function weekdayLabel(iso: ISODate): string {
  return WEEKDAYS[weekdayOf(iso)];
}

/** "2026-09-25" -> "25/09/2026" */
export function formatDateVN(iso: ISODate): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

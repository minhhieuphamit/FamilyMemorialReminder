/**
 * Tính ngày dương của ngày giỗ âm lịch từng năm, áp dụng quy tắc tháng nhuận và ngày thiếu.
 * Hàm thuần, không truy cập database.
 */
import type { LunarRule, Occurrence, UnresolvedOccurrence } from '../types/domain';
import { addDays, parseISODate, toISODate, type ISODate } from '../utils/dates';
import { getLeapMonth, getLunarMonthLength, lunarToSolar } from '../utils/lunar-calendar';

export interface ResolvedOccurrences {
  occurrences: Occurrence[];
  unresolved: UnresolvedOccurrence[];
}

/** Ngày đầu của tháng âm; null nếu tháng không tồn tại. */
function monthStartISO(lunarYear: number, month: number, isLeap: boolean): ISODate | null {
  const solar = lunarToSolar({ day: 1, month, year: lunarYear, isLeap });
  return solar && toISODate(solar.year, solar.month, solar.day);
}

function resolveInMonth(rule: LunarRule, lunarYear: number, isLeap: boolean, out: ResolvedOccurrences): void {
  const start = monthStartISO(lunarYear, rule.lunarMonth, isLeap)!;
  const length = getLunarMonthLength(lunarYear, rule.lunarMonth, isLeap)!;
  const base = { lunarDay: rule.lunarDay, lunarMonth: rule.lunarMonth, lunarYear, isLeapMonth: isLeap };

  if (rule.lunarDay <= length) {
    out.occurrences.push({ ...base, solarDate: addDays(start, rule.lunarDay - 1), adjustment: 'none' });
    return;
  }
  switch (rule.missingDayRule) {
    case 'last_day':
      out.occurrences.push({ ...base, solarDate: addDays(start, length - 1), adjustment: 'last_day' });
      break;
    case 'next_day':
      out.occurrences.push({ ...base, solarDate: addDays(start, length), adjustment: 'next_day' });
      break;
    case 'skip':
      out.unresolved.push({ ...base, reason: 'day_missing', anchorDate: addDays(start, length - 1) });
      break;
  }
}

/** Tất cả lần diễn ra của ngày giỗ trong một năm âm. */
export function resolveLunarYear(rule: LunarRule, lunarYear: number): ResolvedOccurrences {
  const out: ResolvedOccurrences = { occurrences: [], unresolved: [] };
  const hasLeap = getLeapMonth(lunarYear) === rule.lunarMonth;

  switch (rule.leapMonthRule) {
    case 'regular':
      resolveInMonth(rule, lunarYear, false, out);
      break;
    case 'leap_if_available':
      resolveInMonth(rule, lunarYear, hasLeap, out);
      break;
    case 'both':
      resolveInMonth(rule, lunarYear, false, out);
      if (hasLeap) resolveInMonth(rule, lunarYear, true, out);
      break;
    case 'exact':
      if (!rule.isLeapMonth || hasLeap) {
        resolveInMonth(rule, lunarYear, rule.isLeapMonth, out);
      } else {
        const anchorStart = monthStartISO(lunarYear, rule.lunarMonth, false)!;
        out.unresolved.push({
          lunarDay: rule.lunarDay,
          lunarMonth: rule.lunarMonth,
          lunarYear,
          isLeapMonth: true,
          reason: 'leap_month_missing',
          anchorDate: addDays(anchorStart, Math.min(rule.lunarDay, 29) - 1),
        });
      }
      break;
  }
  return out;
}

/**
 * Các lần diễn ra trong khoảng ngày dương [from, to], gồm cả hai đầu.
 * Một năm dương có thể chứa 0, 1 hoặc 2 lần vì năm âm không trùng năm dương.
 */
export function occurrencesBetween(rule: LunarRule, from: ISODate, to: ISODate): ResolvedOccurrences {
  const result: ResolvedOccurrences = { occurrences: [], unresolved: [] };
  const firstYear = parseISODate(from).year - 1;
  const lastYear = parseISODate(to).year + 1;
  for (let y = firstYear; y <= lastYear; y++) {
    const { occurrences, unresolved } = resolveLunarYear(rule, y);
    result.occurrences.push(...occurrences.filter((o) => o.solarDate >= from && o.solarDate <= to));
    result.unresolved.push(...unresolved.filter((u) => u.anchorDate >= from && u.anchorDate <= to));
  }
  result.occurrences.sort((a, b) => a.solarDate.localeCompare(b.solarDate));
  return result;
}

/**
 * Lần diễn ra gần nhất tính từ `from` (gồm cả ngày đó).
 * Tháng nhuận với quy tắc 'exact' có thể cách nhiều năm, nên quét tối đa 40 năm âm.
 */
export function nextOccurrence(rule: LunarRule, from: ISODate): Occurrence | null {
  const startYear = parseISODate(from).year - 1;
  for (let y = startYear; y < startYear + 40; y++) {
    const found = resolveLunarYear(rule, y)
      .occurrences.filter((o) => o.solarDate >= from)
      .sort((a, b) => a.solarDate.localeCompare(b.solarDate))[0];
    if (found) return found;
  }
  return null;
}

/** Nhãn ngày âm: "15/08" hoặc "15/04 nhuận". */
export function formatLunarLabel(o: { lunarDay: number; lunarMonth: number; isLeapMonth: boolean }): string {
  const label = `${String(o.lunarDay).padStart(2, '0')}/${String(o.lunarMonth).padStart(2, '0')}`;
  return o.isLeapMonth ? `${label} nhuận` : label;
}

import { LEAP_MONTH_RULES, MISSING_DAY_RULES, type Channel, type MemorialEventInput } from '../types/domain';
import { isValidISODate } from './dates';

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; errors: Record<string, string> };

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function isValidOffset(value: unknown): value is number {
  return isInt(value, 0, 60);
}

export function validateEventInput(raw: unknown): ValidationResult<MemorialEventInput> {
  const errors: Record<string, string> = {};
  const r = (raw ?? {}) as Record<string, unknown>;

  const fullName = typeof r.fullName === 'string' ? r.fullName.trim() : '';
  if (!fullName || fullName.length > 120) errors.fullName = 'Họ tên bắt buộc, tối đa 120 ký tự';

  const relationship = typeof r.relationship === 'string' ? r.relationship.trim() : '';
  if (relationship.length > 60) errors.relationship = 'Quan hệ tối đa 60 ký tự';

  const familyId = r.familyId ?? null;
  if (familyId !== null && !isInt(familyId, 1, Number.MAX_SAFE_INTEGER)) errors.familyId = 'Gia đình không hợp lệ';

  if (!isInt(r.lunarDay, 1, 30)) errors.lunarDay = 'Ngày âm phải từ 1 đến 30';
  if (!isInt(r.lunarMonth, 1, 12)) errors.lunarMonth = 'Tháng âm phải từ 1 đến 12';

  const isLeapMonth = r.isLeapMonth === true;

  const deathYear = r.deathYear ?? null;
  if (deathYear !== null && !isInt(deathYear, 1800, 2200)) errors.deathYear = 'Năm mất không hợp lệ';

  const deathSolarDate = r.deathSolarDate || null;
  if (deathSolarDate !== null && !isValidISODate(deathSolarDate)) errors.deathSolarDate = 'Ngày mất không hợp lệ';

  const notes = typeof r.notes === 'string' ? r.notes.trim() : '';
  if (notes.length > 1000) errors.notes = 'Ghi chú tối đa 1000 ký tự';

  const leapMonthRule = r.leapMonthRule ?? 'exact';
  if (!LEAP_MONTH_RULES.includes(leapMonthRule as never)) errors.leapMonthRule = 'Quy tắc tháng nhuận không hợp lệ';

  const missingDayRule = r.missingDayRule ?? 'skip';
  if (!MISSING_DAY_RULES.includes(missingDayRule as never)) errors.missingDayRule = 'Quy tắc ngày thiếu không hợp lệ';

  let reminderOffsets: number[] | null = null;
  if (r.reminderOffsets !== null && r.reminderOffsets !== undefined) {
    if (!Array.isArray(r.reminderOffsets) || r.reminderOffsets.length > 10 || !r.reminderOffsets.every(isValidOffset)) {
      errors.reminderOffsets = 'Mốc nhắc phải là số ngày từ 0 đến 60, tối đa 10 mốc';
    } else {
      reminderOffsets = [...new Set(r.reminderOffsets as number[])].sort((a, b) => b - a);
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      fullName,
      relationship,
      familyId: familyId as number | null,
      lunarDay: r.lunarDay as number,
      lunarMonth: r.lunarMonth as number,
      isLeapMonth,
      deathYear: deathYear as number | null,
      deathSolarDate: deathSolarDate as string | null,
      notes,
      leapMonthRule: leapMonthRule as MemorialEventInput['leapMonthRule'],
      missingDayRule: missingDayRule as MemorialEventInput['missingDayRule'],
      reminderEnabled: r.reminderEnabled !== false,
      reminderOffsets,
    },
  };
}

/** Telegram: số nguyên, nhóm có thể mang dấu âm. Zalo: chuỗi chữ số và chữ cái, có thể có dấu chấm. */
export function isValidChatId(channel: Channel, value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return channel === 'telegram' ? /^-?\d{1,20}$/.test(value) : /^[A-Za-z0-9._-]{1,64}$/.test(value);
}

export const PASSWORD_ERROR = 'Mật khẩu phải dài từ 8 đến 128 ký tự';

export function isValidPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128;
}

/** Tên đăng nhập: chữ thường không dấu, số, dấu chấm, gạch; từ 3 đến 32 ký tự. Trả về null nếu không hợp lệ. */
export function parseUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const username = value.trim().toLowerCase();
  return /^[a-z0-9._-]{3,32}$/.test(username) ? username : null;
}

export function parseFamilyName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= 60 ? name : null;
}

import type { LeapMonthRule, MissingDayRule, UnresolvedOccurrence } from '../../../src/types/domain';

export const RELATIONSHIPS = ['Ông nội', 'Bà nội', 'Ông ngoại', 'Bà ngoại', 'Bố', 'Mẹ', 'Cô', 'Dì', 'Chú', 'Bác'];

export const LEAP_RULE_OPTIONS: { value: LeapMonthRule; label: string; hint: string }[] = [
  { value: 'exact', label: 'Đúng tháng đã chọn', hint: 'Không thay thế. Giỗ tháng nhuận mà năm đó không có sẽ báo cần xử lý.' },
  { value: 'regular', label: 'Luôn cúng tháng thường', hint: 'Kể cả mất vào tháng nhuận, mọi năm đều cúng ở tháng thường cùng số.' },
  { value: 'leap_if_available', label: 'Ưu tiên tháng nhuận', hint: 'Năm có tháng nhuận cùng số thì cúng tháng nhuận, các năm khác cúng tháng thường.' },
  { value: 'both', label: 'Cúng cả hai lần', hint: 'Năm có tháng nhuận cùng số thì cúng cả tháng thường và tháng nhuận.' },
];

export const MISSING_DAY_OPTIONS: { value: MissingDayRule; label: string; hint: string }[] = [
  { value: 'skip', label: 'Không thay thế', hint: 'Năm tháng thiếu sẽ không có ngày và không gửi nhắc, website báo cần xử lý.' },
  { value: 'last_day', label: 'Dùng ngày cuối tháng', hint: 'Tháng chỉ có 29 ngày thì cúng ngày 29.' },
  { value: 'next_day', label: 'Dùng mùng 1 tháng sau', hint: 'Tháng chỉ có 29 ngày thì cúng mùng 1 tháng kế tiếp.' },
];

export function unresolvedReason(u: UnresolvedOccurrence): string {
  return u.reason === 'leap_month_missing'
    ? `Năm âm ${u.lunarYear} không có tháng ${u.lunarMonth} nhuận`
    : `Tháng ${u.lunarMonth}${u.isLeapMonth ? ' nhuận' : ''} năm âm ${u.lunarYear} chỉ có 29 ngày`;
}

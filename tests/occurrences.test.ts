import { describe, expect, it } from 'vitest';
import {
  buildEventView,
  listOccurrences,
  lunarMonthRangeOf,
  nearestItems,
  searchEvents,
} from '../src/services/memorial-service';
import { nextOccurrence, occurrencesBetween, resolveLunarYear } from '../src/services/occurrences';
import { solarMonthRange } from '../src/utils/dates';
import { makeEvent } from './helpers/factories';

const year = (y: number) => ({ from: `${y}-01-01`, to: `${y}-12-31` });
const dates = (r: { occurrences: { solarDate: string }[] }) => r.occurrences.map((o) => o.solarDate);

describe('Ngày giỗ kế tiếp', () => {
  it('không cộng cố định 365 ngày: ngày dương thay đổi theo từng năm âm', () => {
    const rule = makeEvent({ lunarDay: 15, lunarMonth: 8 });
    expect(dates(occurrencesBetween(rule, year(2024).from, year(2024).to))).toEqual(['2024-09-17']);
    expect(dates(occurrencesBetween(rule, year(2025).from, year(2025).to))).toEqual(['2025-10-06']);
    expect(dates(occurrencesBetween(rule, year(2026).from, year(2026).to))).toEqual(['2026-09-25']);
  });

  it('đúng ngày giỗ thì kế tiếp chính là hôm nay', () => {
    const rule = makeEvent({ lunarDay: 15, lunarMonth: 8 });
    expect(nextOccurrence(rule, '2026-09-25')?.solarDate).toBe('2026-09-25');
  });

  it('qua ngày giỗ thì chuyển sang năm âm sau', () => {
    const rule = makeEvent({ lunarDay: 15, lunarMonth: 8 });
    const next = nextOccurrence(rule, '2026-09-26')!;
    expect(next.lunarYear).toBe(2027);
    expect(next.solarDate > '2027-01-01').toBe(true);
  });

  it('tháng 11, 12 âm có thể rơi vào năm dương sau', () => {
    // 15/12 năm âm 2026 nằm trong năm dương 2027.
    const rule = makeEvent({ lunarDay: 15, lunarMonth: 12 });
    const next = nextOccurrence(rule, '2026-11-01')!;
    expect(next.lunarYear).toBe(2026);
    expect(next.solarDate.startsWith('2027-01')).toBe(true);
  });

  it('một năm dương có thể có 2 lần cùng một ngày giỗ: 1/12 âm trong năm 2024', () => {
    const rule = makeEvent({ lunarDay: 1, lunarMonth: 12 });
    expect(dates(occurrencesBetween(rule, year(2024).from, year(2024).to))).toEqual(['2024-01-11', '2024-12-31']);
  });

  it('tính đúng số ngày còn lại trong buildEventView', () => {
    const view = buildEventView(makeEvent({ lunarDay: 15, lunarMonth: 8 }), '2026-09-22');
    expect(view.next?.solarDate).toBe('2026-09-25');
    expect(view.next?.daysLeft).toBe(3);
  });
});

describe('Quy tắc tháng nhuận', () => {
  it('exact + tháng thường: năm có nhuận vẫn chỉ cúng tháng thường', () => {
    const r = resolveLunarYear(makeEvent({ lunarDay: 10, lunarMonth: 4 }), 2020);
    expect(dates(r)).toEqual(['2020-05-02']);
    expect(r.occurrences[0].isLeapMonth).toBe(false);
  });

  it('exact + tháng nhuận: chỉ có ngày khi năm có đúng tháng nhuận đó', () => {
    const rule = makeEvent({ lunarDay: 10, lunarMonth: 4, isLeapMonth: true });
    const leap = resolveLunarYear(rule, 2020);
    expect(dates(leap)).toEqual(['2020-06-01']);
    expect(leap.occurrences[0].isLeapMonth).toBe(true);
  });

  it('exact + tháng nhuận: năm không nhuận KHÔNG tự chọn ngày thay thế mà báo cần xử lý', () => {
    const r = resolveLunarYear(makeEvent({ lunarDay: 10, lunarMonth: 4, isLeapMonth: true }), 2026);
    expect(r.occurrences).toEqual([]);
    expect(r.unresolved).toHaveLength(1);
    expect(r.unresolved[0].reason).toBe('leap_month_missing');
  });

  it('regular: người mất tháng nhuận vẫn cúng tháng thường mọi năm', () => {
    const rule = makeEvent({ lunarDay: 10, lunarMonth: 4, isLeapMonth: true, leapMonthRule: 'regular' });
    expect(dates(resolveLunarYear(rule, 2020))).toEqual(['2020-05-02']);
    expect(dates(resolveLunarYear(rule, 2026))).toHaveLength(1);
  });

  it('leap_if_available: năm có nhuận thì dùng tháng nhuận, năm khác dùng tháng thường', () => {
    const rule = makeEvent({ lunarDay: 10, lunarMonth: 4, leapMonthRule: 'leap_if_available' });
    expect(dates(resolveLunarYear(rule, 2020))).toEqual(['2020-06-01']);
    const other = resolveLunarYear(rule, 2026);
    expect(other.occurrences[0].isLeapMonth).toBe(false);
    expect(other.unresolved).toEqual([]);
  });

  it('both: năm có nhuận cúng cả hai lần', () => {
    const rule = makeEvent({ lunarDay: 10, lunarMonth: 4, leapMonthRule: 'both' });
    expect(dates(resolveLunarYear(rule, 2020))).toEqual(['2020-05-02', '2020-06-01']);
    expect(resolveLunarYear(rule, 2026).occurrences).toHaveLength(1);
  });

  it('nextOccurrence tìm được tháng nhuận cách nhiều năm', () => {
    const rule = makeEvent({ lunarDay: 10, lunarMonth: 4, isLeapMonth: true });
    expect(nextOccurrence(rule, '2020-06-02')!.lunarYear).toBeGreaterThan(2020);
  });
});

describe('Quy tắc ngày 30 ở tháng thiếu', () => {
  // Tháng 12 năm âm 2024 chỉ có 29 ngày, cuối tháng là 28/01/2025; Tết là 29/01/2025.
  it('skip: không tự thay thế, báo cần xử lý', () => {
    const r = resolveLunarYear(makeEvent({ lunarDay: 30, lunarMonth: 12, missingDayRule: 'skip' }), 2024);
    expect(r.occurrences).toEqual([]);
    expect(r.unresolved[0].reason).toBe('day_missing');
  });

  it('last_day: dùng ngày cuối tháng', () => {
    const r = resolveLunarYear(makeEvent({ lunarDay: 30, lunarMonth: 12, missingDayRule: 'last_day' }), 2024);
    expect(r.occurrences[0]).toMatchObject({ solarDate: '2025-01-28', adjustment: 'last_day' });
  });

  it('next_day: dùng mùng 1 tháng sau', () => {
    const r = resolveLunarYear(makeEvent({ lunarDay: 30, lunarMonth: 12, missingDayRule: 'next_day' }), 2024);
    expect(r.occurrences[0]).toMatchObject({ solarDate: '2025-01-29', adjustment: 'next_day' });
  });

  it('tháng đủ thì không áp dụng quy tắc', () => {
    const r = resolveLunarYear(makeEvent({ lunarDay: 30, lunarMonth: 12, missingDayRule: 'last_day' }), 2023);
    expect(r.occurrences[0]).toMatchObject({ solarDate: '2024-02-09', adjustment: 'none' });
  });

  it('ngày 29 luôn tồn tại', () => {
    for (let y = 2000; y <= 2040; y++) {
      for (let m = 1; m <= 12; m++) {
        const r = resolveLunarYear(makeEvent({ lunarDay: 29, lunarMonth: m }), y);
        expect(r.occurrences).toHaveLength(1);
      }
    }
  });
});

describe('Danh sách theo tháng', () => {
  const events = [
    makeEvent({ id: 1, fullName: 'Ông An', relationship: 'Ông nội', lunarDay: 15, lunarMonth: 8 }),
    makeEvent({ id: 2, fullName: 'Bà Bình', relationship: 'Bà nội', lunarDay: 20, lunarMonth: 8 }),
    makeEvent({ id: 3, fullName: 'Chú Em', relationship: 'Chú', lunarDay: 1, lunarMonth: 1 }),
  ];

  it('lọc theo tháng dương và sắp xếp theo ngày', () => {
    const r = solarMonthRange(2026, 9);
    const { items } = listOccurrences(events, r.from, r.to, '2026-09-01');
    expect(items.map((i) => i.event.id)).toEqual([1, 2]);
    expect(items.map((i) => i.occurrence.solarDate)).toEqual(['2026-09-25', '2026-09-30']);
    expect(items[0].daysLeft).toBe(24);
  });

  it('tháng không có ngày giỗ trả về rỗng', () => {
    const r = solarMonthRange(2026, 5);
    expect(listOccurrences(events, r.from, r.to, '2026-05-01').items).toEqual([]);
  });

  it('khoảng ngày của tháng âm hiện tại', () => {
    const r = lunarMonthRangeOf('2026-09-25');
    expect(r).toMatchObject({ month: 8, isLeap: false, year: 2026, from: '2026-09-11' });
  });

  it('gần nhất trả về mọi ngày giỗ cùng ngày', () => {
    const same = [...events, makeEvent({ id: 4, fullName: 'Cô Giang', lunarDay: 15, lunarMonth: 8 })];
    const nearest = nearestItems(same, '2026-09-01');
    expect(nearest.map((n) => n.event.id).sort()).toEqual([1, 4]);
  });

  it('tìm kiếm không phân biệt dấu', () => {
    expect(searchEvents(events, 'ong noi').map((e) => e.id)).toEqual([1]);
    expect(searchEvents(events, 'BÌNH').map((e) => e.id)).toEqual([2]);
    expect(searchEvents(events, 'không có')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  getLeapMonth,
  getLunarMonthLength,
  jdFromDate,
  jdToDate,
  lunarToSolar,
  lunarYearName,
  solarToLunar,
} from '../src/utils/lunar-calendar';

const solar = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
};
const lunar = (day: number, month: number, year: number, isLeap = false) => ({ day, month, year, isLeap });

/**
 * Bộ đối chiếu: lịch nghỉ lễ do Chính phủ Việt Nam công bố hằng năm và các ngày lễ âm lịch phổ biến.
 * Mùng 1 Tết và Giỗ Tổ Hùng Vương (10/3 âm) đều là ngày nghỉ lễ chính thức.
 */
const TET_DATES: [number, string][] = [
  [2015, '2015-02-19'],
  [2016, '2016-02-08'],
  [2017, '2017-01-28'],
  [2018, '2018-02-16'],
  [2019, '2019-02-05'],
  [2020, '2020-01-25'],
  [2021, '2021-02-12'],
  [2022, '2022-02-01'],
  [2023, '2023-01-22'],
  [2024, '2024-02-10'],
  [2025, '2025-01-29'],
  [2026, '2026-02-17'],
  [2027, '2027-02-06'],
  [2028, '2028-01-26'],
  [2029, '2029-02-13'],
  // Sóc lúc 23:07 ngày 02/02/2030 giờ Việt Nam, 00:07 ngày 03/02 giờ Trung Quốc: Tết hai nước lệch một ngày.
  [2030, '2030-02-02'],
];

const HUNG_KINGS: [number, string][] = [
  [2019, '2019-04-14'],
  [2020, '2020-04-02'],
  [2021, '2021-04-21'],
  [2022, '2022-04-10'],
  [2023, '2023-04-29'],
  [2024, '2024-04-18'],
  [2025, '2025-04-07'],
  [2026, '2026-04-26'],
];

const MID_AUTUMN: [number, string][] = [
  [2022, '2022-09-10'],
  [2023, '2023-09-29'],
  [2024, '2024-09-17'],
  [2025, '2025-10-06'],
  [2026, '2026-09-25'],
];

describe('Tết Nguyên Đán', () => {
  it.each(TET_DATES)('mùng 1 Tết năm %i', (year, date) => {
    expect(lunarToSolar(lunar(1, 1, year))).toEqual(solar(date));
    expect(solarToLunar(solar(date))).toEqual(lunar(1, 1, year));
  });

  it('dùng múi giờ UTC+7: Tết 2007 của Việt Nam sớm hơn Trung Quốc một ngày', () => {
    expect(lunarToSolar(lunar(1, 1, 2007))).toEqual(solar('2007-02-17'));
    expect(lunarToSolar(lunar(1, 1, 2007), 8)).toEqual(solar('2007-02-18'));
  });

  it('dùng múi giờ UTC+7: Tết 1985 của Việt Nam sớm hơn Trung Quốc một tháng', () => {
    expect(lunarToSolar(lunar(1, 1, 1985))).toEqual(solar('1985-01-21'));
    expect(lunarToSolar(lunar(1, 1, 1985), 8)).toEqual(solar('1985-02-20'));
  });
});

describe('Ngày lễ âm lịch cố định', () => {
  it.each(HUNG_KINGS)('Giỗ Tổ Hùng Vương (10/3 âm) năm %i', (year, date) => {
    expect(lunarToSolar(lunar(10, 3, year))).toEqual(solar(date));
  });

  it.each(MID_AUTUMN)('Trung thu (15/8 âm) năm %i', (year, date) => {
    expect(lunarToSolar(lunar(15, 8, year))).toEqual(solar(date));
  });

  it('Vu Lan 2025 (15/7) sau tháng 6 nhuận rơi vào 06/09/2025', () => {
    expect(lunarToSolar(lunar(15, 7, 2025))).toEqual(solar('2025-09-06'));
  });
});

describe('Năm nhuận và tháng nhuận', () => {
  it.each([
    [2009, 5],
    [2012, 4],
    [2014, 9],
    [2017, 6],
    [2020, 4],
    [2023, 2],
    [2025, 6],
    [2028, 5],
    [2031, 3],
    [2033, 11],
  ])('năm âm %i nhuận tháng %i', (year, month) => {
    expect(getLeapMonth(year)).toBe(month);
  });

  it.each([2018, 2019, 2021, 2022, 2024, 2026, 2027, 2029, 2030])('năm âm %i không nhuận', (year) => {
    expect(getLeapMonth(year)).toBeNull();
  });

  it.each([
    ['2009-06-23', lunar(1, 5, 2009, true)],
    ['2012-05-21', lunar(1, 4, 2012, true)],
    ['2014-10-24', lunar(1, 9, 2014, true)],
    ['2017-07-23', lunar(1, 6, 2017, true)],
    ['2020-05-23', lunar(1, 4, 2020, true)],
    ['2023-03-22', lunar(1, 2, 2023, true)],
    ['2025-07-25', lunar(1, 6, 2025, true)],
  ])('ngày đầu tháng nhuận %s', (date, expected) => {
    expect(solarToLunar(solar(date))).toEqual(expected);
    expect(lunarToSolar(expected)).toEqual(solar(date));
  });

  it('tháng thường và tháng nhuận cùng số cách nhau đúng một tháng âm', () => {
    expect(lunarToSolar(lunar(1, 4, 2020))).toEqual(solar('2020-04-23'));
    expect(lunarToSolar(lunar(1, 4, 2020, true))).toEqual(solar('2020-05-23'));
    expect(lunarToSolar(lunar(1, 5, 2020))).toEqual(solar('2020-06-21'));
  });

  it('trả về null, không tự thay thế, khi tháng nhuận không tồn tại', () => {
    expect(lunarToSolar(lunar(1, 4, 2021, true))).toBeNull();
    expect(lunarToSolar(lunar(1, 5, 2020, true))).toBeNull();
    expect(getLunarMonthLength(2021, 4, true)).toBeNull();
  });

  it('tháng 11 nhuận năm 2033 thuộc đúng năm âm 2033', () => {
    const start = lunarToSolar(lunar(1, 11, 2033, true))!;
    expect(solarToLunar(start)).toEqual(lunar(1, 11, 2033, true));
    expect(getLunarMonthLength(2033, 11, true)).toBeGreaterThanOrEqual(29);
  });

  it('năm dương nhuận: 29/02/2024 là 20/1 âm', () => {
    expect(solarToLunar(solar('2024-02-29'))).toEqual(lunar(20, 1, 2024));
  });
});

describe('Ngày 29 và 30 âm lịch', () => {
  it('30 Tết 2024 tồn tại: 09/02/2024', () => {
    expect(getLunarMonthLength(2023, 12)).toBe(30);
    expect(lunarToSolar(lunar(30, 12, 2023))).toEqual(solar('2024-02-09'));
  });

  it('năm âm 2024 không có 30 Tết: trả về null, ngày cuối là 29', () => {
    expect(getLunarMonthLength(2024, 12)).toBe(29);
    expect(lunarToSolar(lunar(30, 12, 2024))).toBeNull();
    expect(lunarToSolar(lunar(29, 12, 2024))).toEqual(solar('2025-01-28'));
  });

  it('năm âm 2025 không có 30 Tết: ngày cuối là 16/02/2026', () => {
    expect(lunarToSolar(lunar(30, 12, 2025))).toBeNull();
    expect(lunarToSolar(lunar(29, 12, 2025))).toEqual(solar('2026-02-16'));
  });
});

describe('Ranh giới năm âm lịch', () => {
  it('giao thừa: ngày trước mùng 1 Tết thuộc năm âm trước', () => {
    expect(solarToLunar(solar('2025-01-28'))).toEqual(lunar(29, 12, 2024));
    expect(solarToLunar(solar('2025-01-29'))).toEqual(lunar(1, 1, 2025));
  });

  it('tháng 1 dương vẫn thuộc năm âm trước', () => {
    expect(solarToLunar(solar('2025-01-01'))).toEqual(lunar(2, 12, 2024));
    expect(solarToLunar(solar('2024-01-01'))).toEqual(lunar(20, 11, 2023));
  });

  it('cuối năm dương đã sang tháng 12 âm cùng năm âm', () => {
    expect(solarToLunar(solar('2024-12-31'))).toEqual(lunar(1, 12, 2024));
  });
});

describe('Tính nhất quán 1900 - 2199', () => {
  it('những ngày Sóc thực lệch xa Sóc trung bình không cho ra "ngày 0"', () => {
    expect(solarToLunar(solar('2054-05-07'))).toEqual(lunar(30, 3, 2054));
    expect(solarToLunar(solar('2062-04-09')).day).toBeGreaterThan(0);
  });

  it('đổi dương sang âm rồi đổi ngược lại luôn về đúng ngày, mọi ngày trong 300 năm', () => {
    const startJd = jdFromDate(1, 1, 1900);
    const endJd = jdFromDate(31, 12, 2199);
    for (let jd = startJd; jd <= endJd; jd++) {
      const date = jdToDate(jd);
      const back = lunarToSolar(solarToLunar(date));
      if (back === null || back.day !== date.day || back.month !== date.month || back.year !== date.year) {
        throw new Error(`Sai tại ${JSON.stringify(date)}: ${JSON.stringify(back)}`);
      }
    }
  });

  it('mọi tháng âm dài 29 hoặc 30 ngày và năm âm có 12 hoặc 13 tháng', () => {
    for (let year = 1900; year <= 2100; year++) {
      for (let month = 1; month <= 12; month++) {
        expect([29, 30]).toContain(getLunarMonthLength(year, month));
      }
      const leap = getLeapMonth(year);
      if (leap !== null) expect([29, 30]).toContain(getLunarMonthLength(year, leap, true));
    }
  });

  it('ngày liền kề tăng liên tục: lịch không có khoảng trống', () => {
    let previous = solarToLunar(solar('1999-12-31'));
    for (let jd = jdFromDate(1, 1, 2000); jd <= jdFromDate(31, 12, 2040); jd++) {
      const current = solarToLunar(jdToDate(jd));
      if (current.day !== 1) expect(current.day).toBe(previous.day + 1);
      else expect(previous.day).toBeGreaterThanOrEqual(29);
      previous = current;
    }
  });
});

describe('Tên năm can chi', () => {
  it.each([
    [2024, 'Giáp Thìn'],
    [2025, 'Ất Tỵ'],
    [2026, 'Bính Ngọ'],
    [1975, 'Ất Mão'],
  ])('năm %i là %s', (year, name) => {
    expect(lunarYearName(year)).toBe(name);
  });
});

/**
 * Chuyển đổi âm - dương lịch Việt Nam.
 *
 * Dựa trên thuật toán thiên văn của Hồ Ngọc Đức (https://lunarcalendar.informatik.uni-leipzig.de,
 * "Computing the Vietnamese lunar calendar"), tính theo múi giờ UTC+7:
 * - Ngày đầu tháng là ngày chứa điểm Sóc, tính theo giờ địa phương.
 * - Tháng 11 âm luôn chứa điểm Đông chí.
 * - Năm có 13 tháng: tháng nhuận là tháng đầu tiên sau tháng 11 không chứa Trung khí.
 *
 * Module này thuần tính toán, không phụ thuộc Worker nên dùng được cho cả frontend.
 */

export const VN_TIMEZONE = 7;

export interface SolarDate {
  day: number;
  month: number;
  year: number;
}

export interface LunarDate {
  day: number;
  month: number;
  year: number;
  isLeap: boolean;
}

const INT = Math.floor;
const PI = Math.PI;
const SYNODIC_MONTH = 29.530588853;
const NEW_MOON_EPOCH = 2415021.076998695;

export function jdFromDate(day: number, month: number, year: number): number {
  const a = INT((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  const jd = day + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
  return jd < 2299161 ? day + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083 : jd;
}

export function jdToDate(jd: number): SolarDate {
  let b = 0;
  let c: number;
  if (jd > 2299160) {
    const a = jd + 32044;
    b = INT((4 * a + 3) / 146097);
    c = a - INT((b * 146097) / 4);
  } else {
    c = jd + 32082;
  }
  const d = INT((4 * c + 3) / 1461);
  const e = c - INT((1461 * d) / 4);
  const m = INT((5 * e + 2) / 153);
  return {
    day: e - INT((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * INT(m / 10),
    year: b * 100 + d - 4800 + INT(m / 10),
  };
}

/** Thời điểm Sóc thứ k (tính từ 1900-01-01), đơn vị ngày Julius, giờ UTC. */
function newMoon(k: number): number {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const dr = PI / 180;
  let jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
  C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
  C1 -= 0.0004 * Math.sin(dr * 3 * Mpr);
  C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
  C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
  C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
  C1 = C1 + 0.001 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  const deltaT =
    T < -11
      ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
      : -0.000278 + 0.000265 * T + 0.000262 * T2;
  return jd1 + C1 - deltaT;
}

/** Kinh độ mặt trời (radian, trong khoảng 0 đến 2*PI) tại thời điểm jdn. */
function sunLongitudeRad(jdn: number): number {
  const T = (jdn - 2451545.0) / 36525;
  const T2 = T * T;
  const dr = PI / 180;
  const M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
  DL = DL + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.00029 * Math.sin(dr * 3 * M);
  const L = (L0 + DL) * dr;
  return L - PI * 2 * INT(L / (PI * 2));
}

function getSunLongitude(dayNumber: number, tz: number): number {
  return INT((sunLongitudeRad(dayNumber - 0.5 - tz / 24) / PI) * 6);
}

// Cache theo isolate: mỗi giá trị chỉ tính một lần, giúp Worker nằm trong giới hạn CPU của Free Plan.
const newMoonDayCache = new Map<string, number>();
const month11Cache = new Map<string, number>();
const leapOffsetCache = new Map<string, number>();

function getNewMoonDay(k: number, tz: number): number {
  const key = `${k}:${tz}`;
  let day = newMoonDayCache.get(key);
  if (day === undefined) {
    day = INT(newMoon(k) + 0.5 + tz / 24);
    newMoonDayCache.set(key, day);
  }
  return day;
}

/** Ngày bắt đầu tháng 11 âm của năm dương yy (tháng chứa Đông chí). */
function getLunarMonth11(yy: number, tz: number): number {
  const key = `${yy}:${tz}`;
  const cached = month11Cache.get(key);
  if (cached !== undefined) return cached;
  const off = jdFromDate(31, 12, yy) - 2415021;
  const k = INT(off / SYNODIC_MONTH);
  let nm = getNewMoonDay(k, tz);
  if (getSunLongitude(nm, tz) >= 9) nm = getNewMoonDay(k - 1, tz);
  month11Cache.set(key, nm);
  return nm;
}

/** Vị trí tháng nhuận tính từ tháng 11 (a11) của năm có 13 tháng. */
function getLeapMonthOffset(a11: number, tz: number): number {
  const key = `${a11}:${tz}`;
  const cached = leapOffsetCache.get(key);
  if (cached !== undefined) return cached;
  const k = INT((a11 - NEW_MOON_EPOCH) / SYNODIC_MONTH + 0.5);
  let i = 1;
  let arc = getSunLongitude(getNewMoonDay(k + i, tz), tz);
  let last: number;
  do {
    last = arc;
    i++;
    arc = getSunLongitude(getNewMoonDay(k + i, tz), tz);
  } while (arc !== last && i < 14);
  leapOffsetCache.set(key, i - 1);
  return i - 1;
}

function leapMonthFromOffset(leapOffset: number): number {
  const m = leapOffset - 2;
  return m <= 0 ? m + 12 : m;
}

/** Chỉ số Sóc k của tháng âm; null nếu tháng nhuận đó không tồn tại trong năm. */
function lunarMonthIndex(lunarYear: number, month: number, isLeap: boolean, tz: number): number | null {
  const a11 = getLunarMonth11(month < 11 ? lunarYear - 1 : lunarYear, tz);
  const b11 = getLunarMonth11(month < 11 ? lunarYear : lunarYear + 1, tz);
  const k = INT(0.5 + (a11 - NEW_MOON_EPOCH) / SYNODIC_MONTH);
  let off = month - 11;
  if (off < 0) off += 12;
  if (b11 - a11 > 365) {
    const leapOff = getLeapMonthOffset(a11, tz);
    if (isLeap && month !== leapMonthFromOffset(leapOff)) return null;
    if (isLeap || off >= leapOff) off += 1;
  } else if (isLeap) {
    return null;
  }
  return k + off;
}

export function solarToLunar(solar: SolarDate, tz: number = VN_TIMEZONE): LunarDate {
  const { day, month, year } = solar;
  const dayNumber = jdFromDate(day, month, year);
  // Sóc thực lệch khỏi Sóc trung bình tới vài ngày, nên phải lùi tới khi gặp Sóc không vượt quá ngày đang xét.
  // Bản gốc chỉ lùi một lần và cho ra "ngày 0" ở vài ngày hiếm, ví dụ 07/05/2054.
  let k = INT((dayNumber - NEW_MOON_EPOCH) / SYNODIC_MONTH) + 1;
  let monthStart = getNewMoonDay(k, tz);
  while (monthStart > dayNumber) monthStart = getNewMoonDay(--k, tz);

  let a11 = getLunarMonth11(year, tz);
  let b11 = a11;
  let lunarYear: number;
  if (a11 >= monthStart) {
    lunarYear = year;
    a11 = getLunarMonth11(year - 1, tz);
  } else {
    lunarYear = year + 1;
    b11 = getLunarMonth11(year + 1, tz);
  }

  const diff = INT((monthStart - a11) / 29);
  let isLeap = false;
  let lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    const leapOff = getLeapMonthOffset(a11, tz);
    if (diff >= leapOff) {
      lunarMonth = diff + 10;
      isLeap = diff === leapOff;
    }
  }
  if (lunarMonth > 12) lunarMonth -= 12;
  if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;

  return { day: dayNumber - monthStart + 1, month: lunarMonth, year: lunarYear, isLeap };
}

/**
 * Đổi âm sang dương, kiểm tra nghiêm ngặt: trả về null khi ngày âm không tồn tại
 * (tháng nhuận không có trong năm, hoặc ngày 30 của tháng thiếu). Không tự chọn ngày thay thế.
 */
export function lunarToSolar(lunar: LunarDate, tz: number = VN_TIMEZONE): SolarDate | null {
  const idx = lunarMonthIndex(lunar.year, lunar.month, lunar.isLeap, tz);
  if (idx === null || lunar.day < 1) return null;
  const start = getNewMoonDay(idx, tz);
  if (lunar.day > getNewMoonDay(idx + 1, tz) - start) return null;
  return jdToDate(start + lunar.day - 1);
}

/** Tháng nhuận của năm âm (1-12), hoặc null nếu năm không nhuận. */
export function getLeapMonth(lunarYear: number, tz: number = VN_TIMEZONE): number | null {
  const first = leapMonthOfSui(lunarYear - 1, tz);
  if (first !== null && first < 11) return first;
  const second = leapMonthOfSui(lunarYear, tz);
  if (second !== null && second >= 11) return second;
  return null;
}

/** Tháng nhuận trong khoảng từ tháng 11 năm yy đến trước tháng 11 năm yy+1. */
function leapMonthOfSui(yy: number, tz: number): number | null {
  const a11 = getLunarMonth11(yy, tz);
  const b11 = getLunarMonth11(yy + 1, tz);
  return b11 - a11 > 365 ? leapMonthFromOffset(getLeapMonthOffset(a11, tz)) : null;
}

/** Số ngày của tháng âm (29 hoặc 30), hoặc null nếu tháng không tồn tại. */
export function getLunarMonthLength(
  lunarYear: number,
  month: number,
  isLeap = false,
  tz: number = VN_TIMEZONE,
): number | null {
  const idx = lunarMonthIndex(lunarYear, month, isLeap, tz);
  return idx === null ? null : getNewMoonDay(idx + 1, tz) - getNewMoonDay(idx, tz);
}

const CAN = ['Canh', 'Tân', 'Nhâm', 'Quý', 'Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ'];
const CHI = ['Thân', 'Dậu', 'Tuất', 'Hợi', 'Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi'];

/** Tên can chi của năm âm, ví dụ 2026 -> "Bính Ngọ". */
export function lunarYearName(lunarYear: number): string {
  return `${CAN[lunarYear % 10]} ${CHI[lunarYear % 12]}`;
}

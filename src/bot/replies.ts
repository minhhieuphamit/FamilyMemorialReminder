/** Dựng nội dung trả lời từ intent. Hàm thuần: chỉ nhận dữ liệu, trả về văn bản HTML. */
import {
  listOccurrences,
  lunarMonthRangeOf,
  nearestItems,
  searchEvents,
} from '../services/memorial-service';
import { formatLunarLabel, nextOccurrence } from '../services/occurrences';
import type { MemorialEvent, OccurrenceItem } from '../types/domain';
import {
  addDays,
  diffDays,
  formatDateVN,
  nextSolarMonth,
  parseISODate,
  solarMonthRange,
  toISODate,
  weekdayLabel,
  weekRange,
  type ISODate,
} from '../utils/dates';
import { escapeHtml, normalizeVietnamese } from '../utils/text';
import type { Intent } from './parser';

export const HELP_TEXT = [
  '🕯 <b>Bot nhắc ngày giỗ gia đình</b>',
  '',
  '<b>Lệnh:</b>',
  '/homnay - Ngày giỗ hôm nay',
  '/thangnay - Trong tháng dương này',
  '/thangam - Trong tháng âm hiện tại',
  '/thangtoi - Trong tháng dương tới',
  '/saptoi - Trong 30 ngày tới',
  '/namnay - Trong năm nay',
  '/tim [tên] - Tìm theo tên, quan hệ hoặc gia đình',
  '/giadinh - Gia đình đã tham gia, chưa tham gia và cách đăng ký',
  '/giadinh [tên] - Xem ngày giỗ trong phạm vi được cấp',
  '/dangky Tên gia đình | Họ tên - Đăng ký nhận tin',
  '/huydangky Tên gia đình - Hủy đăng ký gia đình',
  '/help - Xem hướng dẫn',
  '',
  '<b>Hoặc hỏi tự nhiên, có dấu hay không dấu đều được:</b>',
  '• Tháng này có giỗ ai?',
  '• Tháng sau có những ngày giỗ nào?',
  '• Tuần tới có giỗ không?',
  '• Giỗ ông nội còn bao nhiêu ngày?',
  '• Ngày giỗ gần nhất là ngày nào?',
  '• Gia đình nào đã tham gia, gia đình nào chưa?',
].join('\n');

function daysLeftLabel(days: number): string {
  if (days === 0) return 'hôm nay';
  if (days === 1) return 'ngày mai';
  if (days > 0) return `còn ${days} ngày`;
  return `đã qua ${-days} ngày`;
}

function itemLine(item: OccurrenceItem): string {
  const { event, occurrence, daysLeft } = item;
  const date = `${weekdayLabel(occurrence.solarDate)} ${formatDateVN(occurrence.solarDate)}`;
  const adjusted = occurrence.adjustment === 'none' ? '' : ' (đã áp dụng quy tắc tháng thiếu)';
  const relationship = event.relationship ? ` (${escapeHtml(event.relationship)})` : '';
  return (
    `• <b>${escapeHtml(event.fullName)}</b>${relationship}\n` +
    `   ${formatLunarLabel(occurrence)} âm${adjusted} · ${date} · ${daysLeftLabel(daysLeft)}`
  );
}

function listReply(title: string, events: MemorialEvent[], from: ISODate, to: ISODate, today: ISODate): string {
  const { items, unresolved } = listOccurrences(events, from, to, today);
  const lines = [`📋 <b>${title}</b>`, ''];
  if (items.length === 0 && unresolved.length === 0) lines.push('Không có ngày giỗ nào.');
  lines.push(...items.map(itemLine));
  if (unresolved.length > 0) {
    lines.push('', '⚠️ Cần xử lý trên website (ngày âm không tồn tại trong năm):');
    lines.push(...unresolved.map((u) => `• ${escapeHtml(u.event.fullName)}: ${formatLunarLabel(u.unresolved)}`));
  }
  return lines.join('\n');
}

export function buildReply(intent: Intent, events: MemorialEvent[], today: ISODate): string {
  const { year, month } = parseISODate(today);

  switch (intent.type) {
    case 'start':
    case 'help':
      return HELP_TEXT;
    case 'today':
      return listReply(`Ngày giỗ hôm nay (${formatDateVN(today)})`, events, today, today, today);
    case 'tomorrow': {
      const tomorrow = addDays(today, 1);
      return listReply(`Ngày giỗ ngày mai (${formatDateVN(tomorrow)})`, events, tomorrow, tomorrow, today);
    }
    case 'this_month': {
      const r = solarMonthRange(year, month);
      return listReply(`Ngày giỗ tháng ${month}/${year}`, events, r.from, r.to, today);
    }
    case 'next_month': {
      const next = nextSolarMonth(year, month);
      const r = solarMonthRange(next.year, next.month);
      return listReply(`Ngày giỗ tháng ${next.month}/${next.year}`, events, r.from, r.to, today);
    }
    case 'specific_month': {
      const r = solarMonthRange(year, intent.month);
      return listReply(`Ngày giỗ tháng ${intent.month}/${year}`, events, r.from, r.to, today);
    }
    case 'lunar_month': {
      const r = lunarMonthRangeOf(today);
      const label = `${r.month}${r.isLeap ? ' nhuận' : ''}`;
      return listReply(
        `Ngày giỗ tháng ${label} âm lịch (${formatDateVN(r.from)} - ${formatDateVN(r.to)})`,
        events,
        r.from,
        r.to,
        today,
      );
    }
    case 'this_week': {
      const r = weekRange(today);
      return listReply(`Ngày giỗ tuần này (${formatDateVN(r.from)} - ${formatDateVN(r.to)})`, events, r.from, r.to, today);
    }
    case 'next_week': {
      const r = weekRange(addDays(today, 7));
      return listReply(`Ngày giỗ tuần tới (${formatDateVN(r.from)} - ${formatDateVN(r.to)})`, events, r.from, r.to, today);
    }
    case 'upcoming':
      return listReply('Ngày giỗ trong 30 ngày tới', events, today, addDays(today, 30), today);
    case 'this_year':
      return listReply(`Ngày giỗ năm ${year}`, events, toISODate(year, 1, 1), toISODate(year, 12, 31), today);
    case 'nearest': {
      const items = nearestItems(events, today);
      if (items.length === 0) return 'Chưa có ngày giỗ nào được lưu.';
      return ['📌 <b>Ngày giỗ gần nhất</b>', '', ...items.map(itemLine)].join('\n');
    }
    case 'search':
      if (!intent.query) return 'Cách dùng: /tim tên hoặc quan hệ, ví dụ: /tim ông nội';
      return personReply(intent.query, events, today);
    case 'person':
      return personReply(intent.query, events, today);
    case 'family':
      return familyReply(intent.query, events, today);
    case 'chat_id':
    case 'unknown':
      return 'Mình chưa hiểu câu này. Thử /help hoặc chọn nhanh bên dưới nhé.';
  }
}

function familyReply(query: string, events: MemorialEvent[], today: ISODate): string {
  const families = new Map<string, MemorialEvent[]>();
  for (const event of events) {
    if (event.familyName) families.set(event.familyName, [...(families.get(event.familyName) ?? []), event]);
  }
  if (families.size === 0) return 'Chưa có ngày giỗ nào được xếp vào gia đình.';

  if (!query) {
    const names = [...families.entries()].map(([name, list]) => `• ${escapeHtml(name)}: ${list.length} ngày giỗ`);
    return ['🏠 <b>Các gia đình</b>', '', ...names, '', 'Xem chi tiết: /giadinh tên gia đình'].join('\n');
  }

  const q = normalizeVietnamese(query);
  const matches = [...families.entries()].filter(([name]) => normalizeVietnamese(name).includes(q));
  if (matches.length === 0) return `Không tìm thấy gia đình nào khớp "${escapeHtml(query)}".`;
  const lines: string[] = [];
  for (const [name, list] of matches) {
    const items = list
      .map((event) => ({ event, occurrence: nextOccurrence(event, today) }))
      .filter((x): x is Pick<OccurrenceItem, 'event' | 'occurrence'> => x.occurrence !== null)
      .map((x) => ({ ...x, daysLeft: diffDays(today, x.occurrence.solarDate) }))
      .sort((a, b) => a.daysLeft - b.daysLeft);
    lines.push(`🏠 <b>${escapeHtml(name)}</b>`, '', ...items.map(itemLine), '');
  }
  return lines.join('\n').trim();
}

function personReply(query: string, events: MemorialEvent[], today: ISODate): string {
  const matches = searchEvents(events, query);
  if (matches.length === 0) return `Không tìm thấy ngày giỗ nào khớp "${escapeHtml(query)}".`;
  const lines = [`🔎 <b>Kết quả cho "${escapeHtml(query)}"</b>`, ''];
  for (const event of matches) {
    const occurrence = nextOccurrence(event, today);
    if (occurrence) {
      lines.push(itemLine({ event, occurrence, daysLeft: diffDays(today, occurrence.solarDate) }));
    } else {
      lines.push(`• <b>${escapeHtml(event.fullName)}</b>: chưa xác định được ngày, kiểm tra quy tắc trên website`);
    }
    if (event.notes) lines.push(`   📝 ${escapeHtml(event.notes)}`);
  }
  return lines.join('\n');
}

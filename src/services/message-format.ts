import type { MemorialEvent, Occurrence } from '../types/domain';
import { formatDateVN } from '../utils/dates';
import { escapeHtml } from '../utils/text';
import { formatLunarLabel } from './occurrences';

export interface ReminderItem {
  event: MemorialEvent;
  occurrence: Occurrence;
  daysBefore: number;
}

function personLabel(event: MemorialEvent): string {
  const name = escapeHtml(event.fullName);
  return event.relationship ? `${name} (${escapeHtml(event.relationship)})` : name;
}

function lunarLine(o: Occurrence): string {
  const label = formatLunarLabel(o);
  if (o.adjustment === 'last_day') return `${label} (tháng thiếu, dùng ngày cuối tháng)`;
  if (o.adjustment === 'next_day') return `${label} (tháng thiếu, dùng mùng 1 tháng sau)`;
  return label;
}

function remainingLabel(daysBefore: number): string {
  return daysBefore === 0 ? 'Hôm nay' : `${daysBefore} ngày`;
}

function itemBlock(item: ReminderItem): string {
  const { event, occurrence, daysBefore } = item;
  const lines = [
    `👤 Người mất: ${personLabel(event)}`,
    ...(event.familyName ? [`🏠 Gia đình: ${escapeHtml(event.familyName)}`] : []),
    `📅 Ngày giỗ âm: ${lunarLine(occurrence)}`,
    `📆 Ngày dương: ${formatDateVN(occurrence.solarDate)}`,
    `⏳ Còn lại: ${remainingLabel(daysBefore)}`,
  ];
  if (event.notes) lines.push(`📝 Ghi chú: ${escapeHtml(event.notes)}`);
  return lines.join('\n');
}

/** Một tin nhắn cho một hoặc nhiều ngày giỗ, gần nhất xếp trước. */
export function formatReminderMessage(items: ReminderItem[]): string {
  const sorted = [...items].sort((a, b) => a.daysBefore - b.daysBefore);
  const header =
    sorted.length === 1
      ? '🔔 <b>NHẮC NGÀY GIỖ GIA ĐÌNH</b>'
      : `🔔 <b>NHẮC NGÀY GIỖ GIA ĐÌNH</b> (${sorted.length} ngày giỗ)`;
  return `${header}\n\n${sorted.map(itemBlock).join('\n\n')}`;
}

/**
 * Chia nhắc nhở thành các tin không vượt giới hạn 4096 ký tự của Telegram.
 * Chia theo nhóm ngày giỗ để mỗi tin thành công/thất bại được ghi đúng vào log tương ứng.
 */
export function chunkReminders(items: ReminderItem[], limit = 3800): ReminderItem[][] {
  const chunks: ReminderItem[][] = [];
  let current: ReminderItem[] = [];
  for (const item of [...items].sort((a, b) => a.daysBefore - b.daysBefore)) {
    const candidate = [...current, item];
    if (current.length > 0 && formatReminderMessage(candidate).length > limit) {
      chunks.push(current);
      current = [item];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

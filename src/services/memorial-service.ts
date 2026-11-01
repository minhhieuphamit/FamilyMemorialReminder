/**
 * Truy vấn lịch giỗ trên danh sách sự kiện đã nạp: danh sách theo khoảng ngày, tháng, tìm kiếm...
 * Dữ liệu gia đình nhỏ nên lọc trong bộ nhớ để đơn giản và tìm kiếm được không dấu.
 */
import type { FamilyScope } from '../database/chats-repo';
import type {
  EventView,
  ItemDTO,
  MemorialEvent,
  OccurrenceItem,
  UnresolvedItem,
} from '../types/domain';
import { addDays, diffDays, parseISODate, toISODate, type ISODate } from '../utils/dates';
import { getLunarMonthLength, lunarToSolar, solarToLunar } from '../utils/lunar-calendar';
import { normalizeVietnamese } from '../utils/text';
import { nextOccurrence, occurrencesBetween } from './occurrences';

export function listOccurrences(
  events: MemorialEvent[],
  from: ISODate,
  to: ISODate,
  today: ISODate,
): { items: OccurrenceItem[]; unresolved: UnresolvedItem[] } {
  const items: OccurrenceItem[] = [];
  const unresolved: UnresolvedItem[] = [];
  for (const event of events) {
    const resolved = occurrencesBetween(event, from, to);
    for (const occurrence of resolved.occurrences) {
      items.push({ event, occurrence, daysLeft: diffDays(today, occurrence.solarDate) });
    }
    for (const u of resolved.unresolved) unresolved.push({ event, unresolved: u });
  }
  items.sort(
    (a, b) =>
      a.occurrence.solarDate.localeCompare(b.occurrence.solarDate) ||
      a.event.fullName.localeCompare(b.event.fullName, 'vi'),
  );
  return { items, unresolved };
}

/** Khoảng ngày dương của tháng âm chứa `date`. */
export function lunarMonthRangeOf(date: ISODate): { from: ISODate; to: ISODate; month: number; isLeap: boolean; year: number } {
  const lunar = solarToLunar(parseISODate(date));
  const start = lunarToSolar({ ...lunar, day: 1 })!;
  const from = toISODate(start.year, start.month, start.day);
  const length = getLunarMonthLength(lunar.year, lunar.month, lunar.isLeap)!;
  return { from, to: addDays(from, length - 1), month: lunar.month, isLeap: lunar.isLeap, year: lunar.year };
}

export function nearestItems(events: MemorialEvent[], today: ISODate): OccurrenceItem[] {
  const all = events
    .map((event) => ({ event, occurrence: nextOccurrence(event, today) }))
    .filter((x): x is { event: MemorialEvent; occurrence: NonNullable<typeof x.occurrence> } => x.occurrence !== null)
    .map(({ event, occurrence }) => ({ event, occurrence, daysLeft: diffDays(today, occurrence.solarDate) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
  return all.filter((x) => x.daysLeft === all[0].daysLeft);
}

/** Tìm không phân biệt dấu theo tên, quan hệ, gia đình và ghi chú. */
export function searchEvents(events: MemorialEvent[], query: string, includeNotes = false): MemorialEvent[] {
  const q = normalizeVietnamese(query);
  if (!q) return events;
  return events.filter((e) =>
    normalizeVietnamese(`${e.fullName} ${e.relationship} ${e.familyName ?? ''} ${includeNotes ? e.notes : ''}`).includes(q),
  );
}

/** Lọc theo tham số gia đình: rỗng là tất cả, "none" là chưa thuộc gia đình nào. */
export function filterByFamily(events: MemorialEvent[], family: string | undefined): MemorialEvent[] {
  if (!family) return events;
  if (family === 'none') return events.filter((e) => e.familyId === null);
  return events.filter((e) => e.familyId === Number(family));
}

/**
 * Chỉ giữ ngày giỗ thuộc phạm vi của chat. Ngày giỗ chưa có gia đình
 * chỉ hiện với chat được xem mọi gia đình, để xóa gia đình không làm lộ dữ liệu sang chat khác.
 */
export function filterByScope<T extends { familyId: number | null }>(events: T[], scope: FamilyScope): T[] {
  if (scope.allFamilies) return events;
  return events.filter((e) => e.familyId !== null && scope.familyIds.includes(e.familyId));
}

export function buildEventView(event: MemorialEvent, today: ISODate): EventView {
  const { year } = parseISODate(today);
  const resolved = occurrencesBetween(event, toISODate(year, 1, 1), toISODate(year, 12, 31));
  const next = nextOccurrence(event, today);
  return {
    ...event,
    next: next ? { ...next, daysLeft: diffDays(today, next.solarDate) } : null,
    thisYear: resolved.occurrences,
    unresolved: resolved.unresolved,
  };
}

export function toItemDTO(item: OccurrenceItem): ItemDTO {
  return {
    eventId: item.event.id,
    fullName: item.event.fullName,
    relationship: item.event.relationship,
    familyId: item.event.familyId,
    familyName: item.event.familyName,
    notes: item.event.notes,
    occurrence: item.occurrence,
    daysLeft: item.daysLeft,
  };
}

export function toUnresolvedDTO(item: UnresolvedItem) {
  return {
    eventId: item.event.id,
    fullName: item.event.fullName,
    relationship: item.event.relationship,
    unresolved: item.unresolved,
  };
}

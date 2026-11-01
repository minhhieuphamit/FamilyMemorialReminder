/**
 * Tìm nhắc nhở đến hạn và gửi qua các kênh đã cấu hình. Mọi lần chạy đều idempotent:
 * dedupe_key "<event>:<ngày giỗ>:<mốc nhắc>:<chat>" chỉ được gửi thành công một lần.
 */
import { listNotificationChats } from '../database/chats-repo';
import { listEvents } from '../database/events-repo';
import { claimReminders, insertResendLogs, markLogsFailed, markLogsSent, type ClaimRequest } from '../database/logs-repo';
import { getNotificationsEnabled, listFamilyCronConfigs, listReminderSettings, type FamilyCronConfig } from '../database/settings-repo';
import type { Channel, CronRunResult, MemorialEvent, NotificationChat } from '../types/domain';
import { addDays, diffDays, todayInVietnam, type ISODate } from '../utils/dates';
import { BotApiError } from './bot-api';
import { cardCaption, type CardProvider } from './card-image';
import type { Senders } from './channel-senders';
import { filterByScope } from './memorial-service';
import { chunkReminders, formatReminderMessage, type ReminderItem } from './message-format';
import { occurrencesBetween } from './occurrences';

/** Nhắc nhở đến hạn hôm nay, theo mốc riêng của ngày giỗ hoặc mốc chung. */
export function findDueReminders(events: MemorialEvent[], defaultOffsets: number[], today: ISODate): ReminderItem[] {
  const due: ReminderItem[] = [];
  for (const event of events) {
    if (!event.reminderEnabled) continue;
    const offsets = event.reminderOffsets ?? defaultOffsets;
    if (offsets.length === 0) continue;
    const { occurrences } = occurrencesBetween(event, today, addDays(today, Math.max(...offsets)));
    for (const occurrence of occurrences) {
      const daysBefore = diffDays(today, occurrence.solarDate);
      if (offsets.includes(daysBefore)) due.push({ event, occurrence, daysBefore });
    }
  }
  return due;
}

/**
 * Áp cấu hình gia đình: bỏ ngày giỗ của gia đình đã tắt thông báo, và dùng lịch nhắc của gia đình.
 * Thứ tự ưu tiên mốc nhắc: riêng của ngày giỗ, của gia đình, rồi lịch chung.
 */
export function applyFamilyConfigs(events: MemorialEvent[], configs: Map<number, FamilyCronConfig>): MemorialEvent[] {
  return events.flatMap((event) => {
    const config = event.familyId === null ? undefined : configs.get(event.familyId);
    if (config && !config.enabled) return [];
    return [{ ...event, reminderOffsets: event.reminderOffsets ?? config?.offsets ?? null }];
  });
}

/** Khóa của Telegram giữ nguyên định dạng cũ để các tin đã gửi trước đây vẫn được nhận ra. */
export function dedupeKey(item: ReminderItem, channel: Channel, chatId: string): string {
  const target = channel === 'telegram' ? chatId : `${channel}:${chatId}`;
  return `${item.event.id}:${item.occurrence.solarDate}:${item.daysBefore}:${target}`;
}

/** Các nhắc nhở mà chat được nhận theo phạm vi gia đình. */
export function remindersForChat(due: ReminderItem[], chat: NotificationChat): ReminderItem[] {
  const visible = new Set(filterByScope(due.map((item) => item.event), chat).map((event) => event.id));
  return due.filter((item) => visible.has(item.event.id));
}

/**
 * Mặc định mỗi nhắc chỉ gửi thành công một lần, dùng cho cron.
 * force (nút "Chạy ngay") gửi lại cả những nhắc đã gửi; nhắc chưa gửi vẫn được đánh dấu để cron không gửi thêm lần nữa.
 */
export async function runReminders(
  db: D1Database,
  senders: Senders,
  now: Date,
  options: { force?: boolean; familyId?: number | null; cards?: CardProvider | null } = {},
): Promise<CronRunResult> {
  const today = todayInVietnam(now);
  const result: CronRunResult = { ranAt: now.toISOString(), today, due: 0, sent: 0, failed: 0, skipped: 0 };

  if (!senders.telegram && !senders.zalo) return { ...result, note: 'Chưa cấu hình kênh gửi nào' };
  if (!(await getNotificationsEnabled(db))) return { ...result, note: 'Thông báo đang tắt' };

  const [allEvents, settings, allChats, familyConfigs] = await Promise.all([
    listEvents(db),
    listReminderSettings(db),
    listNotificationChats(db),
    listFamilyCronConfigs(db),
  ]);
  const chats = allChats.filter((chat) => senders[chat.channel]);
  const offsets = settings.filter((s) => s.enabled).map((s) => s.daysBefore);
  const events = options.familyId == null ? allEvents : allEvents.filter((e) => e.familyId === options.familyId);
  const due = findDueReminders(applyFamilyConfigs(events, familyConfigs), offsets, today);
  result.due = due.length;
  if (due.length === 0) return result;
  if (chats.length === 0) return { ...result, note: 'Chưa có Chat ID nhận thông báo' };

  const imageUrls = new Map<string, string | null>();
  for (const chat of chats) {
    const sender = senders[chat.channel]!;
    const forChat = remindersForChat(due, chat);
    const requests: ClaimRequest[] = forChat.map((item) => ({
      dedupeKey: dedupeKey(item, chat.channel, chat.chatId),
      eventId: item.event.id,
      eventName: item.event.fullName,
      occurrenceDate: item.occurrence.solarDate,
      daysBefore: item.daysBefore,
      scheduledDate: today,
      channel: chat.channel,
      chatId: chat.chatId,
      familyId: item.event.familyId,
    }));
    const claimed = await claimReminders(db, requests, now);
    if (options.force) {
      const resends = await insertResendLogs(db, requests.filter((r) => !claimed.has(r.dedupeKey)), now);
      resends.forEach((id, key) => claimed.set(key, id));
    }
    const toSend = forChat.filter((item) => claimed.has(dedupeKey(item, chat.channel, chat.chatId)));
    result.skipped += forChat.length - toSend.length;

    // Ưu tiên ảnh thiệp, mỗi ngày giỗ một ảnh. Không tạo hay gửi được ảnh thì gửi bằng chữ: nhắc không bao giờ bị mất vì ảnh.
    const asText: ReminderItem[] = [];
    for (const item of toSend) {
      const key = `${item.event.id}:${item.occurrence.solarDate}:${item.daysBefore}`;
      if (!imageUrls.has(key)) imageUrls.set(key, sender.sendPhoto && options.cards ? await options.cards.imageUrlFor(item) : null);
      const imageUrl = imageUrls.get(key);
      if (!imageUrl || !sender.sendPhoto) {
        asText.push(item);
        continue;
      }
      try {
        const messageId = await sender.sendPhoto(chat.chatId, imageUrl, cardCaption(item));
        await markLogsSent(db, [claimed.get(dedupeKey(item, chat.channel, chat.chatId))!], messageId, now);
        result.sent += 1;
      } catch (err) {
        console.warn(`Gửi ảnh thiệp thất bại cho ${chat.channel} ${chat.chatId}, chuyển sang chữ: ${err instanceof Error ? err.message : String(err)}`);
        asText.push(item);
      }
    }

    for (const chunk of chunkReminders(asText, sender.messageLimit)) {
      const ids = chunk.map((item) => claimed.get(dedupeKey(item, chat.channel, chat.chatId))!);
      try {
        const messageId = await sender.send(chat.chatId, formatReminderMessage(chunk));
        await markLogsSent(db, ids, messageId, now);
        result.sent += chunk.length;
      } catch (err) {
        const retryable = err instanceof BotApiError ? err.retryable : true;
        const message = err instanceof Error ? err.message : String(err);
        await markLogsFailed(db, ids, message, retryable);
        result.failed += chunk.length;
        console.error(`Gửi nhắc thất bại cho ${chat.channel} ${chat.chatId}: ${message}`);
      }
    }
  }
  return result;
}

import { handleRegistration, handleReviewCommand, handleUnregistration, sendRegistrationFamilies, GROUP_REGISTRATION_HELP, REGISTRATION_HELP, type RegistrationContext } from '../services/registration-service';
import { getChatAccess } from '../database/chats-repo';
import { listEvents } from '../database/events-repo';
import { cardCaption, type CardProvider } from '../services/card-image';
import { telegramSender, type ChannelSender } from '../services/channel-senders';
import { filterByScope, listOccurrences } from '../services/memorial-service';
import type { InlineKeyboard, TelegramClient } from '../services/telegram-client';
import type { Channel, MemorialEvent } from '../types/domain';
import { todayInVietnam, type ISODate } from '../utils/dates';
import { splitMessage } from '../utils/text';
import { isFamilyDirectoryQuestion, parseMessage, stripBotMention } from './parser';
import { buildReply } from './replies';

/** Phần cần dùng trong Telegram Update. */
export interface TelegramUpdate {
  update_id?: number;
  message?: {
    text?: string;
    chat: { id: number; type: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number; type: string } };
  };
}

/** Phần cần dùng trong sự kiện webhook của Zalo Bot. */
export interface ZaloUpdate {
  event_name?: string;
  message?: {
    text?: string;
    chat?: { id?: string; chat_type?: string };
  };
}

export const MENU_KEYBOARD: InlineKeyboard = {
  inline_keyboard: [
    [
      { text: 'Hôm nay', callback_data: '/homnay' },
      { text: 'Gần nhất', callback_data: '/gannhat' },
      { text: '30 ngày tới', callback_data: '/saptoi' },
    ],
    [
      { text: 'Tháng này', callback_data: '/thangnay' },
      { text: 'Tháng tới', callback_data: '/thangtoi' },
      { text: 'Tháng âm', callback_data: '/thangam' },
    ],
    [
      { text: 'Cả năm', callback_data: '/namnay' },
      { text: 'Gia đình', callback_data: '/giadinh' },
      { text: 'Hướng dẫn', callback_data: '/help' },
    ],
  ],
};

export const BOT_COMMANDS = [
  { command: 'homnay', description: 'Ngày giỗ hôm nay' },
  { command: 'thangnay', description: 'Ngày giỗ trong tháng dương này' },
  { command: 'thangam', description: 'Ngày giỗ trong tháng âm hiện tại' },
  { command: 'thangtoi', description: 'Ngày giỗ trong tháng dương tới' },
  { command: 'saptoi', description: 'Ngày giỗ trong 30 ngày tới' },
  { command: 'namnay', description: 'Ngày giỗ trong năm nay' },
  { command: 'tim', description: 'Tìm theo tên: /tim ông nội' },
  { command: 'giadinh', description: 'Xem theo gia đình: /giadinh nhà nội' },
  { command: 'danhsachgiadinh', description: 'Gia đình đã tham gia và chưa tham gia' },
  { command: 'dangky', description: 'Đăng ký: /dangky Tên gia đình | Họ tên' },
  { command: 'huydangky', description: 'Hủy đăng ký: /huydangky Tên gia đình' },
  { command: 'help', description: 'Hướng dẫn sử dụng' },
];

export interface IncomingMessage {
  channel: Channel;
  chatId: string;
  text: string;
  isGroup: boolean;
  fromButton?: boolean;
  /** Tin trong nhóm có nhắc tên bot: người gửi đang hỏi bot nên luôn cần trả lời. */
  mentioned?: boolean;
}

/**
 * Gửi thiệp cho các ngày giỗ hôm nay, trả về những ngày giỗ còn phải trả lời bằng chữ.
 * Không tạo hay gửi được ảnh thì giữ lại để gửi chữ, như khi nhắc tự động.
 */
async function sendTodayCards(events: MemorialEvent[], today: ISODate, chatId: string, sender: ChannelSender, cards: CardProvider): Promise<MemorialEvent[]> {
  const carded = new Set<number>();
  for (const { event, occurrence, daysLeft } of listOccurrences(events, today, today, today).items) {
    const item = { event, occurrence, daysBefore: daysLeft };
    const imageUrl = await cards.imageUrlFor(item);
    if (!imageUrl) continue;
    try {
      await sender.sendPhoto!(chatId, imageUrl, cardCaption(item));
      carded.add(event.id);
    } catch (err) {
      console.warn(`Gửi ảnh thiệp thất bại, chuyển sang chữ: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return events.filter((event) => !carded.has(event.id));
}

/** Xử lý một tin nhắn đến, chung cho mọi kênh: kiểm tra quyền, lọc theo gia đình, trả lời. */
export async function handleIncoming(message: IncomingMessage, db: D1Database, sender: ChannelSender, now: Date, registration?: RegistrationContext): Promise<void> {
  const { channel, chatId, text } = message;
  if (await handleReviewCommand(message, db, sender, registration)) return;
  if (await handleUnregistration(message, db, sender)) return;
  if (await handleRegistration(message, db, sender, now, registration)) return;
  const intent = parseMessage(text);

  // Chat ID và tên gia đình công khai phục vụ đăng ký; dữ liệu ngày giỗ vẫn cần quyền.
  if (intent.type === 'chat_id') {
    await sender.send(chatId, `Chat ID của bạn: <code>${chatId}</code>`);
    return;
  }

  if ((intent.type === 'family' && !intent.query) || /^\/danhsachgiadinh(?:@\S+)?$/i.test(text.trim()) || isFamilyDirectoryQuestion(text)) {
    await sendRegistrationFamilies(db, sender, chatId, channel, message.mentioned);
    return;
  }
  const access = await getChatAccess(db, channel, chatId);
  if (!access) {
    if (intent.type === 'start' || intent.type === 'help' || message.mentioned) {
      await sender.send(
        chatId,
        `Chat này chưa được cấp quyền.\nChat ID: <code>${chatId}</code>\n${message.mentioned ? GROUP_REGISTRATION_HELP : REGISTRATION_HELP}`,
      );
      await sendRegistrationFamilies(db, sender, chatId, channel, message.mentioned);
    }
    return;
  }

  // Trong nhóm, không chen vào các câu chuyện không liên quan đến ngày giỗ.
  if (intent.type === 'unknown' && !intent.isCommand && message.isGroup && !message.mentioned) return;

  let events = filterByScope(await listEvents(db), access);
  const today = todayInVietnam(now);
  if (intent.type === 'today' && registration?.cards && sender.sendPhoto) {
    const remaining = await sendTodayCards(events, today, chatId, sender, registration.cards);
    const left = listOccurrences(remaining, today, today, today);
    // Đã gửi đủ thiệp thì thôi; hôm nay không có giỗ vẫn trả lời bằng chữ như thường.
    if (remaining.length < events.length && left.items.length === 0 && left.unresolved.length === 0) return;
    events = remaining;
  }
  const reply = buildReply(intent, events, today);
  const showMenu = intent.type === 'start' || intent.type === 'help' || intent.type === 'unknown' || message.fromButton;

  const parts = splitMessage(reply, sender.messageLimit);
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    await sender.send(chatId, parts[i], { keyboard: isLast && showMenu ? MENU_KEYBOARD : undefined });
  }
}

export async function handleTelegramUpdate(
  update: TelegramUpdate,
  db: D1Database,
  telegram: TelegramClient,
  now: Date,
  registration?: RegistrationContext,
): Promise<void> {
  const callback = update.callback_query;
  const chat = callback ? callback.message?.chat : update.message?.chat;
  const text = callback ? callback.data : update.message?.text;

  if (callback) await telegram.answerCallbackQuery(callback.id);
  if (!chat || !text) return;

  await handleIncoming(
    { channel: 'telegram', chatId: String(chat.id), text, isGroup: chat.type !== 'private', fromButton: callback !== undefined },
    db,
    telegramSender(telegram),
    now,
    registration,
  );
}

export async function handleZaloUpdate(update: ZaloUpdate, db: D1Database, sender: ChannelSender, now: Date, registration?: RegistrationContext): Promise<void> {
  const chatId = update.message?.chat?.id;
  const text = update.message?.text;
  if (update.event_name !== 'message.text.received' || !chatId || !text) return;

  const isGroup = update.message?.chat?.chat_type !== 'PRIVATE';
  const mention = isGroup ? stripBotMention(text, registration?.zaloBotName) : { text, mentioned: false };
  // Zalo chưa công bố định dạng nhắc tên; ghi lại khi không nhận ra để còn sửa nếu định dạng khác.
  if (isGroup && !mention.mentioned) console.warn(`Tin nhóm Zalo không nhận ra nhắc tên: ${text.slice(0, 80)}`);

  await handleIncoming(
    { channel: 'zalo', chatId, text: mention.text, isGroup, mentioned: mention.mentioned },
    db,
    sender,
    now,
    registration,
  );
}

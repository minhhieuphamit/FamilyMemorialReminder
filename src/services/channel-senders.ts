/** Lớp gửi tin chung để phần nhắc nhở và bot không cần biết đang gửi qua kênh nào. */
import type { Channel } from '../types/domain';
import type { Env } from '../types/env';
import { htmlToPlainText } from '../utils/text';
import { createTelegramClient, type InlineKeyboard, type TelegramClient } from './telegram-client';
import { createZaloClient, type ZaloClient } from './zalo-client';

export interface ChannelSender {
  /** Giới hạn an toàn cho một tin, thấp hơn giới hạn thật của kênh. */
  messageLimit: number;
  /** Nội dung viết theo HTML của Telegram; kênh không dùng được sẽ tự chuyển. Trả về id tin nhắn. */
  send(chatId: string, html: string, options?: { keyboard?: InlineKeyboard }): Promise<string>;
  /** Gửi ảnh từ địa chỉ công khai kèm chú thích. Trả về id tin nhắn. */
  sendPhoto?(chatId: string, photoUrl: string, captionHtml: string): Promise<string>;
}

export type Senders = Partial<Record<Channel, ChannelSender>>;

export function telegramSender(client: TelegramClient): ChannelSender {
  return {
    messageLimit: 3800,
    async send(chatId, html, options) {
      const message = await client.sendMessage(chatId, html, { html: true, keyboard: options?.keyboard });
      return String(message.message_id);
    },
    async sendPhoto(chatId, photoUrl, captionHtml) {
      const message = await client.sendPhoto(chatId, photoUrl, captionHtml);
      return String(message.message_id);
    },
  };
}

/** Zalo tối đa 2000 ký tự mỗi tin và không có nút bấm. Gửi văn bản thuần để không phụ thuộc cách Zalo đọc HTML. */
export function zaloSender(client: ZaloClient): ChannelSender {
  return {
    messageLimit: 1900,
    async send(chatId, html) {
      const message = await client.sendMessage(chatId, htmlToPlainText(html));
      return message.message_id;
    },
    async sendPhoto(chatId, photoUrl, captionHtml) {
      const message = await client.sendPhoto(chatId, photoUrl, htmlToPlainText(captionHtml));
      return message.message_id;
    },
  };
}

export function createSenders(env: Env): Senders {
  const senders: Senders = {};
  if (env.TELEGRAM_BOT_TOKEN) senders.telegram = telegramSender(createTelegramClient(env.TELEGRAM_BOT_TOKEN));
  if (env.ZALO_BOT_TOKEN) senders.zalo = zaloSender(createZaloClient(env.ZALO_BOT_TOKEN));
  return senders;
}

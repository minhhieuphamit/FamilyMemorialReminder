import type { BotApiError } from '../../src/services/bot-api';
import type { ChannelSender } from '../../src/services/channel-senders';
import type { TelegramClient } from '../../src/services/telegram-client';
import type { MemorialEvent } from '../../src/types/domain';

export function makeEvent(overrides: Partial<MemorialEvent> = {}): MemorialEvent {
  return {
    id: 1,
    familyId: null,
    familyName: null,
    fullName: 'Nguyễn Văn An',
    relationship: 'Ông nội',
    lunarDay: 15,
    lunarMonth: 8,
    isLeapMonth: false,
    deathYear: null,
    deathSolarDate: null,
    notes: '',
    leapMonthRule: 'exact',
    missingDayRule: 'skip',
    reminderEnabled: true,
    reminderOffsets: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export interface SentMessage {
  chatId: string;
  text: string;
  keyboard: boolean;
}

/** Telegram giả: ghi lại tin đã gửi; `failFor` cho biết chat nào đang lỗi. */
export function makeFakeTelegram(failFor: Map<string, BotApiError> = new Map()) {
  const sent: SentMessage[] = [];
  const answered: string[] = [];
  let nextId = 100;
  const client: TelegramClient = {
    async sendMessage(chatId, text, options) {
      const failure = failFor.get(chatId);
      if (failure) throw failure;
      sent.push({ chatId, text, keyboard: Boolean(options?.keyboard) });
      return { message_id: nextId++ };
    },
    async sendPhoto(chatId, _url, caption) {
      const failure = failFor.get(chatId);
      if (failure) throw failure;
      sent.push({ chatId, text: caption, keyboard: false });
      return { message_id: nextId++ };
    },
    async answerCallbackQuery(id) {
      answered.push(id);
    },
    getMe: async () => ({ username: 'test_bot', first_name: 'Test' }),
    getWebhookInfo: async () => ({ url: '', pending_update_count: 0 }),
    setWebhook: async () => {},
    deleteWebhook: async () => {},
    setMyCommands: async () => {},
  };
  return { client, sent, answered };
}

export const VN_7AM = (date: string) => new Date(`${date}T00:00:00.000Z`);

/** Kênh giả có hỗ trợ ảnh: ghi lại tin và ảnh đã gửi, văn bản giữ nguyên như sender nhận được. */
export function makeFakeSender(failFor: Map<string, BotApiError> = new Map()) {
  const sent: { chatId: string; text: string }[] = [];
  const photos: { chatId: string; url: string; caption: string }[] = [];
  const failPhotos = new Map<string, BotApiError>();
  const sender: ChannelSender = {
    messageLimit: 1900,
    async send(chatId, text) {
      const failure = failFor.get(chatId);
      if (failure) throw failure;
      sent.push({ chatId, text });
      return 'abc123';
    },
    async sendPhoto(chatId, url, caption) {
      const failure = failPhotos.get(chatId);
      if (failure) throw failure;
      photos.push({ chatId, url, caption });
      return 'photo-1';
    },
  };
  return { sender, sent, photos, failPhotos };
}

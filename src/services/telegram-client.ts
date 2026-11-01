/** Client tối giản cho Telegram Bot API. */
import { createBotApi, type BotApiOptions } from './bot-api';

export interface InlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export interface TelegramClient {
  sendMessage(chatId: string, text: string, options?: { html?: boolean; keyboard?: InlineKeyboard }): Promise<{ message_id: number }>;
  /** Telegram tự tải ảnh từ địa chỉ này. Chú thích tối đa 1024 ký tự. */
  sendPhoto(chatId: string, photoUrl: string, captionHtml: string): Promise<{ message_id: number }>;
  answerCallbackQuery(id: string): Promise<void>;
  getMe(): Promise<{ username: string; first_name: string }>;
  getWebhookInfo(): Promise<{ url: string; pending_update_count: number; last_error_message?: string }>;
  setWebhook(url: string, secretToken: string): Promise<void>;
  deleteWebhook(): Promise<void>;
  setMyCommands(commands: { command: string; description: string }[]): Promise<void>;
}

/** 401/404 là token sai: thử lại ngay vô ích, nhưng sửa token xong thì lượt cron sau gửi lại được. 400/403 là lỗi của chat. */
function classifyTelegramError(code: number) {
  const transient = code === 429 || code >= 500;
  return { transient, retryable: transient || code === 401 || code === 404 };
}

export function createTelegramClient(token: string, options: BotApiOptions = {}): TelegramClient {
  const call = createBotApi({ ...options, baseUrl: 'https://api.telegram.org', token, classify: classifyTelegramError });

  return {
    sendMessage(chatId, text, opts = {}) {
      return call('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: opts.html ? 'HTML' : undefined,
        reply_markup: opts.keyboard,
        link_preview_options: { is_disabled: true },
      });
    },
    sendPhoto(chatId, photoUrl, captionHtml) {
      return call('sendPhoto', { chat_id: chatId, photo: photoUrl, caption: captionHtml, parse_mode: 'HTML' });
    },
    async answerCallbackQuery(id) {
      await call('answerCallbackQuery', { callback_query_id: id });
    },
    getMe: () => call('getMe'),
    getWebhookInfo: () => call('getWebhookInfo'),
    async setWebhook(url, secretToken) {
      await call('setWebhook', {
        url,
        secret_token: secretToken,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true,
      });
    },
    async deleteWebhook() {
      await call('deleteWebhook');
    },
    async setMyCommands(commands) {
      await call('setMyCommands', { commands });
    },
  };
}

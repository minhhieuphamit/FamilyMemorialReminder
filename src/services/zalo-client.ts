/** Client cho Zalo Bot Platform (https://bot.zapps.me/docs/). */
import { createBotApi, type BotApiOptions } from './bot-api';

export interface ZaloClient {
  sendMessage(chatId: string, text: string): Promise<{ message_id: string }>;
  sendPhoto(chatId: string, photoUrl: string, caption: string): Promise<{ message_id: string }>;
  getMe(): Promise<{ id: string; account_name: string }>;
  getWebhookInfo(): Promise<{ url: string }>;
  setWebhook(url: string, secretToken: string): Promise<{ verification?: { ok: boolean; hint?: string } }>;
}

/**
 * Theo bảng mã lỗi của Zalo: 408 hết thời gian, 403 là lỗi nội bộ máy chủ, 429 vượt hạn mức.
 * 401 là token sai hoặc hết hạn: sửa xong thì lượt cron sau gửi lại được. 400/404 không thử lại.
 */
function classifyZaloError(code: number) {
  const transient = code === 408 || code === 403 || code === 429 || code >= 500;
  return { transient, retryable: transient || code === 401 };
}

export function createZaloClient(token: string, options: BotApiOptions = {}): ZaloClient {
  const call = createBotApi({ ...options, baseUrl: 'https://bot-api.zaloplatforms.com', token, classify: classifyZaloError });

  return {
    sendMessage: (chatId, text) => call('sendMessage', { chat_id: chatId, text }),
    sendPhoto: (chatId, photoUrl, caption) => call('sendPhoto', { chat_id: chatId, photo: photoUrl, caption }),
    getMe: () => call('getMe'),
    getWebhookInfo: () => call('getWebhookInfo'),
    setWebhook: (url, secretToken) => call('setWebhook', { url, secret_token: secretToken }),
  };
}

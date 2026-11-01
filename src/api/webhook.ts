import { Hono, type Context } from 'hono';
import { handleTelegramUpdate, handleZaloUpdate, type TelegramUpdate, type ZaloUpdate } from '../bot/handler';
import { rateLimit } from '../middleware/security';
import { createCardProvider } from '../services/card-image';
import { createSenders, zaloSender } from '../services/channel-senders';
import { createTelegramClient } from '../services/telegram-client';
import { createZaloClient } from '../services/zalo-client';
import type { AppEnv } from '../types/env';
import { constantTimeEqual } from '../utils/crypto';

const CARD_RENDER_TIMEOUT_MS = 15_000;

/** Thiệp chưa có sẵn chỉ tạo một tấm và chờ có hạn, để trả lời kịp trước khi relay Zalo (25 giây) bỏ cuộc; quá hạn thì trả lời bằng chữ. */
function botContext(c: Context<AppEnv>) {
  return {
    senders: createSenders(c.env),
    baseUrl: c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin,
    zaloBotName: c.env.ZALO_BOT_NAME,
    cards: createCardProvider(c.env, {
      maxRenders: 1,
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(CARD_RENDER_TIMEOUT_MS) }),
    }),
  };
}

/** Xác thực secret rồi xử lý. Lỗi xử lý vẫn trả 200 để nền tảng không gửi lại cùng một tin nhiều lần. */
async function handleWebhook<T>(
  c: Context<AppEnv>,
  config: { token?: string; secret?: string; header: string },
  process: (update: T, token: string) => Promise<void>,
) {
  if (!config.secret || !config.token) return c.json({ error: 'Webhook chưa được cấu hình' }, 503);

  const provided = c.req.header(config.header) ?? '';
  if (!(await constantTimeEqual(provided, config.secret))) return c.json({ error: 'Không có quyền' }, 401);

  const update = await c.req.json<T>().catch(() => null);
  if (update) {
    try {
      await process(update, config.token);
    } catch (err) {
      console.error(`Lỗi xử lý webhook: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return c.json({ ok: true });
}

export const telegramWebhookRoutes = new Hono<AppEnv>();

telegramWebhookRoutes.post('/webhook', rateLimit({ prefix: 'webhook', limit: 120, windowMs: 60_000 }), (c) =>
  handleWebhook<TelegramUpdate>(
    c,
    { token: c.env.TELEGRAM_BOT_TOKEN, secret: c.env.TELEGRAM_WEBHOOK_SECRET, header: 'x-telegram-bot-api-secret-token' },
    (update, token) => handleTelegramUpdate(update, c.env.DB, createTelegramClient(token, { retries: 1 }), new Date(), botContext(c)),
  ),
);

export const zaloWebhookRoutes = new Hono<AppEnv>();

zaloWebhookRoutes.post('/webhook', rateLimit({ prefix: 'zalo-webhook', limit: 120, windowMs: 60_000 }), (c) =>
  handleWebhook<ZaloUpdate & { result?: ZaloUpdate }>(
    c,
    { token: c.env.ZALO_BOT_TOKEN, secret: c.env.ZALO_WEBHOOK_SECRET, header: 'x-bot-api-secret-token' },
    (update, token) =>
      // Tài liệu getUpdates bọc sự kiện trong result; webhook gửi trực tiếp. Nhận cả hai cho chắc.
      handleZaloUpdate(update.result ?? update, c.env.DB, zaloSender(createZaloClient(token, { retries: 1 })), new Date(), botContext(c)),
  ),
);

import { Hono } from 'hono';
import { BOT_COMMANDS } from '../bot/handler';
import { createChat, deleteChat, linkChatToFamily, listChats, unlinkChatFromFamily, updateChat } from '../database/chats-repo';
import { listFamilies } from '../database/families-repo';
import { insertTestLog, listLogs } from '../database/logs-repo';
import { familyScope, requireAdmin, visibleEvents } from '../middleware/auth';
import { CardRenderError, createCardProvider, isCardConfigured, renderCardHtml, renderCardImage } from '../services/card-image';
import { createSenders } from '../services/channel-senders';
import { nearestItems } from '../services/memorial-service';
import { runReminders } from '../services/notification-service';
import { createTelegramClient } from '../services/telegram-client';
import { createZaloClient } from '../services/zalo-client';
import { CHANNELS, type Channel, type ChannelStatus, type NotificationChat, type NotificationStatus } from '../types/domain';
import type { AppEnv, Env } from '../types/env';
import { formatDateVN, todayInVietnam } from '../utils/dates';
import { isValidChatId } from '../utils/validation';

export const channelRoutes = new Hono<AppEnv>();

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

function webhookUrl(env: Env, requestUrl: string, channel: Channel): string {
  if (channel === 'zalo' && env.ZALO_WEBHOOK_URL) return env.ZALO_WEBHOOK_URL;
  return `${new URL(requestUrl).origin}/${channel}/webhook`;
}

async function readStatus(env: Env, channel: Channel, requestUrl: string): Promise<ChannelStatus> {
  const token = channel === 'telegram' ? env.TELEGRAM_BOT_TOKEN : env.ZALO_BOT_TOKEN;
  const status: ChannelStatus = {
    channel,
    tokenConfigured: Boolean(token),
    webhookSecretConfigured: Boolean(channel === 'telegram' ? env.TELEGRAM_WEBHOOK_SECRET : env.ZALO_WEBHOOK_SECRET),
    bot: null,
    webhook: null,
    expectedWebhookUrl: webhookUrl(env, requestUrl, channel),
    error: null,
  };
  if (!token) return status;
  try {
    if (channel === 'telegram') {
      const client = createTelegramClient(token);
      const [me, info] = await Promise.all([client.getMe(), client.getWebhookInfo()]);
      status.bot = { name: `@${me.username}` };
      status.webhook = { url: info.url, pendingUpdates: info.pending_update_count, lastError: info.last_error_message ?? null };
    } else {
      const client = createZaloClient(token);
      const [me, info] = await Promise.all([client.getMe(), client.getWebhookInfo()]);
      status.bot = { name: me.account_name };
      status.webhook = { url: info.url, pendingUpdates: null, lastError: null };
    }
  } catch (err) {
    status.error = errorMessage(err);
  }
  return status;
}

function parseChannel(value: unknown): Channel | null {
  return CHANNELS.includes(value as Channel) ? (value as Channel) : null;
}

/** Góc nhìn của tài khoản gia đình: không lộ gia đình khác đang dùng chung chat. */
function viewForFamily(chat: NotificationChat, familyId: number): NotificationChat {
  const editable = !chat.allFamilies && chat.familyIds.length === 1;
  return { ...chat, title: editable ? chat.title : '', allFamilies: false, familyIds: [familyId], editable };
}

async function chatsForFamily(db: D1Database, familyId: number): Promise<NotificationChat[]> {
  return (await listChats(db)).filter((chat) => chat.familyIds.includes(familyId)).map((chat) => viewForFamily(chat, familyId));
}

channelRoutes.use('/channels/*', requireAdmin);

channelRoutes.get('/channels/:channel/status', async (c) => {
  const channel = parseChannel(c.req.param('channel'));
  if (!channel) return c.json({ error: 'Kênh không hợp lệ' }, 404);
  return c.json(await readStatus(c.env, channel, c.req.url));
});

channelRoutes.post('/channels/:channel/webhook', async (c) => {
  const channel = parseChannel(c.req.param('channel'));
  if (!channel) return c.json({ error: 'Kênh không hợp lệ' }, 404);
  const url = webhookUrl(c.env, c.req.url, channel);
  try {
    if (channel === 'telegram') {
      if (!c.env.TELEGRAM_BOT_TOKEN || !c.env.TELEGRAM_WEBHOOK_SECRET) {
        return c.json({ error: 'Cần cấu hình TELEGRAM_BOT_TOKEN và TELEGRAM_WEBHOOK_SECRET trước' }, 400);
      }
      const client = createTelegramClient(c.env.TELEGRAM_BOT_TOKEN);
      await client.setWebhook(url, c.env.TELEGRAM_WEBHOOK_SECRET);
      await client.setMyCommands(BOT_COMMANDS);
      return c.json({ ok: true, url });
    }
    if (!c.env.ZALO_BOT_TOKEN || !c.env.ZALO_WEBHOOK_SECRET) {
      return c.json({ error: 'Cần cấu hình ZALO_BOT_TOKEN và ZALO_WEBHOOK_SECRET trước' }, 400);
    }
    if (c.env.ZALO_WEBHOOK_SECRET.length < 8) return c.json({ error: 'ZALO_WEBHOOK_SECRET phải dài ít nhất 8 ký tự' }, 400);
    const result = await createZaloClient(c.env.ZALO_BOT_TOKEN).setWebhook(url, c.env.ZALO_WEBHOOK_SECRET);
    if (result.verification && !result.verification.ok) {
      return c.json({ error: `Zalo chưa gọi được webhook: ${result.verification.hint ?? 'không rõ lý do'}` }, 502);
    }
    return c.json({ ok: true, url });
  } catch (err) {
    return c.json({ error: errorMessage(err) }, 502);
  }
});

/** Đọc phần phạm vi gia đình trong body; null nếu có id không tồn tại. */
async function parseFamilyScope(db: D1Database, body: Record<string, unknown>) {
  const allFamilies = body.allFamilies !== false;
  if (allFamilies) return { allFamilies, familyIds: [] as number[] };
  const familyIds = Array.isArray(body.familyIds) ? [...new Set(body.familyIds as number[])] : [];
  const known = new Set((await listFamilies(db)).map((f) => f.id));
  return familyIds.every((id) => known.has(id)) ? { allFamilies, familyIds } : null;
}

channelRoutes.get('/chats', async (c) => {
  const scope = familyScope(c);
  return c.json({ chats: scope === null ? await listChats(c.env.DB) : await chatsForFamily(c.env.DB, scope) });
});

channelRoutes.post('/chats', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const channel = parseChannel(body?.channel ?? 'telegram');
  const chatId = typeof body?.chatId === 'string' ? body.chatId.trim() : '';
  if (!body || !channel) return c.json({ error: 'Dữ liệu không hợp lệ' }, 400);
  if (!isValidChatId(channel, chatId)) {
    const hint = channel === 'telegram' ? 'Chat ID Telegram phải là một số, nhóm có thể bắt đầu bằng dấu trừ' : 'Chat ID Zalo không hợp lệ';
    return c.json({ error: hint }, 400);
  }

  const familyId = familyScope(c);
  if (familyId !== null) {
    // Cùng một người có thể thuộc nhiều gia đình: chat đã có thì chỉ nối thêm vào gia đình này.
    const existing = (await listChats(c.env.DB)).find((x) => x.channel === channel && x.chatId === chatId);
    if (existing) {
      if (existing.familyIds.includes(familyId)) return c.json({ error: 'Chat ID này đã có trong danh sách' }, 409);
      await linkChatToFamily(c.env.DB, existing.id, familyId);
      return c.json({ chat: viewForFamily({ ...existing, familyIds: [...existing.familyIds, familyId] }, familyId) }, 201);
    }
    const created = await createChat(c.env.DB, {
      channel,
      chatId,
      title: typeof body.title === 'string' ? body.title.trim().slice(0, 100) : '',
      canQuery: body.canQuery !== false,
      receiveNotifications: body.receiveNotifications !== false,
      allFamilies: false,
      familyIds: [familyId],
    });
    return c.json({ chat: viewForFamily(created!, familyId) }, 201);
  }

  const scope = await parseFamilyScope(c.env.DB, body);
  if (!scope) return c.json({ error: 'Gia đình không tồn tại' }, 400);
  const chat = await createChat(c.env.DB, {
    channel,
    chatId,
    title: typeof body.title === 'string' ? body.title.trim().slice(0, 100) : '',
    canQuery: body.canQuery !== false,
    receiveNotifications: body.receiveNotifications !== false,
    ...scope,
  });
  if (!chat) return c.json({ error: 'Chat ID này đã có trong danh sách' }, 409);
  return c.json({ chat }, 201);
});

channelRoutes.put('/chats/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!Number.isInteger(id) || !body) return c.json({ error: 'Dữ liệu không hợp lệ' }, 400);

  const existingChats = await listChats(c.env.DB);
  const current = existingChats.find((chat) => chat.id === id);
  const familyId = familyScope(c);
  if (!current || (familyId !== null && !current.familyIds.includes(familyId))) return c.json({ error: 'Không tìm thấy chat' }, 404);
  if (familyId !== null && (current.allFamilies || current.familyIds.length !== 1)) return c.json({ error: 'Chat dùng chung không được phép sửa' }, 403);
  const chatId = body.chatId === undefined ? current.chatId : typeof body.chatId === 'string' ? body.chatId.trim() : '';
  if (!isValidChatId(current.channel, chatId)) return c.json({ error: 'Chat ID không hợp lệ' }, 400);
  if (existingChats.some((chat) => chat.id !== id && chat.channel === current.channel && chat.chatId === chatId)) return c.json({ error: 'Chat ID này đã có trong danh sách' }, 409);
  if (familyId !== null) {
    const chat = await updateChat(c.env.DB, id, {
      chatId,
      title: typeof body.title === 'string' ? body.title.trim().slice(0, 100) : '',
      canQuery: body.canQuery === true,
      receiveNotifications: body.receiveNotifications === true,
      // Không nhận phạm vi từ request: gia đình không thể tự mở chat sang dữ liệu nhà khác.
      allFamilies: false,
      familyIds: [familyId],
    });
    return c.json({ chat: chat && viewForFamily(chat, familyId) });
  }

  const scope = await parseFamilyScope(c.env.DB, body);
  if (!scope) return c.json({ error: 'Gia đình không tồn tại' }, 400);
  const chat = await updateChat(c.env.DB, id, {
    chatId,
    title: typeof body.title === 'string' ? body.title.trim().slice(0, 100) : '',
    canQuery: body.canQuery === true,
    receiveNotifications: body.receiveNotifications === true,
    ...scope,
  });
  if (!chat) return c.json({ error: 'Không tìm thấy chat' }, 404);
  return c.json({ chat });
});

channelRoutes.delete('/chats/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const familyId = familyScope(c);
  if (familyId !== null) {
    const chat = (await listChats(c.env.DB)).find((x) => x.id === id);
    if (!chat || !chat.familyIds.includes(familyId)) return c.json({ error: 'Không tìm thấy chat' }, 404);
    // Chỉ xóa hẳn khi không còn gia đình nào khác dùng chat này.
    if (!chat.allFamilies && chat.familyIds.length === 1) await deleteChat(c.env.DB, id);
    else await unlinkChatFromFamily(c.env.DB, id, familyId);
    return c.json({ ok: true });
  }
  if (!Number.isInteger(id) || !(await deleteChat(c.env.DB, id))) {
    return c.json({ error: 'Không tìm thấy chat' }, 404);
  }
  return c.json({ ok: true });
});

// Gửi thử tới một chat, hoặc mọi chat nhận thông báo nếu không chỉ định.
channelRoutes.post('/chats/test', async (c) => {
  const senders = createSenders(c.env);
  const body = await c.req.json<{ id?: unknown }>().catch(() => null);
  const familyId = familyScope(c);
  const available = familyId === null ? await listChats(c.env.DB) : await chatsForFamily(c.env.DB, familyId);
  const targets =
    typeof body?.id === 'number'
      ? available.filter((chat) => chat.id === body.id)
      : available.filter((chat) => chat.receiveNotifications);
  if (targets.length === 0) return c.json({ error: 'Không có Chat ID phù hợp để gửi thử' }, 400);

  const now = new Date();
  const today = todayInVietnam(now);
  const text = `✅ <b>Tin nhắn thử</b>\nBot nhắc ngày giỗ đã kết nối thành công (${formatDateVN(today)}).`;
  const results = [];
  for (const chat of targets) {
    const sender = senders[chat.channel];
    let messageId: string | null = null;
    let error: string | null = null;
    try {
      if (!sender) throw new Error(`Chưa cấu hình token cho ${chat.channel}`);
      messageId = await sender.send(chat.chatId, text);
    } catch (err) {
      error = errorMessage(err);
    }
    await insertTestLog(c.env.DB, { channel: chat.channel, familyId, chatId: chat.chatId, scheduledDate: today, status: error ? 'failed' : 'sent', error, messageId, now });
    results.push({ chatId: chat.chatId, ok: error === null, error: error ?? undefined });
  }
  return c.json({ results });
});

// Chạy ngay đợt nhắc của hôm nay. Mỗi lần bấm đều gửi lại, kể cả nhắc đã gửi.
channelRoutes.post('/notifications/run-now', async (c) => {
  const result = await runReminders(c.env.DB, createSenders(c.env), new Date(), {
    force: true,
    familyId: familyScope(c),
    cards: createCardProvider(c.env),
  });
  return c.json({ result });
});

// Xem thử ảnh thiệp bằng ngày giỗ gần nhất của tài khoản đang đăng nhập.
channelRoutes.post('/notifications/card-preview', async (c) => {
  if (!isCardConfigured(c.env)) {
    return c.json({ error: 'Chưa cấu hình ảnh thiệp: cần PUBLIC_BASE_URL, BROWSER_RUN_ACCOUNT_ID và BROWSER_RUN_TOKEN' }, 400);
  }
  const today = todayInVietnam();
  const nearest = nearestItems(await visibleEvents(c), today)[0];
  if (!nearest) return c.json({ error: 'Chưa có ngày giỗ nào để xem thử' }, 400);
  const html = renderCardHtml({ event: nearest.event, occurrence: nearest.occurrence, daysBefore: nearest.daysLeft }, c.env.PUBLIC_BASE_URL!.replace(/\/+$/, ''));
  try {
    return c.body(await renderCardImage(c.env, html), 200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
  } catch (err) {
    const status = err instanceof CardRenderError ? err.status : 0;
    const message = status === 429 ? 'Cloudflare chỉ cho tạo 1 ảnh mỗi 10 giây, vui lòng thử lại sau' : `Không tạo được ảnh: ${errorMessage(err)}`;
    return c.json({ error: message }, 502);
  }
});

const STATUSES: NotificationStatus[] = ['pending', 'sending', 'sent', 'failed'];

channelRoutes.get('/notifications/logs', async (c) => {
  const requestedPage = Number(c.req.query('page'));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const statusParam = c.req.query('status') as NotificationStatus | undefined;
  const status = statusParam && STATUSES.includes(statusParam) ? statusParam : undefined;
  const requestedSize = Number(c.req.query('pageSize'));
  const pageSize = [10, 20, 50].includes(requestedSize) ? requestedSize : 10;
  const { logs, total } = await listLogs(c.env.DB, { page, pageSize, status, familyId: familyScope(c) });
  return c.json({ logs, total, page, pageSize });
});

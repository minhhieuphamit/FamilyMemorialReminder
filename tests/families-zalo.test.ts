import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api';
import { handleZaloUpdate, type ZaloUpdate } from '../src/bot/handler';
import { parseMessage } from '../src/bot/parser';
import { buildReply } from '../src/bot/replies';
import { createChat, updateChat } from '../src/database/chats-repo';
import { createEvent } from '../src/database/events-repo';
import { createFamily, deleteFamily } from '../src/database/families-repo';
import { BotApiError } from '../src/services/bot-api';
import { zaloSender } from '../src/services/channel-senders';
import { filterByFamily, filterByScope } from '../src/services/memorial-service';
import { formatReminderMessage } from '../src/services/message-format';
import { runReminders } from '../src/services/notification-service';
import { createZaloClient } from '../src/services/zalo-client';
import type { MemorialEventInput } from '../src/types/domain';
import type { Env } from '../src/types/env';
import { htmlToPlainText } from '../src/utils/text';
import { isValidChatId } from '../src/utils/validation';
import { createTestDb } from './helpers/fake-d1';
import { makeEvent, makeFakeSender, VN_7AM } from './helpers/factories';

function input(overrides: Partial<MemorialEventInput>): MemorialEventInput {
  const { id: _i, createdAt: _c, updatedAt: _u, familyName: _n, ...rest } = makeEvent();
  return { ...rest, ...overrides };
}

// 15/8 âm 2026 là 25/09/2026.
const DUE_DAY = VN_7AM('2026-09-22');

describe('Phân nhóm theo gia đình', () => {
  let db: D1Database;
  let raw: ReturnType<typeof createTestDb>['raw'];
  let noi: number;
  let ngoai: number;

  beforeEach(async () => {
    ({ db, raw } = createTestDb());
    noi = (await createFamily(db, 'Nhà nội')).id;
    ngoai = (await createFamily(db, 'Nhà ngoại')).id;
    await createEvent(db, input({ fullName: 'Ông Nội', familyId: noi }));
    await createEvent(db, input({ fullName: 'Ông Ngoại', familyId: ngoai }));
    await createEvent(db, input({ fullName: 'Chưa Xếp', familyId: null }));
  });

  it('lọc danh sách theo gia đình và theo chưa xếp', () => {
    const events = [makeEvent({ id: 1, familyId: 5 }), makeEvent({ id: 2, familyId: null })];
    expect(filterByFamily(events, '5').map((e) => e.id)).toEqual([1]);
    expect(filterByFamily(events, 'none').map((e) => e.id)).toEqual([2]);
    expect(filterByFamily(events, undefined)).toHaveLength(2);
  });

  it('phạm vi chat: ngày giỗ chưa xếp chỉ hiện với chat được xem mọi gia đình', () => {
    const events = [makeEvent({ id: 1, familyId: 5 }), makeEvent({ id: 2, familyId: null })];
    expect(filterByScope(events, { allFamilies: true, familyIds: [] })).toHaveLength(2);
    expect(filterByScope(events, { allFamilies: false, familyIds: [5] }).map((e) => e.id)).toEqual([1]);
    expect(filterByScope(events, { allFamilies: false, familyIds: [] })).toEqual([]);
  });

  it('chat chỉ nhận nhắc của gia đình được chọn, chat chung nhận tất cả', async () => {
    await createChat(db, { chatId: '1', title: 'Chung', canQuery: true, receiveNotifications: true });
    await createChat(db, { chatId: '2', title: 'Nội', canQuery: true, receiveNotifications: true, allFamilies: false, familyIds: [noi] });
    const fake = makeFakeSender();
    await runReminders(db, { telegram: fake.sender }, DUE_DAY);

    const toAll = fake.sent.find((m) => m.chatId === '1')!.text;
    expect(toAll).toContain('Ông Nội');
    expect(toAll).toContain('Ông Ngoại');
    expect(toAll).toContain('Chưa Xếp');
    const toNoi = fake.sent.find((m) => m.chatId === '2')!.text;
    expect(toNoi).toContain('Ông Nội');
    expect(toNoi).not.toContain('Ông Ngoại');
    expect(toNoi).not.toContain('Chưa Xếp');
  });

  it('xóa gia đình: ngày giỗ vẫn còn, và chat bị giới hạn KHÔNG thấy thêm dữ liệu', async () => {
    await createChat(db, { chatId: '2', title: 'Nội', canQuery: true, receiveNotifications: true, allFamilies: false, familyIds: [noi] });
    await deleteFamily(db, noi);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM memorial_events').get()).toEqual({ n: 3 });
    const fake = makeFakeSender();
    await runReminders(db, { telegram: fake.sender }, DUE_DAY);
    expect(fake.sent).toEqual([]);
  });

  it('bot chỉ trả lời trong phạm vi gia đình của chat', async () => {
    await createChat(db, { channel: 'zalo', chatId: 'z1', title: 'Nội', canQuery: true, receiveNotifications: true, allFamilies: false, familyIds: [noi] });
    const fake = makeFakeSender();
    const update: ZaloUpdate = { event_name: 'message.text.received', message: { text: '/namnay', chat: { id: 'z1', chat_type: 'PRIVATE' } } };
    await handleZaloUpdate(update, db, fake.sender, DUE_DAY);
    expect(fake.sent[0].text).toContain('Ông Nội');
    expect(fake.sent[0].text).not.toContain('Ông Ngoại');
    expect(fake.sent[0].text).not.toContain('Chưa Xếp');
  });

  it('đổi phạm vi chat được lưu lại', async () => {
    const chat = await createChat(db, { chatId: '2', title: '', canQuery: true, receiveNotifications: true });
    const updated = await updateChat(db, chat!.id, { title: '', canQuery: true, receiveNotifications: true, allFamilies: false, familyIds: [ngoai] });
    expect(updated).toMatchObject({ allFamilies: false, familyIds: [ngoai] });
  });

  it('/giadinh liệt kê và xem chi tiết không dấu', () => {
    expect(parseMessage('/giadinh nhà ngoại')).toEqual({ type: 'family', query: 'nhà ngoại' });
    const events = [
      makeEvent({ id: 1, fullName: 'Ông Nội', familyId: 1, familyName: 'Nhà nội' }),
      makeEvent({ id: 2, fullName: 'Ông Ngoại', familyId: 2, familyName: 'Nhà ngoại' }),
    ];
    expect(buildReply({ type: 'family', query: '' }, events, '2026-09-22')).toContain('Nhà nội: 1 ngày giỗ');
    const detail = buildReply({ type: 'family', query: 'nha ngoai' }, events, '2026-09-22');
    expect(detail).toContain('Ông Ngoại');
    expect(detail).not.toContain('Ông Nội');
    expect(buildReply({ type: 'search', query: 'nha noi' }, events, '2026-09-22')).toContain('Ông Nội');
  });

  it('tin nhắc có dòng gia đình khi ngày giỗ thuộc gia đình', () => {
    const occurrence = { solarDate: '2026-09-25', lunarDay: 15, lunarMonth: 8, lunarYear: 2026, isLeapMonth: false, adjustment: 'none' as const };
    const text = formatReminderMessage([{ event: makeEvent({ familyName: 'Nhà nội' }), occurrence, daysBefore: 3 }]);
    expect(text).toContain('🏠 Gia đình: Nhà nội');
    expect(formatReminderMessage([{ event: makeEvent(), occurrence, daysBefore: 3 }])).not.toContain('Gia đình:');
  });
});

describe('Migration từ dữ liệu cũ', () => {
  it('nâng cấp database đang chạy: giữ ngày giỗ, Chat ID, quyền và lịch sử gửi', () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec('PRAGMA foreign_keys = ON');
    const migration = (name: string) => readFileSync(join(process.cwd(), 'migrations', name), 'utf8');
    raw.exec(migration('0001_initial_schema.sql'));
    raw.exec(migration('0002_default_settings.sql'));
    raw.exec(`
      INSERT INTO memorial_events (full_name, relationship, lunar_day, lunar_month) VALUES ('An', 'Bố', 15, 8);
      INSERT INTO telegram_chats (chat_id, title, can_query, receive_notifications) VALUES ('-100', 'Nhóm', 0, 1);
      INSERT INTO notification_logs (dedupe_key, event_id, event_name, scheduled_date, chat_id, status, telegram_message_id)
        VALUES ('1:2026-09-25:3:-100', 1, 'An', '2026-09-22', '-100', 'sent', 555);
    `);

    raw.exec(migration('0003_families_and_zalo.sql'));

    expect(raw.prepare('SELECT family_id, full_name FROM memorial_events').all()).toEqual([{ family_id: null, full_name: 'An' }]);
    expect(raw.prepare('SELECT channel, chat_id, title, can_query, receive_notifications, all_families FROM chats').all()).toEqual([
      { channel: 'telegram', chat_id: '-100', title: 'Nhóm', can_query: 0, receive_notifications: 1, all_families: 1 },
    ]);
    expect(raw.prepare('SELECT channel, dedupe_key, provider_message_id, status FROM notification_logs').all()).toEqual([
      { channel: 'telegram', dedupe_key: '1:2026-09-25:3:-100', provider_message_id: '555', status: 'sent' },
    ]);
    expect(raw.prepare(`SELECT name FROM sqlite_master WHERE name = 'telegram_chats'`).get()).toBeUndefined();
  });

  it('tin đã gửi trước khi nâng cấp không bị gửi lại', async () => {
    const { db, raw } = createTestDb();
    await createEvent(db, input({}));
    await createChat(db, { chatId: '111', title: '', canQuery: true, receiveNotifications: true });
    raw.prepare(
      `INSERT INTO notification_logs (dedupe_key, event_id, event_name, scheduled_date, chat_id, status)
       VALUES ('1:2026-09-25:3:111', 1, 'An', '2026-09-22', '111', 'sent')`,
    ).run();
    const fake = makeFakeSender();
    await runReminders(db, { telegram: fake.sender }, DUE_DAY);
    expect(fake.sent).toEqual([]);
  });
});

describe('Gửi qua Zalo', () => {
  let db: D1Database;

  beforeEach(async () => {
    ({ db } = createTestDb());
    await createEvent(db, input({ notes: 'A & B <đồ cúng>' }));
    await createChat(db, { chatId: '111', title: 'TG', canQuery: true, receiveNotifications: true });
    await createChat(db, { channel: 'zalo', chatId: 'abc.xyz', title: 'Zalo', canQuery: true, receiveNotifications: true });
  });

  it('gửi trên cả hai kênh, mỗi kênh một dedupe_key và log đúng kênh', async () => {
    const tg = makeFakeSender();
    const zalo = makeFakeSender();
    await runReminders(db, { telegram: tg.sender, zalo: zalo.sender }, DUE_DAY);
    expect(tg.sent.map((m) => m.chatId)).toEqual(['111']);
    expect(zalo.sent.map((m) => m.chatId)).toEqual(['abc.xyz']);

    const { results } = await db.prepare('SELECT channel, dedupe_key, provider_message_id FROM notification_logs ORDER BY id').all();
    expect(results).toEqual([
      { channel: 'telegram', dedupe_key: '1:2026-09-25:3:111', provider_message_id: 'abc123' },
      { channel: 'zalo', dedupe_key: '1:2026-09-25:3:zalo:abc.xyz', provider_message_id: 'abc123' },
    ]);
  });

  it('chạy lại không gửi trùng trên Zalo', async () => {
    const zalo = makeFakeSender();
    await runReminders(db, { zalo: zalo.sender }, DUE_DAY);
    await runReminders(db, { zalo: zalo.sender }, DUE_DAY);
    expect(zalo.sent).toHaveLength(1);
  });

  it('chưa cấu hình Zalo thì bỏ qua chat Zalo, Telegram vẫn gửi và không tạo log Zalo', async () => {
    const tg = makeFakeSender();
    await runReminders(db, { telegram: tg.sender }, DUE_DAY);
    expect(tg.sent).toHaveLength(1);
    const { results } = await db.prepare(`SELECT id FROM notification_logs WHERE channel = 'zalo'`).all();
    expect(results).toEqual([]);
  });

  it('Zalo lỗi không chặn Telegram, và được gửi lại ở lượt sau', async () => {
    const failures = new Map([['abc.xyz', new BotApiError('Quota exceeded', 429, true)]]);
    const zalo = makeFakeSender(failures);
    const tg = makeFakeSender();
    const first = await runReminders(db, { telegram: tg.sender, zalo: zalo.sender }, DUE_DAY);
    expect(first).toMatchObject({ sent: 1, failed: 1 });
    failures.clear();
    const second = await runReminders(db, { telegram: tg.sender, zalo: zalo.sender }, DUE_DAY);
    expect(second).toMatchObject({ sent: 1, skipped: 1 });
    expect(tg.sent).toHaveLength(1);
  });

  it('nút Chạy ngay gửi lại nhắc đã gửi, mỗi lần một dòng lịch sử', async () => {
    const zalo = makeFakeSender();
    await runReminders(db, { zalo: zalo.sender }, DUE_DAY);
    const again = await runReminders(db, { zalo: zalo.sender }, DUE_DAY, { force: true });
    await runReminders(db, { zalo: zalo.sender }, DUE_DAY, { force: true });
    expect(again).toMatchObject({ sent: 1, skipped: 0 });
    expect(zalo.sent).toHaveLength(3);
    const { results } = await db.prepare(`SELECT status, dedupe_key FROM notification_logs WHERE channel = 'zalo' ORDER BY id`).all();
    expect(results).toEqual([
      { status: 'sent', dedupe_key: '1:2026-09-25:3:zalo:abc.xyz' },
      { status: 'sent', dedupe_key: null },
      { status: 'sent', dedupe_key: null },
    ]);
  });

  it('bấm Chạy ngay trước giờ cron thì cron không gửi thêm', async () => {
    const zalo = makeFakeSender();
    await runReminders(db, { zalo: zalo.sender }, DUE_DAY, { force: true });
    const cron = await runReminders(db, { zalo: zalo.sender }, DUE_DAY);
    expect(zalo.sent).toHaveLength(1);
    expect(cron).toMatchObject({ sent: 0, skipped: 1 });
  });

  it('gửi lại thủ công bị lỗi được ghi lịch sử và cron không tự thử lại dòng đó', async () => {
    const failures = new Map<string, BotApiError>();
    const zalo = makeFakeSender(failures);
    await runReminders(db, { zalo: zalo.sender }, DUE_DAY);
    failures.set('abc.xyz', new BotApiError('Bad Gateway', 502, true));
    const forced = await runReminders(db, { zalo: zalo.sender }, DUE_DAY, { force: true });
    expect(forced).toMatchObject({ sent: 0, failed: 1 });
    failures.clear();
    await runReminders(db, { zalo: zalo.sender }, DUE_DAY);
    expect(zalo.sent).toHaveLength(1);
  });

  it('tin dài được chia dưới giới hạn 2000 ký tự của Zalo', async () => {
    for (let i = 0; i < 15; i++) await createEvent(db, input({ fullName: `Người ${i}`, notes: 'x'.repeat(200) }));
    const zalo = makeFakeSender();
    await runReminders(db, { zalo: zalo.sender }, DUE_DAY);
    expect(zalo.sent.length).toBeGreaterThan(1);
    for (const message of zalo.sent) expect(message.text.length).toBeLessThanOrEqual(2000);
  });

  it('bot Zalo gửi văn bản thuần, đúng đường dẫn API và tham số', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const client = createZaloClient('TOK', {
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(init.body as string) });
        return new Response(JSON.stringify({ ok: true, result: { message_id: '82599fa3' } }));
      }) as unknown as typeof fetch,
    });
    const id = await zaloSender(client).send('abc.xyz', '<b>A &amp; B</b> &lt;c&gt;');
    expect(id).toBe('82599fa3');
    expect(calls[0].url).toBe('https://bot-api.zaloplatforms.com/botTOK/sendMessage');
    expect(calls[0].body).toEqual({ chat_id: 'abc.xyz', text: 'A & B <c>' });
  });

  it('nhận lỗi khi Zalo trả HTTP 200 kèm ok=false', async () => {
    const client = createZaloClient('TOK', {
      retries: 0,
      fetch: (async () => new Response(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' }))) as typeof fetch,
    });
    await expect(client.sendMessage('a', 'b')).rejects.toMatchObject({ status: 401, retryable: true, transient: false });
  });

  it('phân loại lỗi Zalo: 400 không thử lại, 429 và 408 thử lại, không lộ token', async () => {
    const failWith = (code: number) =>
      createZaloClient('SECRET', {
        retries: 0,
        fetch: (async () => new Response(JSON.stringify({ ok: false, error_code: code, description: 'bad SECRET' }), { status: code })) as typeof fetch,
      }).sendMessage('a', 'b');
    await expect(failWith(400)).rejects.toMatchObject({ retryable: false });
    await expect(failWith(429)).rejects.toMatchObject({ retryable: true, transient: true });
    await expect(failWith(408)).rejects.toMatchObject({ retryable: true, transient: true });
    const error = (await failWith(400).catch((e) => e)) as Error;
    expect(error.message).not.toContain('SECRET');
  });

  it('chuyển HTML sang văn bản thuần không làm mất nội dung', () => {
    expect(htmlToPlainText('<b>Tên</b> &lt;b&gt; x &amp; y <code>123</code>')).toBe('Tên <b> x & y 123');
  });

  it('định dạng Chat ID theo từng kênh', () => {
    expect(isValidChatId('telegram', '-100123')).toBe(true);
    expect(isValidChatId('telegram', 'abc.xyz')).toBe(false);
    expect(isValidChatId('zalo', '6ede9afa66b88fe6d6a9')).toBe(true);
    expect(isValidChatId('zalo', 'abc.xyz')).toBe(true);
    expect(isValidChatId('zalo', 'a b')).toBe(false);
  });
});

describe('Bot Zalo: quyền truy cập', () => {
  let db: D1Database;
  const message = (id: string, text: string, chat_type = 'PRIVATE'): ZaloUpdate => ({
    event_name: 'message.text.received',
    message: { text, chat: { id, chat_type } },
  });

  beforeEach(async () => {
    ({ db } = createTestDb());
    await createEvent(db, input({}));
    await createChat(db, { channel: 'zalo', chatId: 'ok', title: '', canQuery: true, receiveNotifications: true });
    // Cùng chuỗi ID ở Telegram không được tính là có quyền bên Zalo.
    await createChat(db, { channel: 'telegram', chatId: '999', title: '', canQuery: true, receiveNotifications: true });
  });

  it('chat được phép nhận dữ liệu', async () => {
    const fake = makeFakeSender();
    await handleZaloUpdate(message('ok', 'Tháng 9 có giỗ ai'), db, fake.sender, DUE_DAY);
    expect(fake.sent[0].text).toContain('Nguyễn Văn An');
  });

  it('chat lạ và ID chỉ có quyền ở kênh khác không nhận được dữ liệu', async () => {
    const fake = makeFakeSender();
    for (const id of ['stranger', '999']) {
      for (const text of ['/namnay', '/tim an', 'Tháng này có giỗ ai?']) {
        await handleZaloUpdate(message(id, text), db, fake.sender, DUE_DAY);
      }
    }
    expect(fake.sent).toEqual([]);
  });

  it('chat lạ nhận Chat ID và danh sách gia đình, không nhận ngày giỗ', async () => {
    const fake = makeFakeSender();
    await handleZaloUpdate(message('stranger', '/start'), db, fake.sender, DUE_DAY);
    await handleZaloUpdate(message('stranger', '/id'), db, fake.sender, DUE_DAY);
    expect(fake.sent).toHaveLength(3);
    expect(fake.sent[0].text).toContain('stranger');
    expect(fake.sent[2].text).toContain('stranger');
    for (const m of fake.sent) {
      expect(m.text).not.toContain('Nguyễn');
    }
  });

  it('bỏ qua sự kiện không phải tin văn bản', async () => {
    const fake = makeFakeSender();
    await handleZaloUpdate({ event_name: 'message.image.received', message: { chat: { id: 'ok' } } }, db, fake.sender, DUE_DAY);
    await handleZaloUpdate({}, db, fake.sender, DUE_DAY);
    expect(fake.sent).toEqual([]);
  });

  it('trong nhóm, câu không liên quan thì bot im lặng', async () => {
    const fake = makeFakeSender();
    await handleZaloUpdate(message('ok', 'ăn cơm chưa', 'GROUP'), db, fake.sender, DUE_DAY);
    expect(fake.sent).toEqual([]);
  });
});

describe('API gia đình và webhook Zalo', () => {
  const PASSWORD = 'mat-khau-thu-nghiem';
  const app = createApp();
  let env: Env;

  const request = (path: string, init: RequestInit = {}) => app.request(`https://gio.test${path}`, init, env);
  const json = (body: unknown, cookie: string, method = 'POST'): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  async function login(): Promise<string> {
    const res = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
    return res.headers.get('set-cookie')!.split(';')[0];
  }
  const EVENT = { fullName: 'An', relationship: 'Bố', lunarDay: 15, lunarMonth: 8 };

  beforeEach(() => {
    env = { DB: createTestDb().db, ASSETS: {} as Fetcher, ADMIN_PASSWORD: PASSWORD, ZALO_BOT_TOKEN: 'TOKEN', ZALO_WEBHOOK_SECRET: 'zalo-secret-1' };
  });

  it.each([
    ['GET', '/api/families'],
    ['POST', '/api/families'],
    ['PUT', '/api/families/1'],
    ['DELETE', '/api/families/1'],
    ['GET', '/api/chats'],
    ['POST', '/api/chats/test'],
    ['POST', '/api/channels/zalo/webhook'],
    ['GET', '/api/channels/zalo/status'],
    ['POST', '/api/notifications/run-now'],
  ])('%s %s từ chối khi chưa đăng nhập', async (method, path) => {
    expect((await request(path, { method })).status).toBe(401);
  });

  it('webhook Zalo từ chối khi thiếu hoặc sai secret', async () => {
    const post = (secret?: string) =>
      request('/zalo/webhook', { method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { 'x-bot-api-secret-token': secret } : {}) }, body: '{}' });
    expect((await post()).status).toBe(401);
    expect((await post('sai')).status).toBe(401);
    expect((await post('zalo-secret-1')).status).toBe(200);
    env.ZALO_WEBHOOK_SECRET = undefined;
    expect((await post('bat-ky')).status).toBe(503);
  });

  it('thêm, đổi tên, chặn trùng khi bỏ dấu, đếm số ngày giỗ, xóa', async () => {
    const cookie = await login();
    const created = await request('/api/families', json({ name: 'Nhà nội' }, cookie));
    expect(created.status).toBe(201);
    const { family } = (await created.json()) as { family: { id: number } };
    expect((await request('/api/families', json({ name: 'nha NOI' }, cookie))).status).toBe(409);
    expect((await request('/api/families', json({ name: ' ' }, cookie))).status).toBe(400);

    await request('/api/events', json({ ...EVENT, familyId: family.id }, cookie));
    const list = (await (await request('/api/families', { headers: { cookie } })).json()) as { families: { eventCount: number }[] };
    expect(list.families[0].eventCount).toBe(1);

    expect((await request(`/api/families/${family.id}`, json({ name: 'Bên nội' }, cookie, 'PUT'))).status).toBe(200);
    const events = (await (await request('/api/events', { headers: { cookie } })).json()) as { events: { familyName: string | null }[] };
    expect(events.events[0].familyName).toBe('Bên nội');

    expect((await request(`/api/families/${family.id}`, { method: 'DELETE', headers: { cookie } })).status).toBe(200);
    const after = (await (await request('/api/events', { headers: { cookie } })).json()) as { events: { familyId: number | null }[] };
    expect(after.events[0].familyId).toBeNull();
  });

  it('từ chối gia đình không tồn tại thay vì lỗi 500', async () => {
    const cookie = await login();
    expect((await request('/api/events', json({ ...EVENT, familyId: 999 }, cookie))).status).toBe(400);
    expect((await request('/api/chats', json({ chatId: '1', allFamilies: false, familyIds: [999] }, cookie))).status).toBe(400);
  });

  it('lọc lịch và danh sách theo gia đình', async () => {
    const cookie = await login();
    const { family } = (await (await request('/api/families', json({ name: 'Nội' }, cookie))).json()) as { family: { id: number } };
    await request('/api/events', json({ ...EVENT, fullName: 'Có', familyId: family.id }, cookie));
    await request('/api/events', json({ ...EVENT, fullName: 'Không' }, cookie));
    const names = async (path: string) =>
      ((await (await request(path, { headers: { cookie } })).json()) as { events: { fullName: string }[] }).events.map((e) => e.fullName);
    expect(await names(`/api/events?family=${family.id}`)).toEqual(['Có']);
    expect(await names('/api/events?family=none')).toEqual(['Không']);
    const cal = (await (await request(`/api/calendar?year=2026&month=9&family=${family.id}`, { headers: { cookie } })).json()) as { items: { fullName: string; familyName: string }[] };
    expect(cal.items).toMatchObject([{ fullName: 'Có', familyName: 'Nội' }]);
  });

  it('thêm Chat ID Zalo; cùng ID có thể tồn tại ở hai kênh', async () => {
    const cookie = await login();
    expect((await request('/api/chats', json({ channel: 'zalo', chatId: 'abc.xyz' }, cookie))).status).toBe(201);
    expect((await request('/api/chats', json({ channel: 'zalo', chatId: 'abc.xyz' }, cookie))).status).toBe(409);
    expect((await request('/api/chats', json({ channel: 'telegram', chatId: 'abc.xyz' }, cookie))).status).toBe(400);
    expect((await request('/api/chats', json({ channel: 'zalo', chatId: '123' }, cookie))).status).toBe(201);
    expect((await request('/api/chats', json({ channel: 'telegram', chatId: '123' }, cookie))).status).toBe(201);
    expect((await request('/api/chats', json({ channel: 'sms', chatId: '123' }, cookie))).status).toBe(400);
  });

  it('sao lưu JSON giữ được gia đình và phạm vi chat khi khôi phục sang database trống', async () => {
    const cookie = await login();
    const { family } = (await (await request('/api/families', json({ name: 'Nhà nội' }, cookie))).json()) as { family: { id: number } };
    await request('/api/events', json({ ...EVENT, familyId: family.id }, cookie));
    await request('/api/chats', json({ channel: 'zalo', chatId: 'z1', allFamilies: false, familyIds: [family.id] }, cookie));
    const backup = await (await request('/api/backup/export?format=json', { headers: { cookie } })).text();

    env.DB = createTestDb().db;
    const fresh = await login();
    const res = await request('/api/backup/import', json({ format: 'json', content: backup, mode: 'replace' }, fresh));
    expect(await res.json()).toEqual({ ok: true, inserted: 1, updated: 0 });
    const { events } = (await (await request('/api/events', { headers: { cookie: fresh } })).json()) as { events: { familyName: string }[] };
    expect(events[0].familyName).toBe('Nhà nội');
    const { chats } = (await (await request('/api/chats', { headers: { cookie: fresh } })).json()) as { chats: { channel: string; allFamilies: boolean; familyIds: number[] }[] };
    expect(chats).toMatchObject([{ channel: 'zalo', allFamilies: false }]);
    expect(chats[0].familyIds).toHaveLength(1);
  });

  it('nhập CSV có cột family tạo gia đình; file cũ không có cột thì giữ nguyên gia đình', async () => {
    const cookie = await login();
    const csv = 'full_name,relationship,lunar_day,lunar_month,family\r\nAn,Bố,15,8,Nhà nội\r\n';
    await request('/api/backup/import', json({ format: 'csv', content: csv, mode: 'merge' }, cookie));
    const oldCsv = 'full_name,relationship,lunar_day,lunar_month\r\nAn,Cha,15,8\r\n';
    const res = await request('/api/backup/import', json({ format: 'csv', content: oldCsv, mode: 'merge' }, cookie));
    expect(await res.json()).toEqual({ ok: true, inserted: 0, updated: 1 });
    const { events } = (await (await request('/api/events', { headers: { cookie } })).json()) as { events: { relationship: string; familyName: string }[] };
    expect(events).toMatchObject([{ relationship: 'Cha', familyName: 'Nhà nội' }]);
  });
});

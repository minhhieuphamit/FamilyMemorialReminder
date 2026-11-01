import { beforeEach, describe, expect, it } from 'vitest';
import { createChat } from '../src/database/chats-repo';
import { createEvent } from '../src/database/events-repo';
import { replaceReminderSettings, setAppSetting } from '../src/database/settings-repo';
import { runScheduledJob } from '../src/scheduler/cron';
import { chunkReminders, formatReminderMessage } from '../src/services/message-format';
import { findDueReminders, runReminders } from '../src/services/notification-service';
import { BotApiError } from '../src/services/bot-api';
import { telegramSender } from '../src/services/channel-senders';
import { createTelegramClient } from '../src/services/telegram-client';
import type { Env } from '../src/types/env';
import { todayInVietnam } from '../src/utils/dates';
import { createTestDb } from './helpers/fake-d1';
import { makeEvent, makeFakeTelegram, VN_7AM } from './helpers/factories';

// 15/8 âm 2026 là 25/09/2026. Cron 07:00 VN = 00:00 UTC cùng ngày.
const OCCURRENCE = '2026-09-25';
const THREE_DAYS_BEFORE = VN_7AM('2026-09-22');
const senders = (fake: ReturnType<typeof makeFakeTelegram>) => ({ telegram: telegramSender(fake.client) });

describe('Múi giờ', () => {
  it('23:30 UTC đã là ngày hôm sau ở Việt Nam', () => {
    expect(todayInVietnam(new Date('2026-09-21T23:30:00Z'))).toBe('2026-09-22');
    expect(todayInVietnam(new Date('2026-09-21T16:59:00Z'))).toBe('2026-09-21');
    expect(todayInVietnam(new Date('2026-09-21T17:00:00Z'))).toBe('2026-09-22');
  });
});

describe('Tìm nhắc nhở đến hạn', () => {
  const event = makeEvent();
  const offsets = [7, 3, 1, 0];

  it.each([
    ['2026-09-18', 7],
    ['2026-09-22', 3],
    ['2026-09-24', 1],
    ['2026-09-25', 0],
  ])('ngày %s nhắc mốc trước %i ngày', (today, daysBefore) => {
    const due = findDueReminders([event], offsets, today);
    expect(due).toHaveLength(1);
    expect(due[0].daysBefore).toBe(daysBefore);
    expect(due[0].occurrence.solarDate).toBe(OCCURRENCE);
  });

  it('ngày không thuộc mốc nào thì không nhắc', () => {
    expect(findDueReminders([event], offsets, '2026-09-20')).toEqual([]);
  });

  it('tắt nhắc nhở thì bỏ qua', () => {
    expect(findDueReminders([makeEvent({ reminderEnabled: false })], offsets, '2026-09-25')).toEqual([]);
  });

  it('mốc riêng của ngày giỗ được ưu tiên hơn mốc chung', () => {
    const custom = makeEvent({ reminderOffsets: [10] });
    expect(findDueReminders([custom], offsets, '2026-09-22')).toEqual([]);
    expect(findDueReminders([custom], offsets, '2026-09-15')[0].daysBefore).toBe(10);
  });

  it('ngày âm không tồn tại và không có quy tắc thì không gửi nhắc', () => {
    // Năm âm 2024 không có 30 Tết.
    const missing = makeEvent({ lunarDay: 30, lunarMonth: 12, missingDayRule: 'skip' });
    expect(findDueReminders([missing], offsets, '2025-01-28')).toEqual([]);
  });
});

describe('Định dạng tin nhắn', () => {
  const event = makeEvent({ fullName: 'Nguyễn Văn An', relationship: 'Ông nội', notes: 'Chuẩn bị đồ cúng' });
  const occurrence = { solarDate: OCCURRENCE, lunarDay: 15, lunarMonth: 8, lunarYear: 2026, isLeapMonth: false, adjustment: 'none' as const };

  it('một ngày giỗ theo đúng mẫu', () => {
    const text = formatReminderMessage([{ event, occurrence, daysBefore: 3 }]);
    expect(text).toContain('NHẮC NGÀY GIỖ GIA ĐÌNH');
    expect(text).toContain('👤 Người mất: Nguyễn Văn An (Ông nội)');
    expect(text).toContain('📅 Ngày giỗ âm: 15/08');
    expect(text).toContain('📆 Ngày dương: 25/09/2026');
    expect(text).toContain('⏳ Còn lại: 3 ngày');
    expect(text).toContain('📝 Ghi chú: Chuẩn bị đồ cúng');
  });

  it('không có quan hệ thì không in cặp ngoặc rỗng', () => {
    const text = formatReminderMessage([{ event: makeEvent({ relationship: '' }), occurrence, daysBefore: 3 }]);
    expect(text).toContain('👤 Người mất: Nguyễn Văn An\n');
  });

  it('nhiều ngày giỗ gộp một tin, gần nhất xếp trước', () => {
    const text = formatReminderMessage([
      { event, occurrence, daysBefore: 3 },
      { event: makeEvent({ fullName: 'Trần Thị Bình' }), occurrence, daysBefore: 0 },
    ]);
    expect(text).toContain('(2 ngày giỗ)');
    expect(text.indexOf('Trần Thị Bình')).toBeLessThan(text.indexOf('Nguyễn Văn An'));
    expect(text).toContain('Còn lại: Hôm nay');
  });

  it('thoát HTML để tên hoặc ghi chú không phá định dạng', () => {
    const text = formatReminderMessage([{ event: makeEvent({ notes: '<b>x</b> & y' }), occurrence, daysBefore: 1 }]);
    expect(text).toContain('&lt;b&gt;x&lt;/b&gt; &amp; y');
  });

  it('chia nhiều tin khi vượt giới hạn Telegram', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      event: makeEvent({ id: i, notes: 'x'.repeat(200) }),
      occurrence,
      daysBefore: 1,
    }));
    const chunks = chunkReminders(items);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toHaveLength(40);
    for (const chunk of chunks) expect(formatReminderMessage(chunk).length).toBeLessThanOrEqual(4096);
  });
});

describe('Gửi thông báo và chống trùng', () => {
  let db: D1Database;
  let raw: ReturnType<typeof createTestDb>['raw'];

  const logs = () => raw.prepare('SELECT * FROM notification_logs ORDER BY id').all() as Record<string, unknown>[];

  beforeEach(async () => {
    ({ db, raw } = createTestDb());
    const { id: _id, createdAt: _c, updatedAt: _u, ...input } = makeEvent({ notes: 'Chuẩn bị đồ cúng' });
    await createEvent(db, input);
    await createChat(db, { chatId: '111', title: 'Bố', canQuery: true, receiveNotifications: true });
    await createChat(db, { chatId: '-222', title: 'Nhóm', canQuery: true, receiveNotifications: true });
  });

  it('gửi tới mọi chat và ghi log thành công', async () => {
    const telegram = makeFakeTelegram();
    const result = await runReminders(db, senders(telegram), THREE_DAYS_BEFORE);
    expect(result).toMatchObject({ due: 1, sent: 2, failed: 0 });
    expect(telegram.sent.map((m) => m.chatId)).toEqual(['111', '-222']);
    expect(logs().map((l) => l.status)).toEqual(['sent', 'sent']);
    expect(logs()[0].dedupe_key).toBe(`1:${OCCURRENCE}:3:111`);
  });

  it('cron chạy lại không gửi trùng', async () => {
    const telegram = makeFakeTelegram();
    await runReminders(db, senders(telegram), THREE_DAYS_BEFORE);
    const second = await runReminders(db, senders(telegram), THREE_DAYS_BEFORE);
    expect(second).toMatchObject({ due: 1, sent: 0, skipped: 2 });
    expect(telegram.sent).toHaveLength(2);
    expect(logs()).toHaveLength(2);
  });

  it('hai lượt cron chạy song song cũng không gửi trùng', async () => {
    const telegram = makeFakeTelegram();
    await Promise.all([
      runReminders(db, senders(telegram), THREE_DAYS_BEFORE),
      runReminders(db, senders(telegram), THREE_DAYS_BEFORE),
    ]);
    expect(telegram.sent).toHaveLength(2);
  });

  it('mốc nhắc khác của cùng ngày giỗ vẫn được gửi', async () => {
    const telegram = makeFakeTelegram();
    await runReminders(db, senders(telegram), THREE_DAYS_BEFORE);
    await runReminders(db, senders(telegram), VN_7AM('2026-09-24'));
    expect(telegram.sent).toHaveLength(4);
  });

  it('thêm chat mới giữa ngày chỉ gửi cho chat đó', async () => {
    const telegram = makeFakeTelegram();
    await runReminders(db, senders(telegram), THREE_DAYS_BEFORE);
    await createChat(db, { chatId: '333', title: 'Mới', canQuery: true, receiveNotifications: true });
    await runReminders(db, senders(telegram), THREE_DAYS_BEFORE);
    expect(telegram.sent.map((m) => m.chatId)).toEqual(['111', '-222', '333']);
  });

  it('lỗi tạm thời: chat lỗi được gửi lại ở lượt sau, chat đã thành công không bị gửi lại', async () => {
    const failures = new Map([['111', new BotApiError('Too Many Requests', 429, true)]]);
    const telegram = makeFakeTelegram(failures);
    const first = await runReminders(db, senders(telegram), THREE_DAYS_BEFORE);
    expect(first).toMatchObject({ sent: 1, failed: 1 });
    expect(logs()[0]).toMatchObject({ status: 'failed', attempts: 1, error_message: 'Too Many Requests' });

    failures.clear();
    const retry = await runReminders(db, senders(telegram), THREE_DAYS_BEFORE);
    expect(retry).toMatchObject({ sent: 1, failed: 0, skipped: 1 });
    expect(logs()[0]).toMatchObject({ status: 'sent', attempts: 2, error_message: null });
    expect(telegram.sent.filter((m) => m.chatId === '111')).toHaveLength(1);
    expect(telegram.sent.filter((m) => m.chatId === '-222')).toHaveLength(1);
  });

  it('lỗi vĩnh viễn như bot bị chặn thì không thử lại', async () => {
    const failures = new Map([['111', new BotApiError('Forbidden: bot was blocked', 403, false)]]);
    const telegram = makeFakeTelegram(failures);
    await runReminders(db, senders(telegram), THREE_DAYS_BEFORE);
    failures.clear();
    await runReminders(db, senders(telegram), THREE_DAYS_BEFORE);
    expect(telegram.sent.filter((m) => m.chatId === '111')).toHaveLength(0);
  });

  it('dừng thử lại sau số lần tối đa', async () => {
    const failures = new Map([['111', new BotApiError('Bad Gateway', 502, true)]]);
    const telegram = makeFakeTelegram(failures);
    for (let i = 0; i < 8; i++) await runReminders(db, senders(telegram), THREE_DAYS_BEFORE);
    expect(logs()[0]).toMatchObject({ status: 'failed', attempts: 5 });
  });

  it('dòng kẹt ở sending quá 15 phút được gửi lại, dòng mới thì không', async () => {
    const telegram = makeFakeTelegram();
    raw.prepare(
      `INSERT INTO notification_logs (dedupe_key, event_id, event_name, occurrence_date, days_before, scheduled_date, chat_id, status, attempts, last_attempt_at)
       VALUES ('1:${OCCURRENCE}:3:111', 1, 'x', '${OCCURRENCE}', 3, '2026-09-22', '111', 'sending', 1, '${new Date(THREE_DAYS_BEFORE.getTime() - 60_000).toISOString()}')`,
    ).run();
    await runReminders(db, senders(telegram), THREE_DAYS_BEFORE);
    expect(telegram.sent.filter((m) => m.chatId === '111')).toHaveLength(0);

    await runReminders(db, senders(telegram), new Date(THREE_DAYS_BEFORE.getTime() + 20 * 60_000));
    expect(telegram.sent.filter((m) => m.chatId === '111')).toHaveLength(1);
  });

  it('tắt thông báo chung thì không gửi', async () => {
    await setAppSetting(db, 'notifications_enabled', 'false');
    const telegram = makeFakeTelegram();
    const result = await runReminders(db, senders(telegram), THREE_DAYS_BEFORE);
    expect(result.note).toContain('tắt');
    expect(telegram.sent).toEqual([]);
  });

  it('dùng lịch nhắc đã chỉnh trên website', async () => {
    await replaceReminderSettings(db, [{ daysBefore: 5, enabled: true }, { daysBefore: 3, enabled: false }]);
    const telegram = makeFakeTelegram();
    await runReminders(db, senders(telegram), THREE_DAYS_BEFORE);
    expect(telegram.sent).toEqual([]);
    await runReminders(db, senders(telegram), VN_7AM('2026-09-20'));
    expect(telegram.sent).toHaveLength(2);
  });

  it('xóa ngày giỗ vẫn giữ lịch sử gửi', async () => {
    const telegram = makeFakeTelegram();
    await runReminders(db, senders(telegram), THREE_DAYS_BEFORE);
    raw.prepare('DELETE FROM memorial_events WHERE id = 1').run();
    expect(logs()).toHaveLength(2);
    expect(logs()[0].event_id).toBeNull();
    expect(logs()[0].event_name).toBe('Nguyễn Văn An');
  });

  it('job cron ghi lại kết quả lần chạy gần nhất', async () => {
    const telegram = makeFakeTelegram();
    await runScheduledJob({ DB: db } as Env, '0 0 * * *', THREE_DAYS_BEFORE, senders(telegram));
    const row = raw.prepare(`SELECT value FROM app_settings WHERE key = 'last_cron_result'`).get() as { value: string };
    expect(JSON.parse(row.value)).toMatchObject({ today: '2026-09-22', sent: 2 });
  });
});

describe('Telegram client', () => {
  const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  const fail = (status: number, description: string, extra: object = {}) =>
    new Response(JSON.stringify({ ok: false, description, ...extra }), { status });
  const noSleep = async () => {};

  it('thử lại khi lỗi 5xx rồi thành công', async () => {
    let calls = 0;
    const client = createTelegramClient('TOKEN', {
      sleep: noSleep,
      fetch: (async () => (++calls < 3 ? fail(502, 'Bad Gateway') : ok({ message_id: 9 }))) as typeof fetch,
    });
    expect(await client.sendMessage('1', 'hi')).toEqual({ message_id: 9 });
    expect(calls).toBe(3);
  });

  it('chờ theo retry_after khi bị 429', async () => {
    const waits: number[] = [];
    let calls = 0;
    const client = createTelegramClient('TOKEN', {
      sleep: async (ms) => void waits.push(ms),
      fetch: (async () =>
        ++calls === 1 ? fail(429, 'Too Many Requests', { parameters: { retry_after: 2 } }) : ok({ message_id: 1 })) as typeof fetch,
    });
    await client.sendMessage('1', 'hi');
    expect(waits).toEqual([2000]);
  });

  it('không thử lại lỗi 4xx và đánh dấu không thể thử lại', async () => {
    let calls = 0;
    const client = createTelegramClient('TOKEN', {
      sleep: noSleep,
      fetch: (async () => (calls++, fail(403, 'Forbidden: bot was blocked by the user'))) as typeof fetch,
    });
    await expect(client.sendMessage('1', 'hi')).rejects.toMatchObject({ retryable: false, status: 403 });
    expect(calls).toBe(1);
  });

  it('token sai: không thử lại ngay, nhưng cho phép lượt cron sau gửi lại', async () => {
    let calls = 0;
    const client = createTelegramClient('TOKEN', {
      sleep: noSleep,
      fetch: (async () => (calls++, fail(401, 'Unauthorized'))) as typeof fetch,
    });
    await expect(client.sendMessage('1', 'hi')).rejects.toMatchObject({ retryable: true, transient: false });
    expect(calls).toBe(1);
  });

  it('không để lộ token trong thông báo lỗi', async () => {
    const client = createTelegramClient('SECRET-TOKEN', {
      sleep: noSleep,
      retries: 0,
      fetch: (async () => {
        throw new Error('connect failed https://api.telegram.org/botSECRET-TOKEN/sendMessage');
      }) as typeof fetch,
    });
    const error = (await client.sendMessage('1', 'hi').catch((e) => e)) as Error;
    expect(error.message).not.toContain('SECRET-TOKEN');
    expect(error.message).toContain('<token>');
  });
});

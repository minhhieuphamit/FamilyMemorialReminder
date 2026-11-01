import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api';
import { createChat } from '../src/database/chats-repo';
import { deleteOldCards, saveCard } from '../src/database/cards-repo';
import { createEvent } from '../src/database/events-repo';
import { createFamily } from '../src/database/families-repo';
import { cardCaption, createCardProvider, isCardConfigured, MAX_RENDERS_PER_RUN, renderCardHtml, type CardProvider } from '../src/services/card-image';
import { zaloSender } from '../src/services/channel-senders';
import type { ReminderItem } from '../src/services/message-format';
import { runReminders } from '../src/services/notification-service';
import { BotApiError } from '../src/services/bot-api';
import { createTelegramClient } from '../src/services/telegram-client';
import { createZaloClient } from '../src/services/zalo-client';
import type { MemorialEventInput } from '../src/types/domain';
import type { Env } from '../src/types/env';
import { htmlToPlainText } from '../src/utils/text';
import { createTestDb } from './helpers/fake-d1';
import { makeEvent, makeFakeSender, VN_7AM } from './helpers/factories';

const occurrence = { solarDate: '2026-11-01', lunarDay: 23, lunarMonth: 9, lunarYear: 2026, isLeapMonth: false, adjustment: 'none' as const };
const item = (over: Partial<ReminderItem> = {}): ReminderItem => ({ event: makeEvent({ fullName: 'Nguyễn Văn An', familyName: 'Nhà ngoại', relationship: 'Ông nội' }), occurrence, daysBefore: 0, ...over });
const BASE = 'https://gio.example';

function input(overrides: Partial<MemorialEventInput>): MemorialEventInput {
  const { id: _i, createdAt: _c, updatedAt: _u, familyName: _n, ...rest } = makeEvent();
  return { ...rest, ...overrides };
}

const DUE_DAY = VN_7AM('2026-09-22'); // 15/8 âm 2026 là 25/09/2026, còn 3 ngày.

describe('Nội dung thiệp', () => {
  it('có đủ thông tin theo từng ngày giỗ', () => {
    const html = renderCardHtml(item(), BASE);
    for (const text of ['Nhắc Ngày Giỗ Gia Đình', 'Nguyễn Văn An', 'Ông nội', 'Nhà ngoại', '23/09', '01/11/2026', 'Hôm nay']) expect(html).toContain(text);
    expect(html).toContain('src="data:image/jpeg;base64,');
    expect(html).not.toContain(`${BASE}/card-bg.jpg`);
  });

  it('không phụ thuộc web font khi chụp, tránh ảnh trắng chữ và bỏ cache thiệp lỗi', () => {
    const html = renderCardHtml(item(), BASE);
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('@font-face');
    expect(html).toContain("font-family:Georgia,'Times New Roman',serif");
    for (const label of ['Người mất:', 'Gia đình:', 'Ngày giỗ âm:', 'Ngày dương:', 'Còn lại:']) expect(html).toContain(label);
  });

  it('còn nhiều ngày thì ghi số ngày, ngày mai ghi rõ', () => {
    expect(renderCardHtml(item({ daysBefore: 7 }), BASE)).toContain('Còn 7 ngày');
    expect(renderCardHtml(item({ daysBefore: 1 }), BASE)).toContain('Ngày mai');
  });

  it('không có gia đình hoặc quan hệ thì không in dòng trống', () => {
    const html = renderCardHtml(item({ event: makeEvent({ relationship: '', familyName: null }) }), BASE);
    expect(html).not.toContain('Gia đình:');
    expect(html).not.toContain('<small>');
  });

  it('thoát HTML: tên không chèn được mã vào trang chụp ảnh', () => {
    const html = renderCardHtml(item({ event: makeEvent({ fullName: '<img src=x onerror=alert(1)>', relationship: '<b>', familyName: '</div><script>' }) }), BASE);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x');
  });

  it('tên rất dài được rút gọn trên ảnh, chú thích vẫn đầy đủ', () => {
    const long = item({ event: makeEvent({ fullName: 'A'.repeat(120), relationship: 'B'.repeat(60), familyName: 'C'.repeat(60) }) });
    const html = renderCardHtml(long, BASE);
    expect(html).not.toContain('A'.repeat(46));
    expect(html).not.toContain('B'.repeat(25));
    expect(html).not.toContain('C'.repeat(41));
    expect(html).toContain('…');
    expect(cardCaption(long)).toContain('A'.repeat(120));
  });

  it('tháng nhuận hiện rõ trên thiệp', () => {
    expect(renderCardHtml(item({ occurrence: { ...occurrence, isLeapMonth: true } }), BASE)).toContain('23/09 nhuận');
  });

  it('thiệp không in ghi chú để ảnh gọn và riêng tư hơn', () => {
    expect(renderCardHtml(item({ event: makeEvent({ notes: 'Ghi chú riêng' }) }), BASE)).not.toContain('Ghi chú riêng');
  });
});

describe('Chữ đi kèm ảnh', () => {
  it('đúng ngày giỗ theo mẫu', () => {
    const text = htmlToPlainText(cardCaption(item()));
    expect(text).toContain('🕯️ TƯỞNG NHỚ NGÀY GIỖ');
    expect(text).toContain('Hôm nay là ngày giỗ của Nguyễn Văn An (Ông nội) thuộc Nhà ngoại.');
    expect(text).toContain('📅 23/09 Âm lịch — 01/11/2026 Dương lịch');
    expect(text).toContain('🌿 Một ngày để gia đình cùng tưởng nhớ');
  });

  it('nhắc trước thì ghi số ngày, không dùng câu tưởng nhớ', () => {
    const text = htmlToPlainText(cardCaption(item({ daysBefore: 3 })));
    expect(text).toContain('🔔 NHẮC NGÀY GIỖ');
    expect(text).toContain('Còn 3 ngày nữa là ngày giỗ của');
    expect(text).not.toContain('🌿');
    expect(htmlToPlainText(cardCaption(item({ daysBefore: 1 })))).toContain('Ngày mai là ngày giỗ của');
  });

  it('kèm ghi chú, cắt bớt để không vượt giới hạn 1024 ký tự của Telegram', () => {
    const long = cardCaption(item({ event: makeEvent({ fullName: 'A'.repeat(120), relationship: 'B'.repeat(60), familyName: 'C'.repeat(60), notes: 'D'.repeat(1000) }) }));
    expect(long).toContain('📝');
    expect(long.length).toBeLessThanOrEqual(1024);
  });

  it('báo khi đã áp dụng quy tắc tháng thiếu', () => {
    expect(cardCaption(item({ occurrence: { ...occurrence, lunarDay: 30, adjustment: 'last_day' } }))).toContain('dùng ngày cuối tháng');
  });
});

describe('Tạo và lưu ảnh', () => {
  let env: Env;
  let raw: ReturnType<typeof createTestDb>['raw'];
  const image = () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } });

  beforeEach(() => {
    const test = createTestDb();
    raw = test.raw;
    env = { DB: test.db, ASSETS: {} as Fetcher, PUBLIC_BASE_URL: `${BASE}/`, BROWSER_RUN_ACCOUNT_ID: 'acc', BROWSER_RUN_TOKEN: 'SECRET-TOKEN' };
  });

  it('thiếu cấu hình thì không bật', () => {
    expect(createCardProvider({ ...env, BROWSER_RUN_TOKEN: undefined })).toBeNull();
    expect(createCardProvider({ ...env, PUBLIC_BASE_URL: undefined })).toBeNull();
    expect(createCardProvider({ ...env, BROWSER_RUN_ACCOUNT_ID: undefined })).toBeNull();
    expect(isCardConfigured(env)).toBe(true);
  });

  it('gọi đúng API, lưu ảnh và trả về địa chỉ công khai', async () => {
    const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    const provider = createCardProvider(env, {
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
        return image();
      }) as unknown as typeof fetch,
    })!;
    const url = await provider.imageUrlFor(item());
    expect(url).toMatch(/^https:\/\/gio\.example\/cards\/[0-9a-f]{64}\.jpg$/);
    expect(calls[0].url).toBe('https://api.cloudflare.com/client/v4/accounts/acc/browser-rendering/screenshot');
    expect(calls[0].headers.authorization).toBe('Bearer SECRET-TOKEN');
    expect(calls[0].body).toMatchObject({ viewport: { width: 1200, height: 800 }, screenshotOptions: { type: 'jpeg' } });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM card_images').get()).toEqual({ n: 1 });
  });

  it('cùng nội dung dùng lại ảnh cũ, không tốn lượt tạo; nội dung đổi thì tạo mới', async () => {
    let calls = 0;
    const provider = () => createCardProvider(env, { sleep: async () => {}, fetch: (async () => (calls++, image())) as typeof fetch })!;
    const first = await provider().imageUrlFor(item());
    expect(await provider().imageUrlFor(item())).toBe(first);
    expect(calls).toBe(1);
    expect(await provider().imageUrlFor(item({ daysBefore: 3 }))).not.toBe(first);
    expect(calls).toBe(2);
  });

  it('chờ đủ 10 giây giữa hai lần tạo ảnh', async () => {
    const waits: number[] = [];
    const provider = createCardProvider(env, { now: () => 1000, sleep: async (ms) => void waits.push(ms), fetch: (async () => image()) as typeof fetch })!;
    await provider.imageUrlFor(item());
    await provider.imageUrlFor(item({ daysBefore: 3 }));
    expect(waits).toEqual([10_500]);
  });

  it('giới hạn số ảnh tạo mỗi lượt, phần vượt trả về null', async () => {
    let calls = 0;
    const provider = createCardProvider(env, { sleep: async () => {}, fetch: (async () => (calls++, image())) as typeof fetch })!;
    const results = [];
    for (let i = 0; i < MAX_RENDERS_PER_RUN + 2; i++) results.push(await provider.imageUrlFor(item({ daysBefore: i + 2 })));
    expect(calls).toBe(MAX_RENDERS_PER_RUN);
    expect(results.filter((r) => r === null)).toHaveLength(2);
  });

  it.each([[429], [401], [403]])('lỗi %i thì dừng tạo ảnh cả lượt, trả null thay vì ném lỗi', async (status) => {
    let calls = 0;
    const provider = createCardProvider(env, {
      sleep: async () => {},
      fetch: (async () => (calls++, new Response(JSON.stringify({ errors: [{ message: 'x' }] }), { status }))) as typeof fetch,
    })!;
    expect(await provider.imageUrlFor(item())).toBeNull();
    expect(await provider.imageUrlFor(item({ daysBefore: 3 }))).toBeNull();
    expect(calls).toBe(1);
  });

  it('lỗi tạm thời hoặc mạng: trả null, ảnh sau vẫn thử', async () => {
    let calls = 0;
    const provider = createCardProvider(env, {
      sleep: async () => {},
      fetch: (async () => {
        if (++calls === 1) throw new Error('network');
        return image();
      }) as typeof fetch,
    })!;
    expect(await provider.imageUrlFor(item())).toBeNull();
    expect(await provider.imageUrlFor(item({ daysBefore: 3 }))).not.toBeNull();
  });

  it('API trả 200 mà không phải ảnh thì không lưu', async () => {
    const provider = createCardProvider(env, { fetch: (async () => new Response('{"success":false}', { headers: { 'content-type': 'application/json' } })) as typeof fetch })!;
    expect(await provider.imageUrlFor(item())).toBeNull();
    expect(raw.prepare('SELECT COUNT(*) AS n FROM card_images').get()).toEqual({ n: 0 });
  });

  it('dọn ảnh cũ quá 14 ngày, giữ ảnh mới', async () => {
    await saveCard(env.DB, 'a'.repeat(64), 'h1', new Uint8Array([1]).buffer);
    await saveCard(env.DB, 'b'.repeat(64), 'h2', new Uint8Array([2]).buffer);
    raw.prepare(`UPDATE card_images SET created_at = '2026-01-01T00:00:00.000Z' WHERE content_hash = 'h1'`).run();
    await deleteOldCards(env.DB, new Date('2026-02-01T00:00:00Z'));
    expect(raw.prepare('SELECT content_hash FROM card_images').all()).toEqual([{ content_hash: 'h2' }]);
  });
});

describe('Địa chỉ tải ảnh', () => {
  const app = createApp();
  const TOKEN = 'c'.repeat(64);
  let env: Env;
  const get = (path: string) => app.request(`https://gio.test${path}`, {}, env);

  beforeEach(async () => {
    env = { DB: createTestDb().db, ASSETS: {} as Fetcher };
    await saveCard(env.DB, TOKEN, 'h', new Uint8Array([0xff, 0xd8, 0xff]).buffer);
  });

  it('tải được ảnh không cần đăng nhập, đúng định dạng', async () => {
    const res = await get(`/cards/${TOKEN}.jpg`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
  });

  it.each([['d'.repeat(64) + '.jpg'], [TOKEN], [`${TOKEN}.png`], ["'%20OR%201=1--.jpg"], ['abc.jpg']])('từ chối %s', async (file) => {
    expect((await get(`/cards/${file}`)).status).toBe(404);
  });

  it('xem thử thiệp cần đăng nhập', async () => {
    const res = await app.request('https://gio.test/api/notifications/card-preview', { method: 'POST' }, env);
    expect(res.status).toBe(401);
  });
});

describe('Gửi nhắc kèm ảnh', () => {
  let db: D1Database;
  const URL_A = 'https://gio.example/cards/a.jpg';
  const fixedCards = (url: string | null = URL_A): CardProvider & { calls: number } => ({
    calls: 0,
    async imageUrlFor() {
      this.calls++;
      return url;
    },
  });

  beforeEach(async () => {
    ({ db } = createTestDb());
    const family = await createFamily(db, 'Nhà nội');
    await createEvent(db, input({ fullName: 'Ông An', familyId: family.id, notes: 'Đồ cúng' }));
    await createChat(db, { chatId: '1', title: '', canQuery: true, receiveNotifications: true });
    await createChat(db, { chatId: '2', title: '', canQuery: true, receiveNotifications: true });
  });

  it('gửi ảnh kèm chú thích, một ảnh dùng cho mọi chat', async () => {
    const fake = makeFakeSender();
    const cards = fixedCards();
    const result = await runReminders(db, { telegram: fake.sender }, DUE_DAY, { cards });
    expect(result).toMatchObject({ sent: 2, failed: 0 });
    expect(fake.photos.map((p) => [p.chatId, p.url])).toEqual([['1', URL_A], ['2', URL_A]]);
    expect(fake.photos[0].caption).toContain('Ông An');
    expect(fake.photos[0].caption).toContain('Đồ cúng');
    expect(fake.sent).toEqual([]);
    expect(cards.calls).toBe(1);
    const { results } = await db.prepare(`SELECT status, provider_message_id FROM notification_logs`).all();
    expect(results).toEqual([{ status: 'sent', provider_message_id: 'photo-1' }, { status: 'sent', provider_message_id: 'photo-1' }]);
  });

  it('không tạo được ảnh thì gửi bằng chữ', async () => {
    const fake = makeFakeSender();
    const result = await runReminders(db, { telegram: fake.sender }, DUE_DAY, { cards: fixedCards(null) });
    expect(result).toMatchObject({ sent: 2, failed: 0 });
    expect(fake.photos).toEqual([]);
    expect(fake.sent[0].text).toContain('NHẮC NGÀY GIỖ GIA ĐÌNH');
  });

  it('nền tảng từ chối ảnh thì tự gửi lại bằng chữ, không tính là lỗi', async () => {
    const fake = makeFakeSender();
    fake.failPhotos.set('1', new BotApiError('failed to get HTTP URL content', 400, false));
    const result = await runReminders(db, { telegram: fake.sender }, DUE_DAY, { cards: fixedCards() });
    expect(result).toMatchObject({ sent: 2, failed: 0 });
    expect(fake.sent.map((m) => m.chatId)).toEqual(['1']);
    expect(fake.photos.map((p) => p.chatId)).toEqual(['2']);
  });

  it('chat bị chặn: cả ảnh lẫn chữ đều lỗi thì ghi lỗi, không báo đã gửi', async () => {
    const failure = new BotApiError('Forbidden: bot was blocked', 403, false);
    const fake = makeFakeSender(new Map([['1', failure]]));
    fake.failPhotos.set('1', failure);
    const result = await runReminders(db, { telegram: fake.sender }, DUE_DAY, { cards: fixedCards() });
    expect(result).toMatchObject({ sent: 1, failed: 1 });
  });

  it('chạy lại không gửi trùng ảnh', async () => {
    const fake = makeFakeSender();
    await runReminders(db, { telegram: fake.sender }, DUE_DAY, { cards: fixedCards() });
    await runReminders(db, { telegram: fake.sender }, DUE_DAY, { cards: fixedCards() });
    expect(fake.photos).toHaveLength(2);
  });

  it('kênh không hỗ trợ ảnh thì gửi chữ và không tạo ảnh thừa', async () => {
    const fake = makeFakeSender();
    const cards = fixedCards();
    const { sendPhoto: _s, ...textOnly } = fake.sender;
    await runReminders(db, { telegram: textOnly }, DUE_DAY, { cards });
    expect(cards.calls).toBe(0);
    expect(fake.sent).toHaveLength(2);
  });

  it('Telegram gửi đúng tham số sendPhoto', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const client = createTelegramClient('TOK', {
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(init.body as string) });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 5 } }));
      }) as unknown as typeof fetch,
    });
    await client.sendPhoto('1', URL_A, '<b>x</b>');
    expect(calls[0].url).toBe('https://api.telegram.org/botTOK/sendPhoto');
    expect(calls[0].body).toEqual({ chat_id: '1', photo: URL_A, caption: '<b>x</b>', parse_mode: 'HTML' });
  });

  it('Zalo gửi đúng tham số sendPhoto, chú thích là văn bản thuần', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const client = createZaloClient('TOK', {
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(init.body as string) });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 'abc' } }));
      }) as unknown as typeof fetch,
    });
    expect(await zaloSender(client).sendPhoto!('z', URL_A, '<b>A &amp; B</b>')).toBe('abc');
    expect(calls[0].url).toBe('https://bot-api.zaloplatforms.com/botTOK/sendPhoto');
    expect(calls[0].body).toEqual({ chat_id: 'z', photo: URL_A, caption: 'A & B' });
  });
});

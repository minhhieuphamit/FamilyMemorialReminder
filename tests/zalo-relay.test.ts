import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../relay/api/zalo';
import { createApp } from '../src/api';
import { handleIncoming, handleZaloUpdate } from '../src/bot/handler';
import { stripBotMention } from '../src/bot/parser';
import { createChat, getChatAccess } from '../src/database/chats-repo';
import { createFamily } from '../src/database/families-repo';
import { listRegistrations, setRegistrationAdmins } from '../src/database/registrations-repo';
import { createSession } from '../src/database/sessions-repo';
import type { ChannelSender } from '../src/services/channel-senders';
import { sha256Hex } from '../src/utils/crypto';
import type { Env } from '../src/types/env';
import { makeFakeSender } from './helpers/factories';
import { createTestDb } from './helpers/fake-d1';

const incoming = (headers: Record<string, string>, body = '{"event_name":"message.text.received"}') =>
  new Request('https://relay.test/api/zalo', { method: 'POST', headers, body });

describe('Relay webhook Zalo', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('chuyển nguyên nội dung và secret, thay User-Agent để qua được Cloudflare', async () => {
    const upstream = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const res = await POST(incoming({ 'x-bot-api-secret-token': 'bi-mat', 'user-agent': 'Java/1.8.0_292' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toMatch(/\/zalo\/webhook$/);
    expect(init.headers['x-bot-api-secret-token']).toBe('bi-mat');
    expect(init.headers['user-agent']).not.toContain('Java');
    expect(init.body).toBe('{"event_name":"message.text.received"}');
  });

  it('không có secret thì từ chối, không gọi Worker', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    expect((await POST(incoming({}))).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('giữ mã lỗi của Worker và báo 502 khi không gọi được', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"Không có quyền"}', { status: 401 })));
    expect((await POST(incoming({ 'x-bot-api-secret-token': 'sai' }))).status).toBe(401);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('mất mạng'); }));
    expect((await POST(incoming({ 'x-bot-api-secret-token': 'bi-mat' }))).status).toBe(502);
  });
});

describe('Nhắc tên bot trong nhóm Zalo', () => {
  const BOT = 'Bot Nhắc lịch giỗ gia đình';
  const say = (db: D1Database, sender: ChannelSender, text: string, chatType = 'GROUP') =>
    handleZaloUpdate({ event_name: 'message.text.received', message: { text, chat: { id: 'nhom-1', chat_type: chatType } } }, db, sender, new Date('2026-11-01T02:00:00.000Z'), { senders: {}, baseUrl: 'https://gio.test', zaloBotName: BOT });

  it.each([
    [`@${BOT} /help`, '/help'],
    [`@${BOT} hôm nay`, 'hôm nay'],
    [`cho hỏi @${BOT} tháng này có giỗ ai`, 'cho hỏi tháng này có giỗ ai'],
    [`@${BOT}`, '/help'],
    ['@bot nhac lich gio gia dinh /id', '/id'],
    ['@Tên Cũ Của Bot /homnay', '/homnay'],
  ])('"%s" thành "%s"', (input, expected) => {
    expect(stripBotMention(input, BOT)).toEqual({ text: expected, mentioned: true });
  });

  it('tin không nhắc bot giữ nguyên', () => {
    expect(stripBotMention('hôm nay ăn gì', BOT)).toEqual({ text: 'hôm nay ăn gì', mentioned: false });
    expect(stripBotMention(`@Em gái hôm nay ăn gì`, BOT)).toEqual({ text: '@Em gái hôm nay ăn gì', mentioned: false });
  });

  it('/id trong nhóm chưa cấp quyền trả về Chat ID của nhóm', async () => {
    const { db } = createTestDb();
    const user = makeFakeSender();
    await say(db, user.sender, `@${BOT} /id`);
    expect(user.sent[0].text).toContain('nhom-1');
  });

  it('nhóm chưa cấp quyền được báo rõ thay vì im lặng, không lộ dữ liệu', async () => {
    const { db } = createTestDb();
    const user = makeFakeSender();
    await say(db, user.sender, `@${BOT} hôm nay`);
    expect(user.sent[0].text).toContain('chưa được cấp quyền');
    expect(user.sent[0].text).toContain('nhom-1');
  });

  it('nhóm đã cấp quyền tra cứu được; câu không hiểu vẫn được trả lời', async () => {
    const { db } = createTestDb();
    await createChat(db, { channel: 'zalo', chatId: 'nhom-1', title: 'Nhóm', canQuery: true, receiveNotifications: true, allFamilies: true });
    const user = makeFakeSender();
    await say(db, user.sender, `@${BOT} hôm nay`);
    expect(user.sent.at(-1)?.text).toContain('Ngày giỗ hôm nay');
    await say(db, user.sender, `@${BOT} xin cho biết thời tiết`);
    expect(user.sent.at(-1)?.text).toContain('chưa hiểu');
  });

  describe('Đăng ký cho nhóm', () => {
    async function setup() {
      const { db } = createTestDb();
      const family = await createFamily(db, 'Gia đình họ Phạm');
      await setRegistrationAdmins(db, [{ channel: 'telegram', chatId: '999' }]);
      const user = makeFakeSender();
      const admin = makeFakeSender();
      const send = (text: string) =>
        handleZaloUpdate({ event_name: 'message.text.received', message: { text, chat: { id: 'zgr-1', chat_type: 'GROUP' } } }, db, user.sender, new Date(), { senders: { telegram: admin.sender }, baseUrl: 'https://gio.test', zaloBotName: BOT });
      return { db, family, user, admin, send };
    }

    it('nhắc tên bot tạo yêu cầu chờ duyệt, báo admin là nhóm, chưa cấp quyền', async () => {
      const { db, user, admin, send } = await setup();
      await send(`@${BOT} /dangky Gia đình họ Phạm | Group nhắc lịch`);
      expect(user.sent.at(-1)?.text).toContain('Vui lòng chờ quản trị viên duyệt');
      expect((await listRegistrations(db, 'pending', 1, 10)).requests[0]).toMatchObject({ chat_id: 'zgr-1', full_name: 'Group nhắc lịch' });
      expect(admin.sent[0].text).toContain('Kênh: Zalo (nhóm)');
      expect(await getChatAccess(db, 'zalo', 'zgr-1')).toBeNull();
    });

    it('duyệt xong cả nhóm tra cứu được đúng gia đình và admin thấy là nhóm', async () => {
      const { db, family, admin, send } = await setup();
      await send(`@${BOT} /dangky Gia đình họ Phạm | Group nhắc lịch`);
      const { requests } = await listRegistrations(db, 'pending', 1, 10);
      await handleIncoming({ channel: 'telegram', chatId: '999', text: `/duyet ${requests[0].id}`, isGroup: false }, db, admin.sender, new Date(), { senders: { telegram: admin.sender }, baseUrl: 'https://gio.test' });
      expect(await getChatAccess(db, 'zalo', 'zgr-1')).toEqual({ allFamilies: false, familyIds: [family.id] });
      expect(admin.sent.find((m) => m.text.includes('đã được duyệt'))?.text).toContain('Kênh: Zalo (nhóm)');
    });

    it('thiếu tên nhóm thì hướng dẫn kèm nhắc tên bot; danh sách không có lệnh tự gỡ', async () => {
      const { db, family, user, send } = await setup();
      await createChat(db, { channel: 'zalo', chatId: 'zgr-1', title: 'Nhóm', canQuery: true, receiveNotifications: true, allFamilies: false, familyIds: [family.id] });
      await send(`@${BOT} /dangky`);
      expect(user.sent.at(-2)?.text).toContain('@Tên bot /dangky');
      expect(user.sent.at(-1)?.text).not.toContain('/huydangky');
    });

    it('thành viên không tự gỡ nhóm được', async () => {
      const { db, family, user, send } = await setup();
      await createChat(db, { channel: 'zalo', chatId: 'zgr-1', title: 'Nhóm', canQuery: true, receiveNotifications: true, allFamilies: false, familyIds: [family.id] });
      await send(`@${BOT} /huydangky Gia đình họ Phạm`);
      expect(user.sent.at(-1)?.text).toContain('quản trị viên');
      expect(await getChatAccess(db, 'zalo', 'zgr-1')).toEqual({ allFamilies: false, familyIds: [family.id] });
    });

    it('nhóm Telegram vẫn phải nhắn riêng', async () => {
      const { db, user } = await setup();
      await handleIncoming({ channel: 'telegram', chatId: '-100', text: '/dangky Gia đình họ Phạm | Nhóm', isGroup: true }, db, user.sender, new Date());
      expect(user.sent.at(-1)?.text).toContain('nhắn riêng');
      expect((await listRegistrations(db, '', 1, 10)).total).toBe(0);
    });
  });

  it('chat riêng không bị bỏ ký tự @', async () => {
    const { db } = createTestDb();
    await createChat(db, { channel: 'zalo', chatId: 'nhom-1', title: 'Riêng', canQuery: true, receiveNotifications: true, allFamilies: true });
    const user = makeFakeSender();
    await say(db, user.sender, `@${BOT} /id`, 'PRIVATE');
    expect(user.sent.at(-1)?.text).not.toContain('Chat ID của bạn');
  });
});

describe('Đăng ký địa chỉ webhook Zalo', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function setup(extra: Partial<Env>) {
    const db = createTestDb().db;
    await createSession(db, await sha256Hex('admin'), new Date(Date.now() + 3600000), null);
    const calls: { url: string; body: { url?: string } }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true, result: { url: extra.ZALO_WEBHOOK_URL ?? '', account_name: 'bot', id: '1' } }), { headers: { 'content-type': 'application/json' } });
    }));
    const env = { DB: db, ASSETS: {} as Fetcher, ZALO_BOT_TOKEN: 'token', ZALO_WEBHOOK_SECRET: 'bi-mat-du-dai', ...extra } as Env;
    const headers = { cookie: 'fmr_session=admin', 'content-type': 'application/json' };
    const app = createApp();
    return {
      calls,
      setWebhook: () => app.request('https://gio.test/api/channels/zalo/webhook', { method: 'POST', headers }, env),
      status: () => app.request('https://gio.test/api/channels/zalo/status', { headers }, env),
    };
  }

  it('đăng ký relay khi có ZALO_WEBHOOK_URL và trang trạng thái so với relay', async () => {
    const { calls, setWebhook, status } = await setup({ ZALO_WEBHOOK_URL: 'https://relay.test/api/zalo' });
    expect((await setWebhook()).status).toBe(200);
    expect(calls.at(-1)?.body.url).toBe('https://relay.test/api/zalo');
    expect(await (await status()).json()).toMatchObject({ expectedWebhookUrl: 'https://relay.test/api/zalo' });
  });

  it('không có relay thì vẫn dùng địa chỉ của Worker', async () => {
    const { calls, setWebhook } = await setup({});
    expect((await setWebhook()).status).toBe(200);
    expect(calls.at(-1)?.body.url).toBe('https://gio.test/zalo/webhook');
  });
});

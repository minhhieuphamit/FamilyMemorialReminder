import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api';
import type { Env } from '../src/types/env';
import { parseCsv, toCsv } from '../src/utils/csv';
import { validateEventInput } from '../src/utils/validation';
import { createTestDb } from './helpers/fake-d1';

const PASSWORD = 'mat-khau-thu-nghiem';
const WEBHOOK_SECRET = 'webhook-secret';
const VALID_EVENT = {
  fullName: 'Nguyễn Văn An',
  relationship: 'Ông nội',
  lunarDay: 15,
  lunarMonth: 8,
  isLeapMonth: false,
  notes: 'Chuẩn bị đồ cúng',
  leapMonthRule: 'exact',
  missingDayRule: 'skip',
  reminderEnabled: true,
  reminderOffsets: null,
};

describe('API', () => {
  let env: Env;
  let raw: ReturnType<typeof createTestDb>['raw'];
  const app = createApp();

  const request = (path: string, init: RequestInit = {}) => app.request(`https://gio.test${path}`, init, env);
  const json = (body: unknown, cookie?: string, method = 'POST'): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

  async function login(): Promise<string> {
    const res = await request('/api/auth/login', json({ password: PASSWORD }));
    expect(res.status).toBe(200);
    return res.headers.get('set-cookie')!.split(';')[0];
  }

  beforeEach(() => {
    const test = createTestDb();
    raw = test.raw;
    env = {
      DB: test.db,
      ASSETS: {} as Fetcher,
      ADMIN_PASSWORD: PASSWORD,
      TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
    };
  });

  it('sửa Chat ID, giữ quyền và từ chối mã trùng hoặc không hợp lệ', async () => {
    const cookie = await login();
    const create = async (chatId: string) => {
      const res = await request('/api/chats', json({ chatId, title: 'Mẹ', canQuery: true, receiveNotifications: true } , cookie));
      return (await res.json()) as { chat: { id: number } };
    };
    const { chat } = await create('123');
    await create('456');
    const body = { chatId: '-789', title: 'Nhà ngoại', canQuery: true, receiveNotifications: false, allFamilies: true };
    const res = await request('/api/chats/' + chat.id, json(body, cookie, 'PUT'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ chat: { id: chat.id, ...body } });
    for (const [chatId, status] of [['456', 409], ['abc', 400], ['', 400]] as const) {
      expect((await request('/api/chats/' + chat.id, json({ ...body, chatId }, cookie, 'PUT'))).status).toBe(status);
    }
    expect(raw.prepare('SELECT chat_id FROM chats WHERE id = ?').get(chat.id)).toEqual({ chat_id: '-789' });
  });

  it('phân trang lịch sử 10/20/50 dòng, không lặp bản ghi giữa các trang', async () => {
    const cookie = await login();
    for (let i = 0; i < 55; i++) raw.prepare("INSERT INTO notification_logs (kind, channel, event_name, scheduled_date, chat_id, status) VALUES ('test', 'telegram', 'Test', '2026-11-01', '123', 'sent')").run();
    const get = async (query: string) => (await (await request('/api/notifications/logs?' + query, { headers: { cookie } })).json()) as { logs: { id: number }[]; total: number; pageSize: number };
    for (const size of [10, 20, 50]) {
      const first = await get('pageSize=' + size);
      const second = await get('pageSize=' + size + '&page=2');
      expect(first.logs).toHaveLength(size);
      expect(first.total).toBe(55);
      expect(second.logs).toHaveLength(Math.min(size, 55 - size));
      expect(second.logs.some((log) => first.logs.some((x) => x.id === log.id))).toBe(false);
    }
    expect((await get('pageSize=999&page=Infinity')).pageSize).toBe(10);
    expect((await get('pageSize=10&status=failed')).total).toBe(0);
  });

  describe('Xác thực', () => {
    it.each([
      ['GET', '/api/events'],
      ['POST', '/api/events'],
      ['PUT', '/api/events/1'],
      ['DELETE', '/api/events/1'],
      ['GET', '/api/dashboard'],
      ['GET', '/api/calendar'],
      ['GET', '/api/year'],
      ['GET', '/api/settings/reminders'],
      ['GET', '/api/chats'],
      ['GET', '/api/notifications/logs'],
      ['POST', '/api/chats/test'],
      ['GET', '/api/backup/export'],
      ['POST', '/api/backup/import'],
    ])('%s %s từ chối khi chưa đăng nhập', async (method, path) => {
      const res = await request(path, { method });
      expect(res.status).toBe(401);
    });

    it('health public không tiết lộ dữ liệu', async () => {
      const res = await request('/api/health');
      expect(await res.json()).toEqual({ ok: true });
    });

    it('sai mật khẩu bị từ chối', async () => {
      const res = await request('/api/auth/login', json({ password: 'sai' }));
      expect(res.status).toBe(401);
      expect(res.headers.get('set-cookie')).toBeNull();
    });

    it('đăng nhập đúng: cookie HttpOnly, Secure, SameSite=Strict và chỉ lưu hash token', async () => {
      const res = await request('/api/auth/login', json({ password: PASSWORD }));
      const cookie = res.headers.get('set-cookie')!;
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      const token = cookie.split(';')[0].split('=')[1];
      const stored = raw.prepare('SELECT token_hash FROM admin_sessions').get() as { token_hash: string };
      expect(stored.token_hash).not.toBe(token);
    });

    it('khóa đăng nhập sau nhiều lần sai', async () => {
      for (let i = 0; i < 5; i++) await request('/api/auth/login', json({ password: 'sai' }));
      const res = await request('/api/auth/login', json({ password: PASSWORD }));
      expect(res.status).toBe(429);
    });

    it('đăng xuất hủy phiên', async () => {
      const cookie = await login();
      await request('/api/auth/logout', json({}, cookie));
      const res = await request('/api/events', { headers: { cookie } });
      expect(res.status).toBe(401);
    });

    it('phiên hết hạn bị từ chối', async () => {
      const cookie = await login();
      raw.prepare(`UPDATE admin_sessions SET expires_at = '2000-01-01T00:00:00.000Z'`).run();
      const res = await request('/api/events', { headers: { cookie } });
      expect(res.status).toBe(401);
    });

    it('chặn request ghi dữ liệu từ trang web khác', async () => {
      const cookie = await login();
      const init = json(VALID_EVENT, cookie);
      const res = await request('/api/events', {
        ...init,
        headers: { ...(init.headers as object), origin: 'https://evil.example' },
      });
      expect(res.status).toBe(403);
    });

    it('báo lỗi rõ khi chưa cấu hình mật khẩu thay vì mở cửa', async () => {
      env.ADMIN_PASSWORD = undefined;
      const res = await request('/api/auth/login', json({ password: '' }));
      expect(res.status).toBe(503);
    });
  });

  describe('CRUD ngày giỗ', () => {
    it('thêm, đọc, sửa, xóa', async () => {
      const cookie = await login();
      const created = await request('/api/events', json(VALID_EVENT, cookie));
      expect(created.status).toBe(201);
      const { event } = (await created.json()) as { event: { id: number; next: { solarDate: string } } };
      expect(event.next.solarDate).toBeTruthy();

      const updated = await request(`/api/events/${event.id}`, json({ ...VALID_EVENT, fullName: 'Tên mới' }, cookie, 'PUT'));
      expect(((await updated.json()) as { event: { fullName: string } }).event.fullName).toBe('Tên mới');

      const list = await request('/api/events?q=ten moi', { headers: { cookie } });
      expect(((await list.json()) as { events: unknown[] }).events).toHaveLength(1);

      const removed = await request(`/api/events/${event.id}`, { method: 'DELETE', headers: { cookie } });
      expect(removed.status).toBe(200);
      const missing = await request(`/api/events/${event.id}`, { headers: { cookie } });
      expect(missing.status).toBe(404);
    });

    it('từ chối dữ liệu không hợp lệ và trả lỗi theo trường', async () => {
      const cookie = await login();
      const res = await request('/api/events', json({ ...VALID_EVENT, fullName: ' ', lunarDay: 31 }, cookie));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { fields: Record<string, string> };
      expect(Object.keys(body.fields).sort()).toEqual(['fullName', 'lunarDay']);
    });

    it('prepared statement: chuỗi SQL được lưu nguyên văn, không thực thi', async () => {
      const cookie = await login();
      const name = `x'); DROP TABLE memorial_events; --`;
      await request('/api/events', json({ ...VALID_EVENT, fullName: name }, cookie));
      const res = await request('/api/events', { headers: { cookie } });
      const { events } = (await res.json()) as { events: { fullName: string }[] };
      expect(events[0].fullName).toBe(name);
    });
  });

  describe('Tổng quan', () => {
    it('dashboard và lịch tháng trả về đúng cấu trúc', async () => {
      const cookie = await login();
      await request('/api/events', json(VALID_EVENT, cookie));
      const dash = (await (await request('/api/dashboard', { headers: { cookie } })).json()) as { counts: { total: number } };
      expect(dash.counts.total).toBe(1);
      const cal = await request('/api/calendar?year=2026&month=9', { headers: { cookie } });
      const data = (await cal.json()) as { items: { occurrence: { solarDate: string } }[] };
      expect(data.items[0].occurrence.solarDate).toBe('2026-09-25');
      expect((await request('/api/calendar?year=abc&month=9', { headers: { cookie } })).status).toBe(400);
    });
  });

  describe('Cài đặt', () => {
    it('lưu và đọc lại lịch nhắc', async () => {
      const cookie = await login();
      const payload = { reminders: [{ daysBefore: 10, enabled: true }, { daysBefore: 0, enabled: true }], notificationsEnabled: false, upcomingWindowDays: 45 };
      expect((await request('/api/settings/reminders', json(payload, cookie, 'PUT'))).status).toBe(200);
      const res = await request('/api/settings/reminders', { headers: { cookie } });
      expect(await res.json()).toEqual(payload);
    });

    it('từ chối mốc nhắc trùng hoặc ngoài khoảng', async () => {
      const cookie = await login();
      const base = { notificationsEnabled: true, upcomingWindowDays: 30 };
      const dup = { ...base, reminders: [{ daysBefore: 1, enabled: true }, { daysBefore: 1, enabled: false }] };
      expect((await request('/api/settings/reminders', json(dup, cookie, 'PUT'))).status).toBe(400);
      const out = { ...base, reminders: [{ daysBefore: 99, enabled: true }] };
      expect((await request('/api/settings/reminders', json(out, cookie, 'PUT'))).status).toBe(400);
    });

    it('quản lý Chat ID: thêm, chặn trùng, kiểm tra định dạng', async () => {
      const cookie = await login();
      expect((await request('/api/chats', json({ chatId: '-100123', title: 'Nhóm' }, cookie))).status).toBe(201);
      expect((await request('/api/chats', json({ chatId: '-100123' }, cookie))).status).toBe(409);
      expect((await request('/api/chats', json({ chatId: 'abc' }, cookie))).status).toBe(400);
    });
  });

  describe('Sao lưu và khôi phục', () => {
    it('xuất JSON rồi nhập lại vào database trống', async () => {
      const cookie = await login();
      await request('/api/events', json(VALID_EVENT, cookie));
      const exported = await (await request('/api/backup/export?format=json', { headers: { cookie } })).text();
      const res = await request('/api/backup/import', json({ format: 'json', content: exported, mode: 'replace' }, cookie));
      expect(await res.json()).toEqual({ ok: true, inserted: 1, updated: 0 });
      const { events } = (await (await request('/api/events', { headers: { cookie } })).json()) as { events: { fullName: string }[] };
      expect(events.map((e) => e.fullName)).toEqual(['Nguyễn Văn An']);
    });

    it('xuất CSV rồi nhập lại ở chế độ gộp: dòng trùng được cập nhật, không nhân đôi', async () => {
      const cookie = await login();
      await request('/api/events', json({ ...VALID_EVENT, notes: 'Ghi chú, có "dấu phẩy"', reminderOffsets: [7, 0] }, cookie));
      const csv = await (await request('/api/backup/export?format=csv', { headers: { cookie } })).text();
      const res = await request('/api/backup/import', json({ format: 'csv', content: csv, mode: 'merge' }, cookie));
      expect(await res.json()).toEqual({ ok: true, inserted: 0, updated: 1 });
      const { events } = (await (await request('/api/events', { headers: { cookie } })).json()) as {
        events: { notes: string; reminderOffsets: number[] }[];
      };
      expect(events).toHaveLength(1);
      expect(events[0].notes).toBe('Ghi chú, có "dấu phẩy"');
      expect(events[0].reminderOffsets).toEqual([7, 0]);
    });

    it('khôi phục JSON ở chế độ thay thế trả lại cả lịch nhắc và Chat ID', async () => {
      const cookie = await login();
      const content = JSON.stringify({
        events: [VALID_EVENT],
        reminders: [{ daysBefore: 9, enabled: true }],
        chats: [{ chatId: '-100555', title: 'Nhóm', canQuery: false, receiveNotifications: true }],
      });
      await request('/api/backup/import', json({ format: 'json', content, mode: 'replace' }, cookie));
      const settings = (await (await request('/api/settings/reminders', { headers: { cookie } })).json()) as { reminders: unknown[] };
      expect(settings.reminders).toEqual([{ daysBefore: 9, enabled: true }]);
      const { chats } = (await (await request('/api/chats', { headers: { cookie } })).json()) as { chats: { chatId: string; canQuery: boolean }[] };
      expect(chats).toMatchObject([{ chatId: '-100555', canQuery: false }]);
    });

    it('Chat ID sai trong file thì không ghi gì cả', async () => {
      const cookie = await login();
      const content = JSON.stringify({ events: [VALID_EVENT], chats: [{ chatId: 'abc' }] });
      const res = await request('/api/backup/import', json({ format: 'json', content, mode: 'replace' }, cookie));
      expect(res.status).toBe(400);
      const { events } = (await (await request('/api/events', { headers: { cookie } })).json()) as { events: unknown[] };
      expect(events).toEqual([]);
    });

    it('file có dòng lỗi thì không ghi gì cả', async () => {
      const cookie = await login();
      const content = JSON.stringify({ events: [VALID_EVENT, { ...VALID_EVENT, lunarDay: 99 }] });
      const res = await request('/api/backup/import', json({ format: 'json', content, mode: 'merge' }, cookie));
      expect(res.status).toBe(400);
      const { events } = (await (await request('/api/events', { headers: { cookie } })).json()) as { events: unknown[] };
      expect(events).toEqual([]);
    });
  });

  describe('Webhook Telegram', () => {
    const update = { update_id: 1, message: { text: '/start', chat: { id: 1, type: 'private' } } };
    const post = (secret?: string) =>
      request('/telegram/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}) },
        body: JSON.stringify(update),
      });

    it('từ chối khi thiếu hoặc sai secret token', async () => {
      env.TELEGRAM_BOT_TOKEN = 'TOKEN';
      expect((await post()).status).toBe(401);
      expect((await post('sai')).status).toBe(401);
    });

    it('từ chối khi chưa cấu hình, thay vì chấp nhận mọi request', async () => {
      env.TELEGRAM_BOT_TOKEN = 'TOKEN';
      env.TELEGRAM_WEBHOOK_SECRET = undefined;
      expect((await post('bat-ky')).status).toBe(503);
    });
  });

  it('API không có route công khai nào trả dữ liệu gia đình', async () => {
    const cookie = await login();
    await request('/api/events', json(VALID_EVENT, cookie));
    for (const path of ['/api/health', '/api/auth/me']) {
      const body = await (await request(path)).text();
      expect(body).not.toContain('Nguyễn');
    }
  });
});

describe('CSV', () => {
  it('đọc và ghi đối xứng với ô phức tạp', () => {
    const rows = [['a', 'b'], ['có, dấu phẩy', 'có "ngoặc"'], ['xuống\ndòng', '']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('chặn CSV injection khi mở bằng Excel', () => {
    expect(toCsv([['=1+1']])).toContain(`'=1+1`);
  });
});

describe('Kiểm tra đầu vào', () => {
  const base = { fullName: 'A', relationship: 'B', lunarDay: 1, lunarMonth: 1 };

  it('điền giá trị mặc định an toàn: không thay thế ngày khi chưa cấu hình', () => {
    const result = validateEventInput(base);
    expect(result.ok && result.data.leapMonthRule).toBe('exact');
    expect(result.ok && result.data.missingDayRule).toBe('skip');
  });

  it.each([
    [{ lunarDay: 0 }, 'lunarDay'],
    [{ lunarDay: 31 }, 'lunarDay'],
    [{ lunarDay: 1.5 }, 'lunarDay'],
    [{ lunarMonth: 13 }, 'lunarMonth'],
    [{ leapMonthRule: 'x' }, 'leapMonthRule'],
    [{ missingDayRule: 'x' }, 'missingDayRule'],
    [{ deathSolarDate: '2026-02-30' }, 'deathSolarDate'],
    [{ deathYear: 'abc' }, 'deathYear'],
    [{ reminderOffsets: [100] }, 'reminderOffsets'],
    [{ fullName: '' }, 'fullName'],
  ])('từ chối %j', (patch, field) => {
    const result = validateEventInput({ ...base, ...patch });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[field]).toBeTruthy();
  });

  it('cho phép để trống quan hệ, kể cả khi thiếu trường này', () => {
    const empty = validateEventInput({ ...base, relationship: '   ' });
    expect(empty.ok && empty.data.relationship).toBe('');
    const { relationship: _r, ...withoutField } = base;
    expect(validateEventInput(withoutField).ok).toBe(true);
    expect(validateEventInput({ ...base, relationship: 'x'.repeat(61) }).ok).toBe(false);
  });

  it('khử trùng và sắp xếp mốc nhắc', () => {
    const result = validateEventInput({ ...base, reminderOffsets: [1, 7, 1, 0] });
    expect(result.ok && result.data.reminderOffsets).toEqual([7, 1, 0]);
  });
});

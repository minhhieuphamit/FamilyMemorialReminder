import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api';
import { handleZaloUpdate } from '../src/bot/handler';
import { createChat, listChats } from '../src/database/chats-repo';
import { createEvent } from '../src/database/events-repo';
import { createFamily, setAccount } from '../src/database/families-repo';
import { saveFamilyReminderConfig } from '../src/database/settings-repo';
import { runReminders } from '../src/services/notification-service';
import type { EventView, MemorialEventInput } from '../src/types/domain';
import type { Env } from '../src/types/env';
import { hashPassword, verifyPassword } from '../src/utils/crypto';
import { createTestDb } from './helpers/fake-d1';
import { makeEvent, makeFakeSender, VN_7AM } from './helpers/factories';

const ADMIN_PASSWORD = 'admin-password-123';
const DUE_DAY = VN_7AM('2026-09-22'); // 15/8 âm 2026 là 25/09/2026, còn 3 ngày.

function input(overrides: Partial<MemorialEventInput>): MemorialEventInput {
  const { id: _i, createdAt: _c, updatedAt: _u, familyName: _n, ...rest } = makeEvent();
  return { ...rest, ...overrides };
}

const EVENT_BODY = { fullName: 'Người Mới', relationship: 'Bố', lunarDay: 15, lunarMonth: 8 };

describe('Tài khoản gia đình', () => {
  const app = createApp();
  let env: Env;
  let raw: ReturnType<typeof createTestDb>['raw'];
  let db: D1Database;
  let noi: number;
  let ngoai: number;
  let noiEvent: number;
  let ngoaiEvent: number;
  let noiCookie: string;
  let ngoaiCookie: string;
  let adminCookie: string;

  const request = (path: string, init: RequestInit = {}) => app.request(`https://gio.test${path}`, init, env);
  const send = (path: string, cookie: string, body: unknown = {}, method = 'POST') =>
    request(path, { method, headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  const get = (path: string, cookie: string) => request(path, { headers: { cookie } });
  const getJson = async <T>(path: string, cookie: string) => (await (await get(path, cookie)).json()) as T;

  async function login(username: string, password: string): Promise<Response> {
    return request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  }
  const cookieOf = (res: Response) => res.headers.get('set-cookie')!.split(';')[0];

  beforeEach(async () => {
    const test = createTestDb();
    db = test.db;
    raw = test.raw;
    env = { DB: db, ASSETS: {} as Fetcher, ADMIN_PASSWORD };
    noi = (await createFamily(db, 'Nhà nội')).id;
    ngoai = (await createFamily(db, 'Nhà ngoại')).id;
    noiEvent = (await createEvent(db, input({ fullName: 'Ông Bên Nội', familyId: noi }))).id;
    ngoaiEvent = (await createEvent(db, input({ fullName: 'Ông Bên Ngoại', familyId: ngoai, notes: 'bí mật nhà ngoại' }))).id;
    await createEvent(db, input({ fullName: 'Chưa Xếp Nhà', familyId: null }));
    await setAccount(db, noi, 'nhanoi', await hashPassword('matkhau-noi-1'));
    await setAccount(db, ngoai, 'nhangoai', await hashPassword('matkhau-ngoai-1'));
    noiCookie = cookieOf(await login('nhanoi', 'matkhau-noi-1'));
    ngoaiCookie = cookieOf(await login('nhangoai', 'matkhau-ngoai-1'));
    adminCookie = cookieOf(await login('admin', ADMIN_PASSWORD));
  });

  describe('Đăng nhập', () => {
    it('mật khẩu được băm có salt, xác minh đúng sai', async () => {
      const a = await hashPassword('abcdefgh');
      const b = await hashPassword('abcdefgh');
      expect(a).not.toBe(b);
      expect(a).not.toContain('abcdefgh');
      expect(await verifyPassword('abcdefgh', a)).toBe(true);
      expect(await verifyPassword('khac-roi', a)).toBe(false);
      expect(await verifyPassword('abcdefgh', null)).toBe(false);
    });

    it('sai mật khẩu và sai tài khoản trả cùng một thông báo', async () => {
      const wrongPassword = await login('nhanoi', 'sai-mat-khau');
      const wrongUser = await login('khong-ton-tai', 'sai-mat-khau');
      expect(wrongPassword.status).toBe(401);
      expect(wrongUser.status).toBe(401);
      expect(await wrongPassword.text()).toBe(await wrongUser.text());
    });

    it('/me cho biết vai trò, không lộ dữ liệu khi chưa đăng nhập', async () => {
      expect(await getJson('/api/auth/me', noiCookie)).toEqual({ authenticated: true, role: 'family', familyId: noi, familyName: 'Nhà nội' });
      expect(await getJson('/api/auth/me', adminCookie)).toEqual({ authenticated: true, role: 'admin' });
      expect(await (await request('/api/auth/me')).json()).toEqual({ authenticated: false });
    });

    it('mật khẩu quản trị không đăng nhập được vào tài khoản gia đình và ngược lại', async () => {
      expect((await login('nhanoi', ADMIN_PASSWORD)).status).toBe(401);
      expect((await login('admin', 'matkhau-noi-1')).status).toBe(401);
    });

    it('danh sách gia đình không bao giờ trả về mật khẩu đã băm', async () => {
      const text = await (await get('/api/families', adminCookie)).text();
      expect(text).toContain('nhanoi');
      expect(text).not.toContain('pbkdf2');
    });
  });

  describe('Cách ly dữ liệu', () => {
    it('danh sách chỉ có ngày giỗ của gia đình mình', async () => {
      const { events } = await getJson<{ events: EventView[] }>('/api/events', noiCookie);
      expect(events.map((e) => e.fullName)).toEqual(['Ông Bên Nội']);
    });

    it('không lách được bằng tham số family hoặc tìm kiếm', async () => {
      const byFamily = await getJson<{ events: EventView[] }>(`/api/events?family=${ngoai}`, noiCookie);
      const byNone = await getJson<{ events: EventView[] }>('/api/events?family=none', noiCookie);
      const bySearch = await getJson<{ events: EventView[] }>('/api/events?q=bi mat nha ngoai', noiCookie);
      expect(byFamily.events).toEqual([]);
      expect(byNone.events).toEqual([]);
      expect(bySearch.events).toEqual([]);
    });

    it.each([
      ['GET', undefined],
      ['PUT', EVENT_BODY],
      ['DELETE', undefined],
    ])('%s ngày giỗ nhà khác trả 404 và không đổi dữ liệu', async (method, body) => {
      const res = await request(`/api/events/${ngoaiEvent}`, {
        method,
        headers: { 'content-type': 'application/json', cookie: noiCookie },
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(res.status).toBe(404);
      const { event } = await getJson<{ event: EventView }>(`/api/events/${ngoaiEvent}`, adminCookie);
      expect(event.fullName).toBe('Ông Bên Ngoại');
    });

    it('thêm ngày giỗ luôn vào gia đình mình, không gán được sang nhà khác', async () => {
      const created = await send('/api/events', noiCookie, { ...EVENT_BODY, familyId: ngoai });
      const { event } = (await created.json()) as { event: EventView };
      expect(event.familyId).toBe(noi);

      const moved = await send(`/api/events/${noiEvent}`, noiCookie, { ...EVENT_BODY, familyId: ngoai }, 'PUT');
      expect(((await moved.json()) as { event: EventView }).event.familyId).toBe(noi);
    });

    it.each([
      ['/api/calendar?year=2026&month=9'],
      ['/api/year?year=2026'],
      ['/api/backup/export?format=json'],
      ['/api/backup/export?format=csv'],
    ])('%s không chứa dữ liệu nhà khác', async (path) => {
      const text = await (await get(path, noiCookie)).text();
      expect(text).toContain('Ông Bên Nội');
      expect(text).not.toContain('Ông Bên Ngoại');
      expect(text).not.toContain('Chưa Xếp Nhà');
    });

    it('tổng quan không có số liệu cron của toàn hệ thống', async () => {
      await send('/api/notifications/run-now', adminCookie);
      raw.prepare(`INSERT INTO app_settings (key, value) VALUES ('last_cron_result', '{"sent":99}')`).run();
      const dashboard = await getJson<{ lastCron: unknown; counts: { total: number } }>('/api/dashboard', noiCookie);
      expect(dashboard.lastCron).toBeNull();
      expect(dashboard.counts.total).toBe(1);
      expect(JSON.stringify(dashboard)).not.toContain('Ông Bên Ngoại');
    });

    it('quản trị viên vẫn thấy tất cả', async () => {
      const { events } = await getJson<{ events: EventView[] }>('/api/events', adminCookie);
      expect(events).toHaveLength(3);
    });
  });

  describe('Chỉ quản trị viên mới được dùng', () => {
    it.each([
      ['POST', '/api/families'],
      ['PUT', '/api/families/1'],
      ['DELETE', '/api/families/1'],
      ['PUT', '/api/families/1/account'],
      ['DELETE', '/api/families/1/account'],
      ['GET', '/api/channels/telegram/status'],
      ['POST', '/api/channels/telegram/webhook'],
    ])('%s %s từ chối tài khoản gia đình', async (method, path) => {
      const res = await request(path, {
        method,
        headers: { 'content-type': 'application/json', cookie: noiCookie },
        body: method === 'GET' ? undefined : JSON.stringify({ name: 'x', username: 'xxx', password: 'abcdefgh' }),
      });
      expect(res.status).toBe(403);
    });

    it('gia đình không tự đặt lại mật khẩu nhà khác', async () => {
      await send(`/api/families/${ngoai}/account`, noiCookie, { username: 'nhangoai', password: 'bi-chiem-mat' }, 'PUT');
      expect((await login('nhangoai', 'matkhau-ngoai-1')).status).toBe(200);
    });

    it('danh sách gia đình của tài khoản gia đình chỉ có chính nó', async () => {
      const { families } = await getJson<{ families: { id: number }[] }>('/api/families', noiCookie);
      expect(families.map((f) => f.id)).toEqual([noi]);
    });
  });

  describe('Quản lý tài khoản', () => {
    it('quản trị viên cấp tài khoản, kiểm tra tên đăng nhập và độ dài mật khẩu', async () => {
      const family = await createFamily(db, 'Nhà bác');
      const account = (username: string, password: string) => send(`/api/families/${family.id}/account`, adminCookie, { username, password }, 'PUT');
      expect((await account('a', 'matkhau-dai-du')).status).toBe(400);
      expect((await account('admin', 'matkhau-dai-du')).status).toBe(400);
      expect((await account('nhà bác', 'matkhau-dai-du')).status).toBe(400);
      expect((await account('nhabac', 'ngan')).status).toBe(400);
      expect((await account('NHANOI', 'matkhau-dai-du')).status).toBe(409);
      expect((await account('NhaBac', 'matkhau-dai-du')).status).toBe(200);
      expect((await login('nhabac', 'matkhau-dai-du')).status).toBe(200);
    });

    it('đặt lại mật khẩu đăng xuất mọi thiết bị của gia đình đó, không ảnh hưởng nhà khác', async () => {
      await send(`/api/families/${noi}/account`, adminCookie, { username: 'nhanoi', password: 'matkhau-moi-99' }, 'PUT');
      expect((await get('/api/events', noiCookie)).status).toBe(401);
      expect((await get('/api/events', ngoaiCookie)).status).toBe(200);
      expect((await login('nhanoi', 'matkhau-noi-1')).status).toBe(401);
      expect((await login('nhanoi', 'matkhau-moi-99')).status).toBe(200);
    });

    it('thu hồi tài khoản: mất đăng nhập ngay, ngày giỗ vẫn còn', async () => {
      await request(`/api/families/${noi}/account`, { method: 'DELETE', headers: { cookie: adminCookie } });
      expect((await get('/api/events', noiCookie)).status).toBe(401);
      expect((await login('nhanoi', 'matkhau-noi-1')).status).toBe(401);
      const { events } = await getJson<{ events: EventView[] }>(`/api/events?family=${noi}`, adminCookie);
      expect(events).toHaveLength(1);
    });

    it('xóa gia đình làm phiên đăng nhập của gia đình đó mất hiệu lực', async () => {
      await request(`/api/families/${noi}`, { method: 'DELETE', headers: { cookie: adminCookie } });
      expect((await get('/api/events', noiCookie)).status).toBe(401);
    });

    it('gia đình tự đổi mật khẩu: cần mật khẩu cũ, giữ phiên đang dùng, đăng xuất thiết bị khác', async () => {
      const otherDevice = cookieOf(await login('nhanoi', 'matkhau-noi-1'));
      expect((await send('/api/auth/password', noiCookie, { currentPassword: 'sai', newPassword: 'matkhau-moi-99' })).status).toBe(401);
      expect((await send('/api/auth/password', noiCookie, { currentPassword: 'matkhau-noi-1', newPassword: 'ngan' })).status).toBe(400);
      expect((await send('/api/auth/password', noiCookie, { currentPassword: 'matkhau-noi-1', newPassword: 'matkhau-moi-99' })).status).toBe(200);
      expect((await get('/api/events', noiCookie)).status).toBe(200);
      expect((await get('/api/events', otherDevice)).status).toBe(401);
      expect((await login('nhanoi', 'matkhau-moi-99')).status).toBe(200);
    });

    it('quản trị viên không đổi được mật khẩu qua API', async () => {
      expect((await send('/api/auth/password', adminCookie, { currentPassword: ADMIN_PASSWORD, newPassword: 'matkhau-moi-99' })).status).toBe(400);
    });
  });

  describe('Chat ID theo gia đình', () => {
    it('thêm chat luôn giới hạn trong gia đình mình, không mở được sang mọi gia đình', async () => {
      const res = await send('/api/chats', noiCookie, { chatId: '111', allFamilies: true, familyIds: [ngoai] });
      expect(res.status).toBe(201);
      const [chat] = await listChats(db);
      expect(chat).toMatchObject({ chatId: '111', allFamilies: false, familyIds: [noi] });

      await send(`/api/chats/${chat.id}`, noiCookie, { title: 'x', canQuery: true, receiveNotifications: true, allFamilies: true, familyIds: [ngoai] }, 'PUT');
      expect((await listChats(db))[0]).toMatchObject({ title: 'x', allFamilies: false, familyIds: [noi] });
    });

    it('chỉ thấy chat của mình, không sửa hay xóa được chat nhà khác', async () => {
      const other = await createChat(db, { chatId: '222', title: 'Chat ngoại', canQuery: true, receiveNotifications: true, allFamilies: false, familyIds: [ngoai] });
      const adminAll = await createChat(db, { chatId: '333', title: 'Chat quản trị', canQuery: true, receiveNotifications: true });
      const text = await (await get('/api/chats', noiCookie)).text();
      expect(text).not.toContain('222');
      expect(text).not.toContain('333');

      for (const id of [other!.id, adminAll!.id]) {
        expect((await send(`/api/chats/${id}`, noiCookie, { title: 'hack', canQuery: false }, 'PUT')).status).toBe(404);
        expect((await request(`/api/chats/${id}`, { method: 'DELETE', headers: { cookie: noiCookie } })).status).toBe(404);
        expect((await send('/api/chats/test', noiCookie, { id })).status).toBe(400);
      }
      expect(await listChats(db)).toHaveLength(2);
    });

    it('một người thuộc hai gia đình: nhà thứ hai nối thêm, không thấy tên do nhà kia đặt, gỡ không ảnh hưởng nhà kia', async () => {
      await send('/api/chats', noiCookie, { chatId: '111', title: 'Tên riêng nhà nội' });
      expect((await send('/api/chats', ngoaiCookie, { chatId: '111', title: 'x' })).status).toBe(201);

      const { chats } = await getJson<{ chats: { id: number; title: string; editable: boolean; familyIds: number[] }[] }>('/api/chats', ngoaiCookie);
      expect(chats).toMatchObject([{ title: '', editable: false, familyIds: [ngoai] }]);
      expect(JSON.stringify(chats)).not.toContain(String(noi) + ']');

      expect((await send(`/api/chats/${chats[0].id}`, ngoaiCookie, { title: 'đổi', canQuery: false, receiveNotifications: false }, 'PUT')).status).toBe(403);

      await request(`/api/chats/${chats[0].id}`, { method: 'DELETE', headers: { cookie: ngoaiCookie } });
      expect(await listChats(db)).toMatchObject([{ chatId: '111', title: 'Tên riêng nhà nội', familyIds: [noi] }]);
    });

    it('gia đình cuối cùng gỡ chat thì chat bị xóa hẳn, chat của quản trị viên vẫn còn', async () => {
      await send('/api/chats', noiCookie, { chatId: '111' });
      const { chats } = await getJson<{ chats: { id: number }[] }>('/api/chats', noiCookie);
      await request(`/api/chats/${chats[0].id}`, { method: 'DELETE', headers: { cookie: noiCookie } });
      expect(await listChats(db)).toEqual([]);

      await createChat(db, { chatId: '333', title: '', canQuery: true, receiveNotifications: true });
      await send('/api/chats', noiCookie, { chatId: '333' });
      const after = await getJson<{ chats: { id: number }[] }>('/api/chats', noiCookie);
      await request(`/api/chats/${after.chats[0].id}`, { method: 'DELETE', headers: { cookie: noiCookie } });
      expect(await listChats(db)).toMatchObject([{ chatId: '333', allFamilies: true }]);
    });

    it('bot chỉ trả lời dữ liệu nhà đó với chat do gia đình thêm', async () => {
      await send('/api/chats', noiCookie, { channel: 'zalo', chatId: 'z1' });
      const fake = makeFakeSender();
      await handleZaloUpdate({ event_name: 'message.text.received', message: { text: '/namnay', chat: { id: 'z1', chat_type: 'PRIVATE' } } }, db, fake.sender, DUE_DAY);
      expect(fake.sent[0].text).toContain('Ông Bên Nội');
      expect(fake.sent[0].text).not.toContain('Ông Bên Ngoại');
    });
  });

  describe('Lịch nhắc riêng từng gia đình', () => {
    const offsetsSent = (texts: { text: string }[], name: string) => texts.some((m) => m.text.includes(name));

    beforeEach(async () => {
      await createChat(db, { chatId: '1', title: '', canQuery: true, receiveNotifications: true });
    });

    it('gia đình đặt lịch riêng không ảnh hưởng nhà khác', async () => {
      await saveFamilyReminderConfig(db, noi, { reminders: [{ daysBefore: 10, enabled: true }], notificationsEnabled: true, upcomingWindowDays: 30 });
      const fake = makeFakeSender();
      // Còn 3 ngày: lịch chung có mốc 3 ngày, nhà nội chỉ có mốc 10 ngày.
      await runReminders(db, { telegram: fake.sender }, DUE_DAY);
      expect(offsetsSent(fake.sent, 'Ông Bên Ngoại')).toBe(true);
      expect(offsetsSent(fake.sent, 'Ông Bên Nội')).toBe(false);

      const earlier = makeFakeSender();
      await runReminders(db, { telegram: earlier.sender }, VN_7AM('2026-09-15'));
      expect(offsetsSent(earlier.sent, 'Ông Bên Nội')).toBe(true);
      expect(offsetsSent(earlier.sent, 'Ông Bên Ngoại')).toBe(false);
    });

    it('mốc riêng của ngày giỗ vẫn được ưu tiên hơn lịch gia đình', async () => {
      await saveFamilyReminderConfig(db, noi, { reminders: [{ daysBefore: 10, enabled: true }], notificationsEnabled: true, upcomingWindowDays: 30 });
      await createEvent(db, input({ fullName: 'Có Mốc Riêng', familyId: noi, reminderOffsets: [3] }));
      const fake = makeFakeSender();
      await runReminders(db, { telegram: fake.sender }, DUE_DAY);
      expect(offsetsSent(fake.sent, 'Có Mốc Riêng')).toBe(true);
    });

    it('gia đình bỏ hết mốc thì không nhận nhắc, không quay về lịch chung', async () => {
      await saveFamilyReminderConfig(db, noi, { reminders: [], notificationsEnabled: true, upcomingWindowDays: 30 });
      const fake = makeFakeSender();
      await runReminders(db, { telegram: fake.sender }, DUE_DAY);
      expect(offsetsSent(fake.sent, 'Ông Bên Nội')).toBe(false);
    });

    it('gia đình tắt thông báo chỉ tắt nhà đó', async () => {
      await saveFamilyReminderConfig(db, noi, { reminders: [{ daysBefore: 3, enabled: true }], notificationsEnabled: false, upcomingWindowDays: 30 });
      const fake = makeFakeSender();
      await runReminders(db, { telegram: fake.sender }, DUE_DAY);
      expect(offsetsSent(fake.sent, 'Ông Bên Nội')).toBe(false);
      expect(offsetsSent(fake.sent, 'Ông Bên Ngoại')).toBe(true);
    });

    it('lưu qua API chỉ đổi lịch của gia đình mình, lịch chung giữ nguyên', async () => {
      const before = await getJson<unknown>('/api/settings/reminders', adminCookie);
      const payload = { reminders: [{ daysBefore: 9, enabled: true }], notificationsEnabled: false, upcomingWindowDays: 45 };
      expect((await send('/api/settings/reminders', noiCookie, payload, 'PUT')).status).toBe(200);
      expect(await getJson('/api/settings/reminders', noiCookie)).toEqual(payload);
      expect(await getJson('/api/settings/reminders', adminCookie)).toEqual(before);
      expect(await getJson('/api/settings/reminders', ngoaiCookie)).toEqual(before);
    });

    it('gia đình chưa đặt riêng thì hiện theo lịch chung', async () => {
      const general = await getJson<{ reminders: unknown }>('/api/settings/reminders', adminCookie);
      expect(await getJson<{ reminders: unknown }>('/api/settings/reminders', noiCookie)).toMatchObject({ reminders: general.reminders });
    });
  });

  describe('Lịch sử và gửi thủ công', () => {
    it('Chạy ngay của gia đình chỉ gửi nhắc nhà đó', async () => {
      const fake = makeFakeSender();
      await createChat(db, { chatId: '1', title: '', canQuery: true, receiveNotifications: true });
      await runReminders(db, { telegram: fake.sender }, DUE_DAY, { force: true, familyId: noi });
      expect(fake.sent).toHaveLength(1);
      expect(fake.sent[0].text).toContain('Ông Bên Nội');
      expect(fake.sent[0].text).not.toContain('Ông Bên Ngoại');
    });

    it('lịch sử chỉ có dòng của gia đình mình, kể cả sau khi xóa ngày giỗ', async () => {
      await createChat(db, { chatId: '1', title: '', canQuery: true, receiveNotifications: true });
      await runReminders(db, { telegram: makeFakeSender().sender }, DUE_DAY);
      const history = await (await get('/api/notifications/logs', noiCookie)).text();
      expect(history).toContain('Ông Bên Nội');
      expect(history).not.toContain('Ông Bên Ngoại');

      await request(`/api/events/${noiEvent}`, { method: 'DELETE', headers: { cookie: noiCookie } });
      expect(await (await get('/api/notifications/logs', noiCookie)).text()).toContain('Ông Bên Nội');
      const adminLogs = await getJson<{ total: number }>('/api/notifications/logs', adminCookie);
      expect(adminLogs.total).toBe(3);
    });
  });

  describe('Sao lưu của gia đình', () => {
    it('thay thế chỉ xóa ngày giỗ nhà mình', async () => {
      const content = JSON.stringify({ events: [{ ...EVENT_BODY, fullName: 'Từ File' }] });
      await send('/api/backup/import', noiCookie, { format: 'json', content, mode: 'replace' });
      const { events } = await getJson<{ events: EventView[] }>('/api/events', adminCookie);
      expect(events.map((e) => e.fullName).sort()).toEqual(['Chưa Xếp Nhà', 'Từ File', 'Ông Bên Ngoại'].sort());
      expect(events.find((e) => e.fullName === 'Từ File')!.familyId).toBe(noi);
    });

    it('gộp không ghi đè được ngày giỗ nhà khác dù trùng họ tên và ngày', async () => {
      const content = JSON.stringify({ events: [{ ...EVENT_BODY, fullName: 'Ông Bên Ngoại', notes: 'đã bị sửa' }] });
      const res = await send('/api/backup/import', noiCookie, { format: 'json', content, mode: 'merge' });
      expect(await res.json()).toEqual({ ok: true, inserted: 1, updated: 0 });
      const { event } = await getJson<{ event: EventView }>(`/api/events/${ngoaiEvent}`, adminCookie);
      expect(event.notes).toBe('bí mật nhà ngoại');
    });

    it('file có tên gia đình khác hoặc Chat ID: không chuyển dữ liệu sang nhà khác, không thêm chat', async () => {
      const content = JSON.stringify({
        events: [{ ...EVENT_BODY, fullName: 'Lách Gia Đình', familyName: 'Nhà ngoại' }],
        chats: [{ channel: 'telegram', chatId: '999', allFamilies: true }],
        families: ['Gia Đình Lạ'],
      });
      await send('/api/backup/import', noiCookie, { format: 'json', content, mode: 'replace' });
      const { events } = await getJson<{ events: EventView[] }>('/api/events', adminCookie);
      expect(events.find((e) => e.fullName === 'Lách Gia Đình')!.familyId).toBe(noi);
      expect(await listChats(db)).toEqual([]);
      const { families } = await getJson<{ families: { name: string }[] }>('/api/families', adminCookie);
      expect(families.map((f) => f.name)).not.toContain('Gia Đình Lạ');
    });

    it('xuất rồi nhập lại vẫn giữ lịch nhắc của gia đình', async () => {
      await send('/api/settings/reminders', noiCookie, { reminders: [{ daysBefore: 9, enabled: true }], notificationsEnabled: true, upcomingWindowDays: 30 }, 'PUT');
      const file = await (await get('/api/backup/export?format=json', noiCookie)).text();
      expect(file).not.toContain('chats');
      await send('/api/settings/reminders', noiCookie, { reminders: [{ daysBefore: 1, enabled: true }], notificationsEnabled: true, upcomingWindowDays: 30 }, 'PUT');
      await send('/api/backup/import', noiCookie, { format: 'json', content: file, mode: 'replace' });
      expect(await getJson('/api/settings/reminders', noiCookie)).toMatchObject({ reminders: [{ daysBefore: 9, enabled: true }] });
    });
  });
});

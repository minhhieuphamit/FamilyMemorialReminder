import { beforeEach, describe, expect, it } from 'vitest';
import { handleTelegramUpdate, type TelegramUpdate } from '../src/bot/handler';
import { parseMessage } from '../src/bot/parser';
import { buildReply } from '../src/bot/replies';
import { createChat } from '../src/database/chats-repo';
import { createEvent } from '../src/database/events-repo';
import { normalizeVietnamese, splitMessage } from '../src/utils/text';
import { createTestDb } from './helpers/fake-d1';
import { makeEvent, makeFakeTelegram, VN_7AM } from './helpers/factories';

describe('Chuẩn hóa tiếng Việt', () => {
  it('bỏ dấu, đ thành d, bỏ dấu câu', () => {
    expect(normalizeVietnamese('Giỗ Ông Nội còn bao nhiêu ngày?')).toBe('gio ong noi con bao nhieu ngay');
    expect(normalizeVietnamese('ĐỖ THỊ Đào!')).toBe('do thi dao');
  });

  it('xử lý được cả ký tự tổ hợp sẵn (NFC) và tách rời (NFD)', () => {
    expect(normalizeVietnamese('giỗ'.normalize('NFC'))).toBe('gio');
    expect(normalizeVietnamese('giỗ'.normalize('NFD'))).toBe('gio');
  });
});

describe('Parser lệnh', () => {
  it.each([
    ['/start', 'start'],
    ['/help', 'help'],
    ['/homnay', 'today'],
    ['/thangnay', 'this_month'],
    ['/thangam', 'lunar_month'],
    ['/thangtoi', 'next_month'],
    ['/saptoi', 'upcoming'],
    ['/namnay', 'this_year'],
    ['/HomNay', 'today'],
    ['/homnay@ten_bot', 'today'],
  ])('%s', (text, type) => {
    expect(parseMessage(text).type).toBe(type);
  });

  it('/tim có tham số', () => {
    expect(parseMessage('/tim ông nội')).toEqual({ type: 'search', query: 'ông nội' });
    expect(parseMessage('/tim@ten_bot Bình')).toEqual({ type: 'search', query: 'Bình' });
    expect(parseMessage('/tim')).toEqual({ type: 'search', query: '' });
  });

  it('lệnh lạ', () => {
    expect(parseMessage('/khongco')).toEqual({ type: 'unknown', isCommand: true });
  });
});

describe('Parser câu tự nhiên', () => {
  it.each([
    ['Tháng này có giỗ ai?', 'this_month'],
    ['thang nay co gio ai', 'this_month'],
    ['Tháng sau có những ngày giỗ nào?', 'next_month'],
    ['tháng tới có giỗ không', 'next_month'],
    ['Tuần tới có giỗ không?', 'next_week'],
    ['tuan sau co gio khong', 'next_week'],
    ['Tuần này có giỗ không', 'this_week'],
    ['Hôm nay có giỗ ai không', 'today'],
    ['ngày mai có giỗ không', 'tomorrow'],
    ['Ngày giỗ gần nhất là ngày nào?', 'nearest'],
    ['ngay gio gan nhat la khi nao', 'nearest'],
    ['Sắp tới có giỗ ai', 'upcoming'],
    ['Năm nay có những ngày giỗ nào', 'this_year'],
    ['Tháng âm này có giỗ ai', 'lunar_month'],
    ['hướng dẫn', 'help'],
    ['Xin chào', 'start'],
  ])('"%s" -> %s', (text, type) => {
    expect(parseMessage(text).type).toBe(type);
  });

  it.each([
    ['Giỗ ông nội còn bao nhiêu ngày?', 'ong noi'],
    ['gio ong noi con bao nhieu ngay', 'ong noi'],
    ['Giỗ bà ngoại khi nào?', 'ba ngoai'],
    ['Đám giỗ của mẹ là ngày nào', 'me'],
    ['Giỗ bố còn mấy ngày nữa vậy', 'bo'],
    ['Giỗ ông nội', 'ong noi'],
    ['ngày giỗ gần nhất của bác', 'bac'],
  ])('"%s" -> tìm "%s"', (text, query) => {
    expect(parseMessage(text)).toEqual({ type: 'person', query });
  });

  it('tháng theo số', () => {
    expect(parseMessage('Tháng 8 có giỗ ai')).toEqual({ type: 'specific_month', month: 8 });
    expect(parseMessage('tháng 13 có giỗ ai').type).not.toBe('specific_month');
  });

  it('câu không liên quan', () => {
    expect(parseMessage('trời hôm qua đẹp')).toEqual({ type: 'unknown', isCommand: false });
  });
});

describe('Nội dung trả lời', () => {
  const events = [
    makeEvent({ id: 1, fullName: 'Nguyễn Văn An', relationship: 'Ông nội', lunarDay: 15, lunarMonth: 8, notes: 'Chuẩn bị đồ cúng' }),
    makeEvent({ id: 2, fullName: 'Trần Thị Bình', relationship: 'Bà nội', lunarDay: 20, lunarMonth: 9 }),
  ];
  const today = '2026-09-22';

  it('không có quan hệ thì không in cặp ngoặc rỗng', () => {
    const text = buildReply({ type: 'nearest' }, [makeEvent({ relationship: '' })], today);
    expect(text).toContain('Nguyễn Văn An');
    expect(text).not.toContain('()');
  });

  it('hôm nay không có', () => {
    expect(buildReply({ type: 'today' }, events, today)).toContain('Không có ngày giỗ');
  });

  it('tháng này liệt kê đúng người, kèm ngày âm dương và số ngày còn lại', () => {
    const text = buildReply({ type: 'this_month' }, events, today);
    expect(text).toContain('Nguyễn Văn An');
    expect(text).toContain('15/08 âm');
    expect(text).toContain('25/09/2026');
    expect(text).toContain('còn 3 ngày');
    expect(text).not.toContain('Trần Thị Bình');
  });

  it('tháng tới từ tháng 12 chuyển sang năm sau', () => {
    expect(buildReply({ type: 'next_month' }, events, '2026-12-15')).toContain('tháng 1/2027');
  });

  it('hỏi theo người trả về số ngày còn lại và ghi chú', () => {
    const text = buildReply({ type: 'person', query: 'ong noi' }, events, today);
    expect(text).toContain('còn 3 ngày');
    expect(text).toContain('Chuẩn bị đồ cúng');
  });

  it('không tìm thấy', () => {
    expect(buildReply({ type: 'search', query: 'xyz' }, events, today)).toContain('Không tìm thấy');
  });

  it('gần nhất', () => {
    expect(buildReply({ type: 'nearest' }, events, today)).toContain('Nguyễn Văn An');
  });

  it('thoát HTML trong từ khóa người dùng nhập', () => {
    expect(buildReply({ type: 'search', query: '<script>' }, events, today)).toContain('&lt;script&gt;');
  });

  it('báo ngày không tồn tại khi chưa có quy tắc', () => {
    const missing = makeEvent({ fullName: 'Đỗ Giang', lunarDay: 30, lunarMonth: 12, missingDayRule: 'skip' });
    const text = buildReply({ type: 'this_month' }, [missing], '2025-01-20');
    expect(text).toContain('Cần xử lý');
    expect(text).toContain('Đỗ Giang');
  });
});

describe('Chia tin nhắn dài', () => {
  it('không vượt giới hạn và không làm mất dòng', () => {
    const text = Array.from({ length: 500 }, (_, i) => `Dòng số ${i}`).join('\n');
    const parts = splitMessage(text, 1000);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(1000);
    expect(parts.join('\n')).toBe(text);
  });
});

describe('Xử lý update và quyền truy cập', () => {
  let db: D1Database;
  const now = VN_7AM('2026-09-22');
  const message = (chatId: number, text: string, type = 'private'): TelegramUpdate => ({
    message: { text, chat: { id: chatId, type } },
  });

  beforeEach(async () => {
    ({ db } = createTestDb());
    const { id: _i, createdAt: _c, updatedAt: _u, ...input } = makeEvent({ fullName: 'Nguyễn Văn An' });
    await createEvent(db, input);
    await createChat(db, { chatId: '111', title: 'Bố', canQuery: true, receiveNotifications: true });
    await createChat(db, { chatId: '333', title: 'Chỉ nhận tin', canQuery: false, receiveNotifications: true });
  });

  it('chat được phép nhận dữ liệu', async () => {
    const tg = makeFakeTelegram();
    await handleTelegramUpdate(message(111, '/thangnay'), db, tg.client, now);
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0].text).toContain('Nguyễn Văn An');
  });

  it('chat lạ không nhận được dữ liệu gia đình', async () => {
    const tg = makeFakeTelegram();
    for (const text of ['/thangnay', '/namnay', '/tim an', 'Tháng này có giỗ ai?', 'Giỗ ông nội còn bao nhiêu ngày?']) {
      await handleTelegramUpdate(message(999, text), db, tg.client, now);
    }
    expect(tg.sent).toEqual([]);
  });

  it('chat lạ gõ /start nhận hướng dẫn đăng ký và danh sách tên gia đình', async () => {
    const tg = makeFakeTelegram();
    await handleTelegramUpdate(message(999, '/start'), db, tg.client, now);
    expect(tg.sent).toHaveLength(2);
    expect(tg.sent[0].text).toContain('999');
    expect(tg.sent[0].text).toContain('chưa được cấp quyền');
    expect(tg.sent[0].text).not.toContain('Nguyễn');
  });

  it('chat bị tắt quyền tra cứu thì không xem được', async () => {
    const tg = makeFakeTelegram();
    await handleTelegramUpdate(message(333, '/thangnay'), db, tg.client, now);
    expect(tg.sent).toEqual([]);
  });

  it('nút bấm inline của chat lạ cũng bị chặn, nhưng vẫn đóng trạng thái chờ', async () => {
    const tg = makeFakeTelegram();
    await handleTelegramUpdate(
      { callback_query: { id: 'cb1', data: '/namnay', message: { chat: { id: 999, type: 'private' } } } },
      db,
      tg.client,
      now,
    );
    expect(tg.answered).toEqual(['cb1']);
    expect(tg.sent).toEqual([]);
  });

  it('nút bấm inline của chat được phép trả về kèm menu', async () => {
    const tg = makeFakeTelegram();
    await handleTelegramUpdate(
      { callback_query: { id: 'cb2', data: '/thangnay', message: { chat: { id: 111, type: 'private' } } } },
      db,
      tg.client,
      now,
    );
    expect(tg.answered).toEqual(['cb2']);
    expect(tg.sent[0].keyboard).toBe(true);
  });

  it('/start hiển thị hướng dẫn kèm bàn phím', async () => {
    const tg = makeFakeTelegram();
    await handleTelegramUpdate(message(111, '/start'), db, tg.client, now);
    expect(tg.sent[0].text).toContain('/homnay');
    expect(tg.sent[0].keyboard).toBe(true);
  });

  it('trong nhóm, câu không liên quan thì bot im lặng; riêng tư thì gợi ý', async () => {
    const tg = makeFakeTelegram();
    await createChat(db, { chatId: '-500', title: 'Nhóm', canQuery: true, receiveNotifications: true });
    await handleTelegramUpdate(message(-500, 'ăn cơm chưa', 'supergroup'), db, tg.client, now);
    expect(tg.sent).toEqual([]);
    await handleTelegramUpdate(message(111, 'ăn cơm chưa'), db, tg.client, now);
    expect(tg.sent[0].text).toContain('chưa hiểu');
  });

  it('bỏ qua update không có nội dung văn bản', async () => {
    const tg = makeFakeTelegram();
    await handleTelegramUpdate({ message: { chat: { id: 111, type: 'private' } } }, db, tg.client, now);
    await handleTelegramUpdate({ update_id: 5 }, db, tg.client, now);
    expect(tg.sent).toEqual([]);
  });
});

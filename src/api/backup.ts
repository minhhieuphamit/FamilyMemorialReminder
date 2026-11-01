import { Hono } from 'hono';
import { createChat, listChats, updateChat, type ChatInput } from '../database/chats-repo';
import { importEvents } from '../database/events-repo';
import { ensureFamilies, listFamilies } from '../database/families-repo';
import { getFamilyReminderConfig, listReminderSettings, replaceReminderSettings, saveFamilyReminderConfig } from '../database/settings-repo';
import { familyScope, visibleEvents } from '../middleware/auth';
import { CHANNELS, type Channel, type MemorialEvent, type MemorialEventInput, type ReminderSetting } from '../types/domain';
import type { AppEnv } from '../types/env';
import { parseCsv, toCsv, unguardCell } from '../utils/csv';
import { todayInVietnam } from '../utils/dates';
import { normalizeVietnamese } from '../utils/text';
import { isValidChatId, isValidOffset, parseFamilyName, validateEventInput } from '../utils/validation';

export const backupRoutes = new Hono<AppEnv>();

const MAX_IMPORT_EVENTS = 1000;

const CSV_COLUMNS = [
  'full_name', 'relationship', 'lunar_day', 'lunar_month', 'is_leap_month', 'death_year', 'death_solar_date',
  'notes', 'leap_month_rule', 'missing_day_rule', 'reminder_enabled', 'reminder_offsets', 'family',
];

function eventToCsvRow(e: MemorialEvent): string[] {
  return [
    e.fullName, e.relationship, String(e.lunarDay), String(e.lunarMonth), e.isLeapMonth ? '1' : '0',
    e.deathYear === null ? '' : String(e.deathYear), e.deathSolarDate ?? '', e.notes, e.leapMonthRule,
    e.missingDayRule, e.reminderEnabled ? '1' : '0', e.reminderOffsets ? e.reminderOffsets.join(';') : '',
    e.familyName ?? '',
  ];
}

function csvRowToRaw(header: string[], row: string[]): Record<string, unknown> {
  const get = (name: string) => unguardCell((row[header.indexOf(name)] ?? '').trim());
  const toInt = (value: string) => (/^\d+$/.test(value) ? Number(value) : value === '' ? null : NaN);
  return {
    fullName: get('full_name'),
    relationship: get('relationship'),
    lunarDay: toInt(get('lunar_day')),
    lunarMonth: toInt(get('lunar_month')),
    isLeapMonth: get('is_leap_month') === '1',
    deathYear: toInt(get('death_year')),
    deathSolarDate: get('death_solar_date') || null,
    notes: get('notes'),
    leapMonthRule: get('leap_month_rule') || 'exact',
    missingDayRule: get('missing_day_rule') || 'skip',
    reminderEnabled: get('reminder_enabled') !== '0',
    reminderOffsets: get('reminder_offsets') ? get('reminder_offsets').split(';').map(Number) : null,
    // File cũ không có cột family: undefined để chế độ gộp giữ nguyên gia đình hiện tại.
    familyName: header.includes('family') ? get('family') || null : undefined,
  };
}

function parseReminders(raw: unknown): ReminderSetting[] | null {
  if (!Array.isArray(raw) || raw.length > 10) return null;
  if (!raw.every((r) => isValidOffset(r?.daysBefore) && typeof r?.enabled === 'boolean')) return null;
  if (new Set(raw.map((r) => r.daysBefore)).size !== raw.length) return null;
  return raw.map((r) => ({ daysBefore: r.daysBefore, enabled: r.enabled }));
}

type BackupChat = ChatInput & { channel: Channel; familyNames: string[] };

function parseChats(raw: unknown): BackupChat[] | null {
  if (!Array.isArray(raw) || raw.length > 100) return null;
  const channelOf = (r: { channel?: unknown }) => (r?.channel ?? 'telegram') as Channel;
  if (!raw.every((r) => CHANNELS.includes(channelOf(r)) && isValidChatId(channelOf(r), r?.chatId))) return null;
  return raw.map((r) => ({
    channel: channelOf(r),
    chatId: r.chatId,
    title: typeof r.title === 'string' ? r.title.slice(0, 100) : '',
    canQuery: r.canQuery !== false,
    receiveNotifications: r.receiveNotifications !== false,
    allFamilies: r.allFamilies !== false,
    familyNames: Array.isArray(r.familyNames) ? r.familyNames.map(parseFamilyName).filter((n: string | null) => n !== null) : [],
  }));
}

backupRoutes.get('/export', async (c) => {
  const db = c.env.DB;
  const events = await visibleEvents(c);
  const scope = familyScope(c);
  const date = todayInVietnam();
  const noStore = { 'Cache-Control': 'no-store' };

  if (c.req.query('format') === 'csv') {
    const csv = toCsv([CSV_COLUMNS, ...events.map(eventToCsvRow)]);
    return c.body(csv, 200, {
      ...noStore,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ngay-gio-${date}.csv"`,
    });
  }

  if (scope !== null) {
    // File của gia đình chỉ có dữ liệu của gia đình đó. Chat không kèm vì có thể dùng chung với nhà khác.
    const config = await getFamilyReminderConfig(db, scope);
    const familyBackup = {
      version: 2,
      exportedAt: new Date().toISOString(),
      events: events.map(({ id: _id, createdAt: _c, updatedAt: _u, familyId: _f, familyName: _n, ...rest }) => rest),
      reminders: config.reminders,
    };
    return c.body(JSON.stringify(familyBackup, null, 2), 200, {
      ...noStore,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="ngay-gio-${date}.json"`,
    });
  }

  const [reminders, chats, families] = await Promise.all([listReminderSettings(db), listChats(db), listFamilies(db)]);
  const familyName = (id: number) => families.find((f) => f.id === id)?.name;
  const backup = {
    version: 2,
    exportedAt: new Date().toISOString(),
    families: families.map((f) => f.name),
    events: events.map(({ id: _id, createdAt: _c, updatedAt: _u, familyId: _f, ...rest }) => rest),
    reminders,
    chats: chats.map(({ channel, chatId, title, canQuery, receiveNotifications, allFamilies, familyIds }) => ({
      channel,
      chatId,
      title,
      canQuery,
      receiveNotifications,
      allFamilies,
      familyNames: familyIds.map(familyName),
    })),
  };
  return c.body(JSON.stringify(backup, null, 2), 200, {
    ...noStore,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="ngay-gio-${date}.json"`,
  });
});

/**
 * Nhập ngày giỗ từ JSON hoặc CSV. Kiểm tra toàn bộ trước khi ghi; có một dòng lỗi thì không ghi gì.
 * merge: cập nhật dòng trùng họ tên + ngày âm, thêm dòng mới. replace: xóa hết rồi nhập lại.
 */
backupRoutes.post('/import', async (c) => {
  const body = await c.req
    .json<{ format?: unknown; content?: unknown; mode?: unknown }>()
    .catch(() => null);
  if (!body || typeof body.content !== 'string') return c.json({ error: 'Thiếu nội dung file' }, 400);
  const mode = body.mode === 'replace' ? 'replace' : 'merge';

  let rawEvents: Record<string, unknown>[];
  let rawReminders: unknown;
  let rawChats: unknown;
  let rawFamilies: unknown;
  if (body.format === 'csv') {
    const [header, ...rows] = parseCsv(body.content);
    if (!header || !['full_name', 'lunar_day', 'lunar_month'].every((col) => header.includes(col))) {
      return c.json({ error: 'File CSV thiếu cột bắt buộc: full_name, lunar_day, lunar_month' }, 400);
    }
    rawEvents = rows.map((row) => csvRowToRaw(header, row));
  } else {
    try {
      const parsed = JSON.parse(body.content) as { events?: unknown; reminders?: unknown; chats?: unknown; families?: unknown } | unknown[];
      const list = Array.isArray(parsed) ? parsed : parsed.events;
      if (!Array.isArray(list)) return c.json({ error: 'File JSON phải có danh sách "events"' }, 400);
      rawEvents = list;
      if (!Array.isArray(parsed)) {
        rawReminders = parsed.reminders;
        rawChats = parsed.chats;
        rawFamilies = parsed.families;
      }
    } catch {
      return c.json({ error: 'File JSON không đọc được' }, 400);
    }
  }
  if (rawEvents.length > MAX_IMPORT_EVENTS) {
    return c.json({ error: `Tối đa ${MAX_IMPORT_EVENTS} ngày giỗ mỗi lần nhập` }, 400);
  }

  const valid: { input: MemorialEventInput; familyName: string | null | undefined }[] = [];
  const errors: { row: number; fields: Record<string, string> }[] = [];
  rawEvents.forEach((raw, index) => {
    // familyId của database khác không có nghĩa; gia đình đi theo tên.
    const result = validateEventInput({ ...raw, familyId: null });
    const familyName = raw?.familyName === undefined ? undefined : raw.familyName === null ? null : parseFamilyName(raw.familyName);
    if (result.ok && (familyName !== null || raw?.familyName === null)) valid.push({ input: result.data, familyName });
    else errors.push({ row: index + 1, fields: result.ok ? { familyName: 'Tên gia đình không hợp lệ' } : result.errors });
  });
  if (errors.length > 0) {
    return c.json({ error: 'File có dòng không hợp lệ, chưa ghi dữ liệu nào', rows: errors.slice(0, 20) }, 400);
  }

  const reminders = rawReminders === undefined ? [] : parseReminders(rawReminders);
  const chats = rawChats === undefined ? [] : parseChats(rawChats);
  if (reminders === null || chats === null) {
    return c.json({ error: 'Lịch nhắc hoặc Chat ID trong file không hợp lệ, chưa ghi dữ liệu nào' }, 400);
  }

  const keyOf = (e: MemorialEventInput) =>
    `${normalizeVietnamese(e.fullName)}|${e.lunarDay}|${e.lunarMonth}|${e.isLeapMonth ? 1 : 0}`;
  const existing = mode === 'merge' ? new Map((await visibleEvents(c)).map((e) => [keyOf(e), e])) : new Map<string, MemorialEvent>();
  const inserts: MemorialEventInput[] = [];
  const updates: { id: number; input: MemorialEventInput }[] = [];

  const scope = familyScope(c);
  if (scope !== null) {
    // Tài khoản gia đình: mọi dòng đều về gia đình của mình, bỏ qua tên gia đình và Chat ID trong file.
    for (const { input } of valid) {
      const current = existing.get(keyOf(input));
      if (current) updates.push({ id: current.id, input: { ...input, familyId: scope } });
      else inserts.push({ ...input, familyId: scope });
    }
    await importEvents(c.env.DB, inserts, updates, mode === 'replace' ? scope : null);
    if (mode === 'replace' && reminders.length > 0) {
      const config = await getFamilyReminderConfig(c.env.DB, scope);
      await saveFamilyReminderConfig(c.env.DB, scope, { ...config, reminders });
    }
    return c.json({ ok: true, inserted: inserts.length, updated: updates.length });
  }

  const familyNames = [
    ...(Array.isArray(rawFamilies) ? rawFamilies.map(parseFamilyName) : []),
    ...valid.map((v) => v.familyName),
    ...chats.flatMap((chat) => chat.familyNames),
  ].filter((name): name is string => Boolean(name));
  const familyIdOf = await ensureFamilies(c.env.DB, familyNames);

  for (const { input, familyName } of valid) {
    const current = existing.get(keyOf(input));
    const familyId = familyName ? familyIdOf(familyName) : familyName === null ? null : (current?.familyId ?? null);
    if (current) updates.push({ id: current.id, input: { ...input, familyId } });
    else inserts.push({ ...input, familyId });
  }
  await importEvents(c.env.DB, inserts, updates, mode === 'replace' ? 'all' : null);

  // Chat ID có sẵn chỉ được đổi khi khôi phục toàn bộ; lịch nhắc cũng vậy.
  const currentChats = await listChats(c.env.DB);
  for (const { familyNames: names, ...chat } of chats) {
    const input = { ...chat, familyIds: names.map(familyIdOf) };
    const current = currentChats.find((x) => x.channel === chat.channel && x.chatId === chat.chatId);
    if (!current) await createChat(c.env.DB, input);
    else if (mode === 'replace') await updateChat(c.env.DB, current.id, input);
  }
  if (mode === 'replace' && reminders.length > 0) await replaceReminderSettings(c.env.DB, reminders);
  return c.json({ ok: true, inserted: inserts.length, updated: updates.length });
});

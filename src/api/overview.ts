import { Hono } from 'hono';
import { listNotificationChats } from '../database/chats-repo';
import { getFamilyReminderConfig, getLastCronRun, getUpcomingWindow } from '../database/settings-repo';
import { familyScope, visibleEvents } from '../middleware/auth';
import { filterByFamily, listOccurrences, toItemDTO, toUnresolvedDTO } from '../services/memorial-service';
import type { CalendarData, DashboardData } from '../types/domain';
import type { AppEnv } from '../types/env';
import { addDays, parseISODate, solarMonthRange, toISODate, todayInVietnam } from '../utils/dates';

export const overviewRoutes = new Hono<AppEnv>();

overviewRoutes.get('/dashboard', async (c) => {
  const db = c.env.DB;
  const today = todayInVietnam();
  const { year, month } = parseISODate(today);
  const scope = familyScope(c);
  const [events, windowDays, allChats, lastCron] = await Promise.all([
    visibleEvents(c),
    scope === null ? getUpcomingWindow(db) : getFamilyReminderConfig(db, scope).then((config) => config.upcomingWindowDays),
    listNotificationChats(db),
    // Số liệu cron là tổng của mọi gia đình nên chỉ quản trị viên được xem.
    scope === null ? getLastCronRun(db) : null,
  ]);
  const chats = scope === null ? allChats : allChats.filter((chat) => chat.familyIds.includes(scope));

  const monthRange = solarMonthRange(year, month);
  const inMonth = listOccurrences(events, monthRange.from, monthRange.to, today);
  const upcoming = listOccurrences(events, today, addDays(today, windowDays), today);
  // Cảnh báo ngày âm không tồn tại trong cả năm nay để kịp cấu hình quy tắc.
  const yearAhead = listOccurrences(events, today, addDays(today, 365), today);

  const data: DashboardData = {
    today,
    counts: {
      total: events.length,
      today: upcoming.items.filter((i) => i.daysLeft === 0).length,
      thisMonth: inMonth.items.length,
      upcoming: upcoming.items.length,
      unresolved: yearAhead.unresolved.length,
    },
    todayItems: upcoming.items.filter((i) => i.daysLeft === 0).map(toItemDTO),
    upcoming: upcoming.items.filter((i) => i.daysLeft > 0).map(toItemDTO),
    unresolved: yearAhead.unresolved.map(toUnresolvedDTO),
    channelsConfigured: [
      ...(c.env.TELEGRAM_BOT_TOKEN ? (['telegram'] as const) : []),
      ...(c.env.ZALO_BOT_TOKEN ? (['zalo'] as const) : []),
    ],
    activeChats: chats.length,
    lastCron,
  };
  return c.json(data);
});

overviewRoutes.get('/calendar', async (c) => {
  const today = todayInVietnam();
  const now = parseISODate(today);
  const year = Number(c.req.query('year') ?? now.year);
  const month = Number(c.req.query('month') ?? now.month);
  if (!Number.isInteger(year) || year < 1900 || year > 2199 || !Number.isInteger(month) || month < 1 || month > 12) {
    return c.json({ error: 'Tháng hoặc năm không hợp lệ' }, 400);
  }
  const range = solarMonthRange(year, month);
  const events = filterByFamily(await visibleEvents(c), c.req.query('family'));
  const { items, unresolved } = listOccurrences(events, range.from, range.to, today);
  const data: CalendarData = {
    year,
    month,
    items: items.map(toItemDTO),
    unresolved: unresolved.map(toUnresolvedDTO),
  };
  return c.json(data);
});

// Danh sách cả năm dùng cho chế độ xem theo tháng.
overviewRoutes.get('/year', async (c) => {
  const today = todayInVietnam();
  const year = Number(c.req.query('year') ?? parseISODate(today).year);
  if (!Number.isInteger(year) || year < 1900 || year > 2199) {
    return c.json({ error: 'Năm không hợp lệ' }, 400);
  }
  const { items, unresolved } = listOccurrences(
    filterByFamily(await visibleEvents(c), c.req.query('family')),
    toISODate(year, 1, 1),
    toISODate(year, 12, 31),
    today,
  );
  return c.json({ year, items: items.map(toItemDTO), unresolved: unresolved.map(toUnresolvedDTO) });
});

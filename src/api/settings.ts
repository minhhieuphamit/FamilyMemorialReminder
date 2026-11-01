import { Hono } from 'hono';
import {
  getFamilyReminderConfig,
  getNotificationsEnabled,
  getUpcomingWindow,
  listReminderSettings,
  replaceReminderSettings,
  saveFamilyReminderConfig,
  setAppSetting,
} from '../database/settings-repo';
import { familyScope } from '../middleware/auth';
import type { ReminderSetting } from '../types/domain';
import type { AppEnv } from '../types/env';
import { isValidOffset } from '../utils/validation';

export const settingsRoutes = new Hono<AppEnv>();

settingsRoutes.get('/reminders', async (c) => {
  const db = c.env.DB;
  const scope = familyScope(c);
  if (scope !== null) return c.json(await getFamilyReminderConfig(db, scope));
  const [reminders, notificationsEnabled, upcomingWindowDays] = await Promise.all([
    listReminderSettings(db),
    getNotificationsEnabled(db),
    getUpcomingWindow(db),
  ]);
  return c.json({ reminders, notificationsEnabled, upcomingWindowDays });
});

settingsRoutes.put('/reminders', async (c) => {
  const body = await c.req
    .json<{ reminders?: unknown; notificationsEnabled?: unknown; upcomingWindowDays?: unknown }>()
    .catch(() => null);
  const reminders = body?.reminders;
  if (
    !Array.isArray(reminders) ||
    reminders.length > 10 ||
    !reminders.every((r) => isValidOffset(r?.daysBefore) && typeof r?.enabled === 'boolean') ||
    new Set(reminders.map((r) => r.daysBefore)).size !== reminders.length
  ) {
    return c.json({ error: 'Mốc nhắc phải từ 0 đến 60 ngày, không trùng nhau, tối đa 10 mốc' }, 400);
  }
  const window = body?.upcomingWindowDays;
  if (!Number.isInteger(window) || (window as number) < 1 || (window as number) > 365) {
    return c.json({ error: 'Khoảng "sắp tới" phải từ 1 đến 365 ngày' }, 400);
  }
  if (typeof body?.notificationsEnabled !== 'boolean') {
    return c.json({ error: 'Giá trị bật/tắt thông báo không hợp lệ' }, 400);
  }

  const scope = familyScope(c);
  if (scope !== null) {
    await saveFamilyReminderConfig(c.env.DB, scope, {
      reminders: reminders as ReminderSetting[],
      notificationsEnabled: body.notificationsEnabled,
      upcomingWindowDays: window as number,
    });
    return c.json({ ok: true });
  }
  await replaceReminderSettings(c.env.DB, reminders);
  await setAppSetting(c.env.DB, 'notifications_enabled', String(body.notificationsEnabled));
  await setAppSetting(c.env.DB, 'upcoming_window_days', String(window));
  return c.json({ ok: true });
});

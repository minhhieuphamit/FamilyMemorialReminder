import type { CronRunResult, ReminderSetting } from '../types/domain';

export async function listReminderSettings(db: D1Database): Promise<ReminderSetting[]> {
  const { results } = await db
    .prepare('SELECT days_before, enabled FROM notification_settings ORDER BY days_before DESC')
    .all<{ days_before: number; enabled: number }>();
  return results.map((r) => ({ daysBefore: r.days_before, enabled: r.enabled === 1 }));
}

/** Thay toàn bộ lịch nhắc chung trong một giao dịch. */
export async function replaceReminderSettings(db: D1Database, settings: ReminderSetting[]): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM notification_settings'),
    ...settings.map((s) =>
      db
        .prepare('INSERT INTO notification_settings (days_before, enabled) VALUES (?, ?)')
        .bind(s.daysBefore, s.enabled ? 1 : 0),
    ),
  ]);
}

export async function getAppSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row ? row.value : null;
}

export async function setAppSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(key, value)
    .run();
}

export async function getNotificationsEnabled(db: D1Database): Promise<boolean> {
  return (await getAppSetting(db, 'notifications_enabled')) !== 'false';
}

export async function getUpcomingWindow(db: D1Database): Promise<number> {
  const value = Number(await getAppSetting(db, 'upcoming_window_days'));
  return Number.isInteger(value) && value > 0 ? value : 30;
}

export interface ReminderConfig {
  reminders: ReminderSetting[];
  notificationsEnabled: boolean;
  upcomingWindowDays: number;
}

/** Cấu hình gia đình đang dùng. Chưa tùy chỉnh thì hiện theo lịch chung. */
export async function getFamilyReminderConfig(db: D1Database, familyId: number): Promise<ReminderConfig> {
  const [family, own, general, window] = await Promise.all([
    db
      .prepare('SELECT notifications_enabled, upcoming_window_days, reminders_customized FROM families WHERE id = ?')
      .bind(familyId)
      .first<{ notifications_enabled: number; upcoming_window_days: number | null; reminders_customized: number }>(),
    db
      .prepare('SELECT days_before, enabled FROM family_reminder_settings WHERE family_id = ? ORDER BY days_before DESC')
      .bind(familyId)
      .all<{ days_before: number; enabled: number }>(),
    listReminderSettings(db),
    getUpcomingWindow(db),
  ]);
  return {
    reminders: family?.reminders_customized ? own.results.map((r) => ({ daysBefore: r.days_before, enabled: r.enabled === 1 })) : general,
    notificationsEnabled: family?.notifications_enabled !== 0,
    upcomingWindowDays: family?.upcoming_window_days ?? window,
  };
}

export async function saveFamilyReminderConfig(db: D1Database, familyId: number, config: ReminderConfig): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM family_reminder_settings WHERE family_id = ?').bind(familyId),
    ...config.reminders.map((r) =>
      db
        .prepare('INSERT INTO family_reminder_settings (family_id, days_before, enabled) VALUES (?, ?, ?)')
        .bind(familyId, r.daysBefore, r.enabled ? 1 : 0),
    ),
    db
      .prepare('UPDATE families SET notifications_enabled = ?, upcoming_window_days = ?, reminders_customized = 1 WHERE id = ?')
      .bind(config.notificationsEnabled ? 1 : 0, config.upcomingWindowDays, familyId),
  ]);
}

export interface FamilyCronConfig {
  enabled: boolean;
  /** null: theo lịch chung. */
  offsets: number[] | null;
}

/** Cấu hình của mọi gia đình, nạp một lượt cho cron. */
export async function listFamilyCronConfigs(db: D1Database): Promise<Map<number, FamilyCronConfig>> {
  const [families, reminders] = await db.batch<{ id: number; notifications_enabled: number; reminders_customized: number } | { family_id: number; days_before: number }>([
    db.prepare('SELECT id, notifications_enabled, reminders_customized FROM families'),
    db.prepare('SELECT family_id, days_before FROM family_reminder_settings WHERE enabled = 1'),
  ]);
  const rows = reminders.results as { family_id: number; days_before: number }[];
  const configs = new Map<number, FamilyCronConfig>();
  for (const f of families.results as { id: number; notifications_enabled: number; reminders_customized: number }[]) {
    configs.set(f.id, {
      enabled: f.notifications_enabled === 1,
      offsets: f.reminders_customized ? rows.filter((r) => r.family_id === f.id).map((r) => r.days_before) : null,
    });
  }
  return configs;
}

export async function getLastCronRun(db: D1Database): Promise<CronRunResult | null> {
  const value = await getAppSetting(db, 'last_cron_result');
  return value ? (JSON.parse(value) as CronRunResult) : null;
}

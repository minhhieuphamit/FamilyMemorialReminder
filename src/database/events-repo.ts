import type { MemorialEvent, MemorialEventInput } from '../types/domain';

interface EventRow {
  id: number;
  full_name: string;
  relationship: string;
  family_id: number | null;
  family_name: string | null;
  lunar_day: number;
  lunar_month: number;
  is_leap_month: number;
  death_year: number | null;
  death_solar_date: string | null;
  notes: string;
  leap_month_rule: MemorialEvent['leapMonthRule'];
  missing_day_rule: MemorialEvent['missingDayRule'];
  reminder_enabled: number;
  reminder_offsets: string | null;
  created_at: string;
  updated_at: string;
}

function toEvent(row: EventRow): MemorialEvent {
  return {
    id: row.id,
    fullName: row.full_name,
    relationship: row.relationship,
    familyId: row.family_id,
    familyName: row.family_name,
    lunarDay: row.lunar_day,
    lunarMonth: row.lunar_month,
    isLeapMonth: row.is_leap_month === 1,
    deathYear: row.death_year,
    deathSolarDate: row.death_solar_date,
    notes: row.notes,
    leapMonthRule: row.leap_month_rule,
    missingDayRule: row.missing_day_rule,
    reminderEnabled: row.reminder_enabled === 1,
    reminderOffsets: row.reminder_offsets ? (JSON.parse(row.reminder_offsets) as number[]) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function inputParams(e: MemorialEventInput) {
  return [
    e.fullName,
    e.relationship,
    e.familyId,
    e.lunarDay,
    e.lunarMonth,
    e.isLeapMonth ? 1 : 0,
    e.deathYear,
    e.deathSolarDate,
    e.notes,
    e.leapMonthRule,
    e.missingDayRule,
    e.reminderEnabled ? 1 : 0,
    e.reminderOffsets ? JSON.stringify(e.reminderOffsets) : null,
  ];
}

const SELECT_SQL = `SELECT e.*, f.name AS family_name
  FROM memorial_events e LEFT JOIN families f ON f.id = e.family_id`;

const INSERT_SQL = `INSERT INTO memorial_events
  (full_name, relationship, family_id, lunar_day, lunar_month, is_leap_month, death_year, death_solar_date,
   notes, leap_month_rule, missing_day_rule, reminder_enabled, reminder_offsets)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const UPDATE_SQL = `UPDATE memorial_events SET
  full_name = ?, relationship = ?, family_id = ?, lunar_day = ?, lunar_month = ?, is_leap_month = ?, death_year = ?,
  death_solar_date = ?, notes = ?, leap_month_rule = ?, missing_day_rule = ?, reminder_enabled = ?,
  reminder_offsets = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = ?`;

export async function listEvents(db: D1Database): Promise<MemorialEvent[]> {
  const { results } = await db
    .prepare(`${SELECT_SQL} ORDER BY e.lunar_month, e.lunar_day, e.id`)
    .all<EventRow>();
  return results.map(toEvent);
}

export async function getEvent(db: D1Database, id: number): Promise<MemorialEvent | null> {
  const row = await db.prepare(`${SELECT_SQL} WHERE e.id = ?`).bind(id).first<EventRow>();
  return row ? toEvent(row) : null;
}

export async function createEvent(db: D1Database, input: MemorialEventInput): Promise<MemorialEvent> {
  const row = await db
    .prepare(`${INSERT_SQL} RETURNING id`)
    .bind(...inputParams(input))
    .first<{ id: number }>();
  return (await getEvent(db, row!.id))!;
}

export async function updateEvent(db: D1Database, id: number, input: MemorialEventInput): Promise<MemorialEvent | null> {
  await db
    .prepare(UPDATE_SQL)
    .bind(...inputParams(input), id)
    .run();
  return getEvent(db, id);
}

export async function deleteEvent(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare('DELETE FROM memorial_events WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}

/** Ghi hàng loạt trong một giao dịch, dùng cho khôi phục dữ liệu. */
export async function importEvents(
  db: D1Database,
  inserts: MemorialEventInput[],
  updates: { id: number; input: MemorialEventInput }[],
  /** Xóa trước khi nhập: 'all' mọi ngày giỗ, số là id gia đình, null không xóa. */
  replace: 'all' | number | null,
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  if (replace === 'all') statements.push(db.prepare('DELETE FROM memorial_events'));
  else if (replace !== null) statements.push(db.prepare('DELETE FROM memorial_events WHERE family_id = ?').bind(replace));
  for (const input of inserts) statements.push(db.prepare(INSERT_SQL).bind(...inputParams(input)));
  for (const { id, input } of updates) statements.push(db.prepare(UPDATE_SQL).bind(...inputParams(input), id));
  if (statements.length > 0) await db.batch(statements);
}

import type { Channel, NotificationLog, NotificationStatus } from '../types/domain';

export const MAX_SEND_ATTEMPTS = 5;
/** Dòng kẹt ở 'sending' quá lâu (Worker bị dừng giữa chừng) được phép gửi lại. */
const STALE_SENDING_MS = 15 * 60 * 1000;

interface LogRow {
  id: number;
  kind: NotificationLog['kind'];
  channel: Channel;
  event_id: number | null;
  event_name: string;
  occurrence_date: string | null;
  days_before: number | null;
  scheduled_date: string;
  chat_id: string;
  status: NotificationStatus;
  attempts: number;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
}

function toLog(row: LogRow): NotificationLog {
  return {
    id: row.id,
    kind: row.kind,
    channel: row.channel,
    eventId: row.event_id,
    eventName: row.event_name,
    occurrenceDate: row.occurrence_date,
    daysBefore: row.days_before,
    scheduledDate: row.scheduled_date,
    chatId: row.chat_id,
    status: row.status,
    attempts: row.attempts,
    errorMessage: row.error_message,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

export interface ClaimRequest {
  dedupeKey: string;
  eventId: number;
  eventName: string;
  occurrenceDate: string;
  daysBefore: number;
  scheduledDate: string;
  channel: Channel;
  chatId: string;
  familyId: number | null;
}

/**
 * Giành quyền gửi cho từng nhắc nhở, nguyên tử theo dedupe_key.
 * Trả về các dedupe_key được phép gửi: mới, đang chờ, lỗi còn lượt thử, hoặc 'sending' đã quá hạn.
 * Dòng đã 'sent' không bao giờ được trả về, nên cron chạy lại hay chạy song song đều không gửi trùng.
 */
export async function claimReminders(
  db: D1Database,
  requests: ClaimRequest[],
  now: Date,
): Promise<Map<string, number>> {
  const claimed = new Map<string, number>();
  if (requests.length === 0) return claimed;
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - STALE_SENDING_MS).toISOString();

  const statements = requests.flatMap((r) => [
    db
      .prepare(
        `INSERT INTO notification_logs
           (dedupe_key, kind, channel, event_id, family_id, event_name, occurrence_date, days_before, scheduled_date, chat_id, status)
         VALUES (?, 'reminder', ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
         ON CONFLICT (dedupe_key) DO NOTHING`,
      )
      .bind(r.dedupeKey, r.channel, r.eventId, r.familyId, r.eventName, r.occurrenceDate, r.daysBefore, r.scheduledDate, r.chatId),
    db
      .prepare(
        `UPDATE notification_logs
         SET status = 'sending', attempts = attempts + 1, last_attempt_at = ?
         WHERE dedupe_key = ? AND (
           status = 'pending'
           OR (status = 'failed' AND retryable = 1 AND attempts < ?)
           OR (status = 'sending' AND last_attempt_at < ?)
         )
         RETURNING id, dedupe_key`,
      )
      .bind(nowIso, r.dedupeKey, MAX_SEND_ATTEMPTS, staleBefore),
  ]);

  const results = await db.batch<{ id: number; dedupe_key: string }>(statements);
  for (const result of results) {
    for (const row of result.results ?? []) {
      if (row.dedupe_key) claimed.set(row.dedupe_key, row.id);
    }
  }
  return claimed;
}

/** Tạo dòng lịch sử cho lần gửi lại thủ công. dedupe_key NULL nên không đụng tới dòng đã gửi trước đó. */
export async function insertResendLogs(db: D1Database, requests: ClaimRequest[], now: Date): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  if (requests.length === 0) return ids;
  const results = await db.batch<{ id: number }>(
    requests.map((r) =>
      db
        .prepare(
          `INSERT INTO notification_logs
             (kind, channel, event_id, family_id, event_name, occurrence_date, days_before, scheduled_date, chat_id, status, attempts, retryable, last_attempt_at)
           VALUES ('reminder', ?, ?, ?, ?, ?, ?, ?, ?, 'sending', 1, 0, ?)
           RETURNING id`,
        )
        .bind(r.channel, r.eventId, r.familyId, r.eventName, r.occurrenceDate, r.daysBefore, r.scheduledDate, r.chatId, now.toISOString()),
    ),
  );
  results.forEach((result, index) => ids.set(requests[index].dedupeKey, result.results[0].id));
  return ids;
}

export async function markLogsSent(db: D1Database, ids: number[], messageId: string | null, now: Date): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(
    ids.map((id) =>
      db
        .prepare(
          `UPDATE notification_logs SET status = 'sent', provider_message_id = ?, sent_at = ?, error_message = NULL
           WHERE id = ?`,
        )
        .bind(messageId, now.toISOString(), id),
    ),
  );
}

export async function markLogsFailed(db: D1Database, ids: number[], error: string, retryable: boolean): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(
    ids.map((id) =>
      db
        .prepare(`UPDATE notification_logs SET status = 'failed', error_message = ?, retryable = ? WHERE id = ?`)
        .bind(error.slice(0, 500), retryable ? 1 : 0, id),
    ),
  );
}

export async function insertTestLog(
  db: D1Database,
  entry: { channel: Channel; familyId: number | null; chatId: string; scheduledDate: string; status: 'sent' | 'failed'; error: string | null; messageId: string | null; now: Date },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO notification_logs
         (kind, channel, family_id, event_name, scheduled_date, chat_id, status, attempts, retryable, provider_message_id, error_message, last_attempt_at, sent_at)
       VALUES ('test', ?, ?, 'Tin nhắn thử', ?, ?, ?, 1, 0, ?, ?, ?, ?)`,
    )
    .bind(
      entry.channel,
      entry.familyId,
      entry.scheduledDate,
      entry.chatId,
      entry.status,
      entry.messageId,
      entry.error,
      entry.now.toISOString(),
      entry.status === 'sent' ? entry.now.toISOString() : null,
    )
    .run();
}

export async function listLogs(
  db: D1Database,
  opts: { page: number; pageSize: number; status?: NotificationStatus; familyId?: number | null },
): Promise<{ logs: NotificationLog[]; total: number }> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (opts.status) {
    conditions.push('status = ?');
    params.push(opts.status);
  }
  if (opts.familyId != null) {
    conditions.push('family_id = ?');
    params.push(opts.familyId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows, count] = await db.batch<LogRow | { total: number }>([
    db
      .prepare(`SELECT * FROM notification_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .bind(...params, opts.pageSize, (opts.page - 1) * opts.pageSize),
    db.prepare(`SELECT COUNT(*) AS total FROM notification_logs ${where}`).bind(...params),
  ]);
  return {
    logs: (rows.results as LogRow[]).map(toLog),
    total: (count.results[0] as { total: number }).total,
  };
}

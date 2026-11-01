export interface SessionInfo {
  /** null là phiên quản trị. */
  familyId: number | null;
  familyName: string | null;
}

export async function createSession(db: D1Database, tokenHash: string, expiresAt: Date, familyId: number | null = null): Promise<void> {
  await db
    .prepare('INSERT INTO admin_sessions (token_hash, expires_at, family_id) VALUES (?, ?, ?)')
    .bind(tokenHash, expiresAt.toISOString(), familyId)
    .run();
}

export async function getSession(db: D1Database, tokenHash: string, now: Date): Promise<SessionInfo | null> {
  const row = await db
    .prepare(
      `SELECT s.family_id, f.name AS family_name
       FROM admin_sessions s LEFT JOIN families f ON f.id = s.family_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(tokenHash, now.toISOString())
    .first<{ family_id: number | null; family_name: string | null }>();
  return row ? { familyId: row.family_id, familyName: row.family_name } : null;
}

export async function deleteSession(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(tokenHash).run();
}

/** Đổi mật khẩu hoặc xóa tài khoản thì đăng xuất mọi thiết bị, trừ phiên được chỉ định nếu có. */
export async function deleteFamilySessions(db: D1Database, familyId: number, exceptTokenHash = ''): Promise<void> {
  await db.prepare('DELETE FROM admin_sessions WHERE family_id = ? AND token_hash <> ?').bind(familyId, exceptTokenHash).run();
}

/** Dọn phiên hết hạn và bộ đếm rate limit cũ, chạy kèm cron hằng ngày. */
export async function cleanupExpired(db: D1Database, now: Date): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(now.toISOString()),
    db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(Math.floor(now.getTime() / 1000) - 86400),
  ]);
}

/** Tăng bộ đếm theo cửa sổ thời gian cố định, trả về số lần trong cửa sổ hiện tại. */
export async function hitRateLimit(db: D1Database, key: string, windowSeconds: number, now: Date): Promise<number> {
  const nowSec = Math.floor(now.getTime() / 1000);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN window_start <= ?2 - ?3 THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start <= ?2 - ?3 THEN ?2 ELSE window_start END
       RETURNING count`,
    )
    .bind(key, nowSec, windowSeconds)
    .first<{ count: number }>();
  return row!.count;
}

export async function clearRateLimit(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run();
}

/** Ảnh được giữ đủ lâu để nền tảng tải về, sau đó dọn để database không lớn dần. */
export const CARD_RETENTION_DAYS = 14;

export async function findCardToken(db: D1Database, contentHash: string): Promise<string | null> {
  const row = await db.prepare('SELECT token FROM card_images WHERE content_hash = ?').bind(contentHash).first<{ token: string }>();
  return row?.token ?? null;
}

export async function saveCard(db: D1Database, token: string, contentHash: string, data: ArrayBuffer): Promise<void> {
  await db
    .prepare('INSERT INTO card_images (token, content_hash, data) VALUES (?, ?, ?) ON CONFLICT (content_hash) DO NOTHING')
    .bind(token, contentHash, data)
    .run();
}

export async function getCardData(db: D1Database, token: string): Promise<Uint8Array | null> {
  const row = await db.prepare('SELECT data FROM card_images WHERE token = ?').bind(token).first<{ data: ArrayLike<number> }>();
  return row ? new Uint8Array(row.data) : null;
}

export async function deleteOldCards(db: D1Database, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - CARD_RETENTION_DAYS * 86400 * 1000).toISOString();
  await db.prepare('DELETE FROM card_images WHERE created_at < ?').bind(cutoff).run();
}

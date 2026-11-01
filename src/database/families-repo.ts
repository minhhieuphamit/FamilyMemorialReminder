import type { Family } from '../types/domain';
import { normalizeVietnamese } from '../utils/text';

export async function listFamilies(db: D1Database): Promise<Family[]> {
  const { results } = await db
    .prepare(
      `SELECT f.id, f.name, f.username, COUNT(e.id) AS event_count
       FROM families f LEFT JOIN memorial_events e ON e.family_id = f.id
       GROUP BY f.id ORDER BY f.name`,
    )
    .all<{ id: number; name: string; username: string | null; event_count: number }>();
  return results.map((r) => ({ id: r.id, name: r.name, username: r.username, eventCount: r.event_count }));
}

/** Tên trùng nhau khi bỏ dấu, ví dụ "Nhà Nội" và "nha noi", được coi là một gia đình. */
export function findFamilyByName(families: Family[], name: string): Family | undefined {
  const target = normalizeVietnamese(name);
  return families.find((f) => normalizeVietnamese(f.name) === target);
}

export async function createFamily(db: D1Database, name: string): Promise<Family> {
  const row = await db.prepare('INSERT INTO families (name) VALUES (?) RETURNING id, name').bind(name).first<{ id: number; name: string }>();
  return { id: row!.id, name: row!.name, username: null, eventCount: 0 };
}

export async function renameFamily(db: D1Database, id: number, name: string): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE families SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
    .bind(name, id)
    .run();
  return result.meta.changes > 0;
}

export async function deleteFamily(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare('DELETE FROM families WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}

/** Trả về id của từng tên, tạo gia đình còn thiếu. Dùng khi khôi phục từ file sao lưu. */
export async function ensureFamilies(db: D1Database, names: string[]): Promise<(name: string) => number> {
  const known = await listFamilies(db);
  for (const name of names) {
    if (!findFamilyByName(known, name)) known.push(await createFamily(db, name));
  }
  return (name) => findFamilyByName(known, name)!.id;
}

export async function findAccount(db: D1Database, username: string): Promise<{ id: number; name: string; passwordHash: string | null } | null> {
  const row = await db
    .prepare('SELECT id, name, password_hash FROM families WHERE username = ?')
    .bind(username)
    .first<{ id: number; name: string; password_hash: string | null }>();
  return row && { id: row.id, name: row.name, passwordHash: row.password_hash };
}

export async function getPasswordHash(db: D1Database, familyId: number): Promise<string | null> {
  const row = await db.prepare('SELECT password_hash FROM families WHERE id = ?').bind(familyId).first<{ password_hash: string | null }>();
  return row?.password_hash ?? null;
}

export async function setAccount(db: D1Database, familyId: number, username: string, passwordHash: string): Promise<boolean> {
  const result = await db.prepare('UPDATE families SET username = ?, password_hash = ? WHERE id = ?').bind(username, passwordHash, familyId).run();
  return result.meta.changes > 0;
}

export async function setPassword(db: D1Database, familyId: number, passwordHash: string): Promise<void> {
  await db.prepare('UPDATE families SET password_hash = ? WHERE id = ?').bind(passwordHash, familyId).run();
}

export async function removeAccount(db: D1Database, familyId: number): Promise<void> {
  await db.prepare('UPDATE families SET username = NULL, password_hash = NULL WHERE id = ?').bind(familyId).run();
}

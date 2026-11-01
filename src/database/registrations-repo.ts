import type { Channel, Registration, RegistrationAdmin } from '../types/domain';
import { randomToken } from '../utils/crypto';

export async function registrationAdmins(db: D1Database): Promise<RegistrationAdmin[]> {
  return (await db.prepare('SELECT channel, chat_id AS chatId FROM registration_admins ORDER BY channel, chat_id').all<RegistrationAdmin>()).results;
}
export async function setRegistrationAdmins(db: D1Database, admins: RegistrationAdmin[]) {
  await db.batch([db.prepare('DELETE FROM registration_admins'), ...admins.map(a => db.prepare('INSERT INTO registration_admins(channel,chat_id) VALUES (?,?)').bind(a.channel,a.chatId))]);
}
export async function getRegistration(db: D1Database, id: number) {
  return db.prepare('SELECT r.*, f.name AS family_name FROM registration_requests r JOIN families f ON f.id=r.family_id WHERE r.id=?').bind(id).first<Registration>();
}
export async function submitRegistration(db: D1Database, channel: Channel, chatId: string, name: string, familyId: number) {
  const row = await db.prepare(`INSERT INTO registration_requests(channel,chat_id,full_name,family_id) VALUES (?,?,?,?) ON CONFLICT DO NOTHING RETURNING id`).bind(channel,chatId,name,familyId).first<{id:number}>();
  return row ? getRegistration(db,row.id) : null;
}
/** Người dùng tự rút yêu cầu chưa duyệt; yêu cầu đã duyệt hoặc từ chối giữ lại làm lịch sử. */
export async function cancelPendingRegistration(db: D1Database, channel: Channel, chatId: string, familyId: number) {
  const result = await db.prepare(`DELETE FROM registration_requests WHERE channel=? AND chat_id=? AND family_id=? AND status='pending'`).bind(channel,chatId,familyId).run();
  return result.meta.changes > 0;
}
export async function listRegistrations(db: D1Database, status: string, page: number, size: number) {
  const where = status ? 'WHERE r.status=?' : '';
  const params = status ? [status] : [];
  const [rows,count] = await db.batch<Registration | {total:number}>([
    db.prepare(`SELECT r.*, f.name AS family_name FROM registration_requests r JOIN families f ON f.id=r.family_id ${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`).bind(...params,size,(page-1)*size),
    db.prepare(`SELECT COUNT(*) AS total FROM registration_requests r ${where}`).bind(...params),
  ]);
  return { requests: rows.results as Registration[], total: (count.results[0] as {total:number}).total };
}
/** Claim and grant in one transaction. A second reviewer cannot grant again or reverse the decision. */
export async function reviewRegistration(db: D1Database, id: number, decision: 'approved' | 'rejected') {
  const token = randomToken();
  const statements = [db.prepare(`UPDATE registration_requests SET status=?,review_token=?,reviewed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending'`).bind(decision,token,id)];
  if (decision === 'approved') {
    statements.push(db.prepare(`INSERT INTO chats(channel,chat_id,title,can_query,receive_notifications,all_families)
      SELECT channel,chat_id,full_name,1,1,0 FROM registration_requests WHERE id=? AND review_token=?
      ON CONFLICT(channel,chat_id) DO NOTHING`).bind(id,token));
    statements.push(db.prepare(`INSERT INTO chat_families(chat_row_id,family_id)
      SELECT c.id,r.family_id FROM registration_requests r JOIN chats c ON c.channel=r.channel AND c.chat_id=r.chat_id
      WHERE r.id=? AND r.review_token=? ON CONFLICT DO NOTHING`).bind(id,token));
  }
  const [changed] = await db.batch(statements);
  return changed.meta.changes > 0 ? getRegistration(db,id) : null;
}

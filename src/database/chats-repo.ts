import type { Channel, NotificationChat } from '../types/domain';

interface ChatRow {
  id: number;
  channel: Channel;
  chat_id: string;
  title: string;
  can_query: number;
  receive_notifications: number;
  all_families: number;
  created_at: string;
}

function toChat(row: ChatRow, familyIds: number[]): NotificationChat {
  return {
    id: row.id,
    channel: row.channel,
    chatId: row.chat_id,
    title: row.title,
    canQuery: row.can_query === 1,
    receiveNotifications: row.receive_notifications === 1,
    allFamilies: row.all_families === 1,
    familyIds,
    createdAt: row.created_at,
    editable: true,
  };
}

export async function listChats(db: D1Database): Promise<NotificationChat[]> {
  const [chats, links] = await db.batch<ChatRow | { chat_row_id: number; family_id: number }>([
    db.prepare('SELECT * FROM chats ORDER BY id'),
    db.prepare('SELECT chat_row_id, family_id FROM chat_families'),
  ]);
  const familyIds = (chatRowId: number) =>
    (links.results as { chat_row_id: number; family_id: number }[])
      .filter((l) => l.chat_row_id === chatRowId)
      .map((l) => l.family_id);
  return (chats.results as ChatRow[]).map((row) => toChat(row, familyIds(row.id)));
}

export async function listNotificationChats(db: D1Database): Promise<NotificationChat[]> {
  return (await listChats(db)).filter((chat) => chat.receiveNotifications);
}

export interface FamilyScope {
  allFamilies: boolean;
  familyIds: number[];
}

/** Phạm vi dữ liệu chat được tra cứu; null nếu chat không có quyền. */
export async function getChatAccess(db: D1Database, channel: Channel, chatId: string): Promise<FamilyScope | null> {
  const row = await db
    .prepare('SELECT id, all_families FROM chats WHERE channel = ? AND chat_id = ? AND can_query = 1')
    .bind(channel, chatId)
    .first<{ id: number; all_families: number }>();
  if (!row) return null;
  const { results } = await db
    .prepare('SELECT family_id FROM chat_families WHERE chat_row_id = ?')
    .bind(row.id)
    .all<{ family_id: number }>();
  return { allFamilies: row.all_families === 1, familyIds: results.map((r) => r.family_id) };
}

export interface ChatInput {
  channel?: Channel;
  chatId: string;
  title: string;
  canQuery: boolean;
  receiveNotifications: boolean;
  allFamilies?: boolean;
  familyIds?: number[];
}

function familyLinkStatements(db: D1Database, chatRowId: number, familyIds: number[]) {
  return familyIds.map((familyId) =>
    db.prepare('INSERT INTO chat_families (chat_row_id, family_id) VALUES (?, ?)').bind(chatRowId, familyId),
  );
}

/** Trả về null nếu Chat ID đã tồn tại trong kênh đó. */
export async function createChat(db: D1Database, input: ChatInput): Promise<NotificationChat | null> {
  const row = await db
    .prepare(
      `INSERT INTO chats (channel, chat_id, title, can_query, receive_notifications, all_families)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (channel, chat_id) DO NOTHING RETURNING *`,
    )
    .bind(
      input.channel ?? 'telegram',
      input.chatId,
      input.title,
      input.canQuery ? 1 : 0,
      input.receiveNotifications ? 1 : 0,
      input.allFamilies === false ? 0 : 1,
    )
    .first<ChatRow>();
  if (!row) return null;
  const familyIds = input.familyIds ?? [];
  if (familyIds.length > 0) await db.batch(familyLinkStatements(db, row.id, familyIds));
  return toChat(row, familyIds);
}

export async function updateChat(
  db: D1Database,
  id: number,
  input: Omit<ChatInput, 'chatId' | 'channel'> & { chatId?: string },
): Promise<NotificationChat | null> {
  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE chats SET chat_id = COALESCE(?, chat_id), title = ?, can_query = ?, receive_notifications = ?, all_families = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      )
      .bind(input.chatId ?? null, input.title, input.canQuery ? 1 : 0, input.receiveNotifications ? 1 : 0, input.allFamilies === false ? 0 : 1, id),
    db.prepare('DELETE FROM chat_families WHERE chat_row_id = ?').bind(id),
  ]);
  if (updated.meta.changes === 0) return null;
  const familyIds = input.familyIds ?? [];
  if (familyIds.length > 0) await db.batch(familyLinkStatements(db, id, familyIds));
  return (await listChats(db)).find((chat) => chat.id === id) ?? null;
}

export async function linkChatToFamily(db: D1Database, chatRowId: number, familyId: number): Promise<void> {
  await db
    .prepare('INSERT INTO chat_families (chat_row_id, family_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
    .bind(chatRowId, familyId)
    .run();
}

export async function unlinkChatFromFamily(db: D1Database, chatRowId: number, familyId: number): Promise<void> {
  await db.prepare('DELETE FROM chat_families WHERE chat_row_id = ? AND family_id = ?').bind(chatRowId, familyId).run();
}

export async function deleteChat(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare('DELETE FROM chats WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}

import type { Channel, Registration } from '../types/domain';
import { deleteChat, listChats, updateChat } from '../database/chats-repo';
import { findFamilyByName, listFamilies } from '../database/families-repo';
import { cancelPendingRegistration, listRegistrations, registrationAdmins, reviewRegistration, submitRegistration } from '../database/registrations-repo';
import { hitRateLimit } from '../database/sessions-repo';
import type { IncomingMessage } from '../bot/handler';
import type { CardProvider } from './card-image';
import type { ChannelSender, Senders } from './channel-senders';
import { escapeHtml, normalizeVietnamese, splitMessage } from '../utils/text';

export interface RegistrationContext { senders: Senders; baseUrl: string; cards?: CardProvider | null; zaloBotName?: string }
const channelLabel = (channel: Channel) => channel === 'zalo' ? 'Zalo' : 'Telegram';
/** Chat ID nhóm Zalo bắt đầu bằng "zgr-"; báo rõ để admin biết duyệt là cho cả nhóm xem dữ liệu. */
const requesterLabel = (request: Registration) => channelLabel(request.channel) + (request.channel === 'zalo' && request.chat_id.startsWith('zgr-') ? ' (nhóm)' : '');
export async function sendRegistrationFamilies(db: D1Database, sender: ChannelSender, chatId: string, channel: Channel, mentionedInGroup = false) {
  const { results } = await db.prepare(`SELECT f.name,
    EXISTS(SELECT 1 FROM chats c WHERE c.channel=?1 AND c.chat_id=?2 AND
      (c.all_families=1 OR EXISTS(SELECT 1 FROM chat_families cf WHERE cf.chat_row_id=c.id AND cf.family_id=f.id))) AS joined,
    EXISTS(SELECT 1 FROM registration_requests r WHERE r.channel=?1 AND r.chat_id=?2 AND r.family_id=f.id AND r.status='pending') AS pending
    FROM families f ORDER BY f.name`).bind(channel, chatId).all<{name:string;joined:number;pending:number}>();
  const section = (title: string, rows: string[]) => rows.length ? ['', `${title} (${rows.length})`, ...rows] : [];
  const names = (rows: typeof results) => rows.map(f => '• ' + escapeHtml(f.name) + (mentionedInGroup ? '' : '\n/huydangky ' + escapeHtml(f.name)));
  const notJoined = results.filter(f => !f.joined);
  const open = notJoined.filter(f => !f.pending);
  const lines = results.length
    ? ['🏠 <b>Gia đình và trạng thái của bạn</b>',
        ...section('✅ <b>Đã tham gia</b>', names(results.filter(f => f.joined))),
        ...section('⏳ <b>Đang chờ duyệt</b>', names(notJoined.filter(f => f.pending))),
        ...section('➕ <b>Chưa tham gia</b>', open.map(f => '• ' + escapeHtml(f.name) + '\n/dangky ' + escapeHtml(f.name) + ' | Họ tên của bạn')),
        '', 'Trạng thái theo Chat ID trên kênh bạn đang dùng.' + (!open.length ? '' : mentionedInGroup ? ' Để đăng ký cho nhóm, gõ @ chọn bot rồi gửi lệnh trên và thay “Họ tên của bạn” bằng tên nhóm.' : ' Với gia đình chưa tham gia, nhắn riêng lệnh đăng ký và thay “Họ tên của bạn” bằng tên thật.')]
    : ['Hiện chưa có gia đình nào để đăng ký. Vui lòng liên hệ quản trị viên để tạo gia đình trước.'];
  for (const part of splitMessage(lines.join('\n'), sender.messageLimit)) await sender.send(chatId, part);
}
export const REGISTRATION_HELP = 'Đăng ký nhận tin theo gia đình:\n/dangky Tên gia đình | Họ tên của bạn\nVí dụ: /dangky Nhà ngoại | Tên của bạn\nGửi /giadinh để xem các gia đình hiện có.\nQuản trị viên sẽ kiểm tra và duyệt trước khi bạn được xem dữ liệu.';

export const GROUP_REGISTRATION_HELP = 'Đăng ký nhận tin cho cả nhóm:\n@Tên bot /dangky Tên gia đình | Tên nhóm\nPhải gõ @ và chọn bot, Zalo không chuyển tin không nhắc tên bot.\nSau khi quản trị viên duyệt, mọi thành viên nhóm đều xem được dữ liệu của gia đình đó.';
export const UNREGISTRATION_HELP = 'Hủy đăng ký một gia đình:\n/huydangky Tên gia đình\nVí dụ: /huydangky Nhà ngoại';

export async function notifyRegistrationAdmins(db: D1Database, request: Registration, context: RegistrationContext) {
  const admins = await registrationAdmins(db);
  const failures: string[] = [];
  if (!admins.length) failures.push('Chưa chọn người nhận thông báo duyệt');
  for (const admin of admins) {
    try {
      const sender = context.senders[admin.channel];
      if (!sender) throw new Error('missing sender');
      await sender.send(admin.chatId, `📥 <b>Đăng ký chờ duyệt #${request.id}</b>\nHọ tên: ${escapeHtml(request.full_name)}\nGia đình: ${escapeHtml(request.family_name)}\nKênh: ${requesterLabel(request)}\nChat ID: <code>${escapeHtml(request.chat_id)}</code>\n\nDuyệt: /duyet ${request.id}\nTừ chối: /tuchoi ${request.id}\n\nHoặc xử lý trên website:\n${escapeHtml(context.baseUrl)}/kenh-gui#dang-ky`);
    } catch { failures.push(`Không gửi được qua ${admin.channel} tới ${admin.chatId}`); }
  }
  await db.prepare('UPDATE registration_requests SET admin_notice_error=? WHERE id=?').bind(failures.join('; ') || null, request.id).run();
}

/**
 * Lưu quyết định rồi báo cho người đăng ký và mọi admin, dùng chung cho website và bot.
 * Trả về null nếu yêu cầu không còn chờ duyệt. Lỗi gửi tin không làm mất quyết định đã lưu.
 */
export async function reviewAndNotify(db: D1Database, id: number, decision: 'approved' | 'rejected', senders: Senders, reviewer: string) {
  const request = await reviewRegistration(db, id, decision);
  if (!request) return null;
  const family = escapeHtml(request.family_name);
  const warnings: string[] = [];
  try {
    const sender = senders[request.channel];
    if (!sender) throw new Error('missing sender');
    await sender.send(request.chat_id, decision === 'approved'
      ? `✅ Đăng ký #${request.id} đã được duyệt cho gia đình ${family}. Gửi /help để xem hướng dẫn. Các cài đặt nhận tin trước đó của bạn được giữ nguyên.`
      : `Đăng ký #${request.id} vào gia đình ${family} chưa được chấp thuận. Vui lòng liên hệ quản trị viên.`);
  } catch { warnings.push('Đã lưu quyết định nhưng chưa gửi được thông báo cho người đăng ký.'); }
  const notice = `${decision === 'approved' ? '✅ <b>Đăng ký #' + request.id + ' đã được duyệt</b>' : '❌ <b>Đăng ký #' + request.id + ' đã bị từ chối</b>'}\nHọ tên: ${escapeHtml(request.full_name)}\nGia đình: ${family}\nKênh: ${requesterLabel(request)}\nChat ID: <code>${escapeHtml(request.chat_id)}</code>\nNgười xử lý: ${escapeHtml(reviewer)}`;
  for (const admin of await registrationAdmins(db)) {
    try {
      const sender = senders[admin.channel];
      if (!sender) throw new Error('missing sender');
      await sender.send(admin.chatId, notice);
    } catch { warnings.push(`Chưa báo được cho admin qua ${channelLabel(admin.channel)} (${admin.chatId}).`); }
  }
  const warning = warnings.join(' ') || null;
  await db.prepare('UPDATE registration_requests SET result_notice_error=? WHERE id=?').bind(warning, request.id).run();
  return { request, warning };
}

/** Lệnh duyệt chỉ dành cho Chat ID trong danh sách admin; với người khác coi như lệnh không tồn tại. */
export async function handleReviewCommand(message: IncomingMessage, db: D1Database, sender: ChannelSender, context?: RegistrationContext): Promise<boolean> {
  const text = message.text.trim();
  const command = text.match(/^\/(duyet|tuchoi|choduyet)(?:@\S+)?(?:\s+([\s\S]*))?$/i);
  const natural = normalizeVietnamese(text).match(/^(duyet|tu choi) (\d+)$|^((?:danh sach |yeu cau )?cho duyet)$/);
  if (!command && !natural) return false;
  const admins = await registrationAdmins(db);
  if (!admins.some(a => a.channel === message.channel && a.chatId === message.chatId)) return false;
  if (message.isGroup) { await sender.send(message.chatId, 'Vui lòng nhắn riêng cho bot để duyệt đăng ký.'); return true; }

  const action = command ? command[1].toLowerCase() : natural![1] ? (natural![1] === 'duyet' ? 'duyet' : 'tuchoi') : 'choduyet';
  const id = command ? command[2]?.trim().match(/^#?(\d{1,9})$/)?.[1] : natural![2];
  if (action === 'choduyet' || !id) {
    const { requests, total } = await listRegistrations(db, 'pending', 1, 20);
    const lines = total
      ? [`📋 <b>Yêu cầu chờ duyệt (${total})</b>`, ...requests.flatMap(r => ['', `#${r.id} · ${escapeHtml(r.full_name)} · ${escapeHtml(r.family_name)} · ${requesterLabel(r)}`, `/duyet ${r.id}`, `/tuchoi ${r.id}`])]
      : ['Không có yêu cầu nào đang chờ duyệt.'];
    if (total > requests.length) lines.push('', `Còn ${total - requests.length} yêu cầu khác, xử lý bớt rồi gửi /choduyet để xem tiếp.`);
    for (const part of splitMessage(lines.join('\n'), sender.messageLimit)) await sender.send(message.chatId, part);
    return true;
  }

  const title = (await listChats(db)).find(c => c.channel === message.channel && c.chatId === message.chatId)?.title;
  const result = await reviewAndNotify(db, Number(id), action === 'duyet' ? 'approved' : 'rejected', { ...context?.senders, [message.channel]: sender }, `${channelLabel(message.channel)} · ${title || message.chatId}`);
  if (!result) await sender.send(message.chatId, `Yêu cầu #${id} không tồn tại hoặc đã được xử lý. Gửi /choduyet để xem các yêu cầu còn lại.`);
  else if (result.warning) await sender.send(message.chatId, `⚠️ ${escapeHtml(result.warning)}`);
  return true;
}

/** Rời một gia đình hoặc rút yêu cầu chờ duyệt, chỉ tác động lên chính Chat ID đang nhắn nên không cần admin duyệt. */
export async function handleUnregistration(message: IncomingMessage, db: D1Database, sender: ChannelSender): Promise<boolean> {
  const text = message.text.trim();
  const command = text.match(/^\/huydangky(?:@\S+)?(?:\s+([\s\S]*))?$/i);
  const natural = normalizeVietnamese(text).match(/^(huy dang ky|huy dang ki|huy dk|roi gia dinh)(\s|$)/);
  if (!command && !natural) return false;
  // Thành viên nhóm không được tự gỡ nhóm, vì việc này dừng nhắc của cả nhóm mà không qua ai duyệt.
  if (message.isGroup) { await sender.send(message.chatId, message.mentioned ? 'Để gỡ nhóm khỏi gia đình, vui lòng nhờ quản trị viên sửa trên website.' : 'Vui lòng nhắn riêng cho bot để hủy đăng ký bằng Chat ID cá nhân.'); return true; }
  const args = (command ? command[1] ?? '' : text.split(/\s+/).slice(natural![1].split(' ').length).join(' ')).split('|')[0].trim();
  if (!args) {
    await sender.send(message.chatId, UNREGISTRATION_HELP);
    await sendRegistrationFamilies(db, sender, message.chatId, message.channel); return true;
  }
  const families = await listFamilies(db);
  // Tên gia đình có thể bắt đầu bằng "Gia đình", nên thử nguyên văn trước rồi mới bỏ từ này.
  const family = findFamilyByName(families, args) ?? findFamilyByName(families, args.split(/\s+/).slice(2).join(' '));
  if (!family) {
    await sender.send(message.chatId, 'Không tìm thấy gia đình này. Chọn đúng tên trong danh sách bên dưới.');
    await sendRegistrationFamilies(db, sender, message.chatId, message.channel); return true;
  }
  const name = escapeHtml(family.name);
  const cancelled = await cancelPendingRegistration(db, message.channel, message.chatId, family.id);
  const chat = (await listChats(db)).find(c => c.channel === message.channel && c.chatId === message.chatId);
  if (!chat || (!chat.allFamilies && !chat.familyIds.includes(family.id))) {
    await sender.send(message.chatId, cancelled ? `Đã hủy yêu cầu đăng ký đang chờ duyệt cho gia đình ${name}.` : `Chat của bạn chưa tham gia gia đình ${name}.`);
    return true;
  }
  const remaining = (chat.allFamilies ? families.map(f => f.id) : chat.familyIds).filter(id => id !== family.id);
  if (remaining.length) await updateChat(db, chat.id, { ...chat, allFamilies: false, familyIds: remaining });
  else await deleteChat(db, chat.id);
  await sender.send(message.chatId, `Đã hủy đăng ký gia đình ${name}. Bạn sẽ không còn nhận nhắc và tra cứu ngày giỗ của gia đình này.\nMuốn tham gia lại: /dangky ${name} | Họ tên của bạn`);
  return true;
}

/** Registration commands are available before access is granted, in private chats or a group that mentions the bot. Admins still approve every request. */
export async function handleRegistration(message: IncomingMessage, db: D1Database, sender: ChannelSender, now: Date, context?: RegistrationContext): Promise<boolean> {
  const text = message.text.trim();
  const normalized = normalizeVietnamese(text);
  const command = text.match(/^\/dangky(?:@\S+)?(?:\s+([\s\S]*))?$/i);
  const natural = /^(dang ky|dang ki|dk)(\s|$)/.test(normalized);
  if (!command && !natural) return false;
  if (message.isGroup && !message.mentioned) { await sender.send(message.chatId, 'Vui lòng nhắn riêng cho bot để đăng ký bằng Chat ID cá nhân.'); return true; }
  const args = command ? command[1] ?? '' : text.replace(/^(?:đăng|dang)\s+(?:ký|kí|ky|ki)\s*|^dk\s*/i, '');
  const parts = args.split('|').map(p => p.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1] || parts[0].length > 100 || parts[1].length > 100) {
    await sender.send(message.chatId, message.mentioned ? GROUP_REGISTRATION_HELP : REGISTRATION_HELP);
    await sendRegistrationFamilies(db, sender, message.chatId, message.channel, message.mentioned); return true;
  }
  if (await hitRateLimit(db, `registration:${message.channel}:${message.chatId}`, 3600, now) > 5) {
    await sender.send(message.chatId, 'Bạn đã gửi nhiều yêu cầu. Vui lòng thử lại sau 1 giờ.'); return true;
  }
  const family = findFamilyByName(await listFamilies(db), parts[0]);
  if (!family) { await sender.send(message.chatId, 'Không xác định được gia đình. Vui lòng hỏi quản trị viên tên gia đình chính xác rồi gửi lại.'); return true; }
  const existing = (await listChats(db)).find(c => c.channel === message.channel && c.chatId === message.chatId);
  if (existing && (existing.allFamilies || existing.familyIds.includes(family.id))) {
    await sender.send(message.chatId, 'Chat của bạn đã được đăng ký cho gia đình này. Nếu chưa nhận được tin, vui lòng liên hệ quản trị viên.'); return true;
  }
  const request = await submitRegistration(db, message.channel, message.chatId, parts[1], family.id);
  if (!request) { await sender.send(message.chatId, 'Yêu cầu của bạn đang chờ duyệt, không cần đăng ký lại.'); return true; }
  if (context) await notifyRegistrationAdmins(db, request, context);
  await sender.send(message.chatId, `Đã lưu đăng ký #${request.id} cho gia đình ${escapeHtml(family.name)}. Vui lòng chờ quản trị viên duyệt.`);
  return true;
}

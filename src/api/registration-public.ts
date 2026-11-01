import { Hono } from 'hono';
import { hitRateLimit } from '../database/sessions-repo';
import { findFamilyByName, listFamilies } from '../database/families-repo';
import { createSenders } from '../services/channel-senders';
import { handleRegistration } from '../services/registration-service';
import type { AppEnv } from '../types/env';
import type { Channel } from '../types/domain';
import { constantTimeEqual, randomToken, sha256Hex } from '../utils/crypto';
import { isValidChatId } from '../utils/validation';

export const publicRegistrationRoutes = new Hono<AppEnv>();
publicRegistrationRoutes.post('/start', async c => {
  const body = await c.req.json().catch(() => null);
  const channel = body?.channel as Channel;
  const chatId = typeof body?.chatId === 'string' ? body.chatId.trim() : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const family = typeof body?.family === 'string' ? body.family.trim() : '';
  if (!['telegram','zalo'].includes(channel) || !isValidChatId(channel,chatId) || !name || name.length>100 || !family || family.length>100 || /[|\r\n]/.test(name+family)) return c.json({error:'Vui lòng nhập đúng kênh, Chat ID, tên gia đình và họ tên (tối đa 100 ký tự).'},400);
  const now = new Date();
  if (await hitRateLimit(c.env.DB,`register-ip:${c.req.header('cf-connecting-ip') ?? 'unknown'}`,3600,now)>15 || await hitRateLimit(c.env.DB,`register-otp:${channel}:${chatId}`,3600,now)>3) return c.json({error:'Bạn đã yêu cầu nhiều mã. Vui lòng thử lại sau 1 giờ.'},429);
  if (!findFamilyByName(await listFamilies(c.env.DB),family)) return c.json({error:'Không xác định được gia đình. Hãy hỏi admin tên gia đình chính xác.'},400);
  const sender = createSenders(c.env)[channel];
  if (!sender) return c.json({error:'Kênh đăng ký này chưa sẵn sàng.'},503);
  const token = randomToken();
  const bytes = new Uint32Array(1); crypto.getRandomValues(bytes);
  const code = String(bytes[0] % 1_000_000).padStart(6,'0');
  await c.env.DB.prepare('DELETE FROM registration_challenges WHERE expires_at < ?').bind(now.toISOString()).run();
  await c.env.DB.prepare('INSERT INTO registration_challenges(token,code_hash,channel,chat_id,family_name,full_name,expires_at) VALUES (?,?,?,?,?,?,?)').bind(token,await sha256Hex(token+code),channel,chatId,family,name,new Date(now.getTime()+10*60_000).toISOString()).run();
  try { await sender.send(chatId,`Mã xác nhận đăng ký trên website: <code>${code}</code>\nCó hiệu lực 10 phút. Không chia sẻ mã này. Nếu bạn không yêu cầu đăng ký, hãy bỏ qua tin nhắn.`); }
  catch { await c.env.DB.prepare('DELETE FROM registration_challenges WHERE token=?').bind(token).run(); return c.json({error:'Không gửi được mã. Hãy nhắn /start cho bot trước, kiểm tra Chat ID và thử lại.'},502); }
  return c.json({token});
});
publicRegistrationRoutes.post('/verify', async c => {
  const body = await c.req.json().catch(()=>null);
  if (typeof body?.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token) || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) return c.json({error:'Mã xác nhận không hợp lệ'},400);
  const now = new Date();
  const row = await c.env.DB.prepare('UPDATE registration_challenges SET attempts=attempts+1 WHERE token=? AND consumed=0 AND attempts<5 AND expires_at>? RETURNING *').bind(body.token,now.toISOString()).first<{token:string;code_hash:string;channel:Channel;chat_id:string;family_name:string;full_name:string}>();
  if (!row || !await constantTimeEqual(await sha256Hex(row.token+body.code),row.code_hash)) return c.json({error:'Mã sai, hết hạn hoặc đã thử quá 5 lần.'},400);
  const used = await c.env.DB.prepare('UPDATE registration_challenges SET consumed=1 WHERE token=? AND consumed=0').bind(row.token).run();
  if (!used.meta.changes) return c.json({error:'Mã đã được sử dụng'},409);
  let message = '';
  await handleRegistration({channel:row.channel,chatId:row.chat_id,isGroup:false,text:`/dangky ${row.family_name} | ${row.full_name}`},c.env.DB,{messageLimit:1900,send:async (_id,text)=>{message=text;return 'web';}},now,{senders:createSenders(c.env),baseUrl:new URL(c.req.url).origin});
  return c.json({ok:true,message});
});

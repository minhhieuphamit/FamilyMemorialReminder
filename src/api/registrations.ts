import { Hono } from 'hono';
import { getRegistration, listRegistrations, registrationAdmins, setRegistrationAdmins } from '../database/registrations-repo';
import { requireAdmin } from '../middleware/auth';
import { createSenders } from '../services/channel-senders';
import { notifyRegistrationAdmins, reviewAndNotify } from '../services/registration-service';
import type { AppEnv } from '../types/env';
import { isValidChatId } from '../utils/validation';

export const registrationRoutes = new Hono<AppEnv>();
registrationRoutes.use('*', requireAdmin);
registrationRoutes.get('/admins', async c => c.json({ admins: await registrationAdmins(c.env.DB) }));
registrationRoutes.put('/admins', async c => {
  const body = await c.req.json().catch(() => null);
  if (!Array.isArray(body?.admins) || body.admins.length > 10 || !body.admins.every((a: {channel?: string; chatId?: string}) => a && (a.channel === 'telegram' || a.channel === 'zalo') && typeof a.chatId === 'string' && isValidChatId(a.channel, a.chatId))) return c.json({error:'Danh sách admin không hợp lệ'},400);
  const unique = new Set(body.admins.map((a: {channel:string;chatId:string}) => `${a.channel}:${a.chatId}`));
  if (unique.size !== body.admins.length) return c.json({error:'Chat ID bị trùng'},400);
  await setRegistrationAdmins(c.env.DB, body.admins);
  return c.json({ok:true});
});
registrationRoutes.get('/', async c => {
  const rawPage = Number(c.req.query('page'));
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const size = Number(c.req.query('pageSize'));
  const pageSize = [10,20,50].includes(size) ? size : 10;
  const status = c.req.query('status') ?? 'pending';
  if (!['','pending','approved','rejected'].includes(status)) return c.json({error:'Trạng thái không hợp lệ'},400);
  return c.json({...await listRegistrations(c.env.DB,status,page,pageSize),page,pageSize});
});
registrationRoutes.post('/:id/notify', async c => {
  const request = await getRegistration(c.env.DB, Number(c.req.param('id')));
  if (!request || request.status !== 'pending') return c.json({error:'Không tìm thấy yêu cầu đang chờ'},404);
  await notifyRegistrationAdmins(c.env.DB,request,{senders:createSenders(c.env),baseUrl:new URL(c.req.url).origin});
  const updated = await getRegistration(c.env.DB,request.id);
  return c.json({ok:!updated?.admin_notice_error,error:updated?.admin_notice_error});
});
registrationRoutes.post('/:id/review', async c => {
  const body = await c.req.json().catch(() => null);
  if (!['approved','rejected'].includes(body?.decision)) return c.json({error:'Quyết định không hợp lệ'},400);
  const result = await reviewAndNotify(c.env.DB,Number(c.req.param('id')),body.decision,createSenders(c.env),'Website (tài khoản admin)');
  if (!result) return c.json({error:'Yêu cầu không tồn tại hoặc đã được xử lý. Hãy tải lại danh sách.'},409);
  return c.json({ok:true,warning:result.warning});
});

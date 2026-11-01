import { Hono } from 'hono';
import {
  createFamily,
  deleteFamily,
  findAccount,
  findFamilyByName,
  listFamilies,
  removeAccount,
  renameFamily,
  setAccount,
} from '../database/families-repo';
import { deleteFamilySessions } from '../database/sessions-repo';
import { familyScope, requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types/env';
import { hashPassword } from '../utils/crypto';
import { isValidPassword, parseFamilyName, parseUsername, PASSWORD_ERROR } from '../utils/validation';
import { ADMIN_USERNAME } from './auth';

export const familyRoutes = new Hono<AppEnv>();

familyRoutes.get('/', async (c) => {
  const scope = familyScope(c);
  const families = await listFamilies(c.env.DB);
  return c.json({ families: scope === null ? families : families.filter((f) => f.id === scope) });
});

// Tạo, sửa, xóa gia đình và cấp tài khoản chỉ dành cho quản trị viên.
familyRoutes.use('*', async (c, next) => (c.req.method === 'GET' ? next() : requireAdmin(c, next)));

familyRoutes.post('/', async (c) => {
  const body = await c.req.json<{ name?: unknown }>().catch(() => null);
  const name = parseFamilyName(body?.name);
  if (!name) return c.json({ error: 'Tên gia đình bắt buộc, tối đa 60 ký tự' }, 400);
  if (findFamilyByName(await listFamilies(c.env.DB), name)) return c.json({ error: 'Tên gia đình này đã có' }, 409);
  return c.json({ family: await createFamily(c.env.DB, name) }, 201);
});

familyRoutes.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ name?: unknown }>().catch(() => null);
  const name = parseFamilyName(body?.name);
  if (!name) return c.json({ error: 'Tên gia đình bắt buộc, tối đa 60 ký tự' }, 400);
  const existing = findFamilyByName(await listFamilies(c.env.DB), name);
  if (existing && existing.id !== id) return c.json({ error: 'Tên gia đình này đã có' }, 409);
  if (!Number.isInteger(id) || !(await renameFamily(c.env.DB, id, name))) {
    return c.json({ error: 'Không tìm thấy gia đình' }, 404);
  }
  return c.json({ ok: true });
});

familyRoutes.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || !(await deleteFamily(c.env.DB, id))) {
    return c.json({ error: 'Không tìm thấy gia đình' }, 404);
  }
  return c.json({ ok: true });
});

// Cấp tài khoản hoặc đặt lại mật khẩu. Mọi thiết bị của gia đình sẽ phải đăng nhập lại.
familyRoutes.put('/:id/account', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ username?: unknown; password?: unknown }>().catch(() => null);
  const username = parseUsername(body?.username);
  if (!username || username === ADMIN_USERNAME) {
    return c.json({ error: 'Tên đăng nhập gồm 3 đến 32 ký tự: chữ không dấu, số, dấu chấm hoặc gạch, và không được là "admin"' }, 400);
  }
  if (!isValidPassword(body?.password)) return c.json({ error: PASSWORD_ERROR }, 400);
  const taken = await findAccount(c.env.DB, username);
  if (taken && taken.id !== id) return c.json({ error: 'Tên đăng nhập này đã có người dùng' }, 409);
  if (!Number.isInteger(id) || !(await setAccount(c.env.DB, id, username, await hashPassword(body.password)))) {
    return c.json({ error: 'Không tìm thấy gia đình' }, 404);
  }
  await deleteFamilySessions(c.env.DB, id);
  return c.json({ ok: true, username });
});

familyRoutes.delete('/:id/account', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Không tìm thấy gia đình' }, 404);
  await removeAccount(c.env.DB, id);
  await deleteFamilySessions(c.env.DB, id);
  return c.json({ ok: true });
});

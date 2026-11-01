import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { findAccount, getPasswordHash, setPassword } from '../database/families-repo';
import {
  clearRateLimit,
  createSession,
  deleteFamilySessions,
  deleteSession,
  hitRateLimit,
} from '../database/sessions-repo';
import { familyScope, readAuth, requireAuth, SESSION_COOKIE, SESSION_TTL_SECONDS } from '../middleware/auth';
import type { AppEnv } from '../types/env';
import { constantTimeEqual, hashPassword, randomToken, sha256Hex, verifyPassword } from '../utils/crypto';
import { isValidPassword, PASSWORD_ERROR } from '../utils/validation';

const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60;
export const ADMIN_USERNAME = 'admin';

export const authRoutes = new Hono<AppEnv>();

authRoutes.post('/login', async (c) => {
  const now = new Date();
  const limitKey = `login:${c.req.header('cf-connecting-ip') ?? 'local'}`;
  const attempts = await hitRateLimit(c.env.DB, limitKey, LOGIN_WINDOW_SECONDS, now);
  if (attempts > LOGIN_LIMIT) {
    return c.json({ error: 'Đăng nhập sai quá nhiều lần, vui lòng thử lại sau 15 phút' }, 429);
  }

  const body = await c.req.json<{ username?: unknown; password?: unknown }>().catch(() => null);
  const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : ADMIN_USERNAME;
  const password = typeof body?.password === 'string' ? body.password : '';

  let familyId: number | null = null;
  if (username === ADMIN_USERNAME) {
    if (!c.env.ADMIN_PASSWORD) return c.json({ error: 'Máy chủ chưa cấu hình ADMIN_PASSWORD' }, 503);
    if (!(await constantTimeEqual(password, c.env.ADMIN_PASSWORD))) {
      return c.json({ error: 'Sai tài khoản hoặc mật khẩu' }, 401);
    }
  } else {
    const account = await findAccount(c.env.DB, username);
    if (!(await verifyPassword(password, account?.passwordHash ?? null)) || !account) {
      return c.json({ error: 'Sai tài khoản hoặc mật khẩu' }, 401);
    }
    familyId = account.id;
  }

  await clearRateLimit(c.env.DB, limitKey);
  const token = randomToken();
  await createSession(c.env.DB, await sha256Hex(token), new Date(now.getTime() + SESSION_TTL_SECONDS * 1000), familyId);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return c.json({ ok: true });
});

authRoutes.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await deleteSession(c.env.DB, await sha256Hex(token));
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

authRoutes.get('/me', async (c) => {
  const auth = await readAuth(c);
  return c.json(auth ? { authenticated: true, ...auth } : { authenticated: false });
});

// Gia đình tự đổi mật khẩu. Mật khẩu quản trị là secret, đổi bằng wrangler.
authRoutes.post('/password', requireAuth, async (c) => {
  const familyId = familyScope(c);
  if (familyId === null) return c.json({ error: 'Mật khẩu quản trị được đổi bằng lệnh wrangler secret put ADMIN_PASSWORD' }, 400);

  const limitKey = `password:${familyId}`;
  if ((await hitRateLimit(c.env.DB, limitKey, LOGIN_WINDOW_SECONDS, new Date())) > LOGIN_LIMIT) {
    return c.json({ error: 'Thử sai quá nhiều lần, vui lòng thử lại sau 15 phút' }, 429);
  }
  const body = await c.req.json<{ currentPassword?: unknown; newPassword?: unknown }>().catch(() => null);
  const current = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
  if (!isValidPassword(body?.newPassword)) return c.json({ error: PASSWORD_ERROR }, 400);
  if (!(await verifyPassword(current, await getPasswordHash(c.env.DB, familyId)))) {
    return c.json({ error: 'Mật khẩu hiện tại không đúng' }, 401);
  }

  await setPassword(c.env.DB, familyId, await hashPassword(body.newPassword));
  await clearRateLimit(c.env.DB, limitKey);
  // Đăng xuất các thiết bị khác, giữ phiên đang dùng.
  await deleteFamilySessions(c.env.DB, familyId, await sha256Hex(getCookie(c, SESSION_COOKIE) ?? ''));
  return c.json({ ok: true });
});

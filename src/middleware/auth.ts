import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { listEvents } from '../database/events-repo';
import { getSession } from '../database/sessions-repo';
import type { AuthInfo, MemorialEvent } from '../types/domain';
import type { AppEnv } from '../types/env';
import { sha256Hex } from '../utils/crypto';

export const SESSION_COOKIE = 'fmr_session';
export const SESSION_TTL_SECONDS = 30 * 86400;

export async function readAuth(c: Context<AppEnv>): Promise<AuthInfo | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const session = await getSession(c.env.DB, await sha256Hex(token), new Date());
  if (!session) return null;
  return session.familyId === null
    ? { role: 'admin' }
    : { role: 'family', familyId: session.familyId, familyName: session.familyName ?? '' };
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = await readAuth(c);
  if (!auth) return c.json({ error: 'Chưa đăng nhập' }, 401);
  c.set('auth', auth);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('auth').role !== 'admin') return c.json({ error: 'Chỉ quản trị viên mới dùng được chức năng này' }, 403);
  await next();
};

/** id gia đình đang đăng nhập; null là quản trị viên, được thấy tất cả. */
export function familyScope(c: Context<AppEnv>): number | null {
  const auth = c.get('auth');
  return auth.role === 'family' ? auth.familyId : null;
}

/** Điểm duy nhất route lấy ngày giỗ, để tài khoản gia đình không bao giờ nhận được dữ liệu của nhà khác. */
export async function visibleEvents(c: Context<AppEnv>): Promise<MemorialEvent[]> {
  const scope = familyScope(c);
  const events = await listEvents(c.env.DB);
  return scope === null ? events : events.filter((e) => e.familyId === scope);
}

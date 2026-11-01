import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/env';

/** Chặn request ghi dữ liệu từ trang web khác, bổ sung cho cookie SameSite=Strict. */
export const sameOriginOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    if (origin && new URL(origin).host !== new URL(c.req.url).host) {
      return c.json({ error: 'Nguồn gửi không hợp lệ' }, 403);
    }
  }
  await next();
};

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Rate limit trong bộ nhớ của isolate: không tốn lượt ghi D1, đủ chặn gọi dồn dập ở mức cơ bản.
 * Riêng đăng nhập dùng bộ đếm D1 bền vững hơn (xem api/auth.ts).
 */
export function rateLimit(options: {
  limit: number;
  windowMs: number;
  prefix: string;
}): MiddlewareHandler<AppEnv> {
  const buckets = new Map<string, Bucket>();
  return async (c, next) => {
    const now = Date.now();
    if (buckets.size > 5000) buckets.clear();
    const key = `${options.prefix}:${c.req.header('cf-connecting-ip') ?? 'local'}`;
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    } else if (++bucket.count > options.limit) {
      c.header('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return c.json({ error: 'Quá nhiều yêu cầu, vui lòng thử lại sau' }, 429);
    }
    await next();
  };
}

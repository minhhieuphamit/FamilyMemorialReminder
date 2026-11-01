import { Hono } from 'hono';
import { getCardData } from '../database/cards-repo';
import { rateLimit } from '../middleware/security';
import type { AppEnv } from '../types/env';

export const cardRoutes = new Hono<AppEnv>();

// Không cần đăng nhập vì máy chủ Telegram và Zalo phải tải được ảnh. Token 256 bit ngẫu nhiên nên không đoán được.
cardRoutes.get('/:file', rateLimit({ prefix: 'cards', limit: 120, windowMs: 60_000 }), async (c) => {
  const match = c.req.param('file').match(/^([0-9a-f]{64})\.jpg$/);
  const data = match && (await getCardData(c.env.DB, match[1]));
  if (!data) return c.json({ error: 'Không tìm thấy' }, 404);
  return c.body(data as Uint8Array<ArrayBuffer>, 200, {
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'private, max-age=86400',
    'X-Robots-Tag': 'noindex',
  });
});

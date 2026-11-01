import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { requireAuth } from '../middleware/auth';
import { rateLimit, sameOriginOnly } from '../middleware/security';
import type { AppEnv } from '../types/env';
import { registrationRoutes } from './registrations';
import { publicRegistrationRoutes } from './registration-public';
import { authRoutes } from './auth';
import { backupRoutes } from './backup';
import { cardRoutes } from './cards';
import { channelRoutes } from './channels';
import { eventRoutes } from './events';
import { familyRoutes } from './families';
import { overviewRoutes } from './overview';
import { settingsRoutes } from './settings';
import { telegramWebhookRoutes, zaloWebhookRoutes } from './webhook';

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use('*', secureHeaders());
  app.use('*', async (c, next) => {
    await next();
    if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
  });
  app.use('*', bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => c.json({ error: 'Dữ liệu gửi lên quá lớn' }, 413) }));

  app.onError((err, c) => {
    // Chỉ ghi thông điệp lỗi, không ghi request hay biến môi trường.
    console.error(`Lỗi API ${c.req.method} ${new URL(c.req.url).pathname}: ${err.message}`);
    return c.json({ error: 'Lỗi máy chủ' }, 500);
  });

  app.route('/telegram', telegramWebhookRoutes);
  app.route('/zalo', zaloWebhookRoutes);
  app.route('/cards', cardRoutes);

  const api = new Hono<AppEnv>();
  api.use('*', sameOriginOnly);
  api.use('*', rateLimit({ prefix: 'api', limit: 300, windowMs: 60_000 }));

  api.get('/health', (c) => c.json({ ok: true }));
  api.route('/auth', authRoutes);
  api.route('/registration-public', publicRegistrationRoutes);

  // Từ đây trở xuống mọi route đều cần đăng nhập.
  api.use('*', requireAuth);
  api.route('/registrations', registrationRoutes);
  api.route('/events', eventRoutes);
  api.route('/families', familyRoutes);
  api.route('/', overviewRoutes);
  api.route('/settings', settingsRoutes);
  api.route('/', channelRoutes);
  api.route('/backup', backupRoutes);

  app.route('/api', api);
  app.notFound((c) => c.json({ error: 'Không tìm thấy' }, 404));
  return app;
}

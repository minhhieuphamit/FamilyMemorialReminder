import { createApp } from './api';
import { runScheduledJob } from './scheduler/cron';
import type { Env } from './types/env';

const app = createApp();

export default {
  fetch: app.fetch,
  // Chờ trực tiếp thay vì ctx.waitUntil: waitUntil chỉ được thêm khoảng 30 giây, không đủ để tạo nhiều ảnh thiệp
  // (mỗi ảnh cách nhau hơn 20 giây). Cron chờ trực tiếp được chạy tới 15 phút.
  async scheduled(controller: ScheduledController, env: Env) {
    await runScheduledJob(env, controller.cron, new Date(controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;

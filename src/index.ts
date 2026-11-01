import { createApp } from './api';
import { runScheduledJob } from './scheduler/cron';
import type { Env } from './types/env';

const app = createApp();

export default {
  fetch: app.fetch,
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledJob(env, controller.cron, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;

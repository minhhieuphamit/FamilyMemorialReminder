import { deleteOldCards } from '../database/cards-repo';
import { cleanupExpired } from '../database/sessions-repo';
import { setAppSetting } from '../database/settings-repo';
import { createCardProvider } from '../services/card-image';
import { createSenders, type Senders } from '../services/channel-senders';
import { prerenderTomorrowCards, runReminders } from '../services/notification-service';
import type { CronRunResult } from '../types/domain';
import type { Env } from '../types/env';

/** 07:00 giờ Việt Nam. Các lịch khác trong wrangler.jsonc là lượt gửi lại tin lỗi. */
export const DAILY_CRON = '0 0 * * *';

export async function runScheduledJob(
  env: Env,
  cron: string,
  now: Date,
  senders: Senders = createSenders(env),
): Promise<CronRunResult> {
  // Một provider cho cả lượt để mọi lần tạo ảnh đều giữ đúng khoảng cách Cloudflare yêu cầu.
  const cards = createCardProvider(env);
  const result = await runReminders(env.DB, senders, now, { cards });
  await setAppSetting(env.DB, 'last_cron_result', JSON.stringify(result));
  if (cron === DAILY_CRON) await Promise.all([cleanupExpired(env.DB, now), deleteOldCards(env.DB, now)]);
  // Các lượt gửi lại thường rảnh: tranh thủ tạo sẵn ảnh cho ngày mai.
  const prerendered = cron === DAILY_CRON ? 0 : await prerenderTomorrowCards(env.DB, senders, cards, now).catch((err) => {
          console.warn(`Không tạo sẵn được ảnh thiệp: ${err instanceof Error ? err.message : String(err)}`);
          return 0;
        });
  console.log(
    `Cron ${cron}: due=${result.due} sent=${result.sent} failed=${result.failed} skipped=${result.skipped} cards_ready_tomorrow=${prerendered}${result.note ? ` note=${result.note}` : ''}`,
  );
  return result;
}

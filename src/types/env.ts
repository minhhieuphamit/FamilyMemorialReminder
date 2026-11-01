import type { AuthInfo } from './domain';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PASSWORD?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  ZALO_BOT_TOKEN?: string;
  ZALO_WEBHOOK_SECRET?: string;
  /** Địa chỉ relay nhận webhook Zalo thay Worker, vì Cloudflare chặn Zalo trên workers.dev. Xem ZALO_SETUP.md. */
  ZALO_WEBHOOK_URL?: string;
  /** Tên hiển thị của bot Zalo, để bỏ phần "@Tên bot" khỏi tin trong nhóm. */
  ZALO_BOT_NAME?: string;
  /** Địa chỉ công khai của website, để Telegram và Zalo tải được ảnh thiệp. */
  PUBLIC_BASE_URL?: string;
  BROWSER_RUN_ACCOUNT_ID?: string;
  BROWSER_RUN_TOKEN?: string;
  /** Không bắt buộc: thay địa chỉ API tạo ảnh, dùng khi kiểm thử. */
  BROWSER_RUN_ENDPOINT?: string;
}

export type AppEnv = { Bindings: Env; Variables: { auth: AuthInfo } };

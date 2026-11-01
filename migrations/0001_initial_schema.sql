-- Family Memorial Reminder: schema ban đầu.

CREATE TABLE memorial_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name         TEXT    NOT NULL,
  relationship      TEXT    NOT NULL,
  lunar_day         INTEGER NOT NULL CHECK (lunar_day BETWEEN 1 AND 30),
  lunar_month       INTEGER NOT NULL CHECK (lunar_month BETWEEN 1 AND 12),
  is_leap_month     INTEGER NOT NULL DEFAULT 0 CHECK (is_leap_month IN (0, 1)),
  death_year        INTEGER,
  death_solar_date  TEXT,
  notes             TEXT    NOT NULL DEFAULT '',
  -- exact: đúng tháng đã chọn, không thay thế | regular: luôn tháng thường
  -- leap_if_available: ưu tiên tháng nhuận nếu năm có | both: cả tháng thường và nhuận
  leap_month_rule   TEXT    NOT NULL DEFAULT 'exact'
                    CHECK (leap_month_rule IN ('exact', 'regular', 'leap_if_available', 'both')),
  -- skip: không thay thế, báo cần xử lý | last_day: ngày cuối tháng | next_day: mùng 1 tháng sau
  missing_day_rule  TEXT    NOT NULL DEFAULT 'skip'
                    CHECK (missing_day_rule IN ('skip', 'last_day', 'next_day')),
  reminder_enabled  INTEGER NOT NULL DEFAULT 1 CHECK (reminder_enabled IN (0, 1)),
  -- Mảng JSON số ngày nhắc trước, ví dụ [7,1,0]. NULL = dùng cấu hình chung.
  reminder_offsets  TEXT,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_memorial_events_lunar ON memorial_events (lunar_month, lunar_day);
CREATE INDEX idx_memorial_events_reminder ON memorial_events (reminder_enabled);

-- Lịch nhắc chung: mỗi dòng là một mốc "trước N ngày".
CREATE TABLE notification_settings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  days_before INTEGER NOT NULL UNIQUE CHECK (days_before BETWEEN 0 AND 60),
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Whitelist Chat ID. Chat không có trong bảng sẽ không xem được dữ liệu.
CREATE TABLE telegram_chats (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id               TEXT    NOT NULL UNIQUE,
  title                 TEXT    NOT NULL DEFAULT '',
  can_query             INTEGER NOT NULL DEFAULT 1 CHECK (can_query IN (0, 1)),
  receive_notifications INTEGER NOT NULL DEFAULT 1 CHECK (receive_notifications IN (0, 1)),
  created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Lịch sử gửi. dedupe_key UNIQUE là cơ chế chống gửi trùng:
-- "<event_id>:<occurrence_date>:<days_before>:<chat_id>". Tin thử có dedupe_key NULL.
CREATE TABLE notification_logs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key          TEXT    UNIQUE,
  kind                TEXT    NOT NULL DEFAULT 'reminder' CHECK (kind IN ('reminder', 'test')),
  event_id            INTEGER REFERENCES memorial_events (id) ON DELETE SET NULL,
  event_name          TEXT    NOT NULL DEFAULT '',
  occurrence_date     TEXT,
  days_before         INTEGER,
  scheduled_date      TEXT    NOT NULL,
  chat_id             TEXT    NOT NULL,
  status              TEXT    NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts            INTEGER NOT NULL DEFAULT 0,
  retryable           INTEGER NOT NULL DEFAULT 1 CHECK (retryable IN (0, 1)),
  telegram_message_id INTEGER,
  error_message       TEXT,
  last_attempt_at     TEXT,
  sent_at             TEXT,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_notification_logs_created ON notification_logs (created_at DESC);
CREATE INDEX idx_notification_logs_status ON notification_logs (status, scheduled_date);
CREATE INDEX idx_notification_logs_event ON notification_logs (event_id);

CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Chỉ lưu SHA-256 của token phiên; token gốc nằm trong cookie HttpOnly.
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_admin_sessions_expires ON admin_sessions (expires_at);

-- Đếm số lần đăng nhập theo cửa sổ thời gian, bền vững giữa các isolate.
CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);

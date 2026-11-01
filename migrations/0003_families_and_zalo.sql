-- Nhóm ngày giỗ theo gia đình, và thêm kênh gửi Zalo.

CREATE TABLE families (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Xóa gia đình thì ngày giỗ vẫn còn, chỉ không thuộc gia đình nào.
ALTER TABLE memorial_events ADD COLUMN family_id INTEGER REFERENCES families (id) ON DELETE SET NULL;
CREATE INDEX idx_memorial_events_family ON memorial_events (family_id);

-- telegram_chats trở thành chats dùng chung cho mọi kênh.
-- ID Zalo là chuỗi, nên một Chat ID chỉ duy nhất trong cùng kênh.
CREATE TABLE chats (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  channel               TEXT    NOT NULL DEFAULT 'telegram' CHECK (channel IN ('telegram', 'zalo')),
  chat_id               TEXT    NOT NULL,
  title                 TEXT    NOT NULL DEFAULT '',
  can_query             INTEGER NOT NULL DEFAULT 1 CHECK (can_query IN (0, 1)),
  receive_notifications INTEGER NOT NULL DEFAULT 1 CHECK (receive_notifications IN (0, 1)),
  -- 1: thấy mọi ngày giỗ. 0: chỉ thấy các gia đình trong chat_families.
  all_families          INTEGER NOT NULL DEFAULT 1 CHECK (all_families IN (0, 1)),
  created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (channel, chat_id)
);

INSERT INTO chats (id, channel, chat_id, title, can_query, receive_notifications, created_at, updated_at)
  SELECT id, 'telegram', chat_id, title, can_query, receive_notifications, created_at, updated_at
  FROM telegram_chats;

DROP TABLE telegram_chats;

CREATE TABLE chat_families (
  chat_row_id INTEGER NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  family_id   INTEGER NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  PRIMARY KEY (chat_row_id, family_id)
);

CREATE INDEX idx_chat_families_family ON chat_families (family_id);

-- message_id của Zalo là chuỗi hex nên không dùng được cột INTEGER cũ.
ALTER TABLE notification_logs ADD COLUMN channel TEXT NOT NULL DEFAULT 'telegram' CHECK (channel IN ('telegram', 'zalo'));
ALTER TABLE notification_logs ADD COLUMN provider_message_id TEXT;
UPDATE notification_logs SET provider_message_id = CAST(telegram_message_id AS TEXT) WHERE telegram_message_id IS NOT NULL;
ALTER TABLE notification_logs DROP COLUMN telegram_message_id;

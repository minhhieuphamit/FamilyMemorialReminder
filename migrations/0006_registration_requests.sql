CREATE TABLE registration_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL CHECK(channel IN ('telegram','zalo')),
  chat_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  admin_notice_error TEXT,
  result_notice_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_at TEXT,
  review_token TEXT
);
CREATE UNIQUE INDEX idx_registration_pending ON registration_requests(channel,chat_id,family_id) WHERE status = 'pending';
CREATE INDEX idx_registration_status ON registration_requests(status,id);
-- Snapshot of notification destinations; only an authenticated administrator can change these.
CREATE TABLE registration_admins (
  channel TEXT NOT NULL CHECK(channel IN ('telegram','zalo')),
  chat_id TEXT NOT NULL,
  PRIMARY KEY(channel,chat_id)
);
CREATE TABLE registration_challenges (
  token TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  channel TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  family_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_registration_challenges_expires ON registration_challenges(expires_at);

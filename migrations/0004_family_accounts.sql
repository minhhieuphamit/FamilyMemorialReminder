-- Mỗi gia đình có một tài khoản đăng nhập riêng và cấu hình nhắc riêng.

ALTER TABLE families ADD COLUMN username TEXT;
CREATE UNIQUE INDEX idx_families_username ON families (username) WHERE username IS NOT NULL;
-- PBKDF2-SHA256, dạng pbkdf2$<số vòng>$<salt hex>$<hash hex>. Không lưu mật khẩu gốc.
ALTER TABLE families ADD COLUMN password_hash TEXT;

ALTER TABLE families ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 1 CHECK (notifications_enabled IN (0, 1));
ALTER TABLE families ADD COLUMN upcoming_window_days INTEGER;
-- 0: theo lịch nhắc chung. 1: theo family_reminder_settings, kể cả khi bảng này không có dòng nào.
ALTER TABLE families ADD COLUMN reminders_customized INTEGER NOT NULL DEFAULT 0 CHECK (reminders_customized IN (0, 1));

CREATE TABLE family_reminder_settings (
  family_id   INTEGER NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  days_before INTEGER NOT NULL CHECK (days_before BETWEEN 0 AND 60),
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  PRIMARY KEY (family_id, days_before)
);

-- family_id NULL là phiên quản trị. Xóa gia đình thì phiên của gia đình đó mất hiệu lực.
ALTER TABLE admin_sessions ADD COLUMN family_id INTEGER REFERENCES families (id) ON DELETE CASCADE;
CREATE INDEX idx_admin_sessions_family ON admin_sessions (family_id);

-- Lưu riêng vì event_id thành NULL khi ngày giỗ bị xóa, mà gia đình vẫn cần xem lịch sử của mình.
ALTER TABLE notification_logs ADD COLUMN family_id INTEGER REFERENCES families (id) ON DELETE SET NULL;
UPDATE notification_logs SET family_id = (SELECT e.family_id FROM memorial_events e WHERE e.id = notification_logs.event_id);
CREATE INDEX idx_notification_logs_family ON notification_logs (family_id);

-- Lịch nhắc mặc định: trước 7, 3, 1 ngày và đúng ngày giỗ.
INSERT INTO notification_settings (days_before, enabled) VALUES (7, 1), (3, 1), (1, 1), (0, 1);

INSERT INTO app_settings (key, value) VALUES
  ('notifications_enabled', 'true'),
  ('upcoming_window_days', '30');

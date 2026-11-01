-- Ảnh thiệp đã tạo. Telegram và Zalo tải ảnh qua địa chỉ /cards/<token>.jpg nên phải lưu lại.
CREATE TABLE card_images (
  -- Chuỗi ngẫu nhiên 256 bit, không đoán được. Địa chỉ ảnh không cần đăng nhập.
  token        TEXT PRIMARY KEY,
  -- SHA-256 của nội dung thiệp: cùng nội dung thì dùng lại ảnh, không tốn lượt tạo mới.
  content_hash TEXT NOT NULL UNIQUE,
  data         BLOB NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_card_images_created ON card_images (created_at);

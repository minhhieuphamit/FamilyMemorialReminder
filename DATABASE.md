# Database

Cloudflare D1 (SQLite). Schema nằm trong [migrations/](migrations/), dữ liệu mẫu trong [seeds/sample_data.sql](seeds/sample_data.sql) (tách riêng để không lẫn vào dữ liệu thật).

## Các bảng

### `memorial_events`: ngày giỗ

| Cột | Kiểu | Ý nghĩa |
| --- | --- | --- |
| `id` | INTEGER PK | |
| `full_name` | TEXT | Họ tên người mất |
| `family_id` | INTEGER, có thể NULL | Gia đình. `ON DELETE SET NULL`: xóa gia đình vẫn giữ ngày giỗ |
| `relationship` | TEXT | Quan hệ: Ông nội, Bà ngoại, tùy chỉnh, hoặc chuỗi rỗng nếu không ghi |
| `lunar_day` | INTEGER 1-30 | Ngày giỗ âm |
| `lunar_month` | INTEGER 1-12 | Tháng giỗ âm |
| `is_leap_month` | 0/1 | Giỗ thuộc tháng nhuận |
| `death_year` | INTEGER, có thể NULL | Năm mất |
| `death_solar_date` | TEXT, có thể NULL | Ngày mất dương lịch `YYYY-MM-DD` |
| `notes` | TEXT | Ghi chú |
| `leap_month_rule` | TEXT | `exact`, `regular`, `leap_if_available`, `both` |
| `missing_day_rule` | TEXT | `skip`, `last_day`, `next_day` |
| `reminder_enabled` | 0/1 | Bật nhắc |
| `reminder_offsets` | TEXT, có thể NULL | Mảng JSON mốc nhắc riêng, ví dụ `[7,1,0]`. NULL = theo lịch chung |
| `created_at`, `updated_at` | TEXT | Thời gian UTC ISO 8601 |

Index: `(lunar_month, lunar_day)`, `(reminder_enabled)`, `(family_id)`.

Không lưu ngày dương của từng năm: ngày dương luôn được tính từ ngày âm khi cần, nên không bao giờ lệch.

### `notification_settings`: lịch nhắc chung

`days_before` (UNIQUE, 0-60), `enabled`. Mặc định: 7, 3, 1, 0.

### `families`: gia đình

`name` (UNIQUE; ứng dụng còn coi hai tên giống nhau khi bỏ dấu là trùng), `username` (UNIQUE, NULL nếu chưa cấp tài khoản), `password_hash` (PBKDF2-SHA256 có salt, không lưu mật khẩu gốc), `notifications_enabled`, `upcoming_window_days`, `reminders_customized`.

### `family_reminder_settings`: lịch nhắc riêng của gia đình

`family_id`, `days_before`, `enabled`. Chỉ dùng khi `families.reminders_customized = 1`, kể cả khi bảng này không có dòng nào (gia đình đã bỏ hết mốc nhắc); ngược lại gia đình theo `notification_settings`.

### `chats`: whitelist Chat ID của mọi kênh

`channel` (`telegram` hoặc `zalo`), `chat_id` (TEXT, UNIQUE theo từng kênh; ID Telegram có thể âm, ID Zalo là chuỗi), `title`, `can_query`, `receive_notifications`, `all_families`.

### `chat_families`: phạm vi gia đình của chat

`chat_row_id`, `family_id`. Chỉ dùng khi `all_families = 0`: chat chỉ thấy các gia đình trong bảng này. Rỗng nghĩa là không thấy gì, không phải thấy tất cả.

### `notification_logs`: lịch sử gửi

| Cột | Ý nghĩa |
| --- | --- |
| `dedupe_key` | UNIQUE, `<event_id>:<ngày giỗ>:<mốc nhắc>:<chat_id>`, với Zalo là `...:zalo:<chat_id>`. NULL với tin thử |
| `channel` | `telegram` hoặc `zalo` |
| `family_id` | Gia đình của dòng này, dùng để lọc lịch sử theo tài khoản. Vẫn còn khi ngày giỗ đã bị xóa |
| `kind` | `reminder` hoặc `test` |
| `event_id` | `ON DELETE SET NULL`: xóa ngày giỗ vẫn giữ lịch sử |
| `event_name` | Tên tại thời điểm gửi |
| `occurrence_date` | Ngày dương của lần giỗ |
| `days_before` | Mốc nhắc |
| `scheduled_date` | Ngày chạy nhắc |
| `chat_id` | Người nhận |
| `status` | `pending`, `sending`, `sent`, `failed` |
| `attempts` | Số lần đã thử |
| `retryable` | 0 với lỗi vĩnh viễn |
| `provider_message_id`, `error_message`, `last_attempt_at`, `sent_at` | Chi tiết |

Index: `(created_at DESC)`, `(status, scheduled_date)`, `(event_id)`.

### `app_settings`: cấu hình khóa - giá trị

| Khóa | Ý nghĩa |
| --- | --- |
| `notifications_enabled` | Công tắc gửi tự động chung |
| `upcoming_window_days` | Số ngày của mục "Sắp tới" |
| `last_cron_result` | Kết quả lần chạy cron gần nhất, dạng JSON |

### `admin_sessions`: phiên đăng nhập

`token_hash` (PK, SHA-256 của token, token gốc chỉ nằm trong cookie HttpOnly), `expires_at`, `family_id` (NULL là phiên quản trị; xóa gia đình thì phiên mất hiệu lực). Phiên hết hạn sau 30 ngày và được dọn hằng ngày.

### `rate_limits`: giới hạn đăng nhập

`key`, `window_start`, `count`. Mỗi IP sai tối đa 5 lần trong 15 phút.

### `card_images`: ảnh thiệp đã tạo

`token` (PK, mã ngẫu nhiên trong địa chỉ `/cards/<token>.jpg`), `content_hash` (UNIQUE, SHA-256 nội dung thiệp, để dùng lại ảnh), `data` (BLOB JPEG), `created_at`. Xóa sau 14 ngày bởi cron hằng ngày.

## Cơ chế chống gửi trùng

Mỗi lượt chạy làm trong một transaction của D1 cho từng chat:

1. `INSERT ... ON CONFLICT (dedupe_key) DO NOTHING`: tạo dòng nếu chưa có.
2. `UPDATE ... SET status = 'sending' ... WHERE dedupe_key = ? AND (status = 'pending' OR (status = 'failed' AND retryable = 1 AND attempts < 5) OR (status = 'sending' AND đã quá 15 phút)) RETURNING id`: giành quyền gửi.

Chỉ lượt nhận được `id` mới gửi. Dòng đã `sent` không bao giờ khớp, nên cron chạy lại hay hai lượt chạy song song đều không gửi trùng.

Ngoại lệ duy nhất là nút **Chạy ngay** trên website: mỗi lần bấm đều gửi lại, ghi thêm một dòng lịch sử có `dedupe_key` NULL. Nhắc chưa từng gửi vẫn được đánh dấu như thường, nên cron sau đó không gửi thêm.

Điểm còn lại: nếu Worker bị dừng đúng lúc sau khi Telegram nhận tin và trước khi ghi `sent`, dòng sẽ kẹt ở `sending` và được gửi lại sau 15 phút. Ứng dụng chọn thà nhắc hai lần trong trường hợp cực hiếm này còn hơn bỏ sót ngày giỗ.

## Migrations

Lệnh chạy:

```bash
npm run db:migrate:local
```

```bash
npm run db:migrate:remote
```

Thêm thay đổi schema: tạo file mới, đánh số tiếp theo, không sửa file đã chạy:

```bash
npx wrangler d1 migrations create family-memorial-db mo_ta_thay_doi
```

## Truy vấn hữu ích

Liệt kê ngày giỗ:

```bash
npx wrangler d1 execute family-memorial-db --remote --command "SELECT id, full_name, lunar_day, lunar_month FROM memorial_events"
```

Xem tin gửi lỗi:

```bash
npx wrangler d1 execute family-memorial-db --remote --command "SELECT event_name, chat_id, attempts, error_message, created_at FROM notification_logs WHERE status = 'failed' ORDER BY id DESC LIMIT 20"
```

Sao lưu: xem [DEPLOYMENT.md](DEPLOYMENT.md) mục 15.

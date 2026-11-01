# Cài đặt Telegram Bot

## 1. Tạo bot

1. Mở Telegram, tìm [@BotFather](https://t.me/BotFather) (có dấu tích xanh).
2. Gửi `/newbot`.
3. Đặt tên hiển thị, ví dụ `Nhắc ngày giỗ nhà mình`.
4. Đặt username, phải kết thúc bằng `bot`, ví dụ `nhacgio_nhaminh_bot`.
5. BotFather trả về token dạng `123456789:ABCdef...`. Đây là **Bot Token**.

Ai có token đều điều khiển được bot. Nếu lỡ lộ, gửi `/revoke` cho BotFather để lấy token mới, rồi đặt lại:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

## 2. Lưu token và kết nối webhook

Đặt secrets theo [DEPLOYMENT.md](DEPLOYMENT.md) mục 8, deploy, rồi trên website vào **Kênh gửi** và bấm **Thiết lập webhook**. Ba dòng trạng thái phải hiện chấm xanh.

Bot dùng webhook nên không cần máy nào chạy liên tục: Telegram gọi Worker mỗi khi có tin nhắn.

## 3. Thêm thành viên gia đình

Chỉ Chat ID có trong danh sách mới xem được dữ liệu.

1. Người cần thêm mở bot, nhấn **Start** hoặc gửi `/id`.
2. Bot trả về Chat ID. Người đó gửi mã cho quản trị viên.
3. Quản trị viên hoặc tài khoản của gia đình vào website, **Kênh gửi**, nhập Chat ID và tên gợi nhớ, bấm **Thêm**. Chat do tài khoản gia đình thêm chỉ thấy dữ liệu của gia đình đó.

Mỗi chat có hai công tắc độc lập:

- **Nhận thông báo:** nhận tin nhắc tự động.
- **Được tra cứu qua bot:** dùng được lệnh và câu hỏi.

## 4. Dùng trong nhóm Telegram

1. Thêm bot vào nhóm.
2. Trong nhóm gửi `/id@ten_bot_cua_ban`. Chat ID của nhóm là số âm, ví dụ `-1001234567890`.
3. Thêm mã này vào website như trên.

Mặc định Telegram bật **Privacy Mode**: trong nhóm, bot chỉ nhận được tin bắt đầu bằng `/`. Các lệnh vẫn hoạt động. Muốn hỏi tự nhiên trong nhóm ("Tháng này có giỗ ai?"):

1. Gửi `/setprivacy` cho BotFather, chọn bot, chọn **Disable**.
2. Xóa bot khỏi nhóm rồi thêm lại để thay đổi có hiệu lực.

Khi đó bot đọc được mọi tin trong nhóm nhưng chỉ trả lời câu liên quan đến ngày giỗ, các câu khác sẽ bỏ qua. Trong chat riêng không có giới hạn này.

Nếu nhóm được nâng lên supergroup, Chat ID sẽ đổi. Khi đó lặp lại bước 2 và 3.

## 5. Cách bot bảo vệ dữ liệu

- Webhook chỉ nhận request có header `X-Telegram-Bot-Api-Secret-Token` khớp với `TELEGRAM_WEBHOOK_SECRET`. Request khác nhận lỗi 401.
- Chat không có trong danh sách: mọi lệnh và câu hỏi bị bỏ qua không trả lời. Ngoại lệ duy nhất là `/start` và `/id`, chỉ trả về chính Chat ID của người hỏi, không có dữ liệu gia đình.
- Token không bao giờ được ghi vào log hay thông báo lỗi.

## 6. Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
| --- | --- | --- |
| Bot không trả lời gì | Webhook chưa thiết lập | Website, **Kênh gửi**, bấm **Thiết lập webhook** |
| Thẻ Telegram trên trang Kênh gửi báo `Unauthorized` | Token sai | Đặt lại `TELEGRAM_BOT_TOKEN`, tin lỗi sẽ được gửi lại ở lượt cron sau trong ngày |
| Telegram báo lỗi webhook `Wrong response from the webhook: 401` | Secret khác nhau | Bấm **Thiết lập webhook** lại sau khi đổi secret |
| Bot báo "chưa được cấp quyền" | Chat ID chưa có trong danh sách hoặc tắt tra cứu | Thêm Chat ID trên website |
| Gửi thử báo `Forbidden: bot was blocked` | Người nhận đã chặn bot | Người đó mở bot và nhấn Start |
| Gửi thử báo `Bad Request: chat not found` | Chat ID sai, hoặc người đó chưa từng nhắn bot | Bot không thể nhắn trước: người nhận phải nhấn Start |
| Nhóm: hỏi tự nhiên không có phản hồi | Privacy Mode đang bật | Xem mục 4 |
| Không nhận được nhắc | Xem **Lịch sử gửi** và ghi chú ở **Tổng quan** | Kiểm tra công tắc nhắc của ngày giỗ, công tắc chung, mốc nhắc và "Nhận thông báo" của chat |

Xem log trực tiếp khi gửi tin thử cho bot:

```bash
npx wrangler tail
```

## 7. Hành vi gửi nhắc

- Chạy lúc 07:00 giờ Việt Nam. Nhiều ngày giỗ cùng ngày được gộp một tin, gần nhất xếp trước.
- Khi gửi tự động, mỗi tổ hợp ngày giỗ + năm + mốc nhắc + Chat ID chỉ gửi thành công một lần. Nút **Chạy ngay** trên website thì luôn gửi lại.
- Khi lỗi tạm thời (mạng, Telegram quá tải, giới hạn tốc độ): thử lại ngay vài lần, sau đó thử ở các lượt 07:30 đến 10:30, tối đa 5 lượt.
- Lỗi vĩnh viễn (bị chặn, chat không tồn tại): không thử lại, ghi vào lịch sử.
- Ngày âm không tồn tại trong năm và chưa có quy tắc: không gửi nhắc, cảnh báo trên website và bot.

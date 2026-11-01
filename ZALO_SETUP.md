# Cài đặt Zalo Bot

Ứng dụng gửi Zalo qua **[Zalo Bot Platform](https://bot.zapps.me/docs/)**, nền tảng bot chính thức của Zalo, có webhook và không cần Official Account. Zalo là kênh tùy chọn, có thể dùng song song với Telegram.

## Giới hạn cần biết trước

- **Hạn mức miễn phí:** các bài viết bên thứ ba ghi nhận gói miễn phí khoảng 3 bot, 50 người dùng mỗi bot, 3.000 tin mỗi tháng. Mình không lấy được trang giá chính thức để xác nhận, và nền tảng còn mới nên con số có thể đổi. Xem mục **Giá gói** tại [bot.zapps.me](https://bot.zapps.me/) trước khi dựa vào. Với một gia đình thì mức này dư dùng.
- **Người nhận phải nhắn bot trước.** Bot không tự tìm được người dùng; mỗi thành viên cần nhắn bot để có Chat ID.
- **Nhóm Zalo đang Beta.** Tài liệu ghi nhận `chat_type` là `GROUP` ở dạng Beta, và có bot không thêm được vào nhóm. Ổn định nhất là gửi 1-1 cho từng người. Khi dùng trong nhóm, phải nhắc tên bot (gõ `@` rồi chọn bot) thì Zalo mới chuyển tin, ví dụ `@Tên bot /homnay`. Đăng ký cho nhóm bằng `@Tên bot /dangky Tên gia đình | Tên nhóm` rồi chờ admin duyệt, hoặc gửi `@Tên bot /id` để lấy Chat ID rồi thêm ở **Kênh gửi**. Tên bot khai ở biến `ZALO_BOT_NAME` trong `wrangler.jsonc`.
- **Không có nút bấm.** Trên Zalo dùng lệnh gõ tay hoặc câu hỏi tự nhiên như trên Telegram.
- **Tối đa 2000 ký tự một tin.** Ứng dụng tự chia tin dài.
- **Ảnh thiệp:** tài liệu Zalo chỉ ghi `photo` là "đường dẫn hình ảnh", không nói rõ giới hạn. Nếu Zalo từ chối ảnh, tin nhắc tự chuyển sang dạng chữ.
- **Điều khoản Zalo** yêu cầu thông báo cho người dùng rằng họ đang tương tác với phần mềm tự động và việc xử lý dữ liệu của họ. Hãy báo cho người thân trước khi thêm họ.

## 1. Tạo bot

1. Mở Zalo, tìm Official Account **Zalo Bot Manager**.
2. Trong menu của khung chat, chọn **Tạo bot**.
3. Đặt tên bắt đầu bằng `Bot`, ví dụ `Bot Ngày Giỗ`, rồi xác nhận.
4. Zalo gửi Bot Token qua tin nhắn. Giữ bí mật như mật khẩu, không dán vào chat hay commit lên Git.

## 2. Đặt secrets và deploy

Tạo chuỗi bí mật cho webhook, dài 8 đến 256 ký tự:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Đặt từng secret, dán giá trị khi được hỏi:

```bash
npx wrangler secret put ZALO_BOT_TOKEN
```

```bash
npx wrangler secret put ZALO_WEBHOOK_SECRET
```

Nếu đang cập nhật từ bản trước, sao lưu rồi chạy migration trước khi deploy. Migration đổi bảng `telegram_chats` thành `chats`, nên Worker cũ sẽ lỗi trong vài giây giữa hai lệnh:

```bash
npm run db:backup
```

```bash
npm run db:migrate:remote
```

```bash
npm run deploy
```

## 3. Kết nối webhook

Đăng nhập tên `admin`, vào **Kênh gửi**, ở thẻ **Zalo** bấm **Thiết lập webhook**. Ba dòng trạng thái phải hiện chấm xanh. Zalo tự gọi thử địa chỉ webhook và báo lỗi nếu không tới được.

Webhook phải là địa chỉ HTTPS công khai nên không thiết lập được khi chạy ở `localhost`.

### Relay cho webhook

Cloudflare chặn User-Agent `Java/1.8` của Zalo trên địa chỉ `workers.dev` (lỗi 1010), nên tin nhắn không tới được Worker dù gửi đi vẫn bình thường. Vì vậy Zalo gọi một relay miễn phí trên Vercel (`relay/api/zalo.ts`), relay chuyển nguyên nội dung và secret sang `/zalo/webhook` của Worker. Relay không lưu hay ghi log tin nhắn.

Địa chỉ relay nằm ở biến `ZALO_WEBHOOK_URL` trong `wrangler.jsonc`. Deploy lại relay khi có thay đổi:

```bash
npx vercel@latest deploy relay --prod --yes --name family-memorial-zalo-relay
```

Nếu sau này dùng tên miền riêng trên Cloudflare và tắt Browser Integrity Check cho `/zalo/*`, có thể bỏ biến này để Zalo gọi thẳng Worker.

## 4. Thêm người nhận

1. Người nhận tìm bot trên Zalo và gửi `/id`.
2. Bot trả về Chat ID. Người đó gửi mã cho quản trị viên.
3. Quản trị viên hoặc tài khoản của gia đình vào trang **Kênh gửi**: chọn kênh **Zalo**, nhập Chat ID và tên gợi nhớ, bấm **Thêm**.
4. Bấm **Gửi thử** và kiểm tra tin trên Zalo.

Chat ID của Zalo là chuỗi chữ và số, khác với số của Telegram.

## Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
| --- | --- | --- |
| Thẻ Zalo báo `Unauthorized` | Token sai hoặc hết hạn | Đặt lại `ZALO_BOT_TOKEN`; tin lỗi được gửi lại ở lượt cron sau trong ngày |
| Bot không trả lời | Webhook chưa thiết lập | Bấm **Thiết lập webhook** |
| Bot không trả lời dù ba chấm đều xanh | Chấm xanh chỉ so địa chỉ đã đăng ký; Zalo có thể không gọi được | Bấm **Thiết lập lại webhook** để Zalo gọi thử, xem request bằng `npx wrangler tail` |
| Bot báo "chưa được cấp quyền" | Chat ID chưa có trong danh sách, hoặc thêm nhầm vào kênh Telegram | Thêm đúng kênh **Zalo** |
| Lịch sử ghi lỗi 429 | Vượt hạn mức của gói | Giảm mốc nhắc hoặc số người nhận, xem lại gói trên bot.zapps.me. Lượt cron sau sẽ thử lại |
| Bot báo không thêm được vào nhóm | Giới hạn của nền tảng | Gửi 1-1 cho từng người |

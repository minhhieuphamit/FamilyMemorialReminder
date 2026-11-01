# Triển khai lên Cloudflare miễn phí

Toàn bộ lệnh chạy được trên Windows PowerShell, macOS và Linux, trừ khi có ghi chú khác. Chạy trong thư mục dự án.

## 1. Tạo tài khoản Cloudflare

Đăng ký tại <https://dash.cloudflare.com/sign-up>. Không cần thẻ tín dụng và không cần tên miền: ứng dụng sẽ có địa chỉ miễn phí dạng `https://family-memorial-reminder.<tên-tài-khoản>.workers.dev`.

## 2. Tạo Telegram Bot

Làm theo [TELEGRAM_SETUP.md](TELEGRAM_SETUP.md), mục 1: nhắn `/newbot` cho [@BotFather](https://t.me/BotFather).

## 3. Lấy Bot Token và Chat ID

- **Bot Token:** BotFather trả về sau khi tạo bot. Giữ bí mật như mật khẩu.
- **Chat ID:** lấy ở bước 13, sau khi bot đã chạy, bằng cách gửi `/id` cho bot.

## 4. Khởi tạo dự án

Cần [Node.js](https://nodejs.org) 22.13 trở lên.

```bash
npm install
```

```bash
npx wrangler login
```

Trình duyệt sẽ mở để bạn cấp quyền cho Wrangler.

## 5. Tạo D1 Database

```bash
npx wrangler d1 create family-memorial-db
```

Sao chép giá trị `database_id` trong kết quả.

## 6. Cấu hình `wrangler.jsonc`

Mở [wrangler.jsonc](wrangler.jsonc) và thay giá trị `database_id` bằng mã vừa sao chép:

```jsonc
"database_id": "mã-của-bạn"
```

Mã này không phải bí mật, có thể commit.

## 7. Chạy migrations

```bash
npm run db:migrate:remote
```

Dữ liệu mẫu là tùy chọn, không cần cho bản thật. Nếu muốn thử:

```bash
npm run db:seed:remote
```

Xóa dữ liệu mẫu sau khi thử xong:

```bash
npx wrangler d1 execute family-memorial-db --remote --command "DELETE FROM memorial_events WHERE notes LIKE '[Mẫu]%'"
```

## 8. Thiết lập Secrets

Tạo chuỗi ngẫu nhiên để làm secret webhook:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Đặt từng secret. Mỗi lệnh sẽ hỏi giá trị, dán vào rồi nhấn Enter:

```bash
npx wrangler secret put ADMIN_PASSWORD
```

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

```bash
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

| Secret | Giá trị |
| --- | --- |
| `ADMIN_PASSWORD` | Mật khẩu của tài khoản `admin` trên website. Nên dài từ 12 ký tự |
| `TELEGRAM_BOT_TOKEN` | Token từ BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Chuỗi ngẫu nhiên vừa tạo |

Nếu Wrangler hỏi tạo Worker mới, chọn đồng ý.

## 9. Deploy frontend và backend

```bash
npm run deploy
```

Lệnh này build giao diện rồi tải lên cả giao diện và API. Kết quả in ra địa chỉ `https://...workers.dev`. Mở địa chỉ đó và đăng nhập với tên `admin` và mật khẩu `ADMIN_PASSWORD`. Tài khoản cho từng gia đình được cấp ở trang **Gia đình**.

## 10. Cấu hình Telegram Webhook

**Cách dễ:** trên website vào **Kênh gửi**, ở thẻ **Telegram** bấm **Thiết lập webhook**. Nút này cũng đăng ký danh sách lệnh để Telegram gợi ý khi gõ `/`.

**Cách dùng lệnh** (thay 3 giá trị viết hoa):

```bash
curl -X POST "https://api.telegram.org/botBOT_TOKEN/setWebhook" -H "content-type: application/json" -d "{\"url\":\"https://DIA_CHI_WORKER/telegram/webhook\",\"secret_token\":\"WEBHOOK_SECRET\",\"allowed_updates\":[\"message\",\"callback_query\"]}"
```

Trên Windows PowerShell 5.1, dùng `curl.exe` thay cho `curl`.

### Thêm kênh Zalo (tùy chọn)

Xem [ZALO_SETUP.md](ZALO_SETUP.md).

### Bật ảnh thiệp (tùy chọn)

Không làm bước này thì nhắc vẫn gửi bình thường bằng chữ.

1. Kiểm tra `PUBLIC_BASE_URL` trong `wrangler.jsonc` đúng địa chỉ Worker của bạn.
2. Vào [API Tokens](https://dash.cloudflare.com/profile/api-tokens), **Create Token**, **Custom token**, cấp quyền **Account** → **Browser Rendering** (có thể hiện là **Browser Run**) → **Edit**, rồi tạo token.
3. Lấy Account ID:

```bash
npx wrangler whoami
```

4. Đặt hai secret:

```bash
npx wrangler secret put BROWSER_RUN_ACCOUNT_ID
```

```bash
npx wrangler secret put BROWSER_RUN_TOKEN
```

5. Trên website vào **Nhắc nhở**, bấm **Xem thử thiệp**.

Khi chạy local, thêm ba giá trị này vào `.dev.vars`, với `PUBLIC_BASE_URL` là địa chỉ tunnel: Browser Run và các nền tảng không tải được ảnh từ `localhost`.

## 11. Cron Trigger lúc 07:00 giờ Việt Nam

Đã cấu hình sẵn trong `wrangler.jsonc` và được áp dụng khi deploy, không cần làm thêm:

| Cron (UTC) | Giờ Việt Nam | Việc làm |
| --- | --- | --- |
| `0 0 * * *` | 07:00 mỗi ngày | Đợt gửi chính, dọn phiên hết hạn |
| `30 0-3 * * *` | 07:30, 08:30, 09:30, 10:30 | Gửi lại tin bị lỗi |

Cloudflare chạy cron theo UTC, và Việt Nam là UTC+7 nên 07:00 sáng tương ứng 00:00 UTC. Các lần cron chạy không gửi trùng.

Lưu ý: lượt gửi lại cũng phát hiện nhắc mới đến hạn. Nếu bạn thêm ngày giỗ lúc 07:15 và hôm nay đúng là một mốc nhắc của nó, tin sẽ đi lúc 07:30.

## 12. Test gửi Telegram

1. Gửi `/id` cho bot, bot trả về Chat ID.
2. Trên website vào **Kênh gửi**, nhập Chat ID và bấm **Thêm**.
3. Bấm **Gửi thử** ở chat đó, hoặc **Gửi thông báo thử** để gửi tới mọi chat nhận thông báo.
4. Kiểm tra Telegram, và trang **Lịch sử gửi** có dòng "Đã gửi".

## 13. Test command Telegram

Gửi cho bot lần lượt: `/start`, `/homnay`, `/thangnay`, `/saptoi`, `/tim ông nội` và câu "Tháng này có giỗ ai?".

Bot không trả lời? Xem mục xử lý sự cố trong [TELEGRAM_SETUP.md](TELEGRAM_SETUP.md).

## 14. Kiểm tra Cron chạy tự động

**Thử ngay không cần đợi:** website, trang **Nhắc nhở**, bấm **Chạy ngay**. Mỗi lần bấm đều gửi tin thật tới mọi người nhận, kể cả nhắc đã gửi. Để thấy có tin gửi đi, tạo một ngày giỗ thử có ngày âm trùng hôm nay (ngày âm hiện ở đầu trang Tổng quan), rồi xóa sau khi thử.

**Xem lần chạy thật:** sau 07:00 sáng hôm sau, trang **Tổng quan** có thẻ "Lần chạy tự động gần nhất". Hoặc xem log trực tiếp:

```bash
npx wrangler tail
```

Trên Cloudflare Dashboard: **Workers & Pages** → Worker này → **Settings** → **Trigger Events** để xem lịch, tab **Logs** để xem các lần chạy.

Thử cron ở máy cá nhân (khi `npm run dev:api` đang chạy):

```bash
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+0+*+*+*"
```

## 15. Cập nhật phiên bản và sao lưu

### Tự động qua GitHub Actions

Mỗi pull request và push đều chạy type check, test, build và `wrangler deploy --dry-run`. Riêng push lên `main`, sau khi kiểm tra đạt, workflow chạy migration rồi deploy Worker. Relay Zalo chỉ deploy khi thư mục `relay/` thay đổi. Xem [ci-cd.yml](.github/workflows/ci-cd.yml) và [deploy-relay.yml](.github/workflows/deploy-relay.yml).

Vào **Settings → Environments** của repo GitHub, tạo environment `production` và thêm vào đó (để chỉ job deploy đọc được):

| Secret | Giá trị |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Tạo tại [API Tokens](https://dash.cloudflare.com/profile/api-tokens) từ mẫu **Edit Cloudflare Workers**, thêm quyền **Account → D1 → Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | Mã tài khoản, lấy bằng `npx wrangler whoami` |
| `VERCEL_TOKEN` | Tạo tại [Vercel Tokens](https://vercel.com/account/tokens) |

Các secret của Worker (`ADMIN_PASSWORD`, token bot...) vẫn nằm trên Cloudflare, không cần thêm vào GitHub, và deploy không làm mất chúng.

Workflow chạy migration tự động và không tạo `backup.sql`, vì file đó có dữ liệu gia đình. Khi migration có rủi ro, hãy chạy `npm run db:backup` trên máy trước khi push; D1 Time Travel vẫn cho khôi phục trong 7 ngày.

### Cập nhật thủ công

Sao lưu trước, sau đó chạy theo đúng thứ tự, migration trước deploy:

```bash
npm install
```

```bash
npm run check
```

```bash
npm run db:migrate:remote
```

```bash
npm run deploy
```

Quay lại bản trước nếu có sự cố:

```bash
npx wrangler rollback
```

`rollback` chỉ đưa code về bản cũ, không hoàn tác migration database.

### Sao lưu

**Toàn bộ database**, gồm cả lịch sử:

```bash
npm run db:backup
```

Tạo file `backup.sql`. File này có dữ liệu gia đình và đã nằm trong `.gitignore`, hãy cất ở nơi an toàn. Đổi tên file theo ngày nếu muốn giữ nhiều bản, vì lệnh sẽ ghi đè tên cũ.

**Dữ liệu sử dụng:** website, trang **Sao lưu**, tải JSON hoặc CSV. Khôi phục ở cùng trang. File JSON gồm ngày giỗ, gia đình, lịch nhắc và Chat ID: chế độ **Thay thế** khôi phục cả ba, chế độ **Gộp** giữ nguyên lịch nhắc hiện tại và chỉ thêm Chat ID còn thiếu. File CSV chỉ có ngày giỗ. Lịch sử gửi chỉ có trong bản `backup.sql`.

D1 còn có Time Travel, khôi phục về thời điểm bất kỳ trong 7 ngày gần nhất trên Free Plan:

```bash
npx wrangler d1 time-travel info family-memorial-db
```

### Đổi mật khẩu quản trị

```bash
npx wrangler secret put ADMIN_PASSWORD
```

Để đăng xuất mọi thiết bị đang đăng nhập, kể cả các gia đình:

```bash
npx wrangler d1 execute family-memorial-db --remote --command "DELETE FROM admin_sessions"
```

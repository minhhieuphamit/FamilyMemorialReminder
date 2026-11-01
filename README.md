# Family Memorial Reminder

Ứng dụng quản lý ngày giỗ gia đình theo âm lịch Việt Nam: tự tính ngày dương từng năm, nhắc qua Telegram và Zalo lúc 07:00 sáng, tra cứu qua website hoặc bot.

Chạy hoàn toàn trên **Cloudflare Free Plan**: không cần VPS, không cần máy tính bật 24/7, không cần thẻ tín dụng, không có chi phí hằng tháng.

## Tính năng

- **Quản lý ngày giỗ:** thêm, sửa, xóa, tìm kiếm không dấu, sắp xếp theo ngày gần nhất, xem theo danh sách, theo tháng hoặc lịch tháng.
- **Lịch âm chính xác:** thuật toán thiên văn theo UTC+7, xử lý tháng nhuận và ngày 29/30. Không bao giờ tự chọn ngày thay thế nếu chưa có quy tắc.
- **Nhóm theo gia đình:** xếp ngày giỗ vào Nhà nội, Nhà ngoại..., lọc theo gia đình, và chọn mỗi chat chỉ nhận tin của gia đình nào.
- **Telegram và Zalo Bot:** lệnh và câu tiếng Việt tự nhiên, gõ không dấu cũng hiểu; Telegram có thêm nút bấm nhanh. Không dùng AI trả phí.
- **Nhắc tự động:** mặc định trước 7, 3, 1 ngày và đúng ngày, gửi ảnh thiệp riêng cho từng ngày giỗ kèm lời nhắn, chống gửi trùng, tự gửi lại khi lỗi. Không tạo được ảnh thì gửi bằng chữ.
- **Sao lưu:** xuất và nhập JSON hoặc CSV.
- **Bảo mật:** đăng nhập, whitelist Chat ID, webhook có secret, rate limit, secrets không nằm trong code.
- **Giao diện:** tiếng Việt, ưu tiên điện thoại, có giao diện tối.

## Bắt đầu nhanh ở máy cá nhân

Cần Node.js 22.13 trở lên.

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

Mở `.dev.vars` và đặt `ADMIN_PASSWORD`, sau đó:

```bash
npm run db:migrate:local
```

```bash
npm run db:seed:local
```

```bash
npm run dev
```

Mở <http://localhost:5173> (có tự tải lại khi sửa giao diện), API chạy ở cổng 8787. Dữ liệu mẫu đều có ghi chú bắt đầu bằng `[Mẫu]`.

Triển khai thật: xem [DEPLOYMENT.md](DEPLOYMENT.md). Cài bot: xem [TELEGRAM_SETUP.md](TELEGRAM_SETUP.md) và [ZALO_SETUP.md](ZALO_SETUP.md). Database: xem [DATABASE.md](DATABASE.md).

## Gia đình và tài khoản

Có hai loại tài khoản:

| | Quản trị viên | Tài khoản gia đình |
| --- | --- | --- |
| Đăng nhập | Tên `admin`, mật khẩu `ADMIN_PASSWORD` | Tên và mật khẩu do quản trị viên cấp |
| Ngày giỗ | Thấy và sửa tất cả | Chỉ của gia đình mình; ngày giỗ thêm mới tự vào gia đình này |
| Lịch nhắc | Lịch chung | Lịch riêng; chưa đặt thì theo lịch chung |
| Chat ID | Tất cả, chọn được phạm vi gia đình | Chỉ chat của gia đình mình |
| Lịch sử, sao lưu | Toàn bộ | Chỉ của gia đình mình |
| Tạo gia đình, cấp tài khoản, cài bot | Có | Không |

**Cấp tài khoản:** đăng nhập `admin`, vào trang **Gia đình**, tạo gia đình rồi bấm **Cấp tài khoản**. Gia đình tự đổi mật khẩu ở trang **Tài khoản**. Quên mật khẩu thì quản trị viên bấm **Đặt lại mật khẩu**, mọi thiết bị của gia đình đó sẽ phải đăng nhập lại.

**Thứ tự ưu tiên mốc nhắc:** mốc riêng của ngày giỗ, rồi lịch của gia đình, rồi lịch chung.

**Dùng chung một người:** một Chat ID có thể thuộc nhiều gia đình. Khi đó người đó nhận tin của cả các nhà, và mỗi nhà chỉ gỡ được chat khỏi nhà mình, không sửa được và không thấy nhà khác đặt tên gì.

Ở trang **Kênh gửi**, quản trị viên có thêm công tắc **Mọi gia đình** để chọn phạm vi của từng chat. Chat bị giới hạn không thấy ngày giỗ chưa xếp gia đình. Xóa một gia đình sẽ giữ lại ngày giỗ, chuyển chúng về "Chưa xếp gia đình", xóa tài khoản của gia đình đó, và không làm chat bị giới hạn thấy thêm dữ liệu.

## Ảnh thiệp nhắc ngày giỗ

Mỗi nhắc được gửi thành một ảnh thiệp có tên, gia đình, ngày âm, ngày dương và số ngày còn lại, kèm lời nhắn bên dưới. Ảnh được tạo tự động theo từng ngày giỗ, không dùng AI.

Worker miễn phí chỉ có 10 ms CPU nên không tự vẽ ảnh được. Ứng dụng gửi HTML của thiệp cho **Cloudflare Browser Run** (Free Plan: 10 phút trình duyệt mỗi ngày, 1 yêu cầu mỗi 10 giây) rồi chờ kết quả; thời gian chờ không tính CPU. Ảnh được lưu trong D1 14 ngày, cùng nội dung thì dùng lại. Telegram và Zalo tải ảnh qua địa chỉ `/cards/<mã ngẫu nhiên 256 bit>.jpg`, không cần đăng nhập nhưng không đoán được.

Tính năng này tùy chọn, cách bật ở [DEPLOYMENT.md](DEPLOYMENT.md) mục "Bật ảnh thiệp". Chưa cấu hình, hết hạn mức, hoặc nền tảng từ chối ảnh thì tin nhắc tự chuyển sang dạng chữ. Mỗi lượt tạo tối đa 6 ảnh, các nhắc còn lại được gộp thành một tin chữ.

Ảnh nền nằm ở `frontend/public/card-bg.jpg`, thay file này để đổi phong cách. Bố cục ở `src/services/card-image.ts`.

## Quy tắc xử lý ngày âm

Mỗi ngày giỗ có hai quy tắc, chọn trong form và xem trước được ngày dương 5 năm tới.

**Tháng nhuận**

| Quy tắc | Năm có tháng nhuận cùng số | Năm không có |
| --- | --- | --- |
| Đúng tháng đã chọn (mặc định) | Đúng tháng đã chọn | Giỗ tháng thường: bình thường. Giỗ tháng nhuận: **không có ngày, báo cần xử lý** |
| Luôn cúng tháng thường | Tháng thường | Tháng thường |
| Ưu tiên tháng nhuận | Tháng nhuận | Tháng thường |
| Cúng cả hai lần | Cả tháng thường và nhuận | Tháng thường |

**Ngày 30 khi tháng chỉ có 29 ngày**

| Quy tắc | Kết quả |
| --- | --- |
| Không thay thế (mặc định) | Không có ngày, không gửi nhắc, **báo cần xử lý** trên Tổng quan, Lịch và bot |
| Dùng ngày cuối tháng | Cúng ngày 29 |
| Dùng mùng 1 tháng sau | Cúng mùng 1 tháng kế tiếp |

Việc này quan trọng vì nhiều năm không có "30 Tết": ví dụ tháng 12 các năm âm 2024 đến 2030 đều chỉ có 29 ngày. Giỗ 30 tháng Chạp nên đặt quy tắc ngay khi thêm.

Năm âm không trùng năm dương nên một năm dương có thể có 0, 1 hoặc 2 lần cùng một ngày giỗ: ví dụ giỗ 1/12 âm rơi vào cả 11/01/2024 và 31/12/2024. Ứng dụng tính đúng các trường hợp này.

### Giới hạn cần biết

Trước năm 1968, lịch âm Việt Nam tính theo múi giờ UTC+8. Khi đổi một **ngày mất dương lịch trước 1968** sang âm, kết quả có thể lệch so với gia phả; form sẽ hiện lưu ý. Ngày giỗ âm đã nhập và lịch các năm hiện tại không bị ảnh hưởng.

## Kiến trúc

Một Cloudflare Worker duy nhất phục vụ cả giao diện lẫn API. File tĩnh không tính vào số request của Worker.

```text
Trình duyệt  ──► Static Assets (React)
      │
      └─ /api/* ───────► Hono API ──┐
Telegram ── /telegram/webhook ─► Bot ─┼─► services ──► D1
Cron 07:00 ──► scheduler ───────────┘      │
                                           └──► Telegram Bot API
```

```text
src/
  index.ts                 Điểm vào của Worker: fetch và scheduled
  api/                     Các route Hono: auth, events, families, overview, settings, channels, backup, webhook
  bot/                     parser (lệnh và câu tự nhiên), replies (nội dung), handler (quyền, phạm vi gia đình, gửi tin)
  services/
    occurrences.ts         Ngày giỗ âm -> ngày dương theo quy tắc
    memorial-service.ts    Danh sách theo khoảng ngày, tháng, tìm kiếm
    notification-service.ts Tìm nhắc đến hạn, chống trùng, gửi
    message-format.ts      Định dạng tin nhắn nhắc
    bot-api.ts             Gọi API bot, có retry, không lộ token
    telegram-client.ts, zalo-client.ts  Các method của từng nền tảng
    channel-senders.ts     Lớp gửi tin chung cho mọi kênh
    card-image.ts          Thiệp: HTML, lời nhắn, gọi Browser Run
  scheduler/cron.ts        Xử lý Cron Trigger
  database/                Repository, chỉ dùng prepared statements
  middleware/              auth, kiểm tra nguồn gửi, rate limit
  utils/lunar-calendar/    Chuyển đổi âm dương, không phụ thuộc Worker
  utils/                   Ngày tháng, chuẩn hóa tiếng Việt, CSV, validation
  types/                   Kiểu dữ liệu dùng chung với frontend
frontend/                  React + Vite + Tailwind CSS
migrations/                Schema D1
seeds/                     Dữ liệu mẫu
tests/                     Unit test
```

## Kiểm thử

```bash
npm test
```

```bash
npm run check
```

`npm run check` chạy kiểm tra kiểu, unit test, build và thử deploy (không tải lên).

Test database chạy SQL thật trên SQLite (`node:sqlite`) với đúng các file migrations. Bộ đối chiếu lịch âm gồm mùng 1 Tết và Giỗ Tổ Hùng Vương (ngày nghỉ lễ chính thức), Trung thu, các năm nhuận đã biết, và kiểm tra đổi đi đổi lại mọi ngày từ 1900 đến 2199.

## Lệnh của bot

Dùng được trên cả Telegram và Zalo.

| Lệnh | Tác dụng |
| --- | --- |
| `/start`, `/help` | Hướng dẫn và menu nút bấm |
| `/homnay` | Ngày giỗ hôm nay |
| `/thangnay` | Trong tháng dương hiện tại |
| `/thangam` | Trong tháng âm hiện tại |
| `/thangtoi` | Trong tháng dương tới |
| `/saptoi` | Trong 30 ngày tới |
| `/namnay` | Trong năm nay |
| `/tim [tên]` | Tìm theo tên, quan hệ hoặc gia đình |
| `/giadinh [tên]` | Liệt kê gia đình, hoặc xem ngày giỗ của một gia đình |
| `/id` | Xem Chat ID (không cần quyền) |

Hỏi tự nhiên: "Tháng này có giỗ ai?", "Tuần tới có giỗ không?", "gio ong noi con bao nhieu ngay", "Ngày giỗ gần nhất là ngày nào?"

## Giới hạn Free Plan

| Tài nguyên | Giới hạn miễn phí | Ứng dụng dùng |
| --- | --- | --- |
| Worker requests | 100.000 mỗi ngày | Chỉ API và webhook, file tĩnh không tính |
| Worker CPU | 10 ms mỗi lần gọi | Lịch âm được cache theo năm, không băm mật khẩu tốn CPU |
| D1 | 5 triệu dòng đọc, 100.000 dòng ghi mỗi ngày, 5 GB | Rất nhỏ với dữ liệu gia đình |
| Cron Triggers | 5 lịch mỗi tài khoản | 2 lịch |

Zalo Bot Platform có hạn mức riêng, xem [ZALO_SETUP.md](ZALO_SETUP.md).

## Đăng ký thành viên và duyệt

- Người dùng nhắn riêng bot Telegram/Zalo: `/dangky Tên gia đình | Họ tên` (cũng nhận `đăng ký Tên gia đình | Họ tên`). Gia đình cần được admin tạo trước.
- Nhóm Zalo đăng ký bằng cách nhắc tên bot: `@Tên bot /dangky Tên gia đình | Tên nhóm`. Sau khi admin duyệt, mọi thành viên nhóm xem được dữ liệu và nhóm nhận tin nhắc. Gỡ nhóm do admin làm trên website.
- Tự rời gia đình hoặc rút yêu cầu chờ duyệt: `/huydangky Tên gia đình` (cũng nhận `hủy đăng ký Tên gia đình`), không cần admin duyệt. Chat đang nhận mọi gia đình sẽ chuyển thành danh sách các gia đình còn lại, nên gia đình tạo sau này không tự được thêm. Hủy gia đình cuối cùng sẽ xóa chat khỏi danh sách nhận tin.
- Hoặc mở `/dang-ky` trên website: nhập gia đình, họ tên, kênh và Chat ID, rồi xác minh mã bot gửi. Mã có hiệu lực 10 phút, tối đa 5 lần thử; không tạo đăng ký khi chưa xác minh.
- Admin vào **Kênh gửi → Đăng ký thành viên theo gia đình** để thêm/gỡ Chat ID quản lý nhận thông báo. Có thể nhận đồng thời qua Telegram và Zalo. Danh sách này chỉ là nơi nhận tin, không cấp quyền đăng nhập admin.
- Yêu cầu được lưu chờ duyệt. Admin duyệt/từ chối trên website, hoặc từ chat riêng có Chat ID nằm trong danh sách "Admin duyệt và nhận thông báo": `/choduyet`, `/duyet 12`, `/tuchoi 12` (cũng nhận `duyệt 12`, `từ chối 12`). Sau mỗi quyết định, bot báo kết quả cho người đăng ký và cho mọi admin trên cả hai kênh, kèm người xử lý. Chat mới được giới hạn đúng gia đình, không có quyền quản trị website. Với chat đã tồn tại, giữ các cài đặt cũ và chỉ nối thêm gia đình đã duyệt.
- Nếu thông báo lỗi, yêu cầu vẫn có trong danh sách và có thể gửi lại thông báo cho admin. Danh sách có phân trang 10/20/50 dòng.
- Triển khai phiên bản này: sao lưu D1, chạy `npm run db:migrate:remote` (migration 0006), sau đó `npm run deploy`. Cấu hình người nhận thông báo trong Kênh gửi.

# Đóng góp

Cảm ơn bạn đã quan tâm đến dự án. Mọi thay đổi đi qua pull request vào `main`.

## Chạy ở máy

Cần [Node.js](https://nodejs.org) 22.13 trở lên.

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

Không cần token bot thật để chạy website và test. Muốn thử bot, hãy tạo bot riêng theo [TELEGRAM_SETUP.md](TELEGRAM_SETUP.md) hoặc [ZALO_SETUP.md](ZALO_SETUP.md).

## Trước khi mở pull request

```bash
npm run check
```

Lệnh này chạy type check, test, build và deploy thử. GitHub Actions chạy lại các bước tương tự trên mỗi pull request. Thay đổi về hành vi cần có test đi kèm.

## Quy tắc

- Không commit token, mật khẩu, Chat ID thật, file backup hay dữ liệu gia đình thật. Dùng dữ liệu giả trong test và seed.
- Thay đổi cấu trúc database bằng file migration mới, không sửa migration đã có.
- Dự án chạy trên Cloudflare Free Plan với 10 ms CPU mỗi request, nên tránh tính toán nặng trong Worker.

## Dùng cho gia đình bạn

Fork không tự deploy. Hãy làm theo [DEPLOYMENT.md](DEPLOYMENT.md) với tài khoản Cloudflare của bạn, rồi thay `database_id`, `PUBLIC_BASE_URL`, `ZALO_WEBHOOK_URL`, `ZALO_BOT_NAME` trong `wrangler.jsonc`, địa chỉ Worker trong `relay/api/zalo.ts`, và tên repo cùng địa chỉ kiểm tra trong `.github/workflows/`.

## Báo lỗi bảo mật

Đừng đăng lỗ hổng bảo mật công khai trong issue. Hãy dùng **Security → Report a vulnerability** của repo.

# Tủ sách riêng

Kho PDF/TXT cá nhân chạy bằng Next.js trên Vercel. Bạn bè có URL được đọc toàn
bộ sách đã xuất bản; chỉ chủ kho có phiên đăng nhập mới được upload. Metadata ở
Cloudflare D1 và tệp nằm trong R2 private bucket.

## Kiến trúc MVP

```text
Bạn đọc -> Vercel / Next.js -> D1 REST (danh mục)
Bạn đọc -> content route -> presigned GET 5 phút -> R2 private
Chủ kho -> HttpOnly owner session -> upload reservation
         -> presigned PUT 5 phút -> R2 -> finalize -> D1 publish
```

Upload đi thẳng từ trình duyệt đến R2 vì Vercel Functions giới hạn payload
request/response 4,5 MB, còn ứng dụng cho phép sách tối đa 50 MiB. Chi tiết và
trade-off ở `docs/vercel-architecture.md`.

## Chức năng và ranh giới bảo mật

- Catalog responsive, tìm kiếm/sắp xếp, PDF viewer và TXT reader.
- Tiến độ đọc lưu trong `localStorage` của từng thiết bị; không phải danh tính.
- Owner passphrase được băm PBKDF2-HMAC-SHA256, 600.000 vòng; không lưu plaintext.
- Cookie `__Host-library_owner`: `Secure`, `HttpOnly`, `SameSite=Strict`, hết hạn 8 giờ.
- API ghi yêu cầu owner session + same-origin; login và upload có D1 rate limit.
- PDF/TXT được kiểm tra ở client; finalize kiểm tra size, MIME và signature prefix ở R2.
- R2 private, URL GET/PUT ký ngắn hạn; CSP và R2 CORS giới hạn origin.
- D1 CHECK constraint giữ tổng committed + reserved không quá `9,000,000,000` byte.
- Circuit breaker ứng dụng: 5.000 Class A và 100.000 Class B/tháng.
- API lỗi nhất quán, không trả stack trace, token hoặc khóa storage.
- Site phát `noindex`/`robots.txt` để giảm việc kho cá nhân bị máy tìm kiếm lập chỉ mục.

## Chạy local

Yêu cầu Node.js 22. Tạo `.env.local` từ `.env.example`, sau đó:

```bash
npm install
npm run dev
```

Không commit `.env.local`.

## Khởi tạo Cloudflare

1. Tạo D1 database và chạy lần lượt:
   `drizzle/0000_tearful_wasp.sql`, `drizzle/0001_colossal_misty_knight.sql`.
2. Tạo R2 bucket với storage class `Standard` và giữ bucket private. Free tier
   không áp dụng cho `Infrequent Access`.
3. Tạo D1 API token chỉ có D1 Read/Write cho database này.
4. Tạo R2 S3 key chỉ có Object Read/Write cho bucket này.
5. Thay `https://your-project.vercel.app` trong `infrastructure/r2-cors.json`
   bằng production origin, rồi áp dụng ở R2 > bucket > Settings > CORS Policy.

Mẫu CORS có thêm `http://localhost:3000`; xóa origin đó nếu không cần test local.

## Tạo owner secret

Không gửi passphrase hoặc secret qua chat. Nhập kín trong terminal rồi sinh hash:

```bash
read -s OWNER_PASSPHRASE
export OWNER_PASSPHRASE
npm run auth:generate
unset OWNER_PASSPHRASE
```

Lưu hai dòng output trực tiếp vào Vercel Environment Variables. Không ghi chúng
vào repository.

## Deploy Vercel

Import repository vào Vercel với Framework Preset `Next.js`, sau đó đặt đủ biến:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_D1_DATABASE_ID
CLOUDFLARE_D1_API_TOKEN
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
OWNER_PASSWORD_HASH
SESSION_SECRET
```

Đặt cho Production; chỉ đặt Preview khi đã thêm đúng preview origin vào R2 CORS.
Sau lần deploy đầu, cập nhật CORS bằng URL production thực và redeploy nếu cần.

## Kiểm tra

```bash
npm run lint
npm test
```

Test bao gồm build production, file signature/UTF-8, CSRF fail-closed, migration,
hard quota, cost budget và security headers/CORS.

## Giới hạn và chi phí

- Public-read nghĩa là người có URL có thể đọc và chia sẻ lại presigned URL khi
  URL đó còn hiệu lực.
- `robots.txt` không phải access control. Nếu URL bị phát tán, cần chuyển sang
  invite-only hoặc bổ sung rate limiting/WAF ở lớp Vercel để chống scraping/L7 DDoS.
- Strict-free MVP không có antivirus server-side. Chủ kho phải quét tệp lạ trên
  máy trước khi upload; không mở upload cho bạn bè nếu chưa có quarantine + AV.
- Guard trong ứng dụng giảm nguy cơ vượt free tier nhưng không thể cam kết `$0`
  tuyệt đối khi pricing/quota của nhà cung cấp thay đổi. Bật usage/billing alert.
- Chưa có UI xóa sách, note/bookmark và backup automation. Backup chỉ được coi
  hợp lệ sau một lần restore D1/R2 thành công.
- Chỉ upload sách bạn có quyền lưu trữ và chia sẻ.

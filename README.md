# Tủ sách của Tuấn

Kho PDF/TXT cá nhân chạy bằng Next.js trên Vercel. Bạn bè có URL được đọc toàn
bộ sách đã xuất bản; chỉ Tuấn có phiên đăng nhập mới được upload. Metadata ở
Cloudflare D1; sách và ảnh bìa nằm trong R2 private bucket.

## Kiến trúc MVP

```text
Bạn đọc -> Vercel / Next.js -> D1 REST (danh mục)
Bạn đọc -> content route -> presigned GET 5 phút -> R2 private
         -> PDF.js tải theo Range và chỉ render trang hiện tại vào canvas
Bạn đọc -> nút tải PDF -> fetch signed R2 -> Blob cùng origin -> lưu về thiết bị
Bạn đọc -> nút nhạc -> public/audio/background.mp3 cùng origin (không autoplay)
Tuấn -> HttpOnly owner session -> upload reservation
      -> PDF.js trong trình duyệt render trang 1 thành ảnh (nếu không chọn bìa)
      -> presigned PUT sách/bìa 5 phút -> R2 -> finalize -> D1 publish
Tuấn -> xác nhận đúng tên sách -> owner-only DELETE -> R2 + D1 + quota + audit
```

Upload đi thẳng từ trình duyệt đến R2 vì Vercel Functions giới hạn payload
request/response 4,5 MB, còn ứng dụng cho phép sách tối đa 100 MiB và ảnh bìa
tối đa 3 MiB. Upload 100 MiB dùng một PUT nên nếu mạng rớt phải tải lại; multipart
upload là bước nâng cấp sau MVP. Chi tiết và trade-off ở `docs/vercel-architecture.md`.

## Chức năng và ranh giới bảo mật

- Catalog responsive có bìa tự tạo từ trang đầu PDF, quote đổi theo lượt mở trang,
  đồng hồ Việt Nam và tìm kiếm/sắp xếp. Trình đọc PDF theo từng trang có nút
  trước/sau, nhập số trang, zoom, phím mũi tên và vuốt ngang trên mobile. Mỗi
  trang PDF mặc định tự vừa cả chiều rộng lẫn chiều cao của khung; người đọc có
  thể chuyển sang `Vừa rộng`. TXT có cỡ chữ, giãn dòng và theme. Ảnh JPG/PNG/WebP
  chọn thủ công là tùy chọn ghi đè; TXT dùng bìa minh họa mặc định.
- Nguồn và ghi chú bản dịch quote nằm tại `docs/quote-sources.md`.
- Tiến độ đọc lưu trong `localStorage` của từng thiết bị; không phải danh tính.
- Owner passphrase được băm PBKDF2-HMAC-SHA256, 600.000 vòng; không lưu plaintext.
- Cookie `__Host-library_owner`: `Secure`, `HttpOnly`, `SameSite=Strict`, hết hạn 8 giờ.
- API ghi yêu cầu owner session + same-origin; login và upload có D1 rate limit.
- Xóa sách yêu cầu nhập đúng tiêu đề, owner session, same-origin và rate limit;
  hệ thống xóa file/ảnh bìa R2, cập nhật quota và D1 trong luồng có audit. Nếu
  cloud gián đoạn, sách được ẩn và hiện lại cho Admin dưới trạng thái chờ xóa.
- PDF/TXT và JPG/PNG/WebP được kiểm tra ở client; finalize kiểm tra size, MIME và
  signature prefix ở R2. SVG không được chấp nhận.
- PDF.js chạy bằng Web Worker cùng origin. Luồng tạo bìa chỉ render trang 1 và
  mã hóa lại thành WebP/JPEG; luồng đọc chỉ render trang hiện tại, hủy render cũ
  khi đổi trang và giới hạn số pixel canvas. Annotation và XFA bị tắt; không tải
  mã từ CDN bên thứ ba.
- R2 private, URL GET/PUT ký ngắn hạn; CSP và R2 CORS giới hạn origin.
- Nút tải PDF lấy file qua signed URL rồi tạo Blob cục bộ để sách cũ lẫn mới đều
  có tên tải xuống an toàn. Upload sách mới còn lưu `Content-Disposition` do
  server sinh; tiêu đề không được chèn trực tiếp vào HTTP header.
- Nhạc nền là MP3 tĩnh cùng origin, `preload=none`, chỉ phát sau khi người đọc bấm
  và có nút tắt. CSP không cho tải media từ domain ngoài.
- Bạn đọc không nhận thống kê dung lượng R2 trong HTML hoặc API catalog công khai;
  quota chỉ được truy vấn và hiển thị khi phiên owner hợp lệ.
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
   `drizzle/0000_tearful_wasp.sql`, `drizzle/0001_colossal_misty_knight.sql`,
   `drizzle/0002_amazing_whizzer.sql`.
2. Tạo R2 bucket với storage class `Standard` và giữ bucket private. Free tier
   không áp dụng cho `Infrequent Access`.
3. Tạo D1 API token chỉ có D1 Read/Write cho database này.
4. Tạo R2 S3 key chỉ có Object Read/Write cho bucket này.
5. Thay `https://your-project.vercel.app` trong `infrastructure/r2-cors.json`
   bằng production origin, rồi áp dụng ở R2 > bucket > Settings > CORS Policy.

Mẫu CORS có thêm `http://localhost:3000`; xóa origin đó nếu không cần test local.

### Nâng cấp kho đang chạy

Nếu D1 đã có migration `0000` và `0001`, chạy riêng nội dung
`drizzle/0002_amazing_whizzer.sql` **trước** khi deploy code mới. Migration này
chỉ thêm metadata ảnh bìa và backfill kích thước reservation; không xóa sách cũ.
Tính năng tự lấy trang đầu PDF không cần migration hay Environment Variable mới,
và nút xóa sách cũng không cần Environment Variable mới.

### Cập nhật trình đọc mobile cho kho đang chạy

Không cần migration D1 hoặc Environment Variable mới. Tuy nhiên phải áp dụng lại
toàn bộ `infrastructure/r2-cors.json` trong R2 > bucket > Settings > CORS Policy
sau khi thay URL mẫu bằng đúng URL Vercel Production. Cấu hình mới cho phép
request header `Range` và cho trình duyệt đọc `Accept-Ranges`, `Content-Range`,
`Content-Length`; thiếu bước này PDF có thể không mở hoặc phải tải cả tệp.
Phiên bản có nút download còn cần `Content-Disposition` trong `AllowedHeaders`;
hãy dán lại toàn bộ file CORS mới thay vì chỉ sửa từng dòng.

## Thêm nhạc nền

1. Đổi tên file của bạn thành chính xác `background.mp3`.
2. Chép file vào `public/audio/background.mp3`.
3. Commit và push lên GitHub để Vercel deploy lại.

Không cần D1 migration hoặc Environment Variable. Nhạc mặc định tắt vì trình
duyệt mobile thường chặn âm thanh autoplay; người đọc bấm nút `♪` để bật/tắt.
Nên nén MP3 ở 96–160 kbps và chỉ dùng nhạc bạn có quyền phát/chia sẻ.

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
hard quota, cost budget, security headers/CORS, đóng gói PDF.js worker/font và
luồng xóa/cascade/cập nhật dung lượng. Test trình đọc còn kiểm tra không dùng
`iframe`, chỉ render theo trang, có giới hạn canvas, tắt annotation/XFA và không
lộ quota qua catalog public. Bộ test cũng kiểm tra fit toàn trang, tên download
được làm sạch, upload header do server sinh và nhạc không autoplay/tải từ ngoài.

## Giới hạn và chi phí

- Public-read nghĩa là người có URL có thể đọc và chia sẻ lại presigned URL khi
  URL đó còn hiệu lực.
- `robots.txt` không phải access control. Nếu URL bị phát tán, cần chuyển sang
  invite-only hoặc bổ sung rate limiting/WAF ở lớp Vercel để chống scraping/L7 DDoS.
- Strict-free MVP không có antivirus server-side. Chủ kho phải quét tệp lạ trên
  máy trước khi upload; không mở upload cho bạn bè nếu chưa có quarantine + AV.
- Bìa tự động chỉ áp dụng khi upload PDF mới. Sách cũ không có bìa cần được tải
  lại; PDF hỏng hoặc có mật khẩu sẽ dùng bìa mặc định và không chặn việc upload.
- Việc đọc PDF diễn ra trong trình duyệt. Trình đọc dùng HTTP Range, tắt prefetch
  toàn tệp và chỉ render một trang để giảm RAM; một số PDF có cấu trúc bất thường
  vẫn có thể cần tải thêm nhiều đoạn. Luồng tạo bìa của tệp gần 100 MiB có thể
  dùng nhiều bộ nhớ trên thiết bị quản trị, vì vậy nên upload bằng desktop.
- Khi bấm tải PDF, Blob được tạo trong trình duyệt để hỗ trợ cả sách cũ. File gần
  100 MiB có thể cần thêm khoảng 100 MiB RAM trong lúc chuẩn bị lưu; điện thoại
  rất cũ có thể tải chậm hoặc bị trình duyệt dừng tab.
- Fit toàn trang bảo đảm không cắt mép nhưng chữ có thể nhỏ trên màn hình hẹp;
  chọn `Vừa rộng` hoặc tăng zoom khi cần đọc chữ lớn hơn.
- Guard trong ứng dụng giảm nguy cơ vượt free tier nhưng không thể cam kết `$0`
  tuyệt đối khi pricing/quota của nhà cung cấp thay đổi. Bật usage/billing alert.
- Xóa vĩnh viễn file R2 không thể hoàn tác; phải tải bản sao về máy trước nếu cần.
- Chưa có UI note/bookmark và backup automation. Backup chỉ được coi hợp lệ sau
  một lần restore D1/R2 thành công.
- Chỉ upload sách bạn có quyền lưu trữ và chia sẻ.

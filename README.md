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
Bạn đọc -> PWA shell -> service worker network-only cho API/PDF
Bạn đọc -> nút nhạc -> public/audio/background.mp3 cùng origin
Tuấn -> HttpOnly owner session -> upload reservation
      -> PDF.js trong trình duyệt render trang 1 thành ảnh (nếu không chọn bìa)
      -> presigned PUT sách/bìa 5 phút -> R2 -> finalize -> D1 publish
Tuấn -> xác nhận đúng tên sách -> owner-only DELETE -> R2 + D1 + quota + audit
Tuấn -> dashboard vận hành -> D1 health + R2 health + orphan report read-only
Tuấn -> terminal local -> D1 export + R2 full backup -> restore test
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
- Nhạc nền là MP3 tĩnh cùng origin, `preload=none`; website thử bật mặc định nhưng
  tuân theo autoplay policy của trình duyệt và luôn có nút tắt. CSP không cho tải
  media từ domain ngoài.
- Bạn đọc không nhận thống kê dung lượng R2 trong HTML hoặc API catalog công khai;
  quota chỉ được truy vấn và hiển thị khi phiên owner hợp lệ.
- Dashboard vận hành chỉ xuất hiện trong quota panel của admin. Health check chạy
  thủ công; orphan scan chỉ đọc `books/` và `covers/`, phân trang, có grace period
  một giờ và không có API tự xóa.
- Full backup D1 + R2 được tải về máy admin, có SHA-256 từng file và phải restore
  SQL thành công vào SQLite tạm trước khi được coi là hợp lệ.
- PWA cài được trên desktop/mobile nhưng service worker không dùng Cache Storage
  cho PDF, signed content route hay response API.
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

Kiểm tra trước khi push:

```bash
npm run lint
npm test
npm run security:audit
```

## Khởi tạo Cloudflare

1. Tạo D1 database và chạy lần lượt:
   `drizzle/0000_tearful_wasp.sql`, `drizzle/0001_colossal_misty_knight.sql`,
   `drizzle/0002_amazing_whizzer.sql`, `drizzle/0003_fast_yellow_claw.sql`.
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

### Công cụ PDF và chỉnh metadata

Phiên bản này không cần migration D1, biến môi trường hay thay đổi CORS mới:

- mở một PDF rồi bấm **Công cụ** để xem mục lục nhúng, tìm chữ, tạo bookmark
  và ghi chú;
- nút **↗** tạo link có `?page=N`, nên người nhận mở đúng trang đang đọc;
- bookmark và ghi chú chỉ lưu trong `localStorage` của đúng trình duyệt/thiết bị,
  không đồng bộ và có thể mất khi xóa dữ liệu website;
- PDF scan chỉ gồm ảnh sẽ không tìm được chữ nếu chưa OCR;
- khi đăng nhập admin, nút **✎** trên mỗi sách cho phép sửa tiêu đề, tác giả và
  mô tả; hai tab sửa đồng thời được bảo vệ bằng version conflict;
- upload mới bị chặn trước R2 nếu SHA-256 trùng hoàn toàn với một sách đã có.

Phát hiện trùng chỉ nhận ra hai tệp có byte giống hệt nhau. Hai bản PDF của cùng
một sách nhưng được scan, nén hoặc chỉnh metadata khác nhau vẫn có checksum khác.
Chi tiết kiến trúc và threat model nằm ở
`docs/phase-reader-tools-and-metadata.md`.

### Tags và chỉnh sửa sách

Trước khi deploy phiên bản này lên kho đang chạy, mở D1 Console và Execute đúng
một câu SQL sau (không nhập tên file):

```sql
ALTER TABLE `books` ADD `tags_json` text DEFAULT '[]' NOT NULL;
```

Sau đó mới push code để Vercel deploy. Sách cũ được gán danh sách tags rỗng,
không bị xóa hay đổi file. Khi đăng nhập admin, nút **✎** cho phép sửa tên sách,
tác giả, tags và mô tả. Tags cách nhau bằng dấu phẩy, tối đa 10 tags và 32 ký tự
mỗi tag; người đọc có thể tìm sách theo tag. Chi tiết thiết kế nằm ở
`docs/phase-default-music-and-tags.md`.

## Giai đoạn vận hành

Phiên bản này không cần migration D1, Environment Variable Vercel hay thay đổi
R2 CORS mới. Sau khi deploy và đăng nhập admin, ở khung **Dung lượng an toàn**
bấm **Kiểm tra vận hành**:

- **Sức khỏe hệ thống** kiểm tra D1, R2, quota metadata, reservation hết hạn và
  sách đang chờ xóa. Không có polling nền; mỗi lần mở/chạm kiểm tra mới phát sinh
  request.
- **Quét R2** đọc tối đa 1.000 object mỗi trang trong hai prefix `books/` và
  `covers/`. Object không có tham chiếu nhưng mới dưới một giờ được bảo vệ bởi
  grace period. Kết quả chỉ là candidate để kiểm tra; website không tự xóa.

### Tạo full backup về máy

Đảm bảo ổ đĩa còn hơn dung lượng kho (hiện dự kiến trên 8 GB), dùng ổ được mã hóa
nếu có thể, rồi:

1. Không upload, sửa hoặc xóa sách trong suốt quá trình.
2. Mở Git Bash tại thư mục project.
3. Chạy:

```bash
npm run ops:backup
```

Mặc định backup nằm trong `backups/<thời-gian>/` và bị `.gitignore` loại khỏi
Git. Cuối lệnh sẽ in đúng đường dẫn. Tiếp theo chạy verify với đường dẫn đó, ví dụ:

```bash
npm run ops:verify-backup -- backups/20260723T120000Z
```

Chỉ khi terminal in `RESTORE TEST ĐẠT` thì backup mới hợp lệ. Verify thực hiện:

- SHA-256 và kích thước của SQL/từng object;
- khôi phục `database.sql` vào một SQLite in-memory mới;
- `integrity_check` và `foreign_key_check`;
- đối chiếu quota và mọi PDF/bìa mà bảng `books` tham chiếu.

Nên chạy mỗi tuần, trước migration và trước khi xóa nhiều sách; sau đó sao chép
thư mục backup sang ổ thứ hai. Không upload thư mục này vào GitHub/Vercel.

### Restore khi có sự cố

Nếu chỉ D1 bị sửa/xóa nhầm và sự cố còn trong cửa sổ Time Travel, ưu tiên
Cloudflare D1 Time Travel. Theo tài liệu hiện tại Free plan giữ 7 ngày; hãy tạo
bookmark hiện trạng trước khi restore vì thao tác này sửa database tại chỗ.

Full restore được cố ý khóa, chỉ chạy vào một D1 database **mới, trống** và một
R2 bucket Standard **mới, trống**:

1. Tạo `.env.restore.local` từ `.env.example`.
2. Chỉ điền ID/token/key của D1 và R2 target mới; không điền target production.
3. Chạy:

```bash
BOOK_OPS_ENV_FILE=.env.restore.local npm run ops:restore -- backups/20260723T120000Z --confirm-empty-target
```

Script verify backup trước, dừng nếu một trong hai target không trống, upload R2,
import D1 rồi so số sách. Nếu giữa chừng thất bại, xóa target thử nghiệm và tạo
target trống mới thay vì cố ghi đè. Chưa đổi Vercel Environment Variables ngay;
trước hết trỏ một Preview an toàn vào target, chạy health check và mở thử nhiều
PDF. Restore thật trên tài khoản của bạn chưa được thực hiện:
**Không đủ dữ liệu để xác minh.**

### Cài PWA

- Android/Chrome: mở website bằng HTTPS, menu trình duyệt → **Cài đặt ứng dụng**.
- iPhone/iPad/Safari: nút Share → **Add to Home Screen**.
- Desktop Chrome/Edge: chọn biểu tượng cài đặt ở thanh địa chỉ nếu trình duyệt
  hiển thị.

PWA này không phải reader offline. PDF/API luôn đi qua network và vẫn tuân theo
signed URL + `no-store`; service worker không tự lưu file sách vào Cache Storage.
Chi tiết kiến trúc, STRIDE, CIA và runbook ở `docs/phase-operations.md`.

## Thêm nhạc nền

1. Đổi tên file của bạn thành chính xác `background.mp3`.
2. Chép file vào `public/audio/background.mp3`.
3. Commit và push lên GitHub để Vercel deploy lại.

Không cần Environment Variable cho nhạc. Nhạc mặc định bật và website sẽ thử
phát khi mở trang. Chrome/Safari có thể chặn âm thanh trước lần chạm đầu tiên;
khi đó nút `♪` hiện “Chạm để bật nhạc”. Người đọc vẫn có thể tắt, và lựa chọn
được nhớ trên trình duyệt đó. Nên nén MP3 ở 96–160 kbps và chỉ dùng nhạc bạn có
quyền phát/chia sẻ.

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
được làm sạch, upload header do server sinh, PWA network-only cho PDF/API, quyền
truy cập operations API và restore test/tamper detection của backup.

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
- Backup là lệnh thủ công về máy, không phải lịch chạy tự động. Local restore test
  kiểm tra tính dùng được của backup; restore Cloudflare target thật vẫn phải được
  diễn tập định kỳ và kiểm tra bằng cách mở sách.
- Health rate limit tại Vercel là best-effort theo từng instance; endpoint vẫn
  được bảo vệ bằng owner session và same-origin. Orphan scan còn có D1 rate limit
  và hard budget Class A ở lớp ứng dụng.
- Chỉ upload sách bạn có quyền lưu trữ và chia sẻ.

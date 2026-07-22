# Giai đoạn: nhạc mặc định bật và tags sách

## 1. Phân tích yêu cầu và phạm vi

- Nhạc nền có trạng thái mong muốn mặc định là bật khi người dùng chưa từng chọn.
- Người dùng vẫn có nút tắt/bật; lựa chọn được lưu cục bộ trên trình duyệt.
- Chỉ admin được sửa tên sách, tác giả, tags và mô tả hiện có.
- Tags được lưu bền vững trong D1, hiển thị trên thẻ sách và tham gia tìm kiếm.
- Không thay tệp PDF/TXT, ảnh bìa, ID hoặc link đọc khi sửa metadata.

Ngoài phạm vi: playlist, upload nhạc qua dashboard, phân quyền nhiều admin,
taxonomy tags chuẩn hóa và đồng bộ cài đặt nhạc giữa nhiều thiết bị.

## 2. Kiến trúc được chọn

Giữ modular monolith hiện tại:

```text
Browser music preference (localStorage)
        |
        v
BackgroundMusic -> /audio/background.mp3 (Vercel static asset)

Admin edit form -> PATCH /api/v1/books/:id
        -> authentication + owner authorization + same-origin + rate limit
        -> metadata validation
        -> parameterized optimistic UPDATE
        -> D1 books.tags_json + audit_logs
        -> refreshed LibraryBook -> public cards/search
```

Tags được lưu bằng `books.tags_json TEXT NOT NULL DEFAULT '[]'`. Với một kho cá
nhân, cách này cho phép cập nhật tên/tác giả/mô tả/tags nguyên tử trong một câu
SQL và một `version`. Bảng `tags`/`book_tags` sẽ phù hợp hơn nếu sau này cần
thống kê hàng triệu quan hệ, alias hoặc trang taxonomy; hiện tại đó là
over-engineering và làm tăng số round-trip D1.

Trade-off: tìm kiếm tag dùng `LIKE` trên JSON nên không tận dụng index. Giới hạn
200 sách/truy vấn hiện tại đủ cho MVP; cần chuyển sang bảng chuẩn hóa hoặc search
engine khi số sách/traffic khiến p95 truy vấn tăng đáng kể.

## 3. Thiết kế dữ liệu và API

Migration cộng thêm, không xóa hay viết lại dữ liệu cũ:

```sql
ALTER TABLE `books` ADD `tags_json` text DEFAULT '[]' NOT NULL;
```

Contract `PATCH /api/v1/books/:id`:

```json
{
  "title": "Tên sách",
  "author": "Tác giả",
  "description": "Mô tả hoặc null",
  "tags": ["Cơ sở dữ liệu", "Backend"],
  "expectedVersion": 3
}
```

Validation server: tên 1..160 ký tự; tác giả 1..120; mô tả tối đa 2.000; tối
đa 10 tags, mỗi tag tối đa 32 ký tự, chuẩn hóa khoảng trắng và loại trùng không
phân biệt hoa thường. Client validation chỉ hỗ trợ trải nghiệm, không phải ranh
giới tin cậy.

## 4. Threat model và bảo mật

| Threat | Bề mặt | Kiểm soát | Residual risk |
|---|---|---|---|
| Spoofing / elevation | PATCH metadata | session HttpOnly/Secure/SameSite, owner-only | thiết bị admin bị chiếm quyền |
| CSRF | PATCH | same-origin bắt buộc, cookie SameSite | lỗ hổng cùng origin |
| SQL injection | title/author/tags | câu SQL parameterized | lỗi thư viện/runtime chưa biết |
| Stored XSS | metadata/tags | bỏ control characters, giới hạn input, React render text, CSP, không `innerHTML` | extension trình duyệt độc hại |
| Tampering / lost update | hai tab cùng sửa | `expectedVersion`, `WHERE version = ?`, trả 409 | admin phải tải lại khi conflict |
| DoS / data amplification | payload/tags/search | body 16 KiB, giới hạn tags, rate limit, list 200 | tìm kiếm `%LIKE%` không dùng index |
| Repudiation | sửa metadata | audit actor/action/target/version/tag count | audit cùng D1, chưa immutable ngoài hệ thống |
| Privacy | music preference | chỉ lưu boolean cục bộ, không gửi server | xóa browser data làm mất lựa chọn |

Không đưa giá trị tags vào audit để tránh log dữ liệu không cần thiết; chỉ ghi số
lượng và độ dài metadata.

## 5. Hành vi autoplay

Âm thanh có tiếng thường bị trình duyệt chặn nếu chưa có tương tác. Ứng dụng sẽ
thử `audio.play()` khi preference mặc định là bật, xử lý Promise bị từ chối và
hiện nút “Chạm để bật nhạc”. Không lặp retry nền và không cố vượt chính sách của
trình duyệt. Khi người dùng tắt, giá trị `false` được lưu và lần sau không tự phát.

Khả năng autoplay cụ thể trên thiết bị/trình duyệt của người dùng: **Không đủ dữ
liệu để xác minh.**

## 6. Triển khai, rollback và kiểm thử

Thứ tự production bắt buộc:

1. Chạy migration cộng cột `tags_json` trên D1 production.
2. Push code và để Vercel build/deploy.
3. Đăng nhập admin, sửa tags một sách, tải lại và thử tìm theo tag.
4. Mở cửa sổ ẩn danh để kiểm tra fallback autoplay; tắt nhạc rồi tải lại để kiểm
   tra preference.

Rollback code an toàn sau migration vì cột mới có mặc định và code cũ bỏ qua nó.
Không cần rollback schema. Nếu deploy code trước migration, truy vấn `tags_json`
sẽ lỗi; vì vậy migration phải chạy trước.

Test bắt buộc: parser tags; migration/backfill; owner/same-origin/rate limit;
parameterized/versioned update; React text-only rendering; music default enabled,
preference persistence và autoplay rejection fallback; lint, build và dependency
audit.

## 7. Reflection trước code

- Giữ modular monolith, không thêm service hay database mới.
- Giữ metadata và file ở hai concern riêng; sửa metadata không đổi R2.
- Không hứa autoplay có tiếng hoạt động trên mọi máy.
- Migration additive, dữ liệu sách cũ nhận `[]` và không mất dữ liệu.
- Authorization và validation ở server; không tin input client.
- Tags có giới hạn để bảo vệ D1/UI và được render dưới dạng text.

## 8. Security review và reflection sau triển khai

Kết quả xác minh ngày 22/07/2026:

- `npm run lint`: pass.
- Production build Next.js: pass.
- 47/47 automated tests: pass.
- Migration được chạy trên SQLite in-memory với một sách cũ: `tags_json` nhận
  `[]`, `NOT NULL` được cưỡng chế và không mất dữ liệu.
- Header runtime: CSP production không có `unsafe-eval`; `media-src 'self'`,
  `autoplay=(self)`, HSTS, nosniff, deny framing và no-store đều hiện diện.
- `npm audit --omit=dev --audit-level=high`: không có high/critical. Còn 2
  moderate từ PostCSS nằm bên trong Next.js, upstream báo chưa có bản vá. Ứng
  dụng không nhận hay stringify CSS do người dùng cung cấp, nên attack path của
  advisory không được expose; residual risk được ghi nhận và phải theo dõi bản
  cập nhật Next.js.

Reflection checklist:

- [x] Requirement và phạm vi được phân biệt.
- [x] Kiến trúc/data/API được thiết kế trước code.
- [x] STRIDE cho PATCH, tags và music preference đã được xét.
- [x] Owner authorization, same-origin, rate limit và optimistic lock còn nguyên.
- [x] Tags được validation tại server, SQL parameterized và React render text.
- [x] Migration additive có backfill/test/rollback order rõ ràng.
- [x] Autoplay failure được xử lý trung thực, không cố vượt browser policy.
- [x] Lint, build, unit/integration/security/migration tests đã pass.
- [x] Production security headers đã được kiểm tra trực tiếp.
- [x] Không thêm service, secret hoặc chi phí cloud mới.
- [x] Residual risk và thông tin không thể xác minh đã được ghi rõ.

## 9. Tài liệu chính thức đã đối chiếu

- MDN, Autoplay guide: <https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay>
- Cloudflare D1 migrations: <https://developers.cloudflare.com/d1/reference/migrations/>
- Drizzle migrations: <https://orm.drizzle.team/docs/migrations>

# Giai đoạn: công cụ đọc PDF và quản trị metadata

## 1. Phân tích yêu cầu và phạm vi

Giai đoạn này bổ sung sáu khả năng:

1. đọc mục lục nhúng trong PDF;
2. tìm chuỗi văn bản trong PDF;
3. chia sẻ URL mở đúng trang;
4. bookmark và ghi chú lưu cục bộ theo từng sách;
5. chủ thư viện chỉnh tiêu đề, tác giả và mô tả;
6. phát hiện tệp sách trùng bằng SHA-256 trước khi tải lên R2.

Mục lục, tìm kiếm, deep link, bookmark và ghi chú chỉ áp dụng cho PDF trong giai
đoạn này. Bookmark/ghi chú không đồng bộ giữa thiết bị, không được coi là bản sao
lưu bền vững và có thể mất khi người dùng xóa dữ liệu trình duyệt. Chỉnh metadata
và phát hiện trùng áp dụng cho cả PDF lẫn TXT.

Không thêm tài khoản bạn đọc, search engine, OCR, worker nền hay dịch vụ trả phí.
Không đủ dữ liệu để xác minh khả năng trích xuất văn bản của từng PDF cụ thể;
PDF scan chỉ có ảnh sẽ không tìm kiếm được nếu chưa OCR.

## 2. Kiến trúc được chọn

Hệ thống tiếp tục là modular monolith trên Next.js/Vercel:

- `PdfReader` giữ vòng đời PDF.js, trang hiện tại và canvas.
- module reader tools chuyển outline thành trang, tìm kiếm có giới hạn và quản lý
  dữ liệu local đã kiểm tra schema.
- URL `?page=N` là locator công khai; tiến độ local chỉ là fallback khi URL không
  chứa trang hợp lệ.
- API `PATCH /api/v1/books/:id` là ranh giới ghi metadata, chỉ dành cho owner.
- repository thực hiện optimistic locking bằng cột `books.version` đã tồn tại.
- upload reservation kiểm tra `books.checksum_sha256` và reservation đang hoạt
  động trước khi cấp signed PUT URL.

Không cần bảng mới, biến môi trường mới hay migration D1 mới. Việc không thêm
index checksum là chủ ý cho kho cá nhân nhỏ: tránh thêm thao tác migration chỉ để
tối ưu một truy vấn owner-only lúc upload. Khi số sách tăng đến hàng chục nghìn,
có thể thêm index `(checksum_sha256, status, deleted_at)`.

## 3. Luồng dữ liệu và trust boundary

### Reader

R2 private -> signed GET -> PDF.js worker -> outline/text page -> React text nodes.

Nội dung mục lục, đoạn trích tìm kiếm và ghi chú không bao giờ được đưa vào
`innerHTML`. Search chỉ chạy khi người đọc yêu cầu, xử lý tuần tự, có thể hủy theo
request id và dừng ở giới hạn kết quả. Link outline bên ngoài không được mở.

### Metadata

Admin form -> same-origin PATCH -> owner session -> validation/rate limit -> D1
conditional UPDATE (`version = expectedVersion`) -> audit log -> sanitized JSON.

### Duplicate

File local -> SHA-256 trong trình duyệt -> owner-only upload reservation API -> D1
exact checksum lookup -> chỉ khi không trùng mới reserve quota và tạo signed URL.

## 4. Threat model rút gọn

| Threat | Bề mặt | Giảm thiểu | Rủi ro còn lại |
| --- | --- | --- | --- |
| Spoofing/CSRF | PATCH metadata | owner cookie, same-origin bắt buộc, Secure/HttpOnly/SameSite session | thiết bị admin đã bị chiếm quyền |
| IDOR/Elevation | `/books/:id` | owner check trước truy vấn, UUID validation, deny by default | lỗi trong lớp session ngoài phạm vi phase |
| Tampering/race | hai tab sửa cùng sách | `expectedVersion`, conditional update, trả 409 khi xung đột | admin phải tải lại dữ liệu mới |
| XSS | title, outline, snippet, note | giới hạn/chuẩn hóa input, React text rendering, CSP, không `innerHTML` | extension trình duyệt có đặc quyền |
| DoS | PDF có rất nhiều trang/text/outline | không index trước, giới hạn query/kết quả/snippet/outline/local records, hủy tác vụ cũ | PDF cực lớn vẫn có thể làm thiết bị yếu chậm |
| Information disclosure | local notes | chỉ localStorage của origin, không gửi server/analytics | người dùng chung profile trình duyệt có thể đọc |
| Repudiation | sửa metadata | audit action, actor, target, request id, version trước/sau | audit nằm cùng D1, chưa immutable external |
| Duplicate race | hai reservation đồng thời | kiểm tra book đã publish và reservation chưa hết hạn | race rất nhỏ vẫn có thể lọt vì chưa unique index |

## 5. Thiết kế API

### `PATCH /api/v1/books/:id`

- Authentication/authorization: owner.
- CSRF: Origin phải đúng origin của request.
- Request JSON tối đa 16 KiB:
  `{ title, author, description, tags, expectedVersion }`.
- Validation: title 1..160, author 1..120, description 0..2000, tối đa 10 tags
  với 32 ký tự/tag,
  `expectedVersion` là số nguyên dương.
- Rate limit: 60 lần/10 phút/admin.
- Success: `200 { data: LibraryBook }`.
- Errors: 403, 404, 409 version conflict, 415, 422, 429, 500; không stack trace.

### `POST /api/v1/books/upload`

Giữ contract cũ. Có thể trả thêm `409 DUPLICATE_BOOK` kèm `existingBookId` và
tên sách đã tồn tại. Checksum không được phản hồi.

## 6. Dữ liệu local

Key: `reader-local-data:v1:<book UUID>`.

Payload phiên bản 1 gồm bookmark và note. Loader kiểm tra từng field, loại bản
ghi sai schema, giới hạn tối đa 200 bookmark, 200 note và 2.000 ký tự/note. Ghi
localStorage được bọc `try/catch`; lỗi quota không làm hỏng reader.

## 7. Triển khai và kiểm thử

Không thay đổi R2 CORS, D1 schema hay Vercel Environment Variables. Deploy theo
luồng GitHub -> Vercel hiện tại.

Kiểm thử bắt buộc:

- unit cho parse/clamp local data, normalize search và deep-link page;
- integration bằng SQLite cho duplicate lookup và optimistic update semantics;
- source/security test cho owner, same-origin, UUID, validation, rate limit,
  audit, không `innerHTML`;
- production build và ESLint;
- manual mobile: outline drawer, search cancellation, swipe, URL page, reload,
  bookmark/note, clipboard/share fallback;
- manual admin: edit thành công, hai tab gây 409, duplicate bị chặn trước R2.

## 8. Reflection trước code

- Dùng PDF.js hiện có nên không thêm supply-chain dependency.
- Client-side search phù hợp kho cá nhân và giữ chi phí 0 USD, đổi lại PDF scan
  không OCR và tài liệu dài tìm chậm hơn search index server.
- Local bookmark/note đúng phạm vi nhưng không phải backup.
- Optimistic locking dùng cột sẵn có, tránh lost update mà không cần migration.
- Exact SHA-256 là tín hiệu trùng mạnh nhưng không phát hiện nội dung tương đương
  sau khi file bị nén/chỉnh metadata.
- Không cam kết an toàn tuyệt đối; các giới hạn giảm thiểu chứ không loại bỏ hoàn
  toàn PDF gây tốn tài nguyên trên thiết bị yếu.

## 9. Dependency security review

Ngày 22/07/2026, audit phát hiện `sharp 0.34.5` gián tiếp từ Next.js chịu ảnh
hưởng của GHSA-f88m-g3jw-g9cj. Dự án đặt Next Image ở chế độ `unoptimized` để
không giải mã ảnh upload trên server, đồng thời override `sharp` lên `0.35.3` đã
vá và nâng Next/React lên patch mới nhất tại thời điểm kiểm tra. PostCSS gián
tiếp từ Next vẫn có advisory mức moderate không có fix tương thích do Next pin
phiên bản; ứng dụng không nhận CSS do người dùng kiểm soát.

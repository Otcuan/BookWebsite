# Giai đoạn vận hành — thiết kế trước khi triển khai

Ngày xác minh tài liệu: 2026-07-23.

## 1. Phân tích yêu cầu và phạm vi

### Functional requirements

- Admin có thể chạy health check thủ công và xem trạng thái D1, R2, quota,
  tính nhất quán dữ liệu và các tác vụ xóa còn dang dở.
- Admin có thể quét hai namespace do ứng dụng quản lý là `books/` và `covers/`
  để tìm object R2 không còn được D1 hoặc phiên upload đang hiệu lực tham chiếu.
- Có công cụ dòng lệnh tạo full backup D1 + R2 về máy cá nhân, kiểm tra checksum,
  diễn tập restore cục bộ và restore sang hạ tầng Cloudflare trống.
- Website cài đặt được như PWA. Service worker không được lưu PDF, nội dung sách
  hoặc response API trong Cache Storage.

### Non-functional requirements

- Giữ mô hình modular monolith hiện tại và không thêm dịch vụ trả phí.
- Không nhân đôi hơn 8 GB sách vào một R2 bucket thứ hai vì có thể vượt free
  storage. Full backup mặc định nằm ngoài cloud, trên máy/ổ đĩa của chủ kho.
- Health check không polling nền. Orphan scan chỉ chạy theo yêu cầu để tiết kiệm
  D1/R2 operations.
- Mỗi trang quét R2 tối đa 1.000 object, có phân trang và giới hạn tổng số trang
  ở client để không tạo vòng lặp chi phí ngoài ý muốn.
- Không tiết lộ object key, quota hoặc lỗi hạ tầng cho bạn đọc.

### Security and operational requirements

- Mọi API vận hành: owner-only, same-origin fail-closed, rate limit, `no-store`.
- Orphan detector là read-only, không tự xóa object.
- Object mới không được báo là orphan nguy hiểm trong thời gian grace period một
  giờ, tránh xóa nhầm upload đang hoàn tất hoặc dữ liệu vừa restore.
- Backup không chứa API token, S3 secret, owner password hash hoặc session secret.
- Restore cloud chỉ cho phép target D1/R2 trống và cần cờ xác nhận rõ ràng.
- Backup chỉ được công nhận khi `ops:verify-backup` phục hồi SQL vào SQLite tạm,
  chạy integrity/foreign-key check và đối chiếu mọi object đang được sách tham
  chiếu.

### Giả định và giới hạn

- Kho chỉ có một admin nên có thể tạm ngừng upload, sửa và xóa sách trong lúc tạo
  full backup. Nếu vẫn có ghi đồng thời, snapshot D1 và R2 có thể lệch nhau.
- R2 bucket chỉ dùng Standard storage class. Strict `$0` không thể được cam kết
  tuyệt đối vì pricing/quota nhà cung cấp có thể thay đổi.
- D1 Time Travel hiện luôn bật, Free plan giữ lịch sử 7 ngày; cần xác minh lại
  trong Cloudflare Dashboard trước mỗi sự cố. Trạng thái billing/backend thực tế
  của tài khoản hiện tại: **Không đủ dữ liệu để xác minh.**
- RPO/RTO dưới đây là mục tiêu vận hành cho project cá nhân, không phải SLA.

## 2. Phạm vi MVP vận hành

Trong phạm vi:

- Full backup thủ công về local.
- Verify + local restore test không chạm production.
- Cloud restore có guard sang target trống.
- Health dashboard admin-only.
- Orphan report theo trang, hai prefix ứng dụng quản lý.
- PWA installable nhưng không offline-cache PDF/API.

Ngoài phạm vi:

- Cron/queue, email alert, SIEM, multi-region, hot standby.
- Tự động xóa orphan.
- Backup cloud thứ hai hoặc continuous R2 replication.
- Offline reader; DRM; antivirus cloud.

## 3. Kiến trúc được chọn

Giữ modular monolith. Bốn năng lực vận hành là module mới nhưng dùng chung auth,
database adapter và R2 adapter hiện có.

```text
Admin browser
  ├─ POST health ──> Next.js admin API ──> D1 query + R2 HeadBucket
  ├─ POST orphans ─> Next.js admin API ──> D1 references + R2 ListObjectsV2
  └─ install PWA ──> manifest + service worker (network-only cho API/PDF)

Admin terminal
  ├─ backup ───────> D1 Export API + R2 GetObject ──> local backup directory
  ├─ verify ───────> checksum + SQLite in-memory restore + reference check
  └─ restore ──────> empty target R2 PutObject + empty target D1 Import API
```

### Trust boundaries

1. Public Internet ↔ Vercel: dữ liệu client không tin cậy.
2. Owner cookie ↔ admin APIs: bắt buộc auth + same-origin + rate limit.
3. Vercel ↔ Cloudflare API: credentials chỉ ở server.
4. Admin terminal ↔ local backup: thư mục backup chứa toàn bộ sách, phải được
   bảo vệ như dữ liệu gốc.
5. Service worker ↔ browser cache: PDF/API bị loại trừ hoàn toàn khỏi Cache
   Storage để tránh lưu bản riêng tư lâu hơn signed URL.

### Bottleneck và trade-off

- Quét 100.000 object cần khoảng 100 ListObjects requests. Đây là Class A
  operation, nên chỉ quét thủ công và hiển thị tiến độ.
- Health check thêm một D1 request và một R2 HeadBucket request; không polling.
- Backup hơn 8 GB phụ thuộc băng thông và dung lượng local, nhưng không tiêu thụ
  thêm R2 storage. GetObject/egress theo chính sách R2 hiện tại không tính phí
  egress; operation vẫn phải theo dõi.
- Restore upload lại toàn bộ object, tốn thời gian và Class A operations. Đổi lại,
  guard target trống giảm nguy cơ ghi đè production.

## 4. Threat model STRIDE

| STRIDE | Asset / attack surface | Khả năng | Ảnh hưởng | Giảm thiểu | Residual risk |
|---|---|---:|---:|---|---|
| Spoofing | Admin health/orphan API | Trung bình | Cao | Signed HttpOnly owner cookie, `SameSite=Strict`, same-origin, owner RBAC | Thiết bị admin/session bị chiếm |
| Tampering | Backup files/manifest | Trung bình | Cao | SHA-256 từng file và SQL; schema validation; restore test | Kẻ kiểm soát cả file và manifest có thể thay cả hai |
| Repudiation | Lần chạy health/orphan | Thấp | Vừa | Audit log chỉ lưu action, outcome, count; không lưu secret/object list | Audit D1 có thể bị admin DB sửa |
| Information disclosure | Object key, quota, lỗi Cloudflare | Trung bình | Cao | Owner-only POST, `no-store`, lỗi tổng quát, không log credentials | Admin browser extension có quyền đọc trang |
| Denial of Service | Lặp health/orphan scan | Trung bình | Vừa | Rate limit, manual-only, 1.000 object/page, client page cap, timeout | Owner có thể chủ động dùng hết quota operation |
| Elevation of privilege | Bạn đọc gọi API vận hành | Trung bình | Cao | Deny-by-default, kiểm auth ở server, không dựa vào UI | Lỗi auth/session tương lai |
| Tampering | Restore vào production nhầm | Thấp | Rất cao | Chỉ target trống, explicit confirm flag, verify trước upload/import | Chọn nhầm một target thật sự trống vẫn có thể là sai môi trường |
| Information disclosure | Local full backup | Trung bình | Rất cao | Không chứa secret; hướng dẫn mã hóa ổ đĩa và quyền filesystem | Máy cá nhân bị mất/malware |
| Denial of Service | Service worker cache file lớn | Thấp | Cao | Không gọi Cache Storage; mọi API/book content đi thẳng network | Browser HTTP cache vẫn tuân theo server/cache headers |

## 5. Thiết kế bảo mật và CIA

### Confidentiality

- Backup giữ local; không commit; `/backups/` bị gitignore.
- API operations chỉ trả summary và object key orphan cho owner.
- Không đưa token vào manifest/log/UI.
- PDF/content API vẫn `private, no-store`; service worker không cache.

Kiểm thử: unauthenticated API = 401; cross-origin = 403; static scan xác nhận
`sw.js` không gọi `caches.open`, `cache.put` hoặc `CacheStorage`.

Theo dõi: số lần denied/rate-limited, audit action, lỗi tải object backup.

### Integrity

- Manifest có schema version, backup ID, timestamp UTC, D1 bookmark, SHA-256 và
  byte size cho SQL/từng object.
- Verify restore SQL vào SQLite riêng, chạy `PRAGMA integrity_check`,
  `PRAGMA foreign_key_check`, kiểm required tables, storage quota và object
  reference.
- Restore cloud luôn verify trước, preserve MIME/disposition và kiểm target.

Kiểm thử: sửa một byte phải làm verify fail; thiếu object đang được book tham
chiếu phải fail; SQL hỏng hoặc FK sai phải fail.

Theo dõi: lần backup/verify gần nhất do admin tự lưu trong runbook; exit code khác
0 là thất bại.

### Availability

- Health dùng `Promise.allSettled`: D1 hỏng vẫn trả được trạng thái R2 và ngược
  lại; lỗi được cô lập.
- Backup local + D1 Time Travel là hai lớp recovery khác nhau.
- Không polling và không cache PDF giúp tránh tăng operation/storage vô hạn.

Kiểm thử: mock một dependency fail; dashboard vẫn render component còn lại. Chạy
local restore test sau mỗi thay đổi schema.

Theo dõi: D1/R2 latency, quota used, consistency mismatch, expired reservation,
deletion pending, số orphan candidate.

## 6. Thiết kế dữ liệu

Không cần migration mới. Health đọc aggregate từ:

- `storage_usage`: giá trị quota do ứng dụng quản lý.
- `books`: tổng byte thực tế theo metadata, số sách, deletion pending.
- `upload_reservations`: reservation hiệu lực/hết hạn.

Orphan reference set gồm:

- `books.object_key` và `books.cover_object_key`, kể cả bản ghi deletion pending;
- reservation `status='reserved'` và chưa hết hạn.

Không dùng `deleted_at` để loại reference trước khi xóa R2 hoàn tất, tránh báo/xóa
nhầm object thuộc tác vụ đang retry.

Backup manifest không nằm trong database:

```text
manifestVersion, backupId, createdAt, source
d1: file, sizeBytes, sha256, bookmark
objects[]: key, localFile, sizeBytes, sha256, contentType, contentDisposition
```

`localFile` là tên tuần tự do script tạo, không suy ra từ object key; như vậy
object key độc hại không thể path traversal trên máy backup.

## 7. Thiết kế API

### `POST /api/v1/admin/operations/health`

- Authentication: owner session.
- Authorization: owner role; deny by default.
- Request: không có body.
- Response: overall status, timestamp, D1/R2 status + latency, quota và consistency
  summary.
- Validation: same-origin; rate limit 12 lần/5 phút.
- Cache: `private, no-store`.
- Errors: `401`, `403`, `429`; dependency lỗi nằm trong component status, không
  trả stack trace.

### `POST /api/v1/admin/operations/orphans`

- Authentication/authorization: owner.
- Request:

```json
{"prefix":"books/","continuationToken":"optional"}
```

- Validation: JSON, body size nhỏ, prefix allowlist `books/|covers/`, token giới
  hạn độ dài và không có control characters.
- Response: tối đa một page R2, `nextContinuationToken`, total scanned của page,
  candidates đã qua grace period và unreferenced còn trẻ.
- Rate limit: 60 page/15 phút.
- Không có DELETE endpoint trong phase này.

## 8. Backup/restore runbook

### Mục tiêu

- D1 Time Travel: RPO gần phút trong cửa sổ 7 ngày Free theo tài liệu hiện tại.
- Full local backup: RPO tối đa 7 ngày nếu chạy mỗi tuần; chạy thêm trước migration
  hoặc bulk delete.
- RTO mục tiêu: dưới 4 giờ cho kho cá nhân nếu đã có backup đã verify, target
  Cloudflare sẵn sàng và mạng đủ nhanh.

### Tạo và kiểm tra backup

1. Tạm dừng mọi upload/sửa/xóa.
2. Chạy `npm run ops:backup -- --output <thư-mục>`.
3. Script liên tục poll D1 export tới khi hoàn tất, sau đó tải toàn bộ R2.
4. Chạy `npm run ops:verify-backup -- <thư-mục>`.
5. Chỉ khi exit code 0 mới đánh dấu backup hợp lệ.
6. Sao chép thư mục sang ổ đĩa thứ hai được mã hóa; không commit Git.

### Restore

- Sự cố D1 gần đây, R2 không mất: ưu tiên D1 Time Travel và ghi lại bookmark trước
  restore vì thao tác in-place/destructive.
- Full disaster: tạo D1 database và R2 bucket Standard **mới, trống**, tạo
  credentials giới hạn đúng target; tạo `.env.restore.local` riêng; chạy:

```bash
BOOK_OPS_ENV_FILE=.env.restore.local npm run ops:restore -- <thư-mục> --confirm-empty-target
```

- Sau restore: chạy health check, orphan scan, đọc thử nhiều PDF và chỉ đổi
  Vercel env sang target mới khi kiểm thử đạt.
- Restore production thực tế chưa được chạy trong môi trường người dùng:
  **Không đủ dữ liệu để xác minh.**

## 9. PWA và cache policy

- `app/manifest.ts` khai báo tên, màu, icon, display `standalone`.
- Service worker chỉ đảm nhiệm lifecycle để trình duyệt nhận diện PWA.
- Với `/api/*` và đặc biệt `/api/v1/books/:id/content`, handler gọi network trực
  tiếp. Không tạo cache và không có offline fallback PDF.
- Các request còn lại không bị service worker intercept; browser dùng HTTP cache
  policy bình thường.
- `/sw.js` có `Content-Type: application/javascript`, `Cache-Control:
  no-cache, no-store, must-revalidate`, CSP chặt và `Service-Worker-Allowed: /`.

## 10. Kế hoạch triển khai và kiểm thử

1. Thêm operations repository + R2 list/head adapter.
2. Thêm hai route admin, audit và validation/rate limit.
3. Thêm modal health/orphan trong dashboard; chỉ render cho owner.
4. Thêm backup/verify/restore CLI và hướng dẫn.
5. Thêm manifest, icons, registration, service worker network-only.
6. Chạy unit/security tests, production build, lint, dependency audit.
7. Tạo fixture backup, khôi phục SQL cục bộ và chủ động tamper checksum để bảo đảm
   verify từ chối.

## 11. Nguồn chính thức đã kiểm tra

- Cloudflare D1 Time Travel:
  <https://developers.cloudflare.com/d1/reference/time-travel/>
- Cloudflare D1 import/export:
  <https://developers.cloudflare.com/d1/best-practices/import-export-data/>
- Cloudflare D1 API export/import:
  <https://developers.cloudflare.com/api/resources/d1/subresources/database/>
- Cloudflare R2 pricing và operation classes:
  <https://developers.cloudflare.com/r2/pricing/>
- AWS S3 ListObjectsV2:
  <https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html>
- Next.js PWA guide:
  <https://nextjs.org/docs/app/guides/progressive-web-apps>
- MDN Service Worker:
  <https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers>

## 12. Architecture reflection gate

- [x] Phân biệt functional/non-functional/security/operational requirements.
- [x] Xác định scope strict-free, không over-engineering.
- [x] Có component/trust boundary/data flow/bottleneck.
- [x] Có STRIDE và residual risk.
- [x] Ánh xạ Confidentiality/Integrity/Availability.
- [x] Có data/API/deployment/runbook trước code.
- [x] Có RPO/RTO và restore test bắt buộc.
- [x] Orphan detector read-only, grace period, pagination.
- [x] PWA không cache PDF/API.
- [x] Ghi rõ giả định và dữ liệu chưa thể xác minh.

## 13. Security review và reflection sau triển khai

Kết quả kiểm tra trong môi trường phát triển:

- `npm run build`: đạt; manifest được sinh tại `/manifest.webmanifest`, hai API
  operations là dynamic server routes.
- `npm run lint`: đạt, không có lint error/warning.
- `npm test`: 59/59 test đạt.
- Restore test tạo D1 dump thật trong fixture, khôi phục vào SQLite in-memory,
  chạy integrity/FK/reference/quota check: đạt.
- Tamper test đổi riêng object và đổi đồng thời object + hash trong manifest:
  đều bị từ chối nhờ checksum file và checksum metadata trong D1.
- `npm run security:audit`: không có high/critical; còn 2 moderate từ PostCSS
  transitive bên trong Next.js và npm báo chưa có bản sửa tương thích.

Review thủ công:

- [x] Code chỉ bắt đầu sau requirement/scope/architecture/STRIDE/CIA/data/API/runbook.
- [x] Backup stream từng object, không nạp hơn 8 GB vào RAM.
- [x] Backup directory/file dùng quyền local hạn chế khi hệ điều hành hỗ trợ.
- [x] Manifest không chứa credential/session/password hash.
- [x] Manifest path allowlist chặn path traversal.
- [x] Restore verify trước, cần cờ xác nhận và từ chối D1/R2 target không trống.
- [x] D1 empty check bỏ qua riêng internal table `_cf_*`, không bỏ qua application
  table.
- [x] Orphan API không có delete path, chỉ cho hai prefix và bảo vệ object mới
  trong một giờ.
- [x] Books đang chờ xóa và reservation còn hiệu lực vẫn được tính là reference.
- [x] API operations owner-only, same-origin fail-closed, rate-limited và no-store.
- [x] Object key chỉ xuất hiện trong response/UI admin.
- [x] Service worker không gọi `caches.open`, `cache.put` hoặc `caches.match`;
  API/PDF được fetch với `cache: "no-store"`.
- [x] Không thêm migration, paid service, cron hoặc cloud copy gây vượt 10 GB.
- [x] Đã sửa so sánh ISO reservation bằng SQLite `datetime(...)`, tránh reservation
  hết hạn bị giữ nhầm.
- [x] Đã có RPO/RTO, backup retention suggestion và restore runbook.
- [x] Đã nêu residual risk, giới hạn rate limit serverless và strict `$0`.

Chưa thể kiểm tra từ workspace này:

- Full backup hơn 8 GB từ đúng R2/D1 của người dùng.
- Cloud restore vào một D1/R2 target thật.
- Header/service worker và UI operations sau lần deploy Vercel của người dùng.
- Mức sử dụng Free plan/billing hiện tại của tài khoản Cloudflare.

Đối với các mục trên: **Không đủ dữ liệu để xác minh.** Cần chạy runbook trên
tài khoản của người dùng sau khi deploy; không được coi cloud restore là đã diễn
tập chỉ dựa trên unit test.

import type { Viewer } from "@/lib/authz";
import type { D1DatabaseLike } from "@/lib/d1-http";
import {
  MAX_COVER_BYTES,
  MAX_UPLOAD_BYTES,
  safeSlug,
} from "@/lib/file-security";
import {
  createPresignedPutUrl,
  deleteR2Object,
  getR2Prefix,
  headR2Object,
} from "@/lib/r2-s3";
import { getDatabase } from "@/lib/runtime";
import {
  consumeMonthlyBudget,
  R2_CLASS_A_MONTHLY_APP_LIMIT,
} from "@/lib/cost-budget";

export type LibraryBook = {
  id: string;
  slug: string;
  title: string;
  author: string;
  description: string | null;
  format: "PDF" | "TXT";
  mimeType: string;
  sizeBytes: number;
  coverUrl: string | null;
  coverSizeBytes: number;
  storageBytes: number;
  progress: number;
  locator: string | null;
  progressVersion: number;
  updatedAt: string;
  deletionPending: boolean;
};

export type StorageStats = {
  committedBytes: number;
  reservedBytes: number;
  hardLimitBytes: number;
};

export type UploadReservation = {
  reservationId: string;
  uploadUrl: string;
  coverUploadUrl: string | null;
  expiresAt: string;
};

type BookRow = {
  id: string;
  slug: string;
  title: string;
  author: string;
  description: string | null;
  format: "pdf" | "txt";
  mime_type: string;
  size_bytes: number;
  cover_object_key: string | null;
  cover_size_bytes: number | null;
  updated_at: string;
  deleted_at: string | null;
};

type DeletableBookRow = {
  id: string;
  title: string;
  object_key: string;
  cover_object_key: string | null;
  size_bytes: number;
  cover_size_bytes: number | null;
};

type ReservationRow = {
  id: string;
  principal_email: string;
  book_id: string | null;
  object_key: string | null;
  title: string | null;
  author: string | null;
  description: string | null;
  format: "pdf" | "txt" | null;
  mime_type: string | null;
  checksum_sha256: string | null;
  book_size_bytes: number | null;
  cover_object_key: string | null;
  cover_mime_type: string | null;
  cover_size_bytes: number | null;
  cover_checksum_sha256: string | null;
  reserved_bytes: number;
  status: "reserved" | "committed" | "released";
  expires_at: string;
};

export class StorageQuotaError extends Error {}
export class FreeTierBudgetError extends Error {}
export class UploadReservationError extends Error {}
export class UploadedObjectError extends Error {}
export class BookNotFoundError extends Error {}
export class BookDeletionPendingError extends Error {}

export async function listPublishedBooks(
  query = "",
  options: { includeDeletionPending?: boolean } = {},
): Promise<LibraryBook[]> {
  const DB = getDatabase();
  const search = `%${escapeLike(query.trim().toLowerCase())}%`;
  const result = await DB.prepare(
    `SELECT id, slug, title, author, description, format,
            mime_type, size_bytes, cover_object_key, cover_size_bytes,
            updated_at, deleted_at
     FROM books
     WHERE status = 'published'
       AND (deleted_at IS NULL OR ? = 1)
       AND (? = '%%' OR lower(title) LIKE ? ESCAPE '\\'
            OR lower(author) LIKE ? ESCAPE '\\')
     ORDER BY updated_at DESC
     LIMIT 200`,
  )
    .bind(options.includeDeletionPending ? 1 : 0, search, search, search)
    .all<BookRow>();

  return (result.results ?? []).map(mapBookRow);
}

export async function getPublishedBook(bookId: string): Promise<LibraryBook | null> {
  const DB = getDatabase();
  const row = await DB.prepare(
    `SELECT id, slug, title, author, description, format,
            mime_type, size_bytes, cover_object_key, cover_size_bytes,
            updated_at, deleted_at
     FROM books
     WHERE id = ? AND status = 'published' AND deleted_at IS NULL
     LIMIT 1`,
  )
    .bind(bookId)
    .first<BookRow>();
  return row ? mapBookRow(row) : null;
}

export async function getStorageStats(): Promise<StorageStats> {
  const DB = getDatabase();
  const row = await DB.prepare(
    `SELECT committed_bytes, reserved_bytes, hard_limit_bytes
     FROM storage_usage WHERE id = 1`,
  ).first<{
    committed_bytes: number;
    reserved_bytes: number;
    hard_limit_bytes: number;
  }>();

  if (!row) throw new Error("Storage usage has not been initialized.");
  return {
    committedBytes: row.committed_bytes,
    reservedBytes: row.reserved_bytes,
    hardLimitBytes: row.hard_limit_bytes,
  };
}

export async function deleteBookPermanently(input: {
  viewer: Viewer;
  bookId: string;
  requestId: string;
}): Promise<{
  id: string;
  title: string;
  freedBytes: number;
  storage: StorageStats;
}> {
  const DB = getDatabase();
  const book = await DB.prepare(
    `UPDATE books
     SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'published'
     RETURNING id, title, object_key, cover_object_key,
               size_bytes, cover_size_bytes`,
  )
    .bind(input.bookId)
    .first<DeletableBookRow>();

  if (!book) {
    throw new BookNotFoundError("Không tìm thấy sách cần xóa.");
  }

  const objectKeys = [book.cover_object_key, book.object_key].filter(
    (key): key is string => Boolean(key),
  );
  const objectDeletions = await Promise.allSettled(
    objectKeys.map((objectKey) => deleteR2Object(objectKey)),
  );
  const failedObjects = objectDeletions.filter(
    (result) => result.status === "rejected",
  ).length;

  if (failedObjects > 0) {
    await writeAudit(DB, {
      actorEmail: input.viewer.email,
      action: "book.delete",
      targetType: "book",
      targetId: book.id,
      outcome: "failure",
      requestId: input.requestId,
      metadata: { failedObjects, deletionPending: 1 },
    }).catch(() => undefined);
    throw new BookDeletionPendingError(
      "Sách đã được ẩn nhưng chưa xóa hết tệp khỏi R2. Hãy thử lại.",
    );
  }

  const storageBytes = book.size_bytes + (book.cover_size_bytes ?? 0);
  let freedBytes = 0;
  try {
    const results = await DB.batch([
      DB.prepare(
        `UPDATE storage_usage
         SET committed_bytes = MAX(0, committed_bytes - ?),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = 1
           AND EXISTS (SELECT 1 FROM books
                       WHERE id = ? AND deleted_at IS NOT NULL)`,
      ).bind(storageBytes, book.id),
      DB.prepare(
        `DELETE FROM upload_reservations WHERE book_id = ?`,
      ).bind(book.id),
      DB.prepare(
        `DELETE FROM books WHERE id = ? AND deleted_at IS NOT NULL`,
      ).bind(book.id),
      auditStatement(DB, {
        actorEmail: input.viewer.email,
        action: "book.delete",
        targetType: "book",
        targetId: book.id,
        outcome: "success",
        requestId: input.requestId,
        metadata: {
          storageBytes,
          coverDeleted: book.cover_object_key ? 1 : 0,
        },
      }),
    ]);
    freedBytes = (results[2]?.meta.changes ?? 0) === 1 ? storageBytes : 0;
  } catch {
    await writeAudit(DB, {
      actorEmail: input.viewer.email,
      action: "book.delete",
      targetType: "book",
      targetId: book.id,
      outcome: "failure",
      requestId: input.requestId,
      metadata: { databaseFinalizeFailed: 1, deletionPending: 1 },
    }).catch(() => undefined);
    throw new BookDeletionPendingError(
      "Tệp đã được xóa nhưng D1 chưa hoàn tất cập nhật. Hãy thử lại.",
    );
  }

  return {
    id: book.id,
    title: book.title,
    freedBytes,
    storage: await getStorageStats(),
  };
}

export async function createUploadReservation(input: {
  viewer: Viewer;
  title: string;
  author: string;
  description: string | null;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  sha256: string;
  cover: {
    fileName: string;
    sizeBytes: number;
    mimeType: string;
    sha256: string;
  } | null;
  requestId: string;
}): Promise<UploadReservation> {
  const DB = getDatabase();
  const file = validateUploadMetadata(input);
  const cover = input.cover ? validateCoverMetadata(input.cover) : null;
  const totalBytes = input.sizeBytes + (input.cover?.sizeBytes ?? 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) {
    throw new UploadedObjectError("Tổng kích thước tệp không hợp lệ.");
  }
  const bookId = crypto.randomUUID();
  const reservationId = crypto.randomUUID();
  const objectKey = `books/${bookId}.${file.format}`;
  const coverObjectKey = cover ? `covers/${bookId}.${cover.extension}` : null;
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

  const operationBudgetAvailable = await consumeMonthlyBudget({
    metric: "r2_class_a",
    amount: cover ? 3 : 2,
    hardLimit: R2_CLASS_A_MONTHLY_APP_LIMIT,
  });
  if (!operationBudgetAvailable) {
    throw new FreeTierBudgetError(
      "Đã chạm ngân sách thao tác R2 an toàn của tháng này.",
    );
  }

  await releaseExpiredReservations();
  try {
    await DB.batch([
      DB.prepare(
        `UPDATE storage_usage
         SET reserved_bytes = reserved_bytes + ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = 1`,
      ).bind(totalBytes),
      DB.prepare(
        `INSERT INTO upload_reservations
           (id, principal_email, book_id, object_key, title, author, description,
            format, mime_type, checksum_sha256, book_size_bytes,
            cover_object_key, cover_mime_type, cover_size_bytes, cover_checksum_sha256,
            reserved_bytes, status, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?)`,
      ).bind(
        reservationId,
        input.viewer.email,
        bookId,
        objectKey,
        input.title,
        input.author,
        input.description,
        file.format,
        file.mimeType,
        input.sha256,
        input.sizeBytes,
        coverObjectKey,
        cover?.mimeType ?? null,
        input.cover?.sizeBytes ?? null,
        input.cover?.sha256 ?? null,
        totalBytes,
        expiresAt,
      ),
    ]);
  } catch (error) {
    if (isConstraintError(error)) {
      throw new StorageQuotaError(
        "Không đủ dung lượng trong hard quota 9 GB để nhận tệp này.",
      );
    }
    throw error;
  }

  try {
    const [uploadUrl, coverUploadUrl] = await Promise.all([
      createPresignedPutUrl({
        objectKey,
        mimeType: file.mimeType,
        expiresIn: 300,
      }),
      coverObjectKey && cover
        ? createPresignedPutUrl({
            objectKey: coverObjectKey,
            mimeType: cover.mimeType,
            expiresIn: 300,
          })
        : Promise.resolve(null),
    ]);
    await writeAudit(DB, {
      actorEmail: input.viewer.email,
      action: "book.upload_reserved",
      targetType: "upload_reservation",
      targetId: reservationId,
      outcome: "success",
      requestId: input.requestId,
      metadata: {
        bookSizeBytes: input.sizeBytes,
        coverSizeBytes: input.cover?.sizeBytes ?? 0,
        storageBytes: totalBytes,
        format: file.format,
      },
    });
    return { reservationId, uploadUrl, coverUploadUrl, expiresAt };
  } catch (error) {
    await releaseReservation(reservationId, totalBytes);
    throw error;
  }
}

export async function finalizeUpload(input: {
  viewer: Viewer;
  reservationId: string;
  requestId: string;
}): Promise<LibraryBook> {
  const DB = getDatabase();
  const reservation = await DB.prepare(
    `SELECT id, principal_email, book_id, object_key, title, author, description,
            format, mime_type, checksum_sha256, book_size_bytes,
            cover_object_key, cover_mime_type, cover_size_bytes, cover_checksum_sha256,
            reserved_bytes, status, expires_at
     FROM upload_reservations
     WHERE id = ? AND principal_email = ?
     LIMIT 1`,
  )
    .bind(input.reservationId, input.viewer.email)
    .first<ReservationRow>();

  if (!reservation || reservation.status !== "reserved") {
    throw new UploadReservationError("Phiên tải lên không tồn tại hoặc đã hoàn tất.");
  }
  if (Date.parse(reservation.expires_at) <= Date.now()) {
    await deleteReservationObjects(reservation);
    await releaseReservation(reservation.id, reservation.reserved_bytes);
    throw new UploadReservationError("Phiên tải lên đã hết hạn.");
  }
  if (!hasCompleteReservation(reservation)) {
    await deleteReservationObjects(reservation);
    await releaseReservation(reservation.id, reservation.reserved_bytes);
    throw new UploadReservationError("Phiên tải lên thiếu metadata bắt buộc.");
  }

  try {
    await validateStoredObject(reservation);
  } catch (error) {
    await deleteReservationObjects(reservation);
    await releaseReservation(reservation.id, reservation.reserved_bytes);
    throw error;
  }

  const slug = `${safeSlug(reservation.title)}-${reservation.book_id.slice(0, 8)}`;
  try {
    const results = await DB.batch([
      DB.prepare(
        `INSERT INTO books
          (id, slug, title, author, description, format, mime_type, size_bytes,
           object_key, checksum_sha256, cover_object_key, cover_mime_type,
           cover_size_bytes, cover_checksum_sha256, status, created_by_email, published_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, CURRENT_TIMESTAMP
         FROM upload_reservations
         WHERE id = ? AND principal_email = ? AND status = 'reserved'`,
      ).bind(
        reservation.book_id,
        slug,
        reservation.title,
        reservation.author,
        reservation.description,
        reservation.format,
        reservation.mime_type,
        reservation.book_size_bytes,
        reservation.object_key,
        reservation.checksum_sha256,
        reservation.cover_object_key,
        reservation.cover_mime_type,
        reservation.cover_size_bytes,
        reservation.cover_checksum_sha256,
        input.viewer.email,
        reservation.id,
        input.viewer.email,
      ),
      DB.prepare(
        `UPDATE storage_usage
         SET reserved_bytes = reserved_bytes - ?,
             committed_bytes = committed_bytes + ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = 1
           AND EXISTS (SELECT 1 FROM upload_reservations
                       WHERE id = ? AND status = 'reserved')`,
      ).bind(reservation.reserved_bytes, reservation.reserved_bytes, reservation.id),
      DB.prepare(
        `UPDATE upload_reservations
         SET status = 'committed', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'reserved'`,
      ).bind(reservation.id),
      auditStatement(DB, {
        actorEmail: input.viewer.email,
        action: "book.upload",
        targetType: "book",
        targetId: reservation.book_id,
        outcome: "success",
        requestId: input.requestId,
        metadata: {
          bookSizeBytes: reservation.book_size_bytes,
          coverSizeBytes: reservation.cover_size_bytes ?? 0,
          storageBytes: reservation.reserved_bytes,
          format: reservation.format,
        },
      }),
    ]);
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      const existing = await getPublishedBook(reservation.book_id);
      if (existing) return existing;
      throw new UploadReservationError("Phiên tải lên không còn khả dụng.");
    }
  } catch (error) {
    const existing = await getPublishedBook(reservation.book_id).catch(() => null);
    if (existing) return existing;
    await deleteReservationObjects(reservation);
    await releaseReservation(reservation.id, reservation.reserved_bytes);
    throw error;
  }

  return {
    id: reservation.book_id,
    slug,
    title: reservation.title,
    author: reservation.author,
    description: reservation.description,
    format: reservation.format.toUpperCase() as "PDF" | "TXT",
    mimeType: reservation.mime_type,
    sizeBytes: reservation.book_size_bytes,
    coverUrl: reservation.cover_object_key
      ? `/api/v1/books/${reservation.book_id}/cover`
      : null,
    coverSizeBytes: reservation.cover_size_bytes ?? 0,
    storageBytes: reservation.reserved_bytes,
    progress: 0,
    locator: null,
    progressVersion: 0,
    updatedAt: new Date().toISOString(),
    deletionPending: false,
  };
}

export async function getBookObject(bookId: string): Promise<{
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  title: string;
} | null> {
  const DB = getDatabase();
  return DB.prepare(
    `SELECT object_key AS objectKey, mime_type AS mimeType,
            size_bytes AS sizeBytes, title
     FROM books
     WHERE id = ? AND status = 'published' AND deleted_at IS NULL
     LIMIT 1`,
  )
    .bind(bookId)
    .first();
}

export async function getBookCoverObject(bookId: string): Promise<{
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
} | null> {
  const DB = getDatabase();
  return DB.prepare(
    `SELECT cover_object_key AS objectKey, cover_mime_type AS mimeType,
            cover_size_bytes AS sizeBytes
     FROM books
     WHERE id = ? AND status = 'published' AND deleted_at IS NULL
       AND cover_object_key IS NOT NULL
       AND cover_mime_type IS NOT NULL
       AND cover_size_bytes IS NOT NULL
     LIMIT 1`,
  )
    .bind(bookId)
    .first();
}

async function validateStoredObject(reservation: ReservationRow & {
  book_id: string;
  object_key: string;
  title: string;
  author: string;
  format: "pdf" | "txt";
  mime_type: string;
  checksum_sha256: string;
  book_size_bytes: number;
}) {
  let head: Awaited<ReturnType<typeof headR2Object>>;
  try {
    head = await headR2Object(reservation.object_key);
  } catch {
    throw new UploadedObjectError("Không tìm thấy tệp đã tải lên R2.");
  }
  const storedMime = head.mimeType?.split(";", 1)[0]?.toLowerCase();
  if (head.sizeBytes !== reservation.book_size_bytes || storedMime !== reservation.mime_type) {
    throw new UploadedObjectError("Kích thước hoặc MIME của tệp trên R2 không khớp.");
  }

  const prefix = await getR2Prefix(reservation.object_key);
  if (reservation.format === "pdf") {
    if (
      prefix.byteLength < 5 ||
      prefix[0] !== 0x25 ||
      prefix[1] !== 0x50 ||
      prefix[2] !== 0x44 ||
      prefix[3] !== 0x46 ||
      prefix[4] !== 0x2d
    ) {
      throw new UploadedObjectError("Tệp PDF không có chữ ký %PDF- hợp lệ.");
    }
  } else {
    if (prefix.some((value) => value === 0)) {
      throw new UploadedObjectError("Tệp TXT chứa byte NUL không an toàn.");
    }
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(prefix);
    } catch {
      throw new UploadedObjectError("Tệp TXT không phải UTF-8 hợp lệ.");
    }
  }

  await validateStoredCoverObject(reservation);
}

async function validateStoredCoverObject(reservation: ReservationRow) {
  if (!reservation.cover_object_key) return;
  if (
    !reservation.cover_mime_type ||
    !reservation.cover_size_bytes ||
    !reservation.cover_checksum_sha256
  ) {
    throw new UploadedObjectError("Metadata ảnh bìa không đầy đủ.");
  }

  let head: Awaited<ReturnType<typeof headR2Object>>;
  try {
    head = await headR2Object(reservation.cover_object_key);
  } catch {
    throw new UploadedObjectError("Không tìm thấy ảnh bìa đã tải lên R2.");
  }
  const storedMime = head.mimeType?.split(";", 1)[0]?.toLowerCase();
  if (
    head.sizeBytes !== reservation.cover_size_bytes ||
    storedMime !== reservation.cover_mime_type
  ) {
    throw new UploadedObjectError("Kích thước hoặc MIME của ảnh bìa trên R2 không khớp.");
  }

  const prefix = await getR2Prefix(reservation.cover_object_key);
  const validSignature =
    (reservation.cover_mime_type === "image/jpeg" && hasJpegSignature(prefix)) ||
    (reservation.cover_mime_type === "image/png" && hasPngSignature(prefix)) ||
    (reservation.cover_mime_type === "image/webp" && hasWebpSignature(prefix));
  if (!validSignature) {
    throw new UploadedObjectError("Ảnh bìa không có chữ ký JPG, PNG hoặc WebP hợp lệ.");
  }
}

async function deleteReservationObjects(reservation: {
  object_key: string | null;
  cover_object_key: string | null;
}) {
  await Promise.all([
    reservation.object_key
      ? deleteR2Object(reservation.object_key).catch(() => undefined)
      : Promise.resolve(),
    reservation.cover_object_key
      ? deleteR2Object(reservation.cover_object_key).catch(() => undefined)
      : Promise.resolve(),
  ]);
}

async function releaseReservation(reservationId: string, size: number) {
  const DB = getDatabase();
  await DB.batch([
    DB.prepare(
      `UPDATE storage_usage
       SET reserved_bytes = MAX(0, reserved_bytes - ?), updated_at = CURRENT_TIMESTAMP
       WHERE id = 1
         AND EXISTS (SELECT 1 FROM upload_reservations
                     WHERE id = ? AND status = 'reserved')`,
    ).bind(size, reservationId),
    DB.prepare(
      `UPDATE upload_reservations
       SET status = 'released', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'reserved'`,
    ).bind(reservationId),
  ]);
}

async function releaseExpiredReservations() {
  const DB = getDatabase();
  const expired = await DB.prepare(
    `SELECT id, object_key, cover_object_key, reserved_bytes
     FROM upload_reservations
     WHERE status = 'reserved' AND expires_at < CURRENT_TIMESTAMP
     LIMIT 100`,
  ).all<{
    id: string;
    object_key: string | null;
    cover_object_key: string | null;
    reserved_bytes: number;
  }>();

  for (const reservation of expired.results ?? []) {
    await releaseReservation(reservation.id, reservation.reserved_bytes);
    await deleteReservationObjects(reservation);
  }
}

function validateUploadMetadata(input: {
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  sha256: string;
}) {
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new UploadedObjectError("Kích thước tệp không hợp lệ.");
  }
  if (input.sizeBytes > MAX_UPLOAD_BYTES) {
    throw new UploadedObjectError("Tệp vượt quá giới hạn 100 MiB.");
  }
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) {
    throw new UploadedObjectError("Checksum SHA-256 không hợp lệ.");
  }
  const name = input.fileName.toLowerCase();
  if (name.endsWith(".pdf") && input.mimeType === "application/pdf") {
    return { format: "pdf" as const, mimeType: "application/pdf" as const };
  }
  if (
    name.endsWith(".txt") &&
    (input.mimeType === "text/plain" || input.mimeType === "")
  ) {
    return { format: "txt" as const, mimeType: "text/plain" as const };
  }
  throw new UploadedObjectError("Phần mở rộng và MIME phải là PDF hoặc TXT.");
}

function validateCoverMetadata(input: {
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  sha256: string;
}) {
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new UploadedObjectError("Kích thước ảnh bìa không hợp lệ.");
  }
  if (input.sizeBytes > MAX_COVER_BYTES) {
    throw new UploadedObjectError("Ảnh bìa vượt quá giới hạn 3 MiB.");
  }
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) {
    throw new UploadedObjectError("Checksum SHA-256 của ảnh bìa không hợp lệ.");
  }

  const name = input.fileName.toLowerCase();
  if (
    (name.endsWith(".jpg") || name.endsWith(".jpeg")) &&
    input.mimeType === "image/jpeg"
  ) {
    return { extension: "jpg" as const, mimeType: "image/jpeg" as const };
  }
  if (name.endsWith(".png") && input.mimeType === "image/png") {
    return { extension: "png" as const, mimeType: "image/png" as const };
  }
  if (name.endsWith(".webp") && input.mimeType === "image/webp") {
    return { extension: "webp" as const, mimeType: "image/webp" as const };
  }
  throw new UploadedObjectError("Ảnh bìa phải là JPG, PNG hoặc WebP hợp lệ.");
}

function hasCompleteReservation(
  row: ReservationRow,
): row is ReservationRow & {
  book_id: string;
  object_key: string;
  title: string;
  author: string;
  format: "pdf" | "txt";
  mime_type: string;
  checksum_sha256: string;
  book_size_bytes: number;
} {
  return Boolean(
    row.book_id &&
      row.object_key &&
      row.title &&
      row.author &&
      row.format &&
      row.mime_type &&
      row.checksum_sha256 &&
      row.book_size_bytes &&
      ((row.cover_object_key === null &&
        row.cover_mime_type === null &&
        row.cover_size_bytes === null &&
        row.cover_checksum_sha256 === null) ||
        (Boolean(row.cover_object_key) &&
          Boolean(row.cover_mime_type) &&
          Boolean(row.cover_size_bytes) &&
          Boolean(row.cover_checksum_sha256))),
  );
}

function hasJpegSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function hasPngSignature(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function hasWebpSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  );
}

async function writeAudit(
  DB: D1DatabaseLike,
  entry: Parameters<typeof auditStatement>[1],
) {
  await auditStatement(DB, entry).run();
}

function auditStatement(
  DB: D1DatabaseLike,
  entry: {
    actorEmail: string;
    action: string;
    targetType: string;
    targetId: string;
    outcome: "success" | "denied" | "failure";
    requestId: string;
    metadata: Record<string, string | number>;
  },
) {
  return DB.prepare(
    `INSERT INTO audit_logs
       (id, actor_email, action, target_type, target_id, outcome, request_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    entry.actorEmail,
    entry.action,
    entry.targetType,
    entry.targetId,
    entry.outcome,
    entry.requestId,
    JSON.stringify(entry.metadata),
  );
}

function mapBookRow(row: BookRow): LibraryBook {
  const deletionPending = row.deleted_at !== null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    author: row.author,
    description: row.description,
    format: row.format.toUpperCase() as "PDF" | "TXT",
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    coverUrl: row.cover_object_key && !deletionPending
      ? `/api/v1/books/${row.id}/cover`
      : null,
    coverSizeBytes: row.cover_size_bytes ?? 0,
    storageBytes: row.size_bytes + (row.cover_size_bytes ?? 0),
    progress: 0,
    locator: null,
    progressVersion: 0,
    updatedAt: row.updated_at,
    deletionPending,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function isConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("constraint") || message.includes("storage_usage_within_hard_limit");
}

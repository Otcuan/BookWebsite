import { ensureOwnerPrincipal, getViewer } from "@/lib/authz";
import { jsonError, jsonOk, requestId } from "@/lib/http";
import {
  BookDeletionPendingError,
  BookNotFoundError,
  BookVersionConflictError,
  deleteBookPermanently,
  updateBookMetadata,
} from "@/lib/library-repository";
import {
  BookMetadataValidationError,
  parseBookMetadataUpdate,
} from "@/lib/book-metadata";
import { consumeRateLimit } from "@/lib/rate-limit";
import { hasSameOrigin } from "@/lib/request-security";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const BOOK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, context: RouteContext) {
  const id = requestId(request);
  const viewer = await getViewer();
  if (!viewer.isOwner) {
    return jsonError(403, "OWNER_REQUIRED", "Chỉ chủ thư viện được sửa sách.", id);
  }
  if (!hasSameOrigin(request)) {
    return jsonError(403, "INVALID_ORIGIN", "Nguồn yêu cầu không hợp lệ.", id);
  }
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    return jsonError(415, "INVALID_CONTENT_TYPE", "Yêu cầu phải là JSON.", id);
  }
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > 16_384) {
    return jsonError(413, "PAYLOAD_TOO_LARGE", "Metadata sách quá lớn.", id);
  }

  const { id: bookId } = await context.params;
  if (!BOOK_ID_PATTERN.test(bookId)) {
    return jsonError(404, "BOOK_NOT_FOUND", "Không tìm thấy sách.", id);
  }

  try {
    await ensureOwnerPrincipal(viewer);
    const rate = await consumeRateLimit({
      principal: viewer.email,
      action: "book.metadata_update",
      limit: 60,
      windowSeconds: 10 * 60,
    });
    if (!rate.allowed) {
      const response = jsonError(
        429,
        "RATE_LIMITED",
        "Bạn đang sửa metadata quá nhanh. Hãy thử lại sau.",
        id,
        { retryAfterSeconds: rate.retryAfterSeconds },
      );
      response.headers.set("Retry-After", String(rate.retryAfterSeconds));
      return response;
    }

    const metadata = parseBookMetadataUpdate(await request.json());
    const book = await updateBookMetadata({
      viewer,
      bookId,
      ...metadata,
      requestId: id,
    });
    return jsonOk({ data: book });
  } catch (error) {
    if (error instanceof BookMetadataValidationError || error instanceof SyntaxError) {
      return jsonError(
        422,
        "VALIDATION_ERROR",
        error instanceof BookMetadataValidationError
          ? error.message
          : "JSON không hợp lệ.",
        id,
      );
    }
    if (error instanceof BookNotFoundError) {
      return jsonError(404, "BOOK_NOT_FOUND", "Không tìm thấy sách.", id);
    }
    if (error instanceof BookVersionConflictError) {
      return jsonError(
        409,
        "BOOK_VERSION_CONFLICT",
        "Sách đã được sửa ở tab khác. Hãy tải lại trang rồi thử lại.",
        id,
        { currentVersion: error.currentVersion },
      );
    }
    return jsonError(
      500,
      "BOOK_UPDATE_FAILED",
      "Không thể cập nhật sách vào lúc này.",
      id,
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const id = requestId(request);
  const viewer = await getViewer();
  if (!viewer.isOwner) {
    return jsonError(403, "OWNER_REQUIRED", "Chỉ chủ thư viện được xóa sách.", id);
  }
  if (!hasSameOrigin(request)) {
    return jsonError(403, "INVALID_ORIGIN", "Nguồn yêu cầu không hợp lệ.", id);
  }

  const { id: bookId } = await context.params;
  if (!BOOK_ID_PATTERN.test(bookId)) {
    return jsonError(404, "BOOK_NOT_FOUND", "Không tìm thấy sách.", id);
  }

  try {
    await ensureOwnerPrincipal(viewer);
    const rate = await consumeRateLimit({
      principal: viewer.email,
      action: "book.delete",
      limit: 30,
      windowSeconds: 10 * 60,
    });
    if (!rate.allowed) {
      const response = jsonError(
        429,
        "RATE_LIMITED",
        "Bạn đang xóa quá nhiều sách. Hãy thử lại sau.",
        id,
        { retryAfterSeconds: rate.retryAfterSeconds },
      );
      response.headers.set("Retry-After", String(rate.retryAfterSeconds));
      return response;
    }

    const result = await deleteBookPermanently({
      viewer,
      bookId,
      requestId: id,
    });
    return jsonOk({ data: result });
  } catch (error) {
    if (error instanceof BookNotFoundError) {
      return jsonError(404, "BOOK_NOT_FOUND", "Không tìm thấy sách.", id);
    }
    if (error instanceof BookDeletionPendingError) {
      return jsonError(
        503,
        "BOOK_DELETE_PENDING",
        error.message,
        id,
        { deletionPending: 1 },
      );
    }
    return jsonError(
      500,
      "BOOK_DELETE_FAILED",
      "Không thể xóa sách vào lúc này.",
      id,
    );
  }
}

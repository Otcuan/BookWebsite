import { ensureOwnerPrincipal, getViewer } from "@/lib/authz";
import { jsonError, jsonOk, requestId } from "@/lib/http";
import {
  createUploadReservation,
  FreeTierBudgetError,
  StorageQuotaError,
  UploadedObjectError,
} from "@/lib/library-repository";
import { consumeRateLimit } from "@/lib/rate-limit";
import { hasSameOrigin } from "@/lib/request-security";

export const dynamic = "force-dynamic";

type UploadRequest = {
  title?: unknown;
  author?: unknown;
  description?: unknown;
  fileName?: unknown;
  sizeBytes?: unknown;
  mimeType?: unknown;
  sha256?: unknown;
  cover?: unknown;
};

type CoverUploadRequest = {
  fileName?: unknown;
  sizeBytes?: unknown;
  mimeType?: unknown;
  sha256?: unknown;
};

export async function POST(request: Request) {
  const id = requestId(request);
  const viewer = await getViewer();
  if (!viewer.isOwner) {
    return jsonError(403, "OWNER_REQUIRED", "Chỉ chủ thư viện được tải sách.", id);
  }
  if (!hasSameOrigin(request)) {
    return jsonError(403, "INVALID_ORIGIN", "Nguồn yêu cầu không hợp lệ.", id);
  }
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    return jsonError(415, "INVALID_CONTENT_TYPE", "Yêu cầu phải là JSON.", id);
  }
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > 16_384) {
    return jsonError(413, "PAYLOAD_TOO_LARGE", "Metadata tải lên quá lớn.", id);
  }

  try {
    await ensureOwnerPrincipal(viewer);
    const rate = await consumeRateLimit({
      principal: viewer.email,
      action: "book.upload",
      limit: 12,
      windowSeconds: 10 * 60,
    });
    if (!rate.allowed) {
      const response = jsonError(
        429,
        "RATE_LIMITED",
        "Bạn đã tạo phiên tải lên quá nhanh. Hãy thử lại sau.",
        id,
        { retryAfterSeconds: rate.retryAfterSeconds },
      );
      response.headers.set("Retry-After", String(rate.retryAfterSeconds));
      return response;
    }

    const body = (await request.json()) as UploadRequest;
    const title = cleanText(body.title, 160);
    const author = cleanText(body.author, 120);
    const description = cleanText(body.description, 2000, true);
    const fileName = cleanText(body.fileName, 255);
    const mimeType = cleanText(body.mimeType, 100, true) ?? "";
    const sha256 = cleanText(body.sha256, 64);
    if (!title || !author || !fileName || !sha256) {
      return jsonError(
        422,
        "VALIDATION_ERROR",
        "Tên sách, tác giả và metadata tệp là bắt buộc.",
        id,
      );
    }
    const cover = parseCover(body.cover);
    if (cover === undefined) {
      return jsonError(
        422,
        "VALIDATION_ERROR",
        "Metadata ảnh bìa không đầy đủ.",
        id,
      );
    }

    const reservation = await createUploadReservation({
      viewer,
      title,
      author,
      description,
      fileName,
      sizeBytes: Number(body.sizeBytes),
      mimeType,
      sha256,
      cover,
      requestId: id,
    });
    return jsonOk({ data: reservation }, { status: 201 });
  } catch (error) {
    if (error instanceof UploadedObjectError) {
      return jsonError(422, "INVALID_FILE_METADATA", error.message, id);
    }
    if (error instanceof StorageQuotaError) {
      return jsonError(409, "STORAGE_QUOTA_EXCEEDED", error.message, id);
    }
    if (error instanceof FreeTierBudgetError) {
      return jsonError(503, "FREE_TIER_BUDGET_EXHAUSTED", error.message, id);
    }
    return jsonError(
      500,
      "UPLOAD_SESSION_FAILED",
      "Không thể tạo phiên tải lên.",
      id,
    );
  }
}

function parseCover(value: unknown): {
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  sha256: string;
} | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as CoverUploadRequest;
  const fileName = cleanText(input.fileName, 255);
  const mimeType = cleanText(input.mimeType, 100);
  const sha256 = cleanText(input.sha256, 64);
  const sizeBytes = Number(input.sizeBytes);
  if (!fileName || !mimeType || !sha256 || !Number.isSafeInteger(sizeBytes)) {
    return undefined;
  }
  return { fileName, sizeBytes, mimeType, sha256 };
}

function cleanText(value: unknown, maxLength: number, optional = false): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ");
  if (!cleaned) return optional ? null : "";
  return cleaned.slice(0, maxLength);
}

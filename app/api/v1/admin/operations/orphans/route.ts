import { recordAudit } from "@/lib/audit";
import { ensureOwnerPrincipal, getViewer } from "@/lib/authz";
import { jsonError, jsonOk, requestId } from "@/lib/http";
import {
  OperationsBudgetError,
  OperationsValidationError,
  parseOrphanScanInput,
  scanR2OrphanPage,
} from "@/lib/operations-repository";
import { consumeRateLimit } from "@/lib/rate-limit";
import { hasSameOrigin } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const MAX_BODY_CHARACTERS = 4_096;

export async function POST(request: Request) {
  const id = requestId(request);
  const viewer = await getViewer();
  if (!viewer.isOwner) {
    return jsonError(
      403,
      "OWNER_REQUIRED",
      "Chỉ chủ thư viện được quét R2.",
      id,
    );
  }
  if (!hasSameOrigin(request)) {
    return jsonError(403, "INVALID_ORIGIN", "Nguồn yêu cầu không hợp lệ.", id);
  }
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    return jsonError(415, "INVALID_CONTENT_TYPE", "Yêu cầu phải là JSON.", id);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_BODY_CHARACTERS
  ) {
    return jsonError(413, "PAYLOAD_TOO_LARGE", "Body orphan scan quá lớn.", id);
  }

  try {
    await ensureOwnerPrincipal(viewer);
    const rate = await consumeRateLimit({
      principal: viewer.email,
      action: "operations.orphan_scan",
      limit: 60,
      windowSeconds: 15 * 60,
    });
    if (!rate.allowed) {
      const response = jsonError(
        429,
        "RATE_LIMITED",
        "Đã quét quá nhiều trang R2. Hãy thử lại sau.",
        id,
        { retryAfterSeconds: rate.retryAfterSeconds },
      );
      response.headers.set("Retry-After", String(rate.retryAfterSeconds));
      return response;
    }

    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_CHARACTERS) {
      return jsonError(413, "PAYLOAD_TOO_LARGE", "Body orphan scan quá lớn.", id);
    }
    const input = parseOrphanScanInput(JSON.parse(rawBody));
    const page = await scanR2OrphanPage(input);
    await recordAudit({
      actorEmail: viewer.email,
      action: "operations.orphan_scan",
      targetType: "r2_prefix",
      targetId: page.prefix,
      outcome: "success",
      requestId: id,
      metadata: {
        scanned: page.scanned,
        candidates: page.candidates.length,
        protected: page.protectedUnreferenced.length,
        hasNextPage: Boolean(page.nextContinuationToken),
      },
    }).catch(() => undefined);
    return jsonOk({ data: page });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof OperationsValidationError) {
      return jsonError(
        422,
        "VALIDATION_ERROR",
        error instanceof OperationsValidationError
          ? error.message
          : "JSON không hợp lệ.",
        id,
      );
    }
    if (error instanceof OperationsBudgetError) {
      return jsonError(
        503,
        "FREE_TIER_BUDGET_EXHAUSTED",
        error.message,
        id,
      );
    }
    await recordAudit({
      actorEmail: viewer.email,
      action: "operations.orphan_scan",
      targetType: "r2_prefix",
      outcome: "failure",
      requestId: id,
    }).catch(() => undefined);
    return jsonError(
      500,
      "ORPHAN_SCAN_FAILED",
      "Không thể quét R2 vào lúc này.",
      id,
    );
  }
}

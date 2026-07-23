import { getViewer } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { jsonError, jsonOk, requestId } from "@/lib/http";
import { consumeLocalOperationRateLimit } from "@/lib/operation-rate-limit";
import { getOperationsHealth } from "@/lib/operations-repository";
import { hasSameOrigin } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const id = requestId(request);
  const viewer = await getViewer();
  if (!viewer.isOwner) {
    return jsonError(
      403,
      "OWNER_REQUIRED",
      "Chỉ chủ thư viện được xem trạng thái vận hành.",
      id,
    );
  }
  if (!hasSameOrigin(request)) {
    return jsonError(403, "INVALID_ORIGIN", "Nguồn yêu cầu không hợp lệ.", id);
  }

  const rate = consumeLocalOperationRateLimit({
    key: `${viewer.email}:operations.health`,
    limit: 12,
    windowSeconds: 5 * 60,
  });
  if (!rate.allowed) {
    const response = jsonError(
      429,
      "RATE_LIMITED",
      "Health check đang được chạy quá thường xuyên.",
      id,
      { retryAfterSeconds: rate.retryAfterSeconds },
    );
    response.headers.set("Retry-After", String(rate.retryAfterSeconds));
    return response;
  }

  try {
    const health = await getOperationsHealth();
    await recordAudit({
      actorEmail: viewer.email,
      action: "operations.health_check",
      targetType: "infrastructure",
      outcome: health.status === "error" ? "failure" : "success",
      requestId: id,
      metadata: {
        status: health.status,
        d1Status: health.d1.status,
        r2Status: health.r2.status,
      },
    }).catch(() => undefined);
    return jsonOk({ data: health });
  } catch {
    await recordAudit({
      actorEmail: viewer.email,
      action: "operations.health_check",
      targetType: "infrastructure",
      outcome: "failure",
      requestId: id,
    }).catch(() => undefined);
    return jsonError(
      500,
      "HEALTH_CHECK_FAILED",
      "Không thể chạy health check vào lúc này.",
      id,
    );
  }
}

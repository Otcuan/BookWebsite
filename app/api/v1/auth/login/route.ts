import { cookies } from "next/headers";
import { recordAudit } from "@/lib/audit";
import { jsonError, jsonOk, requestId } from "@/lib/http";
import {
  createOwnerSession,
  OWNER_COOKIE_NAME,
  OWNER_SESSION_SECONDS,
  verifyOwnerPassphrase,
} from "@/lib/owner-session";
import { consumeRateLimit } from "@/lib/rate-limit";
import { hasSameOrigin } from "@/lib/request-security";
import { isOwnerAuthConfigured, OWNER_PRINCIPAL_EMAIL, requiredEnv } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const id = requestId(request);
  if (!hasSameOrigin(request)) {
    return jsonError(403, "INVALID_ORIGIN", "Nguồn yêu cầu không hợp lệ.", id);
  }
  if (!isOwnerAuthConfigured()) {
    return jsonError(503, "OWNER_AUTH_NOT_CONFIGURED", "Đăng nhập chủ kho chưa được cấu hình.", id);
  }
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > 4096) {
    return jsonError(413, "PAYLOAD_TOO_LARGE", "Yêu cầu đăng nhập quá lớn.", id);
  }

  try {
    const body = (await request.json()) as { passphrase?: unknown };
    const passphrase = typeof body.passphrase === "string" ? body.passphrase : "";
    const rateKey = await anonymousRateKey(request);
    const rate = await consumeRateLimit({
      principal: rateKey,
      action: "owner.login",
      limit: 5,
      windowSeconds: 15 * 60,
    });
    if (!rate.allowed) {
      const response = jsonError(
        429,
        "RATE_LIMITED",
        "Quá nhiều lần đăng nhập. Hãy thử lại sau.",
        id,
        { retryAfterSeconds: rate.retryAfterSeconds },
      );
      response.headers.set("Retry-After", String(rate.retryAfterSeconds));
      return response;
    }

    if (!(await verifyOwnerPassphrase(passphrase))) {
      await recordAudit({
        actorEmail: null,
        action: "owner.login",
        targetType: "session",
        outcome: "denied",
        requestId: id,
        metadata: { rateKey },
      }).catch(() => undefined);
      return jsonError(401, "INVALID_CREDENTIALS", "Mật khẩu chủ kho không đúng.", id);
    }

    const cookieStore = await cookies();
    cookieStore.set(OWNER_COOKIE_NAME, await createOwnerSession(), {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: OWNER_SESSION_SECONDS,
    });
    await recordAudit({
      actorEmail: OWNER_PRINCIPAL_EMAIL,
      action: "owner.login",
      targetType: "session",
      outcome: "success",
      requestId: id,
    }).catch(() => undefined);
    return jsonOk({ data: { authenticated: true } });
  } catch {
    return jsonError(503, "LOGIN_UNAVAILABLE", "Đăng nhập tạm thời chưa khả dụng.", id);
  }
}

async function anonymousRateKey(request: Request): Promise<string> {
  const address =
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(requiredEnv("SESSION_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(address));
  return `ip:${Buffer.from(digest).toString("base64url").slice(0, 32)}`;
}

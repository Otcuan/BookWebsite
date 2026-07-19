import { cookies } from "next/headers";
import { getViewer } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { jsonError, jsonOk, requestId } from "@/lib/http";
import { OWNER_COOKIE_NAME } from "@/lib/owner-session";
import { hasSameOrigin } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const id = requestId(request);
  if (!hasSameOrigin(request)) {
    return jsonError(403, "INVALID_ORIGIN", "Nguồn yêu cầu không hợp lệ.", id);
  }
  const viewer = await getViewer();
  const cookieStore = await cookies();
  cookieStore.set(OWNER_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  if (viewer.isOwner) {
    await recordAudit({
      actorEmail: viewer.email,
      action: "owner.logout",
      targetType: "session",
      outcome: "success",
      requestId: id,
    }).catch(() => undefined);
  }
  return jsonOk({ data: { authenticated: false } });
}

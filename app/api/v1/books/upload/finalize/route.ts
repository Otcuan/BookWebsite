import { ensureOwnerPrincipal, getViewer } from "@/lib/authz";
import { jsonError, jsonOk, requestId } from "@/lib/http";
import {
  finalizeUpload,
  UploadedObjectError,
  UploadReservationError,
} from "@/lib/library-repository";
import { hasSameOrigin } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const id = requestId(request);
  const viewer = await getViewer();
  if (!viewer.isOwner) {
    return jsonError(403, "OWNER_REQUIRED", "Chỉ chủ thư viện được xuất bản sách.", id);
  }
  if (!hasSameOrigin(request)) {
    return jsonError(403, "INVALID_ORIGIN", "Nguồn yêu cầu không hợp lệ.", id);
  }

  try {
    await ensureOwnerPrincipal(viewer);
    const body = (await request.json()) as { reservationId?: unknown };
    if (typeof body.reservationId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.reservationId)) {
      return jsonError(422, "VALIDATION_ERROR", "Mã phiên tải lên không hợp lệ.", id);
    }
    const book = await finalizeUpload({
      viewer,
      reservationId: body.reservationId,
      requestId: id,
    });
    return jsonOk({ data: book }, { status: 201 });
  } catch (error) {
    if (error instanceof UploadReservationError) {
      return jsonError(409, "UPLOAD_SESSION_INVALID", error.message, id);
    }
    if (error instanceof UploadedObjectError) {
      return jsonError(422, "UPLOADED_FILE_REJECTED", error.message, id);
    }
    return jsonError(
      500,
      "UPLOAD_FINALIZE_FAILED",
      "Không thể kiểm tra và xuất bản tệp.",
      id,
    );
  }
}

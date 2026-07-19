import { jsonError, requestId } from "@/lib/http";
import { getBookCoverObject } from "@/lib/library-repository";
import { createPresignedGetUrl } from "@/lib/r2-s3";
import {
  consumeMonthlyBudget,
  R2_CLASS_B_MONTHLY_APP_LIMIT,
} from "@/lib/cost-budget";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const id = requestId(request);
  const { id: bookId } = await context.params;
  const cover = await getBookCoverObject(bookId);
  if (!cover) {
    return jsonError(404, "COVER_NOT_FOUND", "Cuốn sách chưa có ảnh bìa.", id);
  }

  const operationBudgetAvailable = await consumeMonthlyBudget({
    metric: "r2_class_b",
    hardLimit: R2_CLASS_B_MONTHLY_APP_LIMIT,
  });
  if (!operationBudgetAvailable) {
    return jsonError(
      503,
      "FREE_TIER_BUDGET_EXHAUSTED",
      "Đã chạm ngân sách đọc R2 an toàn của tháng này.",
      id,
    );
  }

  try {
    const url = await createPresignedGetUrl(cover.objectKey, 3600);
    return new Response(null, {
      status: 307,
      headers: {
        Location: url,
        "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=60",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return jsonError(503, "COVER_UNAVAILABLE", "Ảnh bìa tạm thời không khả dụng.", id);
  }
}

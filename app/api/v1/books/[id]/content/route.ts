import { jsonError, requestId } from "@/lib/http";
import { getBookObject } from "@/lib/library-repository";
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
  const book = await getBookObject(bookId);
  if (!book) return jsonError(404, "BOOK_NOT_FOUND", "Không tìm thấy sách.", id);

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
    const url = await createPresignedGetUrl(book.objectKey, 300);
    return new Response(null, {
      status: 307,
      headers: {
        Location: url,
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return jsonError(503, "BOOK_FILE_UNAVAILABLE", "Tệp sách tạm thời không khả dụng.", id);
  }
}

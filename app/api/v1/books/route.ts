import { jsonError, jsonOk, requestId } from "@/lib/http";
import { listPublishedBooks } from "@/lib/library-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = requestId(request);
  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").slice(0, 100);
    const books = await listPublishedBooks(query);
    return jsonOk({ data: books, meta: { count: books.length } });
  } catch {
    return jsonError(
      503,
      "LIBRARY_UNAVAILABLE",
      "Thư viện tạm thời chưa sẵn sàng.",
      id,
    );
  }
}

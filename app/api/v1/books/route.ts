import { jsonError, jsonOk, requestId } from "@/lib/http";
import { getStorageStats, listPublishedBooks } from "@/lib/library-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = requestId(request);
  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").slice(0, 100);
    const [books, storage] = await Promise.all([
      listPublishedBooks(query),
      getStorageStats(),
    ]);
    return jsonOk({ data: books, meta: { storage, count: books.length } });
  } catch {
    return jsonError(
      503,
      "LIBRARY_UNAVAILABLE",
      "Thư viện tạm thời chưa sẵn sàng.",
      id,
    );
  }
}

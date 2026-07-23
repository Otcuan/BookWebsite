const BOOK_CONTENT_ROUTE = /^\/api\/v1\/books\/[^/]+\/content$/;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (
    url.pathname.startsWith("/api/") ||
    BOOK_CONTENT_ROUTE.test(url.pathname) ||
    url.pathname.toLowerCase().endsWith(".pdf")
  ) {
    // Network-only: never place API responses, signed redirects or PDFs in
    // Cache Storage. Range headers and the server's no-store policy are kept.
    event.respondWith(fetch(request, { cache: "no-store" }));
  }
});

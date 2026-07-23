import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const serviceWorker = readFileSync("public/sw.js", "utf8");
const registration = readFileSync(
  "app/service-worker-registration.tsx",
  "utf8",
);
const manifest = readFileSync("app/manifest.ts", "utf8");
const nextConfig = readFileSync("next.config.ts", "utf8");

test("PWA has install metadata, icons and production-only registration", () => {
  assert.match(manifest, /display: "standalone"/);
  assert.match(manifest, /start_url: "\/"/);
  assert.equal(existsSync("public/pwa-icon-192.png"), true);
  assert.equal(existsSync("public/pwa-icon-512.png"), true);
  assert.match(registration, /process\.env\.NODE_ENV !== "production"/);
  assert.match(registration, /updateViaCache: "none"/);
});

test("service worker is network-only for API and book content", () => {
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(serviceWorker, /BOOK_CONTENT_ROUTE/);
  assert.match(serviceWorker, /endsWith\("\.pdf"\)/);
  assert.match(
    serviceWorker,
    /event\.respondWith\(fetch\(request, \{ cache: "no-store" \}\)\)/,
  );
  assert.doesNotMatch(
    serviceWorker,
    /caches\.open|cache\.put|caches\.match|CacheStorage/,
  );
});

test("service worker itself is never served from a stale cache", () => {
  assert.match(nextConfig, /source: "\/sw\.js"/);
  assert.match(nextConfig, /no-cache, no-store, must-revalidate/);
  assert.match(nextConfig, /Service-Worker-Allowed/);
  assert.match(nextConfig, /application\/javascript; charset=utf-8/);
});

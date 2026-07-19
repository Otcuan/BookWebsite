import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nextConfig = readFileSync("next.config.ts", "utf8");
const rootLayout = readFileSync("app/layout.tsx", "utf8");

test("Vercel responses declare the security header baseline", () => {
  for (const header of [
    "Content-Security-Policy",
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "X-Frame-Options",
  ]) {
    assert.match(nextConfig, new RegExp(header));
  }
  assert.match(nextConfig, /frame-ancestors 'none'/);
  assert.match(nextConfig, /object-src 'none'/);
});

test("unsafe-eval is enabled only for the React development runtime", () => {
  assert.match(nextConfig, /process\.env\.NODE_ENV === "development"/);
  assert.match(nextConfig, /\? " 'unsafe-eval'" : ""/);
});

test("root layout tolerates attributes injected by browser extensions", () => {
  assert.match(rootLayout, /<html lang="vi" suppressHydrationWarning>/);
});

test("R2 CORS is origin-scoped and never wildcarded", () => {
  const cors = JSON.parse(readFileSync("infrastructure/r2-cors.json", "utf8"));
  const rule = cors[0];
  assert.equal(rule.AllowedOrigins.includes("*"), false);
  assert.deepEqual(rule.AllowedMethods, ["GET", "PUT", "HEAD"]);
  assert.deepEqual(rule.AllowedHeaders, ["Content-Type"]);
});

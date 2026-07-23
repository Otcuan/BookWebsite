import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  consumeLocalOperationRateLimit,
  resetLocalOperationRateLimitsForTests,
} from "../lib/operation-rate-limit.ts";

const healthRoute = readFileSync(
  "app/api/v1/admin/operations/health/route.ts",
  "utf8",
);
const orphanRoute = readFileSync(
  "app/api/v1/admin/operations/orphans/route.ts",
  "utf8",
);
const operationsRepository = readFileSync(
  "lib/operations-repository.ts",
  "utf8",
);
const r2Adapter = readFileSync("lib/r2-s3.ts", "utf8");
const restoreScript = readFileSync(
  "scripts/ops/restore-library.mjs",
  "utf8",
);
const libraryRepository = readFileSync("lib/library-repository.ts", "utf8");

test("operations APIs are owner-only, same-origin, rate-limited and no-store", () => {
  for (const route of [healthRoute, orphanRoute]) {
    assert.match(route, /export async function POST/);
    assert.match(route, /!viewer\.isOwner/);
    assert.match(route, /hasSameOrigin\(request\)/);
    assert.match(route, /jsonOk|jsonError/);
  }
  assert.match(healthRoute, /consumeLocalOperationRateLimit/);
  assert.match(orphanRoute, /consumeRateLimit/);
  assert.match(orphanRoute, /MAX_BODY_CHARACTERS/);
});

test("local health limiter rejects requests over the fixed window limit", () => {
  resetLocalOperationRateLimitsForTests();
  const input = {
    key: "owner:health",
    limit: 2,
    windowSeconds: 300,
    now: 1_000,
  };
  assert.equal(consumeLocalOperationRateLimit(input).allowed, true);
  assert.equal(consumeLocalOperationRateLimit(input).allowed, true);
  assert.equal(consumeLocalOperationRateLimit(input).allowed, false);
  assert.equal(
    consumeLocalOperationRateLimit({ ...input, now: 301_001 }).allowed,
    true,
  );
});

test("orphan detection is paginated, prefix-scoped and report-only", () => {
  assert.match(r2Adapter, /ListObjectsV2Command/);
  assert.match(r2Adapter, /MaxKeys: 1_000/);
  assert.match(operationsRepository, /"books\/" \| "covers\/"/);
  assert.match(operationsRepository, /ORPHAN_GRACE_PERIOD_SECONDS = 60 \* 60/);
  assert.match(operationsRepository, /datetime\(expires_at\) > CURRENT_TIMESTAMP/);
  assert.doesNotMatch(orphanRoute, /DeleteObjectCommand|deleteR2Object/);
  assert.match(orphanRoute, /operations\.orphan_scan/);
});

test("expired ISO reservations are compared through SQLite datetime", () => {
  assert.match(
    libraryRepository,
    /datetime\(expires_at\) < CURRENT_TIMESTAMP/,
  );
  assert.match(
    libraryRepository,
    /datetime\(expires_at\) > CURRENT_TIMESTAMP/,
  );
});

test("cloud restore requires explicit confirmation and empty targets", () => {
  assert.match(restoreScript, /--confirm-empty-target/);
  assert.match(restoreScript, /assertEmptyTarget/);
  assert.match(restoreScript, /substr\(name, 1, 4\) <> '_cf_'/);
  assert.match(restoreScript, /D1 target không trống/);
  assert.match(restoreScript, /R2 target không trống/);
  assert.match(restoreScript, /verifyBackup/);
});

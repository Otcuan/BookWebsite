import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("migration initializes and enforces the strict-free storage limit", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync("drizzle/0000_tearful_wasp.sql", "utf8"));

  const usage = database
    .prepare("SELECT committed_bytes, reserved_bytes, hard_limit_bytes FROM storage_usage WHERE id = 1")
    .get();
  assert.deepEqual({ ...usage }, {
    committed_bytes: 0,
    reserved_bytes: 0,
    hard_limit_bytes: 9_000_000_000,
  });

  database.prepare("UPDATE storage_usage SET committed_bytes = ? WHERE id = 1").run(8_900_000_000);
  assert.throws(() =>
    database.prepare("UPDATE storage_usage SET reserved_bytes = ? WHERE id = 1").run(200_000_000),
  );
});

test("migration enforces normalized principals and role values", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync("drizzle/0000_tearful_wasp.sql", "utf8"));
  assert.throws(() =>
    database
      .prepare("INSERT INTO principals (email, role) VALUES (?, ?)")
      .run("Owner@Example.com", "owner"),
  );
  assert.throws(() =>
    database
      .prepare("INSERT INTO principals (email, role) VALUES (?, ?)")
      .run("owner@example.com", "administrator"),
  );
});

test("monthly cost budget cannot exceed its hard limit", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync("drizzle/0000_tearful_wasp.sql", "utf8"));
  database
    .prepare(
      "INSERT INTO cost_budgets (period, metric, count, hard_limit) VALUES (?, ?, ?, ?)",
    )
    .run("2026-07", "r2_class_b", 100_000, 100_000);
  assert.throws(() =>
    database
      .prepare("UPDATE cost_budgets SET count = count + 1 WHERE period = ? AND metric = ?")
      .run("2026-07", "r2_class_b"),
  );
});

test("direct-upload migration stores immutable reservation metadata", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync("drizzle/0000_tearful_wasp.sql", "utf8"));
  database.exec(readFileSync("drizzle/0001_colossal_misty_knight.sql", "utf8"));
  const columns = database
    .prepare("PRAGMA table_info(upload_reservations)")
    .all()
    .map((column) => column.name);
  for (const name of [
    "book_id",
    "object_key",
    "title",
    "author",
    "format",
    "mime_type",
    "checksum_sha256",
  ]) {
    assert.ok(columns.includes(name), `missing ${name}`);
  }
});

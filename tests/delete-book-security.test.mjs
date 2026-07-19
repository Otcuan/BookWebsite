import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const routeSource = readFileSync("app/api/v1/books/[id]/route.ts", "utf8");
const repositorySource = readFileSync("lib/library-repository.ts", "utf8");
const dashboardSource = readFileSync("app/library-dashboard.tsx", "utf8");

test("delete API requires owner, same-origin, a UUID and rate limiting", () => {
  assert.match(routeSource, /export async function DELETE/);
  assert.match(routeSource, /!viewer\.isOwner/);
  assert.match(routeSource, /hasSameOrigin\(request\)/);
  assert.match(routeSource, /\^\[0-9a-f\]\{8\}/);
  assert.match(routeSource, /action: "book\.delete"/);
  assert.match(routeSource, /consumeRateLimit/);
  assert.match(routeSource, /deleteBookPermanently/);
});

test("delete flow hides first, removes R2 objects, then adjusts quota atomically", () => {
  const tombstone = repositorySource.indexOf(
    "SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP)",
  );
  const objectDeletion = repositorySource.indexOf("Promise.allSettled", tombstone);
  const quotaUpdate = repositorySource.indexOf("UPDATE storage_usage", objectDeletion);
  const metadataDelete = repositorySource.indexOf("DELETE FROM books", quotaUpdate);

  assert.ok(tombstone >= 0);
  assert.ok(objectDeletion > tombstone);
  assert.ok(quotaUpdate > objectDeletion);
  assert.ok(metadataDelete > quotaUpdate);
  assert.match(repositorySource, /deleted_at IS NOT NULL/);
  assert.match(repositorySource, /DELETE FROM upload_reservations WHERE book_id = \?/);
  assert.match(repositorySource, /action: "book\.delete"/);
});

test("owner UI requires an exact title before permanent deletion", () => {
  assert.match(dashboardSource, /viewer\.isOwner/);
  assert.match(dashboardSource, /deleteConfirmation !== deleteTarget\.title/);
  assert.match(dashboardSource, /method: "DELETE"/);
  assert.match(dashboardSource, /Thao tác này không thể hoàn tác/);
});

test("metadata cleanup releases storage and cascades reader-owned rows", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of [
    "drizzle/0000_tearful_wasp.sql",
    "drizzle/0001_colossal_misty_knight.sql",
    "drizzle/0002_amazing_whizzer.sql",
  ]) {
    database.exec(readFileSync(migration, "utf8"));
  }

  const owner = "owner@library.local";
  const bookId = "11111111-1111-4111-8111-111111111111";
  database
    .prepare("INSERT INTO principals (email, role) VALUES (?, 'owner')")
    .run(owner);
  database.prepare(
    `INSERT INTO books
       (id, slug, title, author, format, mime_type, size_bytes, object_key,
        checksum_sha256, cover_object_key, cover_mime_type, cover_size_bytes,
        cover_checksum_sha256, status, created_by_email)
     VALUES (?, ?, ?, ?, 'pdf', 'application/pdf', 1000, ?, ?, ?,
             'image/webp', 300, ?, 'published', ?)`,
  ).run(
    bookId,
    "test-book",
    "Test Book",
    "Author",
    `books/${bookId}.pdf`,
    "a".repeat(64),
    `covers/${bookId}.webp`,
    "b".repeat(64),
    owner,
  );
  database
    .prepare("UPDATE storage_usage SET committed_bytes = 1300 WHERE id = 1")
    .run();
  database.prepare(
    `INSERT INTO upload_reservations
       (id, principal_email, book_id, reserved_bytes, status, expires_at)
     VALUES ('reservation-delete', ?, ?, 1300, 'committed', '2099-01-01')`,
  ).run(owner, bookId);
  database.prepare(
    "INSERT INTO reading_progress (principal_email, book_id) VALUES (?, ?)",
  ).run(owner, bookId);
  database.prepare(
    "INSERT INTO bookmarks (id, principal_email, book_id, locator) VALUES ('bookmark-1', ?, ?, 'p1')",
  ).run(owner, bookId);
  database.prepare(
    "INSERT INTO notes (id, principal_email, book_id, locator, content) VALUES ('note-1', ?, ?, 'p1', 'note')",
  ).run(owner, bookId);

  database.prepare(
    "UPDATE books SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).run(bookId);
  database.prepare(
    `UPDATE storage_usage
     SET committed_bytes = MAX(0, committed_bytes - 1300)
     WHERE id = 1
       AND EXISTS (SELECT 1 FROM books WHERE id = ? AND deleted_at IS NOT NULL)`,
  ).run(bookId);
  database
    .prepare("DELETE FROM upload_reservations WHERE book_id = ?")
    .run(bookId);
  database
    .prepare("DELETE FROM books WHERE id = ? AND deleted_at IS NOT NULL")
    .run(bookId);

  assert.equal(
    database.prepare("SELECT committed_bytes FROM storage_usage WHERE id = 1").get()
      .committed_bytes,
    0,
  );
  for (const table of [
    "books",
    "upload_reservations",
    "reading_progress",
    "bookmarks",
    "notes",
  ]) {
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
  }
});

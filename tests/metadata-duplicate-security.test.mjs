import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const route = readFileSync("app/api/v1/books/[id]/route.ts", "utf8");
const uploadRoute = readFileSync("app/api/v1/books/upload/route.ts", "utf8");
const repository = readFileSync("lib/library-repository.ts", "utf8");
const drawer = readFileSync("app/books/[id]/pdf-tools-drawer.tsx", "utf8");
const pdfTools = readFileSync("lib/pdf-document-tools.ts", "utf8");
const dashboard = readFileSync("app/library-dashboard.tsx", "utf8");
const metadata = readFileSync("lib/book-metadata.ts", "utf8");

test("metadata PATCH is owner-only, same-origin, bounded, rate-limited and versioned", () => {
  assert.match(route, /export async function PATCH/);
  assert.match(route, /!viewer\.isOwner/);
  assert.match(route, /hasSameOrigin\(request\)/);
  assert.match(route, /content-length/);
  assert.match(route, /16_384/);
  assert.match(route, /action: "book\.metadata_update"/);
  assert.match(repository, /expectedVersion/);
  assert.match(route, /BOOK_VERSION_CONFLICT/);
  assert.match(repository, /AND version = \?/);
  assert.match(repository, /version = version \+ 1/);
  assert.match(repository, /action: "book\.metadata_update"/);
});

test("book tags are bounded, parameterized, searchable and rendered as React text", () => {
  assert.match(metadata, /MAX_BOOK_TAGS = 10/);
  assert.match(metadata, /MAX_BOOK_TAG_LENGTH = 32/);
  assert.match(metadata, /Array\.isArray\(value\)/);
  assert.match(repository, /tags_json = \?/);
  assert.match(repository, /JSON\.stringify\(input\.tags\)/);
  assert.match(repository, /lower\(tags_json\) LIKE \?/);
  assert.match(dashboard, /book\.tags\.join\(" "\)/);
  assert.match(dashboard, /<span className="book-tag" key=\{tag\}>\{tag\}<\/span>/);
  assert.doesNotMatch(dashboard, /dangerouslySetInnerHTML|innerHTML/);
});

test("exact checksum duplicate check happens before quota reservation and signed upload", () => {
  const duplicateCheck = repository.indexOf("findDuplicateBook(", repository.indexOf("createUploadReservation"));
  const budget = repository.indexOf("consumeMonthlyBudget", duplicateCheck);
  const reservationInsert = repository.indexOf("INSERT INTO upload_reservations", duplicateCheck);
  const signedPut = repository.indexOf("createPresignedPutUrl", duplicateCheck);

  assert.ok(duplicateCheck > 0);
  assert.ok(budget > duplicateCheck);
  assert.ok(reservationInsert > duplicateCheck);
  assert.ok(signedPut > duplicateCheck);
  assert.match(repository, /checksum_sha256 = \?/);
  assert.match(repository, /expires_at > CURRENT_TIMESTAMP/);
  assert.match(uploadRoute, /DUPLICATE_BOOK/);
  assert.match(uploadRoute, /409/);
});

test("PDF tools render untrusted PDF and local strings as text, with bounded work", () => {
  assert.doesNotMatch(drawer, /dangerouslySetInnerHTML|innerHTML/);
  assert.doesNotMatch(pdfTools, /dangerouslySetInnerHTML|innerHTML/);
  assert.match(pdfTools, /MAX_PDF_SEARCH_RESULTS = 100/);
  assert.match(pdfTools, /MAX_PDF_TEXT_PER_PAGE = 300_000/);
  assert.match(pdfTools, /MAX_PDF_OUTLINE_ITEMS = 500/);
  assert.match(pdfTools, /MAX_PDF_OUTLINE_DEPTH = 8/);
  assert.match(drawer, /PDF scan ảnh cần OCR/);
});

test("SQLite optimistic update rejects a stale metadata version", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of [
    "drizzle/0000_tearful_wasp.sql",
    "drizzle/0001_colossal_misty_knight.sql",
    "drizzle/0002_amazing_whizzer.sql",
    "drizzle/0003_fast_yellow_claw.sql",
  ]) {
    database.exec(readFileSync(migration, "utf8"));
  }

  const owner = "owner@library.local";
  const bookId = "11111111-1111-4111-8111-111111111111";
  database.prepare("INSERT INTO principals (email, role) VALUES (?, 'owner')").run(owner);
  database.prepare(
    `INSERT INTO books
       (id, slug, title, author, format, mime_type, size_bytes, object_key,
        checksum_sha256, status, created_by_email)
     VALUES (?, 'old-title', 'Old', 'Author', 'pdf', 'application/pdf', 1000,
             'books/one.pdf', ?, 'published', ?)`,
  ).run(bookId, "a".repeat(64), owner);

  const update = database.prepare(
    `UPDATE books
     SET title = ?, version = version + 1
     WHERE id = ? AND version = ?`,
  );
  assert.equal(update.run("New", bookId, 1).changes, 1);
  assert.equal(update.run("Stale", bookId, 1).changes, 0);
  const current = database
    .prepare("SELECT title, version FROM books WHERE id = ?")
    .get(bookId);
  assert.equal(current.title, "New");
  assert.equal(current.version, 2);
});

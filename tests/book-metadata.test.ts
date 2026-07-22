import assert from "node:assert/strict";
import test from "node:test";
import {
  BookMetadataValidationError,
  parseBookMetadataUpdate,
  parseStoredBookTags,
} from "../lib/book-metadata.ts";

test("book metadata parser normalizes bounded text and accepts optimistic version", () => {
  assert.deepEqual(parseBookMetadataUpdate({
    title: "  Kiến\u0000 trúc  ",
    author: "  Tác giả  ",
    description: "  Mô tả  ",
    tags: [" Cơ sở  dữ liệu ", "Backend", "BACKEND", ""],
    expectedVersion: 3,
  }), {
    title: "Kiến trúc",
    author: "Tác giả",
    description: "Mô tả",
    tags: ["Cơ sở dữ liệu", "Backend"],
    expectedVersion: 3,
  });
});

test("book metadata parser rejects missing fields and stale version shapes", () => {
  assert.throws(
    () => parseBookMetadataUpdate({ title: "", author: "A", tags: [], expectedVersion: 1 }),
    BookMetadataValidationError,
  );
  assert.throws(
    () => parseBookMetadataUpdate({ title: "T", author: "A", tags: [], expectedVersion: 0 }),
    BookMetadataValidationError,
  );
  assert.throws(
    () => parseBookMetadataUpdate({ title: "T", author: "A", description: {}, tags: [], expectedVersion: 1 }),
    BookMetadataValidationError,
  );
  assert.throws(
    () => parseBookMetadataUpdate({ title: "T".repeat(161), author: "A", tags: [], expectedVersion: 1 }),
    BookMetadataValidationError,
  );
});

test("book metadata parser bounds tag count, type and length", () => {
  const base = { title: "T", author: "A", expectedVersion: 1 };
  assert.throws(
    () => parseBookMetadataUpdate({ ...base, tags: "Backend" }),
    BookMetadataValidationError,
  );
  assert.throws(
    () => parseBookMetadataUpdate({ ...base, tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`) }),
    BookMetadataValidationError,
  );
  assert.throws(
    () => parseBookMetadataUpdate({ ...base, tags: ["x".repeat(33)] }),
    BookMetadataValidationError,
  );
  assert.throws(
    () => parseBookMetadataUpdate({ ...base, tags: [42] }),
    BookMetadataValidationError,
  );
});

test("stored tag parser fails closed for malformed legacy values", () => {
  assert.deepEqual(parseStoredBookTags('["Backend", "backend", "  PDF  "]'), [
    "Backend",
    "PDF",
  ]);
  assert.deepEqual(parseStoredBookTags("not-json"), []);
  assert.deepEqual(parseStoredBookTags('{"tag":"PDF"}'), []);
});

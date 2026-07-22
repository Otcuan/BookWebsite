import assert from "node:assert/strict";
import test from "node:test";
import {
  createPdfSearchSnippet,
  normalizePdfSearchQuery,
  pageFromSearchParams,
} from "../lib/pdf-document-tools.ts";
import {
  emptyReaderLocalData,
  MAX_LOCAL_NOTE_LENGTH,
  parseReaderLocalData,
  readerStorageKey,
  setLocalNote,
  toggleLocalBookmark,
} from "../lib/reader-local-data.ts";

test("PDF search is case-insensitive, accent-insensitive and whitespace-normalized", () => {
  assert.equal(normalizePdfSearchQuery("  Trí TUỆ   Nhân tạo  "), "tri tue nhan tao");
  assert.equal(normalizePdfSearchQuery("Đường dẫn"), "duong dan");
});

test("deep-link parser accepts only an in-range integer page", () => {
  assert.equal(pageFromSearchParams("?page=42", 100), 42);
  assert.equal(pageFromSearchParams("?page=0", 100), null);
  assert.equal(pageFromSearchParams("?page=101", 100), null);
  assert.equal(pageFromSearchParams("?page=1.5", 100), null);
  assert.equal(pageFromSearchParams("?page=%3Cscript%3E", 100), null);
});

test("search snippets are bounded and strip control whitespace", () => {
  const source = `${"a".repeat(100)}\nneedle\u0000${"b".repeat(150)}`;
  const snippet = createPdfSearchSnippet(source, 101, 6);
  assert.ok(snippet.startsWith("…"));
  assert.ok(snippet.endsWith("…"));
  assert.doesNotMatch(snippet, /[\u0000-\u001f]/);
  assert.ok(snippet.length < source.length);
});

test("local reader data fails closed and drops invalid or out-of-range records", () => {
  const timestamp = "2026-07-22T10:00:00.000Z";
  const parsed = parseReaderLocalData(JSON.stringify({
    version: 1,
    bookmarks: [
      { page: 3, label: "  Chương 1  ", createdAt: timestamp },
      { page: 999, label: "Sai", createdAt: timestamp },
      { page: 4, label: "Sai ngày", createdAt: "not-a-date" },
    ],
    notes: [
      { page: 5, content: "Điều cần nhớ", updatedAt: timestamp },
      { page: -1, content: "Sai", updatedAt: timestamp },
    ],
  }), 20);

  assert.deepEqual(parsed.bookmarks.map(({ page, label }) => ({ page, label })), [
    { page: 3, label: "Chương 1" },
  ]);
  assert.deepEqual(parsed.notes.map(({ page, content }) => ({ page, content })), [
    { page: 5, content: "Điều cần nhớ" },
  ]);
  assert.deepEqual(parseReaderLocalData("{broken", 20), emptyReaderLocalData());
});

test("bookmark toggles once per page and notes are bounded", () => {
  const timestamp = "2026-07-22T10:00:00.000Z";
  let data = toggleLocalBookmark(emptyReaderLocalData(), 7, 10, timestamp);
  assert.equal(data.bookmarks.length, 1);
  assert.equal(data.bookmarks[0].page, 7);
  data = toggleLocalBookmark(data, 7, 10, timestamp);
  assert.equal(data.bookmarks.length, 0);

  data = setLocalNote(data, 3, 10, `a\u0000${"b".repeat(3_000)}`, timestamp);
  assert.equal(data.notes.length, 1);
  assert.equal(data.notes[0].content.length, MAX_LOCAL_NOTE_LENGTH);
  assert.doesNotMatch(data.notes[0].content, /\u0000/);
  assert.equal(readerStorageKey("book-id"), "reader-local-data:v1:book-id");
});

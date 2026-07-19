import assert from "node:assert/strict";
import test from "node:test";
import {
  FileValidationError,
  MAX_COVER_BYTES,
  MAX_UPLOAD_BYTES,
  safeSlug,
  validateBookFile,
  validateCoverImage,
} from "../lib/file-security.ts";
import { hasSameOrigin } from "../lib/request-security.ts";

test("accepts a PDF only when extension, MIME and magic bytes agree", async () => {
  const file = new File([new TextEncoder().encode("%PDF-1.7\nexample")], "safe.pdf", {
    type: "application/pdf",
  });
  const result = await validateBookFile(file);
  assert.equal(result.extension, "pdf");
  assert.equal(result.mimeType, "application/pdf");
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

test("rejects extension and signature mismatch", async () => {
  const file = new File(["not a pdf"], "fake.pdf", { type: "application/pdf" });
  await assert.rejects(
    validateBookFile(file),
    (error: unknown) =>
      error instanceof FileValidationError && error.code === "UNSUPPORTED_FILE",
  );
});

test("rejects text files containing NUL bytes", async () => {
  const file = new File([new Uint8Array([65, 0, 66])], "unsafe.txt", {
    type: "text/plain",
  });
  await assert.rejects(validateBookFile(file), FileValidationError);
});

test("accepts a PNG cover only when extension, MIME and magic bytes agree", async () => {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const file = new File([signature], "cover.png", { type: "image/png" });
  const result = await validateCoverImage(file);
  assert.equal(result.extension, "png");
  assert.equal(result.mimeType, "image/png");
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

test("rejects executable SVG covers", async () => {
  const file = new File(["<svg><script>alert(1)</script></svg>"], "cover.svg", {
    type: "image/svg+xml",
  });
  await assert.rejects(
    validateCoverImage(file),
    (error: unknown) =>
      error instanceof FileValidationError && error.code === "UNSUPPORTED_COVER",
  );
});

test("declares bounded book and cover upload limits", () => {
  assert.equal(MAX_UPLOAD_BYTES, 100 * 1024 * 1024);
  assert.equal(MAX_COVER_BYTES, 3 * 1024 * 1024);
});

test("creates bounded ASCII slugs", () => {
  assert.equal(safeSlug("Kiến trúc phần mềm thực dụng"), "kien-truc-phan-mem-thuc-dung");
  assert.ok(safeSlug("a".repeat(200)).length <= 80);
});

test("same-origin protection fails closed", () => {
  assert.equal(
    hasSameOrigin(
      new Request("https://library.example/api", {
        headers: { Origin: "https://library.example" },
      }),
    ),
    true,
  );
  assert.equal(
    hasSameOrigin(
      new Request("https://library.example/api", {
        headers: { Origin: "https://attacker.example" },
      }),
    ),
    false,
  );
  assert.equal(hasSameOrigin(new Request("https://library.example/api")), false);
});

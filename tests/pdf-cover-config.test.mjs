import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const coverSource = readFileSync("lib/pdf-cover.ts", "utf8");

test("PDF.js is pinned and its same-origin runtime assets are packaged", () => {
  assert.equal(packageJson.dependencies["pdfjs-dist"], "6.1.200");
  for (const asset of [
    "public/pdfjs/LICENSE",
    "public/pdfjs/pdf.worker.min.mjs",
    "public/pdfjs/cmaps/Adobe-GB1-0.bcmap",
    "public/pdfjs/standard_fonts/LiberationSans-Regular.ttf",
  ]) {
    assert.equal(existsSync(asset), true, `missing ${asset}`);
  }
});

test("automatic covers render only page one with bounded, inactive content", () => {
  assert.match(coverSource, /getPage\(1\)/);
  assert.match(coverSource, /AnnotationMode\.DISABLE/);
  assert.match(coverSource, /enableXfa: false/);
  assert.match(coverSource, /useWasm: false/);
  assert.match(coverSource, /maxImageSize: MAX_EMBEDDED_IMAGE_PIXELS/);
  assert.match(coverSource, /canvasMaxAreaInBytes: 32 \* 1024 \* 1024/);
  assert.match(coverSource, /\/pdfjs\/pdf\.worker\.min\.mjs/);
  assert.doesNotMatch(coverSource, /https?:\/\//);
});

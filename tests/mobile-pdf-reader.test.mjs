import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readerClient = readFileSync("app/books/[id]/reader-client.tsx", "utf8");
const pdfReader = readFileSync("app/books/[id]/pdf-reader.tsx", "utf8");
const dashboard = readFileSync("app/library-dashboard.tsx", "utf8");
const homePage = readFileSync("app/page.tsx", "utf8");
const publicBooksApi = readFileSync("app/api/v1/books/route.ts", "utf8");
const readerCss = readFileSync("app/mobile-pdf-reader.css", "utf8");

test("PDF reading uses the paged canvas reader instead of a mobile iframe", () => {
  assert.match(readerClient, /<PdfReader/);
  assert.doesNotMatch(readerClient, /<iframe/);
  assert.match(pdfReader, /getPage\(pageNumber\)/);
  assert.match(pdfReader, /goToPage\(pageNumber \+ 1\)/);
  assert.match(pdfReader, /onTouchStart=\{beginSwipe\}/);
  assert.match(pdfReader, /onTouchEnd=\{finishSwipe\}/);
});

test("PDF rendering is bounded and inactive document features stay disabled", () => {
  assert.match(pdfReader, /AnnotationMode\.DISABLE/);
  assert.match(pdfReader, /enableXfa: false/);
  assert.match(pdfReader, /useWasm: false/);
  assert.match(pdfReader, /MAX_RENDERED_CANVAS_PIXELS = 16_000_000/);
  assert.match(pdfReader, /Math\.min\(window\.devicePixelRatio \|\| 1, 1\.75\)/);
  assert.match(pdfReader, /renderTaskRef\.current\?\.cancel\(\)/);
});

test("PDF network loading is range-based without automatic full-file prefetch", () => {
  assert.match(pdfReader, /disableRange: false/);
  assert.match(pdfReader, /disableStream: true/);
  assert.match(pdfReader, /disableAutoFetch: true/);
  assert.match(pdfReader, /rangeChunkSize: RANGE_CHUNK_SIZE/);
});

test("PDF reader exposes outline/search/local tools and page-specific sharing", () => {
  assert.match(pdfReader, /<PdfToolsDrawer/);
  assert.match(pdfReader, /pageFromSearchParams/);
  assert.match(pdfReader, /url\.searchParams\.set\("page"/);
  assert.match(pdfReader, /navigator\.share/);
  assert.match(pdfReader, /navigator\.clipboard/);
});

test("every PDF page defaults to fitting both available width and height", () => {
  assert.match(pdfReader, /useState<FitMode>\("page"\)/);
  assert.match(pdfReader, /height: scroller\.clientHeight/);
  assert.match(pdfReader, /Math\.min\(\s*fitWidthScale,\s*availableHeight \/ baseViewport\.height/);
  assert.match(pdfReader, /<option value="page">Vừa trang<\/option>/);
  assert.match(pdfReader, /<option value="width">Vừa rộng<\/option>/);
  assert.match(readerCss, /width: max-content/);
  assert.match(readerCss, /margin: auto/);
});

test("public readers receive neither the quota panel nor real storage metadata", () => {
  assert.match(dashboard, /\{viewer\.isOwner && \(\s*<div className="quota-panel"/);
  assert.match(homePage, /if \(viewer\.isOwner\)/);
  assert.match(homePage, /else \{\s*books = await listPublishedBooks\(\)/);
  assert.doesNotMatch(publicBooksApi, /getStorageStats/);
  assert.doesNotMatch(publicBooksApi, /meta: \{ storage/);
});

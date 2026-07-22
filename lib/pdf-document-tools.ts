import type { PDFDocumentProxy } from "pdfjs-dist";

export const MIN_PDF_SEARCH_LENGTH = 2;
export const MAX_PDF_SEARCH_LENGTH = 100;
export const MAX_PDF_SEARCH_RESULTS = 100;
export const MAX_PDF_TEXT_PER_PAGE = 300_000;
export const MAX_PDF_OUTLINE_ITEMS = 500;
export const MAX_PDF_OUTLINE_DEPTH = 8;

export type PdfOutlineItem = {
  id: string;
  title: string;
  destination: string | Array<unknown> | null;
  children: PdfOutlineItem[];
};

export type PdfSearchResult = {
  page: number;
  snippet: string;
  occurrences: number;
};

export class PdfSearchCancelledError extends Error {}

type RawOutlineItem = Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>[number];

export async function loadSafePdfOutline(
  document: PDFDocumentProxy,
): Promise<PdfOutlineItem[]> {
  const rawOutline = await document.getOutline();
  let remaining = MAX_PDF_OUTLINE_ITEMS;

  function visit(items: RawOutlineItem[], depth: number, path: string): PdfOutlineItem[] {
    if (depth > MAX_PDF_OUTLINE_DEPTH || remaining <= 0) return [];
    const result: PdfOutlineItem[] = [];
    for (let index = 0; index < items.length && remaining > 0; index += 1) {
      const item = items[index];
      const title = cleanOutlineTitle(item.title);
      remaining -= 1;
      const id = `${path}-${index}`;
      result.push({
        id,
        title: title || "Mục không có tên",
        destination: isSafeDestination(item.dest) ? item.dest : null,
        children: visit(item.items ?? [], depth + 1, id),
      });
    }
    return result;
  }

  return visit(rawOutline ?? [], 1, "outline");
}

export async function resolvePdfDestinationPage(
  document: PDFDocumentProxy,
  destination: PdfOutlineItem["destination"],
): Promise<number | null> {
  const explicit = typeof destination === "string"
    ? await document.getDestination(destination)
    : destination;
  if (!Array.isArray(explicit) || explicit.length === 0) return null;

  const reference = explicit[0];
  if (Number.isInteger(reference)) {
    const page = Number(reference) + 1;
    return page >= 1 && page <= document.numPages ? page : null;
  }
  if (
    typeof reference === "object" &&
    reference !== null &&
    "num" in reference &&
    "gen" in reference &&
    Number.isInteger(reference.num) &&
    Number.isInteger(reference.gen)
  ) {
    try {
      const page = (await document.getPageIndex({
        num: Number(reference.num),
        gen: Number(reference.gen),
      })) + 1;
      return page >= 1 && page <= document.numPages ? page : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function searchPdfDocument(
  document: PDFDocumentProxy,
  rawQuery: string,
  options: {
    isCancelled: () => boolean;
    onProgress?: (page: number, pageCount: number) => void;
  },
): Promise<PdfSearchResult[]> {
  const query = normalizePdfSearchQuery(rawQuery);
  if (query.length < MIN_PDF_SEARCH_LENGTH) return [];

  const results: PdfSearchResult[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    if (options.isCancelled()) throw new PdfSearchCancelledError();
    options.onProgress?.(pageNumber, document.numPages);

    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent({
      disableNormalization: false,
      includeMarkedContent: false,
    });
    if (options.isCancelled()) throw new PdfSearchCancelledError();

    const text = content.items
      .flatMap((item) => "str" in item
        ? [`${item.str}${item.hasEOL ? "\n" : " "}`]
        : [])
      .join("")
      .slice(0, MAX_PDF_TEXT_PER_PAGE);
    const folded = foldTextWithMap(text);
    const firstIndex = folded.text.indexOf(query);
    if (firstIndex >= 0) {
      results.push({
        page: pageNumber,
        snippet: createPdfSearchSnippet(text, folded.map[firstIndex] ?? 0, rawQuery.length),
        occurrences: countOccurrences(folded.text, query),
      });
      if (results.length >= MAX_PDF_SEARCH_RESULTS) break;
    }

    // Yield occasionally so long documents do not freeze toolbar interactions.
    if (pageNumber % 4 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return results;
}

export function normalizePdfSearchQuery(value: string): string {
  return foldTextWithMap(value.trim().slice(0, MAX_PDF_SEARCH_LENGTH)).text;
}

export function createPdfSearchSnippet(
  text: string,
  start: number,
  queryLength: number,
): string {
  const safeStart = Math.min(text.length, Math.max(0, start));
  const from = Math.max(0, safeStart - 72);
  const to = Math.min(text.length, safeStart + Math.max(queryLength, 1) + 110);
  const snippet = text
    .slice(from, to)
    .replace(/[\u0000-\u001f\u007f\s]+/g, " ")
    .trim();
  return `${from > 0 ? "…" : ""}${snippet}${to < text.length ? "…" : ""}`;
}

export function pageFromSearchParams(search: string, pageCount: number): number | null {
  if (!Number.isSafeInteger(pageCount) || pageCount <= 0) return null;
  const raw = new URLSearchParams(search).get("page");
  if (!raw || !/^\d{1,7}$/.test(raw)) return null;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page >= 1 && page <= pageCount ? page : null;
}

function foldTextWithMap(value: string): { text: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let sourceIndex = 0;
  for (const character of value) {
    const normalized = character
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "d")
      .toLocaleLowerCase("vi");
    for (const outputCharacter of normalized) {
      const nextCharacter = /\s/.test(outputCharacter) ? " " : outputCharacter;
      if (nextCharacter === " " && folded.endsWith(" ")) continue;
      folded += nextCharacter;
      map.push(sourceIndex);
    }
    sourceIndex += character.length;
  }
  return { text: folded, map };
}

function countOccurrences(text: string, query: string): number {
  let count = 0;
  let offset = 0;
  while (count < 999) {
    const found = text.indexOf(query, offset);
    if (found < 0) break;
    count += 1;
    offset = found + Math.max(1, query.length);
  }
  return count;
}

function cleanOutlineTitle(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function isSafeDestination(value: unknown): value is string | Array<unknown> | null {
  return value === null || typeof value === "string" || Array.isArray(value);
}

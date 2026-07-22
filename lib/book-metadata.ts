export const MAX_BOOK_TITLE_LENGTH = 160;
export const MAX_BOOK_AUTHOR_LENGTH = 120;
export const MAX_BOOK_DESCRIPTION_LENGTH = 2_000;
export const MAX_BOOK_TAGS = 10;
export const MAX_BOOK_TAG_LENGTH = 32;

export type BookMetadataUpdate = {
  title: string;
  author: string;
  description: string | null;
  tags: string[];
  expectedVersion: number;
};

export class BookMetadataValidationError extends Error {}

export function parseBookMetadataUpdate(value: unknown): BookMetadataUpdate {
  if (!isRecord(value)) {
    throw new BookMetadataValidationError("Metadata sách phải là một JSON object.");
  }

  const title = cleanRequiredText(value.title, MAX_BOOK_TITLE_LENGTH, "Tên sách");
  const author = cleanRequiredText(value.author, MAX_BOOK_AUTHOR_LENGTH, "Tác giả");
  const description = cleanOptionalText(value.description, MAX_BOOK_DESCRIPTION_LENGTH);
  const tags = parseBookTags(value.tags);
  const expectedVersion = Number(value.expectedVersion);

  if (!title) {
    throw new BookMetadataValidationError("Tên sách không được để trống.");
  }
  if (!author) {
    throw new BookMetadataValidationError("Tác giả không được để trống.");
  }
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new BookMetadataValidationError("Phiên bản metadata không hợp lệ.");
  }

  return { title, author, description, tags, expectedVersion };
}

export function parseStoredBookTags(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return normalizeBookTags(parsed, false);
  } catch {
    return [];
  }
}

function cleanRequiredText(value: unknown, maxLength: number, label: string): string {
  if (typeof value !== "string") return "";
  const cleaned = cleanText(value);
  if (cleaned.length > maxLength) {
    throw new BookMetadataValidationError(`${label} vượt quá ${maxLength} ký tự.`);
  }
  return cleaned;
}

function cleanOptionalText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new BookMetadataValidationError("Mô tả sách không hợp lệ.");
  }
  const cleaned = cleanText(value);
  if (cleaned.length > maxLength) {
    throw new BookMetadataValidationError(`Mô tả vượt quá ${maxLength} ký tự.`);
  }
  return cleaned || null;
}

function parseBookTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new BookMetadataValidationError("Tags phải là một danh sách.");
  }
  return normalizeBookTags(value, true);
}

function normalizeBookTags(values: unknown[], strict: boolean): string[] {
  if (strict && values.length > MAX_BOOK_TAGS) {
    throw new BookMetadataValidationError(`Chỉ được nhập tối đa ${MAX_BOOK_TAGS} tags.`);
  }

  const tags: string[] = [];
  const seen = new Set<string>();
  for (const value of values.slice(0, MAX_BOOK_TAGS)) {
    if (typeof value !== "string") {
      if (strict) throw new BookMetadataValidationError("Mỗi tag phải là chữ.");
      continue;
    }
    const tag = cleanText(value);
    if (!tag) continue;
    if (tag.length > MAX_BOOK_TAG_LENGTH) {
      if (strict) {
        throw new BookMetadataValidationError(
          `Mỗi tag không được vượt quá ${MAX_BOOK_TAG_LENGTH} ký tự.`,
        );
      }
      continue;
    }
    const key = tag.toLocaleLowerCase("vi");
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function cleanText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

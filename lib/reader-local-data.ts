export const READER_LOCAL_DATA_VERSION = 1 as const;
export const MAX_LOCAL_BOOKMARKS = 200;
export const MAX_LOCAL_NOTES = 200;
export const MAX_LOCAL_NOTE_LENGTH = 2_000;
export const MAX_LOCAL_BOOKMARK_LABEL_LENGTH = 120;

export type LocalBookmark = {
  page: number;
  label: string;
  createdAt: string;
};

export type LocalNote = {
  page: number;
  content: string;
  updatedAt: string;
};

export type ReaderLocalData = {
  version: typeof READER_LOCAL_DATA_VERSION;
  bookmarks: LocalBookmark[];
  notes: LocalNote[];
};

export function emptyReaderLocalData(): ReaderLocalData {
  return {
    version: READER_LOCAL_DATA_VERSION,
    bookmarks: [],
    notes: [],
  };
}

export function readerStorageKey(bookId: string): string {
  return `reader-local-data:v1:${bookId}`;
}

export function parseReaderLocalData(
  raw: string | null,
  pageCount: number,
): ReaderLocalData {
  if (!raw || !Number.isSafeInteger(pageCount) || pageCount <= 0) {
    return emptyReaderLocalData();
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return emptyReaderLocalData();
  }
  if (!isRecord(value) || value.version !== READER_LOCAL_DATA_VERSION) {
    return emptyReaderLocalData();
  }

  const bookmarkByPage = new Map<number, LocalBookmark>();
  if (Array.isArray(value.bookmarks)) {
    for (const candidate of value.bookmarks.slice(0, MAX_LOCAL_BOOKMARKS * 2)) {
      const bookmark = parseBookmark(candidate, pageCount);
      if (bookmark) bookmarkByPage.set(bookmark.page, bookmark);
      if (bookmarkByPage.size >= MAX_LOCAL_BOOKMARKS) break;
    }
  }

  const noteByPage = new Map<number, LocalNote>();
  if (Array.isArray(value.notes)) {
    for (const candidate of value.notes.slice(0, MAX_LOCAL_NOTES * 2)) {
      const note = parseNote(candidate, pageCount);
      if (note) noteByPage.set(note.page, note);
      if (noteByPage.size >= MAX_LOCAL_NOTES) break;
    }
  }

  return {
    version: READER_LOCAL_DATA_VERSION,
    bookmarks: [...bookmarkByPage.values()].sort((a, b) => a.page - b.page),
    notes: [...noteByPage.values()].sort((a, b) => a.page - b.page),
  };
}

export function toggleLocalBookmark(
  data: ReaderLocalData,
  page: number,
  pageCount: number,
  now = new Date().toISOString(),
): ReaderLocalData {
  const safePage = validPage(page, pageCount);
  if (safePage === null) return data;
  const existing = data.bookmarks.some((bookmark) => bookmark.page === safePage);
  const bookmarks = existing
    ? data.bookmarks.filter((bookmark) => bookmark.page !== safePage)
    : [
        ...data.bookmarks,
        { page: safePage, label: `Trang ${safePage}`, createdAt: now },
      ]
        .slice(-MAX_LOCAL_BOOKMARKS)
        .sort((a, b) => a.page - b.page);
  return { ...data, bookmarks };
}

export function renameLocalBookmark(
  data: ReaderLocalData,
  page: number,
  label: string,
): ReaderLocalData {
  const cleanLabel = label
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, MAX_LOCAL_BOOKMARK_LABEL_LENGTH);
  return {
    ...data,
    bookmarks: data.bookmarks.map((bookmark) =>
      bookmark.page === page
        ? { ...bookmark, label: cleanLabel }
        : bookmark,
    ),
  };
}

export function setLocalNote(
  data: ReaderLocalData,
  page: number,
  pageCount: number,
  content: string,
  now = new Date().toISOString(),
): ReaderLocalData {
  const safePage = validPage(page, pageCount);
  if (safePage === null) return data;
  const cleanContent = content
    .replace(/\u0000/g, "")
    .slice(0, MAX_LOCAL_NOTE_LENGTH);
  const otherNotes = data.notes.filter((note) => note.page !== safePage);
  if (!cleanContent) return { ...data, notes: otherNotes };
  const notes = [
    ...otherNotes,
    { page: safePage, content: cleanContent, updatedAt: now },
  ]
    .slice(-MAX_LOCAL_NOTES)
    .sort((a, b) => a.page - b.page);
  return { ...data, notes };
}

export function serializeReaderLocalData(data: ReaderLocalData): string {
  return JSON.stringify(data);
}

function parseBookmark(value: unknown, pageCount: number): LocalBookmark | null {
  if (!isRecord(value)) return null;
  const page = validPage(value.page, pageCount);
  if (page === null || !isSafeTimestamp(value.createdAt)) return null;
  const label = cleanPlainText(value.label, MAX_LOCAL_BOOKMARK_LABEL_LENGTH);
  return {
    page,
    label: label || `Trang ${page}`,
    createdAt: value.createdAt,
  };
}

function parseNote(value: unknown, pageCount: number): LocalNote | null {
  if (!isRecord(value)) return null;
  const page = validPage(value.page, pageCount);
  if (
    page === null ||
    typeof value.content !== "string" ||
    value.content.length < 1 ||
    value.content.length > MAX_LOCAL_NOTE_LENGTH ||
    !isSafeTimestamp(value.updatedAt)
  ) {
    return null;
  }
  return {
    page,
    content: value.content.replace(/\u0000/g, ""),
    updatedAt: value.updatedAt,
  };
}

function validPage(value: unknown, pageCount: number): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= pageCount
    ? Number(value)
    : null;
}

function cleanPlainText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function isSafeTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

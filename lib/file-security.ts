export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export type AcceptedBookFile = {
  bytes: Uint8Array;
  extension: "pdf" | "txt";
  mimeType: "application/pdf" | "text/plain";
  sha256: string;
};

export class FileValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function validateBookFile(file: File): Promise<AcceptedBookFile> {
  if (file.size <= 0) {
    throw new FileValidationError("EMPTY_FILE", "Tệp không có nội dung.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new FileValidationError(
      "FILE_TOO_LARGE",
      "Tệp vượt quá giới hạn 50 MB.",
    );
  }

  const name = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const looksLikePdf = hasPdfSignature(bytes);
  const looksLikeText = isSafeUtf8Text(bytes);

  let extension: AcceptedBookFile["extension"];
  let mimeType: AcceptedBookFile["mimeType"];

  if (name.endsWith(".pdf") && file.type === "application/pdf" && looksLikePdf) {
    extension = "pdf";
    mimeType = "application/pdf";
  } else if (
    name.endsWith(".txt") &&
    (file.type === "text/plain" || file.type === "") &&
    looksLikeText
  ) {
    extension = "txt";
    mimeType = "text/plain";
  } else {
    throw new FileValidationError(
      "UNSUPPORTED_FILE",
      "Phần mở rộng, MIME type và chữ ký tệp không khớp PDF/TXT được cho phép.",
    );
  }

  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");

  return { bytes, extension, mimeType, sha256 };
}

function hasPdfSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

function isSafeUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.some((value) => value === 0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function safeSlug(title: string): string {
  const normalized = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || "sach";
}

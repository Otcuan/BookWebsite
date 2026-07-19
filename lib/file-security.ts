export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_COVER_BYTES = 3 * 1024 * 1024;

export type AcceptedBookFile = {
  extension: "pdf" | "txt";
  mimeType: "application/pdf" | "text/plain";
  sha256: string;
};

export type AcceptedCoverImage = {
  extension: "jpg" | "png" | "webp";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
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
      "Tệp vượt quá giới hạn 100 MiB.",
    );
  }

  const name = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());

  let extension: AcceptedBookFile["extension"];
  let mimeType: AcceptedBookFile["mimeType"];

  if (
    name.endsWith(".pdf") &&
    file.type === "application/pdf" &&
    hasPdfSignature(bytes)
  ) {
    extension = "pdf";
    mimeType = "application/pdf";
  } else if (
    name.endsWith(".txt") &&
    (file.type === "text/plain" || file.type === "") &&
    isSafeUtf8Text(bytes)
  ) {
    extension = "txt";
    mimeType = "text/plain";
  } else {
    throw new FileValidationError(
      "UNSUPPORTED_FILE",
      "Phần mở rộng, MIME type và chữ ký tệp không khớp PDF/TXT được cho phép.",
    );
  }

  const sha256 = await checksumSha256(bytes);

  return { extension, mimeType, sha256 };
}

export async function validateCoverImage(file: File): Promise<AcceptedCoverImage> {
  if (file.size <= 0) {
    throw new FileValidationError("EMPTY_COVER", "Ảnh bìa không có nội dung.");
  }
  if (file.size > MAX_COVER_BYTES) {
    throw new FileValidationError(
      "COVER_TOO_LARGE",
      "Ảnh bìa vượt quá giới hạn 3 MiB.",
    );
  }

  const name = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let extension: AcceptedCoverImage["extension"];
  let mimeType: AcceptedCoverImage["mimeType"];

  if (
    (name.endsWith(".jpg") || name.endsWith(".jpeg")) &&
    file.type === "image/jpeg" &&
    hasJpegSignature(bytes)
  ) {
    extension = "jpg";
    mimeType = "image/jpeg";
  } else if (name.endsWith(".png") && file.type === "image/png" && hasPngSignature(bytes)) {
    extension = "png";
    mimeType = "image/png";
  } else if (
    name.endsWith(".webp") &&
    file.type === "image/webp" &&
    hasWebpSignature(bytes)
  ) {
    extension = "webp";
    mimeType = "image/webp";
  } else {
    throw new FileValidationError(
      "UNSUPPORTED_COVER",
      "Ảnh bìa phải là JPG, PNG hoặc WebP có phần mở rộng, MIME và chữ ký khớp nhau.",
    );
  }

  return {
    extension,
    mimeType,
    sha256: await checksumSha256(bytes),
  };
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

function hasJpegSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function hasPngSignature(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function hasWebpSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  );
}

async function checksumSha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
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

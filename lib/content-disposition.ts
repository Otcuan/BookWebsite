import { safeSlug } from "@/lib/file-security";

type DownloadExtension = "pdf" | "txt";

export function buildAttachmentDisposition(
  title: string,
  extension: DownloadExtension,
): string {
  const withoutKnownExtension = title.replace(/\.(pdf|txt)$/i, "").trim();
  const displayBase = withoutKnownExtension
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, 120) || "sach";
  const unicodeFilename = `${displayBase}.${extension}`;
  const asciiFilename = `${safeSlug(displayBase)}.${extension}`;
  const encodedFilename = encodeURIComponent(unicodeFilename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;
}

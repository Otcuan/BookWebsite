import { MAX_COVER_BYTES } from "@/lib/file-security";

const PDF_WORKER_PATH = "/pdfjs/pdf.worker.min.mjs";
const CMAP_PATH = "/pdfjs/cmaps/";
const STANDARD_FONT_PATH = "/pdfjs/standard_fonts/";
const MAX_COVER_WIDTH = 900;
const MAX_COVER_HEIGHT = 1350;
const MAX_EMBEDDED_IMAGE_PIXELS = 24_000_000;

export class PdfCoverGenerationError extends Error {}

export async function generateCoverFromPdf(file: File): Promise<File> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new PdfCoverGenerationError("Chỉ có thể tạo bìa PDF trong trình duyệt.");
  }

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_PATH;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapPacked: true,
    cMapUrl: CMAP_PATH,
    standardFontDataUrl: STANDARD_FONT_PATH,
    useSystemFonts: true,
    useWasm: false,
    enableXfa: false,
    stopAtErrors: true,
    maxImageSize: MAX_EMBEDDED_IMAGE_PIXELS,
    canvasMaxAreaInBytes: 32 * 1024 * 1024,
  });

  try {
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    try {
      const baseViewport = page.getViewport({ scale: 1 });
      if (
        !Number.isFinite(baseViewport.width) ||
        !Number.isFinite(baseViewport.height) ||
        baseViewport.width <= 0 ||
        baseViewport.height <= 0
      ) {
        throw new PdfCoverGenerationError("Trang đầu PDF có kích thước không hợp lệ.");
      }

      const scale = Math.min(
        2,
        MAX_COVER_WIDTH / baseViewport.width,
        MAX_COVER_HEIGHT / baseViewport.height,
      );
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));

      await page.render({
        canvas,
        viewport,
        background: "rgb(255,255,255)",
        annotationMode: pdfjs.AnnotationMode.DISABLE,
      }).promise;

      const encoded = await encodeCanvas(canvas);
      const safeBaseName = file.name
        .replace(/\.pdf$/i, "")
        .replace(/[^\p{L}\p{N}._-]+/gu, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 180) || "book";
      const extension = encoded.type === "image/webp" ? "webp" : "jpg";
      return new File([encoded], `${safeBaseName}-cover.${extension}`, {
        type: encoded.type,
        lastModified: Date.now(),
      });
    } finally {
      page.cleanup();
    }
  } catch (error) {
    if (error instanceof PdfCoverGenerationError) throw error;
    throw new PdfCoverGenerationError(
      error instanceof Error && error.name === "PasswordException"
        ? "PDF có mật khẩu nên không thể tự tạo ảnh bìa."
        : "Không thể render trang đầu PDF thành ảnh bìa.",
    );
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}

async function encodeCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  for (const quality of [0.84, 0.72, 0.6]) {
    const webp = await canvasToBlob(canvas, "image/webp", quality);
    if (webp?.type === "image/webp" && webp.size <= MAX_COVER_BYTES) return webp;
  }

  for (const quality of [0.84, 0.7, 0.56]) {
    const jpeg = await canvasToBlob(canvas, "image/jpeg", quality);
    if (jpeg?.type === "image/jpeg" && jpeg.size <= MAX_COVER_BYTES) return jpeg;
  }

  throw new PdfCoverGenerationError("Ảnh tạo từ trang đầu vượt quá giới hạn 3 MiB.");
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: "image/webp" | "image/jpeg",
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

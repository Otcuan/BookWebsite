"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist";
import { pageFromSearchParams } from "@/lib/pdf-document-tools";
import { PdfToolsDrawer } from "./pdf-tools-drawer";

const PDF_WORKER_PATH = "/pdfjs/pdf.worker.min.mjs";
const CMAP_PATH = "/pdfjs/cmaps/";
const STANDARD_FONT_PATH = "/pdfjs/standard_fonts/";
const RANGE_CHUNK_SIZE = 256 * 1024;
const MAX_EMBEDDED_IMAGE_PIXELS = 24_000_000;
const MAX_RENDERED_CANVAS_PIXELS = 16_000_000;
const MAX_CANVAS_AREA_BYTES = 48 * 1024 * 1024;
const MIN_ZOOM = 70;
const MAX_ZOOM = 160;
const ZOOM_STEP = 10;

type PdfJs = typeof import("pdfjs-dist");
type FitMode = "page" | "width";

export function PdfReader({
  bookId,
  title,
  initialProgress,
  onProgress,
}: {
  bookId: string;
  title: string;
  initialProgress: number;
  onProgress: (progress: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageScrollerRef = useRef<HTMLDivElement>(null);
  const pdfJsRef = useRef<PdfJs | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const renderRequestRef = useRef(0);
  const initialProgressRef = useRef(initialProgress);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [fitMode, setFitMode] = useState<FitMode>("page");
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [loadingPercent, setLoadingPercent] = useState<number | null>(null);
  const [rendering, setRendering] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [shareStatus, setShareStatus] = useState("");

  const closeTools = useCallback(() => setToolsOpen(false), []);

  useEffect(() => {
    initialProgressRef.current = initialProgress;
  }, [bookId, initialProgress]);

  useEffect(() => {
    const scroller = pageScrollerRef.current;
    if (!scroller) return;

    const updateSize = () => setContainerSize({
      width: scroller.clientWidth,
      height: scroller.clientHeight,
    });
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      queueMicrotask(updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(scroller);
    queueMicrotask(updateSize);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    queueMicrotask(async () => {
      setErrorMessage("");
      setLoadingPercent(null);
      setPdfDocument(null);
      setPageCount(0);
      setRendering(true);

      try {
        const pdfjs = await import("pdfjs-dist");
        if (disposed) return;
        pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_PATH;
        pdfJsRef.current = pdfjs;

        loadingTask = pdfjs.getDocument({
          url: `/api/v1/books/${encodeURIComponent(bookId)}/content`,
          cMapPacked: true,
          cMapUrl: CMAP_PATH,
          standardFontDataUrl: STANDARD_FONT_PATH,
          useSystemFonts: true,
          useWasm: false,
          enableXfa: false,
          stopAtErrors: false,
          maxImageSize: MAX_EMBEDDED_IMAGE_PIXELS,
          canvasMaxAreaInBytes: MAX_CANVAS_AREA_BYTES,
          disableRange: false,
          disableStream: true,
          disableAutoFetch: true,
          rangeChunkSize: RANGE_CHUNK_SIZE,
          withCredentials: false,
        });
        loadingTaskRef.current = loadingTask;
        loadingTask.onProgress = ({ percent }: { percent: number }) => {
          if (!disposed && Number.isFinite(percent)) {
            setLoadingPercent(Math.min(100, Math.max(0, Math.round(percent))));
          }
        };

        const documentProxy = await loadingTask.promise;
        if (disposed) return;

        const linkedPage = pageFromSearchParams(
          window.location.search,
          documentProxy.numPages,
        );
        const restoredPage = linkedPage ?? progressToPage(
          initialProgressRef.current,
          documentProxy.numPages,
        );
        setPdfDocument(documentProxy);
        setPageCount(documentProxy.numPages);
        setPageNumber(restoredPage);
      } catch (error) {
        if (!disposed) setErrorMessage(toReaderError(error));
      } finally {
        if (!disposed) setRendering(false);
      }
    });

    return () => {
      disposed = true;
      renderRequestRef.current += 1;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      if (loadingTask) void loadingTask.destroy().catch(() => undefined);
      if (loadingTaskRef.current === loadingTask) loadingTaskRef.current = null;
      pdfJsRef.current = null;
    };
  }, [bookId, retryKey]);

  useEffect(() => {
    if (
      !pdfDocument ||
      !pdfJsRef.current ||
      containerSize.width <= 0 ||
      containerSize.height <= 0
    ) return;

    const requestId = ++renderRequestRef.current;
    let page: PDFPageProxy | null = null;
    let task: RenderTask | null = null;

    queueMicrotask(async () => {
      const previousTask = renderTaskRef.current;
      if (previousTask) {
        previousTask.cancel();
        try {
          await previousTask.promise;
        } catch {
          // A cancelled render rejects by design. The request id prevents stale work.
        }
      }
      if (requestId !== renderRequestRef.current) return;

      setRendering(true);
      setErrorMessage("");

      try {
        page = await pdfDocument.getPage(pageNumber);
        if (requestId !== renderRequestRef.current) return;

        const canvas = canvasRef.current;
        const pdfjs = pdfJsRef.current;
        if (!canvas || !pdfjs) return;

        const baseViewport = page.getViewport({ scale: 1 });
        if (
          !Number.isFinite(baseViewport.width) ||
          !Number.isFinite(baseViewport.height) ||
          baseViewport.width <= 0 ||
          baseViewport.height <= 0
        ) {
          throw new Error("INVALID_PAGE_SIZE");
        }

        const compactViewport = containerSize.width <= 580;
        const horizontalPadding = compactViewport ? 20 : 48;
        const verticalPadding = compactViewport ? 28 : 48;
        const availableWidth = Math.max(
          120,
          Math.min(1100, containerSize.width - horizontalPadding),
        );
        const availableHeight = Math.max(80, containerSize.height - verticalPadding);
        const fitWidthScale = availableWidth / baseViewport.width;
        const fitPageScale = Math.min(
          fitWidthScale,
          availableHeight / baseViewport.height,
        );
        const fitScale = fitMode === "page" ? fitPageScale : fitWidthScale;
        const cssScale = fitScale * (zoom / 100);
        const cssViewport = page.getViewport({ scale: cssScale });
        const cssPixels = cssViewport.width * cssViewport.height;
        const preferredOutputScale = Math.min(window.devicePixelRatio || 1, 1.75);
        const safeOutputScale = Math.min(
          preferredOutputScale,
          Math.sqrt(MAX_RENDERED_CANVAS_PIXELS / Math.max(1, cssPixels)),
        );
        const outputScale = Math.max(0.5, safeOutputScale);
        const renderViewport = page.getViewport({ scale: cssScale * outputScale });

        canvas.width = Math.max(1, Math.floor(renderViewport.width));
        canvas.height = Math.max(1, Math.floor(renderViewport.height));
        canvas.style.width = `${Math.max(1, Math.floor(cssViewport.width))}px`;
        canvas.style.height = `${Math.max(1, Math.floor(cssViewport.height))}px`;

        task = page.render({
          canvas,
          viewport: renderViewport,
          annotationMode: pdfjs.AnnotationMode.DISABLE,
          background: "rgb(255,255,255)",
        });
        renderTaskRef.current = task;
        await task.promise;
      } catch (error) {
        const wasCancelled =
          error instanceof Error && error.name === "RenderingCancelledException";
        if (!wasCancelled && requestId === renderRequestRef.current) {
          setErrorMessage("Không thể hiển thị trang PDF này. Hãy thử tải lại.");
        }
      } finally {
        page?.cleanup();
        if (renderTaskRef.current === task) renderTaskRef.current = null;
        if (requestId === renderRequestRef.current) setRendering(false);
      }
    });

    return () => {
      renderRequestRef.current += 1;
      task?.cancel();
    };
  }, [containerSize, fitMode, pageNumber, pdfDocument, zoom]);

  useEffect(() => {
    if (pageCount <= 0) return;
    const nextProgress = Math.round((pageNumber / pageCount) * 100);
    queueMicrotask(() => onProgress(nextProgress));
  }, [onProgress, pageCount, pageNumber]);

  useEffect(() => {
    if (!pdfDocument || pageCount <= 0) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("page") === String(pageNumber)) return;
    url.searchParams.set("page", String(pageNumber));
    window.history.replaceState(window.history.state, "", url);
  }, [pageCount, pageNumber, pdfDocument]);

  useEffect(() => {
    if (pageCount <= 0) return;
    const restoreLinkedPage = () => {
      const linkedPage = pageFromSearchParams(window.location.search, pageCount);
      if (linkedPage !== null) goToPage(linkedPage);
    };
    window.addEventListener("popstate", restoreLinkedPage);
    return () => window.removeEventListener("popstate", restoreLinkedPage);
  });

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (event.key === "ArrowLeft") goToPage(pageNumber - 1);
      if (event.key === "ArrowRight") goToPage(pageNumber + 1);
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  });

  function goToPage(requestedPage: number) {
    if (pageCount <= 0 || !Number.isFinite(requestedPage)) return;
    const nextPage = Math.min(pageCount, Math.max(1, Math.round(requestedPage)));
    setPageNumber(nextPage);
    pageScrollerRef.current?.scrollTo({ left: 0, top: 0, behavior: "smooth" });
  }

  function changeZoom(delta: number) {
    setZoom((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current + delta)));
  }

  function commitPageInput(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    goToPage(Number(event.currentTarget.value));
    event.currentTarget.blur();
  }

  function beginSwipe(event: ReactTouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 1) {
      touchStartRef.current = null;
      return;
    }
    touchStartRef.current = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
    };
  }

  function finishSwipe(event: ReactTouchEvent<HTMLDivElement>) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || event.changedTouches.length !== 1) return;

    const deltaX = event.changedTouches[0].clientX - start.x;
    const deltaY = event.changedTouches[0].clientY - start.y;
    const scroller = pageScrollerRef.current;
    if (scroller && scroller.scrollWidth > scroller.clientWidth + 4) return;
    if (Math.abs(deltaX) < 60 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return;
    goToPage(deltaX < 0 ? pageNumber + 1 : pageNumber - 1);
  }

  async function shareCurrentPage() {
    if (pageCount <= 0) return;
    const url = new URL(window.location.href);
    url.searchParams.set("page", String(pageNumber));
    window.history.replaceState(window.history.state, "", url);

    try {
      if (typeof navigator.share === "function") {
        await navigator.share({
          title,
          text: `${title} — trang ${pageNumber}`,
          url: url.toString(),
        });
        setShareStatus("Đã mở bảng chia sẻ.");
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url.toString());
        setShareStatus("Đã sao chép link đúng trang.");
      } else {
        setShareStatus("Link đúng trang đã nằm trên thanh địa chỉ để bạn sao chép.");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setShareStatus("Không thể tự sao chép; hãy sao chép URL trên thanh địa chỉ.");
    }
  }

  return (
    <div className="pdf-mobile-reader">
      <div className="pdf-reader-controls" aria-label="Điều hướng PDF">
        <div className="pdf-page-navigation">
          <button
            aria-label="Trang trước"
            disabled={pageNumber <= 1 || pageCount === 0}
            onClick={() => goToPage(pageNumber - 1)}
            type="button"
          >
            ←
          </button>
          <label className="pdf-page-indicator">
            <span className="sr-only">Đi đến trang</span>
            <input
              aria-label="Số trang"
              defaultValue={pageNumber}
              disabled={pageCount === 0}
              key={pageNumber}
              max={pageCount || 1}
              min="1"
              onBlur={(event) => goToPage(Number(event.currentTarget.value))}
              onKeyDown={commitPageInput}
              type="number"
            />
            <span>/ {pageCount || "–"}</span>
          </label>
          <button
            aria-label="Trang sau"
            disabled={pageCount === 0 || pageNumber >= pageCount}
            onClick={() => goToPage(pageNumber + 1)}
            type="button"
          >
            →
          </button>
        </div>

        <div className="pdf-tool-actions">
          <button
            aria-expanded={toolsOpen}
            aria-label="Mở mục lục, tìm kiếm, bookmark và ghi chú"
            className="pdf-tools-open"
            disabled={!pdfDocument}
            onClick={() => setToolsOpen(true)}
            type="button"
          >
            <span aria-hidden="true">☰</span>
            <span>Công cụ</span>
          </button>
          <button
            aria-label={`Chia sẻ link trang ${pageNumber}`}
            className="pdf-share-page"
            disabled={pageCount === 0}
            onClick={shareCurrentPage}
            title="Chia sẻ link đúng trang"
            type="button"
          >
            ↗
          </button>
          <span aria-live="polite" className="pdf-share-status">{shareStatus}</span>
        </div>

        <div className="pdf-zoom-controls">
          <button
            aria-label="Thu nhỏ trang"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => changeZoom(-ZOOM_STEP)}
            type="button"
          >
            −
          </button>
          <button aria-label="Đặt lại mức phóng" onClick={() => setZoom(100)} type="button">
            {zoom}%
          </button>
          <button
            aria-label="Phóng to trang"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => changeZoom(ZOOM_STEP)}
            type="button"
          >
            +
          </button>
          <label className="pdf-fit-control">
            <span className="sr-only">Cách căn PDF vào khung</span>
            <select
              aria-label="Cách căn PDF vào khung"
              onChange={(event) => {
                setFitMode(event.target.value as FitMode);
                setZoom(100);
              }}
              value={fitMode}
            >
              <option value="page">Vừa trang</option>
              <option value="width">Vừa rộng</option>
            </select>
          </label>
        </div>
      </div>

      <div
        aria-busy={rendering}
        aria-label={`Nội dung PDF ${title}`}
        className="pdf-page-scroll"
        onTouchEnd={finishSwipe}
        onTouchStart={beginSwipe}
        ref={pageScrollerRef}
      >
        <div className="pdf-canvas-wrap">
          <canvas aria-label={`Trang ${pageNumber} của ${pageCount || "PDF"}`} ref={canvasRef} />
          {rendering && !errorMessage && (
            <div className="pdf-loading-status" role="status">
              {pageCount > 0
                ? `Đang hiển thị trang ${pageNumber}…`
                : loadingPercent === null
                  ? "Đang mở PDF…"
                  : `Đang mở PDF… ${loadingPercent}%`}
            </div>
          )}
          {errorMessage && (
            <div className="pdf-reader-error" role="alert">
              <p>{errorMessage}</p>
              <button onClick={() => setRetryKey((current) => current + 1)} type="button">
                Thử lại
              </button>
            </div>
          )}
        </div>
      </div>
      <p className="pdf-swipe-hint">Mặc định vừa toàn trang · Vuốt ngang để đổi trang</p>
      {pdfDocument && (
        <PdfToolsDrawer
          bookId={bookId}
          document={pdfDocument}
          key={`${bookId}:${retryKey}`}
          onClose={closeTools}
          onNavigate={goToPage}
          open={toolsOpen}
          pageCount={pageCount}
          pageNumber={pageNumber}
          title={title}
        />
      )}
    </div>
  );
}

function progressToPage(progress: number, pageCount: number) {
  if (pageCount <= 0) return 1;
  const safeProgress = Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0;
  if (safeProgress <= 0) return 1;
  return Math.min(pageCount, Math.max(1, Math.ceil((safeProgress / 100) * pageCount)));
}

function toReaderError(error: unknown) {
  if (error instanceof Error && error.name === "PasswordException") {
    return "PDF được bảo vệ bằng mật khẩu nên chưa thể mở trực tuyến.";
  }
  return "Không thể mở PDF. Hãy kiểm tra kết nối rồi thử lại.";
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { LibraryBook } from "@/lib/library-repository";
import { PdfReader } from "./pdf-reader";

type Theme = "paper" | "night" | "sepia";

export function ReaderClient({ book }: { book: LibraryBook }) {
  const [theme, setTheme] = useState<Theme>("paper");
  const [fontSize, setFontSize] = useState(19);
  const [lineHeight, setLineHeight] = useState(1.75);
  const [text, setText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [progress, setProgress] = useState(book.progress);
  const [progressReady, setProgressReady] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      const stored = Number(localStorage.getItem(`reading-progress:${book.id}`));
      if (active && Number.isFinite(stored)) {
        setProgress(Math.min(100, Math.max(0, stored)));
      }
      if (active) setProgressReady(true);
    });
    return () => {
      active = false;
    };
  }, [book.id]);

  useEffect(() => {
    if (book.format !== "TXT") return;
    const controller = new AbortController();
    fetch(`/api/v1/books/${encodeURIComponent(book.id)}/content`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Không thể tải nội dung.");
        return response.text();
      })
      .then(setText)
      .catch((error: Error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      });
    return () => controller.abort();
  }, [book.format, book.id]);

  const scheduleProgress = useCallback((nextProgress: number) => {
    setProgress(nextProgress);
    localStorage.setItem(`reading-progress:${book.id}`, String(nextProgress));
  }, [book.id]);

  async function downloadPdf() {
    if (downloading || book.format !== "PDF") return;
    setDownloading(true);
    setDownloadError("");

    try {
      const response = await fetch(
        `/api/v1/books/${encodeURIComponent(book.id)}/content`,
        { credentials: "same-origin" },
      );
      if (!response.ok) throw new Error("DOWNLOAD_FAILED");

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = safePdfFilename(book.title);
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
      setDownloadError("Không thể tải PDF. Hãy kiểm tra kết nối và thử lại.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <main className={`reader-shell reader-${theme}${book.format === "PDF" ? " reader-pdf-shell" : ""}`}>
      <header className="reader-toolbar">
        <Link className="reader-back" href="/" aria-label="Về thư viện">
          ← <span>Thư viện</span>
        </Link>
        <div className="reader-title">
          <strong>{book.title}</strong>
          <span>{book.author}</span>
        </div>
        <div className="reader-controls" aria-label="Tùy chỉnh trình đọc">
          {book.format === "PDF" && (
            <button
              className="reader-download"
              disabled={downloading}
              onClick={downloadPdf}
              title={downloadError || "Tải PDF về máy"}
              type="button"
            >
              <span aria-hidden="true">⇩</span>
              <span>{downloading ? "Đang tải…" : "Tải PDF"}</span>
            </button>
          )}
          {downloadError && <span className="sr-only" role="alert">{downloadError}</span>}
          {book.format === "TXT" && (
            <>
              <button
                aria-label="Giảm cỡ chữ"
                disabled={fontSize <= 15}
                onClick={() => setFontSize((value) => Math.max(15, value - 1))}
                type="button"
              >
                A−
              </button>
              <button
                aria-label="Tăng cỡ chữ"
                disabled={fontSize >= 28}
                onClick={() => setFontSize((value) => Math.min(28, value + 1))}
                type="button"
              >
                A+
              </button>
              <select
                aria-label="Giãn dòng"
                value={lineHeight}
                onChange={(event) => setLineHeight(Number(event.target.value))}
              >
                <option value="1.55">Dòng gọn</option>
                <option value="1.75">Dòng vừa</option>
                <option value="2">Dòng rộng</option>
              </select>
            </>
          )}
          <select
            aria-label="Màu nền"
            value={theme}
            onChange={(event) => setTheme(event.target.value as Theme)}
          >
            <option value="paper">Sáng</option>
            <option value="sepia">Sepia</option>
            <option value="night">Tối</option>
          </select>
        </div>
      </header>

      <section
        className={`reader-stage${book.format === "PDF" ? " pdf-reader-stage" : ""}`}
        aria-label={`Đang đọc ${book.title}`}
      >
        {book.format === "PDF" ? (
          progressReady ? (
            <PdfReader
              bookId={book.id}
              initialProgress={progress}
              onProgress={scheduleProgress}
              title={book.title}
            />
          ) : (
            <div className="reader-message">Đang khôi phục trang đã đọc…</div>
          )
        ) : loadError ? (
          <div className="reader-message" role="alert">{loadError}</div>
        ) : text === null ? (
          <div className="reader-message">Đang tải nội dung…</div>
        ) : (
          <article className="text-reader" style={{ fontSize, lineHeight }}>
            {text}
          </article>
        )}
      </section>

      {book.format === "TXT" && (
        <footer className="reader-progress-bar">
          <label htmlFor="reading-progress">Tiến độ {progress}%</label>
          <input
            id="reading-progress"
            max="100"
            min="0"
            onChange={(event) => scheduleProgress(Number(event.target.value))}
            type="range"
            value={progress}
          />
        </footer>
      )}
    </main>
  );
}

function safePdfFilename(title: string) {
  const base = title
    .replace(/\.pdf$/i, "")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, 120) || "sach";
  return `${base}.pdf`;
}

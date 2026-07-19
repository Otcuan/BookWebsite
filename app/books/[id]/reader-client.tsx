"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { LibraryBook } from "@/lib/library-repository";

type Theme = "paper" | "night" | "sepia";

export function ReaderClient({ book }: { book: LibraryBook }) {
  const [theme, setTheme] = useState<Theme>("paper");
  const [fontSize, setFontSize] = useState(19);
  const [lineHeight, setLineHeight] = useState(1.75);
  const [text, setText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [progress, setProgress] = useState(book.progress);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      const stored = Number(localStorage.getItem(`reading-progress:${book.id}`));
      if (active && Number.isFinite(stored)) {
        setProgress(Math.min(100, Math.max(0, stored)));
      }
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

  function scheduleProgress(nextProgress: number) {
    setProgress(nextProgress);
    localStorage.setItem(`reading-progress:${book.id}`, String(nextProgress));
  }

  return (
    <main className={`reader-shell reader-${theme}`}>
      <header className="reader-toolbar">
        <Link className="reader-back" href="/" aria-label="Về thư viện">
          ← <span>Thư viện</span>
        </Link>
        <div className="reader-title">
          <strong>{book.title}</strong>
          <span>{book.author}</span>
        </div>
        <div className="reader-controls" aria-label="Tùy chỉnh trình đọc">
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

      <section className="reader-stage" aria-label={`Đang đọc ${book.title}`}>
        {book.format === "PDF" ? (
          <iframe
            className="pdf-frame"
            src={`/api/v1/books/${encodeURIComponent(book.id)}/content`}
            title={`Nội dung ${book.title}`}
          />
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
    </main>
  );
}

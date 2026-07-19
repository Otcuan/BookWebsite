"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { validateBookFile, validateCoverImage } from "@/lib/file-security";
import type { LibraryBook, StorageStats } from "@/lib/library-repository";
import { generateCoverFromPdf } from "@/lib/pdf-cover";
import type { LibraryQuote } from "@/lib/quotes";

type Viewer = {
  displayName: string;
  email: string | null;
  isOwner: boolean;
};

type Tone = "rain" | "arch" | "road" | "sun" | "type" | "forest";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function LibraryDashboard({
  viewer,
  initialBooks,
  initialStorage,
  ownerConfigured,
  quote,
  serviceError,
}: {
  viewer: Viewer;
  initialBooks: LibraryBook[];
  initialStorage: StorageStats;
  ownerConfigured: boolean;
  quote: LibraryQuote;
  serviceError: boolean;
}) {
  const [books, setBooks] = useState(initialBooks);
  const [storage, setStorage] = useState(initialStorage);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState<"recent" | "title">("recent");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadNotice, setUploadNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LibraryBook | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteNotice, setDeleteNotice] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      setBooks((current) =>
        current.map((book) => {
          const stored = Number(localStorage.getItem(`reading-progress:${book.id}`));
          return Number.isFinite(stored)
            ? { ...book, progress: Math.min(100, Math.max(0, stored)) }
            : book;
        }),
      );
    });
  }, []);

  useEffect(() => {
    const updateClock = () => setNow(new Date());
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const visibleBooks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("vi");
    const filtered = books.filter((book) =>
      `${book.title} ${book.author}`.toLocaleLowerCase("vi").includes(normalized),
    );

    return [...filtered].sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title, "vi")
        : Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
  }, [books, query, sort]);

  const activeBooks = useMemo(
    () => books.filter((book) => !book.deletionPending),
    [books],
  );
  const continueBooks = useMemo(
    () => activeBooks.filter((book) => book.progress > 0).slice(0, 3),
    [activeBooks],
  );
  const quotaPercent = Math.min(
    100,
    ((storage.committedBytes + storage.reservedBytes) / storage.hardLimitBytes) * 100,
  );
  const remainingBytes = Math.max(
    0,
    storage.hardLimitBytes - storage.committedBytes - storage.reservedBytes,
  );
  const currentTime = now ? formatTime(now) : "--:--:--";
  const currentDate = now ? formatDate(now) : "Đang cập nhật ngày";

  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadNotice("");
    setUploading(true);
    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const rawFile = data.get("file");
      if (!(rawFile instanceof File)) throw new Error("Hãy chọn một tệp PDF hoặc TXT.");
      const accepted = await validateBookFile(rawFile);
      const rawCover = data.get("cover");
      let coverFile = rawCover instanceof File && rawCover.size > 0 ? rawCover : null;
      let automaticCoverWarning = "";
      if (!coverFile && accepted.extension === "pdf") {
        setUploadNotice("Đang tạo ảnh bìa từ trang đầu PDF…");
        try {
          coverFile = await generateCoverFromPdf(rawFile);
        } catch (error) {
          automaticCoverWarning = error instanceof Error
            ? error.message
            : "Không thể tự tạo ảnh bìa; đã dùng bìa mặc định.";
        }
      }
      const acceptedCover = coverFile ? await validateCoverImage(coverFile) : null;
      const response = await fetch("/api/v1/books/upload", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: data.get("title"),
          author: data.get("author"),
          description: data.get("description"),
          fileName: rawFile.name,
          sizeBytes: rawFile.size,
          mimeType: accepted.mimeType,
          sha256: accepted.sha256,
          cover: coverFile && acceptedCover
            ? {
                fileName: coverFile.name,
                sizeBytes: coverFile.size,
                mimeType: acceptedCover.mimeType,
                sha256: acceptedCover.sha256,
              }
            : null,
        }),
      });
      const sessionPayload = (await response.json()) as {
        data?: {
          reservationId: string;
          uploadUrl: string;
          coverUploadUrl: string | null;
        };
        error?: { message?: string };
      };
      if (!response.ok || !sessionPayload.data) {
        throw new Error(sessionPayload.error?.message ?? "Không thể tạo phiên tải lên.");
      }

      setUploadNotice("Đang chuyển tệp trực tiếp đến kho R2…");
      const uploadResponse = await fetch(sessionPayload.data.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": accepted.mimeType },
        body: rawFile,
      });
      if (!uploadResponse.ok) {
        throw new Error("R2 từ chối tệp. Kiểm tra CORS và thử lại.");
      }

      if (coverFile && acceptedCover) {
        if (!sessionPayload.data.coverUploadUrl) {
          throw new Error("Không tạo được liên kết tải ảnh bìa.");
        }
        setUploadNotice("Đang chuyển ảnh bìa đến kho R2…");
        const coverResponse = await fetch(sessionPayload.data.coverUploadUrl, {
          method: "PUT",
          headers: { "Content-Type": acceptedCover.mimeType },
          body: coverFile,
        });
        if (!coverResponse.ok) {
          throw new Error("R2 từ chối ảnh bìa. Kiểm tra CORS và thử lại.");
        }
      }

      setUploadNotice("Đang kiểm tra chữ ký tệp và xuất bản…");
      const finalizeResponse = await fetch("/api/v1/books/upload/finalize", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId: sessionPayload.data.reservationId }),
      });
      const payload = (await finalizeResponse.json()) as {
        data?: LibraryBook;
        error?: { message?: string };
      };
      if (!finalizeResponse.ok || !payload.data) {
        throw new Error(payload.error?.message ?? "Không thể xuất bản sách.");
      }

      setBooks((current) => [payload.data!, ...current]);
      setStorage((current) => ({
        ...current,
        committedBytes: current.committedBytes + payload.data!.storageBytes,
      }));
      form.reset();
      setUploadNotice(
        automaticCoverWarning
          ? `Đã xuất bản sách. ${automaticCoverWarning} Hệ thống đang dùng bìa mặc định.`
          : "Đã kiểm tra và xuất bản sách thành công.",
      );
    } catch (error) {
      setUploadNotice(error instanceof Error ? error.message : "Tải lên thất bại.");
    } finally {
      setUploading(false);
    }
  }

  async function logout() {
    const response = await fetch("/api/v1/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    if (response.ok) window.location.assign("/");
  }

  function openDeleteDialog(book: LibraryBook) {
    setDeleteTarget(book);
    setDeleteConfirmation("");
    setDeleteNotice("");
  }

  function closeDeleteDialog() {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteConfirmation("");
    setDeleteNotice("");
  }

  async function confirmDelete() {
    if (!deleteTarget || deleteConfirmation !== deleteTarget.title) return;
    setDeleting(true);
    setDeleteNotice("Đang xóa tệp sách và ảnh bìa khỏi R2…");

    try {
      const response = await fetch(
        `/api/v1/books/${encodeURIComponent(deleteTarget.id)}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      const payload = (await response.json()) as {
        data?: {
          id: string;
          freedBytes: number;
          storage: StorageStats;
        };
        error?: {
          message?: string;
          details?: { deletionPending?: number };
        };
      };

      if (!response.ok || !payload.data) {
        if (payload.error?.details?.deletionPending === 1) {
          setBooks((current) => current.map((book) =>
            book.id === deleteTarget.id
              ? { ...book, coverUrl: null, deletionPending: true }
              : book,
          ));
          setDeleteTarget((current) => current
            ? { ...current, coverUrl: null, deletionPending: true }
            : current,
          );
        }
        throw new Error(payload.error?.message ?? "Không thể xóa sách.");
      }

      setBooks((current) => current.filter((book) => book.id !== payload.data!.id));
      setStorage(payload.data.storage);
      localStorage.removeItem(`reading-progress:${payload.data.id}`);
      setDeleteTarget(null);
      setDeleteConfirmation("");
      setDeleteNotice("");
    } catch (error) {
      setDeleteNotice(error instanceof Error ? error.message : "Không thể xóa sách.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="library-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Tủ sách của Tuấn — về đầu trang">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>Tủ sách của Tuấn</span>
        </a>

        <nav className="main-nav" aria-label="Điều hướng chính">
          <a className="active" href="#library">Thư viện</a>
          <a href="#continue">Đang đọc</a>
        </nav>

        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Tìm sách</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm theo tên sách hoặc tác giả"
          />
        </label>

        {viewer.isOwner ? (
          <button className="avatar" title="Đăng xuất chủ kho" onClick={logout} type="button">
            {initials(viewer.displayName)}
          </button>
        ) : (
          <a className="avatar" href="/admin/login" title="Đăng nhập chủ kho">
            {initials(viewer.displayName)}
          </a>
        )}

        {viewer.isOwner && (
          <button className="upload-button" type="button" onClick={() => setUploadOpen(true)}>
            <span aria-hidden="true">↥</span>
            Tải sách lên
          </button>
        )}
      </header>

      <div className="page" id="top">
        {(serviceError || !ownerConfigured) && (
          <div className="configuration-banner" role="status">
            {serviceError
              ? "Kho dữ liệu Vercel chưa được kết nối với Cloudflare D1/R2."
              : "Quyền tải lên chưa bật. Chủ kho cần cấu hình hash mật khẩu và session secret."}
          </div>
        )}

        <section
          className={`hero${viewer.isOwner ? "" : " hero-public"}`}
          aria-labelledby="hero-title"
        >
          <div>
            <p className="eyebrow">Thư viện của Tuấn</p>
            <blockquote className="hero-quote">
              <h1 id="hero-title">“{quote.text}”</h1>
              <cite>— {quote.author}, <span>{quote.source}</span></cite>
            </blockquote>
            <div className="hero-datetime" aria-label="Ngày giờ hiện tại tại Việt Nam">
              <time dateTime={now?.toISOString()}>
                <span aria-hidden="true">◷</span>
                {currentTime}
              </time>
              <time dateTime={now?.toISOString()}>
                <span aria-hidden="true">▦</span>
                {currentDate}
              </time>
            </div>
            <div className="library-stat" aria-label={`Thư viện có ${activeBooks.length} cuốn`}>
              <span aria-hidden="true">▥</span>
              <strong>{activeBooks.length} cuốn</strong>
              {viewer.isOwner && (
                <>
                  <i>·</i>
                  <span>{formatBytes(storage.committedBytes)}</span>
                </>
              )}
            </div>
          </div>
          {viewer.isOwner && (
            <div className="quota-panel" aria-label="Dung lượng R2">
              <div className="quota-heading">
                <span>Dung lượng an toàn</span>
                <strong>
                  {formatBytes(storage.committedBytes + storage.reservedBytes)} / 9 GB
                </strong>
              </div>
              <div className="quota-track" aria-hidden="true">
                <span style={{ width: `${quotaPercent}%` }} />
              </div>
              <p>Còn {formatBytes(remainingBytes)} trước hard quota miễn phí.</p>
            </div>
          )}
        </section>

        {continueBooks.length > 0 && (
          <section className="continue-section" id="continue" aria-labelledby="continue-title">
            <div className="section-heading">
              <div>
                <p className="section-kicker">Quay lại vị trí gần nhất</p>
                <h2 id="continue-title">Đọc tiếp</h2>
              </div>
              <a href="#library">Xem tất cả</a>
            </div>

            <div className="continue-grid">
              {continueBooks.map((book) => (
                <a className="continue-card" href={`/books/${book.id}`} key={book.id}>
                  <BookCover coverUrl={book.coverUrl} tone={coverTone(book.id)} title={book.title} />
                  <div className="continue-info">
                    <div>
                      <h3>{book.title}</h3>
                      <p>{book.author}</p>
                      <span>{book.format} · {formatBytes(book.sizeBytes)}</span>
                    </div>
                    <div>
                      <div className="progress-copy">
                        <strong>{book.progress}%</strong>
                        <span>Đã lưu tiến độ</span>
                      </div>
                      <div className="progress-track" aria-label={`Đã đọc ${book.progress}%`}>
                        <span style={{ width: `${book.progress}%` }} />
                      </div>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        <section className="all-library" id="library" aria-labelledby="library-title">
          <div className="library-toolbar">
            <div>
              <p className="section-kicker">{visibleBooks.length} kết quả đang hiển thị</p>
              <h2 id="library-title">Toàn bộ thư viện</h2>
            </div>
            <div className="toolbar-actions">
              <label>
                <span className="sr-only">Sắp xếp</span>
                <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                  <option value="recent">Mới cập nhật</option>
                  <option value="title">Tên A–Z</option>
                </select>
              </label>
              <div className="view-switcher" aria-label="Kiểu hiển thị">
                <button
                  aria-label="Hiển thị dạng lưới"
                  aria-pressed={view === "grid"}
                  className={view === "grid" ? "selected" : ""}
                  onClick={() => setView("grid")}
                  type="button"
                >▦</button>
                <button
                  aria-label="Hiển thị dạng danh sách"
                  aria-pressed={view === "list"}
                  className={view === "list" ? "selected" : ""}
                  onClick={() => setView("list")}
                  type="button"
                >☷</button>
              </div>
            </div>
          </div>

          {visibleBooks.length > 0 ? (
            <div className={`book-collection ${view}`}>
              {visibleBooks.map((book) => {
                const tileContent = (
                  <>
                    <BookCover
                      coverUrl={book.coverUrl}
                      tone={coverTone(book.id)}
                      title={book.title}
                    />
                    <div className="book-meta">
                      <h3>{book.title}</h3>
                      <p>{book.author}</p>
                      <span>{book.format} · {formatBytes(book.sizeBytes)}</span>
                    </div>
                  </>
                );

                return (
                  <article
                    className={`book-tile${book.deletionPending ? " deletion-pending" : ""}`}
                    key={book.id}
                  >
                    {book.deletionPending ? (
                      <div aria-disabled="true" className="book-tile-link">
                        {tileContent}
                      </div>
                    ) : (
                      <a className="book-tile-link" href={`/books/${book.id}`}>
                        {tileContent}
                      </a>
                    )}
                    {book.deletionPending && (
                      <span className="deletion-badge">Đang chờ xóa</span>
                    )}
                    {viewer.isOwner && (
                      <button
                        aria-label={`${book.deletionPending ? "Thử xóa lại" : "Xóa"} sách ${book.title}`}
                        className="book-delete-button"
                        onClick={() => openDeleteDialog(book)}
                        title={book.deletionPending ? "Thử xóa lại" : "Xóa sách"}
                        type="button"
                      >
                        <span aria-hidden="true">⌫</span>
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <span aria-hidden="true">⌕</span>
              <h3>{query ? "Không tìm thấy sách phù hợp" : "Kho sách đang trống"}</h3>
              <p>
                {query
                  ? "Thử tìm bằng tên tác giả hoặc một phần tiêu đề khác."
                  : viewer.isOwner
                    ? "Tải lên cuốn PDF hoặc TXT đầu tiên để bắt đầu."
                    : "Chủ thư viện chưa xuất bản cuốn sách nào."}
              </p>
              {query && <button type="button" onClick={() => setQuery("")}>Xóa tìm kiếm</button>}
            </div>
          )}
        </section>
      </div>

      {uploadOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !uploading && setUploadOpen(false)}>
          <section
            aria-labelledby="upload-title"
            aria-modal="true"
            className="upload-modal"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <p className="section-kicker">Chỉ chủ thư viện</p>
                <h2 id="upload-title">Tải sách mới</h2>
              </div>
              <button aria-label="Đóng" disabled={uploading} onClick={() => setUploadOpen(false)} type="button">×</button>
            </div>
            <form onSubmit={submitUpload}>
              <label>
                Tệp PDF hoặc TXT
                <input accept=".pdf,.txt,application/pdf,text/plain" name="file" required type="file" />
              </label>
              <label>
                Ảnh bìa <span className="optional">(tùy chọn ghi đè)</span>
                <input
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  name="cover"
                  type="file"
                />
              </label>
              <div className="form-row">
                <label>
                  Tên sách
                  <input maxLength={160} name="title" required type="text" />
                </label>
                <label>
                  Tác giả
                  <input maxLength={120} name="author" required type="text" />
                </label>
              </div>
              <label>
                Mô tả ngắn <span className="optional">(không bắt buộc)</span>
                <textarea maxLength={2000} name="description" rows={3} />
              </label>
              <p className="upload-help">
                Sách tối đa 100 MiB; ảnh bìa JPG/PNG/WebP tối đa 3 MiB. Các tệp đi thẳng
                đến R2; server chỉ xuất bản sau khi kiểm tra MIME, kích thước, chữ ký tệp
                và hard quota 9 GB. Nếu để trống ảnh bìa, trang đầu PDF sẽ tự động được
                render thành bìa; TXT tiếp tục dùng bìa minh họa mặc định.
              </p>
              {uploadNotice && <p className="notice" role="status">{uploadNotice}</p>}
              <button className="upload-button modal-submit" disabled={uploading} type="submit">
                {uploading ? "Đang kiểm tra…" : "Kiểm tra và tải lên"}
              </button>
            </form>
          </section>
        </div>
      )}

      {deleteTarget && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={closeDeleteDialog}
        >
          <section
            aria-describedby="delete-description"
            aria-labelledby="delete-title"
            aria-modal="true"
            className="delete-modal"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <p className="section-kicker">Chỉ chủ thư viện</p>
                <h2 id="delete-title">
                  {deleteTarget.deletionPending ? "Thử xóa lại?" : "Xóa vĩnh viễn?"}
                </h2>
              </div>
              <button
                aria-label="Đóng"
                disabled={deleting}
                onClick={closeDeleteDialog}
                type="button"
              >×</button>
            </div>
            <p id="delete-description" className="delete-warning">
              PDF/TXT, ảnh bìa và metadata của <strong>{deleteTarget.title}</strong> sẽ bị
              xóa khỏi R2 và D1. Thao tác này không thể hoàn tác.
            </p>
            {deleteTarget.deletionPending && (
              <p className="pending-warning">
                Lần xóa trước chưa hoàn tất. Sách hiện đã được ẩn với bạn đọc;
                hãy xác nhận để hệ thống dọn phần còn lại.
              </p>
            )}
            <label className="delete-confirmation-label">
              Nhập chính xác tên sách để xác nhận
              <input
                autoComplete="off"
                autoFocus
                disabled={deleting}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                placeholder={deleteTarget.title}
                type="text"
                value={deleteConfirmation}
              />
            </label>
            {deleteNotice && <p className="delete-notice" role="status">{deleteNotice}</p>}
            <div className="delete-actions">
              <button disabled={deleting} onClick={closeDeleteDialog} type="button">
                Hủy
              </button>
              <button
                className="confirm-delete-button"
                disabled={deleting || deleteConfirmation !== deleteTarget.title}
                onClick={confirmDelete}
                type="button"
              >
                {deleting ? "Đang xóa…" : "Xóa vĩnh viễn"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function BookCover({
  coverUrl,
  tone,
  title,
}: {
  coverUrl: string | null;
  tone: Tone;
  title: string;
}) {
  return (
    <div
      className={`book-cover ${tone}${coverUrl ? " has-image" : ""}`}
      aria-label={`Bìa sách ${title}`}
      role="img"
    >
      {coverUrl ? (
        // The parent supplies the accessible label; an empty alt avoids duplicate narration.
        <Image
          alt=""
          className="book-cover-image"
          fill
          sizes="(max-width: 580px) 50vw, (max-width: 820px) 33vw, 17vw"
          src={coverUrl}
          unoptimized
        />
      ) : (
        <>
          <span className="cover-line one" />
          <span className="cover-line two" />
          <span className="cover-orb" />
          <small>{title}</small>
        </>
      )}
    </div>
  );
}

function coverTone(id: string): Tone {
  const tones: Tone[] = ["rain", "arch", "road", "sun", "type", "forest"];
  const sum = Array.from(id).reduce((total, character) => total + character.charCodeAt(0), 0);
  return tones[sum % tones.length];
}

const timeFormatter = new Intl.DateTimeFormat("vi-VN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "Asia/Ho_Chi_Minh",
});

const weekdayFormatter = new Intl.DateTimeFormat("vi-VN", {
  weekday: "long",
  timeZone: "Asia/Ho_Chi_Minh",
});

const dateFormatter = new Intl.DateTimeFormat("vi-VN", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});

function formatTime(value: Date): string {
  return timeFormatter.format(value);
}

function formatDate(value: Date): string {
  const weekday = weekdayFormatter.format(value);
  return `${weekday.charAt(0).toLocaleUpperCase("vi")}${weekday.slice(1)}, ${dateFormatter.format(value)}`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let amount = value;
  let unit = "B";
  for (const nextUnit of units) {
    amount /= 1024;
    unit = nextUnit;
    if (amount < 1024 || nextUnit === "GB") break;
  }
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(amount)} ${unit}`;
}

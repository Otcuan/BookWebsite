"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  loadSafePdfOutline,
  MAX_PDF_SEARCH_LENGTH,
  MIN_PDF_SEARCH_LENGTH,
  normalizePdfSearchQuery,
  PdfSearchCancelledError,
  resolvePdfDestinationPage,
  searchPdfDocument,
  type PdfOutlineItem,
  type PdfSearchResult,
} from "@/lib/pdf-document-tools";
import {
  emptyReaderLocalData,
  MAX_LOCAL_NOTE_LENGTH,
  parseReaderLocalData,
  readerStorageKey,
  renameLocalBookmark,
  serializeReaderLocalData,
  setLocalNote,
  toggleLocalBookmark,
  type ReaderLocalData,
} from "@/lib/reader-local-data";

type ToolTab = "outline" | "search" | "saved";

export function PdfToolsDrawer({
  bookId,
  document,
  open,
  onClose,
  onNavigate,
  pageCount,
  pageNumber,
  title,
}: {
  bookId: string;
  document: PDFDocumentProxy;
  open: boolean;
  onClose: () => void;
  onNavigate: (page: number) => void;
  pageCount: number;
  pageNumber: number;
  title: string;
}) {
  const [activeTab, setActiveTab] = useState<ToolTab>("outline");
  const [outlineState, setOutlineState] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    items: PdfOutlineItem[];
  }>({ status: "idle", items: [] });
  const [outlineNotice, setOutlineNotice] = useState("");
  const [resolvingOutlineId, setResolvingOutlineId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PdfSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState("");
  const searchRequestRef = useRef(0);
  const [localData, setLocalData] = useState<ReaderLocalData>(emptyReaderLocalData);
  const [localReady, setLocalReady] = useState(false);
  const [localSaveError, setLocalSaveError] = useState("");

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        searchRequestRef.current += 1;
        setSearching(false);
        onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || activeTab !== "outline" || outlineState.status !== "idle") return;
    let cancelled = false;
    queueMicrotask(async () => {
      setOutlineState({ status: "loading", items: [] });
      try {
        const items = await loadSafePdfOutline(document);
        if (!cancelled) setOutlineState({ status: "ready", items });
      } catch {
        if (!cancelled) setOutlineState({ status: "error", items: [] });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab, document, open, outlineState.status]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      let parsed = emptyReaderLocalData();
      try {
        parsed = parseReaderLocalData(
          localStorage.getItem(readerStorageKey(bookId)),
          pageCount,
        );
      } catch {
        // Storage can be blocked in privacy modes. The reader remains usable.
      }
      if (active) {
        setLocalData(parsed);
        setLocalReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, [bookId, pageCount]);

  useEffect(() => {
    if (!localReady) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(
          readerStorageKey(bookId),
          serializeReaderLocalData(localData),
        );
        setLocalSaveError("");
      } catch {
        setLocalSaveError("Trình duyệt không thể lưu thêm bookmark hoặc ghi chú.");
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [bookId, localData, localReady]);

  useEffect(() => () => {
    searchRequestRef.current += 1;
  }, []);

  function closeDrawer() {
    searchRequestRef.current += 1;
    setSearching(false);
    onClose();
  }

  function selectTab(tab: ToolTab) {
    if (tab !== "search" && searching) cancelSearch();
    setActiveTab(tab);
  }

  async function navigateOutline(item: PdfOutlineItem) {
    if (!item.destination || resolvingOutlineId) return;
    setResolvingOutlineId(item.id);
    setOutlineNotice("");
    try {
      const page = await resolvePdfDestinationPage(document, item.destination);
      if (page === null) {
        setOutlineNotice("Mục này không trỏ tới một trang hợp lệ.");
      } else {
        onNavigate(page);
      }
    } catch {
      setOutlineNotice("Không thể mở mục lục này.");
    } finally {
      setResolvingOutlineId("");
    }
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (normalizePdfSearchQuery(searchQuery).length < MIN_PDF_SEARCH_LENGTH) {
      setSearchResults([]);
      setSearchProgress(`Nhập ít nhất ${MIN_PDF_SEARCH_LENGTH} ký tự.`);
      return;
    }

    const requestId = ++searchRequestRef.current;
    setSearching(true);
    setSearchResults([]);
    setSearchProgress("Đang chuẩn bị tìm kiếm…");
    try {
      const results = await searchPdfDocument(document, searchQuery, {
        isCancelled: () => requestId !== searchRequestRef.current,
        onProgress: (page, total) => {
          if (requestId === searchRequestRef.current) {
            setSearchProgress(`Đang quét trang ${page}/${total}…`);
          }
        },
      });
      if (requestId !== searchRequestRef.current) return;
      setSearchResults(results);
      setSearchProgress(
        results.length > 0
          ? `Tìm thấy ở ${results.length} trang.`
          : "Không tìm thấy. PDF scan ảnh cần OCR mới có thể tìm chữ.",
      );
    } catch (error) {
      if (!(error instanceof PdfSearchCancelledError) && requestId === searchRequestRef.current) {
        setSearchProgress("Không thể hoàn tất tìm kiếm trong PDF này.");
      }
    } finally {
      if (requestId === searchRequestRef.current) setSearching(false);
    }
  }

  function cancelSearch() {
    searchRequestRef.current += 1;
    setSearching(false);
    setSearchProgress("Đã dừng tìm kiếm.");
  }

  const currentBookmark = localData.bookmarks.find(
    (bookmark) => bookmark.page === pageNumber,
  );
  const currentNote = localData.notes.find((note) => note.page === pageNumber);

  if (!open) return null;

  return (
    <>
      <button
        aria-label="Đóng công cụ đọc"
        className="pdf-tools-scrim"
        onClick={closeDrawer}
        type="button"
      />
      <aside
        aria-label={`Công cụ đọc ${title}`}
        aria-modal="true"
        className="pdf-tools-drawer"
        role="dialog"
      >
        <header className="pdf-tools-header">
          <div>
            <span>Công cụ PDF</span>
            <strong>Trang {pageNumber}/{pageCount}</strong>
          </div>
          <button aria-label="Đóng công cụ" autoFocus onClick={closeDrawer} type="button">×</button>
        </header>

        <nav aria-label="Nhóm công cụ PDF" className="pdf-tools-tabs">
          <ToolTabButton activeTab={activeTab} id="outline" onSelect={selectTab}>
            Mục lục
          </ToolTabButton>
          <ToolTabButton activeTab={activeTab} id="search" onSelect={selectTab}>
            Tìm kiếm
          </ToolTabButton>
          <ToolTabButton activeTab={activeTab} id="saved" onSelect={selectTab}>
            Đã lưu
          </ToolTabButton>
        </nav>

        <div className="pdf-tools-content">
          {activeTab === "outline" && (
            <section aria-label="Mục lục PDF">
              {outlineState.status === "loading" && <ToolNotice>Đang đọc mục lục…</ToolNotice>}
              {outlineState.status === "error" && (
                <ToolNotice>Không thể đọc mục lục của PDF này.</ToolNotice>
              )}
              {outlineState.status === "ready" && outlineState.items.length === 0 && (
                <ToolNotice>PDF này không có mục lục nhúng.</ToolNotice>
              )}
              {outlineState.items.length > 0 && (
                <OutlineTree
                  items={outlineState.items}
                  onNavigate={navigateOutline}
                  resolvingId={resolvingOutlineId}
                />
              )}
              {outlineNotice && <p className="pdf-tool-error" role="status">{outlineNotice}</p>}
            </section>
          )}

          {activeTab === "search" && (
            <section aria-label="Tìm kiếm trong PDF">
              <form className="pdf-search-form" onSubmit={submitSearch}>
                <label>
                  <span className="sr-only">Từ khóa trong PDF</span>
                  <input
                    autoComplete="off"
                    maxLength={MAX_PDF_SEARCH_LENGTH}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Nhập từ khóa…"
                    type="search"
                    value={searchQuery}
                  />
                </label>
                {searching ? (
                  <button onClick={cancelSearch} type="button">Dừng</button>
                ) : (
                  <button type="submit">Tìm</button>
                )}
              </form>
              <p aria-live="polite" className="pdf-search-status">{searchProgress}</p>
              <div className="pdf-search-results">
                {searchResults.map((result) => (
                  <button
                    key={result.page}
                    onClick={() => onNavigate(result.page)}
                    type="button"
                  >
                    <strong>Trang {result.page}</strong>
                    <span>{result.snippet || "Có từ khóa trên trang này."}</span>
                    <small>{result.occurrences} kết quả trên trang</small>
                  </button>
                ))}
              </div>
              <p className="pdf-tool-footnote">
                Tìm kiếm chạy trên thiết bị của bạn và chỉ bắt đầu khi bấm Tìm.
              </p>
            </section>
          )}

          {activeTab === "saved" && (
            <section aria-label="Bookmark và ghi chú cục bộ">
              <div className="pdf-current-page-save">
                <button
                  aria-pressed={Boolean(currentBookmark)}
                  onClick={() => setLocalData((data) =>
                    toggleLocalBookmark(data, pageNumber, pageCount)
                  )}
                  type="button"
                >
                  <span aria-hidden="true">{currentBookmark ? "★" : "☆"}</span>
                  {currentBookmark ? "Bỏ bookmark trang này" : "Bookmark trang này"}
                </button>
                <label>
                  Ghi chú trang {pageNumber}
                  <textarea
                    maxLength={MAX_LOCAL_NOTE_LENGTH}
                    onChange={(event) => setLocalData((data) =>
                      setLocalNote(data, pageNumber, pageCount, event.target.value)
                    )}
                    placeholder="Ghi ý chính hoặc điều muốn nhớ…"
                    rows={5}
                    value={currentNote?.content ?? ""}
                  />
                </label>
                <small>{currentNote?.content.length ?? 0}/{MAX_LOCAL_NOTE_LENGTH} · tự động lưu</small>
              </div>

              {localSaveError && <p className="pdf-tool-error" role="alert">{localSaveError}</p>}

              <SavedItems
                data={localData}
                onChange={setLocalData}
                onNavigate={onNavigate}
                pageCount={pageCount}
              />
              <p className="pdf-tool-footnote">
                Dữ liệu chỉ nằm trên trình duyệt này và có thể mất khi xóa dữ liệu website.
              </p>
            </section>
          )}
        </div>
      </aside>
    </>
  );
}

function ToolTabButton({
  activeTab,
  children,
  id,
  onSelect,
}: {
  activeTab: ToolTab;
  children: React.ReactNode;
  id: ToolTab;
  onSelect: (tab: ToolTab) => void;
}) {
  return (
    <button
      aria-selected={activeTab === id}
      className={activeTab === id ? "active" : ""}
      onClick={() => onSelect(id)}
      role="tab"
      type="button"
    >
      {children}
    </button>
  );
}

function ToolNotice({ children }: { children: React.ReactNode }) {
  return <p className="pdf-tool-notice" role="status">{children}</p>;
}

function OutlineTree({
  items,
  onNavigate,
  resolvingId,
}: {
  items: PdfOutlineItem[];
  onNavigate: (item: PdfOutlineItem) => void;
  resolvingId: string;
}) {
  return (
    <ul className="pdf-outline-tree">
      {items.map((item) => (
        <li key={item.id}>
          {item.destination ? (
            <button
              disabled={Boolean(resolvingId)}
              onClick={() => onNavigate(item)}
              type="button"
            >
              <span>{item.title}</span>
              <small aria-hidden="true">{resolvingId === item.id ? "…" : "›"}</small>
            </button>
          ) : (
            <span className="pdf-outline-heading">{item.title}</span>
          )}
          {item.children.length > 0 && (
            <OutlineTree
              items={item.children}
              onNavigate={onNavigate}
              resolvingId={resolvingId}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

function SavedItems({
  data,
  onChange,
  onNavigate,
  pageCount,
}: {
  data: ReaderLocalData;
  onChange: React.Dispatch<React.SetStateAction<ReaderLocalData>>;
  onNavigate: (page: number) => void;
  pageCount: number;
}) {
  return (
    <div className="pdf-saved-groups">
      <section>
        <h3>Bookmark ({data.bookmarks.length})</h3>
        {data.bookmarks.length === 0 ? (
          <p>Chưa có bookmark.</p>
        ) : (
          <ul>
            {data.bookmarks.map((bookmark) => (
              <li key={bookmark.page}>
                <button onClick={() => onNavigate(bookmark.page)} type="button">
                  Trang {bookmark.page}
                </button>
                <input
                  aria-label={`Tên bookmark trang ${bookmark.page}`}
                  maxLength={120}
                  onBlur={(event) => onChange((current) =>
                    renameLocalBookmark(
                      current,
                      bookmark.page,
                      event.target.value.trim() || `Trang ${bookmark.page}`,
                    )
                  )}
                  onChange={(event) => onChange((current) =>
                    renameLocalBookmark(current, bookmark.page, event.target.value)
                  )}
                  value={bookmark.label}
                />
                <button
                  aria-label={`Xóa bookmark trang ${bookmark.page}`}
                  className="pdf-saved-delete"
                  onClick={() => onChange((current) =>
                    toggleLocalBookmark(current, bookmark.page, pageCount)
                  )}
                  type="button"
                >×</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>Ghi chú ({data.notes.length})</h3>
        {data.notes.length === 0 ? (
          <p>Chưa có ghi chú.</p>
        ) : (
          <ul className="pdf-note-list">
            {data.notes.map((note) => (
              <li key={note.page}>
                <button onClick={() => onNavigate(note.page)} type="button">
                  <strong>Trang {note.page}</strong>
                  <span>{note.content.replace(/\s+/g, " ").slice(0, 90)}</span>
                </button>
                <button
                  aria-label={`Xóa ghi chú trang ${note.page}`}
                  className="pdf-saved-delete"
                  onClick={() => onChange((current) =>
                    setLocalNote(current, note.page, pageCount, "")
                  )}
                  type="button"
                >×</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

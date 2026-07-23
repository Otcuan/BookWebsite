"use client";

import { useState } from "react";
import type {
  OperationsHealth,
  OrphanObject,
  OrphanScanPage,
} from "@/lib/operations-repository";

type OrphanSummary = {
  scanned: number;
  referenced: number;
  candidateCount: number;
  protectedCount: number;
  candidates: OrphanObject[];
  pages: number;
  truncated: boolean;
};

const EMPTY_ORPHANS: OrphanSummary = {
  scanned: 0,
  referenced: 0,
  candidateCount: 0,
  protectedCount: 0,
  candidates: [],
  pages: 0,
  truncated: false,
};

const MAX_PAGES_PER_PREFIX = 25;
const MAX_CANDIDATE_PREVIEW = 100;

export function OperationsDashboard() {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<OperationsHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthNotice, setHealthNotice] = useState("");
  const [orphanSummary, setOrphanSummary] =
    useState<OrphanSummary>(EMPTY_ORPHANS);
  const [orphanLoading, setOrphanLoading] = useState(false);
  const [orphanNotice, setOrphanNotice] = useState("");

  function openDashboard() {
    setOpen(true);
    if (!health && !healthLoading) void runHealthCheck();
  }

  async function runHealthCheck() {
    setHealthLoading(true);
    setHealthNotice("Đang kiểm tra D1 và R2…");
    try {
      const response = await fetch("/api/v1/admin/operations/health", {
        method: "POST",
        credentials: "same-origin",
      });
      const payload = (await response.json()) as {
        data?: OperationsHealth;
        error?: { message?: string };
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message ?? "Health check thất bại.");
      }
      setHealth(payload.data);
      setHealthNotice(
        payload.data.status === "healthy"
          ? "Mọi kiểm tra đang đạt."
          : "Có mục cần admin xem chi tiết.",
      );
    } catch (error) {
      setHealthNotice(
        error instanceof Error ? error.message : "Health check thất bại.",
      );
    } finally {
      setHealthLoading(false);
    }
  }

  async function scanOrphans() {
    setOrphanLoading(true);
    setOrphanSummary(EMPTY_ORPHANS);
    setOrphanNotice("Đang quét namespace books/…");
    const aggregate: OrphanSummary = { ...EMPTY_ORPHANS, candidates: [] };

    try {
      for (const prefix of ["books/", "covers/"] as const) {
        let continuationToken: string | undefined;
        let prefixPages = 0;
        do {
          if (prefixPages >= MAX_PAGES_PER_PREFIX) {
            aggregate.truncated = true;
            break;
          }
          setOrphanNotice(
            `Đang quét ${prefix} — trang ${prefixPages + 1}/${MAX_PAGES_PER_PREFIX}…`,
          );
          const response = await fetch("/api/v1/admin/operations/orphans", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prefix, continuationToken }),
          });
          const payload = (await response.json()) as {
            data?: OrphanScanPage;
            error?: { message?: string };
          };
          if (!response.ok || !payload.data) {
            throw new Error(payload.error?.message ?? `Không quét được ${prefix}.`);
          }
          const page = payload.data;
          prefixPages += 1;
          aggregate.pages += 1;
          aggregate.scanned += page.scanned;
          aggregate.referenced += page.referenced;
          aggregate.candidateCount += page.candidates.length;
          aggregate.protectedCount += page.protectedUnreferenced.length;
          if (aggregate.candidates.length < MAX_CANDIDATE_PREVIEW) {
            aggregate.candidates.push(
              ...page.candidates.slice(
                0,
                MAX_CANDIDATE_PREVIEW - aggregate.candidates.length,
              ),
            );
          }
          continuationToken = page.nextContinuationToken ?? undefined;
          setOrphanSummary({ ...aggregate, candidates: [...aggregate.candidates] });
        } while (continuationToken);
      }

      setOrphanSummary({ ...aggregate, candidates: [...aggregate.candidates] });
      setOrphanNotice(
        aggregate.truncated
          ? "Đã dừng ở giới hạn an toàn 25 trang/prefix; kết quả chưa bao phủ toàn bộ R2."
          : aggregate.candidateCount === 0
            ? "Quét xong: không phát hiện object mồ côi đã qua grace period."
            : `Quét xong: phát hiện ${aggregate.candidateCount} object cần kiểm tra thủ công.`,
      );
    } catch (error) {
      setOrphanNotice(
        error instanceof Error ? error.message : "Orphan scan thất bại.",
      );
    } finally {
      setOrphanLoading(false);
    }
  }

  return (
    <>
      <button
        className="operations-launch"
        onClick={openDashboard}
        type="button"
      >
        <span aria-hidden="true">◉</span>
        Kiểm tra vận hành
      </button>

      {open && (
        <div
          className="modal-backdrop"
          onMouseDown={() => !healthLoading && !orphanLoading && setOpen(false)}
          role="presentation"
        >
          <section
            aria-labelledby="operations-title"
            aria-modal="true"
            className="operations-modal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="modal-header">
              <div>
                <p className="section-kicker">Chỉ chủ thư viện</p>
                <h2 id="operations-title">Trung tâm vận hành</h2>
              </div>
              <button
                aria-label="Đóng"
                disabled={healthLoading || orphanLoading}
                onClick={() => setOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <section className="operations-section" aria-labelledby="health-title">
              <div className="operations-section-heading">
                <div>
                  <h3 id="health-title">Sức khỏe hệ thống</h3>
                  <p>Chỉ chạy khi admin yêu cầu, không polling nền.</p>
                </div>
                <button
                  disabled={healthLoading}
                  onClick={runHealthCheck}
                  type="button"
                >
                  {healthLoading ? "Đang kiểm tra…" : "Kiểm tra lại"}
                </button>
              </div>

              {health && (
                <>
                  <div className="health-grid">
                    <HealthCard
                      label="Tổng thể"
                      message={statusCopy(health.status)}
                      status={health.status}
                    />
                    <HealthCard
                      label="Cloudflare D1"
                      message={`${health.d1.message} · ${health.d1.latencyMs} ms`}
                      status={health.d1.status}
                    />
                    <HealthCard
                      label="Cloudflare R2"
                      message={`${health.r2.message} · ${health.r2.latencyMs} ms`}
                      status={health.r2.status}
                    />
                  </div>
                  {health.d1.stats && (
                    <dl className="health-metrics">
                      <div>
                        <dt>Sách đã xuất bản</dt>
                        <dd>{health.d1.stats.publishedBooks}</dd>
                      </div>
                      <div>
                        <dt>Đang chờ xóa</dt>
                        <dd>{health.d1.stats.deletionPending}</dd>
                      </div>
                      <div>
                        <dt>Reservation hết hạn</dt>
                        <dd>{health.d1.stats.expiredReservations}</dd>
                      </div>
                      <div>
                        <dt>Quota metadata</dt>
                        <dd>
                          {formatBytes(
                            health.d1.stats.committedBytes +
                              health.d1.stats.reservedBytes,
                          )}{" "}
                          / {formatBytes(health.d1.stats.hardLimitBytes)}
                        </dd>
                      </div>
                    </dl>
                  )}
                </>
              )}
              {healthNotice && (
                <p className="operations-notice" role="status">
                  {healthNotice}
                </p>
              )}
            </section>

            <section className="operations-section" aria-labelledby="orphan-title">
              <div className="operations-section-heading">
                <div>
                  <h3 id="orphan-title">Object R2 mồ côi</h3>
                  <p>
                    Chỉ báo cáo `books/` và `covers/`; không tự động xóa.
                  </p>
                </div>
                <button
                  disabled={orphanLoading}
                  onClick={scanOrphans}
                  type="button"
                >
                  {orphanLoading ? "Đang quét…" : "Quét R2"}
                </button>
              </div>

              {(orphanSummary.pages > 0 || orphanLoading) && (
                <dl className="orphan-summary">
                  <div><dt>Đã quét</dt><dd>{orphanSummary.scanned}</dd></div>
                  <div><dt>Có tham chiếu</dt><dd>{orphanSummary.referenced}</dd></div>
                  <div><dt>Candidate</dt><dd>{orphanSummary.candidateCount}</dd></div>
                  <div><dt>Grace period</dt><dd>{orphanSummary.protectedCount}</dd></div>
                </dl>
              )}
              {orphanSummary.candidates.length > 0 && (
                <div className="orphan-results">
                  <p>
                    Chỉ hiển thị tối đa {MAX_CANDIDATE_PREVIEW} object. Hãy backup
                    và đối chiếu trước khi xóa thủ công trên Cloudflare.
                  </p>
                  <ul>
                    {orphanSummary.candidates.map((object) => (
                      <li key={object.key}>
                        <code>{object.key}</code>
                        <span>
                          {formatBytes(object.sizeBytes)} ·{" "}
                          {formatAge(object.ageSeconds)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {orphanNotice && (
                <p className="operations-notice" role="status">
                  {orphanNotice}
                </p>
              )}
            </section>

            <section className="operations-section backup-runbook">
              <h3>Backup/restore</h3>
              <p>
                Full backup nằm trên máy admin nên dashboard cloud không thể tự
                xác nhận lần backup gần nhất. Chạy tuần tự trong terminal:
              </p>
              <code>npm run ops:backup</code>
              <code>npm run ops:verify-backup -- backups/&lt;thư-mục&gt;</code>
              <p>
                Chỉ dòng <strong>RESTORE TEST ĐẠT</strong> mới xác nhận backup hợp
                lệ. Không upload, sửa hoặc xóa sách trong lúc backup.
              </p>
            </section>
          </section>
        </div>
      )}
    </>
  );
}

function HealthCard({
  label,
  message,
  status,
}: {
  label: string;
  message: string;
  status: "healthy" | "warning" | "error";
}) {
  return (
    <article className={`health-card status-${status}`}>
      <div>
        <span aria-hidden="true" />
        <strong>{label}</strong>
      </div>
      <p>{message}</p>
    </article>
  );
}

function statusCopy(status: "healthy" | "warning" | "error") {
  if (status === "healthy") return "Các phép kiểm tra đang đạt.";
  if (status === "warning") return "Có mục cần admin xử lý.";
  return "Có thành phần lỗi hoặc dữ liệu không nhất quán.";
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MiB`;
  return `${(bytes / 1_073_741_824).toFixed(2)} GiB`;
}

function formatAge(seconds: number | null) {
  if (seconds === null) return "không rõ thời điểm";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} phút`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} giờ`;
  return `${Math.floor(seconds / 86_400)} ngày`;
}

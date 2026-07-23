import { R2_CLASS_A_MONTHLY_APP_LIMIT, consumeMonthlyBudget } from "@/lib/cost-budget";
import {
  checkR2Bucket,
  listR2ObjectsPage,
  type R2ObjectSummary,
} from "@/lib/r2-s3";
import { getDatabase } from "@/lib/runtime";

export type OperationStatus = "healthy" | "warning" | "error";

export type OperationsHealth = {
  status: OperationStatus;
  checkedAt: string;
  d1: {
    status: OperationStatus;
    latencyMs: number;
    message: string;
    stats: null | {
      publishedBooks: number;
      deletionPending: number;
      activeReservations: number;
      expiredReservations: number;
      committedBytes: number;
      reservedBytes: number;
      hardLimitBytes: number;
      calculatedCommittedBytes: number;
      calculatedReservedBytes: number;
      storageConsistent: boolean;
      quotaValid: boolean;
    };
  };
  r2: {
    status: "healthy" | "error";
    latencyMs: number;
    message: string;
  };
};

type HealthRow = {
  committed_bytes: number;
  reserved_bytes: number;
  hard_limit_bytes: number;
  calculated_committed_bytes: number;
  calculated_reserved_bytes: number;
  published_books: number;
  deletion_pending: number;
  active_reservations: number;
  expired_reservations: number;
};

export async function getOperationsHealth(): Promise<OperationsHealth> {
  const checkedAt = new Date().toISOString();
  const [d1Result, r2Result] = await Promise.allSettled([
    measureOperation(queryD1Health),
    measureOperation(async () => {
      await checkR2Bucket();
    }),
  ]);

  let d1: OperationsHealth["d1"];

  if (d1Result.status === "rejected") {
    d1 = {
      status: "error",
      latencyMs: 0,
      message: "Không kết nối hoặc truy vấn được D1.",
      stats: null,
    };
  } else {
    const row = d1Result.value.value;
    const storageConsistent =
      row.committed_bytes === row.calculated_committed_bytes &&
      row.reserved_bytes === row.calculated_reserved_bytes;
    const quotaValid =
      row.hard_limit_bytes <= 9_000_000_000 &&
      row.committed_bytes >= 0 &&
      row.reserved_bytes >= 0 &&
      row.committed_bytes + row.reserved_bytes <= row.hard_limit_bytes;
    const hasWarning =
      row.expired_reservations > 0 || row.deletion_pending > 0;
    const status: OperationStatus =
      !storageConsistent || !quotaValid
        ? "error"
        : hasWarning
          ? "warning"
          : "healthy";
    d1 = {
      status,
      latencyMs: d1Result.value.latencyMs,
      message:
        status === "healthy"
          ? "D1 và số liệu quota nhất quán."
          : status === "warning"
            ? "D1 hoạt động nhưng có tác vụ cần admin kiểm tra."
            : "D1 hoạt động nhưng quota/metadata không nhất quán.",
      stats: {
        publishedBooks: row.published_books,
        deletionPending: row.deletion_pending,
        activeReservations: row.active_reservations,
        expiredReservations: row.expired_reservations,
        committedBytes: row.committed_bytes,
        reservedBytes: row.reserved_bytes,
        hardLimitBytes: row.hard_limit_bytes,
        calculatedCommittedBytes: row.calculated_committed_bytes,
        calculatedReservedBytes: row.calculated_reserved_bytes,
        storageConsistent,
        quotaValid,
      },
    };
  }

  const r2: OperationsHealth["r2"] =
    r2Result.status === "fulfilled"
      ? {
          status: "healthy",
          latencyMs: r2Result.value.latencyMs,
          message: "R2 private bucket phản hồi bình thường.",
        }
      : {
          status: "error",
          latencyMs: 0,
          message: "Không kết nối được R2 private bucket.",
        };
  return {
    status:
      d1.status === "error" || r2.status === "error"
        ? "error"
        : d1.status === "warning"
          ? "warning"
          : "healthy",
    checkedAt,
    d1,
    r2,
  };
}

async function queryD1Health(): Promise<HealthRow> {
  const row = await getDatabase()
    .prepare(
      `SELECT
         committed_bytes,
         reserved_bytes,
         hard_limit_bytes,
         (SELECT COALESCE(SUM(size_bytes + COALESCE(cover_size_bytes, 0)), 0)
            FROM books) AS calculated_committed_bytes,
         (SELECT COALESCE(SUM(reserved_bytes), 0)
            FROM upload_reservations
           WHERE status = 'reserved') AS calculated_reserved_bytes,
         (SELECT COUNT(*) FROM books
           WHERE status = 'published' AND deleted_at IS NULL) AS published_books,
         (SELECT COUNT(*) FROM books
           WHERE deleted_at IS NOT NULL) AS deletion_pending,
         (SELECT COUNT(*) FROM upload_reservations
           WHERE status = 'reserved'
             AND datetime(expires_at) > CURRENT_TIMESTAMP) AS active_reservations,
         (SELECT COUNT(*) FROM upload_reservations
           WHERE status = 'reserved'
             AND datetime(expires_at) <= CURRENT_TIMESTAMP) AS expired_reservations
       FROM storage_usage
       WHERE id = 1`,
    )
    .first<HealthRow>();
  if (!row) throw new Error("Storage usage singleton is missing.");
  return row;
}

export type ManagedPrefix = "books/" | "covers/";

export type OrphanObject = R2ObjectSummary & {
  ageSeconds: number | null;
};

export type OrphanScanPage = {
  prefix: ManagedPrefix;
  scanned: number;
  referenced: number;
  candidates: OrphanObject[];
  protectedUnreferenced: OrphanObject[];
  gracePeriodSeconds: number;
  nextContinuationToken: string | null;
};

const ORPHAN_GRACE_PERIOD_SECONDS = 60 * 60;

export async function scanR2OrphanPage(input: {
  prefix: ManagedPrefix;
  continuationToken?: string;
  now?: Date;
}): Promise<OrphanScanPage> {
  const budgetAvailable = await consumeMonthlyBudget({
    metric: "r2_class_a",
    amount: 1,
    hardLimit: R2_CLASS_A_MONTHLY_APP_LIMIT,
  });
  if (!budgetAvailable) {
    throw new OperationsBudgetError(
      "Đã chạm ngân sách Class A an toàn; orphan scan bị dừng.",
    );
  }

  const [references, page] = await Promise.all([
    getManagedReferences(input.prefix),
    listR2ObjectsPage({
      prefix: input.prefix,
      continuationToken: input.continuationToken,
    }),
  ]);
  const now = input.now ?? new Date();
  const candidates: OrphanObject[] = [];
  const protectedUnreferenced: OrphanObject[] = [];
  let referenced = 0;

  for (const object of page.objects) {
    if (references.has(object.key)) {
      referenced += 1;
      continue;
    }
    const modifiedAt = object.lastModified
      ? Date.parse(object.lastModified)
      : Number.NaN;
    const ageSeconds = Number.isFinite(modifiedAt)
      ? Math.max(0, Math.floor((now.getTime() - modifiedAt) / 1_000))
      : null;
    const orphan = { ...object, ageSeconds };
    if (
      ageSeconds !== null &&
      ageSeconds >= ORPHAN_GRACE_PERIOD_SECONDS
    ) {
      candidates.push(orphan);
    } else {
      protectedUnreferenced.push(orphan);
    }
  }

  return {
    prefix: input.prefix,
    scanned: page.objects.length,
    referenced,
    candidates,
    protectedUnreferenced,
    gracePeriodSeconds: ORPHAN_GRACE_PERIOD_SECONDS,
    nextContinuationToken: page.nextContinuationToken,
  };
}

async function getManagedReferences(prefix: ManagedPrefix): Promise<Set<string>> {
  const result = await getDatabase()
    .prepare(
      `SELECT object_key AS object_key
         FROM books
        WHERE object_key LIKE ?
       UNION
       SELECT cover_object_key AS object_key
         FROM books
        WHERE cover_object_key LIKE ?
       UNION
       SELECT object_key AS object_key
         FROM upload_reservations
        WHERE status = 'reserved'
          AND datetime(expires_at) > CURRENT_TIMESTAMP
          AND object_key LIKE ?
       UNION
       SELECT cover_object_key AS object_key
         FROM upload_reservations
        WHERE status = 'reserved'
          AND datetime(expires_at) > CURRENT_TIMESTAMP
          AND cover_object_key LIKE ?`,
    )
    .bind(`${prefix}%`, `${prefix}%`, `${prefix}%`, `${prefix}%`)
    .all<{ object_key: string | null }>();
  return new Set(
    result.results
      .map((row) => row.object_key)
      .filter((key): key is string => typeof key === "string"),
  );
}

export class OperationsBudgetError extends Error {}

async function measureOperation<T>(
  operation: () => Promise<T>,
): Promise<{ value: T; latencyMs: number }> {
  const startedAt = performance.now();
  const value = await operation();
  return {
    value,
    latencyMs: Math.max(
      0,
      Math.round((performance.now() - startedAt) * 10) / 10,
    ),
  };
}

export function parseOrphanScanInput(value: unknown): {
  prefix: ManagedPrefix;
  continuationToken?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OperationsValidationError("Body orphan scan không hợp lệ.");
  }
  const body = value as Record<string, unknown>;
  if (body.prefix !== "books/" && body.prefix !== "covers/") {
    throw new OperationsValidationError("Prefix không được phép.");
  }
  if (body.continuationToken === undefined || body.continuationToken === null) {
    return { prefix: body.prefix };
  }
  if (
    typeof body.continuationToken !== "string" ||
    body.continuationToken.length < 1 ||
    body.continuationToken.length > 2_048 ||
    /[\u0000-\u001f\u007f]/.test(body.continuationToken)
  ) {
    throw new OperationsValidationError("Continuation token không hợp lệ.");
  }
  return {
    prefix: body.prefix,
    continuationToken: body.continuationToken,
  };
}

export class OperationsValidationError extends Error {}

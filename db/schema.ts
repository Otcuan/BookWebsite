import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const STORAGE_HARD_LIMIT_BYTES = 9_000_000_000;

export const principals = sqliteTable(
  "principals",
  {
    email: text("email").primaryKey(),
    displayName: text("display_name"),
    role: text("role", { enum: ["owner", "friend"] }).notNull(),
    status: text("status", { enum: ["active", "revoked"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("principals_status_idx").on(table.status),
    check("principals_email_normalized", sql`${table.email} = lower(${table.email})`),
    check("principals_role_allowed", sql`${table.role} IN ('owner', 'friend')`),
    check("principals_status_allowed", sql`${table.status} IN ('active', 'revoked')`),
  ],
);

export const books = sqliteTable(
  "books",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    author: text("author").notNull(),
    description: text("description"),
    tagsJson: text("tags_json").notNull().default("[]"),
    format: text("format", { enum: ["pdf", "txt"] }).notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    objectKey: text("object_key").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    coverObjectKey: text("cover_object_key"),
    coverMimeType: text("cover_mime_type"),
    coverSizeBytes: integer("cover_size_bytes"),
    coverChecksumSha256: text("cover_checksum_sha256"),
    status: text("status", { enum: ["draft", "published", "quarantined"] })
      .notNull()
      .default("draft"),
    pageCount: integer("page_count"),
    version: integer("version").notNull().default(1),
    createdByEmail: text("created_by_email")
      .notNull()
      .references(() => principals.email, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    publishedAt: text("published_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("books_slug_unique").on(table.slug),
    uniqueIndex("books_object_key_unique").on(table.objectKey),
    uniqueIndex("books_cover_object_key_unique").on(table.coverObjectKey),
    index("books_status_updated_idx").on(table.status, table.updatedAt),
    index("books_title_idx").on(table.title),
    index("books_author_idx").on(table.author),
    check("books_size_positive", sql`${table.sizeBytes} > 0`),
    check("books_version_positive", sql`${table.version} > 0`),
    check("books_format_allowed", sql`${table.format} IN ('pdf', 'txt')`),
    check(
      "books_status_allowed",
      sql`${table.status} IN ('draft', 'published', 'quarantined')`,
    ),
  ],
);

export const readingProgress = sqliteTable(
  "reading_progress",
  {
    principalEmail: text("principal_email")
      .notNull()
      .references(() => principals.email, { onDelete: "cascade" }),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    progressPercent: integer("progress_percent").notNull().default(0),
    locator: text("locator"),
    version: integer("version").notNull().default(1),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.principalEmail, table.bookId] }),
    index("reading_progress_updated_idx").on(table.principalEmail, table.updatedAt),
    check(
      "reading_progress_percent_range",
      sql`${table.progressPercent} >= 0 AND ${table.progressPercent} <= 100`,
    ),
    check("reading_progress_version_positive", sql`${table.version} > 0`),
  ],
);

export const bookmarks = sqliteTable(
  "bookmarks",
  {
    id: text("id").primaryKey(),
    principalEmail: text("principal_email")
      .notNull()
      .references(() => principals.email, { onDelete: "cascade" }),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    locator: text("locator").notNull(),
    label: text("label"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("bookmarks_owner_book_locator_unique").on(
      table.principalEmail,
      table.bookId,
      table.locator,
    ),
    index("bookmarks_owner_book_idx").on(table.principalEmail, table.bookId),
  ],
);

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    principalEmail: text("principal_email")
      .notNull()
      .references(() => principals.email, { onDelete: "cascade" }),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    locator: text("locator").notNull(),
    content: text("content").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("notes_owner_book_idx").on(table.principalEmail, table.bookId),
    check("notes_content_length", sql`length(${table.content}) BETWEEN 1 AND 10000`),
    check("notes_version_positive", sql`${table.version} > 0`),
  ],
);

export const uploadReservations = sqliteTable(
  "upload_reservations",
  {
    id: text("id").primaryKey(),
    principalEmail: text("principal_email")
      .notNull()
      .references(() => principals.email, { onDelete: "cascade" }),
    bookId: text("book_id"),
    objectKey: text("object_key"),
    title: text("title"),
    author: text("author"),
    description: text("description"),
    format: text("format", { enum: ["pdf", "txt"] }),
    mimeType: text("mime_type"),
    checksumSha256: text("checksum_sha256"),
    bookSizeBytes: integer("book_size_bytes"),
    coverObjectKey: text("cover_object_key"),
    coverMimeType: text("cover_mime_type"),
    coverSizeBytes: integer("cover_size_bytes"),
    coverChecksumSha256: text("cover_checksum_sha256"),
    reservedBytes: integer("reserved_bytes").notNull(),
    status: text("status", { enum: ["reserved", "committed", "released"] })
      .notNull()
      .default("reserved"),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("upload_reservations_expiry_idx").on(table.status, table.expiresAt),
    uniqueIndex("upload_reservations_object_key_unique").on(table.objectKey),
    uniqueIndex("upload_reservations_cover_object_key_unique").on(table.coverObjectKey),
    check("upload_reservations_bytes_positive", sql`${table.reservedBytes} > 0`),
    check(
      "upload_reservations_status_allowed",
      sql`${table.status} IN ('reserved', 'committed', 'released')`,
    ),
  ],
);

export const storageUsage = sqliteTable(
  "storage_usage",
  {
    id: integer("id").primaryKey(),
    committedBytes: integer("committed_bytes").notNull().default(0),
    reservedBytes: integer("reserved_bytes").notNull().default(0),
    hardLimitBytes: integer("hard_limit_bytes")
      .notNull()
      .default(STORAGE_HARD_LIMIT_BYTES),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check("storage_usage_singleton", sql`${table.id} = 1`),
    check(
      "storage_usage_non_negative",
      sql`${table.committedBytes} >= 0 AND ${table.reservedBytes} >= 0`,
    ),
    check(
      "storage_usage_within_hard_limit",
      sql`${table.committedBytes} + ${table.reservedBytes} <= ${table.hardLimitBytes}`,
    ),
    check(
      "storage_usage_strict_free_limit",
      sql`${table.hardLimitBytes} <= ${sql.raw(String(STORAGE_HARD_LIMIT_BYTES))}`,
    ),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    outcome: text("outcome", { enum: ["success", "denied", "failure"] }).notNull(),
    requestId: text("request_id").notNull(),
    metadataJson: text("metadata_json"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("audit_logs_created_idx").on(table.createdAt),
    index("audit_logs_actor_created_idx").on(table.actorEmail, table.createdAt),
    check(
      "audit_logs_outcome_allowed",
      sql`${table.outcome} IN ('success', 'denied', 'failure')`,
    ),
    check(
      "audit_logs_metadata_size",
      sql`${table.metadataJson} IS NULL OR length(${table.metadataJson}) <= 4000`,
    ),
  ],
);

export const rateLimitCounters = sqliteTable(
  "rate_limit_counters",
  {
    principalEmail: text("principal_email").notNull(),
    action: text("action").notNull(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull().default(1),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.principalEmail, table.action, table.windowStart] }),
    index("rate_limit_expiry_idx").on(table.expiresAt),
    check("rate_limit_count_positive", sql`${table.count} > 0`),
  ],
);

export const costBudgets = sqliteTable(
  "cost_budgets",
  {
    period: text("period").notNull(),
    metric: text("metric").notNull(),
    count: integer("count").notNull().default(0),
    hardLimit: integer("hard_limit").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.period, table.metric] }),
    check("cost_budgets_non_negative", sql`${table.count} >= 0`),
    check("cost_budgets_within_limit", sql`${table.count} <= ${table.hardLimit}`),
  ],
);

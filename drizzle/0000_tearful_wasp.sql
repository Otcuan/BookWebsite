CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_email` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`outcome` text NOT NULL,
	`request_id` text NOT NULL,
	`metadata_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "audit_logs_outcome_allowed" CHECK("audit_logs"."outcome" IN ('success', 'denied', 'failure')),
	CONSTRAINT "audit_logs_metadata_size" CHECK("audit_logs"."metadata_json" IS NULL OR length("audit_logs"."metadata_json") <= 4000)
);
--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_created_idx` ON `audit_logs` (`actor_email`,`created_at`);--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_email` text NOT NULL,
	`book_id` text NOT NULL,
	`locator` text NOT NULL,
	`label` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`principal_email`) REFERENCES `principals`(`email`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookmarks_owner_book_locator_unique` ON `bookmarks` (`principal_email`,`book_id`,`locator`);--> statement-breakpoint
CREATE INDEX `bookmarks_owner_book_idx` ON `bookmarks` (`principal_email`,`book_id`);--> statement-breakpoint
CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`author` text NOT NULL,
	`description` text,
	`format` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`object_key` text NOT NULL,
	`checksum_sha256` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`page_count` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`published_at` text,
	`deleted_at` text,
	FOREIGN KEY (`created_by_email`) REFERENCES `principals`(`email`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "books_size_positive" CHECK("books"."size_bytes" > 0),
	CONSTRAINT "books_version_positive" CHECK("books"."version" > 0),
	CONSTRAINT "books_format_allowed" CHECK("books"."format" IN ('pdf', 'txt')),
	CONSTRAINT "books_status_allowed" CHECK("books"."status" IN ('draft', 'published', 'quarantined'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `books_slug_unique` ON `books` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `books_object_key_unique` ON `books` (`object_key`);--> statement-breakpoint
CREATE INDEX `books_status_updated_idx` ON `books` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `books_title_idx` ON `books` (`title`);--> statement-breakpoint
CREATE INDEX `books_author_idx` ON `books` (`author`);--> statement-breakpoint
CREATE TABLE `cost_budgets` (
	`period` text NOT NULL,
	`metric` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`hard_limit` integer NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`period`, `metric`),
	CONSTRAINT "cost_budgets_non_negative" CHECK("cost_budgets"."count" >= 0),
	CONSTRAINT "cost_budgets_within_limit" CHECK("cost_budgets"."count" <= "cost_budgets"."hard_limit")
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_email` text NOT NULL,
	`book_id` text NOT NULL,
	`locator` text NOT NULL,
	`content` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`principal_email`) REFERENCES `principals`(`email`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notes_content_length" CHECK(length("notes"."content") BETWEEN 1 AND 10000),
	CONSTRAINT "notes_version_positive" CHECK("notes"."version" > 0)
);
--> statement-breakpoint
CREATE INDEX `notes_owner_book_idx` ON `notes` (`principal_email`,`book_id`);--> statement-breakpoint
CREATE TABLE `principals` (
	`email` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "principals_email_normalized" CHECK("principals"."email" = lower("principals"."email")),
	CONSTRAINT "principals_role_allowed" CHECK("principals"."role" IN ('owner', 'friend')),
	CONSTRAINT "principals_status_allowed" CHECK("principals"."status" IN ('active', 'revoked'))
);
--> statement-breakpoint
CREATE INDEX `principals_status_idx` ON `principals` (`status`);--> statement-breakpoint
CREATE TABLE `rate_limit_counters` (
	`principal_email` text NOT NULL,
	`action` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`principal_email`, `action`, `window_start`),
	CONSTRAINT "rate_limit_count_positive" CHECK("rate_limit_counters"."count" > 0)
);
--> statement-breakpoint
CREATE INDEX `rate_limit_expiry_idx` ON `rate_limit_counters` (`expires_at`);--> statement-breakpoint
CREATE TABLE `reading_progress` (
	`principal_email` text NOT NULL,
	`book_id` text NOT NULL,
	`progress_percent` integer DEFAULT 0 NOT NULL,
	`locator` text,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`principal_email`, `book_id`),
	FOREIGN KEY (`principal_email`) REFERENCES `principals`(`email`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reading_progress_percent_range" CHECK("reading_progress"."progress_percent" >= 0 AND "reading_progress"."progress_percent" <= 100),
	CONSTRAINT "reading_progress_version_positive" CHECK("reading_progress"."version" > 0)
);
--> statement-breakpoint
CREATE INDEX `reading_progress_updated_idx` ON `reading_progress` (`principal_email`,`updated_at`);--> statement-breakpoint
CREATE TABLE `storage_usage` (
	`id` integer PRIMARY KEY NOT NULL,
	`committed_bytes` integer DEFAULT 0 NOT NULL,
	`reserved_bytes` integer DEFAULT 0 NOT NULL,
	`hard_limit_bytes` integer DEFAULT 9000000000 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "storage_usage_singleton" CHECK("storage_usage"."id" = 1),
	CONSTRAINT "storage_usage_non_negative" CHECK("storage_usage"."committed_bytes" >= 0 AND "storage_usage"."reserved_bytes" >= 0),
	CONSTRAINT "storage_usage_within_hard_limit" CHECK("storage_usage"."committed_bytes" + "storage_usage"."reserved_bytes" <= "storage_usage"."hard_limit_bytes"),
	CONSTRAINT "storage_usage_strict_free_limit" CHECK("storage_usage"."hard_limit_bytes" <= 9000000000)
);
--> statement-breakpoint
CREATE TABLE `upload_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_email` text NOT NULL,
	`reserved_bytes` integer NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`principal_email`) REFERENCES `principals`(`email`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "upload_reservations_bytes_positive" CHECK("upload_reservations"."reserved_bytes" > 0),
	CONSTRAINT "upload_reservations_status_allowed" CHECK("upload_reservations"."status" IN ('reserved', 'committed', 'released'))
);
--> statement-breakpoint
CREATE INDEX `upload_reservations_expiry_idx` ON `upload_reservations` (`status`,`expires_at`);--> statement-breakpoint
INSERT INTO `storage_usage` (`id`, `committed_bytes`, `reserved_bytes`, `hard_limit_bytes`)
VALUES (1, 0, 0, 9000000000);

ALTER TABLE `books` ADD `cover_object_key` text;--> statement-breakpoint
ALTER TABLE `books` ADD `cover_mime_type` text;--> statement-breakpoint
ALTER TABLE `books` ADD `cover_size_bytes` integer;--> statement-breakpoint
ALTER TABLE `books` ADD `cover_checksum_sha256` text;--> statement-breakpoint
CREATE UNIQUE INDEX `books_cover_object_key_unique` ON `books` (`cover_object_key`);--> statement-breakpoint
ALTER TABLE `upload_reservations` ADD `book_size_bytes` integer;--> statement-breakpoint
ALTER TABLE `upload_reservations` ADD `cover_object_key` text;--> statement-breakpoint
ALTER TABLE `upload_reservations` ADD `cover_mime_type` text;--> statement-breakpoint
ALTER TABLE `upload_reservations` ADD `cover_size_bytes` integer;--> statement-breakpoint
ALTER TABLE `upload_reservations` ADD `cover_checksum_sha256` text;--> statement-breakpoint
CREATE UNIQUE INDEX `upload_reservations_cover_object_key_unique` ON `upload_reservations` (`cover_object_key`);--> statement-breakpoint
UPDATE `upload_reservations`
SET `book_size_bytes` = `reserved_bytes`
WHERE `book_size_bytes` IS NULL;

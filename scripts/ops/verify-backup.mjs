import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  REQUIRED_TABLES,
  STORAGE_HARD_LIMIT_BYTES,
  assertSafeBackupPath,
  ensureFileMatches,
  formatBytes,
  printFailure,
  readManifest,
} from "./shared.mjs";

export async function verifyBackup(backupDirectoryInput, options = {}) {
  if (!backupDirectoryInput) {
    throw new Error("Hãy truyền đường dẫn thư mục backup cần kiểm tra.");
  }
  const backupDirectory = resolve(process.cwd(), backupDirectoryInput);
  const manifest = await readManifest(backupDirectory);
  const d1File = assertSafeBackupPath(backupDirectory, manifest.d1.file);
  await ensureFileMatches(d1File, manifest.d1);

  let objectBytes = 0;
  for (const entry of manifest.objects) {
    const file = assertSafeBackupPath(backupDirectory, entry.localFile);
    await ensureFileMatches(file, entry);
    objectBytes += entry.sizeBytes;
  }

  const sql = await readFile(d1File, "utf8");
  const database = new DatabaseSync(":memory:");
  let databaseSummary;
  try {
    database.exec(sql);
    database.exec("PRAGMA foreign_keys = ON");

    const integrityRows = database.prepare("PRAGMA integrity_check").all();
    if (
      integrityRows.length !== 1 ||
      !Object.values(integrityRows[0]).includes("ok")
    ) {
      throw new Error("SQLite integrity_check không trả về ok.");
    }

    const foreignKeyRows = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyRows.length > 0) {
      throw new Error(
        `SQLite foreign_key_check phát hiện ${foreignKeyRows.length} lỗi.`,
      );
    }

    const tableRows = database
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all();
    const tableNames = new Set(tableRows.map((row) => row.name));
    const missingTables = REQUIRED_TABLES.filter((name) => !tableNames.has(name));
    if (missingTables.length > 0) {
      throw new Error(`D1 dump thiếu bảng: ${missingTables.join(", ")}`);
    }

    const objectByKey = new Map(
      manifest.objects.map((entry) => [entry.key, entry]),
    );
    const references = database
      .prepare(
        `SELECT object_key, checksum_sha256, size_bytes,
                cover_object_key, cover_checksum_sha256, cover_size_bytes
           FROM books`,
      )
      .all();
    const missingObjects = [];
    const mismatchedObjects = [];
    for (const reference of references) {
      const expectedObjects = [
        {
          key: reference.object_key,
          sha256: reference.checksum_sha256,
          sizeBytes: reference.size_bytes,
        },
        {
          key: reference.cover_object_key,
          sha256: reference.cover_checksum_sha256,
          sizeBytes: reference.cover_size_bytes,
        },
      ];
      for (const expected of expectedObjects) {
        if (typeof expected.key !== "string") continue;
        const backedUp = objectByKey.get(expected.key);
        if (!backedUp) {
          missingObjects.push(expected.key);
          continue;
        }
        if (
          backedUp.sizeBytes !== expected.sizeBytes ||
          (typeof expected.sha256 === "string" &&
            backedUp.sha256 !== expected.sha256)
        ) {
          mismatchedObjects.push(expected.key);
        }
      }
    }
    if (missingObjects.length > 0) {
      throw new Error(
        `Backup thiếu ${missingObjects.length} object đang được D1 tham chiếu.`,
      );
    }
    if (mismatchedObjects.length > 0) {
      throw new Error(
        `Backup có ${mismatchedObjects.length} object lệch size/checksum metadata D1.`,
      );
    }

    const storage = database
      .prepare(
        `SELECT committed_bytes, reserved_bytes, hard_limit_bytes
         FROM storage_usage WHERE id = 1`,
      )
      .get();
    if (!storage) throw new Error("D1 dump thiếu storage_usage singleton.");
    const bookTotals = database
      .prepare(
        `SELECT COALESCE(SUM(size_bytes + COALESCE(cover_size_bytes, 0)), 0)
           AS committed_bytes
         FROM books`,
      )
      .get();
    const reservationTotals = database
      .prepare(
        `SELECT COALESCE(SUM(reserved_bytes), 0) AS reserved_bytes
         FROM upload_reservations WHERE status = 'reserved'`,
      )
      .get();
    if (storage.committed_bytes !== bookTotals.committed_bytes) {
      throw new Error("storage_usage.committed_bytes lệch tổng metadata sách.");
    }
    if (storage.reserved_bytes !== reservationTotals.reserved_bytes) {
      throw new Error("storage_usage.reserved_bytes lệch tổng reservation.");
    }
    if (
      storage.hard_limit_bytes > STORAGE_HARD_LIMIT_BYTES ||
      storage.committed_bytes + storage.reserved_bytes >
        storage.hard_limit_bytes
    ) {
      throw new Error("D1 dump vi phạm hard quota 9 GB.");
    }

    databaseSummary = {
      tableCount: tableNames.size,
      bookCount: references.length,
      committedBytes: storage.committed_bytes,
      reservedBytes: storage.reserved_bytes,
    };
  } finally {
    database.close();
  }

  const summary = {
    backupId: manifest.backupId,
    objectCount: manifest.objects.length,
    objectBytes,
    database: databaseSummary,
  };
  if (!options.quiet) {
    process.stdout.write(
      `RESTORE TEST ĐẠT: ${summary.backupId}\n` +
        `- ${summary.database.tableCount} bảng, ${summary.database.bookCount} sách\n` +
        `- ${summary.objectCount} object, ${formatBytes(summary.objectBytes)}\n` +
        "- checksum, SQLite integrity, foreign key, quota và object reference đều hợp lệ\n",
    );
  }
  return { manifest, backupDirectory, summary };
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  verifyBackup(process.argv[2]).catch(printFailure);
}

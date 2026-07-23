import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertSafeBackupPath,
  hashFile,
} from "../scripts/ops/shared.mjs";
import { verifyBackup } from "../scripts/ops/verify-backup.mjs";

async function makeValidBackup() {
  const directory = await mkdtemp(join(tmpdir(), "bookwebsite-backup-test-"));
  await mkdir(join(directory, "objects"));
  const bookId = "11111111-1111-4111-8111-111111111111";
  const objectKey = `books/${bookId}.pdf`;
  const coverKey = `covers/${bookId}.webp`;
  const bookFile = join(directory, "objects", "000001.bin");
  const coverFile = join(directory, "objects", "000002.bin");
  await writeFile(bookFile, "%PDF-1.7 test payload");
  await writeFile(coverFile, "RIFF-test-WEBP");
  const bookHash = await hashFile(bookFile);
  const coverHash = await hashFile(coverFile);

  const migrations = await Promise.all(
    [
      "drizzle/0000_tearful_wasp.sql",
      "drizzle/0001_colossal_misty_knight.sql",
      "drizzle/0002_amazing_whizzer.sql",
      "drizzle/0003_fast_yellow_claw.sql",
    ].map((file) => readFile(file, "utf8")),
  );
  const sql = `${migrations.join("\n")}
INSERT INTO principals (email, display_name, role, status)
VALUES ('owner@library.local', 'Tuấn', 'owner', 'active');
INSERT INTO books
  (id, slug, title, author, format, mime_type, size_bytes, object_key,
   checksum_sha256, cover_object_key, cover_mime_type, cover_size_bytes,
   cover_checksum_sha256, status, created_by_email)
VALUES
  ('${bookId}', 'restore-test', 'Restore test', 'Tuấn', 'pdf',
   'application/pdf', ${bookHash.sizeBytes}, '${objectKey}', '${bookHash.sha256}',
   '${coverKey}', 'image/webp', ${coverHash.sizeBytes}, '${coverHash.sha256}',
   'published', 'owner@library.local');
UPDATE storage_usage
SET committed_bytes = ${bookHash.sizeBytes + coverHash.sizeBytes}
WHERE id = 1;
`;
  const d1File = join(directory, "database.sql");
  await writeFile(d1File, sql);
  const d1Hash = await hashFile(d1File);
  const manifest = {
    manifestVersion: 1,
    backupId: "backup-20260723T120000Z-a1b2c3d4",
    createdAt: "2026-07-23T12:00:00.000Z",
    source: {
      accountIdSuffix: "123456",
      databaseId: "test-database",
      bucket: "test-bucket",
    },
    d1: {
      file: "database.sql",
      sizeBytes: d1Hash.sizeBytes,
      sha256: d1Hash.sha256,
      bookmark: "test-bookmark",
    },
    objects: [
      {
        key: objectKey,
        localFile: "objects/000001.bin",
        sizeBytes: bookHash.sizeBytes,
        sha256: bookHash.sha256,
        contentType: "application/pdf",
        contentDisposition: null,
        cacheControl: null,
        contentEncoding: null,
      },
      {
        key: coverKey,
        localFile: "objects/000002.bin",
        sizeBytes: coverHash.sizeBytes,
        sha256: coverHash.sha256,
        contentType: "image/webp",
        contentDisposition: null,
        cacheControl: null,
        contentEncoding: null,
      },
    ],
    totals: {
      objectCount: 2,
      objectBytes: bookHash.sizeBytes + coverHash.sizeBytes,
    },
  };
  await writeFile(
    join(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  return { directory, bookFile, manifestFile: join(directory, "manifest.json") };
}

test("backup verifier performs a real local SQL restore and reference check", async () => {
  const fixture = await makeValidBackup();
  try {
    const result = await verifyBackup(fixture.directory, { quiet: true });
    assert.equal(result.summary.database.bookCount, 1);
    assert.equal(result.summary.objectCount, 2);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("backup verifier rejects a tampered object", async () => {
  const fixture = await makeValidBackup();
  try {
    await writeFile(fixture.bookFile, "tampered");
    await assert.rejects(
      verifyBackup(fixture.directory, { quiet: true }),
      /Checksum\/size không khớp/,
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("backup verifier rejects content even if its manifest hash is also changed", async () => {
  const fixture = await makeValidBackup();
  try {
    await writeFile(fixture.bookFile, "tampered together");
    const manifest = JSON.parse(await readFile(fixture.manifestFile, "utf8"));
    const changed = await hashFile(fixture.bookFile);
    manifest.objects[0].sizeBytes = changed.sizeBytes;
    manifest.objects[0].sha256 = changed.sha256;
    await writeFile(fixture.manifestFile, JSON.stringify(manifest, null, 2));
    await assert.rejects(
      verifyBackup(fixture.directory, { quiet: true }),
      /lệch size\/checksum metadata D1/,
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("manifest paths cannot traverse outside the backup directory", () => {
  assert.throws(
    () => assertSafeBackupPath("/tmp/safe-backup", "../secret"),
    /Đường dẫn manifest không hợp lệ/,
  );
});

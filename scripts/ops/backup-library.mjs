import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  cloudConfiguration,
  createR2Client,
  downloadR2Object,
  ensureDirectoryDoesNotExist,
  exportD1,
  formatBytes,
  listAllR2Objects,
  loadLocalEnvironment,
  printFailure,
} from "./shared.mjs";

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function parseOutputDirectory(argumentsList) {
  const outputIndex = argumentsList.indexOf("--output");
  if (outputIndex === -1) {
    return resolve(process.cwd(), "backups", timestampForPath());
  }
  const value = argumentsList[outputIndex + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--output cần một đường dẫn thư mục mới.");
  }
  return resolve(process.cwd(), value);
}

export async function createBackup(argumentsList = process.argv.slice(2)) {
  loadLocalEnvironment();
  const configuration = cloudConfiguration();
  const outputDirectory = parseOutputDirectory(argumentsList);
  await mkdir(resolve(outputDirectory, ".."), { recursive: true });
  await ensureDirectoryDoesNotExist(outputDirectory);
  await mkdir(resolve(outputDirectory, "objects"), { mode: 0o700 });

  const createdAt = new Date();
  const backupId = `backup-${timestampForPath(createdAt)}-${randomBytes(4).toString("hex")}`;
  process.stdout.write(
    "Bắt đầu full backup. Không upload/sửa/xóa sách cho tới khi hoàn tất.\n",
  );

  process.stdout.write("1/3 Đang export Cloudflare D1...\n");
  const d1File = resolve(outputDirectory, "database.sql");
  const d1 = await exportD1(configuration, d1File);
  process.stdout.write(`    D1: ${formatBytes(d1.sizeBytes)}\n`);

  process.stdout.write("2/3 Đang tải toàn bộ object R2 về local...\n");
  const r2 = createR2Client(configuration);
  const objects = [];
  let totalBytes = 0;
  let index = 0;
  for await (const listed of listAllR2Objects(r2, configuration.bucket)) {
    index += 1;
    const localFile = `objects/${String(index).padStart(6, "0")}.bin`;
    const downloaded = await downloadR2Object(
      r2,
      configuration.bucket,
      listed.Key,
      resolve(outputDirectory, localFile),
    );
    if (
      typeof listed.Size === "number" &&
      listed.Size !== downloaded.sizeBytes
    ) {
      throw new Error(`R2 size đổi trong lúc backup: ${listed.Key}`);
    }
    totalBytes += downloaded.sizeBytes;
    objects.push({
      key: listed.Key,
      localFile,
      sizeBytes: downloaded.sizeBytes,
      sha256: downloaded.sha256,
      contentType: downloaded.contentType,
      contentDisposition: downloaded.contentDisposition,
      cacheControl: downloaded.cacheControl,
      contentEncoding: downloaded.contentEncoding,
      lastModified: listed.LastModified?.toISOString() ?? null,
    });
    process.stdout.write(
      `\r    ${index} object · ${formatBytes(totalBytes)} đã tải`,
    );
  }
  process.stdout.write("\n");

  process.stdout.write("3/3 Đang ghi manifest không chứa secret...\n");
  const manifest = {
    manifestVersion: 1,
    backupId,
    createdAt: createdAt.toISOString(),
    source: {
      accountIdSuffix: configuration.accountId.slice(-6),
      databaseId: configuration.databaseId,
      bucket: configuration.bucket,
    },
    d1: {
      file: "database.sql",
      sizeBytes: d1.sizeBytes,
      sha256: d1.sha256,
      bookmark: d1.bookmark,
    },
    objects,
    totals: {
      objectCount: objects.length,
      objectBytes: totalBytes,
    },
  };
  await writeFile(
    resolve(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );

  process.stdout.write(
    `Backup đã tạo tại ${outputDirectory}\n` +
      "CHƯA coi là hợp lệ. Hãy chạy ops:verify-backup ngay bây giờ.\n",
  );
  return outputDirectory;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  createBackup().catch(printFailure);
}

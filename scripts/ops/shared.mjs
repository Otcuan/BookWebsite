import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export const MANIFEST_VERSION = 1;
export const STORAGE_HARD_LIMIT_BYTES = 9_000_000_000;
export const REQUIRED_TABLES = [
  "audit_logs",
  "books",
  "cost_budgets",
  "principals",
  "rate_limit_counters",
  "storage_usage",
  "upload_reservations",
];

export function loadLocalEnvironment() {
  const requestedFile = process.env.BOOK_OPS_ENV_FILE?.trim();
  const envFile = resolve(process.cwd(), requestedFile || ".env.local");
  if (requestedFile && !existsSync(envFile)) {
    throw new Error(`Không tìm thấy BOOK_OPS_ENV_FILE: ${envFile}`);
  }
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

export function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Thiếu ${name}. Hãy điền biến này trong .env.local và không commit file đó.`,
    );
  }
  return value;
}

export function cloudConfiguration() {
  return {
    accountId: requiredEnvironment("CLOUDFLARE_ACCOUNT_ID"),
    databaseId: requiredEnvironment("CLOUDFLARE_D1_DATABASE_ID"),
    d1Token: requiredEnvironment("CLOUDFLARE_D1_API_TOKEN"),
    r2AccessKeyId: requiredEnvironment("R2_ACCESS_KEY_ID"),
    r2SecretAccessKey: requiredEnvironment("R2_SECRET_ACCESS_KEY"),
    bucket: requiredEnvironment("R2_BUCKET_NAME"),
  };
}

export function createR2Client(configuration) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${configuration.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: configuration.r2AccessKeyId,
      secretAccessKey: configuration.r2SecretAccessKey,
    },
  });
}

function cloudflareEndpoint(configuration, suffix) {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    configuration.accountId,
  )}/d1/database/${encodeURIComponent(configuration.databaseId)}${suffix}`;
}

export async function callD1Operation(configuration, suffix, body) {
  const response = await fetch(cloudflareEndpoint(configuration, suffix), {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${configuration.d1Token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success || !payload.result) {
    const details = Array.isArray(payload?.errors)
      ? payload.errors.map((error) => error?.message).filter(Boolean).join("; ")
      : "";
    throw new Error(details || `Cloudflare D1 trả HTTP ${response.status}.`);
  }
  return payload.result;
}

export async function queryD1(configuration, sql, params = []) {
  const response = await fetch(cloudflareEndpoint(configuration, "/query"), {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${configuration.d1Token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null);
  const first = payload?.result?.[0];
  if (!response.ok || !payload?.success || !first || first.success === false) {
    const details = Array.isArray(payload?.errors)
      ? payload.errors.map((error) => error?.message).filter(Boolean).join("; ")
      : "";
    throw new Error(details || `Cloudflare D1 query trả HTTP ${response.status}.`);
  }
  return first.results ?? [];
}

export async function exportD1(configuration, destination) {
  const startedAt = Date.now();
  let currentBookmark;

  while (Date.now() - startedAt < 10 * 60_000) {
    const result = await callD1Operation(configuration, "/export", {
      output_format: "polling",
      ...(currentBookmark ? { current_bookmark: currentBookmark } : {}),
    });
    currentBookmark = result.at_bookmark ?? currentBookmark;
    if (result.status === "error") {
      throw new Error(result.error || "Cloudflare D1 export thất bại.");
    }
    if (result.status === "complete") {
      const signedUrl = result.result?.signed_url;
      if (!signedUrl) throw new Error("D1 export hoàn tất nhưng thiếu signed URL.");
      const download = await fetch(signedUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (!download.ok || !download.body) {
        throw new Error(`Không tải được D1 export (HTTP ${download.status}).`);
      }
      await mkdir(dirname(destination), { recursive: true });
      const measured = await streamToFile(download.body, destination);
      return {
        bookmark: currentBookmark ?? null,
        sizeBytes: measured.sizeBytes,
        sha256: measured.sha256,
      };
    }
    if (!currentBookmark) {
      throw new Error("D1 export chưa hoàn tất nhưng không trả polling bookmark.");
    }
    await delay(1_000);
  }
  throw new Error("D1 export vượt quá timeout 10 phút.");
}

export async function* listAllR2Objects(client, bucket) {
  let continuationToken;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
        MaxKeys: 1_000,
      }),
    );
    for (const object of page.Contents ?? []) {
      if (!object.Key) continue;
      yield object;
    }
    continuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
    if (page.IsTruncated && !continuationToken) {
      throw new Error("R2 báo còn trang nhưng không trả continuation token.");
    }
  } while (continuationToken);
}

export async function downloadR2Object(
  client,
  bucket,
  objectKey,
  destination,
) {
  const result = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
  );
  if (!result.Body) throw new Error(`R2 object không có body: ${objectKey}`);
  await mkdir(dirname(destination), { recursive: true });
  const measured = await streamToFile(result.Body, destination);
  return {
    ...measured,
    contentType: result.ContentType ?? null,
    contentDisposition: result.ContentDisposition ?? null,
    cacheControl: result.CacheControl ?? null,
    contentEncoding: result.ContentEncoding ?? null,
  };
}

export async function uploadR2Object(client, bucket, entry, absoluteFile) {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: entry.key,
      Body: createReadStream(absoluteFile),
      ContentLength: entry.sizeBytes,
      ...(entry.contentType ? { ContentType: entry.contentType } : {}),
      ...(entry.contentDisposition
        ? { ContentDisposition: entry.contentDisposition }
        : {}),
      ...(entry.cacheControl ? { CacheControl: entry.cacheControl } : {}),
      ...(entry.contentEncoding
        ? { ContentEncoding: entry.contentEncoding }
        : {}),
    }),
  );
}

export async function headR2Object(client, bucket, key) {
  return client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}

export async function streamToFile(source, destination) {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      sizeBytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    source,
    meter,
    createWriteStream(destination, { flags: "wx", mode: 0o600 }),
  );
  return { sizeBytes, sha256: hash.digest("hex") };
}

export async function hashFile(file) {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(file)) {
    sizeBytes += chunk.length;
    hash.update(chunk);
  }
  return { sizeBytes, sha256: hash.digest("hex") };
}

export async function md5File(file) {
  const hash = createHash("md5");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function importD1(configuration, sqlFile) {
  const etag = await md5File(sqlFile);
  const initialized = await callD1Operation(configuration, "/import", {
    action: "init",
    etag,
  });
  if (!initialized.upload_url || !initialized.filename) {
    throw new Error("D1 import init không trả upload URL/filename.");
  }

  const upload = await fetch(initialized.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: createReadStream(sqlFile),
    duplex: "half",
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!upload.ok) {
    throw new Error(`Không upload được SQL cho D1 import (HTTP ${upload.status}).`);
  }

  let result = await callD1Operation(configuration, "/import", {
    action: "ingest",
    etag,
    filename: initialized.filename,
  });
  const startedAt = Date.now();
  while (result.status !== "complete") {
    if (result.status === "error") {
      throw new Error(result.error || "Cloudflare D1 import thất bại.");
    }
    if (Date.now() - startedAt > 10 * 60_000) {
      throw new Error("D1 import vượt quá timeout 10 phút.");
    }
    const currentBookmark = result.at_bookmark;
    if (!currentBookmark) {
      throw new Error("D1 import chưa hoàn tất nhưng thiếu polling bookmark.");
    }
    await delay(1_000);
    result = await callD1Operation(configuration, "/import", {
      action: "poll",
      current_bookmark: currentBookmark,
    });
  }
  return result.result ?? {};
}

export function assertSafeBackupPath(backupDirectory, relativeFile) {
  if (
    typeof relativeFile !== "string" ||
    !/^(database\.sql|objects\/[0-9]{6,12}\.bin)$/.test(relativeFile)
  ) {
    throw new Error(`Đường dẫn manifest không hợp lệ: ${String(relativeFile)}`);
  }
  const root = resolve(backupDirectory);
  const absolute = resolve(root, relativeFile);
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
    throw new Error("Manifest cố thoát khỏi thư mục backup.");
  }
  return absolute;
}

export function assertManifestShape(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("manifest.json không phải object.");
  }
  if (manifest.manifestVersion !== MANIFEST_VERSION) {
    throw new Error(`Không hỗ trợ manifestVersion ${manifest.manifestVersion}.`);
  }
  if (
    typeof manifest.backupId !== "string" ||
    !/^backup-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$/.test(manifest.backupId)
  ) {
    throw new Error("backupId không hợp lệ.");
  }
  if (
    typeof manifest.createdAt !== "string" ||
    !Number.isFinite(Date.parse(manifest.createdAt))
  ) {
    throw new Error("createdAt trong manifest không hợp lệ.");
  }
  if (
    !manifest.d1 ||
    manifest.d1.file !== "database.sql" ||
    !isSafeFileRecord(manifest.d1)
  ) {
    throw new Error("Thông tin D1 trong manifest không hợp lệ.");
  }
  if (!Array.isArray(manifest.objects) || manifest.objects.length > 1_000_000) {
    throw new Error("Danh sách object trong manifest không hợp lệ/quá lớn.");
  }
  const keys = new Set();
  const files = new Set();
  for (const entry of manifest.objects) {
    if (
      !entry ||
      typeof entry.key !== "string" ||
      entry.key.length < 1 ||
      entry.key.length > 1_024 ||
      !isSafeFileRecord(entry) ||
      !isSafeOptionalHeader(entry.contentType) ||
      !isSafeOptionalHeader(entry.contentDisposition) ||
      !isSafeOptionalHeader(entry.cacheControl) ||
      !isSafeOptionalHeader(entry.contentEncoding)
    ) {
      throw new Error("Có object record không hợp lệ trong manifest.");
    }
    if (keys.has(entry.key) || files.has(entry.localFile)) {
      throw new Error("Manifest có object key hoặc local file trùng.");
    }
    keys.add(entry.key);
    files.add(entry.localFile);
  }
  return manifest;
}

function isSafeFileRecord(record) {
  const file = record.file ?? record.localFile;
  return (
    typeof file === "string" &&
    Number.isSafeInteger(record.sizeBytes) &&
    record.sizeBytes >= 0 &&
    typeof record.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(record.sha256)
  );
}

function isSafeOptionalHeader(value) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" &&
      value.length <= 1_024 &&
      !/[\u0000\r\n]/.test(value))
  );
}

export async function readManifest(backupDirectory) {
  const manifestFile = resolve(backupDirectory, "manifest.json");
  const payload = JSON.parse(await readFile(manifestFile, "utf8"));
  return assertManifestShape(payload);
}

export async function ensureFileMatches(file, expected) {
  const fileStat = await stat(file);
  if (!fileStat.isFile()) throw new Error(`${file} không phải file.`);
  const measured = await hashFile(file);
  if (
    measured.sizeBytes !== expected.sizeBytes ||
    measured.sha256 !== expected.sha256
  ) {
    throw new Error(`Checksum/size không khớp: ${file}`);
  }
}

export async function ensureDirectoryDoesNotExist(directory) {
  if (existsSync(directory)) {
    throw new Error(`Thư mục đích đã tồn tại: ${directory}`);
  }
  await mkdir(directory, { recursive: false, mode: 0o700 });
}

export function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

export function formatBytes(bytes) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MiB`;
  return `${(bytes / 1_073_741_824).toFixed(2)} GiB`;
}

export function printFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`LỖI: ${message}\n`);
  process.exitCode = 1;
}

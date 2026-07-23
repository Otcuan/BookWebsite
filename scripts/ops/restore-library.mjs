import {
  assertSafeBackupPath,
  cloudConfiguration,
  createR2Client,
  headR2Object,
  importD1,
  listAllR2Objects,
  loadLocalEnvironment,
  printFailure,
  queryD1,
  uploadR2Object,
} from "./shared.mjs";
import { verifyBackup } from "./verify-backup.mjs";

function parseArguments(argumentsList) {
  const backupDirectory = argumentsList.find((value) => !value.startsWith("--"));
  return {
    backupDirectory,
    confirmedEmpty: argumentsList.includes("--confirm-empty-target"),
  };
}

async function assertEmptyTarget(configuration, r2) {
  const tables = await queryD1(
    configuration,
    `SELECT name
       FROM sqlite_schema
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND substr(name, 1, 4) <> '_cf_'
      LIMIT 1`,
  );
  if (tables.length > 0) {
    throw new Error(
      "D1 target không trống. Restore bị dừng để tránh ghi đè dữ liệu.",
    );
  }
  for await (const object of listAllR2Objects(r2, configuration.bucket)) {
    if (object.Key) {
      throw new Error(
        "R2 target không trống. Restore bị dừng để tránh ghi đè object.",
      );
    }
  }
}

export async function restoreBackup(argumentsList = process.argv.slice(2)) {
  const argumentsParsed = parseArguments(argumentsList);
  if (!argumentsParsed.confirmedEmpty) {
    throw new Error(
      "Restore cloud cần cờ --confirm-empty-target và chỉ được chạy với D1/R2 mới, trống.",
    );
  }
  const verified = await verifyBackup(argumentsParsed.backupDirectory, {
    quiet: false,
  });

  loadLocalEnvironment();
  const configuration = cloudConfiguration();
  const r2 = createR2Client(configuration);
  process.stdout.write("Đang xác minh D1 và R2 target hoàn toàn trống...\n");
  await assertEmptyTarget(configuration, r2);

  process.stdout.write(
    `Đang restore ${verified.manifest.objects.length} object vào R2 target...\n`,
  );
  let uploaded = 0;
  for (const entry of verified.manifest.objects) {
    const file = assertSafeBackupPath(verified.backupDirectory, entry.localFile);
    await uploadR2Object(r2, configuration.bucket, entry, file);
    uploaded += 1;
    process.stdout.write(`\rR2: ${uploaded}/${verified.manifest.objects.length}`);
  }
  process.stdout.write("\nĐang kiểm tra size các object đã upload...\n");
  for (const entry of verified.manifest.objects) {
    const head = await headR2Object(r2, configuration.bucket, entry.key);
    if (head.ContentLength !== entry.sizeBytes) {
      throw new Error(`R2 target sai size sau restore: ${entry.key}`);
    }
  }

  process.stdout.write("Đang import database.sql vào D1 target...\n");
  const d1File = assertSafeBackupPath(
    verified.backupDirectory,
    verified.manifest.d1.file,
  );
  const importResult = await importD1(configuration, d1File);
  const books = await queryD1(configuration, "SELECT COUNT(*) AS count FROM books");
  const restoredBookCount = Number(books[0]?.count ?? -1);
  if (restoredBookCount !== verified.summary.database.bookCount) {
    throw new Error("Số sách trên D1 target không khớp backup sau restore.");
  }

  process.stdout.write(
    "RESTORE CLOUD HOÀN TẤT vào target trống.\n" +
      `- ${uploaded} R2 object\n` +
      `- ${restoredBookCount} sách trong D1\n` +
      `- final bookmark: ${importResult.final_bookmark ?? "không được trả về"}\n` +
      "Chưa đổi Vercel env. Hãy health check và đọc thử sách trên target trước.\n",
  );
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  restoreBackup().catch(printFailure);
}

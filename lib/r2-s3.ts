import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requiredEnv } from "@/lib/runtime";

let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) return client;
  const accountId = requiredEnv("CLOUDFLARE_ACCOUNT_ID");
  client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
  return client;
}

function bucketName(): string {
  return requiredEnv("R2_BUCKET_NAME");
}

export async function createPresignedPutUrl(input: {
  objectKey: string;
  mimeType: string;
  expiresIn?: number;
}): Promise<string> {
  return getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: input.objectKey,
      ContentType: input.mimeType,
    }),
    { expiresIn: input.expiresIn ?? 300 },
  );
}

export async function createPresignedGetUrl(
  objectKey: string,
  expiresIn = 300,
): Promise<string> {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: bucketName(), Key: objectKey }),
    { expiresIn },
  );
}

export async function headR2Object(objectKey: string): Promise<{
  sizeBytes: number;
  mimeType: string | null;
}> {
  const result = await getClient().send(
    new HeadObjectCommand({ Bucket: bucketName(), Key: objectKey }),
  );
  return {
    sizeBytes: result.ContentLength ?? -1,
    mimeType: result.ContentType ?? null,
  };
}

export async function getR2Prefix(objectKey: string): Promise<Uint8Array> {
  const result = await getClient().send(
    new GetObjectCommand({
      Bucket: bucketName(),
      Key: objectKey,
      Range: "bytes=0-4095",
    }),
  );
  if (!result.Body) throw new Error("R2 object body is missing.");
  return result.Body.transformToByteArray();
}

export async function deleteR2Object(objectKey: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: bucketName(), Key: objectKey }),
  );
}

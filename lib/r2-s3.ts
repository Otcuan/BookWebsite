import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
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
  contentDisposition?: string;
  expiresIn?: number;
}): Promise<string> {
  return getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: input.objectKey,
      ContentType: input.mimeType,
      ContentDisposition: input.contentDisposition,
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

export async function checkR2Bucket(): Promise<void> {
  await getClient().send(
    new HeadBucketCommand({ Bucket: bucketName() }),
    { abortSignal: AbortSignal.timeout(10_000) },
  );
}

export type R2ObjectSummary = {
  key: string;
  sizeBytes: number;
  lastModified: string | null;
};

export async function listR2ObjectsPage(input: {
  prefix: "books/" | "covers/";
  continuationToken?: string;
}): Promise<{
  objects: R2ObjectSummary[];
  nextContinuationToken: string | null;
}> {
  const result = await getClient().send(
    new ListObjectsV2Command({
      Bucket: bucketName(),
      Prefix: input.prefix,
      ContinuationToken: input.continuationToken,
      MaxKeys: 1_000,
    }),
    { abortSignal: AbortSignal.timeout(15_000) },
  );
  if (result.IsTruncated && !result.NextContinuationToken) {
    throw new Error("R2 pagination token is missing.");
  }
  return {
    objects: (result.Contents ?? [])
      .filter((object): object is typeof object & { Key: string } =>
        Boolean(object.Key),
      )
      .map((object) => ({
        key: object.Key,
        sizeBytes: object.Size ?? 0,
        lastModified: object.LastModified?.toISOString() ?? null,
      })),
    nextContinuationToken: result.IsTruncated
      ? result.NextContinuationToken ?? null
      : null,
  };
}

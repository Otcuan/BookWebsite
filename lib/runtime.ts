import { D1HttpDatabase, type D1DatabaseLike } from "@/lib/d1-http";

export const OWNER_PRINCIPAL_EMAIL = "owner@library.local";

let database: D1DatabaseLike | null = null;

export function getDatabase(): D1DatabaseLike {
  if (database) return database;
  const accountId = requiredEnv("CLOUDFLARE_ACCOUNT_ID");
  const databaseId = requiredEnv("CLOUDFLARE_D1_DATABASE_ID");
  const apiToken = requiredEnv("CLOUDFLARE_D1_API_TOKEN");
  database = new D1HttpDatabase(accountId, databaseId, apiToken);
  return database;
}

export function isRuntimeConfigured(): boolean {
  return [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_D1_DATABASE_ID",
    "CLOUDFLARE_D1_API_TOKEN",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
  ].every((key) => Boolean(process.env[key]?.trim()));
}

export function isOwnerAuthConfigured(): boolean {
  return Boolean(
    process.env.OWNER_PASSWORD_HASH?.trim() &&
      process.env.SESSION_SECRET?.trim() &&
      isRuntimeConfigured(),
  );
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Required server environment variable ${name} is missing.`);
  return value;
}

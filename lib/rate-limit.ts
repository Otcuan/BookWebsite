import { getDatabase } from "@/lib/runtime";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

export async function consumeRateLimit(input: {
  principal: string;
  action: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % input.windowSeconds);
  const expiresAt = windowStart + input.windowSeconds * 2;
  const DB = getDatabase();
  const row = await DB.prepare(
    `INSERT INTO rate_limit_counters
       (principal_email, action, window_start, count, expires_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(principal_email, action, window_start) DO UPDATE SET
       count = rate_limit_counters.count + 1
     RETURNING count`,
  )
    .bind(input.principal, input.action, windowStart, expiresAt)
    .first<{ count: number }>();

  const count = row?.count ?? input.limit + 1;
  return {
    allowed: count <= input.limit,
    limit: input.limit,
    remaining: Math.max(0, input.limit - count),
    retryAfterSeconds: Math.max(1, windowStart + input.windowSeconds - now),
  };
}

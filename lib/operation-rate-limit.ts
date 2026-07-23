type WindowEntry = {
  count: number;
  resetAt: number;
};

const operationWindows = new Map<string, WindowEntry>();
const MAX_TRACKED_WINDOWS = 200;

export function consumeLocalOperationRateLimit(input: {
  key: string;
  limit: number;
  windowSeconds: number;
  now?: number;
}): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const now = input.now ?? Date.now();
  const current = operationWindows.get(input.key);
  const entry = !current || current.resetAt <= now
    ? {
        count: 0,
        resetAt: now + input.windowSeconds * 1_000,
      }
    : current;
  entry.count += 1;
  operationWindows.set(input.key, entry);

  if (operationWindows.size > MAX_TRACKED_WINDOWS) {
    for (const [key, value] of operationWindows) {
      if (value.resetAt <= now) operationWindows.delete(key);
    }
  }

  return {
    allowed: entry.count <= input.limit,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1_000)),
  };
}

export function resetLocalOperationRateLimitsForTests(): void {
  operationWindows.clear();
}

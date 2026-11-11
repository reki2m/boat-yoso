type Bucket = { windowStart: number; count: number };
const buckets = new Map<string, Bucket>();

/** 単純な連続試行制限（プロセス内）。 */
export function allowAuthAttempt(
  key: string,
  opts?: { limit?: number; windowMs?: number },
): { ok: boolean; retryAfterSec?: number } {
  const limit = opts?.limit ?? 20;
  const windowMs = opts?.windowMs ?? 10 * 60 * 1000;
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    b = { windowStart: now, count: 0 };
    buckets.set(key, b);
  }
  if (b.count >= limit) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((windowMs - (now - b.windowStart)) / 1000),
    };
  }
  b.count += 1;
  buckets.set(key, b);
  return { ok: true };
}

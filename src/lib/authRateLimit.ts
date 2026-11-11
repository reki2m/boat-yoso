import { sql } from "@/lib/db";

type Bucket = { windowStart: number; count: number };
const memoryBuckets = new Map<string, Bucket>();
let ensured = false;

async function ensureTable(): Promise<void> {
  if (ensured) return;
  await sql(`
    create table if not exists chat_rate_limits (
      bucket_key text primary key,
      window_start timestamptz not null,
      hit_count int not null default 0
    )
  `).catch(() => null);
  ensured = true;
}

function allowMemory(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  let b = memoryBuckets.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    b = { windowStart: now, count: 0 };
    memoryBuckets.set(key, b);
  }
  if (b.count >= limit) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((windowMs - (now - b.windowStart)) / 1000),
    };
  }
  b.count += 1;
  memoryBuckets.set(key, b);
  return { ok: true };
}

/**
 * 連続試行制限（プロセス内）。共有が要る場合は allowAuthAttemptShared を使う。
 */
export function allowAuthAttempt(
  key: string,
  opts?: { limit?: number; windowMs?: number },
): { ok: boolean; retryAfterSec?: number } {
  const limit = opts?.limit ?? 20;
  const windowMs = opts?.windowMs ?? 10 * 60 * 1000;
  return allowMemory(key, limit, windowMs);
}

/** DB 共有カウンタを先に見て、超えていれば拒否。失敗時はメモリ制限にフォールバック。 */
export async function allowAuthAttemptShared(
  key: string,
  opts?: { limit?: number; windowMs?: number },
): Promise<{ ok: boolean; retryAfterSec?: number }> {
  const limit = opts?.limit ?? 20;
  const windowMs = opts?.windowMs ?? 10 * 60 * 1000;
  try {
    await ensureTable();
    const now = new Date();
    const rows = await sql<{ window_start: string | Date; hit_count: number }>(
      `select window_start, hit_count from chat_rate_limits where bucket_key = $1 limit 1`,
      [key],
    );
    const row = rows[0];
    const windowStart = row?.window_start ? new Date(row.window_start).getTime() : 0;
    if (!row || now.getTime() - windowStart >= windowMs) {
      await sql(
        `insert into chat_rate_limits (bucket_key, window_start, hit_count)
         values ($1, $2::timestamptz, 1)
         on conflict (bucket_key) do update
           set window_start = excluded.window_start,
               hit_count = 1`,
        [key, now.toISOString()],
      );
      allowMemory(key, limit, windowMs);
      return { ok: true };
    }
    const count = Number(row.hit_count || 0);
    if (count >= limit) {
      return {
        ok: false,
        retryAfterSec: Math.ceil((windowMs - (now.getTime() - windowStart)) / 1000),
      };
    }
    await sql(
      `update chat_rate_limits set hit_count = hit_count + 1 where bucket_key = $1`,
      [key],
    );
    allowMemory(key, limit, windowMs);
    return { ok: true };
  } catch {
    return allowMemory(key, limit, windowMs);
  }
}

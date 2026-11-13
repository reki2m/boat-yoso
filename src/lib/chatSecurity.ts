import { createHash, timingSafeEqual } from "node:crypto";
import { maybeAutoClearChat } from "@/lib/chatAutoClear";
import { settleChatPredictionHits } from "@/lib/chatHitSettle";
import { maybePostExhibitionHonmeiUpdates } from "@/lib/chatExhibitionPicks";
import { maybePostHonmeiRaceResults } from "@/lib/chatHonmeiResults";
import { maybePostMorningHonmeiPicks } from "@/lib/chatMorningPicks";
import { allowAuthAttemptShared } from "@/lib/authRateLimit";
import { sql } from "@/lib/db";

const MAINT_META = "chat_maint_at_ms";
const MAINT_EVERY_MS = 60_000;
const RACE_MIN_INTERVAL_MS = 20_000;
const RACE_MAX_PER_HOUR = 8;

type RaceBucket = { windowStart: number; count: number; lastAt: number };
const raceBuckets = new Map<string, RaceBucket>();

async function getMeta(key: string): Promise<string | null> {
  try {
    const rows = await sql<{ value: string }>(
      `select value from chat_meta where key = $1 limit 1`,
      [key],
    );
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

async function setMeta(key: string, value: string): Promise<void> {
  await sql(
    `insert into chat_meta (key, value, updated_at)
     values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, value],
  );
}

/** 貼り付け時の不可視文字・全角などを除いて比較用に整える。 */
export function normalizeSecret(raw: string | null | undefined): string {
  return String(raw || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

/** 長さ差でも比較時間を寄せる timing-safe 等価。 */
export function safeEqualText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  const len = Math.max(left.length, right.length, 1);
  const padL = Buffer.alloc(len);
  const padR = Buffer.alloc(len);
  left.copy(padL);
  right.copy(padR);
  const same = timingSafeEqual(padL, padR);
  return same && left.length === right.length;
}

export function hashBucket(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

/**
 * 重いメンテ処理（自動消去・朝投稿・的中精算）を最短60秒間隔に制限。
 * 通常のメッセージ取得自体は毎回返す。
 */
export async function maybeRunChatMaintenance(): Promise<{ ran: boolean }> {
  const now = Date.now();
  const last = Number((await getMeta(MAINT_META)) || 0);
  if (Number.isFinite(last) && now - last < MAINT_EVERY_MS) {
    return { ran: false };
  }
  await setMeta(MAINT_META, String(now));
  await maybeAutoClearChat().catch(() => null);
  await maybePostMorningHonmeiPicks().catch(() => null);
  await maybePostExhibitionHonmeiUpdates().catch(() => null);
  await maybePostHonmeiRaceResults().catch(() => null);
  await settleChatPredictionHits().catch(() => null);
  return { ran: true };
}

/** 場名+レース予測の連打を抑止（プロセス内の最短間隔）。 */
function allowRaceReplyLocal(bucketKey: string): {
  ok: boolean;
  error?: string;
  retryAfterSec?: number;
} {
  const key = bucketKey || "anon";
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  let bucket = raceBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= hour) {
    bucket = { windowStart: now, count: 0, lastAt: 0 };
    raceBuckets.set(key, bucket);
  }
  if (bucket.lastAt && now - bucket.lastAt < RACE_MIN_INTERVAL_MS) {
    const retryAfterSec = Math.ceil((RACE_MIN_INTERVAL_MS - (now - bucket.lastAt)) / 1000);
    return {
      ok: false,
      retryAfterSec,
      error: `予測の連続利用は少し間隔を空けてください（あと約${retryAfterSec}秒）`,
    };
  }
  if (bucket.count >= RACE_MAX_PER_HOUR) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((hour - (now - bucket.windowStart)) / 1000),
      error: "予測の利用上限に達しました。しばらくしてから再度お試しください。",
    };
  }
  bucket.count += 1;
  bucket.lastAt = now;
  raceBuckets.set(key, bucket);
  return { ok: true };
}

/** 予測の連打抑止。DB 共有カウンタ＋プロセス内最短間隔。 */
export async function allowRaceReply(bucketKey: string): Promise<{
  ok: boolean;
  error?: string;
  retryAfterSec?: number;
}> {
  const local = allowRaceReplyLocal(bucketKey);
  if (!local.ok) return local;
  const shared = await allowAuthAttemptShared(`race-reply:${bucketKey || "anon"}`, {
    limit: RACE_MAX_PER_HOUR,
    windowMs: 60 * 60 * 1000,
  });
  if (!shared.ok) {
    return {
      ok: false,
      retryAfterSec: shared.retryAfterSec,
      error: "予測の利用上限に達しました。しばらくしてから再度お試しください。",
    };
  }
  return { ok: true };
}

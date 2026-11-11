import { NextRequest, NextResponse } from "next/server";
import { maybePostMorningHonmeiPicks } from "@/lib/chatMorningPicks";
import { allowAuthAttemptShared } from "@/lib/authRateLimit";

export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const cron = process.env.CRON_SECRET?.trim();
  if (!cron) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return Boolean(bearer && bearer === cron);
}

/** 朝の本命投稿。CRON_SECRET（Bearer）必須。 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized", hint: "Authorization: Bearer CRON_SECRET が必要です" },
      { status: 401 },
    );
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "cron";
  const gate = await allowAuthAttemptShared(`cron-morning-honmei:${ip}`, {
    limit: 12,
    windowMs: 60 * 60 * 1000,
  });
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfterSec: gate.retryAfterSec },
      {
        status: 429,
        headers: gate.retryAfterSec ? { "retry-after": String(gate.retryAfterSec) } : undefined,
      },
    );
  }
  let force = false;
  try {
    const body = (await req.json()) as { force?: boolean };
    force = Boolean(body.force);
  } catch {
    force = false;
  }
  try {
    const result = await maybePostMorningHonmeiPicks(new Date(), { force });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "morning post failed",
      },
      { status: 500 },
    );
  }
}

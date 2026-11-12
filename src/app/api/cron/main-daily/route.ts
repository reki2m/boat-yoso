import { NextRequest, NextResponse } from "next/server";
import {
  runMainAppExhibitionConfirm,
  runMainAppNightlyUpdate,
  runMainAppRoiLearn,
} from "@/lib/mainAppDaily";
import { allowAuthAttemptShared } from "@/lib/authRateLimit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const cron = process.env.CRON_SECRET?.trim();
  if (!cron) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return Boolean(bearer && bearer === cron);
}

/** 本体アプリの日次更新。CRON_SECRET（Bearer）必須。運営キーでは起動しない。 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized", hint: "Authorization: Bearer CRON_SECRET が必要です" },
      { status: 401 },
    );
  }
  const ip = req.headers.get("x-forwarded-for") || "cron";
  const gate = await allowAuthAttemptShared(`cron-main-daily:${ip}`, {
    limit: 6,
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

  let mode: "nightly" | "confirm" | "learn" = "nightly";
  try {
    const body = (await req.json()) as { mode?: string };
    if (body.mode === "confirm" || body.mode === "learn" || body.mode === "nightly") {
      mode = body.mode;
    }
  } catch {
    mode = "nightly";
  }

  try {
    if (mode === "confirm") {
      const result = await runMainAppExhibitionConfirm();
      return NextResponse.json(result);
    }
    if (mode === "learn") {
      const result = await runMainAppRoiLearn();
      return NextResponse.json(result);
    }
    const result = await runMainAppNightlyUpdate();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "main daily failed",
      },
      { status: 500 },
    );
  }
}

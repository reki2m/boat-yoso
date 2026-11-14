import { NextRequest, NextResponse } from "next/server";
import {
  runMainAppExhibitionConfirm,
  runMainAppNightlyUpdate,
  runMainAppRoiLearn,
} from "@/lib/mainAppDaily";
import { allowAuthAttemptShared } from "@/lib/authRateLimit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Mode = "nightly" | "confirm" | "learn";

function authorized(req: NextRequest): boolean {
  const cron = process.env.CRON_SECRET?.trim();
  if (!cron) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (bearer && bearer === cron) return true;
  // Vercel Cron は Authorization: Bearer CRON_SECRET を付ける
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  return Boolean(isVercelCron && bearer && bearer === cron);
}

function parseMode(raw: unknown): Mode {
  if (raw === "confirm" || raw === "learn" || raw === "nightly") return raw;
  return "nightly";
}

async function runMode(mode: Mode) {
  if (mode === "confirm") return runMainAppExhibitionConfirm();
  if (mode === "learn") return runMainAppRoiLearn();
  return runMainAppNightlyUpdate();
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized", hint: "Authorization: Bearer CRON_SECRET が必要です" },
      { status: 401 },
    );
  }
  const ip = req.headers.get("x-forwarded-for") || "cron";
  const gate = await allowAuthAttemptShared(`cron-main-daily:${ip}`, {
    limit: 24,
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

  let mode: Mode = parseMode(req.nextUrl.searchParams.get("mode"));
  if (req.method === "POST") {
    try {
      const body = (await req.json()) as { mode?: string };
      mode = parseMode(body.mode ?? mode);
    } catch {
      // keep query/default
    }
  }

  try {
    const result = await runMode(mode);
    return NextResponse.json({ ...result, mode });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        mode,
        error: error instanceof Error ? error.message : "main daily failed",
      },
      { status: 500 },
    );
  }
}

/** 本体アプリの日次更新。CRON_SECRET（Bearer）必須。Vercel Cron / POST 両対応。 */
export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

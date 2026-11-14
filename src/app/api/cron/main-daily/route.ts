import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  runMainAppExhibitionConfirm,
  runMainAppNightlyUpdate,
  runMainAppRoiLearn,
} from "@/lib/mainAppDaily";
import { allowAuthAttemptShared } from "@/lib/authRateLimit";

export const dynamic = "force-dynamic";
/** confirm は短め。nightly/learn も上限を抑えてリソース食いを防ぐ */
export const maxDuration = 90;

type Mode = "nightly" | "confirm" | "learn";

/** プロセス内の同時実行を拒否（複数インスタンスはレート制限で抑える） */
let cronBusy = false;

function safeEqualSecret(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function authorized(req: NextRequest): boolean {
  const cron = process.env.CRON_SECRET?.trim();
  if (!cron) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  if (!bearer || !safeEqualSecret(bearer, cron)) return false;
  return true;
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

  // グローバル連打上限（IP横断）
  const globalGate = await allowAuthAttemptShared("cron-main-daily:global", {
    limit: 4,
    windowMs: 60 * 60 * 1000,
  });
  if (!globalGate.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfterSec: globalGate.retryAfterSec },
      {
        status: 429,
        headers: globalGate.retryAfterSec
          ? { "retry-after": String(globalGate.retryAfterSec) }
          : undefined,
      },
    );
  }

  if (cronBusy) {
    return NextResponse.json(
      { ok: false, error: "busy", hint: "別の日次ジョブが実行中です" },
      { status: 409 },
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

  cronBusy = true;
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
  } finally {
    cronBusy = false;
  }
}

/** 本体アプリの日次更新。CRON_SECRET（Bearer）必須。Vercel Cron / POST 両対応。 */
export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

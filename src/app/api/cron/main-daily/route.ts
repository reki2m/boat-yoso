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
export const maxDuration = 120;

type Mode = "nightly" | "confirm" | "learn";

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
  // Vercel Cron は Authorization: Bearer CRON_SECRET を付ける。
  // 手動呼び出しも同じ Bearer で可（共有秘密が必須）。
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
  const ip = req.headers.get("x-forwarded-for") || "cron";
  // 重い Python ジョブの連打を抑える
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

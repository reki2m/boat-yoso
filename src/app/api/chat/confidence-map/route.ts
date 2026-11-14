import { NextRequest, NextResponse } from "next/server";
import { allowAuthAttemptShared } from "@/lib/authRateLimit";
import { buildRaceConfidenceMap } from "@/lib/raceConfidenceMap";
import {
  CHAT_SESSION_COOKIE,
  verifyChatSessionCookieValue,
} from "@/lib/chatSession";
import { jstDateKey } from "@/lib/stadiums";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * チャット入場者向け: 場の各R信頼度（色分け用）。
 * /api/chat 配下なので招待制チャットから呼べる（本体ゲート不要）。
 */
export async function GET(req: NextRequest) {
  const sessionId = verifyChatSessionCookieValue(
    req.cookies.get(CHAT_SESSION_COOKIE)?.value,
  );
  if (!sessionId) {
    return NextResponse.json(
      { ok: false, error: "先に入場してください" },
      { status: 401 },
    );
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "chat";
  const gate = await allowAuthAttemptShared(`chat-confidence-map:${sessionId || ip}`, {
    limit: 30,
    windowMs: 10 * 60 * 1000,
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

  const place = Number(req.nextUrl.searchParams.get("place") ?? "0");
  const date = req.nextUrl.searchParams.get("date") ?? jstDateKey();
  if (!Number.isInteger(place) || place < 1 || place > 24) {
    return NextResponse.json({ ok: false, error: "invalid place" }, { status: 400 });
  }
  if (!/^\d{8}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "invalid date" }, { status: 400 });
  }

  try {
    const map = await buildRaceConfidenceMap(place, date, { chunkSize: 3 });
    return NextResponse.json(
      { ok: true, ...map },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "confidence map failed",
      },
      { status: 500 },
    );
  }
}

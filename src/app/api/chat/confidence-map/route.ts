import { NextRequest, NextResponse } from "next/server";
import { allowAuthAttemptShared } from "@/lib/authRateLimit";
import { buildRaceConfidenceMap } from "@/lib/raceConfidenceMap";
import { checkInvite } from "@/lib/chatStore";
import {
  CHAT_SESSION_COOKIE,
  verifyChatSessionCookieValue,
} from "@/lib/chatSession";
import { jstDateKey } from "@/lib/stadiums";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type CacheEntry = { at: number; body: Record<string, unknown> };
const CACHE_TTL_MS = 90_000;
const cache = new Map<string, CacheEntry>();

/**
 * チャット入場者向け: 場の各R信頼度（色分け用）。
 * セッション Cookie または招待コードヘッダで認証（本体ゲート不要）。
 */
export async function GET(req: NextRequest) {
  const sessionId = verifyChatSessionCookieValue(
    req.cookies.get(CHAT_SESSION_COOKIE)?.value,
  );
  const invite =
    req.headers.get("x-chat-invite") || req.nextUrl.searchParams.get("invite");
  const invited = checkInvite(invite);
  if (!sessionId && !invited) {
    return NextResponse.json(
      { ok: false, error: "先に入場してください" },
      { status: 401 },
    );
  }

  const bucket = sessionId || `invite:${String(invite || "").slice(0, 24)}`;
  const gate = await allowAuthAttemptShared(`chat-confidence-map:${bucket}`, {
    limit: 60,
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

  const cacheKey = `${place}:${date}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.body, { headers: { "cache-control": "no-store" } });
  }

  try {
    const map = await buildRaceConfidenceMap(place, date, { chunkSize: 4 });
    const body = { ok: true, ...map };
    cache.set(cacheKey, { at: Date.now(), body });
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
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

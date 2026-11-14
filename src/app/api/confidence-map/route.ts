import { NextRequest, NextResponse } from "next/server";
import { allowAuthAttemptShared } from "@/lib/authRateLimit";
import { buildRaceConfidenceMap } from "@/lib/raceConfidenceMap";
import { jstDateKey } from "@/lib/stadiums";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 本体アプリ向け: 指定場の各レース本線信頼度（1-5）。
 * レース選択UIの色分け用。アプリ解錠ゲート必須（middleware）。
 */
export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "app";
  const gate = await allowAuthAttemptShared(`confidence-map:${ip}`, {
    limit: 40,
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
    return NextResponse.json({ error: "invalid place" }, { status: 400 });
  }
  if (!/^\d{8}$/.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  try {
    const map = await buildRaceConfidenceMap(place, date, { chunkSize: 3 });
    return NextResponse.json(
      {
        ok: true,
        ...map,
      },
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

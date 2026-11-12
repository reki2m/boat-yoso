import { NextRequest, NextResponse } from "next/server";
import { fetchKyoteiRaceBundle } from "@/lib/kyotei";
import { scoreRace } from "@/lib/predict";
import { confidenceFromRankings } from "@/lib/raceDeepPicks";
import { jstDateKey } from "@/lib/stadiums";

export const dynamic = "force-dynamic";

/**
 * 指定場の各レース本線信頼度（1-5）を返す。
 * レース選択UIの色分け用。
 */
export async function GET(req: NextRequest) {
  const place = Number(req.nextUrl.searchParams.get("place") ?? "0");
  const date = req.nextUrl.searchParams.get("date") ?? jstDateKey();
  if (!Number.isInteger(place) || place < 1 || place > 24) {
    return NextResponse.json({ error: "invalid place" }, { status: 400 });
  }
  if (!/^\d{8}$/.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const races = Array.from({ length: 12 }, (_, i) => i + 1);
  const confidences: Record<string, number> = {};
  const chunk = 4;
  for (let i = 0; i < races.length; i += chunk) {
    const slice = races.slice(i, i + chunk);
    const rows = await Promise.all(
      slice.map(async (race) => {
        try {
          const { payload } = await fetchKyoteiRaceBundle(place, race, date);
          if (!payload.racers?.length) return { race, confidence: 0 };
          const prediction = scoreRace(payload.racers);
          return {
            race,
            confidence: confidenceFromRankings(prediction.rankings),
          };
        } catch {
          return { race, confidence: 0 };
        }
      }),
    );
    for (const row of rows) {
      if (row.confidence > 0) confidences[String(row.race)] = row.confidence;
    }
  }

  return NextResponse.json(
    {
      ok: true,
      place,
      date,
      confidences,
      updated_at: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

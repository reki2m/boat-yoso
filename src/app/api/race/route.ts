import { NextRequest, NextResponse } from "next/server";
import { fetchKyoteiRace } from "@/lib/kyotei";
import { scoreRace } from "@/lib/predict";
import { buildTriplePrediction } from "@/lib/tripleSystem";
import { fetchTrifectaOdds } from "@/lib/oddsFetch";
import { annotateCourseSkills } from "@/lib/courseSkills";
import { jstDateKey } from "@/lib/stadiums";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const place = Number(req.nextUrl.searchParams.get("place") ?? "2");
  const race = Number(req.nextUrl.searchParams.get("race") ?? "1");
  const date = req.nextUrl.searchParams.get("date") ?? jstDateKey();
  const streamUrl = req.nextUrl.searchParams.get("stream") ?? undefined;

  if (!Number.isInteger(place) || place < 1 || place > 24) {
    return NextResponse.json({ error: "invalid place" }, { status: 400 });
  }
  if (!Number.isInteger(race) || race < 1 || race > 12) {
    return NextResponse.json({ error: "invalid race" }, { status: 400 });
  }
  if (!/^\d{8}$/.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const payload = await fetchKyoteiRace(place, race, date);
  const prediction = scoreRace(payload.racers);
  const { odds, source: oddsSource } = await fetchTrifectaOdds(place, race, date);
  const windParam = req.nextUrl.searchParams.get("wind");
  const windSpeed =
    windParam != null && windParam !== "" && Number.isFinite(Number(windParam))
      ? Number(windParam)
      : null;
  const triple = buildTriplePrediction({
    placeNo: place,
    dateKey: date,
    racers: payload.racers,
    trifectaOdds: odds,
    streamUrl,
    windSpeed,
  });
  const courseAnnotated = annotateCourseSkills(payload.racers);

  return NextResponse.json({
    ...payload,
    prediction,
    courseSkills: courseAnnotated.map((r) => ({
      course: r.course,
      name: r.name,
      playerNo: r.playerNo,
      skill: r.courseSkill,
    })),
    odds: {
      source: oddsSource,
      trifectaCount: Object.keys(odds).length,
      sample: Object.entries(odds)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 8)
        .map(([combo, value]) => ({ combo, odds: value })),
    },
    tripleSystem: triple,
  });
}

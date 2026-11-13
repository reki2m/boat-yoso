import { NextRequest, NextResponse } from "next/server";
import { fetchKyoteiRaceBundle } from "@/lib/kyotei";
import { scoreRace } from "@/lib/predict";
import { buildTriplePrediction } from "@/lib/tripleSystem";
import { fetchTrifectaOdds } from "@/lib/oddsFetch";
import { annotateCourseSkills } from "@/lib/courseSkills";
import { remapRacersToExhibitionCourses } from "@/lib/exhibition";
import { jstDateKey } from "@/lib/stadiums";
import { fetchStadiumSeriesForms } from "@/lib/seriesForm";
import { buildRaceDeepPicks } from "@/lib/raceDeepPicks";
import { recordExhibitionIncidents } from "@/lib/exhibitionIncidents";
import { analyzeLiveWithStream } from "@/lib/liveAnalysis";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const place = Number(req.nextUrl.searchParams.get("place") ?? "2");
  const race = Number(req.nextUrl.searchParams.get("race") ?? "1");
  const date = req.nextUrl.searchParams.get("date") ?? jstDateKey();
  const streamUrl = req.nextUrl.searchParams.get("stream") ?? undefined;
  const demoExhibition = req.nextUrl.searchParams.get("demoExhibition") === "1";
  const windParam = req.nextUrl.searchParams.get("wind");

  if (!Number.isInteger(place) || place < 1 || place > 24) {
    return NextResponse.json({ error: "invalid place" }, { status: 400 });
  }
  if (!Number.isInteger(race) || race < 1 || race > 12) {
    return NextResponse.json({ error: "invalid race" }, { status: 400 });
  }
  if (!/^\d{8}$/.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const [{ payload, exhibition }, seriesForms] = await Promise.all([
    fetchKyoteiRaceBundle(place, race, date, {
      forceSampleExhibition: demoExhibition,
    }),
    fetchStadiumSeriesForms(place, date, race),
  ]);
  const windSpeed =
    windParam != null && windParam !== "" && Number.isFinite(Number(windParam))
      ? Number(windParam)
      : payload.windSpeed ?? exhibition.windSpeed;

  // 買い目は番組枠ベースで固定。展示はゲート（確定/進入変更スキップ）と表示のみ。
  // 進入変更時は再マップしない。変更なしでも avgStart は番組値のまま。
  const racersForScore =
    exhibition.ready && !exhibition.entryChanged
      ? remapRacersToExhibitionCourses(payload.racers, exhibition)
      : payload.racers;
  const prediction = scoreRace(racersForScore);
  const { odds, source: oddsSource } = await fetchTrifectaOdds(place, race, date);
  const triple = buildTriplePrediction({
    placeNo: place,
    dateKey: date,
    raceNo: race,
    racers: payload.racers,
    trifectaOdds: odds,
    streamUrl,
    windSpeed,
    exhibition,
  });
  const courseAnnotated = annotateCourseSkills(racersForScore);
  const deepPicks = buildRaceDeepPicks({
    racers: racersForScore,
    scored: prediction.rankings,
    exhibition,
    seriesForms,
    placeName: payload.placeName,
    placeNo: place,
    raceNo: race,
    raceRank: payload.raceRank,
    raceName: payload.raceName,
  });

  const liveExtra = await analyzeLiveWithStream({
    streamUrl: streamUrl ?? undefined,
    placeNo: place,
    dateKey: date,
    raceNo: race,
    signals: exhibition.signals,
    exhibition: exhibition.boats.map((b) => ({
      boat: b.boat,
      name: b.name,
      st: b.slit,
      exhibit: b.lapTime,
      course: b.course ?? undefined,
      entry: b.entry,
    })),
  });
  void recordExhibitionIncidents({
    date,
    stadium: place,
    race,
    exhibition,
    streamNote: liveExtra.stream?.message,
  });

  return NextResponse.json({
    ...payload,
    prediction,
    exhibition,
    deepPicks,
    liveAnalysis: liveExtra,
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

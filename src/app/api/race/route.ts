import { NextRequest, NextResponse } from "next/server";
import { fetchKyoteiRace } from "@/lib/kyotei";
import { scoreRace } from "@/lib/predict";
import { jstDateKey } from "@/lib/stadiums";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const place = Number(req.nextUrl.searchParams.get("place") ?? "2");
  const race = Number(req.nextUrl.searchParams.get("race") ?? "1");
  const date = req.nextUrl.searchParams.get("date") ?? jstDateKey();

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
  return NextResponse.json({ ...payload, prediction });
}

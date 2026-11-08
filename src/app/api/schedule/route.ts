import { NextResponse } from "next/server";
import { fetchTodayStadiums } from "@/lib/kyotei";
import { STADIUMS, jstDateKey, jstLabel } from "@/lib/stadiums";

export const dynamic = "force-dynamic";

export async function GET() {
  const date = jstDateKey();
  const stadiumIds = await fetchTodayStadiums();
  return NextResponse.json({
    date,
    dateLabel: jstLabel(),
    stadiums: stadiumIds.map((id) => ({
      id,
      name: STADIUMS[id] ?? `場${id}`,
    })),
    races: Array.from({ length: 12 }, (_, i) => i + 1),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { fetchKyoteiRace } from "@/lib/kyotei";
import { scoreRace } from "@/lib/predict";
import {
  evaluateHonmeiEligibility,
  HONMEI_RULE,
  TICKET_LABEL,
} from "@/lib/honmeiRule";
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
  const c1 = payload.racers.find((r) => r.course === 1);
  const c2 = payload.racers.find((r) => r.course === 2);
  const honmei = c1
    ? evaluateHonmeiEligibility({
        placeNo: place,
        className: c1.className,
        nationalWin: c1.nationalWin,
        avgStart: c1.avgStart,
        motorTop2: c1.motorTop2,
        secondNationalWin: c2?.nationalWin ?? 0,
      })
    : { ok: false, reasons: ["1コースデータなし"], tickets: [] };

  return NextResponse.json({
    ...payload,
    prediction,
    honmeiSystem: {
      rule: HONMEI_RULE,
      ticketLabel: TICKET_LABEL[HONMEI_RULE.ticket],
      ...honmei,
      focus: "本命（イン逃げ高確率場）",
      nextPhases: ["押し目", "穴", "選手別得意コース", "展示ライブ解析"],
    },
  });
}

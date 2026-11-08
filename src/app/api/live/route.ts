import { NextResponse } from "next/server";
import { STADIUMS, jstDateKey } from "@/lib/stadiums";
import { liveBroadcastUrls } from "@/lib/liveBroadcast";
import { fetchTodayStadiums } from "@/lib/kyotei";

export const dynamic = "force-dynamic";

export async function GET() {
  const date = jstDateKey();
  const openIds = await fetchTodayStadiums();
  const openSet = new Set(openIds);
  const stadiums = Object.entries(STADIUMS).map(([id, name]) => {
    const placeNo = Number(id);
    const urls = liveBroadcastUrls(placeNo, date, 1);
    return {
      id: placeNo,
      name,
      open: openSet.has(placeNo),
      liveUrl: urls.mediaTop,
      raceIndex: urls.raceIndex,
      beforeInfo: urls.beforeInfo,
    };
  });

  return NextResponse.json({
    date,
    stadiums,
    openCount: openIds.length,
    note: "押すとその場の公式ライブ入口が開きます。配信は公式サイト側の提供状況に依存します。",
  });
}

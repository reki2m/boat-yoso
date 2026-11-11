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
      raceList: urls.raceList,
      officialSite: urls.officialSite,
      stadiumPage: urls.stadiumPage,
      liveNote: urls.liveNote,
    };
  });

  return NextResponse.json({
    date,
    stadiums,
    openCount: openIds.length,
    note:
      "各場の公式ホームページ／レース情報／場ライブを開けます（boatrace.jp 不使用）。開催時間外は配信なし表示になります。",
  });
}

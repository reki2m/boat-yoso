import { fetchKyoteiRaceBundle } from "@/lib/kyotei";
import { buildTriplePrediction } from "@/lib/tripleSystem";

export type LivePickRow = {
  date?: string;
  stadium?: number;
  stadium_name?: string;
  race?: number;
  tickets?: string[];
  status?: string;
  why?: string;
  skip_reason?: string | null;
  skip_detail?: string | null;
};

const SKIP_LABEL: Record<string, string> = {
  entry_change: "進入変更のためスキップ",
  exhibition_pending: "展示待ち",
  exhibition_fail: "展示ゲート不合格のためスキップ",
  race_closed: "締切済みのためスキップ",
  unexpected: "予期しない事態のためスキップ",
  odds_overbet: "オッズ回避のためスキップ",
  odds_missing_near_close: "締切間近・オッズ未取得のためスキップ",
  odds_pending: "オッズ待ち",
};

export function skipReasonLabel(code: string | null | undefined): string {
  if (!code) return "スキップ";
  return SKIP_LABEL[code] || code;
}

export async function refreshPicksStatus(picks: LivePickRow[]): Promise<LivePickRow[]> {
  const out: LivePickRow[] = [];
  for (const pick of picks) {
    const stadium = Number(pick.stadium || 0);
    const race = Number(pick.race || 0);
    const date = String(pick.date || "").replace(/-/g, "");
    if (!stadium || !race || !/^\d{8}$/.test(date)) {
      out.push(pick);
      continue;
    }
    try {
      const { payload, exhibition } = await fetchKyoteiRaceBundle(stadium, race, date);
      const triple = buildTriplePrediction({
        placeNo: stadium,
        dateKey: date,
        raceNo: race,
        racers: payload.racers,
        windSpeed: payload.windSpeed ?? exhibition.windSpeed,
        exhibition,
      });

      let status = pick.status || "provisional";
      let skipReason: string | null = pick.skip_reason ?? null;
      let skipDetail: string | null = null;
      let why = pick.why;

      if (triple.skipped || exhibition.entryChanged) {
        status = "skipped";
        skipReason = triple.skipReason || "entry_change";
        const changes = exhibition.changes
          .map((c) => `${c.boat}号${c.from}→${c.to}`)
          .join(" / ");
        skipDetail = changes
          ? `${skipReasonLabel(skipReason)}（${changes}）`
          : skipReasonLabel(skipReason);
        why = triple.focus || skipDetail;
      } else if (!exhibition.ready) {
        status = "provisional";
        skipReason = "exhibition_pending";
        skipDetail = exhibition.reason || "展示待ち";
        why = exhibition.reason;
      } else {
        status = "confirmed";
        skipReason = null;
        skipDetail = null;
        why = triple.focus || pick.why;
      }

      out.push({
        ...pick,
        status,
        skip_reason: skipReason,
        skip_detail: skipDetail,
        why,
        stadium_name: pick.stadium_name || payload.placeName,
      });
    } catch {
      out.push(pick);
    }
  }
  return out;
}

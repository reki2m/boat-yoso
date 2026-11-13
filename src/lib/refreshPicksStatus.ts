import { fetchKyoteiRaceBundle } from "@/lib/kyotei";
import { buildTriplePrediction } from "@/lib/tripleSystem";
import { recordExhibitionIncidents } from "@/lib/exhibitionIncidents";

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
  exhibition_notes?: string[];
};

const SKIP_LABEL: Record<string, string> = {
  entry_change: "進入変更だからスルー",
  exhibition_pending: "展示待ち",
  exhibition_fail: "展示が揃わないからスルー",
  race_closed: "締切済みだからスルー",
  unexpected: "想定外の展開だからスルー",
  odds_overbet: "買われすぎだからスルー",
  odds_missing_near_close: "締切間近でオッズが取れないからスルー",
  odds_pending: "オッズ待ち",
};

export function skipReasonLabel(code: string | null | undefined): string {
  if (!code) return "条件外だからスルー";
  return SKIP_LABEL[code] || `${code}だからスルー`;
}

/** チャット表示用の短い状態文 */
export function pickStatusPhrase(input: {
  status?: string | null;
  skip_reason?: string | null;
  skip_detail?: string | null;
}): string {
  const status = input.status || "";
  if (status === "skipped") {
    if (input.skip_detail && !input.skip_detail.includes("確定")) {
      return input.skip_detail;
    }
    return skipReasonLabel(input.skip_reason);
  }
  if (status === "provisional") return "展示待ち";
  if (status === "confirmed") return "確定";
  return status || "—";
}

/**
 * 展示確認後の状態更新。
 * 重要: tickets は絶対に書き換えない（展示前=展示後の買い目固定）。
 * 変わるのは status（provisional→confirmed/skipped）と理由文のみ。
 */
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
      const lockedTickets = pick.tickets?.length ? [...pick.tickets] : ["1-2-3"];

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

      const notes = [
        ...(exhibition.signals?.notes ?? []),
        ...(triple.live.aiSummary ?? []).slice(0, 3),
      ];

      // 事故学習（進入変更・伸び・周回）
      void recordExhibitionIncidents({
        date,
        stadium,
        race,
        exhibition,
        streamNote: triple.live.stream?.message,
      });

      out.push({
        ...pick,
        // 買い目は固定
        tickets: lockedTickets,
        status,
        skip_reason: skipReason,
        skip_detail: skipDetail,
        why,
        stadium_name: pick.stadium_name || payload.placeName,
        exhibition_notes: [...new Set(notes)].slice(0, 6),
      });
    } catch {
      out.push(pick);
    }
  }
  return out;
}

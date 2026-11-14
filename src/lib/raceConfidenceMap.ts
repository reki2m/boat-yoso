import { fetchKyoteiRaceBundle } from "@/lib/kyotei";
import { scoreRace } from "@/lib/predict";
import { confidenceFromRankings } from "@/lib/raceDeepPicks";

export type RaceConfidenceMap = {
  place: number;
  date: string;
  confidences: Record<string, number>;
  updated_at: string;
};

/**
 * 指定場の 1〜12R 本線信頼度（1-5）。UI色分け用。
 * 外部取得はチャンク並列（デフォルト4）で上限を抑える。
 */
export async function buildRaceConfidenceMap(
  place: number,
  date: string,
  opts?: { chunkSize?: number },
): Promise<RaceConfidenceMap> {
  const races = Array.from({ length: 12 }, (_, i) => i + 1);
  const confidences: Record<string, number> = {};
  const chunk = Math.max(1, Math.min(opts?.chunkSize ?? 3, 4));
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
  return {
    place,
    date,
    confidences,
    updated_at: new Date().toISOString(),
  };
}

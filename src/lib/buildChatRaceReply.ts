import { fetchKyoteiRaceBundle } from "@/lib/kyotei";
import { scoreRace } from "@/lib/predict";
import { buildTriplePrediction } from "@/lib/tripleSystem";
import { remapRacersToExhibitionCourses } from "@/lib/exhibition";
import { fetchStadiumSeriesForms } from "@/lib/seriesForm";
import { buildRaceDeepPicks } from "@/lib/raceDeepPicks";
import { liveBroadcastUrls } from "@/lib/liveBroadcast";
import { jstDateKey } from "@/lib/stadiums";
import type { RaceChatQuery } from "@/lib/parseRaceChatQuery";

export async function buildChatRaceReply(
  query: RaceChatQuery,
  dateKey = jstDateKey(),
): Promise<string> {
  const [{ payload, exhibition }, seriesForms] = await Promise.all([
    fetchKyoteiRaceBundle(query.placeNo, query.raceNo, dateKey),
    fetchStadiumSeriesForms(query.placeNo, dateKey, query.raceNo),
  ]);

  const racersForScore =
    exhibition.ready && !exhibition.entryChanged
      ? remapRacersToExhibitionCourses(payload.racers, exhibition)
      : payload.racers;
  const prediction = scoreRace(racersForScore);
  const triple = buildTriplePrediction({
    placeNo: query.placeNo,
    dateKey,
    raceNo: query.raceNo,
    racers: payload.racers,
    windSpeed: payload.windSpeed ?? exhibition.windSpeed,
    exhibition,
  });
  const deep = buildRaceDeepPicks({
    racers: racersForScore,
    scored: prediction.rankings,
    exhibition,
    seriesForms,
    placeName: payload.placeName || query.placeName,
    raceNo: query.raceNo,
  });
  const live = liveBroadcastUrls(query.placeNo, dateKey, query.raceNo);

  const lines: string[] = [
    `【予測】${query.placeName} ${query.raceNo}R（${dateKey}）`,
    exhibition.ready
      ? exhibition.entryChanged
        ? `展示: 進入変更あり → スキップ推奨`
        : `展示: 確定`
      : `展示: 待ち（${exhibition.reason}）`,
  ];

  if (triple.skipped) {
    lines.push(`判定: スキップ（${triple.skipReason || "entry_change"}）`);
    lines.push(triple.focus || "進入変更のため買い目は出しません。");
  } else {
    lines.push(`信頼度: ${deep.confidenceLabel}`);
    lines.push(`本線買い目（${deep.count}点）:`);
    for (const t of deep.tickets.slice(0, 6)) {
      lines.push(`・${t.combo}（${t.role}）${t.why ? ` — ${t.why}` : ""}`);
    }
    if (deep.anaCount > 0 && deep.anaTickets.length) {
      lines.push(`穴目（参考的中率 ${deep.anaHitPct}%）:`);
      for (const t of deep.anaTickets.slice(0, 4)) {
        lines.push(`・${t.combo}（${t.role}）`);
      }
    }
    if (deep.commentary[0]) lines.push(deep.commentary[0]);
    if (deep.commentary[1]) lines.push(deep.commentary[1]);
  }

  lines.push(`ライブ: ${live.mediaTop}`);
  lines.push(`直前: ${live.beforeInfo}`);
  lines.push("※参考情報です。的中を保証しません。");
  return lines.join("\n").slice(0, 1800);
}

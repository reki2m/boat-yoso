import { fetchKyoteiRaceBundle } from "@/lib/kyotei";
import { scoreRace } from "@/lib/predict";
import { buildTriplePrediction } from "@/lib/tripleSystem";
import { remapRacersToExhibitionCourses } from "@/lib/exhibition";
import { fetchStadiumSeriesForms } from "@/lib/seriesForm";
import { buildRaceDeepPicks } from "@/lib/raceDeepPicks";
import { liveBroadcastUrls } from "@/lib/liveBroadcast";
import { jstDateKey } from "@/lib/stadiums";
import type { RaceChatQuery } from "@/lib/parseRaceChatQuery";

function confidenceWord(score: number): string {
  if (score >= 5) return "強い";
  if (score >= 4) return "やや強い";
  if (score >= 3) return "中程度";
  if (score >= 2) return "やや弱い";
  return "弱い";
}

export type ChatRaceReplyPayload = {
  text: string;
  dateKey: string;
  placeNo: number;
  raceNo: number;
  tickets: string[];
  anaTickets: string[];
};

export async function buildChatRaceReply(
  query: RaceChatQuery,
  dateKey = jstDateKey(),
): Promise<ChatRaceReplyPayload> {
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
        ? `展示: 進入変更あり（${exhibition.changes.map((c) => `${c.boat}号${c.from}→${c.to}`).join(" / ")}）`
        : "展示: 確定（進入・スリット・周回タイム反映）"
      : `展示: 待ち — ${exhibition.reason}`,
  ];

  if (triple.skipped) {
    lines.push(
      `運用判定: スキップ（${triple.skipReason || "entry_change"}）`,
      triple.focus || "進入変更のため運用本命は出しません。以下は参考考察です。",
      "",
    );
  }

  // アプリ内「考察買い目」相当
  lines.push(
    `■ 本命期待度（信頼度）: ${deep.confidence}/5（${confidenceWord(deep.confidence)}）`,
    deep.confidenceLabel ? `　${deep.confidenceLabel}` : "",
    `軸: ${deep.axis}号 / 相手: ${deep.partners.join("・") || "—"}`,
    "",
    `■ 考察買い目（${deep.count}点）`,
  );
  for (const t of deep.tickets.slice(0, 6)) {
    lines.push(`・${t.combo}（${t.role}）`);
    if (t.why) lines.push(`　└ ${t.why}`);
  }

  lines.push("", "■ 考察コメント");
  for (const c of deep.commentary) {
    lines.push(c);
  }

  // アプリ内「穴目」相当
  lines.push("", "■ 穴目");
  if (deep.anaCount > 0 && deep.anaTickets.length) {
    lines.push(
      deep.anaConfidenceLabel || `参考的中率 ${deep.anaHitPct.toFixed(1)}%`,
      deep.anaAxis != null ? `穴軸: ${deep.anaAxis}号` : "",
      `穴買い目（${deep.anaCount}点）:`,
    );
    for (const t of deep.anaTickets.slice(0, 6)) {
      lines.push(`・${t.combo}（${t.role}）`);
      if (t.why) lines.push(`　└ ${t.why}`);
    }
    if (deep.anaCommentary.length) {
      lines.push("穴目コメント:");
      for (const c of deep.anaCommentary) lines.push(c);
    }
  } else {
    lines.push("今回の穴目は見送りです（参考的中率 0%）。");
    for (const c of deep.anaCommentary) lines.push(c);
  }

  // 上位評価の選手（短く）
  if (deep.racerViews?.length) {
    lines.push("", "■ 評価上位");
    for (const r of deep.racerViews.slice(0, 3)) {
      lines.push(
        `・${r.course}号 ${r.name}（${r.className}） score ${r.score.toFixed(1)} / 全国${r.nationalWin.toFixed(2)} / ST${r.avgStart.toFixed(2)} / モーター${r.motorTop2.toFixed(0)}%`,
      );
      if (r.reasons?.length) lines.push(`　└ ${r.reasons.slice(0, 2).join(" / ")}`);
    }
  }

  if (!triple.skipped && triple.focus) {
    lines.push("", `■ 運用本命メモ: ${triple.focus}`);
  }

  lines.push(
    "",
    `公式サイト: ${live.officialSite}`,
    `直前情報: ${live.beforeInfo}`,
    `出走表: ${live.raceList}`,
    `公式ライブ（場単位）: ${live.mediaTop}`,
    live.liveNote,
    "※アプリ内の考察と同じロジックです。参考情報であり的中を保証しません。",
  );

  return {
    text: lines.filter((l) => l !== "").join("\n").slice(0, 3500),
    dateKey,
    placeNo: query.placeNo,
    raceNo: query.raceNo,
    tickets: deep.tickets.map((t) => t.combo),
    anaTickets: deep.anaTickets.map((t) => t.combo),
  };
}

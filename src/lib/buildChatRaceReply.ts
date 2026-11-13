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
  /** チャットUIでは出さない（管理人ログ用に残す） */
  anaTickets: string[];
  why: string;
  status: "provisional" | "confirmed" | "skipped";
  exhibitionReady: boolean;
  entryChanged: boolean;
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
    placeNo: query.placeNo,
    raceNo: query.raceNo,
    raceRank: payload.raceRank,
    raceName: payload.raceName,
  });
  const live = liveBroadcastUrls(query.placeNo, dateKey, query.raceNo);

  const entryChanged = Boolean(exhibition.entryChanged);
  const exhibitionReady = Boolean(exhibition.ready);
  const status: ChatRaceReplyPayload["status"] = entryChanged
    ? "skipped"
    : exhibitionReady
      ? "confirmed"
      : "provisional";

  const statusLine =
    status === "skipped"
      ? "スルー（進入変更のため買わない）"
      : status === "confirmed"
        ? "確定（展示後・買ってOK）"
        : `展示待ち（${exhibition.reason || "展示・進入が揃うまで未確定"}）`;

  const whyParts: string[] = [];
  if (deep.confidenceLabel) whyParts.push(deep.confidenceLabel);
  if (deep.axis) whyParts.push(`軸${deep.axis}号 / 相手 ${deep.partners.join("・") || "—"}`);
  if (triple.skipped) {
    whyParts.push(triple.focus || "進入変更のため運用本命は見送り");
  } else if (triple.focus) {
    whyParts.push(triple.focus);
  }
  for (const c of deep.commentary.slice(0, 2)) {
    if (c) whyParts.push(c);
  }
  if (exhibition.signals?.notes?.length) {
    whyParts.push(`即時: ${exhibition.signals.notes.slice(0, 2).join(" / ")}`);
  }
  const why = whyParts.filter(Boolean).join(" ").slice(0, 280);

  const lines: string[] = [
    `【AI予想】${query.placeName} ${query.raceNo}R（${dateKey}）`,
    `状態: ${statusLine}`,
    `信頼度: ${deep.confidence}/5（${confidenceWord(deep.confidence)}）`,
    "",
    "【買い目】",
  ];

  if (status === "skipped") {
    lines.push("（スルーのため券種は出しません）");
  } else if (deep.count && deep.tickets.length) {
    for (const t of deep.tickets.slice(0, 6)) {
      lines.push(`・${t.combo}（${t.role}）`);
    }
  } else {
    lines.push("見送り（本線ゲート未達）");
  }

  lines.push("", "【説明】");
  if (why) {
    lines.push(why);
  } else {
    lines.push("詳細コメントなし");
  }

  lines.push(
    "",
    `場公式: ${live.officialSite}`,
    `レース情報: ${live.beforeInfo}`,
    "※参考情報です。的中を保証しません。",
  );

  return {
    text: lines.join("\n").slice(0, 1800),
    dateKey,
    placeNo: query.placeNo,
    raceNo: query.raceNo,
    tickets: status === "skipped" ? [] : deep.tickets.map((t) => t.combo),
    anaTickets: [],
    why,
    status,
    exhibitionReady,
    entryChanged,
  };
}

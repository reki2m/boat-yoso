import { fetchKyoteiRaceBundle } from "@/lib/kyotei";
import { scoreRace } from "@/lib/predict";
import { remapRacersToExhibitionCourses } from "@/lib/exhibition";
import { fetchStadiumSeriesForms } from "@/lib/seriesForm";
import { buildRaceDeepPicks, type DeepTicket } from "@/lib/raceDeepPicks";
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

export type ChatBandTicket = {
  combo: string;
  role: string;
  why: string;
  reasons?: string[];
};

export type ChatPickBands = {
  honmei: ChatBandTicket[];
  honmeiS: ChatBandTicket[];
  /** 本命S単点（5点と併記） */
  honmeiSSingle?: ChatBandTicket[];
  oshi: ChatBandTicket[];
  ana: ChatBandTicket[];
};

export type ChatRaceReplyPayload = {
  text: string;
  dateKey: string;
  placeNo: number;
  raceNo: number;
  /** 全帯の買い目（的中判定・互換用） */
  tickets: string[];
  bands: ChatPickBands;
  /** @deprecated 互換。bands.ana の combo 一覧 */
  anaTickets: string[];
  why: string;
  confidence: number;
  confidenceLabel: string;
  status: "provisional" | "confirmed" | "skipped";
  exhibitionReady: boolean;
  entryChanged: boolean;
};

function uniq(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of list) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function asBandTickets(list: DeepTicket[], limit?: number): ChatBandTicket[] {
  const rows = limit != null ? list.slice(0, limit) : list;
  return rows.map((t) => ({
    combo: t.combo,
    role: t.role,
    why: t.why || "",
    reasons: t.reasons?.length ? t.reasons : undefined,
  }));
}

function combosOf(list: ChatBandTicket[]): string[] {
  return list.map((t) => t.combo);
}

/** 本体アプリと同じ deepPicks を、チャット用本文・帯に整形する */
export async function buildChatRaceReply(
  query: RaceChatQuery,
  dateKey = jstDateKey(),
): Promise<ChatRaceReplyPayload> {
  const [{ payload, exhibition }, seriesForms] = await Promise.all([
    fetchKyoteiRaceBundle(query.placeNo, query.raceNo, dateKey),
    fetchStadiumSeriesForms(query.placeNo, dateKey, query.raceNo),
  ]);

  // 本体 /api/race と同じ：展示確定かつ進入変更なしならコース再マップ
  const racersForScore =
    exhibition.ready && !exhibition.entryChanged
      ? remapRacersToExhibitionCourses(payload.racers, exhibition)
      : payload.racers;
  const prediction = scoreRace(racersForScore);
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
  // 本体の deepPicks と同じく進入変更でも買い目は出す（本命ボードの「スルー」とは別）。
  const status: ChatRaceReplyPayload["status"] = exhibitionReady
    ? "confirmed"
    : "provisional";

  const statusLine = entryChanged
    ? status === "confirmed"
      ? "確定（進入変更あり・参考表示）"
      : `展示待ち（進入変更の可能性あり / ${exhibition.reason || "展示待ち"}）`
    : status === "confirmed"
      ? "確定（展示後・買ってOK）"
      : `展示待ち（${exhibition.reason || "展示・進入が揃うまで未確定"}）`;

  const bands: ChatPickBands = {
    honmei: asBandTickets(deep.tickets),
    honmeiS: deep.sReady ? asBandTickets(deep.sTickets) : [],
    honmeiSSingle: deep.sReady ? asBandTickets(deep.sSingleTickets || []) : [],
    oshi: asBandTickets(deep.oshiTickets, 4),
    ana: asBandTickets(deep.anaTickets, 4),
  };

  const tickets = uniq([
    ...combosOf(bands.honmeiSSingle || []),
    ...combosOf(bands.honmeiS),
    ...combosOf(bands.honmei),
    ...combosOf(bands.oshi),
    ...combosOf(bands.ana),
  ]);

  const confidence = deep.confidence;
  const confidenceLabel =
    deep.confidenceLabel || `${confidence}/5 ${confidenceWord(confidence)}`;

  const whyParts: string[] = [];
  if (entryChanged) {
    whyParts.push(
      "進入変更のサインあり。本体と同じ参考買い目を表示（本日の本命ボード対象外でもAI予想は出します）。",
    );
  }
  whyParts.push(`信頼度 ${confidenceLabel}`);
  if (deep.axis) whyParts.push(`軸${deep.axis}号 / 相手 ${deep.partners.join("・") || "—"}`);
  for (const c of deep.commentary.slice(0, 3)) {
    if (c) whyParts.push(c);
  }
  if (exhibition.signals?.notes?.length) {
    whyParts.push(`即時: ${exhibition.signals.notes.slice(0, 2).join(" / ")}`);
  }
  const why = whyParts.filter(Boolean).join(" ").slice(0, 320);

  const lines: string[] = [
    `【AI予想】${query.placeName} ${query.raceNo}R（${dateKey}）`,
    `状態: ${statusLine}`,
    `信頼度: ${confidence}/5（${confidenceWord(confidence)}）`,
    "",
    "【買い目】",
  ];

  lines.push(
    `本命(${bands.honmei.length}): ${combosOf(bands.honmei).join(" / ") || "—"}`,
  );
  lines.push(
    bands.honmeiSSingle?.length || bands.honmeiS.length
      ? [
          bands.honmeiSSingle?.length
            ? `本命S単点(${bands.honmeiSSingle.length}): ${combosOf(bands.honmeiSSingle).join(" / ")}`
            : null,
          bands.honmeiS.length
            ? `本命S5点(${bands.honmeiS.length}): ${combosOf(bands.honmeiS).join(" / ")}`
            : null,
        ]
          .filter(Boolean)
          .join("\n")
      : "本命S: 条件外",
  );
  lines.push(
    `押し目: ${combosOf(bands.oshi).join(" / ") || "見送り（検証ロジック）"}`,
  );
  lines.push(
    `穴: ${combosOf(bands.ana).join(" / ") || "見送り（検証ロジック）"}`,
  );

  lines.push("", "【説明】");
  if (why) lines.push(why);
  else lines.push("詳細コメントなし");
  lines.push("※上の「買い目」ボタンを押すと、各組の理由が開きます。");

  lines.push(
    "",
    `場公式: ${live.officialSite}`,
    `レース情報: ${live.beforeInfo}`,
    "※本体アプリと同じ予想エンジンです。的中を保証しません。",
  );

  return {
    text: lines.join("\n").slice(0, 2200),
    dateKey,
    placeNo: query.placeNo,
    raceNo: query.raceNo,
    tickets,
    bands,
    anaTickets: combosOf(bands.ana),
    why,
    confidence,
    confidenceLabel,
    status,
    exhibitionReady,
    entryChanged,
  };
}

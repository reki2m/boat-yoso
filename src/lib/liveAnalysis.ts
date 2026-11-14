import { liveBroadcastUrls } from "./liveBroadcast";
import type { ExhibitionSignalSummary } from "./exhibition";
import { safeGetReachability } from "./safeFetchUrl";

export type LiveAnalysisInput = {
  streamUrl?: string;
  exhibition?: Array<{
    boat: number;
    name: string;
    exhibit?: number | null;
    st?: number | null;
    course?: number;
    entry?: number;
  }>;
  signals?: ExhibitionSignalSummary | null;
  placeNo?: number;
  dateKey?: string;
  raceNo?: number;
};

export type LiveAnalysisResult = {
  status: "ready" | "queued" | "unavailable";
  message: string;
  exhibitionNotes: Array<{
    boat: number;
    name: string;
    score: number;
    notes: string[];
  }>;
  stream?: {
    url: string;
    status: string;
    message: string;
  };
  aiSummary?: string[];
};

function scoreExhibitionNotes(input: LiveAnalysisInput): LiveAnalysisResult["exhibitionNotes"] {
  const entries = input.exhibition ?? [];
  const exhibits = entries
    .map((e) => e.exhibit)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const median = exhibits.length
    ? [...exhibits].sort((a, b) => a - b)[Math.floor(exhibits.length / 2)]
    : null;

  const exhibitionNotes = entries.map((e) => {
    const notes: string[] = [];
    let score = 0;
    if (typeof e.exhibit === "number" && median != null) {
      const delta = median - e.exhibit;
      score += delta * 20;
      if (delta >= 0.05) notes.push("周回ペースが早い");
      else if (delta <= -0.05) notes.push("周回が遅い");
    }
    if (typeof e.st === "number") {
      if (e.st <= 0.1) {
        score += 2;
        notes.push("スリットがよく伸びた");
      } else if (e.st <= 0.12) {
        score += 1.5;
        notes.push("ST良い");
      } else if (e.st >= 0.2) {
        score -= 1;
        notes.push("ST遅い");
      }
    }
    if (typeof e.course === "number" && typeof e.entry === "number" && e.course !== e.entry) {
      notes.push(`進入変更 ${e.entry}→${e.course}`);
      score -= 3;
    }
    return {
      boat: e.boat,
      name: e.name,
      score: Math.round(score * 1000) / 1000,
      notes,
    };
  });
  exhibitionNotes.sort((a, b) => b.score - a.score);
  return exhibitionNotes;
}

function buildAiSummary(
  input: LiveAnalysisInput,
  exhibitionNotes: LiveAnalysisResult["exhibitionNotes"],
): string[] {
  const aiSummary = [...(input.signals?.notes ?? [])];
  for (const n of exhibitionNotes.slice(0, 3)) {
    if (n.notes.length) aiSummary.push(`${n.boat}号 ${n.name}: ${n.notes.join("、")}`);
  }
  return [...new Set(aiSummary)].slice(0, 8);
}

/** 展示タイム/STの数値解析 + シグナル要約（同期・買い目判定用） */
export function analyzeLive(input: LiveAnalysisInput): LiveAnalysisResult {
  const entries = input.exhibition ?? [];
  const exhibitionNotes = scoreExhibitionNotes(input);
  const aiSummary = buildAiSummary(input, exhibitionNotes);

  const stream = input.streamUrl
    ? {
        url: input.streamUrl,
        status: "queued",
        message:
          "映像フレームOCRは段階導入中。進入変更・スリット伸び・周回は直前CSVと展示値で即時判定。",
      }
    : undefined;

  return {
    status: entries.length ? "ready" : stream ? "queued" : "unavailable",
    message: entries.length
      ? "進入・スリット伸び・周回ペースを数値解析済み。"
      : "展示データ未取得。",
    exhibitionNotes,
    stream,
    aiSummary,
  };
}

/** 配信URL到達確認付き（API/チャット向け）。外部URLは許可ホストのみ。 */
export async function analyzeLiveWithStream(
  input: LiveAnalysisInput,
): Promise<LiveAnalysisResult> {
  const base = analyzeLive(input);
  // 呼び出し元の任意URLは使わず、場・日付・レースから公式導線のみ組み立てる
  const streamUrl =
    input.placeNo && input.dateKey
      ? liveBroadcastUrls(input.placeNo, input.dateKey, input.raceNo ?? 1).mediaTop
      : undefined;
  if (!streamUrl) return base;

  const reach = await safeGetReachability(streamUrl);
  const streamMessage = reach.ok
    ? `${reach.detail}。数値展示を主、映像は補助確認。`
    : `${reach.detail}。映像なしでも直前CSVの進入・スリット・周回で判定継続。`;

  return {
    ...base,
    stream: {
      url: streamUrl,
      status: reach.ok ? "reachable" : "unreachable",
      message: streamMessage,
    },
    aiSummary: [...new Set([...(base.aiSummary ?? []), streamMessage])].slice(0, 8),
  };
}

export function officialLiveUrl(placeNo: number, dateKey: string): string {
  return liveBroadcastUrls(placeNo, dateKey, 1).mediaTop;
}

import { liveBroadcastUrls } from "./liveBroadcast";

export type LiveAnalysisInput = {
  streamUrl?: string;
  exhibition?: Array<{
    boat: number;
    name: string;
    exhibit?: number | null;
    st?: number | null;
    course?: number;
  }>;
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
};

/** 展示タイム/STの数値解析 + ライブ映像フック（URL連携後に拡張） */
export function analyzeLive(input: LiveAnalysisInput): LiveAnalysisResult {
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
      if (delta >= 0.05) notes.push("展示が速い");
      else if (delta <= -0.05) notes.push("展示が遅い");
    }
    if (typeof e.st === "number") {
      if (e.st <= 0.12) {
        score += 1.5;
        notes.push("ST良い");
      } else if (e.st >= 0.2) {
        score -= 1;
        notes.push("ST遅い");
      }
    }
    return {
      boat: e.boat,
      name: e.name,
      score: Math.round(score * 1000) / 1000,
      notes,
    };
  });
  exhibitionNotes.sort((a, b) => b.score - a.score);

  const stream = input.streamUrl
    ? {
        url: input.streamUrl,
        status: "queued",
        message:
          "ライブ映像の進入・ターンマーク自動解析は配信URL連携後に拡張予定。現状は展示数値を使用。",
      }
    : undefined;

  return {
    status: entries.length ? "ready" : stream ? "queued" : "unavailable",
    message: entries.length
      ? "展示タイム/STを数値解析済み。映像解析フック待機中。"
      : "展示データ未取得。ライブ映像URLを渡せば解析キューに投入します。",
    exhibitionNotes,
    stream,
  };
}

export function officialLiveUrl(placeNo: number, dateKey: string): string {
  // 場公式HP / 場ライブのみ（boatrace.jp 不使用）
  return liveBroadcastUrls(placeNo, dateKey, 1).mediaTop;
}

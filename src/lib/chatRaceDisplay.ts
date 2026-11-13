/** クライアントでも使える買い目ステータス表示ヘルパ（DB依存なし） */

export type ChatPickBandsView = {
  honmei?: string[];
  honmeiS?: string[];
  oshi?: string[];
  ana?: string[];
};

export type RaceChipView = {
  placeNo: number;
  placeName: string;
  raceNo: number;
  label: string;
  tickets?: string[];
  bands?: ChatPickBandsView;
  status?: string;
  why?: string;
  exhibition?: "waiting" | "after" | "unknown";
};

export function hasBandTickets(bands?: ChatPickBandsView | null): boolean {
  if (!bands) return false;
  return Boolean(
    bands.honmei?.length ||
      bands.honmeiS?.length ||
      bands.oshi?.length ||
      bands.ana?.length,
  );
}

export type RaceStatusTone = "waiting" | "confirmed" | "skipped" | "unknown";

export function raceStatusTone(chip: RaceChipView): RaceStatusTone {
  if (chip.status === "skipped") return "skipped";
  if (chip.status === "confirmed") return "confirmed";
  if (
    chip.status === "provisional" ||
    chip.status === "programs_unavailable" ||
    chip.exhibition === "waiting"
  ) {
    return "waiting";
  }
  // 展示後投稿で status が薄い古いデータ向け
  if (chip.exhibition === "after") return "confirmed";
  return "unknown";
}

export function statusBadge(chip: RaceChipView): string {
  const tone = raceStatusTone(chip);
  if (tone === "skipped") return "スルー";
  if (tone === "confirmed") return "確定";
  if (tone === "waiting") return "展示待ち";
  return "";
}

export function statusDetail(chip: RaceChipView): string {
  const tone = raceStatusTone(chip);
  if (tone === "skipped") return "スルー（このレースは買わない）";
  if (tone === "confirmed") return "確定（展示後・買ってOK）";
  if (tone === "waiting") return "展示待ち（展示後に確定 or スルー）";
  return "状態未定";
}

export function chipToneClass(chip: RaceChipView): string {
  const tone = raceStatusTone(chip);
  if (tone === "skipped") return "skipped";
  if (tone === "confirmed") return "after";
  if (tone === "waiting") return "waiting";
  return "";
}

export function formatTickets(tickets: string[] | undefined, empty = "—"): string {
  const list = (tickets || []).map(String).filter(Boolean);
  return list.length ? list.join("  ") : empty;
}

export function summarizeChips(chips: RaceChipView[]): string {
  let waiting = 0;
  let confirmed = 0;
  let skipped = 0;
  for (const c of chips) {
    const tone = raceStatusTone(c);
    if (tone === "waiting") waiting += 1;
    else if (tone === "confirmed") confirmed += 1;
    else if (tone === "skipped") skipped += 1;
  }
  const parts: string[] = [];
  if (confirmed) parts.push(`確定${confirmed}`);
  if (waiting) parts.push(`展示待ち${waiting}`);
  if (skipped) parts.push(`スルー${skipped}`);
  return parts.join(" · ") || "対象なし";
}

/** 本文から【買い目】【説明】を分離（meta.races が無い古い投稿向け） */
export function splitPickBody(body: string): {
  summary: string;
  picksBlock: string;
  explainBlock: string;
  rest: string;
} {
  const text = body || "";
  const sections = text.split(/\n(?=【)/);
  let summary = "";
  let picksBlock = "";
  let explainBlock = "";
  const restParts: string[] = [];
  for (const raw of sections) {
    const s = raw.trim();
    if (!s) continue;
    if (s.startsWith("【買い目】")) picksBlock = s.replace(/^【買い目】\s*/, "").trim();
    else if (s.startsWith("【説明】")) explainBlock = s.replace(/^【説明】\s*/, "").trim();
    else if (s.startsWith("【スルー】")) restParts.push(s);
    else if (!summary && !s.startsWith("【")) summary = s;
    else restParts.push(s);
  }
  if (!summary) {
    summary = text.split("\n").slice(0, 2).join("\n");
  }
  return {
    summary,
    picksBlock,
    explainBlock,
    rest: restParts.join("\n\n").trim(),
  };
}

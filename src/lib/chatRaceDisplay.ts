/** クライアントでも使える買い目ステータス表示ヘルパ（DB依存なし） */

export type ChatBandTicketView = {
  combo: string;
  role?: string;
  why?: string;
  reasons?: string[];
  result?: "hit" | "miss";
  payout?: number;
};

export type ChatPickBandsView = {
  honmei?: Array<string | ChatBandTicketView>;
  honmeiS?: Array<string | ChatBandTicketView>;
  honmeiSSingle?: Array<string | ChatBandTicketView>;
  oshi?: Array<string | ChatBandTicketView>;
  ana?: Array<string | ChatBandTicketView>;
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
  confidence?: number;
  confidenceLabel?: string;
  exhibition?: "waiting" | "after" | "unknown";
  settled?: boolean;
  finishCombo?: string;
  ticketResults?: Array<{ combo: string; result: "hit" | "miss"; payout: number }>;
};

export function normalizeBandTickets(
  list: Array<string | ChatBandTicketView> | undefined,
): ChatBandTicketView[] {
  if (!list?.length) return [];
  return list.map((item) =>
    typeof item === "string"
      ? { combo: item, role: "", why: "" }
      : {
          combo: String(item.combo || ""),
          role: item.role || "",
          why: item.why || "",
          reasons: item.reasons?.length ? item.reasons : undefined,
          result: item.result,
          payout: item.payout,
        },
  ).filter((t) => t.combo);
}

export function hasBandTickets(bands?: ChatPickBandsView | null): boolean {
  if (!bands) return false;
  return Boolean(
    normalizeBandTickets(bands.honmei).length ||
      normalizeBandTickets(bands.honmeiSSingle).length ||
      normalizeBandTickets(bands.honmeiS).length ||
      normalizeBandTickets(bands.oshi).length ||
      normalizeBandTickets(bands.ana).length,
  );
}

export type RaceStatusTone =
  | "waiting"
  | "confirmed"
  | "skipped"
  | "result"
  | "unknown";

export function raceStatusTone(chip: RaceChipView): RaceStatusTone {
  if (chip.status === "skipped") return "skipped";
  // 公式結果が付いたら展示待ちのまま残さない
  if (chip.settled || chip.status === "settled" || chip.finishCombo) return "result";
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
  if (tone === "result") return "結果";
  // 展示完了後はオレンジ帯のまま「展示確認済み購入OK」
  if (tone === "confirmed") return "展示確認済み購入OK";
  if (tone === "waiting") return "展示待ち";
  return "";
}

export function statusDetail(chip: RaceChipView): string {
  const tone = raceStatusTone(chip);
  if (tone === "skipped") return "スルー（このレースは買わない）";
  if (tone === "result") {
    return chip.finishCombo
      ? `結果確定（着順 ${chip.finishCombo}）`
      : "結果確定";
  }
  if (tone === "confirmed") return "展示確認済み・購入OK";
  if (tone === "waiting") return "展示待ち（展示後に確定 or スルー）";
  return "状態未定";
}

export function chipToneClass(chip: RaceChipView): string {
  const tone = raceStatusTone(chip);
  if (tone === "skipped") return "skipped";
  if (tone === "result") return "result";
  // 購入OKも展示待ちと同じオレンジで目立たせる
  if (tone === "confirmed") return "waiting buyok";
  if (tone === "waiting") return "waiting";
  return "";
}

export function formatTicketPayout(payout: number | undefined): string {
  if (!payout || payout <= 0) return "";
  return `¥${payout.toLocaleString("ja-JP")}`;
}

export function formatTickets(tickets: string[] | undefined, empty = "—"): string {
  const list = (tickets || []).map(String).filter(Boolean);
  return list.length ? list.join("  ") : empty;
}

export function summarizeChips(chips: RaceChipView[]): string {
  let waiting = 0;
  let confirmed = 0;
  let skipped = 0;
  let result = 0;
  for (const c of chips) {
    const tone = raceStatusTone(c);
    if (tone === "waiting") waiting += 1;
    else if (tone === "confirmed") confirmed += 1;
    else if (tone === "skipped") skipped += 1;
    else if (tone === "result") result += 1;
  }
  const parts: string[] = [];
  if (result) parts.push(`結果${result}`);
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

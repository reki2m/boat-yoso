import { STADIUMS } from "@/lib/stadiums";
import type { ChatRaceChip } from "@/lib/chatStore";

type PickLike = {
  stadium?: number;
  stadium_name?: string;
  race?: number;
  tickets?: string[];
  status?: string;
  why?: string;
  skip_reason?: string | null;
  skip_detail?: string | null;
};

export type RaceStatusTone = "waiting" | "confirmed" | "skipped" | "unknown";

function exhibitionFromStatus(status: string | undefined): ChatRaceChip["exhibition"] {
  if (status === "confirmed") return "after";
  if (status === "provisional" || status === "programs_unavailable") return "waiting";
  if (status === "skipped") return "unknown";
  return "unknown";
}

export function raceChipLabel(placeName: string, raceNo: number): string {
  return `${placeName} ${raceNo}R`;
}

export function raceStatusTone(chip: PickLike | ChatRaceChip): RaceStatusTone {
  const status = "status" in chip ? chip.status : undefined;
  const exhibition = "exhibition" in chip ? chip.exhibition : undefined;
  if (status === "skipped") return "skipped";
  if (status === "confirmed") return "confirmed";
  if (
    status === "provisional" ||
    status === "programs_unavailable" ||
    exhibition === "waiting"
  ) {
    return "waiting";
  }
  if (exhibition === "after") return "confirmed";
  return "unknown";
}

/** チップ上の短いバッジ（展示待ち / 確定 / スルー） */
export function statusLabel(chip: PickLike | ChatRaceChip): string {
  const tone = raceStatusTone(chip);
  if (tone === "skipped") return "スルー";
  if (tone === "confirmed") return "確定";
  if (tone === "waiting") return "展示待ち";
  return "";
}

/** 詳細パネル用の一文 */
export function statusDetailLabel(chip: PickLike | ChatRaceChip): string {
  const tone = raceStatusTone(chip);
  if (tone === "skipped") return "スルー（このレースは買わない）";
  if (tone === "confirmed") return "確定（展示後・買ってOK）";
  if (tone === "waiting") return "展示待ち（展示後に確定 or スルー）";
  return "状態未定";
}

export function chipToneClass(chip: PickLike | ChatRaceChip): string {
  const tone = raceStatusTone(chip);
  if (tone === "skipped") return "skipped";
  if (tone === "confirmed") return "after";
  if (tone === "waiting") return "waiting";
  return "";
}

export function formatTickets(tickets: string[] | undefined, empty = "—"): string {
  const list = (tickets || []).map(String).filter(Boolean);
  return list.length ? list.join(" / ") : empty;
}

export function buildRaceChipsFromPicks(picks: PickLike[]): ChatRaceChip[] {
  const out: ChatRaceChip[] = [];
  for (const p of picks) {
    const placeNo = Number(p.stadium || 0);
    const raceNo = Number(p.race || 0);
    if (!placeNo || !raceNo) continue;
    const placeName = p.stadium_name || STADIUMS[placeNo] || `場${placeNo}`;
    const why =
      typeof p.why === "string" && p.why.trim()
        ? p.why.trim()
        : typeof p.skip_detail === "string" && p.skip_detail.trim()
          ? p.skip_detail.trim()
          : undefined;
    out.push({
      placeNo,
      placeName,
      raceNo,
      label: raceChipLabel(placeName, raceNo),
      tickets: Array.isArray(p.tickets) ? p.tickets.map(String) : [],
      status: p.status || "provisional",
      why,
      exhibition: exhibitionFromStatus(p.status),
    });
  }
  return out;
}

export function buildSingleRaceChip(opts: {
  placeNo: number;
  placeName?: string;
  raceNo: number;
  tickets?: string[];
  bands?: ChatRaceChip["bands"];
  status?: string;
  why?: string;
  exhibition?: ChatRaceChip["exhibition"];
}): ChatRaceChip {
  const placeName = opts.placeName || STADIUMS[opts.placeNo] || `場${opts.placeNo}`;
  return {
    placeNo: opts.placeNo,
    placeName,
    raceNo: opts.raceNo,
    label: raceChipLabel(placeName, opts.raceNo),
    tickets: opts.tickets || [],
    bands: opts.bands,
    status: opts.status,
    why: opts.why,
    exhibition: opts.exhibition || exhibitionFromStatus(opts.status),
  };
}

/** 古い本文からのフォールバック（・桐生 1R …） */
export function parseRaceChipsFromBody(body: string): ChatRaceChip[] {
  const chips: ChatRaceChip[] = [];
  const re = /[・･]\s*([^\s\d]{1,8})\s*(\d{1,2})\s*R/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body || ""))) {
    const placeName = m[1];
    const raceNo = Number(m[2]);
    const placeNo =
      Number(
        Object.entries(STADIUMS).find(([, name]) => name === placeName)?.[0] || 0,
      ) || 0;
    if (!raceNo) continue;
    chips.push({
      placeNo,
      placeName,
      raceNo,
      label: raceChipLabel(placeName, raceNo),
      tickets: [],
      exhibition: "unknown",
    });
  }
  return chips;
}

export function summarizeRaceStatuses(chips: ChatRaceChip[]): {
  waiting: number;
  confirmed: number;
  skipped: number;
  line: string;
} {
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
  return {
    waiting,
    confirmed,
    skipped,
    line: parts.join(" · ") || "対象なし",
  };
}

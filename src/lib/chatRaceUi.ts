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
};

function exhibitionFromStatus(status: string | undefined): ChatRaceChip["exhibition"] {
  if (status === "confirmed") return "after";
  if (status === "provisional" || status === "programs_unavailable") return "waiting";
  if (status === "skipped") return "unknown";
  return "unknown";
}

export function raceChipLabel(placeName: string, raceNo: number): string {
  return `${placeName} ${raceNo}R`;
}

export function buildRaceChipsFromPicks(picks: PickLike[]): ChatRaceChip[] {
  const out: ChatRaceChip[] = [];
  for (const p of picks) {
    const placeNo = Number(p.stadium || 0);
    const raceNo = Number(p.race || 0);
    if (!placeNo || !raceNo) continue;
    const placeName = p.stadium_name || STADIUMS[placeNo] || `場${placeNo}`;
    out.push({
      placeNo,
      placeName,
      raceNo,
      label: raceChipLabel(placeName, raceNo),
      tickets: Array.isArray(p.tickets) ? p.tickets.map(String) : [],
      status: p.status || "provisional",
      why: typeof p.why === "string" ? p.why : undefined,
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

export function statusLabel(chip: ChatRaceChip): string {
  if (chip.status === "skipped") return "見送り";
  if (chip.exhibition === "after" || chip.status === "confirmed") return "展示後";
  if (chip.exhibition === "waiting" || chip.status === "provisional") return "展示待ち";
  return "";
}

import { liveBroadcastUrls } from "@/lib/liveBroadcast";
import { generateHonmeiDayBoard } from "@/lib/generateHonmeiDayBoard";
import { loadPicksBoardForDate } from "@/lib/loadPicksBoard";
import {
  pickStatusPhrase,
  refreshPicksStatus,
  skipReasonLabel,
  type LivePickRow,
} from "@/lib/refreshPicksStatus";
import { jstDateKey } from "@/lib/stadiums";
import picksBoard from "@/data/picks_board.json";

export type ChatLiveTarget = {
  date: string;
  stadium: number;
  stadium_name: string;
  race: number;
  tickets: string[];
  tickets_single?: string[];
  tickets_five?: string[];
  label?: string | null;
  status: string;
  skip_detail: string | null;
  why: string | null;
  live: ReturnType<typeof liveBroadcastUrls>;
};

function mapBoardPicks(
  picks: Array<Record<string, unknown>>,
  dateFallback: string,
): LivePickRow[] {
  return picks.map((p) => ({
    date: String(p.date || dateFallback),
    stadium: Number(p.stadium || 0),
    stadium_name: typeof p.stadium_name === "string" ? p.stadium_name : undefined,
    race: Number(p.race || 0),
    tickets: Array.isArray(p.tickets) ? (p.tickets as string[]) : ["1-2-3"],
    tickets_single: Array.isArray(p.tickets_single)
      ? (p.tickets_single as string[])
      : undefined,
    tickets_five: Array.isArray(p.tickets_five) ? (p.tickets_five as string[]) : undefined,
    label: typeof p.label === "string" ? p.label : undefined,
    status: typeof p.status === "string" ? p.status : "provisional",
    why: typeof p.why === "string" ? p.why : undefined,
    skip_reason: typeof p.skip_reason === "string" ? p.skip_reason : null,
    skip_detail: typeof p.skip_detail === "string" ? p.skip_detail : null,
  }));
}

/** 同一場×レースは1件にまとめる（単点/5点の二重行を潰す） */
function dedupeRacePicks(picks: LivePickRow[]): LivePickRow[] {
  const byKey = new Map<string, LivePickRow>();
  for (const p of picks) {
    const key = `${Number(p.stadium)}-${Number(p.race)}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...p });
      continue;
    }
    const single = [
      ...new Set([...(prev.tickets_single || []), ...(p.tickets_single || [])]),
    ];
    const five = [...new Set([...(prev.tickets_five || []), ...(p.tickets_five || [])])];
    // 旧形式: tickets が単点1本 or 5点の片方だけの行が来た場合の吸収
    const prevTickets = prev.tickets || [];
    const nextTickets = p.tickets || [];
    if (prevTickets.length === 1 && !single.includes(prevTickets[0])) single.push(prevTickets[0]);
    if (nextTickets.length === 1 && !single.includes(nextTickets[0])) single.push(nextTickets[0]);
    if (prevTickets.length > 1) {
      for (const t of prevTickets) if (!five.includes(t)) five.push(t);
    }
    if (nextTickets.length > 1) {
      for (const t of nextTickets) if (!five.includes(t)) five.push(t);
    }
    byKey.set(key, {
      ...prev,
      ...p,
      tickets: five.length ? five : single.length ? single : prev.tickets,
      tickets_single: single.length ? single : undefined,
      tickets_five: five.length ? five : undefined,
      label:
        five.length && single.length
          ? "本命S・単点+5点"
          : p.label || prev.label || "本命S",
      why: [prev.why, p.why].filter(Boolean).join(" / ") || prev.why,
    });
  }
  return [...byKey.values()];
}

async function resolveTodayPicks(dateKey: string): Promise<LivePickRow[]> {
  const existing = await loadPicksBoardForDate(dateKey);
  if (existing && Array.isArray(existing.picks) && existing.picks.length) {
    return mapBoardPicks(existing.picks as Array<Record<string, unknown>>, dateKey).filter(
      (p) => String(p.date) === dateKey,
    );
  }
  try {
    const generated = await generateHonmeiDayBoard(dateKey);
    if (Array.isArray(generated.picks) && generated.picks.length) {
      return mapBoardPicks(generated.picks as Array<Record<string, unknown>>, dateKey).filter(
        (p) => String(p.date) === dateKey,
      );
    }
  } catch {
    // fall through to static board
  }
  const board = picksBoard as {
    active_date?: string;
    date?: string;
    picks?: Array<Record<string, unknown>>;
  };
  const dateFallback = String(board.active_date || board.date || dateKey);
  return mapBoardPicks(board.picks || [], dateFallback).filter((p) => String(p.date) === dateKey);
}

export async function getChatLiveTargets(opts?: { refresh?: boolean }): Promise<{
  date: string;
  targets: ChatLiveTarget[];
}> {
  const dateKey = jstDateKey();
  let picks = dedupeRacePicks(await resolveTodayPicks(dateKey));
  if (opts?.refresh && picks.length) {
    picks = dedupeRacePicks(await refreshPicksStatus(picks));
  }

  const targets: ChatLiveTarget[] = picks
    .filter((p) => p.stadium && p.race && p.date && /^\d{8}$/.test(String(p.date)))
    .map((p) => {
      const date = String(p.date);
      const stadium = Number(p.stadium);
      const race = Number(p.race);
      const status = p.status || "provisional";
      const skip_detail =
        status === "skipped"
          ? p.skip_detail || skipReasonLabel(p.skip_reason)
          : null;
      const phrase = pickStatusPhrase({
        status,
        skip_reason: p.skip_reason,
        skip_detail,
      });
      return {
        date,
        stadium,
        stadium_name: p.stadium_name || `場${stadium}`,
        race,
        tickets: p.tickets?.length ? p.tickets : ["1-2-3"],
        tickets_single: p.tickets_single,
        tickets_five: p.tickets_five,
        label: p.label || null,
        status,
        skip_detail,
        why: status === "skipped" ? phrase : p.why || null,
        live: liveBroadcastUrls(stadium, date, race),
      };
    });

  return { date: dateKey, targets };
}

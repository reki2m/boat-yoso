import { liveBroadcastUrls } from "@/lib/liveBroadcast";
import { resolvePicksBoardForToday } from "@/lib/picksBoardView";
import {
  pickStatusPhrase,
  refreshPicksStatus,
  skipReasonLabel,
  type LivePickRow,
} from "@/lib/refreshPicksStatus";

export type ChatLiveTarget = {
  date: string;
  stadium: number;
  stadium_name: string;
  race: number;
  tickets: string[];
  status: string;
  skip_detail: string | null;
  why: string | null;
  live: ReturnType<typeof liveBroadcastUrls>;
};

function boardPicks(): LivePickRow[] {
  const { board } = resolvePicksBoardForToday();
  const dateFallback = String(board.active_date || board.date || "");
  return (board.picks || []).map((p) => ({
    date: String(p.date || dateFallback),
    stadium: Number(p.stadium || 0),
    stadium_name: typeof p.stadium_name === "string" ? p.stadium_name : undefined,
    race: Number(p.race || 0),
    tickets: Array.isArray(p.tickets) ? (p.tickets as string[]) : ["1-2-3"],
    status: typeof p.status === "string" ? p.status : "provisional",
    why: typeof p.why === "string" ? p.why : undefined,
    skip_reason: typeof p.skip_reason === "string" ? p.skip_reason : null,
    skip_detail: typeof p.skip_detail === "string" ? p.skip_detail : null,
  }));
}

export async function getChatLiveTargets(opts?: { refresh?: boolean }): Promise<{
  date: string;
  targets: ChatLiveTarget[];
}> {
  const { board, today } = resolvePicksBoardForToday();
  const dateKey = String(board.active_date || board.date || today);
  let picks = boardPicks().filter((p) => String(p.date) === dateKey);
  if (opts?.refresh) {
    picks = await refreshPicksStatus(picks);
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
        status,
        skip_detail,
        why: status === "skipped" ? phrase : p.why || null,
        live: liveBroadcastUrls(stadium, date, race),
      };
    });

  return { date: dateKey, targets };
}

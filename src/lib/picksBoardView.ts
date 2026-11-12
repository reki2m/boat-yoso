import picksBoard from "@/data/picks_board.json";
import { jstDateKey } from "@/lib/stadiums";

export type PicksBoardDoc = {
  active_date?: string;
  date?: string;
  phase?: string;
  generated_at?: string;
  mode?: string;
  picks?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

/** 前日の買い目が朝まで残らないよう、JST当日以外は空板にする */
export function resolvePicksBoardForToday(now = new Date()): {
  board: PicksBoardDoc;
  today: string;
  stale: boolean;
} {
  const today = jstDateKey(now);
  const raw = picksBoard as PicksBoardDoc;
  const boardDate = String(raw.active_date || raw.date || "");
  if (boardDate && boardDate !== today) {
    return {
      today,
      stale: true,
      board: {
        ...raw,
        active_date: today,
        date: today,
        phase: "awaiting_today",
        picks: [],
        stale_from: boardDate,
        note: `${boardDate} の買い目は前日分のため非表示。当日分の生成待ちです。`,
      },
    };
  }
  return { board: raw, today, stale: false };
}

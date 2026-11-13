import { NextResponse } from "next/server";
import picksBoard from "@/data/picks_board.json";
import accuracy from "@/data/accuracy_summary.json";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { jstDateKey } from "@/lib/stadiums";

export const dynamic = "force-dynamic";

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/** 日次更新後のランタイム板を優先（バンドルより新しい src/data・reports） */
function loadLiveBoard(): Record<string, unknown> {
  const candidates = [
    path.join(process.cwd(), "src", "data", "picks_board.json"),
    path.join(process.cwd(), "data", "reports", "picks_board.json"),
  ];
  for (const file of candidates) {
    const doc = readJsonFile<Record<string, unknown>>(file);
    if (doc && Array.isArray(doc.picks)) return doc;
  }
  return picksBoard as Record<string, unknown>;
}

function loadLiveAccuracy(): Record<string, unknown> {
  const candidates = [
    path.join(process.cwd(), "src", "data", "accuracy_summary.json"),
    path.join(process.cwd(), "data", "reports", "accuracy_summary.json"),
  ];
  for (const file of candidates) {
    const doc = readJsonFile<Record<string, unknown>>(file);
    if (doc) return doc;
  }
  return accuracy as Record<string, unknown>;
}

type PickRow = {
  date?: string;
  stadium?: number;
  stadium_name?: string;
  race?: number;
  band?: string;
  label?: string;
  tickets?: string[];
  status?: string;
  why?: string;
  reasons?: string[];
};

/** 当日分だけ。前日の説明付き買い目がアプリに混ざらないようにする */
function loadTodayExplainedPicks(today: string, limit = 8): PickRow[] {
  const dir = path.join(process.cwd(), "data", "reports");
  if (!existsSync(dir)) return [];
  const file = path.join(dir, `picks_${today}.json`);
  if (!existsSync(file)) return [];
  try {
    const doc = JSON.parse(readFileSync(file, "utf8")) as { picks?: PickRow[] };
    return (doc.picks || [])
      .filter((p) => Boolean(p.why || (p.reasons || []).length))
      .filter((p) => String(p.date || today) === today)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** 前日板が朝まで残らないよう、JST当日以外は空板にする */
function boardForToday(raw: Record<string, unknown>, today: string) {
  const boardDate = String(raw.active_date || raw.date || "");
  if (boardDate && boardDate !== today) {
    return {
      board: {
        ...raw,
        active_date: today,
        date: today,
        phase: "awaiting_today",
        picks: [],
        stale_from: boardDate,
        note: `${boardDate} の買い目は前日分のため非表示。当日分の生成待ちです。`,
      },
      stale: true,
    };
  }
  const picks = Array.isArray(raw.picks) ? (raw.picks as PickRow[]) : [];
  const todays = picks.filter((p) => String(p.date || boardDate) === today);
  return {
    board: {
      ...raw,
      active_date: today,
      date: today,
      picks: todays,
    },
    stale: false,
  };
}

export async function GET() {
  const today = jstDateKey();
  const live = loadLiveBoard();
  const { board, stale } = boardForToday(live, today);
  const liveAccuracy = loadLiveAccuracy();
  const recent = loadTodayExplainedPicks(today, 8);
  return NextResponse.json({
    board,
    today,
    stale,
    recent,
    accuracy: liveAccuracy,
    policy: {
      day_before: true,
      skip_on_entry_change: true,
      require_start_exhibition: true,
      mode: "honmei_fixed_tickets",
      disabled_systems: ["oshi", "ana", "tri_1axis_6"],
      variable_count: false,
      max_per_day: 2,
      points: 1,
      stadium_whitelist: [8, 12, 15, 17, 18, 19],
      race_blacklist: [1, 9],
      stadium_blacklist: [9, 13, 21],
      odds_filter: true,
      exhibition_strict: true,
      note: "本命のみ。買い目は朝固定・展示後は確定/スキップのみ。津・尼崎除外。1R/9R除外。",
    },
  });
}

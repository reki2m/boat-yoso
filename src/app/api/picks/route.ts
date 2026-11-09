import { NextResponse } from "next/server";
import picksBoard from "@/data/picks_board.json";
import accuracy from "@/data/accuracy_summary.json";
import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

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

function loadRecentExplainedPicks(limit = 8): PickRow[] {
  const dir = path.join(process.cwd(), "data", "reports");
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => /^picks_20\d{6}\.json$/.test(f))
    .sort()
    .reverse();
  const out: PickRow[] = [];
  for (const file of files) {
    try {
      const doc = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as {
        picks?: PickRow[];
      };
      for (const p of doc.picks || []) {
        if (!p.why && !(p.reasons || []).length) continue;
        out.push(p);
        if (out.length >= limit) return out;
      }
    } catch {
      // ignore broken day files
    }
  }
  return out;
}

export async function GET() {
  const board = picksBoard as {
    picks?: PickRow[];
    [key: string]: unknown;
  };
  const recent = loadRecentExplainedPicks(8);
  return NextResponse.json({
    board,
    recent,
    accuracy,
    policy: {
      day_before: true,
      skip_on_entry_change: true,
      require_start_exhibition: true,
      mode: "honmei_volume_single",
      disabled_systems: ["oshi", "ana", "tri_1axis_6"],
      variable_count: true,
      max_per_day: 2,
      points: 2,
      stadium_blacklist: [21],
      odds_filter: true,
      exhibition_strict: true,
      note: "本命ボリューム単点。1日最大2R（平均約1.7）・A1/勝率6.5/ST0.15/モーター35・1-2-3のみ・芦屋除外。",
    },
  });
}

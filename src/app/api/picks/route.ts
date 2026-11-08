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
      note: "前日に買い目を出し、当日はスタート展示確認。進入変更・予期しない事態はスキップ。各買い目には採用理由の説明文を付与。",
    },
  });
}

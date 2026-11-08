import { NextResponse } from "next/server";
import picksBoard from "@/data/picks_board.json";
import accuracy from "@/data/accuracy_summary.json";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    board: picksBoard,
    accuracy,
    policy: {
      day_before: true,
      skip_on_entry_change: true,
      require_start_exhibition: true,
      note: "前日に買い目を出し、当日はスタート展示確認。進入変更・予期しない事態はスキップ。",
    },
  });
}

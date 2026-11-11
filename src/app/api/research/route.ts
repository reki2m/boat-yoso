import { NextResponse } from "next/server";
import hot from "@/data/hot_racers.json";
import stadium from "@/data/stadium_innige_rates.json";
import locked from "@/data/locked_honmei_rule.json";
import lockedTriple from "@/data/locked_triple_rules.json";
import backtest from "@/data/honmei_backtest.json";
import equity from "@/data/equity_10k.json";
import { TICKET_LABEL } from "@/lib/honmeiRule";
import { existsSync, readFileSync } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

function readOptionalJson(relParts: string[]): Record<string, unknown> | null {
  const file = path.join(process.cwd(), ...relParts);
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET() {
  const triple = lockedTriple as {
    honmei?: Record<string, unknown>;
    oshi?: Record<string, unknown> | null;
    ana?: Record<string, unknown> | null;
  };
  const updateState =
    readOptionalJson(["src", "data", "update_state.json"]) ||
    readOptionalJson(["data", "update_state.json"]) ||
    {};
  const learningState =
    readOptionalJson(["src", "data", "learning_state.json"]) ||
    readOptionalJson(["data", "reports", "learning_state.json"]) ||
    {};
  const opsLive =
    readOptionalJson(["src", "data", "ops_live.json"]) ||
    readOptionalJson(["data", "reports", "ops_live.json"]) ||
    {};

  return NextResponse.json({
    sources: {
      kyoteibiyori: "出走・当日詳細（アプリ実行時）",
      teikoku_successor: "艇愛ボートレースDB (boatrace-db.jp) ※艇国DB後継",
      openapi: "boatraceopenapi results/programs/odds 2021-2026",
    },
    update: {
      cadence: "毎日自動（最新データ→本命買い目→展示確認→的中再計算→回収率学習）",
      script: "scripts/nightly_update.py + scripts/learn_roi_daily.py",
      last_success_at: updateState.last_success_at || null,
      last_success_date: updateState.last_success_date || null,
      last_confirm_at: updateState.last_confirm_at || null,
      auto: true,
      policy: {
        mode: "honmei_fix_race_filter",
        day_before_picks: true,
        skip_on_entry_change: true,
        require_start_exhibition: true,
        no_oshi_ana: true,
        auto_learn_roi: true,
      },
    },
    learning: {
      ...(learningState || {}),
      ops_status: opsLive.status || null,
      rolling_roi:
        opsLive.rolling_roi ??
        (learningState.baseline as { roi?: number } | undefined)?.roi ??
        null,
    },
    lockedHonmei: {
      ...locked,
      ticketLabel: TICKET_LABEL[(locked as { ticket: string }).ticket] ?? locked,
    },
    lockedTriple: {
      honmei: triple.honmei,
      oshi: null,
      ana: null,
    },
    stadiumInnige: stadium,
    hotRacers: hot,
    backtestSummary: {
      train_years: (backtest as { train_years: string }).train_years,
      test_years: (backtest as { test_years: string }).test_years,
      train_n: (backtest as { train_n: number }).train_n,
      test_n: (backtest as { test_n: number }).test_n,
      strategies_ge_150_test: (backtest as { strategies_ge_150_test: number })
        .strategies_ge_150_test,
      top5: (backtest as { top30: unknown[] }).top30.slice(0, 5),
    },
    exhibition: {
      status: "numeric_ready",
      note: "スタート展示（進入・スリット・周回）を必ず確認。進入変更や予期しない事態はスキップ。",
    },
    oddsAnomaly: {
      overbet_threshold: 6,
      money_concentrate_threshold: 0.55,
      note: "買われすぎ・大口集中を検知し、本命を見送りにする。",
    },
    equity10k: {
      ...(equity as Record<string, unknown>),
      bands: {
        honmei: (equity as { bands?: { honmei?: unknown } }).bands?.honmei,
      },
      portfolio: null,
      note: "本命FIX場のみ。押し目・穴の回収は出さない。",
    },
  });
}

import { NextResponse } from "next/server";
import hot from "@/data/hot_racers.json";
import stadium from "@/data/stadium_innige_rates.json";
import locked from "@/data/locked_honmei_rule.json";
import lockedTriple from "@/data/locked_triple_rules.json";
import backtest from "@/data/honmei_backtest.json";
import { TICKET_LABEL } from "@/lib/honmeiRule";
import { BAND_TICKET_LABEL } from "@/lib/tripleSystem";

export const dynamic = "force-dynamic";

export async function GET() {
  const triple = lockedTriple as {
    honmei?: Record<string, unknown>;
    oshi?: Record<string, unknown> | null;
    ana?: Record<string, unknown> | null;
  };

  return NextResponse.json({
    sources: {
      kyoteibiyori: "出走・当日詳細（アプリ実行時）",
      teikoku_successor: "艇愛ボートレースDB (boatrace-db.jp) ※艇国DB後継",
      openapi: "boatraceopenapi results/programs/odds 2021-2026",
    },
    update: {
      cadence: "1日おき・夜間",
      script: "scripts/nightly_update.py",
    },
    lockedHonmei: {
      ...locked,
      ticketLabel: TICKET_LABEL[(locked as { ticket: string }).ticket] ?? locked,
    },
    lockedTriple: {
      honmei: triple.honmei,
      oshi: triple.oshi
        ? {
            ...triple.oshi,
            ticketLabel:
              BAND_TICKET_LABEL[String((triple.oshi as { ticket?: string }).ticket ?? "")] ??
              "押し目",
          }
        : null,
      ana: triple.ana
        ? {
            ...triple.ana,
            ticketLabel:
              BAND_TICKET_LABEL[String((triple.ana as { ticket?: string }).ticket ?? "")] ??
              "穴目",
          }
        : null,
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
      note: "展示タイム/STは数値解析済み。YouTube・公式ライブ映像の進入解析は配信URL連携後に拡張。",
    },
    oddsAnomaly: {
      overbet_threshold: 6,
      money_concentrate_threshold: 0.55,
      note: "買われすぎ・大口集中を検知し、本命/押し目を回避してイン戦買い目を出す。",
    },
  });
}

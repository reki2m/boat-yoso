import locked from "@/data/locked_honmei_rule.json";
import stadiumRates from "@/data/stadium_innige_rates.json";
import { existsSync, readFileSync } from "fs";
import path from "path";

export type HonmeiRule = {
  ticket: string;
  tickets?: string[];
  points?: number;
  stake_per_ticket?: number;
  min_stadium_innige: number;
  max_c1_class: number;
  min_c1_nat: number;
  max_c1_st: number;
  min_motor2: number;
  min_gap_c2: number;
  require_leading_score?: boolean;
  min_score_gap?: number;
  min_pick_score?: number;
  grades: number[];
  stadium_whitelist: number[] | null;
  stadium_blacklist?: number[];
  race_blacklist?: number[];
  validated_test_roi: number;
  validated_train_roi?: number;
  validated_test_hit_rate?: number;
  validated_test_selected?: number;
  selection_mode?: string;
  odds?: {
    min_favorite_odds?: number;
    ticket_odds_lo?: number;
    ticket_odds_hi?: number;
    block_overbet?: boolean;
  };
};

function loadLiveHonmeiRule(): HonmeiRule {
  const candidates = [
    path.join(process.cwd(), "src", "data", "locked_honmei_rule.json"),
    path.join(process.cwd(), "data", "reports", "locked_honmei_rule.json"),
  ];
  for (const file of candidates) {
    try {
      if (!existsSync(file)) continue;
      return JSON.parse(readFileSync(file, "utf8")) as HonmeiRule;
    } catch {
      // continue
    }
  }
  return locked as HonmeiRule;
}

/** 日次学習後のランタイム規則を都度読む（プロセス長寿でも学習結果を反映） */
export function getHonmeiRule(): HonmeiRule {
  return loadLiveHonmeiRule();
}

export const HONMEI_RULE: HonmeiRule = new Proxy({} as HonmeiRule, {
  get(_target, prop, _receiver) {
    const live = loadLiveHonmeiRule() as Record<string | symbol, unknown>;
    const value = live[prop];
    return typeof value === "function" ? value.bind(live) : value;
  },
});

export const STADIUM_INNIGE = stadiumRates as Record<
  string,
  { rate: number; stadium: number }
>;

export const TICKET_LABEL: Record<string, string> = {
  tri_1axis_6: "3連単 1軸6点",
  trifecta_1_2_stream: "3連単 1-2-流し(3〜6)",
  tri_12_narrow: "3連単 1-2-3 / 1-2-4",
  trifecta_123: "3連単 1-2-3",
  trifecta_1axis_23: "3連単 1軸 2/3相手",
  exacta_12: "2連単 1-2",
  exa_12: "2連単 1-2",
};

const DEFAULT_SIX = ["1-2-3", "1-2-4", "1-2-5", "1-2-6", "1-3-2", "1-3-4"];

function innigeRate(placeNo: number): number {
  const hit = Object.values(STADIUM_INNIGE).find((v) => v.stadium === placeNo);
  return hit?.rate ?? 0;
}

export function buildHonmeiTickets(rule: HonmeiRule = HONMEI_RULE): string[] {
  if (Array.isArray(rule.tickets) && rule.tickets.length > 0) return [...rule.tickets];
  if (rule.ticket === "tri_1axis_6") return [...DEFAULT_SIX];
  if (rule.ticket === "trifecta_1_2_stream") {
    return ["1-2-3", "1-2-4", "1-2-5", "1-2-6"];
  }
  if (rule.ticket === "tri_12_narrow") return ["1-2-3", "1-2-4"];
  if (rule.ticket === "trifecta_123") return ["1-2-3"];
  if (rule.ticket === "exacta_12" || rule.ticket === "exa_12") return ["1-2"];
  return [...DEFAULT_SIX];
}

export function evaluateHonmeiEligibility(input: {
  placeNo: number;
  className: string;
  nationalWin: number;
  avgStart: number;
  motorTop2: number;
  secondNationalWin: number;
  raceNo?: number;
}): { ok: boolean; reasons: string[]; tickets: string[] } {
  const reasons: string[] = [];
  const classMap: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4 };
  const c1class = classMap[input.className] ?? 4;
  const wl = HONMEI_RULE.stadium_whitelist;
  const bl = HONMEI_RULE.stadium_blacklist || [];
  const rbl = HONMEI_RULE.race_blacklist || [];
  const rate = innigeRate(input.placeNo);
  if (bl.includes(input.placeNo)) reasons.push("除外場（回収悪化場）");
  if (input.raceNo != null && rbl.includes(input.raceNo)) {
    reasons.push(`除外レース（${input.raceNo}R）`);
  }
  if (Array.isArray(wl) && wl.length > 0) {
    if (!wl.includes(input.placeNo)) reasons.push("本命対象場外");
  } else if (rate < HONMEI_RULE.min_stadium_innige) {
    reasons.push(`イン逃げ率不足 (${(rate * 100).toFixed(1)}%)`);
  }
  if (c1class > HONMEI_RULE.max_c1_class) reasons.push("1号艇の級別が条件外");
  if (input.nationalWin < HONMEI_RULE.min_c1_nat) {
    reasons.push(`全国勝率不足 (${input.nationalWin} < ${HONMEI_RULE.min_c1_nat})`);
  }
  if (input.avgStart > HONMEI_RULE.max_c1_st) {
    reasons.push(`平均STが遅い (${input.avgStart} > ${HONMEI_RULE.max_c1_st})`);
  }
  if (input.motorTop2 < HONMEI_RULE.min_motor2) {
    reasons.push(`モーター2連対率不足 (${input.motorTop2} < ${HONMEI_RULE.min_motor2})`);
  }
  if (input.nationalWin - input.secondNationalWin < HONMEI_RULE.min_gap_c2) {
    reasons.push("2号艇との勝率差が不足");
  }
  const ok = reasons.length === 0;
  return {
    ok,
    reasons: ok
      ? [
          `イン逃げ率 ${(rate * 100).toFixed(1)}%`,
          `1号 ${input.className} / 勝率 ${input.nationalWin.toFixed(2)} / ST ${input.avgStart.toFixed(2)}`,
          `本命FIX場条件を充足`,
        ]
      : reasons,
    tickets: ok ? buildHonmeiTickets() : [],
  };
}

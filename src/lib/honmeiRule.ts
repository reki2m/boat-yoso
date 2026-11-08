import locked from "@/data/locked_honmei_rule.json";
import stadiumRates from "@/data/stadium_innige_rates.json";

export type HonmeiRule = {
  ticket: string;
  min_stadium_innige: number;
  max_c1_class: number;
  min_c1_nat: number;
  max_c1_st: number;
  min_motor2: number;
  min_gap_c2: number;
  grades: number[];
  stadium_whitelist: number[];
  validated_test_roi: number;
  validated_test_selected: number;
};

export const HONMEI_RULE = locked as HonmeiRule;
export const STADIUM_INNIGE = stadiumRates as Record<
  string,
  { rate: number; stadium: number }
>;

export const TICKET_LABEL: Record<string, string> = {
  trifecta_1_2_stream: "3連単 1-2-流し(3〜6)",
  trifecta_123: "3連単 1-2-3",
  trifecta_1axis_23: "3連単 1軸 2/3相手",
  exacta_12: "2連単 1-2",
};

export function buildHonmeiTickets(rule: HonmeiRule = HONMEI_RULE): string[] {
  if (rule.ticket === "trifecta_1_2_stream") {
    return ["1-2-3", "1-2-4", "1-2-5", "1-2-6"];
  }
  if (rule.ticket === "trifecta_123") return ["1-2-3"];
  if (rule.ticket === "exacta_12") return ["1-2"];
  return ["1-2-3"];
}

export function evaluateHonmeiEligibility(input: {
  placeNo: number;
  className: string;
  nationalWin: number;
  avgStart: number;
  motorTop2: number;
  secondNationalWin: number;
}): { ok: boolean; reasons: string[]; tickets: string[] } {
  const reasons: string[] = [];
  const classMap: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4 };
  const c1class = classMap[input.className] ?? 4;
  const inWhite = HONMEI_RULE.stadium_whitelist.includes(input.placeNo);
  if (!inWhite) reasons.push("場のイン逃げ率が閾値未満（現行ロックは徳山・大村）");
  if (c1class > HONMEI_RULE.max_c1_class) reasons.push("1号艇がA1以外");
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
    reasons: ok ? ["ロック済み本命条件を充足"] : reasons,
    tickets: ok ? buildHonmeiTickets() : [],
  };
}

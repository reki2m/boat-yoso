import locked from "@/data/locked_mainline_rule.json";

export type MainlineRule = {
  ticket: string;
  tickets: string[];
  points: number;
  stake_per_ticket: number;
  max_c1_class: number;
  min_c1_nat: number;
  max_c1_st: number;
  min_motor2: number;
  require_axis_1: boolean;
  min_score_gap: number;
  min_confidence: number;
  grades: number[];
  stadium_whitelist: number[] | null;
  race_blacklist: number[];
  validated_all_roi?: number;
  validated_all_min_year_roi?: number;
  validated_note?: string;
  target_roi?: number;
};

export const MAINLINE_RULE = locked as MainlineRule;

const CLASS_MAP: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4 };
const CLASS_SCORE: Record<number, number> = { 1: 1.0, 2: 0.72, 3: 0.42, 4: 0.2 };

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** 回収検証と同一の簡易ゲートスコア（番組表フィールドのみ） */
export function mainlineGateScore(input: {
  course: number;
  className: string;
  nationalWin: number;
  localWin: number;
  motorTop2: number;
  boatTop2: number;
  avgStart: number;
}): number {
  const classN = CLASS_MAP[input.className] ?? 4;
  const classScore = CLASS_SCORE[classN] ?? 0.3;
  const courseBias =
    input.course === 1 ? 0.18 : input.course === 2 ? 0.08 : input.course === 3 ? 0.05 : 0;
  const score =
    classScore * 20 +
    clamp(input.nationalWin / 8, 0, 1) * 20 +
    clamp(input.localWin / 8, 0, 1) * 10 +
    clamp(input.motorTop2 / 60, 0, 1) * 14 +
    clamp(input.boatTop2 / 60, 0, 1) * 8 +
    clamp(1 - (input.avgStart - 0.1) / 0.2, 0, 1) * 10 +
    courseBias * 16 +
    9;
  return Math.round(score * 10) / 10;
}

export function mainlineConfidenceFromGap(gap: number, topScore: number): number {
  let score = 1;
  if (topScore >= 70) score += 1;
  if (topScore >= 85) score += 1;
  if (gap >= 4) score += 1;
  if (gap >= 8) score += 1;
  if (gap >= 14) score = Math.min(5, score + 1);
  return Math.max(1, Math.min(5, score));
}

export function parseGradeNumber(raceRank?: string | null, gradeNumber?: number | null): number {
  if (typeof gradeNumber === "number" && Number.isFinite(gradeNumber)) {
    return Math.trunc(gradeNumber);
  }
  if (raceRank) {
    const m = String(raceRank).match(/(\d+)/);
    if (m) return Number(m[1]);
  }
  return 5;
}

export function evaluateMainlineEligibility(input: {
  placeNo?: number | null;
  raceNo?: number | null;
  gradeNumber?: number | null;
  raceRank?: string | null;
  racers: Array<{
    course: number;
    className: string;
    nationalWin: number;
    localWin: number;
    motorTop2: number;
    boatTop2: number;
    avgStart: number;
  }>;
}): {
  ok: boolean;
  reasons: string[];
  tickets: string[];
  axis: number;
  gap: number;
  topScore: number;
  gateConfidence: number;
} {
  const rule = MAINLINE_RULE;
  const reasons: string[] = [];
  const scored = input.racers.map((r) => ({
    ...r,
    score: mainlineGateScore(r),
  }));
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const second = ranked[1];
  const axis = top?.course ?? 1;
  const gap = (top?.score ?? 0) - (second?.score ?? 0);
  const topScore = top?.score ?? 0;
  const gateConfidence = mainlineConfidenceFromGap(gap, topScore);
  const c1 = scored.find((r) => r.course === 1);
  const grade = parseGradeNumber(input.raceRank, input.gradeNumber);

  if (rule.require_axis_1 && axis !== 1) reasons.push("軸が1号でない");
  const wl = rule.stadium_whitelist;
  if (Array.isArray(wl) && wl.length > 0) {
    if (input.placeNo == null || !wl.includes(input.placeNo)) {
      reasons.push("本線対象場外");
    }
  }
  const rbl = rule.race_blacklist || [];
  if (input.raceNo != null && rbl.includes(input.raceNo)) {
    reasons.push(`除外レース（${input.raceNo}R）`);
  }
  if (!rule.grades.includes(grade)) reasons.push(`グレード条件外（G${grade}）`);
  if (!c1) {
    reasons.push("1号艇データ不足");
  } else {
    const c1class = CLASS_MAP[c1.className] ?? 4;
    if (c1class > rule.max_c1_class) reasons.push("1号の級別が条件外");
    if (c1.nationalWin < rule.min_c1_nat) {
      reasons.push(`1号全国勝率不足（${c1.nationalWin.toFixed(2)} < ${rule.min_c1_nat}）`);
    }
    if (c1.avgStart > rule.max_c1_st) {
      reasons.push(`1号平均STが遅い（${c1.avgStart.toFixed(2)} > ${rule.max_c1_st}）`);
    }
    if (c1.motorTop2 < rule.min_motor2) {
      reasons.push(`1号モーター不足（${c1.motorTop2.toFixed(0)} < ${rule.min_motor2}）`);
    }
  }
  if (gap < rule.min_score_gap) {
    reasons.push(`スコア差不足（${gap.toFixed(1)} < ${rule.min_score_gap}）`);
  }
  if (gateConfidence < rule.min_confidence) {
    reasons.push(`ゲート信頼度不足（${gateConfidence} < ${rule.min_confidence}）`);
  }

  const ok = reasons.length === 0;
  return {
    ok,
    reasons: ok
      ? [
          `対象場・除外R通過`,
          `1号 ${c1?.className ?? "—"} / 勝率 ${c1?.nationalWin.toFixed(2) ?? "—"} / ST ${c1?.avgStart.toFixed(2) ?? "—"}`,
          `ゲート差 ${gap.toFixed(1)} / 信頼度 ${gateConfidence}/5`,
          `検証回収率 約${rule.validated_all_roi ?? "—"}%（年次下限 約${rule.validated_all_min_year_roi ?? "—"}%）`,
        ]
      : reasons,
    tickets: ok ? [...rule.tickets] : [],
    axis,
    gap,
    topScore,
    gateConfidence,
  };
}

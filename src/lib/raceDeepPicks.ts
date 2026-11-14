import type { ScoredRacer } from "./predict";
import type { RacerRow } from "./types";
import type { ExhibitionStatus } from "./exhibition";
import type { SeriesFinish, SeriesForm } from "./seriesForm";
import { courseWinRate } from "./courseSkills";
import {
  evaluateMainlineEligibility,
  MAINLINE_RULE,
  parseGradeNumber,
} from "./mainlineRule";
import aiLogic2026 from "../data/locked_ai_logic_2026.json";

const CLASS_NUM: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4 };

/** 2026再検証ロック: strong_123 を本線、他は薄い参考 */
export const AI_LOGIC_2026 = {
  scheme: String(aiLogic2026.scheme ?? "strong_123_primary"),
  testRoi: Number(aiLogic2026.validated?.test_roi ?? 0),
  currentRoi: Number(aiLogic2026.validated?.current_flat532_2026_roi ?? 0),
  primaryTickets: (aiLogic2026.primary?.tickets ?? ["1-2-3"]) as string[],
  gate: {
    maxC1Class: Number(aiLogic2026.primary?.gate?.max_c1_class ?? 1),
    minC1Nat: Number(aiLogic2026.primary?.gate?.min_c1_nat ?? 6.8),
    maxC1St: Number(aiLogic2026.primary?.gate?.max_c1_st ?? 0.15),
    minMotor2: Number(aiLogic2026.primary?.gate?.min_motor2 ?? 32),
    minGapC2: Number(aiLogic2026.primary?.gate?.min_gap_c2 ?? 0.8),
    grades: (aiLogic2026.primary?.gate?.grades ?? [4, 5]) as number[],
  },
  fallbackAxis1: (aiLogic2026.fallback_axis1_conf45?.tickets ?? [
    "1-2-3",
    "1-2-4",
    "1-2-5",
    "1-2-6",
  ]) as string[],
  fallbackMinConf: Number(aiLogic2026.fallback_axis1_conf45?.min_confidence ?? 4),
} as const;

/** @deprecated 互換。新ロジックでは点数は可変 */
export const TEN_POINT_ALLOC = {
  honmei: 1,
  oshi: 0,
  ana: 0,
  total: 1,
  scheme: AI_LOGIC_2026.scheme,
} as const;

export type DeepRacerView = {
  course: number;
  name: string;
  className: string;
  score: number;
  nationalWin: number;
  recentWin: number;
  localWin: number;
  motorTop2: number;
  boatTop2: number;
  avgStart: number;
  abilityIndex: number | null;
  seriesPoints: number | null;
  seriesLabel: string;
  motorIndex: number | null;
  exhibitionLap: number | null;
  exhibitionSlit: number | null;
  reasons: string[];
};

export type DeepTicket = {
  combo: string;
  rank: number;
  role:
    | "本線"
    | "抑え"
    | "相手拡張"
    | "本命S"
    | "本命S単点"
    | "本命S5点"
    | "押し本線"
    | "押し抑え"
    | "穴本線"
    | "穴抑え";
  why: string;
};

/** 信頼度は 1（弱い）〜 5（強い）。穴見送りは 0。 */
export type ConfidenceScore = 0 | 1 | 2 | 3 | 4 | 5;

export type RaceDeepPicks = {
  /** 通常本命（2026検証: 強条件は1-2-3単点、他は薄い参考） */
  tickets: DeepTicket[];
  count: number;
  axis: number;
  partners: number[];
  /** 本線信頼度 1-5 */
  confidence: ConfidenceScore;
  confidenceLabel: string;
  commentary: string[];
  /** 本命S・5点（回収100%超の検証ゲート通過時のみ。別枠） */
  sTickets: DeepTicket[];
  sCount: number;
  /** 本命S・単点（5点ゲート通過時は併記） */
  sSingleTickets: DeepTicket[];
  sSingleCount: number;
  sReady: boolean;
  sLabel: string;
  /** 押し目（本線採用時は出さない） */
  oshiTickets: DeepTicket[];
  oshiCount: number;
  oshiAxis: number | null;
  oshiCommentary: string[];
  /** 穴目（本線採用時は出さない） */
  anaTickets: DeepTicket[];
  anaCount: number;
  anaAxis: number | null;
  /**
   * 穴目の参考的中率（%）。
   * 穴は本線の1-5表現と混ぜない。見送りは 0。
   */
  anaHitPct: number;
  anaConfidenceLabel: string;
  /** @deprecated 互換用。anaHitPct と同じ */
  anaConfidence: number;
  anaCommentary: string[];
  racerViews: DeepRacerView[];
  method: string;
};

function confidenceLabelOf(score: ConfidenceScore): string {
  const map: Record<1 | 2 | 3 | 4 | 5, string> = {
    1: "1/5 弱い",
    2: "2/5 やや弱い",
    3: "3/5 中程度",
    4: "4/5 やや強い",
    5: "5/5 強い",
  };
  return map[(score < 1 ? 1 : score > 5 ? 5 : score) as 1 | 2 | 3 | 4 | 5];
}

export function isStrongInnigeGate(input: {
  c1?: DeepRacerView | ScoredRacer | RacerRow | null;
  c2?: DeepRacerView | ScoredRacer | RacerRow | null;
  grade: number;
}): boolean {
  const c1 = input.c1;
  const c2 = input.c2;
  if (!c1) return false;
  const classN =
    "className" in c1
      ? (CLASS_NUM[String(c1.className)] ?? 4)
      : 4;
  const nat = Number(("nationalWin" in c1 ? c1.nationalWin : 0) || 0);
  const st = Number(("avgStart" in c1 ? c1.avgStart : 0.2) || 0.2);
  const motor = Number(("motorTop2" in c1 ? c1.motorTop2 : 0) || 0);
  const c2nat = Number((c2 && "nationalWin" in c2 ? c2.nationalWin : 0) || 0);
  const g = AI_LOGIC_2026.gate;
  if (!g.grades.includes(input.grade)) return false;
  if (classN > g.maxC1Class) return false;
  if (nat < g.minC1Nat) return false;
  if (st > g.maxC1St) return false;
  if (motor < g.minMotor2) return false;
  if (nat - c2nat < g.minGapC2) return false;
  return true;
}

/** 2026検証ロジックに基づく配分（押し・穴は本線では出さない） */
export function allocForConfidence(
  confidence: ConfidenceScore,
  opts?: { strong?: boolean; axis?: number },
): {
  honmei: number;
  oshi: number;
  ana: number;
  mode: "strong_123" | "axis1_conf45_stream" | "top1_only";
} {
  if (opts?.strong) {
    return { honmei: 1, oshi: 0, ana: 0, mode: "strong_123" };
  }
  if (confidence >= AI_LOGIC_2026.fallbackMinConf && opts?.axis === 1) {
    return {
      honmei: AI_LOGIC_2026.fallbackAxis1.length,
      oshi: 0,
      ana: 0,
      mode: "axis1_conf45_stream",
    };
  }
  return { honmei: 1, oshi: 0, ana: 0, mode: "top1_only" };
}

export function mainConfidenceFromGap(gap: number, topScore: number): ConfidenceScore {
  // 軸の絶対評価 + 2位との差で 1-5
  let score = 1;
  if (topScore >= 70) score += 1;
  if (topScore >= 85) score += 1;
  if (gap >= 4) score += 1;
  if (gap >= 8) score += 1;
  if (gap >= 14) score = Math.min(5, score + 1);
  return Math.max(1, Math.min(5, score)) as ConfidenceScore;
}

/** 出走スコア順位から本線信頼度 1-5 を算出 */
export function confidenceFromRankings(scored: ScoredRacer[]): ConfidenceScore {
  if (!scored.length) return 1;
  const top = scored[0]?.score ?? 0;
  const second = scored[1]?.score ?? top;
  return mainConfidenceFromGap(top - second, top);
}

/**
 * 穴目は運用対象外の参考表示。
 * 本命が強いレースほど穴は薄く見せる（旧UIの「厚め〜16%」固定感を避ける）。
 */
/** 通常本命: 検証ロック点数。スコア1位軸の流し。 */
function buildHonmeiTickets(
  ranked: DeepRacerView[],
  byCourse: Map<number, DeepRacerView>,
  want: number,
): { tickets: DeepTicket[]; axis: number; partners: number[] } {
  const axisView = ranked[0];
  const axis = axisView?.course ?? 1;
  const partners = ranked
    .filter((r) => r.course !== axis)
    .slice(0, 5)
    .map((r) => r.course);
  for (const n of [1, 2, 3, 4, 5, 6]) {
    if (partners.length >= 5) break;
    if (n !== axis && !partners.includes(n)) partners.push(n);
  }
  const raw: string[] = [];
  // 1号軸なら定番の1-2流し＋1-3系
  if (axis === 1) {
    const for13 = partners.filter((p) => p !== 2 && p !== 3);
    const for14 = partners.filter((p) => p !== 2 && p !== 4);
    raw.push(
      "1-2-3",
      "1-2-4",
      "1-2-5",
      "1-2-6",
      `1-3-${for13[0] || 4}`,
      `1-3-${for13[1] || 5}`,
      `1-4-${for14[0] || 2}`,
      `1-4-${for14[1] || 3}`,
    );
  } else {
    for (let i = 0; i < Math.min(4, partners.length); i++) {
      for (let j = 0; j < Math.min(4, partners.length); j++) {
        if (i === j) continue;
        raw.push(`${axis}-${partners[i]}-${partners[j]}`);
      }
    }
  }
  let list = uniqueTickets(raw).slice(0, want);
  if (list.length < want) {
    const fb = partners.slice(0, 3);
    list = uniqueTickets([
      ...list,
      `${axis}-${fb[0]}-${fb[1]}`,
      `${axis}-${fb[0]}-${fb[2]}`,
      `${axis}-${fb[1]}-${fb[0]}`,
      `${axis}-${fb[1]}-${fb[2]}`,
    ]).slice(0, want);
  }
  const tickets: DeepTicket[] = list.slice(0, want).map((combo, i) => ({
    combo,
    rank: i + 1,
    role: i === 0 ? "本線" : i < 3 ? "抑え" : "相手拡張",
    why: ticketWhy(combo, byCourse),
  }));
  return { tickets, axis, partners: partners.slice(0, 4) };
}

function buildOshiTickets(
  ranked: DeepRacerView[],
  byCourse: Map<number, DeepRacerView>,
  exclude: Set<string>,
  want: number,
): { tickets: DeepTicket[]; axis: number | null; commentary: string[] } {
  const commentary: string[] = [];
  if (ranked.length < 3) {
    return { tickets: [], axis: null, commentary: ["【押し目】選手データ不足"] };
  }
  const c1 = byCourse.get(1);
  const c2 = byCourse.get(2);
  const c3 = byCourse.get(3);
  // 押しは2・3号軸を優先（本命と被らせない）
  const axisView =
    (c2 && c3 ? (c2.score >= c3.score ? c2 : c3) : c2 || c3) ||
    ranked.find((r) => r.course === 2 || r.course === 3) ||
    ranked[1];
  if (!axisView) {
    return { tickets: [], axis: null, commentary: ["【押し目】軸候補なし"] };
  }
  const axis = axisView.course;
  const partners = ranked
    .filter((r) => r.course !== axis)
    .slice(0, 4)
    .map((r) => r.course);
  for (const n of [1, 2, 3, 4, 5, 6]) {
    if (partners.length >= 4) break;
    if (n !== axis && !partners.includes(n)) partners.push(n);
  }
  const raw: string[] = [];
  for (let i = 0; i < Math.min(3, partners.length); i++) {
    for (let j = 0; j < Math.min(3, partners.length); j++) {
      if (i === j) continue;
      raw.push(`${axis}-${partners[i]}-${partners[j]}`);
    }
  }
  if (axis !== 1 && partners.includes(1)) {
    const rest = partners.filter((p) => p !== 1).slice(0, 3);
    for (const c of rest) raw.push(`${axis}-1-${c}`);
  }
  if (c2 && c1) raw.push("2-1-3", "2-1-4", "2-1-5");
  if (c3 && c1) raw.push("3-1-2", "3-1-4", "3-1-5");

  let list = uniqueTickets(raw).filter((t) => !exclude.has(t));
  if (list.length < want) {
    const fb = partners.slice(0, 3);
    list = uniqueTickets([
      ...list,
      `${axis}-${fb[0]}-${fb[1]}`,
      `${axis}-${fb[0]}-${fb[2]}`,
      `${axis}-${fb[1]}-${fb[0]}`,
      `${axis}-${fb[1]}-${fb[2]}`,
    ]).filter((t) => !exclude.has(t));
  }
  list = list.slice(0, want);
  const tickets: DeepTicket[] = list.map((combo, i) => ({
    combo,
    rank: i + 1,
    role: i === 0 ? "押し本線" : "押し抑え",
    why: ticketWhy(combo, byCourse),
  }));
  commentary.push(
    `【押し軸】${axisView.course}号 ${axisView.name}（${axisView.className}）。全国${axisView.nationalWin.toFixed(2)} / ST${axisView.avgStart.toFixed(2)} / モーター${axisView.motorTop2.toFixed(0)}% / 評価${axisView.score.toFixed(1)}。`,
  );
  commentary.push(
    `【押し買い目】${want}点枠（今回${tickets.length}点）。差し・まくり傾向から再計算。`,
  );
  return { tickets, axis, commentary };
}

function anaHitPctFromUpside(upside: number, c1Strong: boolean, ticketCount: number): number {
  // upside 38〜60 を 概ね 3%〜9% に写像（穴の実体に寄せる）
  let pct = 3.2 + (upside - 38) * 0.28;
  if (ticketCount >= 6) pct += 0.6;
  else if (ticketCount <= 4) pct -= 0.3;
  if (c1Strong) pct *= 0.55; // 本命レースではさらに薄く
  const hi = c1Strong ? 8 : 11;
  return Math.round(clamp(pct, 2.5, hi) * 10) / 10;
}

function anaPctLabel(pct: number): string {
  if (pct <= 0) return "見送り";
  if (pct < 5) return `参考的中率 ${pct}%（かなり薄い・参考のみ）`;
  if (pct < 8) return `参考的中率 ${pct}%（薄い・参考のみ）`;
  return `参考的中率 ${pct}%（穴としては普通〜やや薄め・参考のみ）`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function uniqueTickets(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of list) {
    const parts = t.split("-").map(Number);
    if (parts.length !== 3) continue;
    if (parts.some((n) => !Number.isFinite(n) || n < 1 || n > 6)) continue;
    // 同じ艇番の重複は三連単として無効
    if (new Set(parts).size !== 3) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function ticketWhy(combo: string, byCourse: Map<number, DeepRacerView>): string {
  const [a, b, c] = combo.split("-").map(Number);
  const A = byCourse.get(a);
  const B = byCourse.get(b);
  const C = byCourse.get(c);
  const bits: string[] = [];
  if (A) bits.push(`${a}号軸（${A.className}・勝率${A.nationalWin.toFixed(2)}）`);
  if (B) bits.push(`${b}号相手（モーター${B.motorTop2.toFixed(0)}%）`);
  if (C) bits.push(`${c}号三着`);
  return bits.join(" / ");
}

export function buildRaceDeepPicks(input: {
  racers: RacerRow[];
  scored?: ScoredRacer[];
  exhibition?: ExhibitionStatus | null;
  seriesForms?: Map<number, SeriesForm>;
  placeName?: string;
  placeNo?: number;
  raceNo?: number;
  gradeNumber?: number | null;
  raceRank?: string | null;
  raceName?: string | null;
}): RaceDeepPicks {
  const seriesForms = input.seriesForms ?? new Map();
  const scoredByCourse = new Map(
    (input.scored ?? []).map((r) => [r.course, r] as const),
  );
  const mainlineGate = evaluateMainlineEligibility({
    placeNo: input.placeNo,
    raceNo: input.raceNo,
    gradeNumber: input.gradeNumber,
    raceRank: input.raceRank,
    raceName: input.raceName,
    racers: input.racers,
  });

  const views: DeepRacerView[] = input.racers.map((r) => {
    const series = seriesForms.get(r.playerNo);
    const recentWin = num(r.recentWin, r.nationalWin);
    const ability = r.abilityIndex != null ? num(r.abilityIndex) : null;
    const seriesPts =
      r.seriesPoints != null
        ? num(r.seriesPoints)
        : series
          ? series.points / Math.max(series.starts, 1)
          : null;
    const motorIndex = r.motorIndex != null ? num(r.motorIndex) : null;
    const skillWin = courseWinRate(r.playerNo, r.course);
    const reasons: string[] = [];

    // 選手能力（級別・全国・当地・直近）
    const classScore =
      r.className === "A1" ? 1 : r.className === "A2" ? 0.72 : r.className === "B1" ? 0.42 : 0.22;
    const national = clamp(r.nationalWin / 8, 0, 1);
    const local = clamp(r.localWin / 8, 0, 1);
    const recent = clamp(recentWin / 8, 0, 1);

    // 過去コース適性
    const skill = clamp(skillWin / 0.35, 0, 1);

    // エンジン / ボート
    const motor = clamp(r.motorTop2 / 60, 0, 1);
    const boat = clamp(r.boatTop2 / 60, 0, 1);
    const motorIdx = motorIndex != null ? clamp((motorIndex + 0.5) / 1.2, 0, 1) : 0.5;

    // 今節
    const seriesScore =
      seriesPts != null
        ? clamp(seriesPts / 10, 0, 1)
        : series
          ? clamp(1.15 - (series.avgPlace ?? 4) / 6, 0, 1)
          : 0.45;
    const seriesFinishes: SeriesFinish[] = series?.finishes ?? [];
    const seriesStTimes = seriesFinishes
      .map((f: SeriesFinish) => f.startTiming)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const seriesStAvgFromResults =
      seriesStTimes.length > 0
        ? seriesStTimes.reduce((a: number, b: number) => a + b, 0) / seriesStTimes.length
        : null;
    const seriesSt =
      r.seriesStartAvg != null
        ? clamp(1 - (num(r.seriesStartAvg) - 0.1) / 0.2, 0, 1)
        : seriesStAvgFromResults != null
          ? clamp(1 - (seriesStAvgFromResults - 0.1) / 0.2, 0, 1)
          : 0.5;
    const seriesDisplay =
      r.seriesDisplayAvg != null
        ? clamp(1 - (num(r.seriesDisplayAvg) - 6.55) / 0.35, 0, 1)
        : 0.5;

    // スタートは番組STのみ（展示スリットでスコアを動かさない＝展示前後の買い目固定）
    const st = clamp(1 - (r.avgStart - 0.1) / 0.2, 0, 1);
    const exLap = r.exhibitionLap;
    const exSlit = r.exhibitionSlit;
    // 展示はコメント・シグナル用。本線スコアには中立値を入れ、券種が変わらないようにする
    const lapScore = 0.5;
    const slitScore = 0.5;
    const abilityScore =
      ability != null ? clamp(ability / 6500, 0, 1) : national;

    const courseBias =
      r.course === 1 ? 0.16 : r.course === 2 ? 0.08 : r.course === 3 ? 0.05 : 0.02;

    if (r.className === "A1") reasons.push("級別A1");
    if (r.nationalWin >= 6.2) reasons.push(`全国勝率 ${r.nationalWin.toFixed(2)}`);
    if (recentWin >= 6.2 && Math.abs(recentWin - r.nationalWin) >= 0.15) {
      reasons.push(`直近勝率 ${recentWin.toFixed(2)}`);
    }
    if (r.localWin >= 6) reasons.push(`当地勝率 ${r.localWin.toFixed(2)}`);
    if (r.motorTop2 >= 38) reasons.push(`モーター2連対 ${r.motorTop2.toFixed(1)}%`);
    if (motorIndex != null && motorIndex >= 0.25) reasons.push(`モーター指数 +${motorIndex.toFixed(2)}`);
    if (r.boatTop2 >= 40) reasons.push(`ボート2連対 ${r.boatTop2.toFixed(1)}%`);
    if (r.avgStart <= 0.15) reasons.push(`平均ST ${r.avgStart.toFixed(2)}`);
    if (series?.starts) reasons.push(series.label);
    else if (seriesPts != null) reasons.push(`今節得点率 ${seriesPts.toFixed(2)}`);
    if (ability != null && ability >= 5200) reasons.push(`能力指数 ${ability}`);
    if (skillWin >= 0.22) reasons.push(`${r.course}コース勝率 ${(skillWin * 100).toFixed(1)}%`);
    if (exLap != null && exLap <= 6.7) reasons.push(`展示 ${exLap.toFixed(2)}`);
    if (exSlit != null && exSlit <= 0.14) reasons.push(`スリット ${exSlit.toFixed(2)}`);

    const base = scoredByCourse.get(r.course)?.score ?? 0;
    const score =
      classScore * 10 +
      national * 12 +
      local * 6 +
      recent * 10 +
      skill * 10 +
      motor * 12 +
      boat * 6 +
      motorIdx * 6 +
      seriesScore * 12 +
      seriesSt * 5 +
      seriesDisplay * 4 +
      st * 6 +
      lapScore * 5 +
      slitScore * 4 +
      abilityScore * 8 +
      courseBias * 14 +
      base * 0.15;

    return {
      course: r.course,
      name: r.name,
      className: r.className,
      score: Math.round(score * 10) / 10,
      nationalWin: r.nationalWin,
      recentWin,
      localWin: r.localWin,
      motorTop2: r.motorTop2,
      boatTop2: r.boatTop2,
      avgStart: r.avgStart,
      abilityIndex: ability,
      seriesPoints: seriesPts,
      seriesLabel: series?.label ?? (seriesPts != null ? `今節得点率 ${seriesPts.toFixed(2)}` : "今節データ薄"),
      motorIndex,
      exhibitionLap: exLap ?? null,
      exhibitionSlit: exSlit ?? null,
      reasons,
    };
  });

  const ranked = [...views].sort((a, b) => b.score - a.score);
  const byCourse = new Map(views.map((v) => [v.course, v]));
  const gap = (ranked[0]?.score ?? 0) - (ranked[1]?.score ?? 0);
  const confidence = mainConfidenceFromGap(gap, ranked[0]?.score ?? 0);
  const axis = ranked[0]?.course ?? 1;
  const partners = ranked.filter((r) => r.course !== axis).slice(0, 4).map((r) => r.course);
  const grade = parseGradeNumber(input.raceRank, input.gradeNumber);
  const strong = isStrongInnigeGate({
    c1: byCourse.get(1),
    c2: byCourse.get(2),
    grade,
  });
  const alloc = allocForConfidence(confidence, { strong, axis });

  // 2026検証ロジックで本命を組み立て
  let deepTickets: DeepTicket[] = [];
  if (alloc.mode === "strong_123") {
    deepTickets = uniqueTickets(AI_LOGIC_2026.primaryTickets).map((combo, i) => ({
      combo,
      rank: i + 1,
      role: i === 0 ? "本線" : "抑え",
      why: ticketWhy(combo, byCourse),
    }));
  } else if (alloc.mode === "axis1_conf45_stream") {
    deepTickets = uniqueTickets(AI_LOGIC_2026.fallbackAxis1).map((combo, i) => ({
      combo,
      rank: i + 1,
      role: i === 0 ? "本線" : i < 3 ? "抑え" : "相手拡張",
      why: ticketWhy(combo, byCourse),
    }));
  } else {
    const a = ranked[0]?.course ?? 1;
    const b = ranked[1]?.course ?? 2;
    const c = ranked[2]?.course ?? 3;
    deepTickets = uniqueTickets([`${a}-${b}-${c}`]).map((combo, i) => ({
      combo,
      rank: i + 1,
      role: "本線",
      why: ticketWhy(combo, byCourse),
    }));
  }

  // 本命S: 単点と条件付き5点を両方出す（5点は locked mainline）
  const sCombos = mainlineGate.ok
    ? uniqueTickets(mainlineGate.tickets).slice(0, MAINLINE_RULE.tickets.length)
    : [];
  const sTickets: DeepTicket[] = sCombos.map((combo, i) => ({
    combo,
    rank: i + 1,
    role: "本命S5点",
    why: ticketWhy(combo, byCourse),
  }));
  const sSingleTickets: DeepTicket[] = mainlineGate.ok
    ? [
        {
          combo: "1-2-3",
          rank: 1,
          role: "本命S単点",
          why: ticketWhy("1-2-3", byCourse),
        },
      ]
    : [];
  const sReady = sTickets.length > 0 || sSingleTickets.length > 0;
  const sLabel = sReady
    ? `本命S · 単点1点 + 条件付き${sTickets.length}点 · 検証回収約${MAINLINE_RULE.validated_all_roi}%（年次下限約${MAINLINE_RULE.validated_all_min_year_roi}%）`
    : "本命Sなし（回収100%超条件外）";

  const top = ranked[0];
  const second = ranked[1];
  const motorBest = [...views].sort((a, b) => b.motorTop2 - a.motorTop2)[0];
  const seriesBest = [...views]
    .filter((v) => v.seriesPoints != null)
    .sort((a, b) => (b.seriesPoints ?? 0) - (a.seriesPoints ?? 0))[0];

  const commentary: string[] = [];
  if (top) {
    commentary.push(
      `【選手能力】${top.course}号 ${top.name}（${top.className}）を軸。全国${top.nationalWin.toFixed(2)} / 直近${top.recentWin.toFixed(2)} / 当地${top.localWin.toFixed(2)}、平均ST ${top.avgStart.toFixed(2)}。`,
    );
  }
  if (seriesBest) {
    commentary.push(
      `【今節】一番調子が良いのは ${seriesBest.course}号 ${seriesBest.name}。${seriesBest.seriesLabel}${seriesBest.abilityIndex != null ? ` / 能力指数 ${seriesBest.abilityIndex}` : ""}。`,
    );
  } else {
    commentary.push("【今節】節間の確定着順がまだ薄いので、得点率・展示平均を補助指標にしています。");
  }
  if (motorBest) {
    commentary.push(
      `【モーター／ボート】機力上位は ${motorBest.course}号（モーター2連対 ${motorBest.motorTop2.toFixed(1)}% / ボート ${motorBest.boatTop2.toFixed(1)}%${motorBest.motorIndex != null ? ` / 指数 ${motorBest.motorIndex.toFixed(2)}` : ""}）。`,
    );
  }
  if (second && top) {
    commentary.push(
      `【展開】軸との差は ${(top.score - second.score).toFixed(1)}点。2026検証の本線は強イン逃げ時の1-2-3単点（検証ROI約${AI_LOGIC_2026.testRoi}%）。押し・穴の常時併売はしません。`,
    );
  }
  commentary.push(
    `【本命】${deepTickets.length}点（${deepTickets.map((t) => t.combo).join(" / ")}）· mode=${alloc.mode}。信頼度 ${confidence}/5。`,
  );
  if (sReady) {
    commentary.push(
      `【本命S】単点 ${sSingleTickets.map((t) => t.combo).join(" / ") || "—"} ／ 条件付き${sTickets.length}点（${sTickets.map((t) => t.combo).join(" / ")}）。検証回収 約${MAINLINE_RULE.validated_all_roi}%（年次下限 約${MAINLINE_RULE.validated_all_min_year_roi}%）。通常本命とは別枠。`,
    );
  } else {
    commentary.push(
      `【本命S】なし（${mainlineGate.reasons.slice(0, 3).join(" / ") || "条件外"}）。`,
    );
  }

  // 押し・穴は本線ROIを下げるため、検証採用ロジックでは出さない
  const oshiTickets: DeepTicket[] = [];
  const oshiAxis: number | null = null;
  const oshiCommentary = [
    "【押し目】2026検証で常時併売は回収を下げたため、本線では見送り。",
  ];
  commentary.push("【押し目】見送り（検証ロジック）。");

  const anaCommentary = [
    "【穴目】2026検証で常時併売は回収を下げたため、本線では見送り。",
  ];
  commentary.push("【穴目】見送り（検証ロジック）。");

  return finishDeepPicks({
    deepTickets,
    axis,
    partners,
    confidence,
    commentary,
    sTickets,
    sSingleTickets,
    sReady,
    sLabel,
    oshiTickets,
    oshiAxis,
    oshiCommentary,
    anaTickets: [],
    anaAxis: null,
    anaHitPct: 0,
    anaCommentary,
    ranked,
    alloc,
  });
}

function finishDeepPicks(input: {
  deepTickets: DeepTicket[];
  axis: number;
  partners: number[];
  confidence: ConfidenceScore;
  commentary: string[];
  sTickets: DeepTicket[];
  sSingleTickets: DeepTicket[];
  sReady: boolean;
  sLabel: string;
  oshiTickets: DeepTicket[];
  oshiAxis: number | null;
  oshiCommentary: string[];
  anaTickets: DeepTicket[];
  anaAxis: number | null;
  anaHitPct: number;
  anaCommentary: string[];
  ranked: DeepRacerView[];
  alloc: {
    honmei: number;
    oshi: number;
    ana: number;
    mode: "strong_123" | "axis1_conf45_stream" | "top1_only";
  };
}): RaceDeepPicks {
  const oshi = input.oshiTickets.slice(0, input.alloc.oshi);
  const ana = input.anaTickets.slice(0, input.alloc.ana);
  const modeNote =
    input.alloc.mode === "strong_123"
      ? `強イン逃げ条件で本命1-2-3単点（2026検証ROI約${AI_LOGIC_2026.testRoi}%）`
      : input.alloc.mode === "axis1_conf45_stream"
        ? "信頼度4以上かつ1号軸の参考流し"
        : "条件外のため参考1点（スコア上位3連単）";
  return {
    tickets: input.deepTickets.slice(0, Math.max(1, input.alloc.honmei)),
    count: Math.min(Math.max(1, input.alloc.honmei), input.deepTickets.length),
    axis: input.axis,
    partners: input.partners,
    confidence: input.confidence,
    confidenceLabel: confidenceLabelOf(input.confidence),
    commentary: input.commentary,
    sTickets: input.sTickets,
    sCount: input.sTickets.length,
    sSingleTickets: input.sSingleTickets,
    sSingleCount: input.sSingleTickets.length,
    sReady: input.sReady,
    sLabel: input.sLabel,
    oshiTickets: oshi,
    oshiCount: oshi.length,
    oshiAxis: input.oshiAxis,
    oshiCommentary: input.oshiCommentary,
    anaTickets: ana,
    anaCount: ana.length,
    anaAxis: input.anaAxis,
    anaHitPct: input.anaHitPct,
    anaConfidence: input.anaHitPct,
    anaConfidenceLabel: anaPctLabel(input.anaHitPct),
    anaCommentary: input.anaCommentary,
    racerViews: input.ranked,
    method: `${modeNote}。押し・穴は本線で見送り。本命Sは単点と条件付き5点を条件内で併記。的中保証なし。`,
  };
}


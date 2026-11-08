import lockedTriple from "@/data/locked_triple_rules.json";
import stadiumRates from "@/data/stadium_innige_rates.json";
import {
  buildHonmeiTickets,
  evaluateHonmeiEligibility,
  HONMEI_RULE,
  TICKET_LABEL as HONMEI_TICKET_LABEL,
} from "./honmeiRule";
import { courseTop2Rate, courseWinRate } from "./courseSkills";
import {
  detectOddsAnomaly,
  filterTicketsByOddsBand,
  type OddsAnomaly,
  type TrifectaOddsMap,
} from "./oddsAnomaly";
import type { RacerRow } from "./types";
import { analyzeLive, officialLiveUrl, type LiveAnalysisResult } from "./liveAnalysis";

type BandRule = Record<string, unknown> & {
  band?: string;
  ticket?: string;
  meets_target?: boolean;
  validated_test_roi?: number;
  validated_test_hit_rate?: number;
  validated_test_selected?: number;
  anomaly_block?: boolean;
  odds_lo?: number;
  odds_hi?: number;
  stadiums?: number[] | "all";
  stadium_whitelist?: number[] | null;
};

const LOCKED = lockedTriple as {
  honmei?: BandRule;
  oshi?: BandRule | null;
  ana?: BandRule | null;
};

const STADIUM_INNIGE = stadiumRates as Record<string, { rate: number; stadium: number }>;

export const BAND_TICKET_LABEL: Record<string, string> = {
  ...HONMEI_TICKET_LABEL,
  exa_21: "2連単 2-1",
  exa_21_23: "2連単 2-1 / 2-3",
  exa_31: "2連単 3-1",
  tri_213: "3連単 2-1-3",
  tri_213_214: "3連単 2-1-3 / 2-1-4",
  tri_oshi4: "3連単 押し目4点",
  tri_2axis3: "3連単 2軸3点",
  exa_45: "2連単 4-5",
  exa_45_54: "2連単 4-5 / 5-4",
  exa_46: "2連単 4-6",
  tri_4_1_stream: "3連単 4-1流し",
  tri_5_1_stream: "3連単 5-1流し",
  tri_456_546: "3連単 4-5-6系",
  tri_4axis: "3連単 4軸",
};

function innigeRate(placeNo: number): number {
  const hit = Object.values(STADIUM_INNIGE).find((v) => v.stadium === placeNo);
  return hit?.rate ?? 0;
}

function ticketsFromKind(kind: string | undefined): string[] {
  switch (kind) {
    case "exa_21":
      return ["2-1"];
    case "exa_21_23":
      return ["2-1", "2-3"];
    case "exa_31":
      return ["3-1"];
    case "tri_213":
      return ["2-1-3"];
    case "tri_213_214":
      return ["2-1-3", "2-1-4"];
    case "tri_oshi4":
      return ["2-1-3", "2-1-4", "3-1-2", "3-1-4"];
    case "tri_2axis3":
      return ["2-1-3", "2-1-4", "2-3-1"];
    case "exa_45":
      return ["4-5"];
    case "exa_45_54":
      return ["4-5", "5-4"];
    case "exa_46":
      return ["4-6"];
    case "tri_4_1_stream":
      return ["4-1-2", "4-1-3", "4-1-5", "4-1-6"];
    case "tri_5_1_stream":
      return ["5-1-2", "5-1-3", "5-1-4", "5-1-6"];
    case "tri_456_546":
      return ["4-5-6", "5-4-6"];
    case "tri_4axis":
      return ["4-1-2", "4-1-3", "4-5-1", "4-5-6"];
    case "trifecta_1_2_stream":
      return buildHonmeiTickets();
    default:
      return kind ? [kind] : [];
  }
}

function byCourse(racers: RacerRow[], course: number) {
  return racers.find((r) => r.course === course);
}

function passesOshi(placeNo: number, racers: RacerRow[], rule: BandRule): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const c1 = byCourse(racers, 1);
  const c2 = byCourse(racers, 2);
  if (!c1 || !c2) return { ok: false, reasons: ["出走データ不足"] };

  const wl = rule.stadium_whitelist;
  if (Array.isArray(wl) && wl.length && !wl.includes(placeNo)) {
    reasons.push("押し目対象場外");
  }
  const rate = innigeRate(placeNo);
  if (typeof rule.min_inn === "number" && rate < rule.min_inn) {
    reasons.push(`イン逃げ率不足 (${(rate * 100).toFixed(1)}%)`);
  }
  if (typeof rule.c1_nat_lo === "number" && c1.nationalWin < rule.c1_nat_lo) {
    reasons.push("1号勝率が押し目レンジ未満");
  }
  if (typeof rule.c1_nat_hi === "number" && c1.nationalWin > rule.c1_nat_hi) {
    reasons.push("1号が強すぎ（本命寄り）");
  }
  if (typeof rule.min_c2_nat === "number" && c2.nationalWin < rule.min_c2_nat) {
    reasons.push("2号勝率不足");
  }
  const c2Skill = courseWinRate(c2.playerNo, 2);
  const c2Top2 = courseTop2Rate(c2.playerNo, 2);
  if (typeof rule.min_c2_skill === "number" && c2Skill < rule.min_c2_skill) {
    reasons.push(`2コース得意度不足 (${(c2Skill * 100).toFixed(1)}%)`);
  }
  if (typeof rule.min_c2_top2 === "number" && c2Top2 < rule.min_c2_top2) {
    reasons.push("2コース2連対率が不足");
  }
  if (typeof rule.max_c1_st === "number" && c1.avgStart > rule.max_c1_st) {
    reasons.push("1号STが遅すぎ");
  }
  if (rule.require_c2_faster_st && !(c2.avgStart + 0.01 < c1.avgStart)) {
    reasons.push("2号ST優位なし");
  }
  if (typeof rule.min_c2_motor === "number" && c2.motorTop2 < rule.min_c2_motor) {
    reasons.push("2号モーター不足");
  }
  if (typeof rule.min_skill_gap_21 === "number") {
    const gap = c2Skill - courseWinRate(c1.playerNo, 1);
    if (gap < rule.min_skill_gap_21) reasons.push("得意コース差が不足");
  }
  return { ok: reasons.length === 0, reasons: reasons.length ? reasons : ["押し目条件を充足"] };
}

function passesAna(
  placeNo: number,
  racers: RacerRow[],
  rule: BandRule,
  windSpeed: number | null,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const c1 = byCourse(racers, 1);
  const axis = Number(rule.axis ?? 4);
  const ax = byCourse(racers, axis);
  if (!c1 || !ax) return { ok: false, reasons: ["出走データ不足"] };

  const wl = rule.stadium_whitelist;
  if (Array.isArray(wl) && wl.length && !wl.includes(placeNo)) {
    reasons.push("穴目対象場外");
  }
  const rate = innigeRate(placeNo);
  if (typeof rule.max_inn === "number" && rate > rule.max_inn) {
    reasons.push(`イン場が強すぎ (${(rate * 100).toFixed(1)}%)`);
  }
  if (typeof rule.max_c1_nat === "number" && c1.nationalWin > rule.max_c1_nat) {
    reasons.push("1号が強すぎて穴不向き");
  }
  const c1Skill = courseWinRate(c1.playerNo, 1);
  if (typeof rule.max_c1_skill === "number" && c1Skill > rule.max_c1_skill) {
    reasons.push("1コース得意の選手がイン");
  }
  if (typeof rule.min_c1_st === "number" && c1.avgStart < rule.min_c1_st) {
    reasons.push("1号STが速すぎ");
  }
  const axSkill = courseWinRate(ax.playerNo, axis);
  if (typeof rule.min_axis_skill === "number" && axSkill < rule.min_axis_skill) {
    reasons.push(`${axis}コース得意度不足`);
  }
  if (typeof rule.min_axis_nat === "number" && ax.nationalWin < rule.min_axis_nat) {
    reasons.push(`${axis}号勝率不足`);
  }
  if (rule.require_axis_faster_st && !(ax.avgStart + 0.01 < c1.avgStart)) {
    reasons.push("軸ST優位なし");
  }
  if (typeof rule.min_axis_motor === "number" && ax.motorTop2 < rule.min_axis_motor) {
    reasons.push("軸モーター不足");
  }
  if (rule.require_weak_c1_class && c1.className === "A1") {
    reasons.push("1号がA1（穴条件外）");
  }
  if (typeof rule.min_wind === "number" && rule.min_wind > 0) {
    if (windSpeed == null) reasons.push("風速未取得（直前情報待ち）");
    else if (windSpeed < rule.min_wind) reasons.push(`風が弱い (${windSpeed}m < ${rule.min_wind}m)`);
  }
  return { ok: reasons.length === 0, reasons: reasons.length ? reasons : ["穴目条件を充足"] };
}

export type BandResult = {
  band: "honmei" | "oshi" | "ana";
  label: string;
  ok: boolean;
  reasons: string[];
  tickets: string[];
  ticketLabel: string;
  betType: "trifecta" | "exacta";
  validatedRoi?: number;
  validatedHit?: number;
  meetsTarget?: boolean;
  blockedByOdds?: boolean;
};

export type TriplePrediction = {
  bands: BandResult[];
  active: BandResult[];
  anomaly: OddsAnomaly;
  live: LiveAnalysisResult;
  portfolioTickets: string[];
  focus: string;
  disclaimer: string;
};

function betTypeOf(tickets: string[]): "trifecta" | "exacta" {
  return tickets.some((t) => t.split("-").length === 3) ? "trifecta" : "exacta";
}

export function buildTriplePrediction(input: {
  placeNo: number;
  dateKey: string;
  racers: RacerRow[];
  trifectaOdds?: TrifectaOddsMap;
  streamUrl?: string;
  windSpeed?: number | null;
}): TriplePrediction {
  const anomaly = detectOddsAnomaly(input.trifectaOdds ?? {});
  const c1 = byCourse(input.racers, 1);
  const c2 = byCourse(input.racers, 2);

  const honmeiEval = c1
    ? evaluateHonmeiEligibility({
        placeNo: input.placeNo,
        className: c1.className,
        nationalWin: c1.nationalWin,
        avgStart: c1.avgStart,
        motorTop2: c1.motorTop2,
        secondNationalWin: c2?.nationalWin ?? 0,
      })
    : { ok: false, reasons: ["1コースデータなし"], tickets: [] };

  let honmeiTickets = honmeiEval.ok ? honmeiEval.tickets : [];
  let honmeiBlocked = false;
  if (honmeiTickets.length && anomaly.overbet) {
    honmeiTickets = [];
    honmeiBlocked = true;
  }
  if (honmeiTickets.length && input.trifectaOdds && Object.keys(input.trifectaOdds).length) {
    const lo = Number((LOCKED.honmei as BandRule | undefined)?.odds_lo ?? 8);
    const hi = Number((LOCKED.honmei as BandRule | undefined)?.odds_hi ?? 80);
    const filtered = filterTicketsByOddsBand(honmeiTickets, input.trifectaOdds, lo, hi);
    if (filtered.length) honmeiTickets = filtered;
  }

  const oshiRule = (LOCKED.oshi ?? null) as BandRule | null;
  const anaRule = (LOCKED.ana ?? null) as BandRule | null;

  const oshiPass = oshiRule
    ? passesOshi(input.placeNo, input.racers, oshiRule)
    : { ok: false, reasons: ["押し目ルール未ロック"] };
  let oshiTickets =
    oshiPass.ok && oshiRule ? ticketsFromKind(String(oshiRule.ticket ?? "exa_21")) : [];
  let oshiBlocked = false;
  if (oshiTickets.length && anomaly.overbet) {
    oshiTickets = [];
    oshiBlocked = true;
  }
  if (oshiTickets.length && oshiRule && input.trifectaOdds && Object.keys(input.trifectaOdds).length) {
    if (typeof oshiRule.odds_lo === "number" && typeof oshiRule.odds_hi === "number") {
      const filtered = filterTicketsByOddsBand(
        oshiTickets,
        input.trifectaOdds,
        oshiRule.odds_lo,
        oshiRule.odds_hi,
      );
      if (filtered.length) oshiTickets = filtered;
    }
  }

  const anaPass = anaRule
    ? passesAna(input.placeNo, input.racers, anaRule, input.windSpeed ?? null)
    : { ok: false, reasons: ["穴目ルール未ロック"] };
  let anaTickets =
    anaPass.ok && anaRule ? ticketsFromKind(String(anaRule.ticket ?? "exa_45")) : [];
  if (anaTickets.length && anaRule && input.trifectaOdds && Object.keys(input.trifectaOdds).length) {
    if (typeof anaRule.odds_lo === "number" && typeof anaRule.odds_hi === "number") {
      const filtered = filterTicketsByOddsBand(
        anaTickets,
        input.trifectaOdds,
        anaRule.odds_lo,
        anaRule.odds_hi,
      );
      if (filtered.length) anaTickets = filtered;
    }
  }

  const bands: BandResult[] = [
    {
      band: "honmei",
      label: "本命",
      ok: honmeiEval.ok && honmeiTickets.length > 0,
      reasons: honmeiBlocked
        ? [...honmeiEval.reasons, "異常オッズ（買われすぎ）で回避"]
        : honmeiEval.reasons,
      tickets: honmeiTickets,
      ticketLabel: HONMEI_TICKET_LABEL[HONMEI_RULE.ticket] ?? "本命",
      betType: "trifecta",
      validatedRoi: HONMEI_RULE.validated_test_roi,
      meetsTarget: true,
      blockedByOdds: honmeiBlocked,
    },
    {
      band: "oshi",
      label: "押し目",
      ok: oshiPass.ok && oshiTickets.length > 0,
      reasons: oshiBlocked
        ? [...oshiPass.reasons, "異常オッズ（買われすぎ）で回避"]
        : oshiPass.reasons,
      tickets: oshiTickets,
      ticketLabel: BAND_TICKET_LABEL[String(oshiRule?.ticket ?? "")] ?? "押し目",
      betType: betTypeOf(oshiTickets),
      validatedRoi: oshiRule?.validated_test_roi as number | undefined,
      validatedHit: oshiRule?.validated_test_hit_rate as number | undefined,
      meetsTarget: Boolean(oshiRule?.meets_target),
      blockedByOdds: oshiBlocked,
    },
    {
      band: "ana",
      label: "穴目",
      ok: anaPass.ok && anaTickets.length > 0,
      reasons: anaPass.reasons,
      tickets: anaTickets,
      ticketLabel: BAND_TICKET_LABEL[String(anaRule?.ticket ?? "")] ?? "穴目",
      betType: betTypeOf(anaTickets),
      validatedRoi: anaRule?.validated_test_roi as number | undefined,
      validatedHit: anaRule?.validated_test_hit_rate as number | undefined,
      meetsTarget: Boolean(anaRule?.meets_target),
    },
  ];

  const active = bands.filter((b) => b.ok);
  const portfolioTickets = [...new Set(active.flatMap((b) => b.tickets))];
  const live = analyzeLive({
    streamUrl: input.streamUrl ?? officialLiveUrl(input.placeNo, input.dateKey),
    exhibition: input.racers.map((r) => ({
      boat: r.course,
      name: r.name,
      st: r.avgStart,
      course: r.course,
    })),
  });

  let focus = "条件外のため見送り（無理に買わない）";
  if (active.some((b) => b.band === "honmei")) focus = "本命（イン戦）優先";
  else if (active.some((b) => b.band === "oshi")) focus = "押し目（2/3コース反撃）";
  else if (active.some((b) => b.band === "ana")) focus = "穴目（アウト・センター）";

  return {
    bands,
    active,
    anomaly,
    live,
    portfolioTickets,
    focus,
    disclaimer:
      "必ず勝てる保証はない。過去検証で条件を満たした本命/押し目/穴の3段ルール＋異常オッズ回避。",
  };
}

export function lockedTripleSnapshot() {
  return LOCKED;
}

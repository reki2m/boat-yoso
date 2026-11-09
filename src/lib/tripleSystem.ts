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
import { analyzeLive, type LiveAnalysisResult } from "./liveAnalysis";
import { type ExhibitionStatus } from "./exhibition";
import { liveBroadcastUrls } from "./liveBroadcast";
import { STADIUMS } from "./stadiums";

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
  tri_1axis_6: "3連単 1軸6点",
  tri_12_narrow: "3連単 1-2-3 / 1-2-4",
  exa_12: "2連単 1-2",
  exa_21: "2連単 2-1",
  exa_21_23: "2連単 2-1 / 2-3",
  exa_31: "2連単 3-1",
  exa_oshi2: "2連単 2-1 / 3-1",
  exa_ana2: "2連単 4-1 / 5-1",
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
    case "exa_12":
      return ["1-2"];
    case "exa_21":
      return ["2-1"];
    case "exa_21_23":
      return ["2-1", "2-3"];
    case "exa_31":
      return ["3-1"];
    case "exa_oshi2":
      return ["2-1", "3-1"];
    case "exa_ana2":
      return ["4-1", "5-1"];
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
    case "tri_12_narrow":
      return ["1-2-3", "1-2-4"];
    case "tri_1axis_6":
      return buildHonmeiTickets({ ...HONMEI_RULE, ticket: "tri_1axis_6" });
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
  if (Array.isArray(wl) && wl.length > 0 && !wl.includes(placeNo)) {
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
  if (reasons.length) return { ok: false, reasons };
  return {
    ok: true,
    reasons: [
      `1号勝率 ${c1.nationalWin.toFixed(2)} は押し目レンジ`,
      `2号 ${c2.name} 勝率 ${c2.nationalWin.toFixed(2)} / 2コース ${(c2Skill * 100).toFixed(1)}%`,
      `場イン逃げ率 ${(rate * 100).toFixed(1)}%`,
      "差し・まくり返しの押し目形",
    ],
  };
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
  if (Array.isArray(wl) && wl.length > 0 && !wl.includes(placeNo)) {
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
  if (reasons.length) return { ok: false, reasons };
  return {
    ok: true,
    reasons: [
      `イン逃げ率 ${(rate * 100).toFixed(1)}% でイン絶対場ではない`,
      `1号 ${c1.name} は勝率 ${c1.nationalWin.toFixed(2)} / ST ${c1.avgStart.toFixed(2)} と弱い`,
      `${axis}号 ${ax.name} が軸（勝率 ${ax.nationalWin.toFixed(2)} / ${axis}コース ${(axSkill * 100).toFixed(1)}%）`,
      windSpeed != null ? `風速 ${windSpeed}m` : "風速は直前確認",
    ],
  };
}

export type BandResult = {
  band: "honmei" | "oshi" | "ana";
  label: string;
  ok: boolean;
  reasons: string[];
  why: string;
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
  why: string;
  disclaimer: string;
  exhibition: ExhibitionStatus;
  ticketsLocked: boolean;
  liveUrls: ReturnType<typeof liveBroadcastUrls>;
  skipped: boolean;
  skipReason: string | null;
};

function buildWhyText(input: {
  placeNo: number;
  skipped: boolean;
  ticketsLocked: boolean;
  entryChanged: boolean;
  active: BandResult[];
  racers: RacerRow[];
  windSpeed: number | null;
}): string {
  const place = STADIUMS[input.placeNo] ?? `場${input.placeNo}`;
  if (input.entryChanged) {
    return `${place}はこのレース進入変更のため買い目を出しません。予想を無理に当てはめずスキップします。`;
  }
  if (input.ticketsLocked) {
    return `${place}はスタート展示（進入・スリット・周回タイム）の確認前です。展示が出てから買い目を確定します。`;
  }
  const top = input.active[0];
  if (!top) {
    return `${place}は回収重視の本命条件に当てはまらないため見送りです。`;
  }
  const c1 = byCourse(input.racers, 1);
  const c2 = byCourse(input.racers, 2);
  const c4 = byCourse(input.racers, 4);
  const inn = innigeRate(input.placeNo);
  if (top.band === "honmei" && c1) {
    return (
      `${place}はイン逃げ率 ${(inn * 100).toFixed(1)}% の本命向き場。` +
      `1号の${c1.name}が${c1.className}・勝率${c1.nationalWin.toFixed(2)}・ST${c1.avgStart.toFixed(2)}・` +
      `モーター${c1.motorTop2.toFixed(1)}%で本命条件を満たすため、${top.tickets.join("・")}を採用。`
    );
  }
  void c2;
  void c4;
  void input.windSpeed;
  return top.why || top.reasons.join("。") || `${place}は本命条件外。`;
}

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
  exhibition: ExhibitionStatus;
  raceNo: number;
}): TriplePrediction {
  const anomaly = detectOddsAnomaly(input.trifectaOdds ?? {});
  const liveUrls = liveBroadcastUrls(input.placeNo, input.dateKey, input.raceNo);
  const entryChanged = Boolean(input.exhibition.entryChanged);
  const ticketsLocked = !input.exhibition.ready || entryChanged;
  // 進入変更時は再マップせずスルー（見送り）
  const racers = input.racers;
  const c1 = byCourse(racers, 1);
  const c2 = byCourse(racers, 2);

  const waitingReason = entryChanged
    ? [
        "進入変更のためスキップ",
        input.exhibition.reason,
        ...input.exhibition.changes.map(
          (c) => `${c.boat}号 ${c.from}→${c.to}`,
        ),
      ]
    : ["展示未完了のため買い目ロック中", input.exhibition.reason];

  const honmeiEval = ticketsLocked
    ? { ok: false, reasons: waitingReason, tickets: [] as string[] }
    : c1
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
  const anomalyBlock = Boolean((LOCKED.honmei as BandRule | undefined)?.anomaly_block ?? true);
  if (honmeiTickets.length && anomalyBlock && (anomaly.overbet || anomaly.moneyConcentrate)) {
    honmeiTickets = [];
    honmeiBlocked = true;
  }
  if (honmeiTickets.length && input.trifectaOdds && Object.keys(input.trifectaOdds).length) {
    const lo = Number((LOCKED.honmei as BandRule | undefined)?.odds_lo ?? 6);
    const hi = Number((LOCKED.honmei as BandRule | undefined)?.odds_hi ?? 120);
    const filtered = filterTicketsByOddsBand(honmeiTickets, input.trifectaOdds, lo, hi);
    if (!filtered.length) {
      honmeiTickets = [];
      honmeiBlocked = true;
    } else {
      honmeiTickets = filtered;
    }
  }

  const wind = input.windSpeed ?? input.exhibition.windSpeed ?? null;
  void wind;

  const honmeiOk = honmeiEval.ok && honmeiTickets.length > 0;
  const honmeiReasons = honmeiBlocked
    ? [...honmeiEval.reasons, "異常オッズ（買われすぎ/資金集中）で回避"]
    : honmeiOk && c1
      ? [
          `場イン逃げ率 ${(innigeRate(input.placeNo) * 100).toFixed(1)}%`,
          `1号 ${c1.name} ${c1.className} / 勝率 ${c1.nationalWin.toFixed(2)} / ST ${c1.avgStart.toFixed(2)}`,
          `モーター2連対 ${c1.motorTop2.toFixed(1)}%` +
            (c2 ? ` / 2号との勝率差 ${(c1.nationalWin - c2.nationalWin).toFixed(2)}` : ""),
          `買い目 ${honmeiTickets.join("・")}`,
        ]
      : honmeiEval.reasons;

  const honmeiOnlyBands: BandResult[] = [
    {
      band: "honmei",
      label: "本命",
      ok: honmeiOk,
      reasons: honmeiReasons,
      why: "",
      tickets: honmeiTickets,
      ticketLabel: HONMEI_TICKET_LABEL[HONMEI_RULE.ticket] ?? "本命",
      betType: "trifecta",
      validatedRoi: HONMEI_RULE.validated_test_roi,
      meetsTarget: false,
      blockedByOdds: honmeiBlocked,
    },
  ];
  const honmeiOnlyActive = honmeiOnlyBands.filter((b) => b.ok);
  const why = buildWhyText({
    placeNo: input.placeNo,
    skipped: entryChanged,
    ticketsLocked,
    entryChanged,
    active: honmeiOnlyActive,
    racers,
    windSpeed: wind,
  });
  for (const b of honmeiOnlyBands) {
    if (b.ok) b.why = why;
    else b.why = b.reasons.slice(0, 3).join("。");
  }
  const live = analyzeLive({
    streamUrl: input.streamUrl ?? liveUrls.mediaTop,
    exhibition: input.exhibition.boats.map((b) => ({
      boat: b.boat,
      name: b.name,
      st: b.slit,
      exhibit: b.lapTime,
      course: b.course ?? undefined,
    })),
  });

  let focus = "本命条件外のため見送り";
  if (entryChanged) focus = "進入変更のためスキップ";
  else if (!input.exhibition.ready) focus = "展示待ち（進入・スリット・周回タイム）";
  else if (honmeiOnlyActive.length) focus = "本命採用（イン戦）";

  return {
    bands: honmeiOnlyBands,
    active: honmeiOnlyActive,
    anomaly,
    live,
    portfolioTickets: [...new Set(honmeiOnlyActive.flatMap((b) => b.tickets))],
    focus,
    why,
    disclaimer:
      "超厳選2点のみ。押し目・穴・6点本命は無効。1日最大2R・モーター厳選・芦屋除外・オッズ回避・展示厳格。必ず勝てる保証はない。",
    exhibition: input.exhibition,
    ticketsLocked,
    liveUrls,
    skipped: entryChanged,
    skipReason: entryChanged ? "entry_change" : null,
  };
}

export function lockedTripleSnapshot() {
  return LOCKED;
}

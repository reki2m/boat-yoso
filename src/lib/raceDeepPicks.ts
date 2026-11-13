import type { ScoredRacer } from "./predict";
import type { RacerRow } from "./types";
import type { ExhibitionStatus } from "./exhibition";
import type { SeriesFinish, SeriesForm } from "./seriesForm";
import { courseWinRate } from "./courseSkills";
import { evaluateMainlineEligibility, MAINLINE_RULE } from "./mainlineRule";

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
  role: "本線" | "抑え" | "相手拡張" | "押し本線" | "押し抑え" | "穴本線" | "穴抑え";
  why: string;
};

/** 信頼度は 1（弱い）〜 5（強い）。穴見送りは 0。 */
export type ConfidenceScore = 0 | 1 | 2 | 3 | 4 | 5;

export type RaceDeepPicks = {
  /** 本命（検証ROI≥100%ゲート通過時のみ。条件外は空） */
  tickets: DeepTicket[];
  count: number;
  axis: number;
  partners: number[];
  /** 本線信頼度 1-5 */
  confidence: ConfidenceScore;
  confidenceLabel: string;
  commentary: string[];
  /** 押し目（スコア2位軸など。本命ゲート外でも出す） */
  oshiTickets: DeepTicket[];
  oshiCount: number;
  oshiAxis: number | null;
  oshiCommentary: string[];
  /** 穴目（外枠軸） */
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
function buildOshiTickets(
  ranked: DeepRacerView[],
  byCourse: Map<number, DeepRacerView>,
  mainlineOk: boolean,
): { tickets: DeepTicket[]; axis: number | null; commentary: string[] } {
  const commentary: string[] = [];
  if (ranked.length < 3) {
    return { tickets: [], axis: null, commentary: ["【押し目】選手データ不足"] };
  }
  const c1 = byCourse.get(1);
  const c2 = byCourse.get(2);
  const c3 = byCourse.get(3);
  // 本命が強い日は2・3号軸を優先。弱い日はスコア2位を軸に。
  let axisView: DeepRacerView | undefined;
  if (mainlineOk || (c1 && c1.nationalWin >= 6.8 && c1.avgStart <= 0.15)) {
    axisView =
      (c2 && c2.score >= (c3?.score ?? 0) ? c2 : c3) ||
      ranked.find((r) => r.course === 2 || r.course === 3) ||
      ranked[1];
  } else {
    axisView =
      ranked.find((r) => r.course !== 1) ||
      ranked[1] ||
      ranked[0];
  }
  if (!axisView) {
    return { tickets: [], axis: null, commentary: ["【押し目】軸候補なし"] };
  }
  const axis = axisView.course;
  const partners = ranked
    .filter((r) => r.course !== axis)
    .slice(0, 4)
    .map((r) => r.course);
  // 足りなければ枠順で補完
  for (const n of [1, 2, 3, 4, 5, 6]) {
    if (partners.length >= 4) break;
    if (n !== axis && !partners.includes(n)) partners.push(n);
  }
  const raw: string[] = [];
  // 典型押し: 軸-相手流し + 2-1系
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
  // 検証済み押し形の核（2-1-3 / 2-1-4 / 3-1-2 / 3-1-4）をスコアが高いとき混ぜる
  if (c2 && c1 && c2.nationalWin >= 5.5) {
    raw.push("2-1-3", "2-1-4", "2-1-5");
  }
  if (c3 && c1 && c3.motorTop2 >= 35) {
    raw.push("3-1-2", "3-1-4", "3-1-5");
  }
  let list = uniqueTickets(raw).slice(0, 6);
  // 本命券と完全一致だけの押しは避ける（別候補を出す）
  if (mainlineOk) {
    const mainSet = new Set(MAINLINE_RULE.tickets || []);
    const filtered = list.filter((t) => !mainSet.has(t));
    if (filtered.length >= 4) list = filtered.slice(0, 6);
  }
  if (list.length < 4) {
    const fb = partners.slice(0, 3);
    list = uniqueTickets([
      ...list,
      `${axis}-${fb[0]}-${fb[1]}`,
      `${axis}-${fb[0]}-${fb[2]}`,
      `${axis}-${fb[1]}-${fb[0]}`,
      `${axis}-${fb[1]}-${fb[2]}`,
    ]).slice(0, 4);
  }
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
    `【押し買い目】3連単 ${tickets.length}点。差し・まくりの過去傾向と今節スコアから再計算。的中保証なし。`,
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
  const axis = ranked[0]?.course ?? 1;
  const partners = ranked.slice(1, 5).map((v) => v.course);

  const gap = (ranked[0]?.score ?? 0) - (ranked[1]?.score ?? 0);

  // 本命は検証済みゲート（年次下限≥100%系）通過時のみ。条件外は空のまま。
  const tickets = mainlineGate.ok ? uniqueTickets(mainlineGate.tickets) : [];
  const deepTickets: DeepTicket[] = tickets.map((combo, i) => ({
    combo,
    rank: i + 1,
    role: i === 0 ? "本線" : i < 3 ? "抑え" : "相手拡張",
    why: ticketWhy(combo, byCourse),
  }));

  const top = ranked[0];
  const second = ranked[1];
  const motorBest = [...views].sort((a, b) => b.motorTop2 - a.motorTop2)[0];
  const seriesBest = [...views]
    .filter((v) => v.seriesPoints != null)
    .sort((a, b) => (b.seriesPoints ?? 0) - (a.seriesPoints ?? 0))[0];

  const commentary: string[] = [];
  if (top) {
    commentary.push(
      `【選手能力】${top.course}号 ${top.name}（${top.className}）を軸候補。全国${top.nationalWin.toFixed(2)} / 直近${top.recentWin.toFixed(2)} / 当地${top.localWin.toFixed(2)}、平均ST ${top.avgStart.toFixed(2)}。`,
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
      `【モーター／ボート】機力上位は ${motorBest.course}号（モーター2連対 ${motorBest.motorTop2.toFixed(1)}% / ボート ${motorBest.boatTop2.toFixed(1)}%${motorBest.motorIndex != null ? ` / 指数 ${motorBest.motorIndex.toFixed(2)}` : ""}）。伸び負けしやすい並びでは相手に残します。`,
    );
  }
  if (second && top) {
    commentary.push(
      `【展開】軸との差は ${(top.score - second.score).toFixed(1)}点（ゲート差 ${mainlineGate.gap.toFixed(1)}）。${
        mainlineGate.ok
          ? "本命ゲート通過のため本線を提示。"
          : "本命ゲート未達のため本線は出さず、押し目・穴で補完。"
      }`,
    );
  }
  const confidence = mainConfidenceFromGap(gap, top?.score ?? 0);
  if (mainlineGate.ok) {
    commentary.push(
      `【本命】3連単 ${deepTickets.length}点（${deepTickets.map((t) => t.combo).join(" / ")}）。信頼度 ${confidence}/5。検証回収 約${MAINLINE_RULE.validated_all_roi}%（年次下限 約${MAINLINE_RULE.validated_all_min_year_roi}%）。`,
    );
  } else {
    commentary.push(
      `【本命】見送り（${mainlineGate.reasons.slice(0, 3).join(" / ")}）。回収100%超の条件のみ出す方針はそのまま。`,
    );
  }

  // ---- 押し目: スコア上位の差し・まくり形（本命が出ない日の主軸） ----
  const oshiBuilt = buildOshiTickets(ranked, byCourse, mainlineGate.ok);
  const oshiTickets = oshiBuilt.tickets;
  const oshiAxis = oshiBuilt.axis;
  const oshiCommentary = oshiBuilt.commentary;
  if (oshiTickets.length) {
    commentary.push(
      `【押し目】${oshiAxis}号軸 ${oshiTickets.length}点（${oshiTickets.map((t) => t.combo).join(" / ")}）。過去傾向の差し・まくり形をスコア再計算。`,
    );
  }

  // ---- 穴目: 外枠(4-6)の機力・今節・直近が相対的に強い場合 ----
  const c1 = byCourse.get(1);
  const c1Strong = Boolean(c1 && c1.nationalWin >= 7.0 && c1.avgStart <= 0.15);
  const outer = views
    .filter((v) => v.course >= 4)
    .map((v) => {
      const upside =
        v.score * 0.55 +
        clamp(v.motorTop2 / 55, 0, 1) * 18 +
        clamp((v.motorIndex ?? -0.2) + 0.4, 0, 1) * 10 +
        clamp((v.seriesPoints ?? 4) / 10, 0, 1) * 12 +
        clamp(v.recentWin / 7.5, 0, 1) * 10 +
        (v.avgStart <= 0.15 ? 4 : 0) +
        (c1 && v.avgStart + 0.01 < c1.avgStart ? 5 : 0) +
        (c1 && v.nationalWin + 0.3 >= c1.nationalWin ? 3 : 0) -
        (c1 && c1.nationalWin >= 7.2 && c1.avgStart <= 0.13 ? 8 : 0);
      return { v, upside: Math.round(upside * 10) / 10 };
    })
    .sort((a, b) => b.upside - a.upside);

  const anaLead = outer[0];
  const anaAxis = anaLead?.v.course ?? null;
  const anaRaw: string[] = [];
  const anaCommentary: string[] = [];

  // 閾値を下げて「見送りだらけ」を避け、当たりやすい外枠を出す
  if (anaLead && anaAxis != null && anaLead.upside >= 28) {
    const ana = anaLead.v;
    const partnerOrder: number[] = [];
    for (const r of ranked) {
      if (r.course !== anaAxis && !partnerOrder.includes(r.course)) partnerOrder.push(r.course);
    }
    for (const r of [...views].sort((a, b) => b.motorTop2 - a.motorTop2)) {
      if (r.course !== anaAxis && !partnerOrder.includes(r.course)) partnerOrder.push(r.course);
    }
    const anaPartners = partnerOrder.slice(0, 4);

    for (let i = 0; i < anaPartners.length; i++) {
      for (let j = 0; j < anaPartners.length; j++) {
        if (i === j) continue;
        const b = anaPartners[i];
        const c = anaPartners[j];
        anaRaw.push(`${anaAxis}-${b}-${c}`);
      }
    }
    if (c1) {
      for (const c of anaPartners.slice(0, 3)) {
        if (c === 1) continue;
        anaRaw.push(`${anaAxis}-1-${c}`);
      }
    }

    let anaTicketsList = uniqueTickets(anaRaw);
    // まず点数を仮決めしてから参考的中率を出す
    const provisionalPct = anaHitPctFromUpside(anaLead.upside, c1Strong, 5);
    const keepAna = provisionalPct >= 12 ? 4 : provisionalPct >= 8 ? 5 : 6;
    anaTicketsList = anaTicketsList.slice(0, Math.min(6, Math.max(4, keepAna)));
    if (anaTicketsList.length < 4) {
      const fb = [2, 3, 1, 5, 6, 4].filter((n) => n !== anaAxis);
      anaTicketsList = uniqueTickets([
        ...anaTicketsList,
        `${anaAxis}-${fb[0]}-${fb[1]}`,
        `${anaAxis}-${fb[0]}-${fb[2]}`,
        `${anaAxis}-${fb[1]}-${fb[0]}`,
        `${anaAxis}-1-${fb[0]}`,
      ]).slice(0, 4);
    }

    const anaHitPct = anaHitPctFromUpside(anaLead.upside, c1Strong, anaTicketsList.length);
    const anaDeep: DeepTicket[] = anaTicketsList.map((combo, i) => ({
      combo,
      rank: i + 1,
      role: i === 0 ? "穴本線" : "穴抑え",
      why: ticketWhy(combo, byCourse),
    }));

    anaCommentary.push(
      `【穴軸】${ana.course}号 ${ana.name}（${ana.className}）。全国${ana.nationalWin.toFixed(2)} / 直近${ana.recentWin.toFixed(2)}、モーター${ana.motorTop2.toFixed(1)}%${ana.motorIndex != null ? ` / 指数${ana.motorIndex.toFixed(2)}` : ""}、${ana.seriesLabel}。`,
    );
    if (c1) {
      const weakIn =
        c1.nationalWin <= 6.2 || c1.avgStart >= 0.16 || (c1.motorTop2 ?? 0) < 35;
      anaCommentary.push(
        weakIn
          ? `【狙い目】1号 ${c1.name} は勝率${c1.nationalWin.toFixed(2)} / ST${c1.avgStart.toFixed(2)} / モーター${c1.motorTop2.toFixed(0)}%で絶対ではなく、外の伸び・まくり差しが残る。`
          : `【注意】1号 ${c1.name} も強い（勝率${c1.nationalWin.toFixed(2)} / ST${c1.avgStart.toFixed(2)}）。穴は少点数・抑え寄りで。`,
      );
    }
    anaCommentary.push(
      `【穴買い目】3連単 ${anaDeep.length}点（${anaDeep.map((t) => t.combo).join(" / ")}）。${anaPctLabel(anaHitPct)}。運用ロックなし・回収保証なし。本命が強い日は特に薄い想定。`,
    );

    commentary.push(
      `【穴目】${ana.course}号軸 ${anaDeep.length}点は参考併記のみ（${anaHitPct}%）。運用本命は1-2-3単点側を優先。`,
    );

    return {
      tickets: deepTickets,
      count: deepTickets.length,
      axis,
      partners,
      confidence,
      confidenceLabel: confidenceLabelOf(confidence),
      commentary,
      oshiTickets,
      oshiCount: oshiTickets.length,
      oshiAxis,
      oshiCommentary,
      anaTickets: anaDeep,
      anaCount: anaDeep.length,
      anaAxis,
      anaHitPct,
      anaConfidence: anaHitPct,
      anaConfidenceLabel: anaPctLabel(anaHitPct),
      anaCommentary,
      racerViews: ranked,
      method:
        "本命は検証ゲート（回収100%超系）通過時のみ。押し目・穴はスコアと過去傾向から毎回再計算。的中保証なし。",
    };
  }

  // 穴条件が薄いときも、外枠1位で最低4点は出す（完全見送りを避ける）
  if (anaLead && anaAxis != null) {
    const fb = ranked
      .filter((r) => r.course !== anaAxis)
      .slice(0, 4)
      .map((r) => r.course);
    const fallback = uniqueTickets([
      `${anaAxis}-${fb[0]}-${fb[1]}`,
      `${anaAxis}-${fb[0]}-${fb[2]}`,
      `${anaAxis}-${fb[1]}-${fb[0]}`,
      `${anaAxis}-${fb[1]}-${fb[2]}`,
    ]).slice(0, 4);
    const anaDeep: DeepTicket[] = fallback.map((combo, i) => ({
      combo,
      rank: i + 1,
      role: i === 0 ? "穴本線" : "穴抑え",
      why: ticketWhy(combo, byCourse),
    }));
    const anaHitPct = Math.max(4, anaHitPctFromUpside(anaLead.upside, c1Strong, anaDeep.length));
    anaCommentary.push(
      `【穴目】条件は弱めだが外枠上位 ${anaLead.v.course}号軸で参考${anaDeep.length}点（${anaPctLabel(anaHitPct)}）。`,
    );
    commentary.push(`【穴目】参考 ${anaDeep.length}点（条件弱め）。`);
    return {
      tickets: deepTickets,
      count: deepTickets.length,
      axis,
      partners,
      confidence,
      confidenceLabel: confidenceLabelOf(confidence),
      commentary,
      oshiTickets,
      oshiCount: oshiTickets.length,
      oshiAxis,
      oshiCommentary,
      anaTickets: anaDeep,
      anaCount: anaDeep.length,
      anaAxis,
      anaHitPct,
      anaConfidence: anaHitPct,
      anaConfidenceLabel: anaPctLabel(anaHitPct),
      anaCommentary,
      racerViews: ranked,
      method:
        "本命は検証ゲート（回収100%超系）通過時のみ。押し目・穴はスコアと過去傾向から毎回再計算。的中保証なし。",
    };
  }

  anaCommentary.push("【穴目】外枠データ不足のため今回は見送り。");
  commentary.push("【穴目】今回はデータ不足で見送り。");

  return {
    tickets: deepTickets,
    count: deepTickets.length,
    axis,
    partners,
    confidence,
    confidenceLabel: confidenceLabelOf(confidence),
    commentary,
    oshiTickets,
    oshiCount: oshiTickets.length,
    oshiAxis,
    oshiCommentary,
    anaTickets: [],
    anaCount: 0,
    anaAxis: null,
    anaHitPct: 0,
    anaConfidence: 0,
    anaConfidenceLabel: anaPctLabel(0),
    anaCommentary,
    racerViews: ranked,
    method:
      "本命は検証ゲート（回収100%超系）通過時のみ。押し目・穴はスコアと過去傾向から毎回再計算。的中保証なし。",
  };
}


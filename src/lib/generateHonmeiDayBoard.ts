import courseSkills from "@/data/course_skills.json";
import honmeiRules from "@/data/honmei_rules.json";
import stadiumRates from "@/data/stadium_innige_rates.json";
import { STADIUMS } from "@/lib/stadiums";
import type { PicksBoardDoc } from "@/lib/loadPicksBoard";
import { isFinalsRace, MAINLINE_RULE } from "@/lib/mainlineRule";

type Rule = {
  label?: string;
  ticket?: string;
  tickets?: string[];
  stake_per_ticket?: number;
  min_c1_nat?: number;
  max_c1_st?: number;
  min_inn?: number;
  max_c1_class?: number;
  min_motor2?: number;
  min_gap_c2?: number;
  require_leading_score?: boolean;
  min_score_gap?: number;
  min_pick_score?: number;
  stadium_whitelist?: number[] | null;
  race_blacklist?: number[] | null;
  grades?: number[];
  validated_test_roi?: number;
};

type Entry = {
  regno: number;
  name: string;
  class: number;
  nat: number;
  st: number;
  motor2: number;
  grade: number;
};

type Cand = Record<string, unknown> & {
  score: number;
  score_gap: number;
  min_pick_score: number;
  elite?: boolean;
};

const CLASS_LABEL: Record<number, string> = { 1: "A1", 2: "A2", 3: "B1", 4: "B2" };

function classLabel(n: number): string {
  return CLASS_LABEL[n] || `級${n}`;
}

function innigeMap(): Map<number, number> {
  const out = new Map<number, number>();
  for (const v of Object.values(stadiumRates as Record<string, { stadium: number; rate: number }>)) {
    out.set(Number(v.stadium), Number(v.rate));
  }
  return out;
}

function skillRates(regno: number, course: number): { win: number; top2: number } {
  const skills = courseSkills as Record<
    string,
    { courses?: Record<string, { win_rate?: number; top2_rate?: number }> }
  >;
  const c = skills[String(regno)]?.courses?.[String(course)] || {};
  return { win: Number(c.win_rate || 0), top2: Number(c.top2_rate || 0) };
}

function boatStrength(entry: Entry, course: number): number {
  const { win } = skillRates(entry.regno, course);
  return (
    entry.nat * 3 +
    (0.2 - entry.st) * 40 +
    entry.motor2 / 25 +
    win * 12 -
    (entry.class - 1) * 2
  );
}

function passes(
  rule: Rule | undefined,
  place: number,
  e1: Entry,
  e2: Entry,
  inn: number,
  scoreGap: number,
  raceNo: number,
): boolean {
  if (!rule) return false;
  const wl = rule.stadium_whitelist;
  if (Array.isArray(wl) && wl.length && !wl.includes(place)) return false;
  const rbl = rule.race_blacklist;
  if (Array.isArray(rbl) && rbl.length && rbl.includes(raceNo)) return false;
  if ((rule.require_leading_score ?? true) && scoreGap < Number(rule.min_score_gap || 0)) {
    return false;
  }
  const grades = rule.grades || [4, 5];
  return (
    e1.nat >= Number(rule.min_c1_nat || 5.8) &&
    e1.st <= Number(rule.max_c1_st || 0.18) &&
    inn >= Number(rule.min_inn || 0.55) &&
    e1.class <= Number(rule.max_c1_class || 2) &&
    e1.motor2 >= Number(rule.min_motor2 || 28) &&
    e1.nat - e2.nat >= Number(rule.min_gap_c2 || 0.8) &&
    grades.includes(e1.grade)
  );
}

function explain(
  place: number,
  e1: Entry,
  e2: Entry,
  inn: number,
  tickets: string[],
  elite: boolean,
  scoreGap: number,
  stake: number,
): { why: string; reasons: string[] } {
  const name = STADIUMS[place] || `場${place}`;
  const tier = elite ? "本命S" : "本命";
  const reasons = [
    `${name}イン逃げ率 ${(inn * 100).toFixed(1)}%（本命向き）`,
    `1号 ${e1.name} ${classLabel(e1.class)} / 勝率 ${e1.nat.toFixed(2)} / ST ${e1.st.toFixed(2)}`,
    `モーター2連対 ${e1.motor2.toFixed(1)}% / 1号相対最強（差 ${scoreGap.toFixed(2)}）`,
    elite
      ? `本命S条件付き${tickets.length}点 ${tickets.join(", ")}（1点${stake}円・検証ROI約${MAINLINE_RULE.validated_all_roi ?? "—"}%）`
      : `本命単点 ${tickets.join(", ")}（1点${stake}円）`,
    "朝時点: 展示・オッズは未確定（展示後に再判定）",
  ];
  void e2;
  const why = elite
    ? `${name}は条件付き5点の本命S形。1号の${e1.name}が相対最強` +
      `（${classLabel(e1.class)}・勝率${e1.nat.toFixed(2)}・ST${e1.st.toFixed(2)}・` +
      `モーター${e1.motor2.toFixed(1)}%・差${scoreGap.toFixed(2)}）のため、` +
      `3連単${tickets.length}点（${tickets.join(", ")}）を採用。` +
      `検証回収 約${MAINLINE_RULE.validated_all_roi ?? "—"}%（年次下限 約${MAINLINE_RULE.validated_all_min_year_roi ?? "—"}%）。`
    : `${name}はボリューム単点の本命形。1号の${e1.name}が相対最強` +
      `（${classLabel(e1.class)}・勝率${e1.nat.toFixed(2)}・ST${e1.st.toFixed(2)}・` +
      `モーター${e1.motor2.toFixed(1)}%）のため、` +
      `${tier}として3連単${tickets.length}点（${tickets.join(", ")}）を採用。`;
  return { why, reasons };
}

async function fetchPrograms(dateKey: string): Promise<Record<string, unknown> | null> {
  const year = dateKey.slice(0, 4);
  const urls = [
    `https://boatraceopenapi.github.io/api/v1/${year}/${dateKey}.json`,
    "https://boatraceopenapi.github.io/api/v1/today.json",
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "BoatYosoMorningHonmei/1.0" },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const data = (await res.json()) as Record<string, unknown>;
      if (url.endsWith("today.json")) {
        // today.json は当日専用
        const todayIso = new Date().toLocaleString("en-CA", {
          timeZone: "Asia/Tokyo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).replaceAll("-", "");
        if (dateKey !== todayIso) continue;
      }
      return data;
    } catch {
      // try next
    }
  }
  return null;
}

function selectPicks(cands: Cand[], softMax: number, minScore: number, minGap: number): Cand[] {
  const sorted = [...cands].sort((a, b) => b.score - a.score);
  const out: Cand[] = [];
  for (const p of sorted) {
    if (p.score < Number(p.min_pick_score || minScore)) continue;
    if (Number(p.score_gap || 0) < minGap) continue;
    out.push(p);
    if (out.length >= softMax) break;
  }
  return out;
}

/**
 * OpenAPI 番組から当日の本命ボードを朝用に生成（展示待ち provisional）。
 */
export async function generateHonmeiDayBoard(dateKey: string): Promise<PicksBoardDoc> {
  const rules = honmeiRules as {
    mode?: string;
    grades?: number[];
    selection?: {
      min_score?: number;
      min_score_gap?: number;
      soft_max_per_day?: number;
      hard_max_per_day?: number;
    };
    stadium_blacklist?: number[];
    disabled_systems?: string[];
    note?: string;
    standard?: Rule;
    elite?: Rule;
  };
  // 本命S = locked mainline 条件付き5点を正とする
  const elite: Rule = {
    ...(rules.elite || {}),
    ticket: MAINLINE_RULE.ticket,
    tickets: [...MAINLINE_RULE.tickets],
    stake_per_ticket: MAINLINE_RULE.stake_per_ticket,
    min_c1_nat: MAINLINE_RULE.min_c1_nat,
    max_c1_st: MAINLINE_RULE.max_c1_st,
    min_motor2: MAINLINE_RULE.min_motor2,
    min_gap_c2: MAINLINE_RULE.min_nat_gap_c2,
    max_c1_class: MAINLINE_RULE.max_c1_class,
    min_score_gap: MAINLINE_RULE.min_score_gap,
    min_inn: 0,
    stadium_whitelist: MAINLINE_RULE.stadium_whitelist ?? undefined,
    race_blacklist: MAINLINE_RULE.race_blacklist,
    grades: MAINLINE_RULE.grades,
    validated_test_roi: MAINLINE_RULE.validated_all_roi,
    label: "本命S",
  };
  const standard = rules.standard || {};
  const blacklist = new Set(
    [
      ...(rules.stadium_blacklist || []),
      ...(MAINLINE_RULE.stadium_blacklist || []),
    ].map(Number),
  );
  const innige = innigeMap();
  const programs = await fetchPrograms(dateKey);
  if (!programs) {
    return {
      active_date: dateKey,
      date: dateKey,
      phase: "morning",
      generated_at: new Date().toISOString(),
      picks: [],
      status: "programs_unavailable",
      mode: rules.mode || "honmei_2020_maxminy",
      note: "番組未公開。朝の自動投稿時点では本命を出せません。",
      disabled_systems: rules.disabled_systems || ["oshi", "ana"],
    };
  }

  const stadiums =
    ((programs.programs as { stadiums?: Record<string, unknown> } | undefined)?.stadiums) || {};
  const grades = rules.grades || [4, 5];
  const cands: Cand[] = [];

  for (const [sid, stRaw] of Object.entries(stadiums)) {
    const place = Number(sid);
    if (!place || blacklist.has(place)) continue;
    const inn = innige.get(place) ?? 0.5;
    const st = stRaw as { races?: Record<string, Record<string, unknown>> };
    for (const [rid, race] of Object.entries(st.races || {})) {
      const grade = Number(race.grade_number || 5);
      if (!grades.includes(grade)) continue;
      const raceNo = Number(rid);
      const entries: Record<number, Entry> = {};
      for (const r of Object.values((race.racers || {}) as Record<string, Record<string, unknown>>)) {
        const entry = Number(r.entry_number || 0);
        if (!entry) continue;
        entries[entry] = {
          regno: Number(r.number || 0),
          name: String(r.name || ""),
          class: Number(r.rank_number || 4),
          nat: Number(r.national_win_rate || 0),
          st: Number(r.average_start_timing || 0.2),
          motor2: Number(r.motor_top_2_percent || 0),
          grade,
        };
      }
      if (Object.keys(entries).length < 6 || !entries[1] || !entries[2]) continue;

      const strengths: Record<number, number> = {};
      for (const [e, v] of Object.entries(entries)) {
        strengths[Number(e)] = boatStrength(v, Number(e));
      }
      const scoreGap =
        strengths[1] - Math.max(...Object.entries(strengths).filter(([e]) => Number(e) !== 1).map(([, v]) => v));
      const e1 = entries[1];
      const e2 = entries[2];
      const raceTitle = String(race.title || "");
      const eliteOk =
        passes(elite, place, e1, e2, inn, scoreGap, raceNo) &&
        !(MAINLINE_RULE.exclude_finals && isFinalsRace(raceTitle));
      const isElite = eliteOk;
      const isStandard = passes(standard, place, e1, e2, inn, scoreGap, raceNo);
      if (!isElite && !isStandard) continue;

      const rule = isElite ? elite : standard;
      const tickets = [...(rule.tickets || ["1-2-3"])];
      const stake = Number(rule.stake_per_ticket || 100);
      const c1 = skillRates(e1.regno, 1);
      const score =
        e1.nat * 3 +
        (0.2 - e1.st) * 50 +
        e1.motor2 / 30 +
        inn * 6 +
        c1.win * 10 +
        (e1.nat - e2.nat) +
        c1.top2 * 5 +
        Math.max(0, scoreGap) +
        (isElite ? 40 : 0);
      const minPickScore = Number(rule.min_pick_score || rules.selection?.min_score || 48);
      if (score < minPickScore) continue;

      const expl = explain(place, e1, e2, inn, tickets, isElite, scoreGap, stake);
      cands.push({
        date: dateKey,
        stadium: place,
        stadium_name: STADIUMS[place] || `場${place}`,
        race: raceNo,
        title: String(race.title || ""),
        grade,
        status: "provisional",
        closed_at: race.closed_at || null,
        mode: rules.mode || "honmei_2020_maxminy",
        band: isElite ? "honmei_s" : "honmei",
        label: rule.label || (isElite ? "本命S" : "本命"),
        tickets,
        ticket: rule.ticket || "trifecta_123",
        points: tickets.length,
        stake_per_ticket: stake,
        stake_total: stake * tickets.length,
        score,
        score_gap: Math.round(scoreGap * 1000) / 1000,
        min_pick_score: minPickScore,
        elite: isElite,
        validated_roi: rule.validated_test_roi ?? null,
        innige: inn,
        motor2: e1.motor2,
        odds: {
          source: "missing",
          missing: true,
          ok: null,
          reason: "オッズ未取得（展示後に再判定）",
        },
        ...expl,
      });
    }
  }

  const softMax = Number(rules.selection?.soft_max_per_day || rules.selection?.hard_max_per_day || 2);
  const picks = selectPicks(
    cands,
    softMax,
    Number(rules.selection?.min_score || 0),
    Number(rules.selection?.min_score_gap || 1.5),
  );

  return {
    active_date: dateKey,
    date: dateKey,
    phase: "morning",
    generated_at: new Date().toISOString(),
    picks,
    count: picks.length,
    status: "ok",
    mode: rules.mode || "honmei_2020_maxminy",
    selection: rules.selection,
    disabled_systems: rules.disabled_systems || ["oshi", "ana"],
    note:
      rules.note ||
      `朝7時自動投稿。展示・進入確定前のため展示待ち。本命は単点1-2-3、本命Sは条件付き5点（検証ROI約${MAINLINE_RULE.validated_all_roi ?? "—"}%）。`,
  };
}

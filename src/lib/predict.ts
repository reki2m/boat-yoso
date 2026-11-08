import type { RacerRow } from "./types";
import { annotateCourseSkills, courseWinRate } from "./courseSkills";

const CLASS_SCORE: Record<string, number> = {
  A1: 1,
  A2: 0.72,
  B1: 0.42,
  B2: 0.2,
};

export type ScoredRacer = RacerRow & {
  score: number;
  reasons: string[];
  courseSkill?: {
    winRate: number;
    top2Rate: number;
    starts: number;
    bestCourse: number | null;
    label: string;
    isSpecialist: boolean;
  };
};

export type Prediction = {
  rankings: ScoredRacer[];
  honmei: ScoredRacer;
  taikou: ScoredRacer;
  ana: ScoredRacer;
  sanrentan: string;
  confidence: "高め" | "中" | "低め";
  summary: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function scoreRace(racers: RacerRow[]): Prediction {
  const withSkills = annotateCourseSkills(racers);
  const scored: ScoredRacer[] = withSkills.map((r) => {
    const reasons: string[] = [];
    const classScore = CLASS_SCORE[r.className] ?? 0.3;
    const national = clamp(r.nationalWin / 8, 0, 1);
    const local = clamp(r.localWin / 8, 0, 1);
    const motor = clamp(r.motorTop2 / 60, 0, 1);
    const boat = clamp(r.boatTop2 / 60, 0, 1);
    const start = clamp(1 - (r.avgStart - 0.1) / 0.2, 0, 1);
    const courseBias = r.course === 1 ? 0.18 : r.course === 2 ? 0.08 : r.course === 3 ? 0.05 : 0;
    const skillWin = courseWinRate(r.playerNo, r.course);
    const skillScore = clamp(skillWin / 0.35, 0, 1);

    if (r.className === "A1") reasons.push("級別A1");
    if (r.nationalWin >= 6) reasons.push(`全国勝率 ${r.nationalWin.toFixed(2)}`);
    if (r.motorTop2 >= 40) reasons.push(`モーター2連対 ${r.motorTop2.toFixed(1)}%`);
    if (r.boatTop2 >= 40) reasons.push(`ボート2連対 ${r.boatTop2.toFixed(1)}%`);
    if (r.avgStart <= 0.15) reasons.push(`平均ST ${r.avgStart.toFixed(2)}`);
    if (r.course === 1) reasons.push("1コース枠利");
    if (r.courseSkill?.isSpecialist) {
      reasons.push(`得意${r.course}コース ${(skillWin * 100).toFixed(1)}%`);
    } else if (r.courseSkill?.label === "苦手気味") {
      reasons.push(`${r.course}コース苦手気味`);
    }

    const score =
      classScore * 20 +
      national * 20 +
      local * 10 +
      motor * 14 +
      boat * 8 +
      start * 10 +
      courseBias * 16 +
      skillScore * 18;

    return {
      ...r,
      score: Math.round(score * 10) / 10,
      reasons,
      courseSkill: r.courseSkill,
    };
  });

  const rankings = [...scored].sort((a, b) => b.score - a.score);
  const [honmei, taikou, ana] = rankings;
  const gap = honmei.score - rankings[rankings.length - 1].score;
  const confidence = gap >= 18 ? "高め" : gap >= 10 ? "中" : "低め";
  const sanrentan = `${honmei.course}-${taikou.course}-${ana.course}`;

  return {
    rankings,
    honmei,
    taikou,
    ana,
    sanrentan,
    confidence,
    summary: `${honmei.course}号 ${honmei.name} を本命。級別・勝率・モーターを合成した参考スコアです。`,
  };
}

import skills from "@/data/course_skills.json";

export type CourseSkill = {
  starts: number;
  win_rate: number;
  top2_rate: number;
  top3_rate: number;
};

export type RacerSkillProfile = {
  name?: string;
  best_course?: number | null;
  courses: Record<string, CourseSkill>;
};

const SKILLS = skills as Record<string, RacerSkillProfile>;

export function getRacerSkill(regno: number | string | undefined | null): RacerSkillProfile | null {
  if (regno == null || regno === "") return null;
  return SKILLS[String(regno)] ?? null;
}

export function courseWinRate(
  regno: number | string | undefined | null,
  course: number,
): number {
  const profile = getRacerSkill(regno);
  if (!profile) return 0;
  return profile.courses[String(course)]?.win_rate ?? 0;
}

export function courseTop2Rate(
  regno: number | string | undefined | null,
  course: number,
): number {
  const profile = getRacerSkill(regno);
  if (!profile) return 0;
  return profile.courses[String(course)]?.top2_rate ?? 0;
}

export function annotateCourseSkills<
  T extends { course: number; playerNo?: number; name: string },
>(racers: T[]) {
  return racers.map((r) => {
    const profile = getRacerSkill(r.playerNo);
    const skill = profile?.courses[String(r.course)];
    const best = profile?.best_course ?? null;
    const label =
      skill && skill.starts >= 30
        ? skill.win_rate >= 0.18
          ? "得意コース"
          : skill.win_rate <= 0.06
            ? "苦手気味"
            : "標準"
        : "データ薄";
    return {
      ...r,
      courseSkill: {
        winRate: skill?.win_rate ?? 0,
        top2Rate: skill?.top2_rate ?? 0,
        starts: skill?.starts ?? 0,
        bestCourse: best,
        label,
        isSpecialist: Boolean(skill && skill.starts >= 40 && skill.win_rate >= 0.15),
      },
    };
  });
}

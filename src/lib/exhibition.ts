import type { RacerRow } from "./types";

export type ExhibitionBoat = {
  boat: number;
  name: string;
  playerNo: number;
  /** 番組上の枠（艇番） */
  entry: number;
  /** 展示進入コース（確定前は null） */
  course: number | null;
  /** 展示ST / スリット */
  slit: number | null;
  /** 展示タイム（周回） */
  lapTime: number | null;
  entryChanged: boolean;
};

export type ExhibitionStatus = {
  ready: boolean;
  reason: string;
  entryChanged: boolean;
  changes: Array<{ boat: number; name: string; from: number; to: number }>;
  boats: ExhibitionBoat[];
  windSpeed: number | null;
  wave: number | null;
};

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.trim().replace(/[^\d.-]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * 展示データが揃っているか判定。
 * 進入コース・スリット(ST)・周回タイムが揃ってから買い目を出す。
 */
export function evaluateExhibition(
  boats: ExhibitionBoat[],
  meta?: { windSpeed?: number | null; wave?: number | null },
): ExhibitionStatus {
  const withCourse = boats.filter((b) => b.course != null);
  const withSlit = boats.filter((b) => b.slit != null);
  const withLap = boats.filter((b) => b.lapTime != null);
  const changes = boats
    .filter((b) => b.entryChanged && b.course != null)
    .map((b) => ({ boat: b.boat, name: b.name, from: b.entry, to: b.course as number }));

  const ready =
    boats.length >= 6 &&
    withCourse.length >= 6 &&
    withSlit.length >= 6 &&
    withLap.length >= 6;

  let reason = "展示完了。進入・スリット・周回タイムを反映して買い目を算出します。";
  if (!ready) {
    const missing: string[] = [];
    if (withCourse.length < 6) missing.push("進入状況");
    if (withSlit.length < 6) missing.push("スリット");
    if (withLap.length < 6) missing.push("周回タイム");
    reason = `展示待ち: ${missing.join("・")} が出てから買い目を出します（朝1Rから監視開始）。`;
  } else if (changes.length) {
    reason = `進入変更あり（${changes.map((c) => `${c.boat}号 ${c.from}→${c.to}`).join(" / ")}）。変更後コースで再計算。`;
  }

  return {
    ready,
    reason,
    entryChanged: changes.length > 0,
    changes,
    boats,
    windSpeed: meta?.windSpeed ?? null,
    wave: meta?.wave ?? null,
  };
}

/** 進入変更後の実コースで racer.course を差し替える */
export function remapRacersToExhibitionCourses(
  racers: RacerRow[],
  exhibition: ExhibitionStatus,
): RacerRow[] {
  if (!exhibition.ready) return racers;
  return racers
    .map((r) => {
      // r.course は現状枠番。進入確定後は実コースへ差し替え。
      const boatNo = r.entry ?? r.course;
      const hit = exhibition.boats.find((b) => b.entry === boatNo || b.boat === boatNo);
      if (!hit?.course) return r;
      return {
        ...r,
        course: hit.course,
        avgStart: hit.slit ?? r.avgStart,
      };
    })
    .sort((a, b) => a.course - b.course);
}

export function parseKyoteiExhibitionRow(row: Record<string, unknown>, boat: number): {
  course: number | null;
  slit: number | null;
  lapTime: number | null;
  entryChanged: boolean;
  windSpeed: number | null;
  wave: number | null;
} {
  const entry = boat;
  // shinnyuu: 当日進入。0や空は未確定扱い
  const shinnyuu = numOrNull(row.shinnyuu ?? row.shinnyu_now ?? row.nami5_shinnyuu);
  const courseFromField = numOrNull(row.course);
  // 展示前は course が枠番のまま入っていることが多い。start/time が空なら未確定。
  const slit = numOrNull(row.start ?? row.tenji_st ?? row.exhibition_st);
  const lapTime = numOrNull(row.time ?? row.tenji_time ?? row.exhibition_time);
  const readySignals = slit != null && lapTime != null;
  let course: number | null = null;
  if (readySignals) {
    // 進入確定: shinnyuu があれば優先、なければ course 欄
    course = shinnyuu && shinnyuu >= 1 && shinnyuu <= 6 ? shinnyuu : courseFromField;
  }
  const entryChanged = Boolean(course && course !== entry);
  return {
    course,
    slit,
    lapTime,
    entryChanged,
    windSpeed: numOrNull(row.wind_speed ?? row.wind),
    wave: numOrNull(row.wave),
  };
}

export function parseOpenApiPreviewRacer(r: Record<string, unknown>, entry: number) {
  const course = numOrNull(r.course_number);
  const slit = numOrNull(r.start_timing);
  const lapTime = numOrNull(r.exhibition_time);
  return {
    course: course && course >= 1 && course <= 6 ? course : null,
    slit,
    lapTime,
    entryChanged: Boolean(course && course >= 1 && course <= 6 && course !== entry),
  };
}

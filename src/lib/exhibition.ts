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

function exhibitionLap(v: unknown): number | null {
  const n = numOrNull(v);
  // 展示周りタイムは概ね 6.4〜7.5。1.54.1 のような周回時計は除外。
  if (n == null) return null;
  if (n >= 6.2 && n <= 8.5) return n;
  return null;
}

function exhibitionSlit(v: unknown): number | null {
  const n = numOrNull(v);
  if (n == null) return null;
  // OpenAPIはマイナスSTもあり得る。極端値は除外。
  if (n < -0.2 || n > 1.2) return null;
  return n;
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
  const shinnyuuRaw = numOrNull(row.shinnyuu ?? row.shinnyu_now ?? row.nami5_shinnyuu);
  const shinnyuu = shinnyuuRaw && shinnyuuRaw >= 1 && shinnyuuRaw <= 6 ? shinnyuuRaw : null;
  // 展示ST: start。展示タイムは display（time は別用途の時計文字列が多い）
  const slit = exhibitionSlit(row.start ?? row.tenji_st ?? row.exhibition_st);
  const lapTime =
    exhibitionLap(row.display) ??
    exhibitionLap(row.tenji_time) ??
    exhibitionLap(row.exhibition_time) ??
    exhibitionLap(row.time);
  // 実進入は shinnyuu のみ。枠番 course を進入確定扱いにしない（OpenAPI側と合成する）。
  const course = shinnyuu;
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

/** OpenAPI preview の展示を、日和側の欠けに合成する */
export function mergeExhibitionBoats(
  primary: ExhibitionBoat[],
  fallback: ExhibitionBoat[],
): ExhibitionBoat[] {
  const byEntry = new Map(fallback.map((b) => [b.entry, b]));
  return primary.map((b) => {
    const fb = byEntry.get(b.entry);
    if (!fb) return b;
    // 日和に実進入が無いときは OpenAPI の course を採用
    const course = b.course ?? fb.course;
    const slit = b.slit ?? fb.slit;
    const lapTime = b.lapTime ?? fb.lapTime;
    const entryChanged = Boolean(course && course !== b.entry);
    return {
      ...b,
      course,
      slit,
      lapTime,
      entryChanged,
    };
  });
}

export function parseOpenApiPreviewRacer(r: Record<string, unknown>, entry: number) {
  const course = numOrNull(r.course_number);
  const slit = exhibitionSlit(r.start_timing);
  const lapTime = exhibitionLap(r.exhibition_time);
  return {
    course: course && course >= 1 && course <= 6 ? course : null,
    slit,
    lapTime,
    entryChanged: Boolean(course && course >= 1 && course <= 6 && course !== entry),
  };
}

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

export type ExhibitionSignalSummary = {
  source?: string;
  fetchedAt?: string | null;
  stretchSlits: Array<{ boat: number; slit: number }>;
  fastLaps: Array<{ boat: number; lapTime: number; deltaVsMedian: number }>;
  slowLaps: Array<{ boat: number; lapTime: number; deltaVsMedian: number }>;
  fastOneLaps: Array<{ boat: number; oneLap: number }>;
  notes: string[];
};

export type ExhibitionStatus = {
  ready: boolean;
  reason: string;
  entryChanged: boolean;
  changes: Array<{ boat: number; name: string; from: number; to: number }>;
  boats: ExhibitionBoat[];
  windSpeed: number | null;
  wave: number | null;
  /** 進入変更・スリット伸び・周回速い等の即時シグナル */
  signals?: ExhibitionSignalSummary;
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
  meta?: {
    windSpeed?: number | null;
    wave?: number | null;
    signals?: Partial<ExhibitionSignalSummary>;
  },
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

  const signals = buildExhibitionSignals(boats, meta?.signals);

  let reason = "展示完了。進入・スリット・周回を確認。買い目は朝時点の固定券種のまま確定/見送りのみ。";
  if (!ready) {
    const missing: string[] = [];
    if (withCourse.length < 6) missing.push("進入状況");
    if (withSlit.length < 6) missing.push("スリット");
    if (withLap.length < 6) missing.push("周回タイム");
    reason = `展示待ち: ${missing.join("・")} が出てから確定します（買い目そのものは変更しません）。`;
  } else if (changes.length) {
    reason = `進入変更あり（${changes.map((c) => `${c.boat}号 ${c.from}→${c.to}`).join(" / ")}）。買い目は出さずスキップ。`;
  } else if (signals.notes.length) {
    reason = `展示完了（${signals.notes.slice(0, 2).join(" / ")}）。固定買い目を確定判定。`;
  }

  return {
    ready,
    reason,
    entryChanged: changes.length > 0,
    changes,
    boats,
    windSpeed: meta?.windSpeed ?? null,
    wave: meta?.wave ?? null,
    signals,
  };
}

export function buildExhibitionSignals(
  boats: ExhibitionBoat[],
  base?: Partial<ExhibitionSignalSummary>,
): ExhibitionSignalSummary {
  const laps = boats
    .map((b) => b.lapTime)
    .filter((v): v is number => typeof v === "number");
  const median = laps.length
    ? [...laps].sort((a, b) => a - b)[Math.floor(laps.length / 2)]
    : null;
  const stretchSlits = boats
    .filter((b) => typeof b.slit === "number" && (b.slit as number) <= 0.1)
    .map((b) => ({ boat: b.boat, slit: b.slit as number }));
  const fastLaps: ExhibitionSignalSummary["fastLaps"] = [];
  const slowLaps: ExhibitionSignalSummary["slowLaps"] = [];
  if (median != null) {
    for (const b of boats) {
      if (b.lapTime == null) continue;
      const delta = median - b.lapTime;
      if (delta >= 0.04) fastLaps.push({ boat: b.boat, lapTime: b.lapTime, deltaVsMedian: delta });
      if (delta <= -0.04) slowLaps.push({ boat: b.boat, lapTime: b.lapTime, deltaVsMedian: delta });
    }
  }
  const notes = [...(base?.notes ?? [])];
  if (!notes.length) {
    if (stretchSlits.length) {
      notes.push(
        `スリット伸び ${stretchSlits.map((s) => `${s.boat}号ST${s.slit.toFixed(2)}`).join("/")}`,
      );
    }
    if (fastLaps.length) {
      notes.push(`周回速い ${fastLaps.map((f) => `${f.boat}号`).join("/")}`);
    }
  }
  return {
    source: base?.source,
    fetchedAt: base?.fetchedAt ?? null,
    stretchSlits: base?.stretchSlits?.length ? base.stretchSlits : stretchSlits,
    fastLaps: base?.fastLaps?.length ? base.fastLaps : fastLaps,
    slowLaps: base?.slowLaps?.length ? base.slowLaps : slowLaps,
    fastOneLaps: base?.fastOneLaps ?? [],
    notes,
  };
}

/**
 * 進入確定後の実コースへ差し替え（表示・参考用）。
 * 買い目安定のため avgStart（番組ST）は上書きしない。スリットは exhibitionSlit に載せる。
 */
export function remapRacersToExhibitionCourses(
  racers: RacerRow[],
  exhibition: ExhibitionStatus,
): RacerRow[] {
  if (!exhibition.ready) return racers;
  // 進入変更時は買い目スキップ方針のためコース差し替えもしない
  if (exhibition.entryChanged) return racers;
  return racers
    .map((r) => {
      const boatNo = r.entry ?? r.course;
      const hit = exhibition.boats.find((b) => b.entry === boatNo || b.boat === boatNo);
      if (!hit?.course) return r;
      return {
        ...r,
        course: hit.course,
        exhibitionCourse: hit.course,
        exhibitionSlit: hit.slit,
        exhibitionLap: hit.lapTime,
        // avgStart は番組値のまま（展示前後で本命条件がぶれない）
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

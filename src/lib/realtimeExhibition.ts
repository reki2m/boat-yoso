import type { ExhibitionBoat } from "./exhibition";

export type RealtimeExhibitionSignals = {
  source: "boatracecsv" | "none";
  fetchedAt: string | null;
  entryChangedBoats: number[];
  /** スタート展示が伸びた（速いST） */
  stretchSlits: Array<{ boat: number; slit: number }>;
  /** 周回展示が速い */
  fastLaps: Array<{ boat: number; lapTime: number; deltaVsMedian: number }>;
  /** 周回展示が遅い */
  slowLaps: Array<{ boat: number; lapTime: number; deltaVsMedian: number }>;
  /** オリジナル展示の一周が速い */
  fastOneLaps: Array<{ boat: number; oneLap: number }>;
  windSpeed: number | null;
  wave: number | null;
  notes: string[];
};

export type RealtimeExhibitionHit = {
  boats: ExhibitionBoat[];
  signals: RealtimeExhibitionSignals;
  windSpeed: number | null;
  wave: number | null;
};

type CsvCache = { at: number; rows: Record<string, string>[]; text: string };
const csvCache = new Map<string, CsvCache>();
const CSV_TTL_MS = 20_000;

function jstYmdParts(dateKey: string): { y: string; m: string; d: string } {
  return { y: dateKey.slice(0, 4), m: dateKey.slice(4, 6), d: dateKey.slice(6, 8) };
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const cleaned = String(v).trim().replace(/[^\d.-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

async function fetchCsv(kind: string, dateKey: string): Promise<Record<string, string>[]> {
  const { y, m, d } = jstYmdParts(dateKey);
  const url = `https://boatracecsv.github.io/data/previews/${kind}/${y}/${m}/${d}.csv`;
  const hit = csvCache.get(url);
  if (hit && Date.now() - hit.at < CSV_TTL_MS) return hit.rows;
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; BoatYoso/1.0; +https://cursor.com)",
      accept: "text/csv,*/*",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`csv ${kind} ${res.status}`);
  const text = await res.text();
  const rows = parseCsv(text);
  csvCache.set(url, { at: Date.now(), rows, text });
  return rows;
}

function raceCode(dateKey: string, placeNo: number, raceNo: number): string {
  return `${dateKey}${String(placeNo).padStart(2, "0")}${String(raceNo).padStart(2, "0")}`;
}

function findRow(rows: Record<string, string>[], code: string): Record<string, string> | null {
  return rows.find((r) => r["レースコード"] === code) ?? null;
}

/**
 * BoatraceCSV の直前情報（進入・スタート展示・周回・オリジナル一周・気象）。
 * 公式SPA由来を5分間隔で公開しており、OpenAPIより早いことが多い。
 */
export async function fetchRealtimeExhibition(
  placeNo: number,
  raceNo: number,
  dateKey: string,
  namesByEntry?: Map<number, { name: string; playerNo: number }>,
): Promise<RealtimeExhibitionHit | null> {
  try {
    const code = raceCode(dateKey, placeNo, raceNo);
    const [sttRows, tkzRows, oriRows, suiRows] = await Promise.all([
      fetchCsv("stt", dateKey).catch(() => [] as Record<string, string>[]),
      fetchCsv("tkz", dateKey).catch(() => [] as Record<string, string>[]),
      fetchCsv("original_exhibition", dateKey).catch(() => [] as Record<string, string>[]),
      fetchCsv("sui", dateKey).catch(() => [] as Record<string, string>[]),
    ]);
    const stt = findRow(sttRows, code);
    const tkz = findRow(tkzRows, code);
    const ori = findRow(oriRows, code);
    const sui = findRow(suiRows, code);
    if (!stt && !tkz) return null;

    const boats: ExhibitionBoat[] = [];
    const entryChangedBoats: number[] = [];
    const stretchSlits: Array<{ boat: number; slit: number }> = [];
    const oneLapByBoat = new Map<number, number>();

    for (let boat = 1; boat <= 6; boat++) {
      const courseRaw = numOrNull(stt?.[`艇${boat}_コース`]);
      const course = courseRaw && courseRaw >= 1 && courseRaw <= 6 ? courseRaw : null;
      const slit = numOrNull(stt?.[`艇${boat}_スタート展示`]);
      const lap = numOrNull(tkz?.[`艇${boat}_展示タイム`]);
      const oneLap = numOrNull(ori?.[`艇${boat}_値1`]);
      if (oneLap != null) oneLapByBoat.set(boat, oneLap);
      const meta = namesByEntry?.get(boat);
      const entryChanged = Boolean(course && course !== boat);
      if (entryChanged) entryChangedBoats.push(boat);
      if (typeof slit === "number" && slit <= 0.1) stretchSlits.push({ boat, slit });
      boats.push({
        boat,
        name: meta?.name ?? `艇${boat}`,
        playerNo: meta?.playerNo ?? 0,
        entry: boat,
        course,
        slit: slit != null && slit >= -0.2 && slit <= 1.2 ? slit : null,
        lapTime: lap != null && lap >= 6.2 && lap <= 8.5 ? lap : null,
        entryChanged,
      });
    }

    const laps = boats
      .map((b) => b.lapTime)
      .filter((v): v is number => typeof v === "number");
    const median = laps.length
      ? [...laps].sort((a, b) => a - b)[Math.floor(laps.length / 2)]
      : null;
    const fastLaps: RealtimeExhibitionSignals["fastLaps"] = [];
    const slowLaps: RealtimeExhibitionSignals["slowLaps"] = [];
    if (median != null) {
      for (const b of boats) {
        if (b.lapTime == null) continue;
        const delta = median - b.lapTime;
        if (delta >= 0.04) fastLaps.push({ boat: b.boat, lapTime: b.lapTime, deltaVsMedian: delta });
        if (delta <= -0.04) slowLaps.push({ boat: b.boat, lapTime: b.lapTime, deltaVsMedian: delta });
      }
    }

    const oneValues = [...oneLapByBoat.values()];
    const oneMedian = oneValues.length
      ? [...oneValues].sort((a, b) => a - b)[Math.floor(oneValues.length / 2)]
      : null;
    const fastOneLaps: RealtimeExhibitionSignals["fastOneLaps"] = [];
    if (oneMedian != null) {
      for (const [boat, oneLap] of oneLapByBoat) {
        if (oneMedian - oneLap >= 0.15) fastOneLaps.push({ boat, oneLap });
      }
    }

    const windSpeed = numOrNull(sui?.["風速(m)"]);
    const waveCm = numOrNull(sui?.["波の高さ(cm)"]);
    const wave = waveCm != null ? waveCm / 100 : null;
    const notes: string[] = [];
    if (entryChangedBoats.length) {
      notes.push(`進入変更: ${entryChangedBoats.map((b) => `${b}号`).join("・")}`);
    }
    if (stretchSlits.length) {
      notes.push(
        `スリット伸び: ${stretchSlits.map((s) => `${s.boat}号ST${s.slit.toFixed(2)}`).join(" / ")}`,
      );
    }
    if (fastLaps.length) {
      notes.push(
        `周回速い: ${fastLaps.map((f) => `${f.boat}号${f.lapTime.toFixed(2)}`).join(" / ")}`,
      );
    }
    if (fastOneLaps.length) {
      notes.push(
        `一周速い: ${fastOneLaps.map((f) => `${f.boat}号${f.oneLap.toFixed(2)}`).join(" / ")}`,
      );
    }

    const fetchedAt =
      stt?.["取得日時"] || tkz?.["取得日時"] || ori?.["取得日時"] || sui?.["取得日時"] || null;

    return {
      boats,
      windSpeed,
      wave,
      signals: {
        source: "boatracecsv",
        fetchedAt,
        entryChangedBoats,
        stretchSlits,
        fastLaps,
        slowLaps,
        fastOneLaps,
        windSpeed,
        wave,
        notes,
      },
    };
  } catch {
    return null;
  }
}

import { STADIUMS, jstDateKey } from "./stadiums";
import { SAMPLE_RACE } from "./sample";
import type { RacePayload, RacerRow } from "./types";
import { parseSeriesDay, seriesRoundBadge } from "./seriesDay";
import {
  evaluateExhibition,
  mergeExhibitionBoats,
  parseKyoteiExhibitionRow,
  parseOpenApiPreviewRacer,
  type ExhibitionBoat,
  type ExhibitionStatus,
} from "./exhibition";
import { fetchRealtimeExhibition } from "./realtimeExhibition";

export type { RacePayload, RacerRow };

type CacheEntry = { at: number; payload: RacePayload; exhibition: ExhibitionStatus };
const cache = new Map<string, CacheEntry>();
const CACHE_MS_READY = 20 * 1000;
const CACHE_MS_PENDING = 8 * 1000;

const CLASS_NAME: Record<number, string> = {
  1: "A1",
  2: "A2",
  3: "B1",
  4: "B2",
};

function num(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function parseAvgStart(v: unknown): number {
  if (typeof v === "number") return v > 10 ? v / 100 : v;
  if (typeof v === "string") {
    const cleaned = v.trim();
    if (!cleaned) return 0.2;
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return 0.2;
    return n > 10 ? n / 100 : n;
  }
  return 0.2;
}

export async function fetchTodayStadiums(): Promise<number[]> {
  try {
    const res = await fetch("https://boatraceopenapi.github.io/api/v1/today.json", {
      next: { revalidate: 300 },
    });
    if (!res.ok) throw new Error(`schedule ${res.status}`);
    const data = (await res.json()) as {
      programs?: { stadiums?: Record<string, unknown> };
    };
    const ids = Object.keys(data.programs?.stadiums ?? {})
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    return ids.length ? ids : [2, 5, 7];
  } catch {
    return [2, 5, 7, 8, 11];
  }
}

export type RaceBundle = {
  payload: RacePayload;
  exhibition: ExhibitionStatus;
};

async function fetchOpenApiRace(
  placeNo: number,
  raceNo: number,
  date: string,
): Promise<RaceBundle | null> {
  const yyyy = date.slice(0, 4);
  const urls = [
    `https://boatraceopenapi.github.io/api/v1/${yyyy}/${date}.json`,
    "https://boatraceopenapi.github.io/api/v1/today.json",
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { next: { revalidate: 30 } });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        programs?: {
          stadiums?: Record<
            string,
            {
              races?: Record<
                string,
                {
                  title?: string;
                  grade_number?: number;
                  racers?: Record<string, Record<string, unknown>>;
                  preview?: {
                    wind_speed?: number;
                    wave_height?: number;
                    racers?: Record<string, Record<string, unknown>>;
                  };
                }
              >;
            }
          >;
        };
      };
      const race = data.programs?.stadiums?.[String(placeNo)]?.races?.[String(raceNo)];
      if (!race?.racers) continue;
      const previewRacers = race.preview?.racers ?? {};
      const boats: ExhibitionBoat[] = [];
      const racers: RacerRow[] = Object.values(race.racers)
        .map((r) => {
          const rank = num(r.rank_number, 4);
          const entry = num(r.entry_number);
          const prev = previewRacers[String(entry)] ?? Object.values(previewRacers).find(
            (p) => num(p.entry_number) === entry,
          );
          const ex = prev
            ? parseOpenApiPreviewRacer(prev, entry)
            : { course: null, slit: null, lapTime: null, entryChanged: false };
          boats.push({
            boat: entry,
            name: String(r.name ?? ""),
            playerNo: num(r.number),
            entry,
            course: ex.course,
            slit: ex.slit,
            lapTime: ex.lapTime,
            entryChanged: ex.entryChanged,
          });
          return {
            course: entry,
            entry,
            playerNo: num(r.number),
            name: String(r.name ?? ""),
            className: CLASS_NAME[rank] ?? String(r.rank_number_source ?? "B1"),
            branch: String(r.branch_number_source ?? ""),
            age: num(r.age),
            weightKg: num(r.weight),
            nationalWin: num(r.national_win_rate),
            nationalTop2: num(r.national_top_2_percent),
            localWin: num(r.local_win_rate),
            localTop2: num(r.local_top_2_percent),
            motorTop2: num(r.motor_top_2_percent),
            boatTop2: num(r.boat_top_2_percent),
            avgStart: parseAvgStart(r.average_start_timing),
            motorNo: num(r.motor_number),
            boatNo: num(r.boat_number),
            exhibitionCourse: ex.course,
            exhibitionSlit: ex.slit,
            exhibitionLap: ex.lapTime,
          };
        })
        .filter((r) => r.course >= 1 && r.course <= 6)
        .sort((a, b) => a.course - b.course);
      if (racers.length < 6) continue;
      const exhibition = evaluateExhibition(boats, {
        windSpeed: race.preview?.wind_speed ?? null,
        wave: race.preview?.wave_height ?? null,
      });
      return {
        payload: {
          source: "openapi",
          date,
          placeNo,
          placeName: STADIUMS[placeNo] ?? `場${placeNo}`,
          raceNo,
          raceName: String(race.title ?? ""),
          raceRank: `G${race.grade_number ?? 5}`,
          racers,
          fetchedAt: new Date().toISOString(),
          note: "OpenAPI出走表（ボートレース日和不通時フォールバック）",
          windSpeed: race.preview?.wind_speed ?? null,
          wave: race.preview?.wave_height ?? null,
        },
        exhibition,
      };
    } catch {
      // try next
    }
  }
  return null;
}

export async function fetchKyoteiRaceBundle(
  placeNo: number,
  raceNo: number,
  date = jstDateKey(),
  opts?: { forceSampleExhibition?: boolean },
): Promise<RaceBundle> {
  const key = `${date}:${placeNo}:${raceNo}:${opts?.forceSampleExhibition ? "demo" : "live"}`;
  const hit = cache.get(key);
  if (hit) {
    const ttl = hit.exhibition.ready ? CACHE_MS_READY : CACHE_MS_PENDING;
    if (Date.now() - hit.at < ttl) {
      return { payload: hit.payload, exhibition: hit.exhibition };
    }
  }

  try {
    const body = new URLSearchParams({
      data: JSON.stringify({
        place_no: String(placeNo),
        race_no: String(raceNo),
        hiduke: date,
      }),
    });
    const res = await fetch(
      "https://kyoteibiyori.com/request_race_shusso_detail_v4.php",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent":
            "Mozilla/5.0 (compatible; BoatYoso/1.0; +https://cursor.com)",
          accept: "application/json,text/plain,*/*",
        },
        body,
        cache: "no-store",
      },
    );
    if (!res.ok) throw new Error(`kyotei ${res.status}`);
    const json = (await res.json()) as {
      race_list?: Array<Record<string, unknown>>;
    };
    const list = json.race_list ?? [];
    if (!list.length) throw new Error("empty race_list");

    const first = list[0];
    const boats: ExhibitionBoat[] = [];
    let windSpeed: number | null = null;
    let wave: number | null = null;
    const racers: RacerRow[] = list
      .map((row) => {
        const entry = num(row.course);
        const ex = parseKyoteiExhibitionRow(row, entry);
        if (ex.windSpeed != null) windSpeed = ex.windSpeed;
        if (ex.wave != null) wave = ex.wave;
        boats.push({
          boat: entry,
          name: String(row.player_name ?? ""),
          playerNo: num(row.player_no),
          entry,
          course: ex.course,
          slit: ex.slit,
          lapTime: ex.lapTime,
          entryChanged: ex.entryChanged,
        });
        const seriesMarks = [row.seiseki1, row.seiseki2, row.seiseki3, row.seiseki4, row.seiseki5, row.seiseki6]
          .map((v) => (v == null || String(v).trim() === "" ? null : String(v)))
          .filter((v): v is string => Boolean(v));
        return {
          course: entry,
          entry,
          playerNo: num(row.player_no),
          name: String(row.player_name ?? ""),
          className: String(row.kyubetsu ?? ""),
          branch: String(row.shibu ?? row.shusshin ?? ""),
          age: num(row.age),
          weightKg: num(row.taiju) >= 100 ? num(row.taiju) / 10 : num(row.taiju),
          nationalWin: num(row.zenkoku_shoritsu),
          nationalTop2: num(row.zenkoku_niren),
          localWin: num(row.touchi_shoritsu),
          localTop2: num(row.touchi_niren),
          motorTop2: num(row.motor_niren),
          boatTop2: num(row.boat_niren),
          avgStart: parseAvgStart(row.ave_start),
          motorNo: num(row.motor),
          boatNo: num(row.boat),
          exhibitionCourse: ex.course,
          exhibitionSlit: ex.slit,
          exhibitionLap: ex.lapTime,
          recentWin: num(row.saikin_shoritsu, num(row.zenkoku_shoritsu)),
          seriesPoints: num(row.tokutenritsu),
          seriesDisplayAvg:
            row.konsetsu_display_ave == null || row.konsetsu_display_ave === ""
              ? null
              : num(row.konsetsu_display_ave),
          seriesStartAvg:
            row.konsetsu_start_ave == null || row.konsetsu_start_ave === ""
              ? null
              : num(row.konsetsu_start_ave),
          abilityIndex:
            row.konki_nouryoku_shisuu == null || row.konki_nouryoku_shisuu === ""
              ? null
              : num(row.konki_nouryoku_shisuu),
          motorIndex:
            row.motor_shisuu == null || row.motor_shisuu === ""
              ? null
              : num(row.motor_shisuu),
          seriesMarks,
        };
      })
      .sort((a, b) => a.course - b.course);

    let exhibition = evaluateExhibition(boats, { windSpeed, wave });
    // 1) BoatraceCSV直前情報（進入・ST・周回）を最優先で合成
    // 2) 足りなければ OpenAPI preview
    const namesByEntry = new Map(
      racers.map((r) => [r.entry ?? r.course, { name: r.name, playerNo: r.playerNo }] as const),
    );
    const realtime = await fetchRealtimeExhibition(placeNo, raceNo, date, namesByEntry);
    if (realtime?.boats?.length) {
      // realtime を優先し、欠落だけ日和で埋める
      const preferred = mergeExhibitionBoats(realtime.boats, boats);
      exhibition = evaluateExhibition(preferred, {
        windSpeed: realtime.windSpeed ?? windSpeed,
        wave: realtime.wave ?? wave,
        signals: realtime.signals,
      });
      windSpeed = realtime.windSpeed ?? windSpeed;
      wave = realtime.wave ?? wave;
      for (const r of racers) {
        const hitBoat = exhibition.boats.find((b) => b.entry === (r.entry ?? r.course));
        if (!hitBoat) continue;
        r.exhibitionCourse = hitBoat.course;
        r.exhibitionSlit = hitBoat.slit;
        r.exhibitionLap = hitBoat.lapTime;
      }
    }
    if (!exhibition.ready) {
      const openapi = await fetchOpenApiRace(placeNo, raceNo, date);
      if (openapi?.exhibition?.boats?.length) {
        const mergedBoats = mergeExhibitionBoats(exhibition.boats, openapi.exhibition.boats);
        exhibition = evaluateExhibition(mergedBoats, {
          windSpeed: windSpeed ?? openapi.exhibition.windSpeed,
          wave: wave ?? openapi.exhibition.wave,
          signals: exhibition.signals,
        });
        if (exhibition.ready || openapi.exhibition.boats.length) {
          for (const r of racers) {
            const hitEx = exhibition.boats.find((b) => b.entry === (r.entry ?? r.course));
            if (!hitEx) continue;
            r.exhibitionCourse = hitEx.course;
            r.exhibitionSlit = hitEx.slit;
            r.exhibitionLap = hitEx.lapTime;
          }
        }
        windSpeed = windSpeed ?? openapi.exhibition.windSpeed;
        wave = wave ?? openapi.exhibition.wave;
      }
    }
    if (opts?.forceSampleExhibition && !exhibition.ready) {
      exhibition = demoExhibitionFromRacers(racers, windSpeed ?? 5, wave ?? 3);
    }

    const seriesDay = parseSeriesDay(first.race_date);
    const payload: RacePayload = {
      source: "kyoteibiyori",
      date,
      placeNo,
      placeName: STADIUMS[placeNo] ?? `場${placeNo}`,
      raceNo,
      raceName: String(first.race_name ?? ""),
      raceRank: String(first.race_rank ?? ""),
      seriesDay,
      seriesDayLabel: seriesDay != null ? seriesRoundBadge(seriesDay) : "",
      racers,
      fetchedAt: new Date().toISOString(),
      windSpeed,
      wave,
      note: exhibition.ready
        ? exhibition.signals?.source
          ? `展示ソース: ${exhibition.signals.source}`
          : undefined
        : "展示の一部が未着です。BoatraceCSV/日和/OpenAPIを合成して監視中です。",
    };
    cache.set(key, { at: Date.now(), payload, exhibition });
    return { payload, exhibition };
  } catch {
    const openapi = await fetchOpenApiRace(placeNo, raceNo, date);
    if (openapi) {
      const namesByEntry = new Map(
        openapi.payload.racers.map(
          (r) => [r.entry ?? r.course, { name: r.name, playerNo: r.playerNo }] as const,
        ),
      );
      const realtime = await fetchRealtimeExhibition(placeNo, raceNo, date, namesByEntry);
      if (realtime?.boats?.length) {
        const preferred = mergeExhibitionBoats(realtime.boats, openapi.exhibition.boats);
        openapi.exhibition = evaluateExhibition(preferred, {
          windSpeed: realtime.windSpeed ?? openapi.exhibition.windSpeed,
          wave: realtime.wave ?? openapi.exhibition.wave,
          signals: realtime.signals,
        });
        openapi.payload.windSpeed = realtime.windSpeed ?? openapi.payload.windSpeed;
        openapi.payload.wave = realtime.wave ?? openapi.payload.wave;
      }
      if (opts?.forceSampleExhibition && !openapi.exhibition.ready) {
        openapi.exhibition = demoExhibitionFromRacers(
          openapi.payload.racers,
          openapi.payload.windSpeed ?? 5,
          openapi.payload.wave ?? 3,
        );
      }
      cache.set(key, {
        at: Date.now(),
        payload: openapi.payload,
        exhibition: openapi.exhibition,
      });
      return openapi;
    }
    const samplePayload = {
      ...SAMPLE_RACE,
      date,
      placeNo,
      placeName: STADIUMS[placeNo] ?? SAMPLE_RACE.placeName,
      raceNo,
      note: "ボートレース日和/OpenAPIから取得できないためサンプルデータを表示しています",
      fetchedAt: new Date().toISOString(),
      windSpeed: 5,
      wave: 3,
    };
    const exhibition = demoExhibitionFromRacers(samplePayload.racers, 5, 3);
    cache.set(key, { at: Date.now(), payload: samplePayload, exhibition });
    return { payload: samplePayload, exhibition };
  }
}

/** 互換: 旧API */
export async function fetchKyoteiRace(
  placeNo: number,
  raceNo: number,
  date = jstDateKey(),
): Promise<RacePayload> {
  const { payload } = await fetchKyoteiRaceBundle(placeNo, raceNo, date);
  return payload;
}

function demoExhibitionFromRacers(
  racers: RacerRow[],
  windSpeed: number,
  wave: number,
): ExhibitionStatus {
  // 進入変更デモ: 2と3を入れ替え
  const boats: ExhibitionBoat[] = racers.map((r, idx) => {
    const entry = r.entry ?? r.course;
    let course = entry;
    if (entry === 2) course = 3;
    else if (entry === 3) course = 2;
    return {
      boat: entry,
      name: r.name,
      playerNo: r.playerNo,
      entry,
      course,
      slit: Number((0.12 + idx * 0.01).toFixed(2)),
      lapTime: Number((6.7 + idx * 0.03).toFixed(2)),
      entryChanged: course !== entry,
    };
  });
  return evaluateExhibition(boats, { windSpeed, wave });
}

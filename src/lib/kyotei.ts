import { STADIUMS, jstDateKey } from "./stadiums";
import { SAMPLE_RACE } from "./sample";
import type { RacePayload, RacerRow } from "./types";

export type { RacePayload, RacerRow };

type CacheEntry = { at: number; payload: RacePayload };
const cache = new Map<string, CacheEntry>();
const CACHE_MS = 5 * 60 * 1000;

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

async function fetchOpenApiRace(
  placeNo: number,
  raceNo: number,
  date: string,
): Promise<RacePayload | null> {
  const yyyy = date.slice(0, 4);
  const urls = [
    `https://boatraceopenapi.github.io/api/v1/${yyyy}/${date}.json`,
    "https://boatraceopenapi.github.io/api/v1/today.json",
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { next: { revalidate: 60 } });
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
                }
              >;
            }
          >;
        };
      };
      const race = data.programs?.stadiums?.[String(placeNo)]?.races?.[String(raceNo)];
      if (!race?.racers) continue;
      const racers: RacerRow[] = Object.values(race.racers)
        .map((r) => {
          const rank = num(r.rank_number, 4);
          return {
            course: num(r.entry_number),
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
          };
        })
        .filter((r) => r.course >= 1 && r.course <= 6)
        .sort((a, b) => a.course - b.course);
      if (racers.length < 6) continue;
      return {
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
      };
    } catch {
      // try next
    }
  }
  return null;
}

export async function fetchKyoteiRace(
  placeNo: number,
  raceNo: number,
  date = jstDateKey(),
): Promise<RacePayload> {
  const key = `${date}:${placeNo}:${raceNo}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.payload;

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
    const racers: RacerRow[] = list
      .map((row) => ({
        course: num(row.course),
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
      }))
      .sort((a, b) => a.course - b.course);

    const payload: RacePayload = {
      source: "kyoteibiyori",
      date,
      placeNo,
      placeName: STADIUMS[placeNo] ?? `場${placeNo}`,
      raceNo,
      raceName: String(first.race_name ?? ""),
      raceRank: String(first.race_rank ?? ""),
      racers,
      fetchedAt: new Date().toISOString(),
    };
    cache.set(key, { at: Date.now(), payload });
    return payload;
  } catch {
    const openapi = await fetchOpenApiRace(placeNo, raceNo, date);
    if (openapi) {
      cache.set(key, { at: Date.now(), payload: openapi });
      return openapi;
    }
    const sample = {
      ...SAMPLE_RACE,
      date,
      placeNo,
      placeName: STADIUMS[placeNo] ?? SAMPLE_RACE.placeName,
      raceNo,
      note: "ボートレース日和/OpenAPIから取得できないためサンプルデータを表示しています",
      fetchedAt: new Date().toISOString(),
    };
    return sample;
  }
}

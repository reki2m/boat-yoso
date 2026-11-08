import { STADIUMS, jstDateKey } from "./stadiums";
import { SAMPLE_RACE } from "./sample";
import type { RacePayload, RacerRow } from "./types";

export type { RacePayload, RacerRow };

type CacheEntry = { at: number; payload: RacePayload };
const cache = new Map<string, CacheEntry>();
const CACHE_MS = 5 * 60 * 1000;

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
    const sample = {
      ...SAMPLE_RACE,
      date,
      placeNo,
      placeName: STADIUMS[placeNo] ?? SAMPLE_RACE.placeName,
      raceNo,
      note: "ボートレース日和から取得できないためサンプルデータを表示しています",
      fetchedAt: new Date().toISOString(),
    };
    return sample;
  }
}

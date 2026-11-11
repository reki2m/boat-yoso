/** 同一開催（今節）の着順を OpenAPI 結果から集計する */

export type SeriesFinish = {
  raceNo: number;
  place: number; // 着順
  course: number | null;
  startTiming: number | null;
};

export type SeriesForm = {
  playerNo: number;
  finishes: SeriesFinish[];
  starts: number;
  wins: number;
  top2: number;
  top3: number;
  avgPlace: number | null;
  points: number; // 簡易得点: 1着10 … 6着1
  label: string;
};

type OpenApiRace = {
  race_number?: number;
  result?: {
    racers?: Record<
      string,
      {
        number?: number;
        place_number?: number;
        course_number?: number;
        start_timing?: number;
      }
    >;
  } | null;
};

function pointsForPlace(place: number): number {
  if (place < 1 || place > 6) return 0;
  return 11 - place;
}

export async function fetchStadiumSeriesForms(
  placeNo: number,
  date: string,
  beforeRaceNo?: number,
): Promise<Map<number, SeriesForm>> {
  const yyyy = date.slice(0, 4);
  const urls = [
    `https://boatraceopenapi.github.io/api/v1/${yyyy}/${date}.json`,
    "https://boatraceopenapi.github.io/api/v1/today.json",
  ];
  const map = new Map<number, SeriesFinish[]>();

  for (const url of urls) {
    try {
      const res = await fetch(url, { next: { revalidate: 60 } });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        programs?: {
          stadiums?: Record<string, { races?: Record<string, OpenApiRace> }>;
        };
      };
      const races = data.programs?.stadiums?.[String(placeNo)]?.races;
      if (!races) continue;
      for (const race of Object.values(races)) {
        const raceNo = Number(race.race_number ?? 0);
        if (!raceNo) continue;
        if (beforeRaceNo != null && raceNo >= beforeRaceNo) continue;
        const racers = race.result?.racers;
        if (!racers) continue;
        for (const row of Object.values(racers)) {
          const playerNo = Number(row.number ?? 0);
          const place = Number(row.place_number ?? 0);
          if (!playerNo || !place) continue;
          const list = map.get(playerNo) ?? [];
          list.push({
            raceNo,
            place,
            course: row.course_number != null ? Number(row.course_number) : null,
            startTiming: row.start_timing != null ? Number(row.start_timing) : null,
          });
          map.set(playerNo, list);
        }
      }
      break;
    } catch {
      // try next
    }
  }

  const out = new Map<number, SeriesForm>();
  for (const [playerNo, finishes] of map) {
    const sorted = [...finishes].sort((a, b) => a.raceNo - b.raceNo);
    const starts = sorted.length;
    const wins = sorted.filter((f) => f.place === 1).length;
    const top2 = sorted.filter((f) => f.place <= 2).length;
    const top3 = sorted.filter((f) => f.place <= 3).length;
    const avgPlace =
      starts > 0 ? sorted.reduce((s, f) => s + f.place, 0) / starts : null;
    const points = sorted.reduce((s, f) => s + pointsForPlace(f.place), 0);
    const trail = sorted.map((f) => `${f.raceNo}R=${f.place}`).join(" / ");
    const label = starts
      ? `今節${starts}走 平均着${avgPlace?.toFixed(1)}（${trail}）`
      : "今節未出走";
    out.set(playerNo, {
      playerNo,
      finishes: sorted,
      starts,
      wins,
      top2,
      top3,
      avgPlace,
      points,
      label,
    });
  }
  return out;
}

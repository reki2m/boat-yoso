type TrifectaPay = Record<string, number>;

export type RaceResultView = {
  stadium: number;
  race: number;
  trifecta: TrifectaPay;
  /** 1着-2着-3着 の艇番コンボ（枠順ではなく着順の艇番） */
  finishCombo: string | null;
};

type CacheEntry = { at: number; byKey: Map<string, RaceResultView> };
const cache = new Map<string, CacheEntry>();
/** 結果は更新が速いので短め。未確定スタブで長時間止めない */
const CACHE_MS = 20_000;

function keyOf(stadium: number, race: number): string {
  return `${stadium}-${race}`;
}

function isComplete(view: RaceResultView | undefined): boolean {
  if (!view) return false;
  return Boolean(view.finishCombo) || Object.keys(view.trifecta).length > 0;
}

function trifectaFromPayouts(payouts: unknown): TrifectaPay {
  const tri: TrifectaPay = {};
  const list =
    (payouts as { trifecta?: Array<{ combination?: string; amount?: number }> } | undefined)
      ?.trifecta || [];
  for (const x of list) {
    if (x.combination && x.amount != null) tri[String(x.combination)] = Number(x.amount);
  }
  return tri;
}

function finishComboFromBoats(boats: Array<Record<string, unknown>>): string | null {
  const ranked = boats
    .map((b) => ({
      place: Number(b.racer_place_number ?? b.place_number ?? 0),
      boat: Number(b.racer_boat_number ?? b.entry_number ?? b.boat_number ?? 0),
    }))
    .filter((b) => b.place >= 1 && b.place <= 3 && b.boat >= 1 && b.boat <= 6)
    .sort((a, b) => a.place - b.place);
  if (ranked.length < 3) return null;
  return `${ranked[0].boat}-${ranked[1].boat}-${ranked[2].boat}`;
}

function finishComboFromRacers(
  racers: Record<string, Record<string, unknown>> | undefined,
): string | null {
  if (!racers || typeof racers !== "object") return null;
  const ranked = Object.values(racers)
    .map((r) => ({
      place: Number(r.place_number ?? r.racer_place_number ?? 0),
      boat: Number(r.entry_number ?? r.racer_boat_number ?? r.boat_number ?? 0),
    }))
    .filter((b) => b.place >= 1 && b.place <= 3 && b.boat >= 1 && b.boat <= 6)
    .sort((a, b) => a.place - b.place);
  if (ranked.length < 3) return null;
  return `${ranked[0].boat}-${ranked[1].boat}-${ranked[2].boat}`;
}

function mergeResult(
  into: Map<string, RaceResultView>,
  next: RaceResultView,
): void {
  const key = keyOf(next.stadium, next.race);
  const prev = into.get(key);
  if (!prev) {
    into.set(key, next);
    return;
  }
  // 完全な結果を優先。スタブ（着順・払戻なし）で上書きしない
  if (isComplete(next) && !isComplete(prev)) {
    into.set(key, next);
    return;
  }
  if (!isComplete(next) && isComplete(prev)) return;
  into.set(key, {
    stadium: next.stadium,
    race: next.race,
    trifecta: Object.keys(next.trifecta).length ? next.trifecta : prev.trifecta,
    finishCombo: next.finishCombo || prev.finishCombo,
  });
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** programs API（鮮度が高い。結果は race.result に入る） */
async function loadFromProgramsApi(dateKey: string): Promise<Map<string, RaceResultView>> {
  const year = dateKey.slice(0, 4);
  const urls = [
    `https://boatraceopenapi.github.io/api/v1/${year}/${dateKey}.json`,
    "https://boatraceopenapi.github.io/api/v1/today.json",
  ];
  const byKey = new Map<string, RaceResultView>();
  for (const url of urls) {
    const data = (await fetchJson(url)) as {
      programs?: {
        stadiums?: Record<
          string,
          {
            races?: Record<
              string,
              {
                result?: {
                  stadium_number?: number;
                  race_number?: number;
                  racers?: Record<string, Record<string, unknown>>;
                  payouts?: unknown;
                } | null;
              }
            >;
          }
        >;
      };
    } | null;
    if (!data?.programs?.stadiums) continue;
    for (const [stadiumKey, stadium] of Object.entries(data.programs.stadiums)) {
      const stadiumNum = Number(stadiumKey);
      if (!stadiumNum) continue;
      for (const [raceKeyStr, race] of Object.entries(stadium.races || {})) {
        const raceNum = Number(raceKeyStr);
        const result = race?.result;
        if (!raceNum || !result) continue;
        const trifecta = trifectaFromPayouts(result.payouts);
        const finishCombo = finishComboFromRacers(result.racers);
        if (!finishCombo && !Object.keys(trifecta).length) continue;
        mergeResult(byKey, {
          stadium: Number(result.stadium_number || stadiumNum),
          race: Number(result.race_number || raceNum),
          trifecta,
          finishCombo,
        });
      }
    }
    // dated URL で十分取れたら today は不要
    if (byKey.size && url.includes(`/${dateKey}.json`)) break;
  }
  return byKey;
}

/** results/v3（日次まとめ。更新が遅れスタブだけのことがある） */
async function loadFromResultsV3(dateKey: string): Promise<Map<string, RaceResultView>> {
  const year = dateKey.slice(0, 4);
  const url = `https://boatraceopenapi.github.io/results/v3/${year}/${dateKey}.json`;
  const byKey = new Map<string, RaceResultView>();
  const data = (await fetchJson(url)) as {
    results?: Array<Record<string, unknown>>;
  } | null;
  if (!data?.results) return byKey;
  for (const r of data.results) {
    const stadium = Number(r.stadium_number || 0);
    const race = Number(r.number || 0);
    if (!stadium || !race) continue;
    const trifecta = trifectaFromPayouts(r.payouts);
    const finishCombo = finishComboFromBoats((r.boats as Array<Record<string, unknown>>) || []);
    // 着順も払戻も無いスタブは入れない（展示待ちのまま止まる原因になる）
    if (!finishCombo && !Object.keys(trifecta).length) continue;
    mergeResult(byKey, { stadium, race, trifecta, finishCombo });
  }
  return byKey;
}

export async function fetchDayResults(dateKey: string): Promise<Map<string, RaceResultView>> {
  const hit = cache.get(dateKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.byKey;

  const byKey = new Map<string, RaceResultView>();
  // 鮮度優先: programs API → results/v3
  const [fromPrograms, fromV3] = await Promise.all([
    loadFromProgramsApi(dateKey),
    loadFromResultsV3(dateKey),
  ]);
  for (const view of fromV3.values()) mergeResult(byKey, view);
  for (const view of fromPrograms.values()) mergeResult(byKey, view);

  cache.set(dateKey, { at: Date.now(), byKey });
  return byKey;
}

export function resultKey(stadium: number, race: number): string {
  return keyOf(stadium, race);
}

/** 結果として扱えるか（着順 or 3連単払戻がある） */
export function hasRaceResult(view: RaceResultView | undefined): boolean {
  return isComplete(view);
}

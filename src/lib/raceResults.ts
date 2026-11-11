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
const CACHE_MS = 60_000;

function keyOf(stadium: number, race: number): string {
  return `${stadium}-${race}`;
}

function finishComboFromBoats(boats: Array<Record<string, unknown>>): string | null {
  const ranked = boats
    .map((b) => ({
      place: Number(b.racer_place_number || 0),
      boat: Number(b.racer_boat_number || 0),
    }))
    .filter((b) => b.place >= 1 && b.place <= 3 && b.boat >= 1 && b.boat <= 6)
    .sort((a, b) => a.place - b.place);
  if (ranked.length < 3) return null;
  return `${ranked[0].boat}-${ranked[1].boat}-${ranked[2].boat}`;
}

export async function fetchDayResults(dateKey: string): Promise<Map<string, RaceResultView>> {
  const hit = cache.get(dateKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.byKey;

  const year = dateKey.slice(0, 4);
  const url = `https://boatraceopenapi.github.io/results/v3/${year}/${dateKey}.json`;
  const byKey = new Map<string, RaceResultView>();
  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) {
      cache.set(dateKey, { at: Date.now(), byKey });
      return byKey;
    }
    const data = (await res.json()) as {
      results?: Array<Record<string, unknown>>;
    };
    for (const r of data.results || []) {
      const stadium = Number(r.stadium_number || 0);
      const race = Number(r.number || 0);
      if (!stadium || !race) continue;
      const tri: TrifectaPay = {};
      for (const x of ((r.payouts as { trifecta?: Array<{ combination?: string; amount?: number }> } | undefined)?.trifecta) || []) {
        if (x.combination && x.amount != null) tri[String(x.combination)] = Number(x.amount);
      }
      byKey.set(keyOf(stadium, race), {
        stadium,
        race,
        trifecta: tri,
        finishCombo: finishComboFromBoats((r.boats as Array<Record<string, unknown>>) || []),
      });
    }
  } catch {
    // keep empty
  }
  cache.set(dateKey, { at: Date.now(), byKey });
  return byKey;
}

export function resultKey(stadium: number, race: number): string {
  return keyOf(stadium, race);
}

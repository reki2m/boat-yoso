import { flattenTrifectaTree, type TrifectaOddsMap } from "./oddsAnomaly";

type CacheEntry = { at: number; odds: TrifectaOddsMap; source: string };
const cache = new Map<string, CacheEntry>();
const CACHE_MS = 60 * 1000;

/**
 * OpenAPI today / 日付別 programs から3連単オッズを取得。
 * 失敗時は空マップ（異常検知側で odds_missing 扱い）。
 */
export async function fetchTrifectaOdds(
  placeNo: number,
  raceNo: number,
  dateKey: string,
): Promise<{ odds: TrifectaOddsMap; source: string }> {
  const key = `${dateKey}:${placeNo}:${raceNo}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return { odds: hit.odds, source: hit.source };
  }

  const yyyy = dateKey.slice(0, 4);
  const mm = dateKey.slice(4, 6);
  const dd = dateKey.slice(6, 8);
  const iso = `${yyyy}-${mm}-${dd}`;
  const urls = [
    `https://boatraceopenapi.github.io/chronology/v2/${iso}.json`,
    `https://boatraceopenapi.github.io/api/v2/${iso}.json`,
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
                  odds?: {
                    trifecta?: Record<
                      string,
                      Record<string, Record<string, number | null>>
                    >;
                  };
                }
              >;
            }
          >;
        };
      };
      const race =
        data.programs?.stadiums?.[String(placeNo)]?.races?.[String(raceNo)];
      const tree = race?.odds?.trifecta;
      const odds = flattenTrifectaTree(tree);
      if (Object.keys(odds).length) {
        cache.set(key, { at: Date.now(), odds, source: url });
        return { odds, source: url };
      }
    } catch {
      // try next
    }
  }

  cache.set(key, { at: Date.now(), odds: {}, source: "unavailable" });
  return { odds: {}, source: "unavailable" };
}

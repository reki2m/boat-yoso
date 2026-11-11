import { STADIUMS } from "@/lib/stadiums";

export type RaceChatQuery = {
  placeNo: number;
  placeName: string;
  raceNo: number;
  raw: string;
};

const ALIASES: Record<string, number> = {
  びわ湖: 11,
  琵琶湖: 11,
  びわこ: 11,
  住之江: 12,
  すみのえ: 12,
  尼崎: 13,
  あまがさき: 13,
  丸亀: 15,
  まるがめ: 15,
  宮島: 17,
  みやじま: 17,
  徳山: 18,
  とくやま: 18,
  下関: 19,
  しものせき: 19,
  若松: 20,
  わかまつ: 20,
  芦屋: 21,
  あしや: 21,
  唐津: 23,
  からつ: 23,
  大村: 24,
  おおむら: 24,
};

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[ー−–—]/g, "-");
}

function resolvePlace(token: string): { placeNo: number; placeName: string } | null {
  const hitAlias = ALIASES[token];
  if (hitAlias) {
    return { placeNo: hitAlias, placeName: STADIUMS[hitAlias] };
  }
  for (const [no, name] of Object.entries(STADIUMS)) {
    if (name === token) {
      return { placeNo: Number(no), placeName: name };
    }
  }
  return null;
}

/**
 * 「徳山1R」「徳山 12R」「下関11レース」などを検出。
 * 一文に複数ある場合は最初の1件。
 */
export function parseRaceChatQuery(text: string): RaceChatQuery | null {
  const src = normalize(text);
  if (!src) return null;

  const names = [
    ...Object.keys(ALIASES),
    ...Object.values(STADIUMS),
  ].sort((a, b) => b.length - a.length);

  for (const name of names) {
    const idx = src.indexOf(name);
    if (idx < 0) continue;
    const rest = src.slice(idx + name.length);
    // 10-12 を先にマッチ（そうしないと 1 だけ取ってしまう）
    const m = rest.match(/^(1[0-2]|[1-9])(?:R|ｒ|レース|レー[スす])?/i);
    if (!m) continue;
    const place = resolvePlace(name);
    if (!place) continue;
    const raceNo = Number(m[1]);
    if (!Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12) continue;
    return {
      placeNo: place.placeNo,
      placeName: place.placeName,
      raceNo,
      raw: `${place.placeName}${raceNo}R`,
    };
  }
  return null;
}

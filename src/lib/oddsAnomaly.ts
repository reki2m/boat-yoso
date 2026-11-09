export type TrifectaOddsMap = Record<string, number>;

export type OddsAnomaly = {
  ok: boolean;
  favorite: string | null;
  favOdds: number | null;
  overbet: boolean;
  moneyConcentrate: boolean;
  top3ShareProxy: number;
  advice: string;
  flags: string[];
};

/**
 * 異常オッズ検知:
 * - 買われすぎ: 1番人気が異常に短い
 * - 大口集中: 上位候補の implied-prob 占有率が高い
 */
export function detectOddsAnomaly(tri: TrifectaOddsMap): OddsAnomaly {
  const ranked = Object.entries(tri)
    .filter(([, odds]) => Number.isFinite(odds) && odds > 0)
    .sort((a, b) => a[1] - b[1]);

  if (!ranked.length) {
    return {
      ok: false,
      favorite: null,
      favOdds: null,
      overbet: true,
      moneyConcentrate: true,
      top3ShareProxy: 1,
      advice: "オッズ未取得のため異常判定を保留。イン戦本命は見送り推奨。",
      flags: ["odds_missing"],
    };
  }

  const [favorite, favOdds] = ranked[0];
  const inv = ranked.slice(0, 30).map(([k, v]) => [k, 1 / v] as const);
  const sum = inv.reduce((s, [, v]) => s + v, 0) || 1;
  const top3Share = inv.slice(0, 3).reduce((s, [, v]) => s + v, 0) / sum;
  const overbet = favOdds < 6;
  const moneyConcentrate = top3Share > 0.55;
  const flags: string[] = [];
  if (overbet) flags.push("overbet");
  if (moneyConcentrate) flags.push("money_concentrate");

  let advice = "オッズは妥当帯。本命の検討可。";
  if (overbet && moneyConcentrate) {
    advice = "買われすぎ＋大口集中。本命は見送り。";
  } else if (overbet) {
    advice = "1番人気が異常に短い。本命は見送り。";
  } else if (moneyConcentrate) {
    advice = "上位に資金集中。本命は慎重に、値がない人気目は避ける。";
  }

  return {
    ok: !(overbet || moneyConcentrate),
    favorite,
    favOdds,
    overbet,
    moneyConcentrate,
    top3ShareProxy: Math.round(top3Share * 1000) / 1000,
    advice,
    flags,
  };
}

export function filterTicketsByOddsBand(
  tickets: string[],
  tri: TrifectaOddsMap,
  lo: number,
  hi: number,
): string[] {
  return tickets.filter((t) => {
    const odds = tri[t];
    if (!Number.isFinite(odds)) return false;
    return odds >= lo && odds <= hi;
  });
}

export function flattenTrifectaTree(
  tree: Record<string, Record<string, Record<string, number | null>>> | undefined,
): TrifectaOddsMap {
  const out: TrifectaOddsMap = {};
  if (!tree) return out;
  for (const [a, m2] of Object.entries(tree)) {
    for (const [b, m3] of Object.entries(m2 ?? {})) {
      for (const [c, odds] of Object.entries(m3 ?? {})) {
        if (odds == null || !Number.isFinite(odds)) continue;
        out[`${a}-${b}-${c}`] = Number(odds);
      }
    }
  }
  return out;
}

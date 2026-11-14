import { sql } from "@/lib/db";
import { fetchDayResults, hasRaceResult, resultKey } from "@/lib/raceResults";
import { STADIUMS } from "@/lib/stadiums";

const STAKE_PER_TICKET = 100;

export type ChatUserStat = {
  owner_session_id: string;
  owner_name: string;
  settledRaces: number;
  hitRaces: number;
  /** 的中率 %（レース単位: 1点以上的中 / 精算済レース） */
  hitRatePct: number | null;
  ticketCount: number;
  hitTickets: number;
  stakeYen: number;
  payoutYen: number;
  /** 回収率 % */
  recoveryPct: number | null;
};

type Row = {
  id: string;
  meta: Record<string, unknown> | string | null;
};

function parseMeta(meta: Row["meta"]): Record<string, unknown> {
  if (!meta) return {};
  if (typeof meta === "string") {
    try {
      return JSON.parse(meta) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return meta;
}

function pct(num: number, den: number): number | null {
  if (den <= 0) return null;
  return Math.round((num / den) * 1000) / 10;
}

/**
 * 購入 Yes した AI予想の通算 的中率・回収率。
 * ownerSessionId 指定時はそのユーザーのみ。
 */
export async function computePurchaseUserStats(opts?: {
  ownerSessionId?: string;
}): Promise<ChatUserStat[]> {
  const rows = await sql<Row>(
    `select id, meta
     from chat_messages
     where coalesce(meta->>'mode','') = 'app_race_pick'
       and coalesce(meta->>'purchaseDecision','') = 'yes'
     order by created_at asc
     limit 500`,
  ).catch(() => []);

  type Draft = {
    owner_session_id: string;
    owner_name: string;
    date: string;
    placeNo: number;
    raceNo: number;
    tickets: string[];
  };

  const draft: Draft[] = [];
  for (const row of rows) {
    const meta = parseMeta(row.meta);
    const owner_session_id = String(meta.owner_session_id || "");
    if (!owner_session_id) continue;
    if (opts?.ownerSessionId && owner_session_id !== opts.ownerSessionId) continue;
    const date = String(meta.date || "");
    const placeNo = Number(meta.placeNo || 0);
    const raceNo = Number(meta.raceNo || 0);
    if (!/^\d{8}$/.test(date) || !placeNo || !raceNo) continue;
    const tickets = Array.isArray(meta.tickets) ? meta.tickets.map(String) : [];
    if (!tickets.length) continue;
    draft.push({
      owner_session_id,
      owner_name: String(meta.owner_name || "メンバー"),
      date,
      placeNo,
      raceNo,
      tickets,
    });
  }

  const dates = [...new Set(draft.map((d) => d.date))];
  const resultsByDate = new Map<string, Awaited<ReturnType<typeof fetchDayResults>>>();
  await Promise.all(
    dates.map(async (date) => {
      resultsByDate.set(date, await fetchDayResults(date));
    }),
  );

  const byOwner = new Map<
    string,
    {
      owner_name: string;
      settledRaces: number;
      hitRaces: number;
      ticketCount: number;
      hitTickets: number;
      stakeYen: number;
      payoutYen: number;
    }
  >();

  for (const d of draft) {
    const day = resultsByDate.get(d.date);
    const res = day?.get(resultKey(d.placeNo, d.raceNo));
    if (!res || !hasRaceResult(res)) continue;
    const stakeYen = STAKE_PER_TICKET * d.tickets.length;
    const hitTickets = d.tickets.filter((t) => (res.trifecta[t] || 0) > 0);
    const payoutYen = d.tickets.reduce((s, t) => s + (res.trifecta[t] || 0), 0);
    const cur = byOwner.get(d.owner_session_id) || {
      owner_name: d.owner_name,
      settledRaces: 0,
      hitRaces: 0,
      ticketCount: 0,
      hitTickets: 0,
      stakeYen: 0,
      payoutYen: 0,
    };
    cur.owner_name = d.owner_name || cur.owner_name;
    cur.settledRaces += 1;
    if (hitTickets.length) cur.hitRaces += 1;
    cur.ticketCount += d.tickets.length;
    cur.hitTickets += hitTickets.length;
    cur.stakeYen += stakeYen;
    cur.payoutYen += payoutYen;
    byOwner.set(d.owner_session_id, cur);
  }

  return [...byOwner.entries()]
    .map(([owner_session_id, v]) => ({
      owner_session_id,
      owner_name: v.owner_name,
      settledRaces: v.settledRaces,
      hitRaces: v.hitRaces,
      hitRatePct: pct(v.hitRaces, v.settledRaces),
      ticketCount: v.ticketCount,
      hitTickets: v.hitTickets,
      stakeYen: v.stakeYen,
      payoutYen: v.payoutYen,
      recoveryPct: pct(v.payoutYen, v.stakeYen),
    }))
    .sort((a, b) => a.owner_name.localeCompare(b.owner_name, "ja"));
}

export function formatUserStatsDiscordLine(stat: ChatUserStat): string {
  const hit =
    stat.hitRatePct == null
      ? "的中率 —"
      : `的中率 ${stat.hitRaces}/${stat.settledRaces}（${stat.hitRatePct.toFixed(1)}%）`;
  const rec =
    stat.recoveryPct == null
      ? "回収率 —"
      : `回収率 ${stat.recoveryPct.toFixed(1)}%（払戻¥${stat.payoutYen.toLocaleString("ja-JP")} / 投資¥${stat.stakeYen.toLocaleString("ja-JP")}）`;
  const name = String(stat.owner_name || "メンバー").replace(/\s+/g, " ").trim().slice(0, 20) || "メンバー";
  return `【${name} 通算】${hit} / ${rec}`;
}

/** 全ユーザー分の通算サマリー（Discord用） */
export function formatAllUserStatsDiscord(stats: ChatUserStat[]): string {
  if (!stats.length) return "【通算】購入確定の精算データがまだありません。";
  return ["【ユーザー通算 的中率・回収率】", ...stats.map(formatUserStatsDiscordLine)].join(
    "\n",
  );
}

/** 場名付きラベル（デバッグ・表示用） */
export function placeRaceLabel(placeNo: number, raceNo: number): string {
  return `${STADIUMS[placeNo] || `場${placeNo}`}${raceNo}レース`;
}

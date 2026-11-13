import { sql } from "@/lib/db";
import { fetchDayResults, hasRaceResult, resultKey } from "@/lib/raceResults";
import { STADIUMS } from "@/lib/stadiums";

const STAKE_PER_TICKET = 100;

export type AdminPredictionPick = {
  message_id: string;
  created_at: string;
  owner_name: string;
  date: string;
  placeNo: number;
  placeName: string;
  raceNo: number;
  tickets: string[];
  /** 管理人クリック閲覧用のアプリ予想本文 */
  body: string;
  label: string;
  result: {
    settled: boolean;
    finishCombo: string | null;
    hitTickets: string[];
    stakeYen: number;
    payoutYen: number;
    recoveryPct: number | null;
  };
};

export type AdminOwnerGroup = {
  owner_name: string;
  pickCount: number;
  settledCount: number;
  stakeYen: number;
  payoutYen: number;
  recoveryPct: number | null;
  picks: AdminPredictionPick[];
};

export type AdminPredictionOversight = {
  stake_per_ticket: number;
  totals: {
    pickCount: number;
    settledCount: number;
    stakeYen: number;
    payoutYen: number;
    recoveryPct: number | null;
  };
  owners: AdminOwnerGroup[];
  picks: AdminPredictionPick[];
};

type Row = {
  id: string;
  created_at: string | Date;
  body: string;
  meta: Record<string, unknown> | string | null;
};

function asIso(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

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

function joinKey(ownerSessionId: string, date: string, placeNo: number, raceNo: number): string {
  return `${ownerSessionId}|${date}|${placeNo}|${raceNo}`;
}

function recoveryPct(stakeYen: number, payoutYen: number): number | null {
  if (stakeYen <= 0) return null;
  return Math.round((payoutYen / stakeYen) * 1000) / 10;
}

async function loadPrivateBodiesByKey(): Promise<Map<string, string>> {
  const rows = await sql<Row>(
    `select id, created_at, body, meta
     from chat_messages
     where coalesce(meta->>'visibility','public') = 'private'
       and coalesce(meta->>'mode','') = 'app_race_pick'
     order by created_at desc
     limit 400`,
  ).catch(() => []);
  const map = new Map<string, string>();
  for (const row of rows) {
    const meta = parseMeta(row.meta);
    const owner = String(meta.owner_session_id || "");
    const date = String(meta.date || "");
    const placeNo = Number(meta.placeNo || 0);
    const raceNo = Number(meta.raceNo || 0);
    if (!owner || !date || !placeNo || !raceNo) continue;
    const key = joinKey(owner, date, placeNo, raceNo);
    if (!map.has(key)) map.set(key, row.body || "");
  }
  return map;
}

/**
 * 管理人専用: 入室メンバーが開いたアプリ予想を一覧し、クリック閲覧用本文と回収率を付与。
 * owner_session_id はクライアントへ返さない。
 */
export async function listAdminPredictionOversight(): Promise<AdminPredictionOversight> {
  const empty: AdminPredictionOversight = {
    stake_per_ticket: STAKE_PER_TICKET,
    totals: {
      pickCount: 0,
      settledCount: 0,
      stakeYen: 0,
      payoutYen: 0,
      recoveryPct: null,
    },
    owners: [],
    picks: [],
  };

  try {
    const [logRows, privateBodies] = await Promise.all([
      sql<Row>(
        `select id, created_at, body, meta
         from chat_messages
         where coalesce(meta->>'visibility','public') = 'admin'
           and coalesce(meta->>'mode','') = 'admin_predict_log'
         order by created_at desc
         limit 200`,
      ),
      loadPrivateBodiesByKey(),
    ]);

    const draft: Array<{
      message_id: string;
      created_at: string;
      owner_name: string;
      owner_session_id: string;
      date: string;
      placeNo: number;
      placeName: string;
      raceNo: number;
      tickets: string[];
      body: string;
      label: string;
    }> = [];

    for (const row of logRows) {
      const meta = parseMeta(row.meta);
      const placeNo = Number(meta.placeNo || 0);
      const raceNo = Number(meta.raceNo || 0);
      const date = String(meta.date || "");
      if (!placeNo || !raceNo || !/^\d{8}$/.test(date)) continue;
      const owner_session_id = String(meta.owner_session_id || "");
      const tickets = Array.isArray(meta.tickets)
        ? meta.tickets.map(String)
        : [];
      const placeName = STADIUMS[placeNo] || `場${placeNo}`;
      const body =
        privateBodies.get(joinKey(owner_session_id, date, placeNo, raceNo)) ||
        row.body ||
        "";
      draft.push({
        message_id: row.id,
        created_at: asIso(row.created_at),
        owner_name: String(meta.owner_name || "名無し"),
        owner_session_id,
        date,
        placeNo,
        placeName,
        raceNo,
        tickets,
        body,
        label: `${placeName} ${raceNo}R`,
      });
    }

    const dates = [...new Set(draft.map((d) => d.date))];
    const resultsByDate = new Map<string, Awaited<ReturnType<typeof fetchDayResults>>>();
    await Promise.all(
      dates.map(async (date) => {
        resultsByDate.set(date, await fetchDayResults(date));
      }),
    );

    const picks: AdminPredictionPick[] = draft.map((d) => {
      const day = resultsByDate.get(d.date);
      const res = day?.get(resultKey(d.placeNo, d.raceNo));
      const stakeYen = STAKE_PER_TICKET * Math.max(d.tickets.length, 0);
      if (!hasRaceResult(res)) {
        return {
          message_id: d.message_id,
          created_at: d.created_at,
          owner_name: d.owner_name,
          date: d.date,
          placeNo: d.placeNo,
          placeName: d.placeName,
          raceNo: d.raceNo,
          tickets: d.tickets,
          body: d.body,
          label: d.label,
          result: {
            settled: false,
            finishCombo: null,
            hitTickets: [],
            stakeYen,
            payoutYen: 0,
            recoveryPct: null,
          },
        };
      }
      const hitTickets = d.tickets.filter((t) => (res.trifecta[t] || 0) > 0);
      const payoutYen = d.tickets.reduce((sum, t) => sum + (res.trifecta[t] || 0), 0);
      return {
        message_id: d.message_id,
        created_at: d.created_at,
        owner_name: d.owner_name,
        date: d.date,
        placeNo: d.placeNo,
        placeName: d.placeName,
        raceNo: d.raceNo,
        tickets: d.tickets,
        body: d.body,
        label: d.label,
        result: {
          settled: true,
          finishCombo: res.finishCombo,
          hitTickets,
          stakeYen,
          payoutYen,
          recoveryPct: recoveryPct(stakeYen, payoutYen),
        },
      };
    });

    const ownerMap = new Map<string, AdminPredictionPick[]>();
    for (const pick of picks) {
      const list = ownerMap.get(pick.owner_name) || [];
      list.push(pick);
      ownerMap.set(pick.owner_name, list);
    }

    const owners: AdminOwnerGroup[] = [...ownerMap.entries()]
      .map(([owner_name, ownerPicks]) => {
        const settled = ownerPicks.filter((p) => p.result.settled);
        const stakeYen = settled.reduce((s, p) => s + p.result.stakeYen, 0);
        const payoutYen = settled.reduce((s, p) => s + p.result.payoutYen, 0);
        return {
          owner_name,
          pickCount: ownerPicks.length,
          settledCount: settled.length,
          stakeYen,
          payoutYen,
          recoveryPct: recoveryPct(stakeYen, payoutYen),
          picks: ownerPicks,
        };
      })
      .sort((a, b) => a.owner_name.localeCompare(b.owner_name, "ja"));

    const settledAll = picks.filter((p) => p.result.settled);
    const stakeYen = settledAll.reduce((s, p) => s + p.result.stakeYen, 0);
    const payoutYen = settledAll.reduce((s, p) => s + p.result.payoutYen, 0);

    return {
      stake_per_ticket: STAKE_PER_TICKET,
      totals: {
        pickCount: picks.length,
        settledCount: settledAll.length,
        stakeYen,
        payoutYen,
        recoveryPct: recoveryPct(stakeYen, payoutYen),
      },
      owners,
      picks,
    };
  } catch {
    return empty;
  }
}

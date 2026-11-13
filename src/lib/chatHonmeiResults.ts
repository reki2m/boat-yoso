import { appendChatMessage } from "@/lib/chatStore";
import {
  alreadyResultPosted,
  markResultPosted,
} from "@/lib/chatHonmeiFlags";
import { generateHonmeiDayBoard } from "@/lib/generateHonmeiDayBoard";
import { loadPicksBoardForDate } from "@/lib/loadPicksBoard";
import { fetchDayResults, resultKey } from "@/lib/raceResults";
import { refreshPicksStatus, type LivePickRow } from "@/lib/refreshPicksStatus";
import { jstDateKey, STADIUMS } from "@/lib/stadiums";

function yen(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}

/**
 * 本命対象レースの結果が出たら、着順と買い目ごとの払戻を1回だけ投稿する。
 * 的中・不的中どちらも出す（スルー対象は出さない）。
 */
export async function maybePostHonmeiRaceResults(now = new Date()): Promise<{
  posted: number;
  dateKey: string;
}> {
  const dateKey = jstDateKey(now);
  const board =
    (await loadPicksBoardForDate(dateKey)) || (await generateHonmeiDayBoard(dateKey));
  const livePicks = await refreshPicksStatus(
    (board.picks || []).map((p) => ({
      date: String(p.date || board.active_date || board.date || dateKey),
      stadium: Number(p.stadium || 0),
      stadium_name: typeof p.stadium_name === "string" ? p.stadium_name : undefined,
      race: Number(p.race || 0),
      tickets: Array.isArray(p.tickets) ? (p.tickets as string[]) : undefined,
      status: typeof p.status === "string" ? p.status : undefined,
      why: typeof p.why === "string" ? p.why : undefined,
      skip_reason: typeof p.skip_reason === "string" ? p.skip_reason : null,
      skip_detail: typeof p.skip_detail === "string" ? p.skip_detail : null,
    })),
  );

  const targets = livePicks.filter((p) => {
    const stadium = Number(p.stadium || 0);
    const race = Number(p.race || 0);
    if (!stadium || !race) return false;
    if (p.status === "skipped") return false;
    return Array.isArray(p.tickets) && p.tickets.length > 0;
  });

  if (!targets.length) return { posted: 0, dateKey };

  const day = await fetchDayResults(dateKey);
  let posted = 0;

  for (const p of targets) {
    const stadium = Number(p.stadium);
    const race = Number(p.race);
    if (await alreadyResultPosted(dateKey, stadium, race)) continue;

    const res = day.get(resultKey(stadium, race));
    if (!res || !res.finishCombo) continue;

    await markResultPosted(dateKey, stadium, race);
    await postOneResult(dateKey, p, res.finishCombo, res.trifecta);
    posted += 1;
  }

  return { posted, dateKey };
}

async function postOneResult(
  dateKey: string,
  pick: LivePickRow,
  finishCombo: string,
  trifecta: Record<string, number>,
): Promise<void> {
  const stadium = Number(pick.stadium);
  const race = Number(pick.race);
  const placeName = pick.stadium_name || STADIUMS[stadium] || `場${stadium}`;
  const tickets = (pick.tickets || []).map(String);
  const rows = tickets.map((combo) => {
    const payout = Number(trifecta[combo] || 0);
    return { combo, payout };
  });
  const hitTotal = rows.reduce((s, r) => s + r.payout, 0);
  const hitCount = rows.filter((r) => r.payout > 0).length;

  const lines = [
    `【結果】${placeName} ${race}R`,
    `着順: ${finishCombo}`,
    "",
    "【買い目と払戻】（100円あたり）",
    ...rows.map((r) =>
      r.payout > 0
        ? `・${r.combo}  的中 払戻 ${yen(r.payout)}`
        : `・${r.combo}  不的中`,
    ),
    "",
    hitCount
      ? `的中 ${hitCount}点 / 合計払戻目安 ${yen(hitTotal)}（各100円購入時）`
      : "的中なし（払戻 0円）",
    "※払戻は公式発表の100円あたり金額です。",
  ];

  await appendChatMessage({
    kind: "note",
    title: hitCount
      ? `結果・的中 ${placeName}${race}R`
      : `結果 ${placeName}${race}R`,
    body: lines.join("\n"),
    author_name: "律丸ボート部",
    author_role: "operator",
    meta: {
      date: dateKey,
      mode: "honmei_result",
      count: hitCount,
      placeNo: stadium,
      raceNo: race,
      tickets,
      visibility: "public",
      races: [
        {
          placeNo: stadium,
          placeName,
          raceNo: race,
          label: `${placeName} ${race}R`,
          tickets,
          status: "confirmed",
          exhibition: "after",
          why: `着順 ${finishCombo} / 払戻合計目安 ${yen(hitTotal)}`,
        },
      ],
    },
  });
}

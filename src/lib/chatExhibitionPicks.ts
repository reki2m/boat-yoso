import { buildPicksMessage } from "@/lib/buildPicksMessage";
import { appendChatMessage } from "@/lib/chatStore";
import {
  alreadyFinalPosted,
  markFinalPosted,
  markWaitingPosted,
} from "@/lib/chatHonmeiFlags";
import { buildRaceChipsFromPicks } from "@/lib/chatRaceUi";
import { generateHonmeiDayBoard } from "@/lib/generateHonmeiDayBoard";
import { loadPicksBoardForDate, type PicksBoardDoc } from "@/lib/loadPicksBoard";
import { refreshPicksStatus, type LivePickRow } from "@/lib/refreshPicksStatus";
import { jstDateKey } from "@/lib/stadiums";

async function resolveTodayBoard(dateKey: string): Promise<PicksBoardDoc> {
  const existing = await loadPicksBoardForDate(dateKey);
  if (existing && Array.isArray(existing.picks)) {
    return existing;
  }
  return generateHonmeiDayBoard(dateKey);
}

function asLiveRows(board: PicksBoardDoc, dateKey: string): LivePickRow[] {
  return (board.picks || []).map((p) => ({
    date: String(p.date || board.active_date || board.date || dateKey),
    stadium: Number(p.stadium || 0),
    stadium_name: typeof p.stadium_name === "string" ? p.stadium_name : undefined,
    race: Number(p.race || 0),
    tickets: Array.isArray(p.tickets) ? (p.tickets as string[]) : undefined,
    status: typeof p.status === "string" ? p.status : "provisional",
    why: typeof p.why === "string" ? p.why : undefined,
    skip_reason: typeof p.skip_reason === "string" ? p.skip_reason : null,
    skip_detail: typeof p.skip_detail === "string" ? p.skip_detail : null,
  }));
}

/**
 * 展示確定後の本命をチャット欄へ投稿する。
 * 確定/スルーはレースごと1回だけ（朝の展示待ちとは別メッセージ）。
 */
export async function maybePostExhibitionHonmeiUpdates(now = new Date()): Promise<{
  posted: number;
  dateKey: string;
}> {
  const dateKey = jstDateKey(now);
  const board = await resolveTodayBoard(dateKey);
  const livePicks = await refreshPicksStatus(asLiveRows(board, dateKey));

  const ready = livePicks.filter((p) => {
    const stadium = Number(p.stadium || 0);
    const race = Number(p.race || 0);
    if (!stadium || !race) return false;
    return p.status === "confirmed" || p.status === "skipped";
  });

  const batch: LivePickRow[] = [];

  for (const p of ready) {
    const stadium = Number(p.stadium || 0);
    const race = Number(p.race || 0);
    if (await alreadyFinalPosted(dateKey, stadium, race)) continue;
    batch.push(p);
  }

  if (!batch.length) {
    return { posted: 0, dateKey };
  }

  // 先にフラグを立てて二重投稿を抑止
  for (const p of batch) {
    const stadium = Number(p.stadium);
    const race = Number(p.race);
    await markFinalPosted(dateKey, stadium, race);
    // 待ち未投稿のまま確定した場合も、待ちの再投稿を防ぐ
    await markWaitingPosted(dateKey, stadium, race);
  }

  const confirmed = batch.filter((p) => p.status === "confirmed");
  const skipped = batch.filter((p) => p.status === "skipped");
  const races = buildRaceChipsFromPicks(batch).map((chip) => ({
    ...chip,
    exhibition: "after" as const,
  }));

  const built = buildPicksMessage({
    active_date: dateKey,
    date: dateKey,
    mode: "exhibition_after_honmei",
    note: "展示後の最終判定です（レースごと1回）。「確定」は買ってOK、「スルー」は買わない判断です。",
    picks: batch,
  });

  const titleParts = ["展示後"];
  if (confirmed.length) titleParts.push(`確定${confirmed.length}`);
  if (skipped.length) titleParts.push(`スルー${skipped.length}`);

  await appendChatMessage({
    kind: "picks",
    title: `${titleParts.join(" · ")} ${dateKey}`,
    body: built.body,
    author_name: "律丸ボート部",
    author_role: "operator",
    meta: {
      date: dateKey,
      mode: "exhibition_after_honmei",
      count: confirmed.length,
      visibility: "public",
      races,
    },
  });

  return { posted: batch.length, dateKey };
}

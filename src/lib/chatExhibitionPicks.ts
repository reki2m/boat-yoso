import { buildPicksMessage } from "@/lib/buildPicksMessage";
import { appendChatMessage } from "@/lib/chatStore";
import { buildRaceChipsFromPicks } from "@/lib/chatRaceUi";
import { sql } from "@/lib/db";
import { generateHonmeiDayBoard } from "@/lib/generateHonmeiDayBoard";
import { loadPicksBoardForDate, type PicksBoardDoc } from "@/lib/loadPicksBoard";
import { refreshPicksStatus, type LivePickRow } from "@/lib/refreshPicksStatus";
import { jstDateKey } from "@/lib/stadiums";

async function alreadyPosted(flag: string): Promise<boolean> {
  try {
    const rows = await sql<{ value: string }>(
      `select value from chat_meta where key = $1 limit 1`,
      [flag],
    );
    return Boolean(rows[0]?.value);
  } catch {
    return false;
  }
}

async function markPosted(flag: string): Promise<void> {
  await sql(
    `insert into chat_meta (key, value, updated_at)
     values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [flag, "1"],
  );
}

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

function postFlag(dateKey: string, stadium: number, race: number): string {
  return `exhibition_chat_posted:${dateKey}:${stadium}:${race}`;
}

/**
 * 展示確定後の本命をチャット欄へ「〇〇場 〇〇R」UI付きで投稿する。
 * 朝の展示待ち投稿とは別に、確定（または進入変更スキップ）になったレースだけ1回ずつ出す。
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

  let posted = 0;
  const batch: LivePickRow[] = [];

  for (const p of ready) {
    const stadium = Number(p.stadium || 0);
    const race = Number(p.race || 0);
    const flag = postFlag(dateKey, stadium, race);
    if (await alreadyPosted(flag)) continue;
    batch.push(p);
  }

  if (!batch.length) {
    return { posted: 0, dateKey };
  }

  // 先にフラグを立てて二重投稿を抑止
  for (const p of batch) {
    await markPosted(postFlag(dateKey, Number(p.stadium), Number(p.race)));
  }

  const confirmed = batch.filter((p) => p.status === "confirmed");
  const skipped = batch.filter((p) => p.status === "skipped");
  const races = buildRaceChipsFromPicks(batch).map((chip) => ({
    ...chip,
    exhibition:
      chip.status === "confirmed" ? ("after" as const) : chip.exhibition || ("unknown" as const),
  }));

  const built = buildPicksMessage({
    active_date: dateKey,
    date: dateKey,
    mode: "exhibition_after_honmei",
    note: "展示後の再判定です。進入変更などで見送りになったレースも含みます。",
    picks: batch,
  });

  const titleParts = ["展示後予想"];
  if (confirmed.length) titleParts.push(`確定${confirmed.length}`);
  if (skipped.length) titleParts.push(`見送り${skipped.length}`);

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

  posted = batch.length;
  return { posted, dateKey };
}

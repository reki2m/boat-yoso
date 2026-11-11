import {
  appendChatMessage,
  readAllChatMessagesForJobs,
  type ChatMessage,
} from "@/lib/chatStore";
import { sql } from "@/lib/db";
import { fetchDayResults, resultKey } from "@/lib/raceResults";
import { STADIUMS } from "@/lib/stadiums";

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

function ticketsFromMessage(m: ChatMessage): string[] {
  const meta = m.meta as { tickets?: string[] } | undefined;
  if (Array.isArray(meta?.tickets) && meta.tickets.length) {
    return meta.tickets.map(String);
  }
  // 本文から 1-2-3 形式を拾う（互換）
  const found = m.body.match(/\b[1-6]-[1-6]-[1-6]\b/g) || [];
  return [...new Set(found)];
}

function raceMeta(m: ChatMessage): { date: string; stadium: number; race: number } | null {
  const meta = m.meta as {
    date?: string;
    placeNo?: number;
    stadium?: number;
    raceNo?: number;
    race?: number;
    mode?: string;
  } | undefined;
  if (
    meta?.mode !== "chat_race_reply" &&
    meta?.mode !== "private_race_pick" &&
    meta?.mode !== "app_race_pick"
  ) {
    return null;
  }
  const date = String(meta.date || "");
  const stadium = Number(meta.placeNo || meta.stadium || 0);
  const race = Number(meta.raceNo || meta.race || 0);
  if (!/^\d{8}$/.test(date) || !stadium || !race) return null;
  return { date, stadium, race };
}

function yen(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}

/**
 * チャット予想メッセージを結果照合し、的中時に 的中🎯 と払戻を投稿する。
 */
export async function settleChatPredictionHits(): Promise<number> {
  // アプリ予想（依頼者 private）も含めて精算する
  const messages = await readAllChatMessagesForJobs();
  let posted = 0;

  for (const m of messages) {
    const info = raceMeta(m);
    if (!info) continue;
    const flag = `hit_posted:${info.date}:${info.stadium}:${info.race}:${m.id}`;
    if (await alreadyPosted(flag)) continue;

    const day = await fetchDayResults(info.date);
    const res = day.get(resultKey(info.stadium, info.race));
    if (!res) continue;

    const tickets = ticketsFromMessage(m);
    const hits = tickets
      .map((t) => ({ combo: t, payout: res.trifecta[t] || 0 }))
      .filter((x) => x.payout > 0);

    await markPosted(flag);
    if (!hits.length) continue;

    const placeName = STADIUMS[info.stadium] || `場${info.stadium}`;
    const lines = [
      `的中🎯 ${placeName}${info.race}R`,
      `結果: ${res.finishCombo || "—"}`,
      ...hits.map((h) => `・予想 ${h.combo}  払戻 ${yen(h.payout)}（100円あたり）`),
      `合計払戻目安 ${yen(hits.reduce((s, h) => s + h.payout, 0))}（各100円購入時）`,
      "※払戻は公式発表の100円あたり金額です。",
    ];
    const privateHit = m.meta?.visibility === "private";
    await appendChatMessage({
      kind: "note",
      title: `的中🎯 ${placeName}${info.race}R`,
      body: lines.join("\n"),
      author_name: "律丸ボート部",
      author_role: "operator",
      meta: {
        date: info.date,
        mode: "chat_hit",
        count: hits.length,
        placeNo: info.stadium,
        raceNo: info.race,
        ...(privateHit
          ? {
              // 的中通知も依頼者本人だけ（管理人チャットは別ログ）
              visibility: "private" as const,
              owner_session_id: m.meta?.owner_session_id,
              owner_name: m.meta?.owner_name,
            }
          : { visibility: "public" as const }),
      },
    });
    posted += 1;
  }

  return posted;
}

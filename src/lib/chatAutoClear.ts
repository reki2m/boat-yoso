import picksBoard from "@/data/picks_board.json";
import {
  appendChatMessage,
  clearChatMessages,
} from "@/lib/chatStore";
import { sql } from "@/lib/db";
import { jstDateKey } from "@/lib/stadiums";

async function getMeta(key: string): Promise<string | null> {
  try {
    const rows = await sql<{ value: string }>(
      `select value from chat_meta where key = $1 limit 1`,
      [key],
    );
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

async function setMeta(key: string, value: string): Promise<void> {
  await sql(
    `insert into chat_meta (key, value, updated_at)
     values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, value],
  );
}

/** その日の最終締切目安（JST）。picks_board の closed_at 最大、なければ 21:00 JST。 */
function estimateRaceDayEndMs(dateKey: string): number {
  const board = picksBoard as {
    active_date?: string;
    date?: string;
    picks?: Array<{ date?: string; closed_at?: string | null }>;
  };
  const picks = (board.picks || []).filter(
    (p) => String(p.date || board.active_date || board.date || "") === dateKey,
  );
  let maxMs = 0;
  for (const p of picks) {
    if (!p.closed_at) continue;
    const t = Date.parse(String(p.closed_at).replace(" ", "T") + "+09:00");
    if (Number.isFinite(t)) maxMs = Math.max(maxMs, t);
  }
  if (maxMs > 0) return maxMs;
  // フォールバック: その日 21:00 JST
  const y = Number(dateKey.slice(0, 4));
  const m = Number(dateKey.slice(4, 6));
  const d = Number(dateKey.slice(6, 8));
  return Date.parse(
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T21:00:00+09:00`,
  );
}

function previousDateKey(dateKey: string): string {
  const y = Number(dateKey.slice(0, 4));
  const m = Number(dateKey.slice(4, 6));
  const d = Number(dateKey.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

/**
 * レース終了目安の1時間後に履歴を自動全削除。
 * GET/POST のたびに軽く確認する。
 */
export async function maybeAutoClearChat(now = new Date()): Promise<{
  cleared: boolean;
  deleted: number;
  forDate: string | null;
}> {
  const today = jstDateKey(now);
  const candidates = [today, previousDateKey(today)];

  for (const dateKey of candidates) {
    const endMs = estimateRaceDayEndMs(dateKey);
    if (!Number.isFinite(endMs)) continue;
    const clearAt = endMs + 60 * 60 * 1000;
    if (now.getTime() < clearAt) continue;

    const already = await getMeta("auto_cleared_for");
    if (already === dateKey) continue;

    const deleted = await clearChatMessages();
    await setMeta("auto_cleared_for", dateKey);
    await appendChatMessage({
      kind: "note",
      title: "自動消去",
      body: `${dateKey} のレース終了から1時間経過したため、チャット履歴を自動消去しました。`,
      author_name: "システム",
      author_role: "operator",
      meta: { date: dateKey, mode: "auto_clear" },
    });
    return { cleared: true, deleted, forDate: dateKey };
  }

  return { cleared: false, deleted: 0, forDate: null };
}

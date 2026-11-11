import picksBoard from "@/data/picks_board.json";
import {
  appendChatMessage,
  clearChatMessages,
} from "@/lib/chatStore";
import { sql } from "@/lib/db";
import { fetchDayResults } from "@/lib/raceResults";
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

function jstWallMs(dateKey: string, hour: number, minute = 0): number {
  const y = Number(dateKey.slice(0, 4));
  const m = Number(dateKey.slice(4, 6));
  const d = Number(dateKey.slice(6, 8));
  return Date.parse(
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+09:00`,
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

/** その日の最終レース終了目安（ms）。 */
async function estimateRaceDayEndMs(dateKey: string): Promise<number> {
  const board = picksBoard as {
    active_date?: string;
    date?: string;
    picks?: Array<{ date?: string; closed_at?: string | null; race?: number }>;
  };
  const picks = (board.picks || []).filter(
    (p) => String(p.date || board.active_date || board.date || "") === dateKey,
  );
  let maxMs = 0;
  for (const p of picks) {
    if (!p.closed_at) continue;
    const raw = String(p.closed_at).trim();
    const t = Date.parse(raw.includes("T") || raw.includes("+") ? raw : raw.replace(" ", "T") + "+09:00");
    if (Number.isFinite(t)) maxMs = Math.max(maxMs, t);
  }

  // 結果が出揃ってきたら「最終レースが出た時刻」の近似として、結果件数を見て夜の締切を補正
  try {
    const results = await fetchDayResults(dateKey);
    if (results.size >= 6) {
      // 結果が一定数ある日は、少なくとも 20:30 以降を終了候補に
      maxMs = Math.max(maxMs, jstWallMs(dateKey, 20, 30));
    }
    if (results.size >= 18) {
      maxMs = Math.max(maxMs, jstWallMs(dateKey, 21, 0));
    }
  } catch {
    // ignore
  }

  if (maxMs > 0) return maxMs;
  // フォールバック: 21:00 JST
  return jstWallMs(dateKey, 21, 0);
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
    const endMs = await estimateRaceDayEndMs(dateKey);
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

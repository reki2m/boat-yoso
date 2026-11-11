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

async function countMessagesCreatedBefore(isoOrMs: string | number): Promise<number> {
  const cutoff = typeof isoOrMs === "number" ? new Date(isoOrMs).toISOString() : isoOrMs;
  try {
    const rows = await sql<{ count: number | string }>(
      `select count(*)::int as count from chat_messages where created_at < $1::timestamptz`,
      [cutoff],
    );
    return Number(rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

/** 日付タグ付きの前日以前の予想・結果メモを削除（通常会話は残す）。 */
async function deleteDatedMessagesBefore(dateKey: string): Promise<number> {
  try {
    const rows = await sql<{ id: string }>(
      `delete from chat_messages
       where meta ? 'date'
         and coalesce(meta->>'date', '') ~ '^[0-9]{8}$'
         and (meta->>'date') < $1
       returning id`,
      [dateKey],
    );
    return rows.length;
  } catch {
    return 0;
  }
}

async function performClear(dateKey: string): Promise<number> {
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
  return deleted;
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
  // 前日を先に処理（早朝に「昨日の予想」が残るのを防ぐ）
  const candidates = [previousDateKey(today), today];

  for (const dateKey of candidates) {
    const endMs = await estimateRaceDayEndMs(dateKey);
    if (!Number.isFinite(endMs)) continue;
    const clearAt = endMs + 60 * 60 * 1000;
    if (now.getTime() < clearAt) continue;

    const already = await getMeta("auto_cleared_for");
    if (already && already > dateKey) continue;
    if (already === dateKey) {
      // フラグだけ立って消去前のメッセージが残っている場合は再実行
      const leftover = await countMessagesCreatedBefore(clearAt);
      if (leftover === 0) continue;
    }

    const deleted = await performClear(dateKey);
    return { cleared: true, deleted, forDate: dateKey };
  }

  // セーフティ: 前日クリア後も date タグ付きの古い予想が残っていれば除去
  const yesterday = previousDateKey(today);
  const yEnd = await estimateRaceDayEndMs(yesterday);
  const yClearAt = yEnd + 60 * 60 * 1000;
  if (now.getTime() >= yClearAt) {
    const removed = await deleteDatedMessagesBefore(today);
    if (removed > 0) {
      await appendChatMessage({
        kind: "note",
        title: "自動消去",
        body: `前日以前の予想メッセージを自動消去しました（${removed}件）。`,
        author_name: "システム",
        author_role: "operator",
        meta: { date: today, mode: "auto_clear_stale" },
      });
      const already = await getMeta("auto_cleared_for");
      if (!already || already < yesterday) {
        await setMeta("auto_cleared_for", yesterday);
      }
      return { cleared: true, deleted: removed, forDate: yesterday };
    }
  }

  return { cleared: false, deleted: 0, forDate: null };
}

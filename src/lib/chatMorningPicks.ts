import { buildPicksMessage } from "@/lib/buildPicksMessage";
import { appendChatMessage } from "@/lib/chatStore";
import { sql } from "@/lib/db";
import { generateHonmeiDayBoard } from "@/lib/generateHonmeiDayBoard";
import { loadPicksBoardForDate, type PicksBoardDoc } from "@/lib/loadPicksBoard";
import { refreshPicksStatus } from "@/lib/refreshPicksStatus";
import { jstDateKey } from "@/lib/stadiums";

const META_KEY = "morning_honmei_posted_for";
const MORNING_HOUR_JST = 7;

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

function jstHour(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  return Number(parts.find((p) => p.type === "hour")?.value || 0);
}

async function resolveTodayBoard(dateKey: string): Promise<PicksBoardDoc> {
  const existing = await loadPicksBoardForDate(dateKey);
  if (existing && Array.isArray(existing.picks)) {
    return existing;
  }
  return generateHonmeiDayBoard(dateKey);
}

/**
 * 毎朝 7:00 JST 以降、本日の本命買い目をチャットへ1回だけ投稿する。
 */
export async function maybePostMorningHonmeiPicks(
  now = new Date(),
  opts?: { force?: boolean },
): Promise<{
  posted: boolean;
  dateKey: string;
  reason?: string;
  count?: number;
}> {
  const dateKey = jstDateKey(now);
  if (!opts?.force && jstHour(now) < MORNING_HOUR_JST) {
    return { posted: false, dateKey, reason: "before_7am" };
  }

  const already = await getMeta(META_KEY);
  if (!opts?.force && already === dateKey) {
    return { posted: false, dateKey, reason: "already_posted" };
  }

  // 同時実行の簡易ロック
  await setMeta(META_KEY, dateKey);

  try {
    const board = await resolveTodayBoard(dateKey);
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

    const built = buildPicksMessage({
      active_date: dateKey,
      date: dateKey,
      mode: typeof board.mode === "string" ? board.mode : "honmei_2020_maxminy",
      note:
        typeof board.note === "string"
          ? `朝7時自動投稿。${board.note}`
          : "朝7時自動投稿。展示・進入確定前のため展示待ちの場合があります。",
      picks: livePicks,
    });

    await appendChatMessage({
      kind: "picks",
      title: built.title.startsWith("本命") ? built.title : `本命予想 ${built.title}`,
      body: built.body,
      author_name: "律丸ボート部",
      author_role: "operator",
      meta: {
        date: dateKey,
        mode: "morning_auto_honmei",
        count: built.count,
        visibility: "public",
      },
    });

    return { posted: true, dateKey, count: built.count };
  } catch (error) {
    // 失敗時は同日再試行できるように戻す
    if (already && already !== dateKey) {
      await setMeta(META_KEY, already);
    } else {
      await sql(`delete from chat_meta where key = $1`, [META_KEY]).catch(() => null);
    }
    throw error;
  }
}

let schedulerStarted = false;

/** Next サーバー起動中に 7:00 JST を監視して投稿する。 */
export function startMorningHonmeiScheduler(): void {
  if (schedulerStarted) return;
  if (typeof setInterval !== "function") return;
  schedulerStarted = true;

  const tick = () => {
    void maybePostMorningHonmeiPicks().catch(() => null);
  };
  // 起動直後と以降1分ごと
  tick();
  setInterval(tick, 60_000);
}

import { sql } from "@/lib/db";

/** 展示待ち投稿はレースごと1回 */
export function waitingFlag(dateKey: string, stadium: number, race: number): string {
  return `honmei_waiting_posted:${dateKey}:${stadium}:${race}`;
}

/** 確定/スルー投稿はレースごと1回（旧 exhibition_chat_posted も互換参照） */
export function finalFlag(dateKey: string, stadium: number, race: number): string {
  return `honmei_final_posted:${dateKey}:${stadium}:${race}`;
}

export function legacyExhibitionFlag(
  dateKey: string,
  stadium: number,
  race: number,
): string {
  return `exhibition_chat_posted:${dateKey}:${stadium}:${race}`;
}

/** 着順・払戻投稿はレースごと1回 */
export function resultFlag(dateKey: string, stadium: number, race: number): string {
  return `honmei_result_posted:${dateKey}:${stadium}:${race}`;
}

export async function alreadyPosted(flag: string): Promise<boolean> {
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

export async function markPosted(flag: string): Promise<void> {
  await sql(
    `insert into chat_meta (key, value, updated_at)
     values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [flag, "1"],
  );
}

export async function alreadyWaitingPosted(
  dateKey: string,
  stadium: number,
  race: number,
): Promise<boolean> {
  return alreadyPosted(waitingFlag(dateKey, stadium, race));
}

export async function alreadyFinalPosted(
  dateKey: string,
  stadium: number,
  race: number,
): Promise<boolean> {
  if (await alreadyPosted(finalFlag(dateKey, stadium, race))) return true;
  // 旧フラグ互換
  return alreadyPosted(legacyExhibitionFlag(dateKey, stadium, race));
}

export async function alreadyResultPosted(
  dateKey: string,
  stadium: number,
  race: number,
): Promise<boolean> {
  return alreadyPosted(resultFlag(dateKey, stadium, race));
}

export async function markWaitingPosted(
  dateKey: string,
  stadium: number,
  race: number,
): Promise<void> {
  await markPosted(waitingFlag(dateKey, stadium, race));
}

export async function markFinalPosted(
  dateKey: string,
  stadium: number,
  race: number,
): Promise<void> {
  await markPosted(finalFlag(dateKey, stadium, race));
  // 旧経路との二重投稿も抑止
  await markPosted(legacyExhibitionFlag(dateKey, stadium, race));
}

export async function markResultPosted(
  dateKey: string,
  stadium: number,
  race: number,
): Promise<void> {
  await markPosted(resultFlag(dateKey, stadium, race));
}

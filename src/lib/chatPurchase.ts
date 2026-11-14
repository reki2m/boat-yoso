import { jstDateKey } from "@/lib/stadiums";

/** 購入ロック状態 */
export type PurchaseLockState = "yes" | "no" | "purchased" | "skip";

export function targetPurchaseMetaKey(
  date: string,
  sessionId: string,
  placeNo: number,
  raceNo: number,
): string {
  return `target_purchase:${date}:${sessionId}:${placeNo}:${raceNo}`;
}

export function todayTargetPurchaseKey(
  sessionId: string,
  placeNo: number,
  raceNo: number,
): string {
  return targetPurchaseMetaKey(jstDateKey(), sessionId, placeNo, raceNo);
}

export function parsePurchaseLock(raw: string | null | undefined): PurchaseLockState | null {
  if (raw === "yes" || raw === "no" || raw === "purchased" || raw === "skip") return raw;
  return null;
}

/** 本日分の本命対象ロックを一括取得用のキー接頭辞 */
export function todayTargetPurchasePrefix(sessionId: string): string {
  return `target_purchase:${jstDateKey()}:${sessionId}:`;
}

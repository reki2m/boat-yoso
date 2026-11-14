import { jstDateKey } from "@/lib/stadiums";

export function dayPurchaseMetaKey(date: string, sessionId: string): string {
  return `day_purchase:${date}:${sessionId}`;
}

export function todayDayPurchaseKey(sessionId: string): string {
  return dayPurchaseMetaKey(jstDateKey(), sessionId);
}

/** 開催日目（いわゆる回目）の表示ヘルパ */

const DAY_LABEL: Record<number, string> = {
  1: "初日",
  2: "2日目",
  3: "3日目",
  4: "4日目",
  5: "5日目",
  6: "6日目",
  7: "7日目",
};

export function parseSeriesDay(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 1 || n > 12) return null;
  return Math.trunc(n);
}

export function seriesDayLabel(day: number | null | undefined): string {
  if (day == null || !Number.isFinite(day) || day < 1) return "";
  const d = Math.trunc(day);
  if (d >= 99) return "最終日";
  return DAY_LABEL[d] || `${d}日目`;
}

/** UI用: 「第3回 · 3日目」 */
export function seriesRoundBadge(day: number | null | undefined): string {
  if (day == null || !Number.isFinite(day) || day < 1) return "";
  const d = Math.trunc(day);
  if (d >= 99) return "最終回";
  const dayText = seriesDayLabel(d);
  return `第${d}回 · ${dayText}`;
}

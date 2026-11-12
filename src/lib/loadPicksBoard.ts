import { readFile } from "node:fs/promises";
import path from "node:path";
import picksBoard from "@/data/picks_board.json";

export type PicksBoardDoc = {
  active_date?: string;
  date?: string;
  mode?: string;
  note?: string;
  status?: string;
  picks?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

async function readJsonFile(filePath: string): Promise<PicksBoardDoc | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as PicksBoardDoc;
  } catch {
    return null;
  }
}

/** 指定日の本命ボードを、ランタイムファイル → バンドルの順で読む。 */
export async function loadPicksBoardForDate(dateKey: string): Promise<PicksBoardDoc | null> {
  const candidates = [
    path.join(process.cwd(), "src", "data", `picks_${dateKey}.json`),
    path.join(process.cwd(), "data", "reports", `picks_${dateKey}.json`),
    path.join(process.cwd(), "src", "data", "picks_board.json"),
    path.join(process.cwd(), "data", "reports", "picks_board.json"),
  ];

  for (const filePath of candidates) {
    const doc = await readJsonFile(filePath);
    if (!doc) continue;
    const boardDate = String(doc.active_date || doc.date || "");
    const picks = Array.isArray(doc.picks) ? doc.picks : [];
    const todays = picks.filter((p) => String(p.date || boardDate) === dateKey);
    if (boardDate === dateKey || todays.length) {
      return {
        ...doc,
        active_date: dateKey,
        date: dateKey,
        picks: todays.length ? todays : picks.filter((p) => String(p.date || boardDate) === dateKey),
      };
    }
  }

  const bundled = picksBoard as PicksBoardDoc;
  const boardDate = String(bundled.active_date || bundled.date || "");
  const picks = (bundled.picks || []).filter(
    (p) => String(p.date || boardDate) === dateKey,
  );
  if (boardDate === dateKey || picks.length) {
    return {
      ...bundled,
      active_date: dateKey,
      date: dateKey,
      picks,
    };
  }
  return null;
}

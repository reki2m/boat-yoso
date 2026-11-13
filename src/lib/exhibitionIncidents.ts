import { promises as fs } from "node:fs";
import path from "node:path";
import type { ExhibitionStatus } from "./exhibition";

export type ExhibitionIncident = {
  at: string;
  date: string;
  stadium: number;
  race: number;
  kind:
    | "entry_change"
    | "stretch_slit"
    | "fast_lap"
    | "slow_c1_lap"
    | "exhibition_fail"
    | "unexpected"
    | "stream_check";
  detail: string;
  boats?: number[];
  source?: string;
};

type IncidentStore = {
  updated_at: string;
  incidents: ExhibitionIncident[];
  /** 場×種別の累計（事故学習用） */
  tallies: Record<string, number>;
};

const REPORT = path.join(process.cwd(), "data", "reports", "exhibition_incidents.json");
const SRC = path.join(process.cwd(), "src", "data", "exhibition_incidents.json");

async function readStore(): Promise<IncidentStore> {
  for (const file of [REPORT, SRC]) {
    try {
      const raw = await fs.readFile(file, "utf8");
      const doc = JSON.parse(raw) as IncidentStore;
      if (doc && Array.isArray(doc.incidents)) return doc;
    } catch {
      // continue
    }
  }
  return { updated_at: new Date().toISOString(), incidents: [], tallies: {} };
}

async function writeStore(store: IncidentStore): Promise<void> {
  const text = JSON.stringify(store, null, 2);
  for (const file of [REPORT, SRC]) {
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, text, "utf8");
    } catch {
      // ignore one path
    }
  }
}

function tallyKey(stadium: number, kind: string): string {
  return `${stadium}:${kind}`;
}

/** 展示シグナルから事故・異常を学習ストアへ追記 */
export async function recordExhibitionIncidents(input: {
  date: string;
  stadium: number;
  race: number;
  exhibition: ExhibitionStatus;
  unexpected?: boolean;
  streamNote?: string | null;
}): Promise<ExhibitionIncident[]> {
  const created: ExhibitionIncident[] = [];
  const at = new Date().toISOString();
  const source = input.exhibition.signals?.source || "merged";

  if (input.exhibition.entryChanged) {
    created.push({
      at,
      date: input.date,
      stadium: input.stadium,
      race: input.race,
      kind: "entry_change",
      detail: input.exhibition.changes
        .map((c) => `${c.boat}号${c.from}→${c.to}`)
        .join(" / "),
      boats: input.exhibition.changes.map((c) => c.boat),
      source,
    });
  }

  for (const s of input.exhibition.signals?.stretchSlits ?? []) {
    created.push({
      at,
      date: input.date,
      stadium: input.stadium,
      race: input.race,
      kind: "stretch_slit",
      detail: `${s.boat}号 スタート展示ST ${s.slit.toFixed(2)}（伸び）`,
      boats: [s.boat],
      source,
    });
  }

  for (const f of input.exhibition.signals?.fastLaps ?? []) {
    created.push({
      at,
      date: input.date,
      stadium: input.stadium,
      race: input.race,
      kind: "fast_lap",
      detail: `${f.boat}号 周回 ${f.lapTime.toFixed(2)}（中央より ${f.deltaVsMedian.toFixed(2)} 速い）`,
      boats: [f.boat],
      source,
    });
  }

  const c1 = input.exhibition.boats.find((b) => b.entry === 1 || b.boat === 1);
  const slowC1 = (input.exhibition.signals?.slowLaps ?? []).find((s) => s.boat === 1);
  if (slowC1 || (c1?.lapTime != null && c1.lapTime >= 6.9)) {
    created.push({
      at,
      date: input.date,
      stadium: input.stadium,
      race: input.race,
      kind: "slow_c1_lap",
      detail: `1号周回 ${(c1?.lapTime ?? slowC1?.lapTime ?? 0).toFixed(2)} が遅い`,
      boats: [1],
      source,
    });
  }

  if (!input.exhibition.ready) {
    created.push({
      at,
      date: input.date,
      stadium: input.stadium,
      race: input.race,
      kind: "exhibition_fail",
      detail: input.exhibition.reason || "展示未完了",
      source,
    });
  }

  if (input.unexpected) {
    created.push({
      at,
      date: input.date,
      stadium: input.stadium,
      race: input.race,
      kind: "unexpected",
      detail: "中止・欠場・進入違反などの想定外",
      source,
    });
  }

  if (input.streamNote) {
    created.push({
      at,
      date: input.date,
      stadium: input.stadium,
      race: input.race,
      kind: "stream_check",
      detail: input.streamNote,
      source: "live_stream",
    });
  }

  if (!created.length) return [];

  const store = await readStore();
  // 同一レース・同一種別の直近重複を抑止
  const recentKeys = new Set(
    store.incidents
      .slice(-400)
      .map((i) => `${i.date}:${i.stadium}:${i.race}:${i.kind}:${i.detail}`),
  );
  for (const inc of created) {
    const key = `${inc.date}:${inc.stadium}:${inc.race}:${inc.kind}:${inc.detail}`;
    if (recentKeys.has(key)) continue;
    store.incidents.push(inc);
    const tk = tallyKey(inc.stadium, inc.kind);
    store.tallies[tk] = (store.tallies[tk] || 0) + 1;
  }
  // 直近2000件に刈り込み
  if (store.incidents.length > 2000) {
    store.incidents = store.incidents.slice(-2000);
  }
  store.updated_at = at;
  await writeStore(store);
  return created;
}

/** 場の進入変更リスク（学習済み tally） */
export async function stadiumEntryChangeRisk(stadium: number): Promise<number> {
  const store = await readStore();
  const changes = store.tallies[tallyKey(stadium, "entry_change")] || 0;
  const total =
    Object.entries(store.tallies)
      .filter(([k]) => k.startsWith(`${stadium}:`))
      .reduce((a, [, v]) => a + v, 0) || 1;
  return changes / total;
}

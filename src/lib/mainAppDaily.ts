import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const SRC_DATA_DIR = path.join(process.cwd(), "src", "data");
const SCRIPTS_DIR = path.join(process.cwd(), "scripts");

const STATE_FILES = [
  path.join(DATA_DIR, "update_state.json"),
  path.join(SRC_DATA_DIR, "update_state.json"),
];

type RunKind = "nightly" | "confirm" | "learn";

let schedulerStarted = false;
let running: RunKind | null = null;

function jstParts(now = new Date()): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "0";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

async function readState(): Promise<Record<string, unknown>> {
  for (const file of STATE_FILES) {
    try {
      const raw = await fs.readFile(file, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // continue
    }
  }
  return {};
}

async function writeState(patch: Record<string, unknown>): Promise<void> {
  const prev = await readState();
  const next = { ...prev, ...patch };
  const text = JSON.stringify(next, null, 2);
  for (const file of STATE_FILES) {
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, text, "utf8");
    } catch {
      // ignore one path failure
    }
  }
}

function runPython(
  scriptName: string,
  args: string[] = [],
): Promise<{ ok: boolean; code: number | null; log: string }> {
  return new Promise((resolve) => {
    const script = path.join(SCRIPTS_DIR, scriptName);
    const child = spawn("python3", [script, ...args], {
      cwd: process.cwd(),
      env: process.env,
    });
    let log = "";
    child.stdout.on("data", (buf) => {
      log += String(buf);
    });
    child.stderr.on("data", (buf) => {
      log += String(buf);
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, code, log: log.slice(-8000) });
    });
    child.on("error", (err) => {
      resolve({ ok: false, code: null, log: String(err) });
    });
  });
}

export async function runMainAppNightlyUpdate(): Promise<{
  ok: boolean;
  skipped?: boolean;
  log?: string;
}> {
  if (running) return { ok: false, skipped: true, log: `busy:${running}` };
  running = "nightly";
  try {
    const result = await runPython("nightly_update.py", ["--force"]);
    await writeState({
      last_nightly_at: new Date().toISOString(),
      last_nightly_ok: result.ok,
    });
    return { ok: result.ok, log: result.log };
  } finally {
    running = null;
  }
}

export async function runMainAppExhibitionConfirm(): Promise<{
  ok: boolean;
  skipped?: boolean;
  log?: string;
}> {
  if (running) return { ok: false, skipped: true, log: `busy:${running}` };
  running = "confirm";
  try {
    const result = await runPython("confirm_exhibition.py");
    await writeState({
      last_confirm_at: new Date().toISOString(),
      last_confirm_ok: result.ok,
    });
    return { ok: result.ok, log: result.log };
  } finally {
    running = null;
  }
}

export async function runMainAppRoiLearn(): Promise<{
  ok: boolean;
  skipped?: boolean;
  log?: string;
}> {
  if (running) return { ok: false, skipped: true, log: `busy:${running}` };
  running = "learn";
  try {
    const score = await runPython("score_picks.py", ["--days", "14"]);
    const learn = await runPython("learn_roi_daily.py");
    const incidents = await runPython("learn_exhibition_incidents.py");
    await writeState({
      last_learn_at: new Date().toISOString(),
      last_learn_ok: score.ok && learn.ok && incidents.ok,
    });
    return {
      ok: score.ok && learn.ok && incidents.ok,
      log: `${score.log}\n${learn.log}\n${incidents.log}`.slice(-8000),
    };
  } finally {
    running = null;
  }
}

async function tick(): Promise<void> {
  const { date, hour, minute } = jstParts();
  const state = await readState();
  const lastNightlyDate = String(state.last_nightly_date || "");
  const lastLearnDate = String(state.last_learn_date || "");
  const lastConfirmSlot = String(state.last_confirm_slot || "");

  // 深夜〜早朝: 日次更新（1日1回）
  if (hour === 2 && minute < 20 && lastNightlyDate !== date) {
    const r = await runMainAppNightlyUpdate();
    if (r.ok || !r.skipped) await writeState({ last_nightly_date: date });
  }

  // 学習は夜のあと（3時台）
  if (hour === 3 && minute < 30 && lastLearnDate !== date) {
    const r = await runMainAppRoiLearn();
    if (r.ok || !r.skipped) await writeState({ last_learn_date: date });
  }

  // 日中: 展示確定を20分間隔
  if (hour >= 8 && hour <= 20 && minute % 20 < 2) {
    const slot = `${date}-${hour}-${Math.floor(minute / 20)}`;
    if (lastConfirmSlot !== slot) {
      const r = await runMainAppExhibitionConfirm();
      if (r.ok || !r.skipped) await writeState({ last_confirm_slot: slot });
    }
  }
}

/** 明示オプトイン時のみ。通常は CRON 経由。 */
export function startMainAppDailyScheduler(): void {
  if (schedulerStarted) return;
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  schedulerStarted = true;
  void tick().catch(() => null);
  setInterval(() => {
    void tick().catch(() => null);
  }, 60_000);
}

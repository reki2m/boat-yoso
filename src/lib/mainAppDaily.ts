import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const STATE_FILES = [
  path.join(process.cwd(), "data", "update_state.json"),
  path.join(process.cwd(), "src", "data", "update_state.json"),
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

function runPython(scriptRel: string, args: string[] = []): Promise<{ ok: boolean; code: number | null; log: string }> {
  return new Promise((resolve) => {
    const script = path.join(process.cwd(), scriptRel);
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
  kind: "nightly";
  log: string;
}> {
  if (running) return { ok: false, kind: "nightly", log: `busy:${running}` };
  running = "nightly";
  try {
    const result = await runPython("scripts/nightly_update.py", ["--force"]);
    await writeState({
      last_success_at: result.ok ? new Date().toISOString() : undefined,
      last_success_date: result.ok ? jstParts().date : undefined,
      last_nightly_ok: result.ok,
      last_nightly_at: new Date().toISOString(),
      cadence: "nightly_daily_auto",
      auto_learn_roi: true,
    });
    return { ok: result.ok, kind: "nightly", log: result.log };
  } finally {
    running = null;
  }
}

export async function runMainAppExhibitionConfirm(): Promise<{
  ok: boolean;
  kind: "confirm";
  log: string;
}> {
  if (running) return { ok: false, kind: "confirm", log: `busy:${running}` };
  running = "confirm";
  try {
    const result = await runPython("scripts/confirm_exhibition.py");
    await writeState({
      last_confirm_ok: result.ok,
      last_confirm_at: new Date().toISOString(),
    });
    return { ok: result.ok, kind: "confirm", log: result.log };
  } finally {
    running = null;
  }
}

export async function runMainAppRoiLearn(): Promise<{
  ok: boolean;
  kind: "learn";
  log: string;
}> {
  if (running) return { ok: false, kind: "learn", log: `busy:${running}` };
  running = "learn";
  try {
    const score = await runPython("scripts/score_picks.py", ["--days", "14"]);
    const learn = await runPython("scripts/learn_roi_daily.py");
    await writeState({
      last_learn_ok: score.ok && learn.ok,
      last_learn_at: new Date().toISOString(),
    });
    return {
      ok: score.ok && learn.ok,
      kind: "learn",
      log: `${score.log}\n${learn.log}`.slice(-8000),
    };
  } finally {
    running = null;
  }
}

/**
 * 本体アプリの日次更新スケジューラ。
 * - 02:15 JST 以降に1日1回 nightly（最新データ＋回収率学習）
 * - 競走時間帯は展示確認を定期実行
 */
export function startMainAppDailyScheduler(): void {
  if (schedulerStarted) return;
  if (typeof setInterval !== "function") return;
  schedulerStarted = true;

  const tick = async () => {
    const { date, hour, minute } = jstParts();
    const state = await readState();
    const lastNightlyDate = String(state.last_success_date || "");

    // 毎日 2:15 JST 以降に本体更新＋学習
    if (hour > 2 || (hour === 2 && minute >= 15)) {
      if (lastNightlyDate !== date && running == null) {
        await runMainAppNightlyUpdate().catch(() => null);
        return;
      }
    }

    // 8〜21時は展示後の確定を定期反映
    if (hour >= 8 && hour <= 21 && running == null) {
      const lastConfirm = Date.parse(String(state.last_confirm_at || 0));
      if (!Number.isFinite(lastConfirm) || Date.now() - lastConfirm > 20 * 60 * 1000) {
        await runMainAppExhibitionConfirm().catch(() => null);
      }
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, 60_000);
}

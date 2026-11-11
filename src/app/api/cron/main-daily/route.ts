import { NextRequest, NextResponse } from "next/server";
import {
  runMainAppExhibitionConfirm,
  runMainAppNightlyUpdate,
  runMainAppRoiLearn,
} from "@/lib/mainAppDaily";
import { checkAdmin, checkOperator } from "@/lib/chatStore";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const cron = process.env.CRON_SECRET?.trim();
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (cron && bearer && bearer === cron) return true;
  const key = req.headers.get("x-chat-operator") || req.headers.get("x-chat-admin") || "";
  return checkOperator(key) || checkAdmin(key);
}

/** 本体アプリの日次更新 / 展示確認 / 回収率学習を外部cronから起動 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let mode: "nightly" | "confirm" | "learn" = "nightly";
  try {
    const body = (await req.json()) as { mode?: string };
    if (body.mode === "confirm" || body.mode === "learn" || body.mode === "nightly") {
      mode = body.mode;
    }
  } catch {
    mode = "nightly";
  }

  try {
    if (mode === "confirm") {
      const result = await runMainAppExhibitionConfirm();
      return NextResponse.json(result);
    }
    if (mode === "learn") {
      const result = await runMainAppRoiLearn();
      return NextResponse.json(result);
    }
    const result = await runMainAppNightlyUpdate();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "main daily failed",
      },
      { status: 500 },
    );
  }
}

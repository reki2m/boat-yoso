import { NextRequest, NextResponse } from "next/server";
import picksBoard from "@/data/picks_board.json";
import { buildPicksMessage } from "@/lib/buildPicksMessage";
import { checkOperator } from "@/lib/chatStore";
import { allowAuthAttemptShared } from "@/lib/authRateLimit";
import { sendDiscordMessage } from "@/lib/discordNotify";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (process.env.DISCORD_MIRROR_ENABLED?.trim() !== "1") {
    return NextResponse.json(
      {
        ok: false,
        error: "Discord連携は無効です",
        hint: "Secrets に DISCORD_MIRROR_ENABLED=1 と DISCORD_WEBHOOK_URL を設定してください。",
      },
      { status: 503 },
    );
  }

  let body: { operatorKey?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = body.operatorKey || req.headers.get("x-chat-operator");
  if (!checkOperator(key)) {
    const fail = await allowAuthAttemptShared(`discord-op-fail:${ip}`, {
      limit: 20,
      windowMs: 10 * 60 * 1000,
    });
    if (!fail.ok) {
      return NextResponse.json(
        { ok: false, error: "試行回数が多すぎます。しばらくしてから再度お試しください。" },
        {
          status: 429,
          headers: fail.retryAfterSec ? { "retry-after": String(fail.retryAfterSec) } : undefined,
        },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: "運営キーが違います",
        hint: "CHAT_OPERATOR_KEY を確認してください",
      },
      { status: 401 },
    );
  }

  const webhook = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!webhook) {
    return NextResponse.json(
      {
        ok: false,
        error: "DISCORD_WEBHOOK_URL 未設定",
        hint: "Cursor Apps の Secrets か実行環境の環境変数に Webhook URL を入れてください。",
      },
      { status: 503 },
    );
  }

  const built = buildPicksMessage(
    picksBoard as {
      active_date?: string;
      date?: string;
      mode?: string;
      picks?: Array<Record<string, unknown>>;
      note?: string;
    },
  );
  const mirrored = await sendDiscordMessage(built.body);
  if (!mirrored.ok) {
    return NextResponse.json(
      { ok: false, error: mirrored.detail || "Discord送信失敗" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, preview: built.body.slice(0, 280) });
}

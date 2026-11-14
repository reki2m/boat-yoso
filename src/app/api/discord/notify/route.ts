import { NextRequest, NextResponse } from "next/server";
import picksBoard from "@/data/picks_board.json";
import { buildPicksMessage } from "@/lib/buildPicksMessage";
import { checkAdmin, checkOperator } from "@/lib/chatStore";
import { allowAuthAttemptShared } from "@/lib/authRateLimit";
import {
  formatDiscordTestMessage,
  isDiscordEnabled,
  sendDiscordMessage,
} from "@/lib/discordNotify";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: {
    operatorKey?: string;
    adminKey?: string;
    /** true なら短いテスト文を送る（買い目全文ではない） */
    test?: boolean;
    authorName?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key =
    body.adminKey ||
    body.operatorKey ||
    req.headers.get("x-chat-admin") ||
    req.headers.get("x-chat-operator");
  const allowed = checkAdmin(key) || checkOperator(key);
  if (!allowed) {
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
        error: "管理人キーまたは運営キーが違います",
        hint: "CHAT_ADMIN_KEY / CHAT_OPERATOR_KEY を確認してください",
      },
      { status: 401 },
    );
  }

  if (!isDiscordEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        error: "Discord連携は無効です",
        hint: "Secrets の DISCORD_MIRROR_ENABLED を 1（または true）にし、DISCORD_WEBHOOK_URL を設定してください。",
      },
      { status: 503 },
    );
  }

  const text = body.test
    ? formatDiscordTestMessage(body.authorName)
    : buildPicksMessage(
        picksBoard as {
          active_date?: string;
          date?: string;
          mode?: string;
          picks?: Array<Record<string, unknown>>;
          note?: string;
        },
      ).body;

  const mirrored = await sendDiscordMessage(text, { timeoutMs: 8000 });
  if (!mirrored.ok) {
    return NextResponse.json(
      { ok: false, error: mirrored.detail || "Discord送信失敗" },
      { status: 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    test: Boolean(body.test),
    preview: text.slice(0, 280),
  });
}

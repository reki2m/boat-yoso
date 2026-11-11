import { NextResponse } from "next/server";
import picksBoard from "@/data/picks_board.json";
import { buildPicksMessage, toDiscordContent } from "@/lib/buildPicksMessage";

export const dynamic = "force-dynamic";

export async function POST() {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
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
  const content = toDiscordContent(built.body);
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { ok: false, error: `Discord HTTP ${res.status}`, detail: text.slice(0, 200) },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, preview: content.slice(0, 280) });
}

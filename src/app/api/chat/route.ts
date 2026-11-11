import { NextRequest, NextResponse } from "next/server";
import picksBoard from "@/data/picks_board.json";
import { buildPicksMessage, toDiscordContent } from "@/lib/buildPicksMessage";
import {
  appendChatMessage,
  checkInvite,
  checkOperator,
  readChatFeed,
  sanitizeChatBody,
  sanitizeDisplayName,
  type ChatKind,
  type ChatRole,
} from "@/lib/chatStore";

export const dynamic = "force-dynamic";

async function mirrorDiscord(body: string): Promise<{ ok: boolean; detail?: string }> {
  const webhook = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!webhook) return { ok: false, detail: "DISCORD_WEBHOOK_URL 未設定" };
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: toDiscordContent(body) }),
  });
  if (!res.ok) {
    return { ok: false, detail: `Discord HTTP ${res.status}` };
  }
  return { ok: true };
}

export async function GET(req: NextRequest) {
  const invite = req.nextUrl.searchParams.get("invite") || req.headers.get("x-chat-invite");
  if (!checkInvite(invite)) {
    return NextResponse.json(
      { ok: false, error: "招待コードが違います" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const feed = await readChatFeed();
  return NextResponse.json(
    { ok: true, updated_at: feed.updated_at, messages: feed.messages },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  let body: {
    invite?: string;
    operatorKey?: string;
    kind?: ChatKind;
    note?: string;
    text?: string;
    authorName?: string;
    mirrorDiscord?: boolean;
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const invite = body.invite || req.headers.get("x-chat-invite");
  const key = body.operatorKey || req.headers.get("x-chat-operator");
  const isOperator = checkOperator(key);
  const kind: ChatKind = body.kind === "note" || body.kind === "chat" || body.kind === "picks" ? body.kind : "picks";

  // Member talk: invite code is enough.
  if (kind === "chat") {
    if (!checkInvite(invite) && !isOperator) {
      return NextResponse.json(
        { ok: false, error: "招待コードが違います" },
        { status: 401 },
      );
    }
    const text = sanitizeChatBody(body.text || body.note);
    if (!text) {
      return NextResponse.json({ ok: false, error: "メッセージが空です" }, { status: 400 });
    }
    const role: ChatRole = isOperator ? "operator" : "member";
    const authorName = sanitizeDisplayName(
      body.authorName || (isOperator ? "運営" : "メンバー"),
    );
    const message = await appendChatMessage({
      kind: "chat",
      title: role === "operator" ? "運営" : authorName,
      body: text,
      author_name: authorName,
      author_role: role,
    });
    return NextResponse.json({ ok: true, message });
  }

  // Picks / note: operator only.
  if (!isOperator) {
    return NextResponse.json(
      { ok: false, error: "運営キーが違います", hint: "CHAT_OPERATOR_KEY を確認してください" },
      { status: 401 },
    );
  }

  let title = "メモ";
  let text = sanitizeChatBody(body.note || body.text);
  let meta: { date?: string; mode?: string; count?: number; discord?: boolean } = {};

  if (kind === "picks") {
    const built = buildPicksMessage(
      picksBoard as {
        active_date?: string;
        date?: string;
        mode?: string;
        picks?: Array<Record<string, unknown>>;
        note?: string;
      },
    );
    title = built.title;
    text = built.body;
    meta = { date: built.dateKey, mode: (picksBoard as { mode?: string }).mode, count: built.count };
  } else if (!text) {
    return NextResponse.json({ ok: false, error: "メモ本文が空です" }, { status: 400 });
  }

  let discordOk = false;
  let discordDetail: string | undefined;
  if (body.mirrorDiscord !== false) {
    const mirrored = await mirrorDiscord(text);
    discordOk = mirrored.ok;
    discordDetail = mirrored.detail;
  }
  meta.discord = discordOk;

  const message = await appendChatMessage({
    kind,
    title,
    body: text,
    author_name: "運営",
    author_role: "operator",
    meta,
  });

  return NextResponse.json({
    ok: true,
    message,
    discord: { ok: discordOk, detail: discordDetail },
  });
}

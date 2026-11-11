import { NextRequest, NextResponse } from "next/server";
import picksBoard from "@/data/picks_board.json";
import { buildPicksMessage, toDiscordContent } from "@/lib/buildPicksMessage";
import {
  appendChatMessage,
  checkAdmin,
  checkInvite,
  checkOperator,
  clearChatMessages,
  readChatFeed,
  sanitizeChatBody,
  sanitizeDisplayName,
  type ChatKind,
  type ChatRole,
} from "@/lib/chatStore";
import { buildChatRaceReply } from "@/lib/buildChatRaceReply";
import {
  allowRaceReply,
  hashBucket,
  maybeRunChatMaintenance,
} from "@/lib/chatSecurity";
import { leavePresence, listPresence, touchPresence } from "@/lib/chatPresence";
import { getChatLiveTargets } from "@/lib/chatLiveTargets";
import { CHAT_HOUSE_RULES } from "@/lib/chatRules";
import { parseRaceChatQuery } from "@/lib/parseRaceChatQuery";
import { refreshPicksStatus } from "@/lib/refreshPicksStatus";

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
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const sessionId = req.nextUrl.searchParams.get("session") || "";
  const presenceName = req.nextUrl.searchParams.get("name") || "";
  const wantsOperator = req.nextUrl.searchParams.get("role") === "operator";
  // 運営キーはヘッダのみ（クエリに載せるとアクセスログへ残る）
  const operatorKeyHdr = req.headers.get("x-chat-operator") || "";
  // role=operator だけでは昇格させない。運営キー検証必須。
  const presenceRole =
    wantsOperator && checkOperator(operatorKeyHdr) ? "operator" : "member";
  if (sessionId && presenceName) {
    await touchPresence({
      sessionId,
      displayName: presenceName,
      role: presenceRole,
    }).catch(() => null);
  }
  await maybeRunChatMaintenance().catch(() => null);
  const [feed, live, presence] = await Promise.all([
    readChatFeed(),
    getChatLiveTargets({ refresh }),
    listPresence().catch(() => []),
  ]);
  return NextResponse.json(
    {
      ok: true,
      updated_at: feed.updated_at,
      messages: feed.messages,
      liveDate: live.date,
      targets: live.targets,
      rules: CHAT_HOUSE_RULES,
      presence,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  let body: {
    invite?: string;
    operatorKey?: string;
    kind?: ChatKind | "clear" | "leave";
    note?: string;
    text?: string;
    authorName?: string;
    sessionId?: string;
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
  const kind = body.kind || "picks";

  if (kind === "leave") {
    if (!checkInvite(invite) && !isOperator) {
      return NextResponse.json({ ok: false, error: "招待コードが違います" }, { status: 401 });
    }
    await leavePresence(body.sessionId).catch(() => null);
    return NextResponse.json({ ok: true });
  }

  if (kind === "clear") {
    // 破壊操作は管理人のみ（CHAT_ADMIN_KEY、未設定時は CHAT_OPERATOR_KEY）
    if (!checkAdmin(key)) {
      return NextResponse.json(
        {
          ok: false,
          error: "管理人権限が必要です",
          hint: "CHAT_ADMIN_KEY（未設定なら CHAT_OPERATOR_KEY）を確認してください",
        },
        { status: 403 },
      );
    }
    const deleted = await clearChatMessages();
    const notice = await appendChatMessage({
      kind: "note",
      title: "一括消去",
      body: "管理人がチャット履歴を一括消去しました。",
      author_name: "管理人",
      author_role: "operator",
    });
    return NextResponse.json({ ok: true, deleted, message: notice });
  }

  // 投稿前にもメンテ（自動消去・朝投稿など）を軽く確認
  await maybeRunChatMaintenance().catch(() => null);

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

    let reply = null;
    const raceQuery = parseRaceChatQuery(text);
    if (raceQuery) {
      const bucket = hashBucket(
        `${body.sessionId || ""}:${invite || ""}:${req.headers.get("x-forwarded-for") || ""}`,
      );
      const gate = allowRaceReply(bucket);
      if (!gate.ok) {
        reply = await appendChatMessage({
          kind: "note",
          title: "利用制限",
          body: gate.error || "予測の連続利用は制限されています。",
          author_name: "システム",
          author_role: "operator",
          meta: { mode: "rate_limit" },
        });
        return NextResponse.json(
          {
            ok: true,
            message,
            reply,
            rateLimited: true,
            retryAfterSec: gate.retryAfterSec,
          },
          gate.retryAfterSec
            ? { headers: { "retry-after": String(gate.retryAfterSec) } }
            : undefined,
        );
      }
      try {
        const built = await buildChatRaceReply(raceQuery);
        reply = await appendChatMessage({
          kind: "note",
          title: `${raceQuery.placeName}${raceQuery.raceNo}R 予測`,
          body: built.text,
          author_name: "律丸ボート部",
          author_role: "operator",
          meta: {
            date: built.dateKey,
            mode: "chat_race_reply",
            count: built.tickets.length,
            placeNo: built.placeNo,
            raceNo: built.raceNo,
            tickets: [...built.tickets, ...built.anaTickets],
          },
        });
      } catch {
        reply = await appendChatMessage({
          kind: "note",
          title: `${raceQuery.placeName}${raceQuery.raceNo}R 予測`,
          body: `${raceQuery.placeName}${raceQuery.raceNo}R の予測取得に失敗しました。少し待って再送してください。`,
          author_name: "律丸ボート部",
          author_role: "operator",
        });
      }
    }

    return NextResponse.json({ ok: true, message, reply });
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
  let meta: {
    date?: string;
    mode?: string;
    count?: number;
    skipped?: number;
    discord?: boolean;
  } = {};

  if (kind === "picks") {
    const board = picksBoard as {
      active_date?: string;
      date?: string;
      mode?: string;
      picks?: Array<Record<string, unknown>>;
      note?: string;
    };
    const livePicks = await refreshPicksStatus(
      (board.picks || []).map((p) => ({
        date: String(p.date || board.active_date || board.date || ""),
        stadium: Number(p.stadium || 0),
        stadium_name: typeof p.stadium_name === "string" ? p.stadium_name : undefined,
        race: Number(p.race || 0),
        tickets: Array.isArray(p.tickets) ? (p.tickets as string[]) : undefined,
        status: typeof p.status === "string" ? p.status : undefined,
        why: typeof p.why === "string" ? p.why : undefined,
        skip_reason: typeof p.skip_reason === "string" ? p.skip_reason : null,
      })),
    );
    const built = buildPicksMessage({
      active_date: board.active_date,
      date: board.date,
      mode: board.mode,
      note: board.note,
      picks: livePicks,
    });
    title = built.title;
    text = built.body;
    meta = {
      date: built.dateKey,
      mode: board.mode,
      count: built.count,
      skipped: built.skippedCount,
    };
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
    kind: kind === "note" ? "note" : "picks",
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

import { NextRequest, NextResponse } from "next/server";
import picksBoard from "@/data/picks_board.json";
import { buildPicksMessage, toDiscordContent } from "@/lib/buildPicksMessage";
import {
  appendChatMessage,
  checkAdmin,
  checkInvite,
  checkOperator,
  clearChatMessages,
  listPrivatePredictionSummary,
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
import { STADIUMS } from "@/lib/stadiums";
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

async function createPrivateRacePick(opts: {
  placeNo: number;
  raceNo: number;
  sessionId: string;
  ownerName: string;
  invite: string | null | undefined;
  forwardedFor: string | null;
}): Promise<{ ok: true; reply: Awaited<ReturnType<typeof appendChatMessage>> } | { ok: false; error: string; status: number; retryAfterSec?: number }> {
  const placeName = STADIUMS[opts.placeNo];
  if (!placeName || opts.raceNo < 1 || opts.raceNo > 12) {
    return { ok: false, error: "場またはレース番号が不正です", status: 400 };
  }
  const bucket = hashBucket(
    `${opts.sessionId}:${opts.invite || ""}:${opts.forwardedFor || ""}`,
  );
  const gate = allowRaceReply(bucket);
  if (!gate.ok) {
    return {
      ok: false,
      error: gate.error || "予測の連続利用は制限されています。",
      status: 429,
      retryAfterSec: gate.retryAfterSec,
    };
  }
  try {
    const built = await buildChatRaceReply({
      placeNo: opts.placeNo,
      placeName,
      raceNo: opts.raceNo,
      raw: `${placeName}${opts.raceNo}R`,
    });
    const reply = await appendChatMessage({
      kind: "note",
      title: `${placeName}${opts.raceNo}R 個人予想`,
      body: built.text,
      author_name: "律丸ボート部",
      author_role: "operator",
      meta: {
        date: built.dateKey,
        mode: "private_race_pick",
        count: built.tickets.length,
        placeNo: built.placeNo,
        raceNo: built.raceNo,
        tickets: [...built.tickets, ...built.anaTickets],
        visibility: "private",
        owner_session_id: opts.sessionId,
        owner_name: opts.ownerName,
      },
    });
    return { ok: true, reply };
  } catch {
    return {
      ok: false,
      error: `${placeName}${opts.raceNo}R の予測取得に失敗しました。少し待って再送してください。`,
      status: 502,
    };
  }
}

export async function GET(req: NextRequest) {
  const invite = req.headers.get("x-chat-invite") || req.nextUrl.searchParams.get("invite");
  if (!checkInvite(invite)) {
    return NextResponse.json(
      { ok: false, error: "招待コードが違います" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const sessionId = req.nextUrl.searchParams.get("session") || "";
  const presenceName = req.nextUrl.searchParams.get("name") || "";
  const adminKeyHdr = req.headers.get("x-chat-admin") || req.headers.get("x-chat-operator") || "";
  const isAdmin = checkAdmin(adminKeyHdr);
  const wantsOperator = req.nextUrl.searchParams.get("role") === "operator";
  const operatorKeyHdr = req.headers.get("x-chat-operator") || "";
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
  const [feed, live, presence, predictions] = await Promise.all([
    readChatFeed({ sessionId, isAdmin }),
    getChatLiveTargets({ refresh }),
    listPresence().catch(() => []),
    isAdmin ? listPrivatePredictionSummary() : Promise.resolve([]),
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
      isAdmin,
      predictions: isAdmin ? predictions : undefined,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  let body: {
    invite?: string;
    operatorKey?: string;
    adminKey?: string;
    kind?: ChatKind | "clear" | "leave" | "predict";
    note?: string;
    text?: string;
    authorName?: string;
    sessionId?: string;
    mirrorDiscord?: boolean;
    placeNo?: number;
    raceNo?: number;
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const invite = body.invite || req.headers.get("x-chat-invite");
  const key =
    body.adminKey ||
    body.operatorKey ||
    req.headers.get("x-chat-admin") ||
    req.headers.get("x-chat-operator");
  const isOperator = checkOperator(key);
  const isAdmin = checkAdmin(key);
  const kind = body.kind || "picks";

  if (kind === "leave") {
    if (!checkInvite(invite) && !isOperator) {
      return NextResponse.json({ ok: false, error: "招待コードが違います" }, { status: 401 });
    }
    await leavePresence(body.sessionId).catch(() => null);
    return NextResponse.json({ ok: true });
  }

  if (kind === "clear") {
    if (!isAdmin) {
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

  await maybeRunChatMaintenance().catch(() => null);

  // 個人予想: 招待者のみ。結果は本人と管理人だけが見える。
  if (kind === "predict") {
    if (!checkInvite(invite) && !isOperator) {
      return NextResponse.json({ ok: false, error: "招待コードが違います" }, { status: 401 });
    }
    const sessionId = (body.sessionId || "").trim();
    if (!sessionId) {
      return NextResponse.json({ ok: false, error: "sessionId が必要です" }, { status: 400 });
    }
    const ownerName = sanitizeDisplayName(body.authorName || "メンバー");
    const result = await createPrivateRacePick({
      placeNo: Number(body.placeNo || 0),
      raceNo: Number(body.raceNo || 0),
      sessionId,
      ownerName,
      invite,
      forwardedFor: req.headers.get("x-forwarded-for"),
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, retryAfterSec: result.retryAfterSec },
        {
          status: result.status,
          headers: result.retryAfterSec
            ? { "retry-after": String(result.retryAfterSec) }
            : undefined,
        },
      );
    }
    return NextResponse.json({ ok: true, reply: result.reply, private: true });
  }

  // 雑談: 公開。テキストからの自動予想はしない（予想は predict）。
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
      meta: { visibility: "public", mode: "casual" },
    });
    return NextResponse.json({ ok: true, message });
  }

  // Picks / note: operator only（公開のお知らせ）。
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
    visibility?: "public";
  } = { visibility: "public" };

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
      visibility: "public",
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

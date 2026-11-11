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
import {
  CHAT_SESSION_COOKIE,
  chatSessionCookieOptions,
  mintChatSessionCookieValue,
  newChatSessionId,
  verifyChatSessionCookieValue,
} from "@/lib/chatSession";
import { allowAuthAttempt } from "@/lib/authRateLimit";
import { STADIUMS } from "@/lib/stadiums";
import { refreshPicksStatus } from "@/lib/refreshPicksStatus";

export const dynamic = "force-dynamic";

function viewerSessionId(req: NextRequest): string | null {
  return verifyChatSessionCookieValue(req.cookies.get(CHAT_SESSION_COOKIE)?.value);
}

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

async function createAppRacePick(opts: {
  placeNo: number;
  raceNo: number;
  sessionId: string;
  ownerName: string;
  invite: string | null | undefined;
  forwardedFor: string | null;
}): Promise<
  | {
      ok: true;
      reply: Awaited<ReturnType<typeof appendChatMessage>>;
      adminLog: Awaited<ReturnType<typeof appendChatMessage>>;
    }
  | { ok: false; error: string; status: number; retryAfterSec?: number }
> {
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
    // 依頼した友達本人だけにアプリ予想本文を見せる（共有チャットは汚さない）
    const reply = await appendChatMessage({
      kind: "note",
      title: `${placeName}${opts.raceNo}R アプリ予想`,
      body: built.text,
      author_name: "律丸ボート部",
      author_role: "operator",
      meta: {
        date: built.dateKey,
        mode: "app_race_pick",
        count: built.tickets.length,
        placeNo: built.placeNo,
        raceNo: built.raceNo,
        tickets: [...built.tickets, ...built.anaTickets],
        visibility: "private",
        owner_session_id: opts.sessionId,
        owner_name: opts.ownerName,
      },
    });
    // 管理人専用チャット: 誰がどのレースを見たかだけ短く残す
    const adminLog = await appendChatMessage({
      kind: "note",
      title: "予想ログ",
      body: `${opts.ownerName} が ${placeName}${opts.raceNo}R のアプリ予想を表示しました。`,
      author_name: "システム",
      author_role: "operator",
      meta: {
        date: built.dateKey,
        mode: "admin_predict_log",
        placeNo: built.placeNo,
        raceNo: built.raceNo,
        tickets: [...built.tickets, ...built.anaTickets],
        visibility: "admin",
        owner_session_id: opts.sessionId,
        owner_name: opts.ownerName,
      },
    });
    return { ok: true, reply, adminLog };
  } catch {
    return {
      ok: false,
      error: `${placeName}${opts.raceNo}R の予測取得に失敗しました。少し待って再送してください。`,
      status: 502,
    };
  }
}

export async function GET(req: NextRequest) {
  const invite = req.headers.get("x-chat-invite");
  if (!checkInvite(invite)) {
    return NextResponse.json(
      { ok: false, error: "招待コードが違います" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  // 視聴者IDは署名付き httpOnly クッキーのみ（クエリの session は信用しない）
  const sessionId = viewerSessionId(req) || "";
  const presenceName = req.nextUrl.searchParams.get("name") || "";
  const adminKeyHdr = req.headers.get("x-chat-admin") || req.headers.get("x-chat-operator") || "";
  const isAdmin = checkAdmin(adminKeyHdr);
  const operatorKeyHdr = req.headers.get("x-chat-operator") || "";
  const presenceRole = checkOperator(operatorKeyHdr) ? "operator" : "member";
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
    listPresence(sessionId).catch(() => []),
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
      hasSession: Boolean(sessionId),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  let body: {
    invite?: string;
    operatorKey?: string;
    adminKey?: string;
    kind?: ChatKind | "clear" | "leave" | "predict" | "enter";
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
  const cookieSession = viewerSessionId(req);

  if (kind === "enter") {
    const ip = req.headers.get("x-forwarded-for") || "local";
    const gate = allowAuthAttempt(`chat-enter:${ip}`, { limit: 40, windowMs: 10 * 60 * 1000 });
    if (!gate.ok) {
      return NextResponse.json(
        { ok: false, error: "試行回数が多すぎます。しばらくしてから再度お試しください。" },
        {
          status: 429,
          headers: gate.retryAfterSec ? { "retry-after": String(gate.retryAfterSec) } : undefined,
        },
      );
    }
    if (!checkInvite(invite)) {
      return NextResponse.json({ ok: false, error: "招待コードが違います" }, { status: 401 });
    }
    const authorName = sanitizeDisplayName(body.authorName || "メンバー");
    const sessionId = cookieSession || newChatSessionId();
    await touchPresence({
      sessionId,
      displayName: authorName,
      role: isOperator ? "operator" : "member",
    }).catch(() => null);
    const res = NextResponse.json({
      ok: true,
      entered: true,
      displayName: authorName,
    });
    res.cookies.set(
      CHAT_SESSION_COOKIE,
      mintChatSessionCookieValue(sessionId),
      chatSessionCookieOptions(),
    );
    return res;
  }

  if (kind === "leave") {
    if (!checkInvite(invite) && !isOperator) {
      return NextResponse.json({ ok: false, error: "招待コードが違います" }, { status: 401 });
    }
    const sid = cookieSession || "";
    if (sid) await leavePresence(sid).catch(() => null);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(CHAT_SESSION_COOKIE, "", { ...chatSessionCookieOptions(0), maxAge: 0 });
    return res;
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

  // レース詳細のアプリ予想: 本文は本人だけ。共有チャットの本命配信とは別。
  if (kind === "predict") {
    if (!checkInvite(invite) && !isOperator) {
      return NextResponse.json({ ok: false, error: "招待コードが違います" }, { status: 401 });
    }
    const sessionId = cookieSession || "";
    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "先に入場してください" },
        { status: 401 },
      );
    }
    const ownerName = sanitizeDisplayName(body.authorName || "メンバー");
    const result = await createAppRacePick({
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
    return NextResponse.json({
      ok: true,
      reply: result.reply,
      private: true,
    });
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
      mode: "honmei_board",
      count: built.count,
      skipped: built.skippedCount,
      visibility: "public",
    };
    title = built.title.startsWith("本命") ? built.title : `本命予想 ${built.title}`;
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

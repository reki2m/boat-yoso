import { NextRequest, NextResponse } from "next/server";
import picksBoard from "@/data/picks_board.json";
import { buildPicksMessage } from "@/lib/buildPicksMessage";
import {
  appendChatMessage,
  checkAdmin,
  checkInvite,
  checkOperator,
  clearChatMessages,
  getChatMessageById,
  listChatMetaByPrefix,
  patchChatMessageMeta,
  readChatFeed,
  sanitizeChatBody,
  sanitizeDisplayName,
  setChatMetaValue,
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
import { allowAuthAttemptShared } from "@/lib/authRateLimit";
import { listAdminPredictionOversight } from "@/lib/chatAdminOversight";
import {
  alreadyFinalPosted,
  alreadyWaitingPosted,
  markFinalPosted,
  markWaitingPosted,
} from "@/lib/chatHonmeiFlags";
import { buildRaceChipsFromPicks, buildSingleRaceChip } from "@/lib/chatRaceUi";
import { STADIUMS, jstDateKey } from "@/lib/stadiums";
import { refreshPicksStatus } from "@/lib/refreshPicksStatus";
import {
  enrichChatMessagesWithResults,
  enrichWaitingWithExhibitionConfirmed,
} from "@/lib/chatResultEnrich";
import {
  parsePurchaseLock,
  todayTargetPurchaseKey,
  todayTargetPurchasePrefix,
  type PurchaseLockState,
} from "@/lib/chatPurchase";
import { discordDisplayName, sendDiscordMessage } from "@/lib/discordNotify";

export const dynamic = "force-dynamic";

function viewerSessionId(req: NextRequest): string | null {
  return verifyChatSessionCookieValue(req.cookies.get(CHAT_SESSION_COOKIE)?.value);
}

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

function rateLimited(
  error: string,
  retryAfterSec?: number,
): NextResponse {
  return NextResponse.json(
    { ok: false, error, retryAfterSec },
    {
      status: 429,
      headers: {
        "cache-control": "no-store",
        ...(retryAfterSec ? { "retry-after": String(retryAfterSec) } : {}),
      },
    },
  );
}

/** Discord 送信（DISCORD_MIRROR_ENABLED=1 時）。 */
async function mirrorDiscord(body: string): Promise<{ ok: boolean; detail?: string }> {
  return sendDiscordMessage(body);
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
  // 同一場・同一Rの再取得は上限カウントしない（1〜12Rを通しで見られるように）
  const raceKey = `${jstDateKey()}:${opts.placeNo}:${opts.raceNo}`;
  const gate = await allowRaceReply(bucket, { raceKey });
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
    const tickets = built.tickets;
    const bands = built.bands;
    const raceChip = buildSingleRaceChip({
      placeNo: built.placeNo,
      placeName,
      raceNo: built.raceNo,
      tickets,
      bands,
      status: built.status,
      why: built.why,
      confidence: built.confidence,
      confidenceLabel: built.confidenceLabel,
      // AI予想は本命ボードのスルーと混ぜない（waiting / after のみ）
      exhibition: built.status === "confirmed" ? "after" : "waiting",
    });
    // 依頼した友達本人だけにアプリ予想本文を見せる（共有チャットは汚さない）
    const reply = await appendChatMessage({
      kind: "note",
      title: "AI予想",
      body: built.text,
      author_name: "律丸ボート部",
      author_role: "operator",
      meta: {
        date: built.dateKey,
        mode: "app_race_pick",
        count: built.tickets.length,
        placeNo: built.placeNo,
        raceNo: built.raceNo,
        tickets,
        bands,
        confidence: built.confidence,
        confidenceLabel: built.confidenceLabel,
        visibility: "private",
        owner_session_id: opts.sessionId,
        owner_name: opts.ownerName,
        race_label: raceChip.label,
        races: [raceChip],
      },
    });
    // 管理人専用ログ（友達のメッセージ欄には出さない）
    const adminLog = await appendChatMessage({
      kind: "note",
      title: "AI予想ログ",
      body: `${opts.ownerName} が ${raceChip.label} のAI予想を表示しました。`,
      author_name: "システム",
      author_role: "operator",
      meta: {
        date: built.dateKey,
        mode: "admin_predict_log",
        placeNo: built.placeNo,
        raceNo: built.raceNo,
        tickets,
        bands,
        confidence: built.confidence,
        confidenceLabel: built.confidenceLabel,
        visibility: "admin",
        owner_session_id: opts.sessionId,
        owner_name: opts.ownerName,
        race_label: raceChip.label,
        races: [raceChip],
      },
    });
    // 予想ボタン押下を Discord 通知
    await mirrorDiscord(
      `${placeName}${opts.raceNo}レース ${discordDisplayName(opts.ownerName)}がAI予想を表示しました。`,
    ).catch(() => null);
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
  const ip = clientIp(req);
  const invite = req.headers.get("x-chat-invite");
  if (!checkInvite(invite)) {
    const fail = await allowAuthAttemptShared(`chat-invite-fail:${ip}`, {
      limit: 20,
      windowMs: 10 * 60 * 1000,
    });
    if (!fail.ok) {
      return rateLimited(
        "試行回数が多すぎます。しばらくしてから再度お試しください。",
        fail.retryAfterSec,
      );
    }
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
  if (adminKeyHdr && !isAdmin && !checkOperator(adminKeyHdr)) {
    const fail = await allowAuthAttemptShared(`chat-admin-fail:${ip}`, {
      limit: 20,
      windowMs: 10 * 60 * 1000,
    });
    if (!fail.ok) {
      return rateLimited(
        "試行回数が多すぎます。しばらくしてから再度お試しください。",
        fail.retryAfterSec,
      );
    }
  }
  if (refresh) {
    const gate = await allowAuthAttemptShared(`chat-refresh:${sessionId || ip}`, {
      limit: 12,
      windowMs: 10 * 60 * 1000,
    });
    if (!gate.ok) {
      return rateLimited(
        "更新の連続利用は制限されています。しばらくしてから再度お試しください。",
        gate.retryAfterSec,
      );
    }
  }
  if (sessionId && presenceName) {
    await touchPresence({
      sessionId,
      displayName: presenceName,
      role: presenceRole,
    }).catch(() => null);
  }
  await maybeRunChatMaintenance().catch(() => null);
  const [feed, live, presence, adminOversight, targetPurchaseRows] = await Promise.all([
    readChatFeed({ sessionId, isAdmin }),
    getChatLiveTargets({ refresh }),
    listPresence(sessionId).catch(() => []),
    isAdmin ? listAdminPredictionOversight() : Promise.resolve(null),
    sessionId
      ? listChatMetaByPrefix(todayTargetPurchasePrefix(sessionId)).catch(() => [])
      : Promise.resolve([]),
  ]);
  const withResults = await enrichChatMessagesWithResults(feed.messages).catch(
    () => feed.messages,
  );
  const messages = enrichWaitingWithExhibitionConfirmed(withResults, live.targets);
  const targetPurchases: Record<string, PurchaseLockState> = {};
  const prefix = sessionId ? todayTargetPurchasePrefix(sessionId) : "";
  for (const row of targetPurchaseRows) {
    if (!prefix || !row.key.startsWith(prefix)) continue;
    const rest = row.key.slice(prefix.length); // place:race
    const lock = parsePurchaseLock(row.value);
    // skip は解除扱い（通常表示）なので一覧に載せない
    if (lock && lock !== "skip") targetPurchases[rest.replace(":", "-")] = lock;
  }
  return NextResponse.json(
    {
      ok: true,
      updated_at: feed.updated_at,
      messages,
      liveDate: live.date,
      targets: live.targets,
      rules: CHAT_HOUSE_RULES,
      presence,
      isAdmin,
      // 管理人のみ。友達向けレスポンスには載せない
      adminOversight: isAdmin ? adminOversight : undefined,
      hasSession: Boolean(sessionId),
      targetPurchases,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  let body: {
    invite?: string;
    operatorKey?: string;
    adminKey?: string;
    kind?:
      | ChatKind
      | "clear"
      | "leave"
      | "predict"
      | "enter"
      | "purchase_confirm"
      | "target_purchase_confirm";
    note?: string;
    text?: string;
    title?: string;
    authorName?: string;
    sessionId?: string;
    mirrorDiscord?: boolean;
    placeNo?: number;
    raceNo?: number;
    messageId?: string;
    decision?: "yes" | "no" | "purchased" | "skip" | string;
    /** 運営がボードを明示指定する場合（未指定なら data/picks_board.json） */
    picksBoard?: {
      active_date?: string;
      date?: string;
      mode?: string;
      picks?: Array<Record<string, unknown>>;
      note?: string;
    };
    /** ライブ再判定を挟まず、渡した status のまま投稿（展示後デモ・手動確定用） */
    preserveStatus?: boolean;
    races?: ReturnType<typeof buildRaceChipsFromPicks>;
    mode?: string;
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

  const ip = clientIp(req);

  if (kind === "enter") {
    const gate = await allowAuthAttemptShared(`chat-enter:${ip}`, {
      limit: 40,
      windowMs: 10 * 60 * 1000,
    });
    if (!gate.ok) {
      return rateLimited(
        "試行回数が多すぎます。しばらくしてから再度お試しください。",
        gate.retryAfterSec,
      );
    }
    if (!checkInvite(invite)) {
      const fail = await allowAuthAttemptShared(`chat-invite-fail:${ip}`, {
        limit: 20,
        windowMs: 10 * 60 * 1000,
      });
      if (!fail.ok) {
        return rateLimited(
          "試行回数が多すぎます。しばらくしてから再度お試しください。",
          fail.retryAfterSec,
        );
      }
      return NextResponse.json({ ok: false, error: "招待コードが違います" }, { status: 401 });
    }
    const authorName = sanitizeDisplayName(body.authorName || "メンバー");
    const sessionId = cookieSession || newChatSessionId();
    const cookieValue = mintChatSessionCookieValue(sessionId);
    if (!cookieValue) {
      return NextResponse.json(
        {
          ok: false,
          error: "セッション鍵が未設定です",
          hint: "CHAT_SESSION_SECRET（または CHAT_ADMIN_KEY）を設定してください",
        },
        { status: 503 },
      );
    }
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
    res.cookies.set(CHAT_SESSION_COOKIE, cookieValue, chatSessionCookieOptions());
    return res;
  }

  async function rejectBadInvite(): Promise<NextResponse> {
    const fail = await allowAuthAttemptShared(`chat-invite-fail:${ip}`, {
      limit: 20,
      windowMs: 10 * 60 * 1000,
    });
    if (!fail.ok) {
      return rateLimited(
        "試行回数が多すぎます。しばらくしてから再度お試しください。",
        fail.retryAfterSec,
      );
    }
    return NextResponse.json({ ok: false, error: "招待コードが違います" }, { status: 401 });
  }

  if (kind === "leave") {
    if (!checkInvite(invite) && !isOperator) {
      return rejectBadInvite();
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

  // AI予想: 購入予定 YES/NO → 展示後 スルー/購入済み
  if (kind === "purchase_confirm") {
    if (!checkInvite(invite) && !isOperator) {
      return rejectBadInvite();
    }
    const sessionId = cookieSession || "";
    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "先に入場してください" },
        { status: 401 },
      );
    }
    const decision = parsePurchaseLock(String(body.decision || ""));
    if (!decision) {
      return NextResponse.json(
        { ok: false, error: "decision は yes/no/purchased/skip です" },
        { status: 400 },
      );
    }
    const messageId = String(body.messageId || "").trim();
    if (!messageId) {
      return NextResponse.json({ ok: false, error: "messageId が必要です" }, { status: 400 });
    }
    const gate = await allowAuthAttemptShared(`chat-purchase:${sessionId}`, {
      limit: 60,
      windowMs: 10 * 60 * 1000,
    });
    if (!gate.ok) {
      return rateLimited(
        "操作が多すぎます。しばらくしてから再度お試しください。",
        gate.retryAfterSec,
      );
    }
    const target = await getChatMessageById(messageId);
    if (!target || target.meta?.mode !== "app_race_pick") {
      return NextResponse.json({ ok: false, error: "対象の予想が見つかりません" }, { status: 404 });
    }
    if (target.meta?.owner_session_id !== sessionId) {
      return NextResponse.json({ ok: false, error: "本人の予想のみ回答できます" }, { status: 403 });
    }
    const current = target.meta?.purchaseDecision;
    if (current === "purchased" && decision !== "purchased") {
      return NextResponse.json({ ok: true, already: true, decision: "purchased" });
    }
    if (
      (decision === "yes" || decision === "no") &&
      (current === "yes" || current === "purchased")
    ) {
      return NextResponse.json({ ok: true, already: true, decision: current });
    }
    const ownerName = sanitizeDisplayName(
      body.authorName || target.meta?.owner_name || "メンバー",
    );
    const placeNo = Number(target.meta?.placeNo || 0);
    const raceNo = Number(target.meta?.raceNo || 0);
    const placeName = STADIUMS[placeNo] || `場${placeNo}`;
    const chip = Array.isArray(target.meta?.races) ? target.meta!.races![0] : null;
    const lockedExhibition =
      chip?.exhibition === "after" || chip?.status === "confirmed" || chip?.status === "skipped"
        ? "after"
        : chip?.exhibition === "waiting" ||
            chip?.status === "provisional" ||
            chip?.status === "programs_unavailable"
          ? "waiting"
          : target.meta?.purchaseLockedExhibition || "unknown";

    const nextDecision: PurchaseLockState = decision === "skip" ? "skip" : decision;
    await patchChatMessageMeta(messageId, {
      purchaseDecision: nextDecision === "skip" ? undefined : nextDecision,
      purchaseLockedExhibition: nextDecision === "yes" ? lockedExhibition : undefined,
      owner_name: ownerName,
    });

    let discordOk = false;
    if (decision === "yes") {
      const mirrored = await mirrorDiscord(
        `${placeName}${raceNo}レース ${discordDisplayName(ownerName)}が購入予定でロックしました。`,
      );
      discordOk = mirrored.ok;
      await appendChatMessage({
        kind: "note",
        title: "ロック中",
        body: `${placeName}${raceNo}R を購入予定でロックしました。${
          lockedExhibition === "waiting"
            ? "展示後に「スルー推奨 / 購入済み」を選べます。"
            : ""
        }`,
        author_name: "律丸ボート部",
        author_role: "operator",
        meta: {
          date: target.meta?.date || jstDateKey(),
          mode: "purchase_ack",
          placeNo,
          raceNo,
          visibility: "private",
          owner_session_id: sessionId,
          owner_name: ownerName,
          purchaseDecision: "yes",
          purchaseLockedExhibition: lockedExhibition,
          discord: discordOk,
        },
      });
    } else if (decision === "purchased") {
      const mirrored = await mirrorDiscord(
        `${placeName}${raceNo}レース ${discordDisplayName(ownerName)}が買いました。`,
      );
      discordOk = mirrored.ok;
      await appendChatMessage({
        kind: "note",
        title: "購入済み",
        body: `${placeName}${raceNo}R を購入済みで固定しました（結果が出たら払戻をDiscordへ通知）。`,
        author_name: "律丸ボート部",
        author_role: "operator",
        meta: {
          date: target.meta?.date || jstDateKey(),
          mode: "purchase_ack",
          placeNo,
          raceNo,
          visibility: "private",
          owner_session_id: sessionId,
          owner_name: ownerName,
          purchaseDecision: "purchased",
          discord: discordOk,
        },
      });
    } else if (decision === "skip") {
      await appendChatMessage({
        kind: "note",
        title: "スルー",
        body: `${placeName}${raceNo}R のロックを解除しました（通常表示に戻します）。`,
        author_name: "律丸ボート部",
        author_role: "operator",
        meta: {
          date: target.meta?.date || jstDateKey(),
          mode: "purchase_ack",
          placeNo,
          raceNo,
          visibility: "private",
          owner_session_id: sessionId,
          owner_name: ownerName,
          purchaseDecision: "skip",
        },
      });
    } else {
      await appendChatMessage({
        kind: "note",
        title: "見送り",
        body: `${placeName}${raceNo}R は購入予定なしにしました。`,
        author_name: "律丸ボート部",
        author_role: "operator",
        meta: {
          date: target.meta?.date || jstDateKey(),
          mode: "purchase_ack",
          placeNo,
          raceNo,
          visibility: "private",
          owner_session_id: sessionId,
          owner_name: ownerName,
          purchaseDecision: "no",
        },
      });
    }
    return NextResponse.json({
      ok: true,
      decision: nextDecision === "skip" ? null : nextDecision,
      discord: { ok: discordOk },
    });
  }

  // 本命対象レースごと: 購入予定 YES/NO → 展示後 スルー/購入済み
  if (kind === "target_purchase_confirm") {
    if (!checkInvite(invite) && !isOperator) {
      return rejectBadInvite();
    }
    const sessionId = cookieSession || "";
    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "先に入場してください" },
        { status: 401 },
      );
    }
    const decision = parsePurchaseLock(String(body.decision || ""));
    if (!decision) {
      return NextResponse.json(
        { ok: false, error: "decision は yes/no/purchased/skip です" },
        { status: 400 },
      );
    }
    const placeNo = Number(body.placeNo || 0);
    const raceNo = Number(body.raceNo || 0);
    if (!Number.isInteger(placeNo) || placeNo < 1 || placeNo > 24 || raceNo < 1 || raceNo > 12) {
      return NextResponse.json({ ok: false, error: "場またはレースが不正です" }, { status: 400 });
    }
    const gate = await allowAuthAttemptShared(`chat-target-purchase:${sessionId}`, {
      limit: 60,
      windowMs: 10 * 60 * 1000,
    });
    if (!gate.ok) {
      return rateLimited(
        "操作が多すぎます。しばらくしてから再度お試しください。",
        gate.retryAfterSec,
      );
    }
    const metaKey = todayTargetPurchaseKey(sessionId, placeNo, raceNo);
    const ownerName = sanitizeDisplayName(body.authorName || "メンバー");
    const placeName = STADIUMS[placeNo] || `場${placeNo}`;
    const live = await getChatLiveTargets({ refresh: false }).catch(() => null);
    const target = live?.targets?.find((t) => t.stadium === placeNo && t.race === raceNo);
    const exhibitDone = target?.status === "confirmed" || target?.status === "skipped";

    if (decision === "skip") {
      await setChatMetaValue(metaKey, "skip");
      await appendChatMessage({
        kind: "note",
        title: "スルー",
        body: `${placeName}${raceNo}R（本命対象）のロックを解除しました。`,
        author_name: "律丸ボート部",
        author_role: "operator",
        meta: {
          date: jstDateKey(),
          mode: "target_purchase_ack",
          placeNo,
          raceNo,
          visibility: "private",
          owner_session_id: sessionId,
          owner_name: ownerName,
          purchaseDecision: "skip",
        },
      });
      return NextResponse.json({ ok: true, decision: null, key: `${placeNo}-${raceNo}` });
    }

    await setChatMetaValue(metaKey, decision);
    let discordOk = false;
    if (decision === "yes") {
      const mirrored = await mirrorDiscord(
        `${placeName}${raceNo}レース ${discordDisplayName(ownerName)}が本命対象を購入予定でロックしました。`,
      );
      discordOk = mirrored.ok;
      await appendChatMessage({
        kind: "note",
        title: "ロック中",
        body: `${placeName}${raceNo}R（本命対象）を購入予定でロックしました。${
          exhibitDone ? "" : "展示後に「スルー推奨 / 購入済み」を選べます。"
        }`,
        author_name: "律丸ボート部",
        author_role: "operator",
        meta: {
          date: jstDateKey(),
          mode: "target_purchase_ack",
          placeNo,
          raceNo,
          visibility: "private",
          owner_session_id: sessionId,
          owner_name: ownerName,
          purchaseDecision: "yes",
          purchaseLockedExhibition: exhibitDone ? "after" : "waiting",
          discord: discordOk,
        },
      });
    } else if (decision === "purchased") {
      const mirrored = await mirrorDiscord(
        `${placeName}${raceNo}レース ${discordDisplayName(ownerName)}が本命対象を買いました。`,
      );
      discordOk = mirrored.ok;
      await appendChatMessage({
        kind: "note",
        title: "購入済み",
        body: `${placeName}${raceNo}R（本命対象）を購入済みで固定しました。`,
        author_name: "律丸ボート部",
        author_role: "operator",
        meta: {
          date: jstDateKey(),
          mode: "target_purchase_ack",
          placeNo,
          raceNo,
          visibility: "private",
          owner_session_id: sessionId,
          owner_name: ownerName,
          purchaseDecision: "purchased",
          discord: discordOk,
        },
      });
    } else {
      await appendChatMessage({
        kind: "note",
        title: "見送り",
        body: `${placeName}${raceNo}R（本命対象）は購入予定なしにしました。`,
        author_name: "律丸ボート部",
        author_role: "operator",
        meta: {
          date: jstDateKey(),
          mode: "target_purchase_ack",
          placeNo,
          raceNo,
          visibility: "private",
          owner_session_id: sessionId,
          owner_name: ownerName,
          purchaseDecision: "no",
        },
      });
    }
    return NextResponse.json({
      ok: true,
      decision,
      key: `${placeNo}-${raceNo}`,
      discord: { ok: discordOk },
    });
  }

  // レース詳細のアプリ予想: 本文は本人だけ。共有チャットの本命配信とは別。
  if (kind === "predict") {
    if (!checkInvite(invite) && !isOperator) {
      return rejectBadInvite();
    }
    const sessionId = cookieSession || "";
    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "先に入場してください" },
        { status: 401 },
      );
    }
    const predictGate = await allowAuthAttemptShared(`chat-predict:${sessionId}`, {
      limit: 10,
      windowMs: 10 * 60 * 1000,
    });
    if (!predictGate.ok) {
      return rateLimited(
        "予測の連続利用は制限されています。しばらくしてから再度お試しください。",
        predictGate.retryAfterSec,
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
      return rejectBadInvite();
    }
    const text = sanitizeChatBody(body.text || body.note);
    if (!text) {
      return NextResponse.json({ ok: false, error: "メッセージが空です" }, { status: 400 });
    }
    const role: ChatRole = isAdmin || isOperator ? "operator" : "member";
    const authorName = sanitizeDisplayName(
      body.authorName || (role === "operator" ? "管理人" : "メンバー"),
    );
    // 管理人/運営の発言は全ユーザーのチャット欄に残す（公開）
    const message = await appendChatMessage({
      kind: "chat",
      title: role === "operator" ? "管理人" : authorName,
      body: text,
      author_name: authorName,
      author_role: role,
      meta: { visibility: "public", mode: "casual" },
    });
    return NextResponse.json({ ok: true, message });
  }

  // Picks / note: operator only（公開のお知らせ）。
  if (!isOperator) {
    const fail = await allowAuthAttemptShared(`chat-admin-fail:${ip}`, {
      limit: 20,
      windowMs: 10 * 60 * 1000,
    });
    if (!fail.ok) {
      return rateLimited(
        "試行回数が多すぎます。しばらくしてから再度お試しください。",
        fail.retryAfterSec,
      );
    }
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
    races?: ReturnType<typeof buildRaceChipsFromPicks>;
  } = { visibility: "public" };

  if (kind === "picks") {
    const board = (body.picksBoard || picksBoard) as {
      active_date?: string;
      date?: string;
      mode?: string;
      picks?: Array<Record<string, unknown>>;
      note?: string;
    };
    const mapped = (board.picks || []).map((p) => ({
      date: String(p.date || board.active_date || board.date || ""),
      stadium: Number(p.stadium || 0),
      stadium_name: typeof p.stadium_name === "string" ? p.stadium_name : undefined,
      race: Number(p.race || 0),
      tickets: Array.isArray(p.tickets) ? (p.tickets as string[]) : undefined,
      status: typeof p.status === "string" ? p.status : undefined,
      why: typeof p.why === "string" ? p.why : undefined,
      skip_reason: typeof p.skip_reason === "string" ? p.skip_reason : null,
      skip_detail: typeof p.skip_detail === "string" ? p.skip_detail : null,
    }));
    const livePicks = body.preserveStatus ? mapped : await refreshPicksStatus(mapped);
    const dateKey = String(
      board.active_date || board.date || livePicks[0]?.date || "",
    ).replace(/-/g, "");

    // 展示待ち / 確定・スルーはレースごと1回だけ投稿
    const fresh = [];
    for (const p of livePicks) {
      const stadium = Number(p.stadium || 0);
      const race = Number(p.race || 0);
      if (!stadium || !race || !/^\d{8}$/.test(dateKey)) {
        fresh.push(p);
        continue;
      }
      const isFinal = p.status === "confirmed" || p.status === "skipped";
      if (isFinal) {
        if (await alreadyFinalPosted(dateKey, stadium, race)) continue;
      } else if (await alreadyWaitingPosted(dateKey, stadium, race)) {
        continue;
      }
      fresh.push(p);
    }

    if (!fresh.length) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "already_posted_for_phase",
        message: null,
      });
    }

    const built = buildPicksMessage({
      active_date: board.active_date || dateKey,
      date: board.date || dateKey,
      mode: board.mode,
      note: board.note,
      picks: fresh,
    });
    title = built.title.startsWith("本命") ? built.title : `本命予想 ${built.title}`;
    text = built.body;
    const raceChips = buildRaceChipsFromPicks(fresh).map((chip) => {
      if (
        board.mode === "exhibition_after_honmei" &&
        (chip.status === "confirmed" || chip.status === "skipped")
      ) {
        return { ...chip, exhibition: "after" as const };
      }
      return chip;
    });
    meta = {
      date: built.dateKey,
      mode:
        board.mode === "exhibition_after_honmei" ? "exhibition_after_honmei" : "honmei_board",
      count: built.count,
      skipped: built.skippedCount,
      visibility: "public",
      races: raceChips,
    };

    for (const p of fresh) {
      const stadium = Number(p.stadium || 0);
      const race = Number(p.race || 0);
      if (!stadium || !race || !/^\d{8}$/.test(dateKey)) continue;
      if (p.status === "confirmed" || p.status === "skipped") {
        await markFinalPosted(dateKey, stadium, race);
        await markWaitingPosted(dateKey, stadium, race);
      } else {
        await markWaitingPosted(dateKey, stadium, race);
      }
    }
  } else if (!text) {
    return NextResponse.json({ ok: false, error: "メモ本文が空です" }, { status: 400 });
  } else {
    if (body.title) title = String(body.title).slice(0, 80);
    if (body.mode) meta.mode = String(body.mode).slice(0, 64);
    if (Array.isArray(body.races) && body.races.length) {
      meta.races = body.races;
    }
  }

  let discordOk = false;
  let discordDetail: string | undefined;
  // 既定はオフ。明示的に mirrorDiscord=true のときだけ外部送信。
  if (body.mirrorDiscord === true) {
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

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { inviteCode } from "@/lib/chatStore";

export const CHAT_SESSION_COOKIE = "shioyomi_chat_sid";

/**
 * セッション署名鍵は CHAT_SESSION_SECRET 専用。
 * 本番では管理人/運営キーへのフォールバックをしない（鍵共用の危険を避ける）。
 */
function sessionSecret(): string {
  const dedicated = process.env.CHAT_SESSION_SECRET?.trim();
  if (dedicated) return dedicated;
  if (process.env.NODE_ENV === "production") return "";
  return "shio-session-dev";
}

/** 招待コード指紋。コード変更で既存セッションを無効化する。 */
function inviteFingerprint(): string {
  const inv = inviteCode();
  if (!inv) return "";
  return createHash("sha256").update(`invite-v1:${inv}`).digest("hex").slice(0, 24);
}

function sign(sessionId: string): string {
  const secret = sessionSecret();
  const invFp = inviteFingerprint();
  if (!secret || !invFp) return "";
  return createHmac("sha256", secret)
    .update(`chat-sid-v2:${invFp}:${sessionId}`)
    .digest("hex");
}

export function newChatSessionId(): string {
  return `s_${randomBytes(18).toString("hex")}`;
}

/** httpOnly クッキー用の署名付き値 */
export function mintChatSessionCookieValue(sessionId: string): string {
  const sig = sign(sessionId);
  if (!sig) return "";
  return `${sessionId}.${sig}`;
}

export function verifyChatSessionCookieValue(
  raw: string | null | undefined,
): string | null {
  if (!sessionSecret() || !inviteFingerprint()) return null;
  const text = (raw || "").trim();
  const i = text.lastIndexOf(".");
  if (i <= 0) return null;
  const sessionId = text.slice(0, i);
  const sig = text.slice(i + 1);
  if (!sessionId || !sig) return null;
  const expected = sign(sessionId);
  if (!expected) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  try {
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return sessionId;
}

/** 入室一覧用の公開ID（生の session_id は返さない） */
export function publicPresenceId(sessionId: string): string {
  return createHash("sha256").update(`presence:${sessionId}`).digest("hex").slice(0, 20);
}

export function chatSessionCookieOptions(maxAgeSec = 60 * 60 * 24 * 30) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSec,
  };
}

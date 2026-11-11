import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { inviteCode } from "@/lib/chatStore";

export const CHAT_SESSION_COOKIE = "shioyomi_chat_sid";

function sessionSecret(): string {
  return (
    process.env.CHAT_INVITE_CODE?.trim() ||
    process.env.CHAT_OPERATOR_KEY?.trim() ||
    (process.env.NODE_ENV === "production" ? "" : "shio-invite")
  );
}

function sign(sessionId: string): string {
  return createHmac("sha256", sessionSecret()).update(`chat-sid-v1:${sessionId}`).digest("hex");
}

export function newChatSessionId(): string {
  return `s_${randomBytes(18).toString("hex")}`;
}

/** httpOnly クッキー用の署名付き値 */
export function mintChatSessionCookieValue(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

export function verifyChatSessionCookieValue(
  raw: string | null | undefined,
): string | null {
  const text = (raw || "").trim();
  const i = text.lastIndexOf(".");
  if (i <= 0) return null;
  const sessionId = text.slice(0, i);
  const sig = text.slice(i + 1);
  if (!sessionId || !sig) return null;
  const expected = sign(sessionId);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  try {
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  // 招待コードが変わったら旧セッションを無効化
  if (!inviteCode()) return null;
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

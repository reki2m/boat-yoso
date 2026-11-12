import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { inviteCode } from "@/lib/chatStore";

export const CHAT_SESSION_COOKIE = "shioyomi_chat_sid";

/**
 * 招待コードは共有されるため署名鍵に使わない。
 * CHAT_SESSION_SECRET（推奨）→ 管理人/運営キー → 開発用フォールバック。
 */
function sessionSecret(): string {
  return (
    process.env.CHAT_SESSION_SECRET?.trim() ||
    process.env.CHAT_ADMIN_KEY?.trim() ||
    process.env.CHAT_OPERATOR_KEY?.trim() ||
    (process.env.NODE_ENV === "production" ? "" : "shio-session-dev")
  );
}

function sign(sessionId: string): string {
  const secret = sessionSecret();
  if (!secret) return "";
  return createHmac("sha256", secret).update(`chat-sid-v1:${sessionId}`).digest("hex");
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
  if (!sessionSecret()) return null;
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
  // 招待コードが無効なら入場自体を拒否（旧セッションも無効）
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

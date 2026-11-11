import { createHmac, timingSafeEqual } from "crypto";
import { checkAdmin, checkOperator } from "@/lib/chatStore";
import { normalizeSecret } from "@/lib/chatSecurity";

export const APP_GATE_COOKIE = "shioyomi_app_gate";

function gateSecret(): string {
  // middleware と同じシード順
  return (
    normalizeSecret(process.env.CHAT_ADMIN_KEY) ||
    normalizeSecret(process.env.CHAT_OPERATOR_KEY) ||
    (process.env.NODE_ENV === "production" ? "" : "shio-op")
  );
}

export function appGateToken(): string {
  return createHmac("sha256", gateSecret()).update("shioyomi-app-v1").digest("hex");
}

export function checkAppGateToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const expected = appGateToken();
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** アプリ解錠: 管理人キー or 運営キー */
export function checkAppUnlockKey(key: string | null | undefined): boolean {
  return checkAdmin(key) || checkOperator(key);
}

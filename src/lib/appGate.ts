import { checkAdmin, checkOperator, adminKey, operatorKey } from "@/lib/chatStore";
import { normalizeSecret } from "@/lib/chatSecurity";

export const APP_GATE_COOKIE = "shioyomi_app_gate";

function gateSecret(): string {
  // middleware と同じシード順・同じ正規化
  return (
    normalizeSecret(process.env.CHAT_ADMIN_KEY) ||
    normalizeSecret(process.env.CHAT_OPERATOR_KEY) ||
    (process.env.NODE_ENV === "production" ? "" : "shio-op")
  );
}

/** Edge middleware と同じ Web Crypto HMAC（Node createHmac との差を避ける） */
export async function appGateToken(): Promise<string> {
  const secret = gateSecret();
  if (!secret) return "";
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("shioyomi-app-v1"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function checkAppGateToken(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const expected = await appGateToken();
  if (!expected || token.length !== expected.length) return false;
  // 簡易 constant-time 風比較
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** 本番で鍵が Secrets に載っているか */
export function appUnlockKeysConfigured(): boolean {
  return Boolean(adminKey() || operatorKey());
}

/** アプリ解錠: 管理人キー or 運営キー */
export function checkAppUnlockKey(key: string | null | undefined): boolean {
  return checkAdmin(key) || checkOperator(key);
}

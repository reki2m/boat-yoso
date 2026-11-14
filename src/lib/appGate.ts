import { checkAdmin, adminKey } from "@/lib/chatStore";
import { normalizeSecret, safeEqualText } from "@/lib/chatSecurity";

export const APP_GATE_COOKIE = "shioyomi_app_gate";

/** 本体解錠用。リセット時はこれを新規設定する。 */
export function appUnlockKey(): string {
  return normalizeSecret(process.env.APP_UNLOCK_KEY);
}

function gateSecret(): string {
  // middleware と同じシード順・同じ正規化（運営キーでは解錠しない）
  return (
    appUnlockKey() ||
    normalizeSecret(process.env.CHAT_ADMIN_KEY) ||
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
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** 本番で鍵が Secrets に載っているか（解錠は unlock / admin のみ） */
export function appUnlockKeysConfigured(): boolean {
  return Boolean(appUnlockKey() || adminKey());
}

function checkAppUnlockOnly(key: string | null | undefined): boolean {
  const expected = appUnlockKey();
  const got = normalizeSecret(key);
  return Boolean(expected && got && safeEqualText(got, expected));
}

/** アプリ解錠: APP_UNLOCK_KEY（優先） / 管理人キー。運営キーは解錠不可。 */
export function checkAppUnlockKey(key: string | null | undefined): boolean {
  return checkAppUnlockOnly(key) || checkAdmin(key);
}

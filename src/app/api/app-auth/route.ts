import { NextRequest, NextResponse } from "next/server";
import {
  APP_GATE_COOKIE,
  appGateToken,
  appUnlockKeysConfigured,
  checkAppGateToken,
  checkAppUnlockKey,
} from "@/lib/appGate";
import { allowAuthAttemptShared } from "@/lib/authRateLimit";
import { checkInvite } from "@/lib/chatStore";
import { normalizeSecret } from "@/lib/chatSecurity";

export const dynamic = "force-dynamic";

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // 公開ホストは HTTPS。ローカル http でも動くよう production のみ secure
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(APP_GATE_COOKIE)?.value;
  const ok = await checkAppGateToken(token);
  return NextResponse.json(
    { ok, gated: true, keysConfigured: appUnlockKeysConfigured() },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  let body: { key?: string; action?: "login" | "logout" } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  if (body.action === "logout") {
    const res = NextResponse.json({ ok: true, unlocked: false });
    res.cookies.set(APP_GATE_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
    return res;
  }

  if (!appUnlockKeysConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: "管理人キーがサーバーに未設定です",
        hint: "Cursor Apps の Secrets に APP_UNLOCK_KEY（または CHAT_ADMIN_KEY）を入れ、再公開してください",
      },
      { status: 503 },
    );
  }

  const key = normalizeSecret(body.key);
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "管理人キーを入力してください" },
      { status: 400 },
    );
  }

  // 失敗時のみレート制限（成功ログインを消費しない）
  if (!checkAppUnlockKey(key)) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const gate = await allowAuthAttemptShared(`app-auth-fail:${ip}`, {
      limit: 20,
      windowMs: 10 * 60 * 1000,
    });
    if (!gate.ok) {
      return NextResponse.json(
        { ok: false, error: "試行回数が多すぎます。しばらくしてから再度お試しください。" },
        {
          status: 429,
          headers: gate.retryAfterSec ? { "retry-after": String(gate.retryAfterSec) } : undefined,
        },
      );
    }
    const looksLikeInvite = checkInvite(key);
    return NextResponse.json(
      {
        ok: false,
        error: looksLikeInvite
          ? "それは招待コードです。本体は APP_UNLOCK_KEY（または CHAT_ADMIN_KEY）で開けます"
          : "管理人キーが違います",
        hint: "Cursor の Apps → Secrets で APP_UNLOCK_KEY の値を入力してください（名前ではなく値、招待コード不可）",
      },
      { status: 401 },
    );
  }

  const token = await appGateToken();
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "解錠トークンを発行できませんでした" },
      { status: 503 },
    );
  }
  const res = NextResponse.json({ ok: true, unlocked: true });
  res.cookies.set(APP_GATE_COOKIE, token, cookieOptions());
  return res;
}

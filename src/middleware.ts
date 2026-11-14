import { NextRequest, NextResponse } from "next/server";

const APP_GATE_COOKIE = "shioyomi_app_gate";

function gateSecret(): string {
  const strip = (v: string | undefined) =>
    String(v || "")
      .normalize("NFKC")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .trim();
  // 運営キーでは本体解錠しない（APP_UNLOCK / 管理人キーのみ）
  const unlock = strip(process.env.APP_UNLOCK_KEY);
  const admin = strip(process.env.CHAT_ADMIN_KEY);
  return unlock || admin || (process.env.NODE_ENV === "production" ? "" : "shio-op");
}

async function expectedToken(secret: string): Promise<string> {
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

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/chat" ||
    pathname.startsWith("/chat/") ||
    // チャットは招待コードで別認証（本体ゲート対象外）
    pathname.startsWith("/api/chat") ||
    // Vercel Cron / CRON_SECRET はルート側で検証
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/app-auth") ||
    pathname === "/login" ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/icons")
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const secret = gateSecret();
  if (!secret) {
    // 本番でキー未設定ならアプリ側も塞ぐ（チャットは招待制のまま）
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "アプリ鍵未設定" }, { status: 503 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const token = req.cookies.get(APP_GATE_COOKIE)?.value || "";
  const expected = await expectedToken(secret);
  if (token && token === expected) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: "アプリは管理人のみです" },
      { status: 401 },
    );
  }

  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};

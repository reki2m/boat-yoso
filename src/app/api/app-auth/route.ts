import { NextRequest, NextResponse } from "next/server";
import {
  APP_GATE_COOKIE,
  appGateToken,
  checkAppGateToken,
  checkAppUnlockKey,
} from "@/lib/appGate";

export const dynamic = "force-dynamic";

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(APP_GATE_COOKIE)?.value;
  const ok = checkAppGateToken(token);
  return NextResponse.json(
    { ok, gated: true },
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

  if (!checkAppUnlockKey(body.key)) {
    return NextResponse.json(
      { ok: false, error: "管理人キーが違います" },
      { status: 401 },
    );
  }

  const res = NextResponse.json({ ok: true, unlocked: true });
  res.cookies.set(APP_GATE_COOKIE, appGateToken(), cookieOptions());
  return res;
}

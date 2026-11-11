import { NextRequest, NextResponse } from "next/server";
import { maybePostMorningHonmeiPicks } from "@/lib/chatMorningPicks";
import { checkAdmin, checkOperator } from "@/lib/chatStore";

export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const cron = process.env.CRON_SECRET?.trim();
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (cron && bearer && bearer === cron) return true;
  const key =
    req.headers.get("x-chat-operator") ||
    req.headers.get("x-chat-admin") ||
    req.nextUrl.searchParams.get("key") ||
    "";
  return checkOperator(key) || checkAdmin(key);
}

/** 朝の本命投稿を手動／外部cronから起動する。 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let force = false;
  try {
    const body = (await req.json()) as { force?: boolean };
    force = Boolean(body.force);
  } catch {
    force = req.nextUrl.searchParams.get("force") === "1";
  }
  try {
    const result = await maybePostMorningHonmeiPicks(new Date(), { force });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "morning post failed",
      },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}

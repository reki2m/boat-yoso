import { NextResponse } from "next/server";
import picksBoard from "@/data/picks_board.json";

export const dynamic = "force-dynamic";

type PickRow = {
  stadium?: number;
  stadium_name?: string;
  race?: number;
  tickets?: string[];
  status?: string;
  why?: string;
  skip_reason?: string | null;
};

function buildMessage(board: {
  active_date?: string;
  date?: string;
  mode?: string;
  picks?: PickRow[];
}): string {
  const dateKey = board.active_date || board.date || "—";
  const picks = board.picks || [];
  const buyable = picks.filter((p) => p.status !== "skipped");
  const skipped = picks.filter((p) => p.status === "skipped");
  const lines = [
    `**潮読み 本命買い目** \`${dateKey}\``,
    `モード: \`${board.mode || "honmei_fix_race_filter"}\` / 件数: ${buyable.length}（スキップ ${skipped.length}）`,
    "",
  ];
  if (!buyable.length) {
    lines.push("本日の条件該当はありません（見送り）。");
  } else {
    lines.push("**買い対象**");
    for (const p of buyable) {
      const name = p.stadium_name || `場${p.stadium}`;
      const tickets = (p.tickets || ["1-2-3"]).join("/");
      const status =
        p.status === "confirmed" ? "確定" : p.status === "provisional" ? "展示待ち" : p.status || "";
      lines.push(`・**${name} ${p.race}R** \`${tickets}\`（${status}）`);
      if (p.why) lines.push(`  └ ${p.why.slice(0, 120)}`);
    }
  }
  if (skipped.length) {
    lines.push("", "**スキップ**");
    for (const p of skipped.slice(0, 8)) {
      const name = p.stadium_name || `場${p.stadium}`;
      lines.push(`・**${name} ${p.race}R**（スキップ）${p.skip_reason ? ` ${p.skip_reason}` : ""}`);
    }
  }
  lines.push("", "※参考情報です。必ず勝てる保証はありません。");
  return lines.join("\n").slice(0, 1900);
}

export async function POST() {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) {
    return NextResponse.json(
      {
        ok: false,
        error: "DISCORD_WEBHOOK_URL 未設定",
        hint: "Cursor Apps の Secrets か実行環境の環境変数に Webhook URL を入れてください。",
      },
      { status: 503 },
    );
  }

  const content = buildMessage(picksBoard as { active_date?: string; date?: string; mode?: string; picks?: PickRow[] });
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { ok: false, error: `Discord HTTP ${res.status}`, detail: text.slice(0, 200) },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, preview: content.slice(0, 280) });
}

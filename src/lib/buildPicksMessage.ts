import { skipReasonLabel } from "@/lib/refreshPicksStatus";

type PickRow = {
  stadium?: number;
  stadium_name?: string;
  race?: number;
  tickets?: string[];
  status?: string;
  why?: string;
  skip_reason?: string | null;
  skip_detail?: string | null;
};

export function buildPicksMessage(board: {
  active_date?: string;
  date?: string;
  mode?: string;
  picks?: PickRow[];
  note?: string;
}): { title: string; body: string; dateKey: string; count: number; skippedCount: number } {
  const dateKey = board.active_date || board.date || "—";
  const picks = board.picks || [];
  const buyable = picks.filter((p) => p.status !== "skipped");
  const skipped = picks.filter((p) => p.status === "skipped");
  const waiting = buyable.filter((p) => p.status === "provisional");
  const lines = [
    `律丸ボート部 本命買い目 ${dateKey}`,
    `モード: ${board.mode || "honmei_2020_maxminy"} / 買い ${buyable.length} / スキップ ${skipped.length}`,
    "",
  ];

  if (skipped.length) {
    lines.push("【スルー】");
    for (const p of skipped.slice(0, 12)) {
      const name = p.stadium_name || `場${p.stadium}`;
      const detail = p.skip_detail || skipReasonLabel(p.skip_reason);
      lines.push(`・${name} ${p.race}R — ${detail}`);
    }
    lines.push("");
  }

  if (!buyable.length) {
    lines.push("本日の買い対象はありません（見送り）。");
  } else {
    lines.push("【買い対象】");
    for (const p of buyable) {
      const name = p.stadium_name || `場${p.stadium}`;
      const tickets = (p.tickets || ["1-2-3"]).join("/");
      const status =
        p.status === "confirmed"
          ? "買い目OK"
          : p.status === "provisional"
            ? "展示待ち"
            : p.status || "";
      lines.push(`・${name} ${p.race}R  ${tickets}（${status}）`);
      if (p.why) lines.push(`  └ ${p.why.slice(0, 140)}`);
    }
  }

  if (waiting.length && !skipped.length) {
    lines.push("", "【展示待ち】展示・進入が揃ってから再通知します。");
  }

  if (board.note) {
    lines.push("", board.note.slice(0, 160));
  }
  lines.push("", "※参考情報です。必ず勝てる保証はありません。");
  return {
    title: skipped.length
      ? `本命買い目 ${dateKey}（スキップ${skipped.length}）`
      : `本命買い目 ${dateKey}`,
    body: lines.join("\n").slice(0, 3500),
    dateKey,
    count: buyable.length,
    skippedCount: skipped.length,
  };
}

export function toDiscordContent(body: string): string {
  return body.slice(0, 1900);
}

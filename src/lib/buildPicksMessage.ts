type PickRow = {
  stadium?: number;
  stadium_name?: string;
  race?: number;
  tickets?: string[];
  status?: string;
  why?: string;
  skip_reason?: string | null;
};

export function buildPicksMessage(board: {
  active_date?: string;
  date?: string;
  mode?: string;
  picks?: PickRow[];
  note?: string;
}): { title: string; body: string; dateKey: string; count: number } {
  const dateKey = board.active_date || board.date || "—";
  const picks = board.picks || [];
  const buyable = picks.filter((p) => p.status !== "skipped");
  const skipped = picks.filter((p) => p.status === "skipped");
  const lines = [
    `潮読み 本命買い目 ${dateKey}`,
    `モード: ${board.mode || "honmei_2020_maxminy"} / 件数: ${buyable.length}（スキップ ${skipped.length}）`,
    "",
  ];
  if (!buyable.length) {
    lines.push("本日の条件該当はありません（見送り）。");
  } else {
    lines.push("【買い対象】");
    for (const p of buyable) {
      const name = p.stadium_name || `場${p.stadium}`;
      const tickets = (p.tickets || ["1-2-3"]).join("/");
      const status =
        p.status === "confirmed" ? "確定" : p.status === "provisional" ? "展示待ち" : p.status || "";
      lines.push(`・${name} ${p.race}R  ${tickets}（${status}）`);
      if (p.why) lines.push(`  └ ${p.why.slice(0, 140)}`);
    }
  }
  if (skipped.length) {
    lines.push("", "【スキップ】");
    for (const p of skipped.slice(0, 8)) {
      const name = p.stadium_name || `場${p.stadium}`;
      lines.push(`・${name} ${p.race}R（スキップ）${p.skip_reason ? ` ${p.skip_reason}` : ""}`);
    }
  }
  if (board.note) {
    lines.push("", board.note.slice(0, 160));
  }
  lines.push("", "※参考情報です。必ず勝てる保証はありません。");
  return {
    title: `本命買い目 ${dateKey}`,
    body: lines.join("\n").slice(0, 3500),
    dateKey,
    count: buyable.length,
  };
}

export function toDiscordContent(body: string): string {
  // Discord plain; keep under webhook limit
  return body.slice(0, 1900);
}

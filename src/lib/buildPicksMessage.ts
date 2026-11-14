import { skipReasonLabel } from "@/lib/refreshPicksStatus";
import { formatTickets, statusLabel } from "@/lib/chatRaceUi";

type PickRow = {
  stadium?: number;
  stadium_name?: string;
  race?: number;
  tickets?: string[];
  tickets_single?: string[];
  tickets_five?: string[];
  label?: string;
  status?: string;
  why?: string;
  skip_reason?: string | null;
  skip_detail?: string | null;
};

function pickName(p: PickRow): string {
  return p.stadium_name || `場${p.stadium}`;
}

function pickStatusTag(p: PickRow): string {
  const label = statusLabel(p);
  return label ? `【${label}】` : "";
}

/**
 * チャット／Discord向け本文。
 * 【買い目】と【説明】を必ず分け、ステータス（展示待ち／確定／スルー）を明示する。
 * 画面側は meta.races を優先表示し、本文はフォールバック兼 Discord 用。
 */
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
  const waiting = buyable.filter(
    (p) => p.status === "provisional" || p.status === "programs_unavailable",
  );
  const confirmed = buyable.filter((p) => p.status === "confirmed");

  const headlineParts = [
    `買い${buyable.length}`,
    confirmed.length ? `確定${confirmed.length}` : null,
    waiting.length ? `展示待ち${waiting.length}` : null,
    skipped.length ? `スルー${skipped.length}` : null,
  ].filter(Boolean);

  const lines: string[] = [
    `律丸ボート部 本命買い目 ${dateKey}`,
    headlineParts.join(" · "),
    "",
  ];

  if (buyable.length) {
    lines.push("【買い目】");
    const seen = new Set<string>();
    for (const p of buyable) {
      const key = `${Number(p.stadium)}-${Number(p.race)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const single = p.tickets_single || [];
      const five = p.tickets_five || [];
      const tickets =
        single.length || five.length
          ? [
              single.length ? `単点 ${single.join("/")}` : null,
              five.length ? `5点 ${five.join("/")}` : null,
            ]
              .filter(Boolean)
              .join(" ／ ")
          : formatTickets(p.tickets, "1-2-3");
      const label = p.label ? `（${p.label}）` : "";
      lines.push(
        `・${pickName(p)} ${p.race}R${label}  ${tickets}  ${pickStatusTag(p)}`.trimEnd(),
      );
    }
    lines.push("");
  } else {
    lines.push("【買い目】", "本日の買い対象はありません。", "");
  }

  if (skipped.length) {
    lines.push("【スルー】");
    for (const p of skipped.slice(0, 12)) {
      const detail = p.skip_detail || skipReasonLabel(p.skip_reason) || "条件外";
      lines.push(`・${pickName(p)} ${p.race}R — ${detail}`);
    }
    lines.push("");
  }

  const explainable = picks.filter(
    (p) =>
      (typeof p.why === "string" && p.why.trim()) ||
      (p.status === "skipped" && (p.skip_detail || p.skip_reason)),
  );
  if (explainable.length) {
    lines.push("【説明】");
    for (const p of explainable.slice(0, 12)) {
      const why =
        (typeof p.why === "string" && p.why.trim()) ||
        p.skip_detail ||
        skipReasonLabel(p.skip_reason) ||
        "";
      if (!why) continue;
      lines.push(`・${pickName(p)} ${p.race}R — ${why.slice(0, 140)}`);
    }
    lines.push("");
  }

  if (waiting.length) {
    lines.push("※展示待ちは、展示・進入が揃ってから「確定」か「スルー」に更新します。");
  }
  if (confirmed.length && board.mode === "exhibition_after_honmei") {
    lines.push("※「確定」は展示後の最終買い目です。「スルー」は買わない判断です。");
  }
  if (board.note) {
    lines.push(board.note.slice(0, 160));
  }
  lines.push("※参考情報です。的中や利益を保証しません。");

  const titleBits: string[] = [];
  if (confirmed.length) titleBits.push(`確定${confirmed.length}`);
  if (waiting.length) titleBits.push(`展示待ち${waiting.length}`);
  if (skipped.length) titleBits.push(`スルー${skipped.length}`);

  return {
    title: titleBits.length
      ? `本命買い目 ${dateKey}（${titleBits.join(" · ")}）`
      : `本命買い目 ${dateKey}`,
    body: lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n").slice(0, 3500),
    dateKey,
    count: buyable.length,
    skippedCount: skipped.length,
  };
}

export function toDiscordContent(body: string): string {
  return body.slice(0, 1900);
}

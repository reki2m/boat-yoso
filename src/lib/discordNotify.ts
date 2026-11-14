import { toDiscordContent } from "@/lib/buildPicksMessage";

/**
 * Discord 連携は DISCORD_MIRROR_ENABLED=1 の明示オプトイン時のみ。
 * 表示名を外部へ送るため、運用者は Webhook 先チャンネルの公開範囲に注意すること。
 */
export function isDiscordEnabled(): boolean {
  return (
    process.env.DISCORD_MIRROR_ENABLED?.trim() === "1" &&
    Boolean(process.env.DISCORD_WEBHOOK_URL?.trim())
  );
}

/** 表示名を短くする（全文をそのまま外部へ出さない） */
export function discordDisplayName(name: string | null | undefined): string {
  const n = String(name || "メンバー").replace(/\s+/g, " ").trim().slice(0, 20);
  return n || "メンバー";
}

export async function sendDiscordMessage(
  body: string,
): Promise<{ ok: boolean; detail?: string }> {
  if (process.env.DISCORD_MIRROR_ENABLED?.trim() !== "1") {
    return { ok: false, detail: "Discord連携は無効です（DISCORD_MIRROR_ENABLED）" };
  }
  const webhook = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!webhook) return { ok: false, detail: "DISCORD_WEBHOOK_URL 未設定" };
  try {
    // Discord 不通・egress 待ちで購入ロックUIが固まらないよう短時間で打ち切る
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: toDiscordContent(body) }),
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) {
      return { ok: false, detail: `Discord HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Discord送信失敗";
    const timedOut =
      (e instanceof Error && e.name === "TimeoutError") ||
      /aborted|timeout/i.test(msg);
    return {
      ok: false,
      detail: timedOut ? "Discord送信タイムアウト" : msg,
    };
  }
}

export function formatPurchaseSettleDiscord(opts: {
  placeName: string;
  raceNo: number;
  userName: string;
  payoutYen: number;
}): string {
  const head = `${opts.placeName}${opts.raceNo}レース ${discordDisplayName(opts.userName)}が買いました。`;
  if (opts.payoutYen > 0) {
    return `${head}払い戻しは¥${opts.payoutYen.toLocaleString("ja-JP")}です`;
  }
  return `${head}的中なしです`;
}

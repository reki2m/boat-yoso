import { toDiscordContent } from "@/lib/buildPicksMessage";

/** Secrets で DISCORD_MIRROR_ENABLED=1 かつ WEBHOOK があるときだけ送る */
export function isDiscordEnabled(): boolean {
  return (
    process.env.DISCORD_MIRROR_ENABLED?.trim() === "1" &&
    Boolean(process.env.DISCORD_WEBHOOK_URL?.trim())
  );
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
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: toDiscordContent(body) }),
    });
    if (!res.ok) {
      return { ok: false, detail: `Discord HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : "Discord送信失敗",
    };
  }
}

export function formatPurchaseSettleDiscord(opts: {
  placeName: string;
  raceNo: number;
  userName: string;
  payoutYen: number;
}): string {
  const head = `${opts.placeName}${opts.raceNo}レース ${opts.userName}が買いました。`;
  if (opts.payoutYen > 0) {
    return `${head}払い戻しは¥${opts.payoutYen.toLocaleString("ja-JP")}です`;
  }
  return `${head}的中なしです`;
}

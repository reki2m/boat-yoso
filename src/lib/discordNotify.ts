import { toDiscordContent } from "@/lib/buildPicksMessage";

function mirrorFlag(): string {
  return (process.env.DISCORD_MIRROR_ENABLED || "").trim().toLowerCase();
}

/**
 * Discord 連携は DISCORD_MIRROR_ENABLED の明示オプトイン時のみ。
 * 受け付ける値: 1 / true / yes / on（大文字小文字無視）
 * 表示名を外部へ送るため、運用者は Webhook 先チャンネルの公開範囲に注意すること。
 */
export function isDiscordEnabled(): boolean {
  const flag = mirrorFlag();
  return (
    (flag === "1" || flag === "true" || flag === "yes" || flag === "on") &&
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
  opts?: { timeoutMs?: number },
): Promise<{ ok: boolean; detail?: string }> {
  if (!isDiscordEnabled()) {
    const flag = mirrorFlag();
    if (!flag) {
      return { ok: false, detail: "Discord連携は無効です（DISCORD_MIRROR_ENABLED 未設定）" };
    }
    if (!(flag === "1" || flag === "true" || flag === "yes" || flag === "on")) {
      return {
        ok: false,
        detail: `Discord連携は無効です（DISCORD_MIRROR_ENABLED=${flag} → 1 にしてください）`,
      };
    }
    return { ok: false, detail: "DISCORD_WEBHOOK_URL 未設定" };
  }
  const webhook = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!webhook) return { ok: false, detail: "DISCORD_WEBHOOK_URL 未設定" };
  const timeoutMs = opts?.timeoutMs ?? 4000;
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: toDiscordContent(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const tip =
        res.status === 404 || res.status === 401
          ? "（Webhook URL の再発行を確認）"
          : "";
      return { ok: false, detail: `Discord HTTP ${res.status}${tip}` };
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

/** 管理人向けテスト通知本文 */
export function formatDiscordTestMessage(who?: string): string {
  const name = discordDisplayName(who || "管理人");
  const jst = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  return `【テスト通知】律丸ボート部チャットからの Discord 連携確認です（${name} / ${jst} JST）`;
}

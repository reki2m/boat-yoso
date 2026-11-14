/**
 * SSRF 対策: サーバー側 fetch に渡せる URL か検証する。
 * - https のみ
 * - プライベート/ローカル IP・メタデータIP拒否
 * - 許可ホスト（場公式・JLCライブ）のみ
 */

const ALLOWED_HOST_SUFFIXES = [
  ".jlc.ne.jp",
  ".kiryu-kyotei.com",
  ".boatrace-toda.jp",
  ".boatrace-edogawa.com",
  ".heiwajima.gr.jp",
  ".boatrace-tamagawa.com",
  ".boatrace-hamanako.jp",
  ".gamagori-kyotei.com",
  ".boatrace-tokoname.jp",
  ".boatrace-tsu.com",
  ".boatrace-mikuni.jp",
  ".boatrace-biwako.jp",
  ".boatrace-suminoe.jp",
  ".boatrace-amagasaki.jp",
  ".n14.jp",
  ".marugameboat.jp",
  ".kojimaboat.jp",
  ".boatrace-miyajima.com",
  ".boatrace-tokuyama.jp",
  ".boatrace-shimonoseki.jp",
  ".wmb.jp",
  ".boatrace-ashiya.com",
  ".boatrace-fukuoka.com",
  ".boatrace-karatsu.jp",
  ".omurakyotei.jp",
] as const;

const ALLOWED_HOSTS_EXACT = new Set([
  "livebb.jlc.ne.jp",
  "www.kiryu-kyotei.com",
  "www.boatrace-toda.jp",
  "www.boatrace-edogawa.com",
  "www.heiwajima.gr.jp",
  "www.boatrace-tamagawa.com",
  "www.boatrace-hamanako.jp",
  "www.gamagori-kyotei.com",
  "www.boatrace-tokoname.jp",
  "www.boatrace-tsu.com",
  "www.boatrace-mikuni.jp",
  "www.boatrace-biwako.jp",
  "www.boatrace-suminoe.jp",
  "www.boatrace-amagasaki.jp",
  "www.n14.jp",
  "www.marugameboat.jp",
  "www.kojimaboat.jp",
  "www.boatrace-miyajima.com",
  "www.boatrace-tokuyama.jp",
  "www.boatrace-shimonoseki.jp",
  "www.wmb.jp",
  "www.boatrace-ashiya.com",
  "www.boatrace-fukuoka.com",
  "www.boatrace-karatsu.jp",
  "omurakyotei.jp",
  "www.omurakyotei.jp",
]);

function isPrivateOrLocalHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h === "localhost.") return true;
  if (h === "0.0.0.0" || h === "::" || h === "::1") return true;
  // IPv4 literal
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  // bare IPv6 local-ish
  if (h.includes(":")) return true;
  return false;
}

function hostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (ALLOWED_HOSTS_EXACT.has(h)) return true;
  return ALLOWED_HOST_SUFFIXES.some((suf) => h === suf.slice(1) || h.endsWith(suf));
}

export function assertSafeOutboundUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("invalid url");
  }
  if (u.protocol !== "https:") throw new Error("https only");
  if (u.username || u.password) throw new Error("userinfo forbidden");
  if (isPrivateOrLocalHostname(u.hostname)) throw new Error("private host forbidden");
  if (!hostAllowed(u.hostname)) throw new Error("host not allowlisted");
  if (/boatrace\.jp/i.test(u.hostname)) throw new Error("boatrace.jp forbidden");
  return u;
}

export async function safeGetReachability(
  rawUrl: string,
  opts?: { timeoutMs?: number },
): Promise<{ ok: boolean; status: number | null; detail: string }> {
  let url: URL;
  try {
    url = assertSafeOutboundUrl(rawUrl);
  } catch (e) {
    return {
      ok: false,
      status: null,
      detail: `配信URL拒否 (${e instanceof Error ? e.message : "blocked"})`,
    };
  }
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; BoatYosoLive/1.0)",
        accept: "text/html,application/xhtml+xml,*/*",
      },
      cache: "no-store",
      // リダイレクト先を追わない（オープンリダイレクト経由の SSRF を防ぐ）
      redirect: "manual",
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 6000),
    });
    const redirected = res.status >= 300 && res.status < 400;
    const ok = res.ok || redirected;
    return {
      ok,
      status: res.status,
      detail: redirected ? `配信応答 ${res.status}（リダイレクト）` : `配信応答 ${res.status}`,
    };
  } catch (e) {
    return {
      ok: false,
      status: null,
      detail: `配信到達不可 (${e instanceof Error ? e.message : "error"})`,
    };
  }
}

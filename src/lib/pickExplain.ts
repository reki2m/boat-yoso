/**
 * 朝の本命ボード上のレース説明を、買う／買わないで矛盾させない。
 * tripleSystem の「本命」再判定は本命Sと別ルールのため、確定後に
 * 「条件外→買わない」で上書きするとチャット説明が破綻する。
 */

const SKIPISH =
  /買わない|スルー|本命条件外|条件外のため|ため見送り|見送りです/;
const BUYISH = /購入OK|本命S対象|本命対象|買う対象|本命採用|展示待ち/;

export function looksLikeSkipExplain(text: string | null | undefined): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (BUYISH.test(t) && !/買わない|スルー/.test(t)) return false;
  return SKIPISH.test(t);
}

/** 購入対象（確定／展示待ち）向けの説明文 */
export function buyTargetExplain(opts: {
  status?: string | null;
  why?: string | null;
  placeName?: string;
  raceNo?: number;
}): string {
  const status = opts.status || "";
  const why = String(opts.why || "").trim();
  const place =
    opts.placeName && opts.raceNo
      ? `${opts.placeName}${opts.raceNo}R`
      : opts.placeName || "このレース";

  if (status === "skipped") {
    return why || `${place}は買わない判断です（スルー）`;
  }

  if (why && !looksLikeSkipExplain(why)) return why;

  if (status === "provisional" || status === "programs_unavailable") {
    return `${place}は本日の本命購入対象です。展示後に「購入OK」か「スルー」を確定します。`;
  }
  if (status === "confirmed") {
    return `${place}は本日の本命購入対象です。展示確認済み・購入OK（買い目は朝のまま）。`;
  }
  return why || `${place}は本日の本命購入対象です。`;
}

/**
 * 展示後 refresh で triple.focus を採用してよいか。
 * 条件外／買わない系は朝ボードの購入対象説明を壊すので拒否する。
 */
export function safeExhibitionWhy(opts: {
  pickWhy?: string | null;
  tripleFocus?: string | null;
  status: "confirmed" | "skipped" | "provisional";
  placeName?: string;
  raceNo?: number;
}): string {
  if (opts.status === "skipped") {
    return (
      String(opts.tripleFocus || "").trim() ||
      buyTargetExplain({
        status: "skipped",
        placeName: opts.placeName,
        raceNo: opts.raceNo,
      })
    );
  }
  const pickWhy = String(opts.pickWhy || "").trim();
  if (pickWhy && !looksLikeSkipExplain(pickWhy)) return pickWhy;

  const focus = String(opts.tripleFocus || "").trim();
  if (focus && !looksLikeSkipExplain(focus)) return focus;

  return buyTargetExplain({
    status: opts.status,
    why: pickWhy,
    placeName: opts.placeName,
    raceNo: opts.raceNo,
  });
}

import { STADIUMS } from "./stadiums";

/** 各場の公式サイトTOP（全24場） */
export const STADIUM_OFFICIAL_SITES: Record<number, string> = {
  1: "https://www.kiryu-kyotei.com/",
  2: "https://www.boatrace-toda.jp/",
  3: "https://www.boatrace-edogawa.com/",
  4: "https://www.heiwajima.gr.jp/",
  5: "https://www.boatrace-tamagawa.com/",
  6: "https://www.boatrace-hamanako.jp/",
  7: "https://www.gamagori-kyotei.com/",
  8: "https://www.boatrace-tokoname.jp/",
  9: "https://www.boatrace-tsu.com/",
  10: "https://www.boatrace-mikuni.jp/",
  11: "https://www.boatrace-biwako.jp/",
  12: "https://www.boatrace-suminoe.jp/",
  13: "https://www.boatrace-amagasaki.jp/",
  14: "https://www.n14.jp/",
  15: "https://www.marugameboat.jp/",
  16: "https://www.kojimaboat.jp/",
  17: "https://www.boatrace-miyajima.com/",
  18: "https://www.boatrace-tokuyama.jp/",
  19: "https://www.boatrace-shimonoseki.jp/",
  20: "https://www.wmb.jp/",
  21: "https://www.boatrace-ashiya.com/",
  22: "https://www.boatrace-fukuoka.com/",
  23: "https://www.boatrace-karatsu.jp/",
  24: "https://omurakyotei.jp/",
};

/**
 * 公式ライブ/直前/出走表/各場HPへの導線。
 * - 直前・出走表は boatrace.jp の対象レースページ
 * - ライブは場単位のメディア入口（個別R専用URLは公式に無い）
 * - 公式は X-Frame-Options: SAMEORIGIN のため iframe 不可。別タブで開く
 */
export function liveBroadcastUrls(placeNo: number, dateKey: string, raceNo: number) {
  const jcd = String(placeNo).padStart(2, "0");
  const placeName = STADIUMS[placeNo] ?? `場${placeNo}`;
  const rno = Math.min(12, Math.max(1, Number(raceNo) || 1));
  const hd = /^\d{8}$/.test(dateKey) ? dateKey : dateKey.replace(/\D/g, "").slice(0, 8);

  return {
    placeName,
    placeNo,
    raceNo: rno,
    dateKey: hd,
    /** その場の公式ライブ入口（場単位） */
    mediaTop: `https://www.boatrace.jp/owpc/pc/data/mediatop?jcd=${jcd}`,
    /** レース一覧 */
    raceIndex: `https://www.boatrace.jp/owpc/pc/race/raceindex?jcd=${jcd}&hd=${hd}`,
    /** 出走表（対象R） */
    raceList: `https://www.boatrace.jp/owpc/pc/race/racelist?rno=${rno}&jcd=${jcd}&hd=${hd}`,
    /** 直前情報（対象R） */
    beforeInfo: `https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=${rno}&jcd=${jcd}&hd=${hd}`,
    /** ボートレース公式の場ページ */
    stadiumPage: `https://www.boatrace.jp/owpc/pc/site/place/stadium/br${jcd}/`,
    /** 各場の公式サイトTOP */
    officialSite:
      STADIUM_OFFICIAL_SITES[placeNo] ||
      `https://www.boatrace.jp/owpc/pc/site/place/stadium/br${jcd}/`,
    liveScope: "stadium" as const,
    liveNote:
      "公式ライブは場単位です（対象場の中継）。開催時間外は配信なし表示になります。アプリ内埋め込みは公式が禁止しているため別タブで開きます。",
  };
}

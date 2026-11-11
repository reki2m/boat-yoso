import { STADIUMS } from "./stadiums";

/**
 * 各場の公式ホームページ（スマホ版優先）。
 * ※ boatrace.jp は使わない。
 */
export const STADIUM_OFFICIAL_SITES: Record<number, string> = {
  1: "https://www.kiryu-kyotei.com/sp/",
  2: "https://www.boatrace-toda.jp/",
  3: "https://www.boatrace-edogawa.com/sp/",
  4: "https://www.heiwajima.gr.jp/sp/",
  5: "https://www.boatrace-tamagawa.com/sp/",
  6: "https://www.boatrace-hamanako.jp/sp/",
  7: "https://www.gamagori-kyotei.com/sp/",
  8: "https://www.boatrace-tokoname.jp/sp/",
  9: "https://www.boatrace-tsu.com/sp/",
  10: "https://www.boatrace-mikuni.jp/sp/",
  11: "https://www.boatrace-biwako.jp/sp/",
  12: "https://www.boatrace-suminoe.jp/sp/",
  13: "https://www.boatrace-amagasaki.jp/sp/",
  14: "https://www.n14.jp/sp/",
  15: "https://www.marugameboat.jp/sp/",
  16: "https://www.kojimaboat.jp/",
  17: "https://www.boatrace-miyajima.com/",
  18: "https://www.boatrace-tokuyama.jp/sp/",
  19: "https://www.boatrace-shimonoseki.jp/sp/",
  20: "https://www.wmb.jp/sp/",
  21: "https://www.boatrace-ashiya.com/sp/",
  22: "https://www.boatrace-fukuoka.com/sp/",
  23: "https://www.boatrace-karatsu.jp/sp/",
  24: "https://omurakyotei.jp/sp/",
};

/** 各場サイト内のレース情報（結果一覧など） */
export const STADIUM_RACEINFO_PAGES: Record<number, string> = {
  1: "https://www.kiryu-kyotei.com/sp/index.php?page=raceinfo-resultlist",
  2: "https://www.boatrace-toda.jp/",
  3: "https://www.boatrace-edogawa.com/sp/index.php?page=raceinfo-resultlist",
  4: "https://www.heiwajima.gr.jp/sp/",
  5: "https://www.boatrace-tamagawa.com/sp/index.php?page=raceinfo-resultlist",
  6: "https://www.boatrace-hamanako.jp/sp/index.php?page=raceinfo-resultlist",
  7: "https://www.gamagori-kyotei.com/sp/",
  8: "https://www.boatrace-tokoname.jp/sp/index.php?page=raceinfo-resultlist",
  9: "https://www.boatrace-tsu.com/sp/index.php?page=raceinfo",
  10: "https://www.boatrace-mikuni.jp/sp/index.php?page=raceinfo-resultlist",
  11: "https://www.boatrace-biwako.jp/sp/index.php?page=raceinfo-resultlist",
  12: "https://www.boatrace-suminoe.jp/sp/",
  13: "https://www.boatrace-amagasaki.jp/sp/index.php?page=raceinfo-resultlist",
  14: "https://www.n14.jp/sp/index.php?page=raceinfo-resultlist",
  15: "https://www.marugameboat.jp/sp/",
  16: "https://www.kojimaboat.jp/",
  17: "https://www.boatrace-miyajima.com/",
  18: "https://www.boatrace-tokuyama.jp/sp/index.php?page=raceinfo-resultlist",
  19: "https://www.boatrace-shimonoseki.jp/sp/index.php?page=raceinfo-resultlist",
  20: "https://www.wmb.jp/sp/index.php?page=raceinfo-resultlist",
  21: "https://www.boatrace-ashiya.com/sp/index.php?page=raceinfo-resultlist",
  22: "https://www.boatrace-fukuoka.com/sp/index.php?page=raceinfo-resultlist",
  23: "https://www.boatrace-karatsu.jp/sp/index.php?page=raceinfo-resultlist",
  24: "https://omurakyotei.jp/sp/index.php?page=raceinfo-resultlist",
};

/** 場ライブ（JLC）。未提供の場は null → 場HPへフォールバック */
const STADIUM_LIVE_JLC: Record<number, string | null> = {
  1: "https://livebb.jlc.ne.jp/bb_top/sp_bb/live_01.php",
  2: "https://livebb.jlc.ne.jp/bb_top/sp_bb/live_02.php",
  3: "https://livebb.jlc.ne.jp/bb_top/sp_bb/live_03.php",
  4: null,
  5: "https://livebb.jlc.ne.jp/bb_top/sp_bb/live_05.php",
  6: "https://livebb.jlc.ne.jp/bb_top/sp_bb/live_06.php",
  7: null,
  8: "https://livebb.jlc.ne.jp/bb_top/sp_bb/live_08.php",
  9: "https://livebb.jlc.ne.jp/bb_top/sp_bb/live_09.php",
  10: "https://livebb.jlc.ne.jp/bb_top/sp_bb/live_10.php",
  11: "https://livebb.jlc.ne.jp/bb_top/sp_bb/live_11.php",
  12: null,
  13: "https://livebb.jlc.ne.jp/bb_top/sp_bb/live_13.php",
  14: "https://livebb.jlc.ne.jp/bb_top/sp_bb/live_14.php",
  15: null,
  16: null,
  17: "https://livebb.jlc.ne.jp/bb_top/sp_bb/live_17.php",
  18: "https://livebb.jlc.ne.jp/bb_top/sp_bb/live_18.php",
  19: "https://livebb.jlc.ne.jp/bb_top/sp_bb/live_19.php",
  20: "https://livebb.jlc.ne.jp/bb_top/sp_bb/live_20.php",
  21: "https://livebb.jlc.ne.jp/bb_top/sp_bb/live_21.php",
  22: "https://livebb.jlc.ne.jp/bb_top/sp_bb/live_22.php",
  23: "https://livebb.jlc.ne.jp/bb_top/sp_bb/live_23.php",
  24: "https://livebb.jlc.ne.jp/bb_top/sp_bb/live_24.php",
};

function assertNoBoatRaceJp(url: string): string {
  if (/boatrace\.jp/i.test(url)) {
    throw new Error(`boatrace.jp link forbidden: ${url}`);
  }
  return url;
}

/**
 * 場公式サイトへの導線のみ（boatrace.jp 不使用）。
 * - 公式サイト = 各場HP
 * - 直前/出走表 = 各場のレース情報ページ（なければ場HP）
 * - ライブ = 場の配信ページ（なければ場HP）
 */
export function liveBroadcastUrls(placeNo: number, dateKey: string, raceNo: number) {
  const placeName = STADIUMS[placeNo] ?? `場${placeNo}`;
  const rno = Math.min(12, Math.max(1, Number(raceNo) || 1));
  const hd = /^\d{8}$/.test(dateKey) ? dateKey : dateKey.replace(/\D/g, "").slice(0, 8);
  const officialSite = assertNoBoatRaceJp(
    STADIUM_OFFICIAL_SITES[placeNo] || "https://www.boatrace-shimonoseki.jp/sp/",
  );
  const raceInfo = assertNoBoatRaceJp(STADIUM_RACEINFO_PAGES[placeNo] || officialSite);
  const live = STADIUM_LIVE_JLC[placeNo];
  const mediaTop = assertNoBoatRaceJp(live || officialSite);

  return {
    placeName,
    placeNo,
    raceNo: rno,
    dateKey: hd,
    /** 場のライブ（JLC）。無い場は場HP */
    mediaTop,
    /** レース情報（場サイト） */
    raceIndex: raceInfo,
    /** 出走表相当 → 場のレース情報 */
    raceList: raceInfo,
    /** 直前情報相当 → 場のレース情報 / 場HP */
    beforeInfo: raceInfo,
    /** 互換: 場HP */
    stadiumPage: officialSite,
    /** 各場の公式ホームページ */
    officialSite,
    liveScope: "stadium" as const,
    liveNote:
      "リンクは各場の公式ホームページ／場ライブのみです。ライブは開催時間外だと配信なし表示になります。",
  };
}

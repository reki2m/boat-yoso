import { STADIUMS } from "./stadiums";

/** 公式ライブ/映像ページへの導線 */
export function liveBroadcastUrls(placeNo: number, dateKey: string, raceNo: number) {
  const jcd = String(placeNo).padStart(2, "0");
  const placeName = STADIUMS[placeNo] ?? `場${placeNo}`;
  return {
    placeName,
    /** 場のメディアトップ（ライブ入口） */
    mediaTop: `https://www.boatrace.jp/owpc/pc/data/mediatop?jcd=${jcd}`,
    /** レース一覧 */
    raceIndex: `https://www.boatrace.jp/owpc/pc/site/race/raceindex?jcd=${jcd}&hd=${dateKey}`,
    /** 出走表 */
    raceList: `https://www.boatrace.jp/owpc/pc/site/race/racelist?jcd=${jcd}&hd=${dateKey}&rno=${raceNo}`,
    /** 直前情報 */
    beforeInfo: `https://www.boatrace.jp/owpc/pc/site/race/beforeinfo?jcd=${jcd}&hd=${dateKey}&rno=${raceNo}`,
  };
}

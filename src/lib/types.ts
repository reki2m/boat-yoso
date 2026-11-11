export type RacerRow = {
  course: number;
  playerNo: number;
  name: string;
  className: string;
  branch: string;
  age: number;
  weightKg: number;
  nationalWin: number;
  nationalTop2: number;
  localWin: number;
  localTop2: number;
  motorTop2: number;
  boatTop2: number;
  avgStart: number;
  motorNo: number;
  boatNo: number;
  /** 番組枠（艇番）。進入変更後も不変 */
  entry?: number;
  exhibitionCourse?: number | null;
  exhibitionSlit?: number | null;
  exhibitionLap?: number | null;
  /** 直近勝率（期間成績） */
  recentWin?: number;
  /** 今節得点率 */
  seriesPoints?: number;
  /** 今節展示平均 */
  seriesDisplayAvg?: number | null;
  /** 今節ST平均 */
  seriesStartAvg?: number | null;
  /** 能力指数（今期） */
  abilityIndex?: number | null;
  /** モーター指数 */
  motorIndex?: number | null;
  /** 今節成績メモ（着順フラグ等） */
  seriesMarks?: string[];
};

export type RacePayload = {
  source: "kyoteibiyori" | "openapi" | "sample";
  date: string;
  placeNo: number;
  placeName: string;
  raceNo: number;
  raceName: string;
  raceRank: string;
  racers: RacerRow[];
  fetchedAt: string;
  note?: string;
  windSpeed?: number | null;
  wave?: number | null;
};

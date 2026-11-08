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

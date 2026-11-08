"use client";

import { useEffect, useState, useTransition } from "react";

type Stadium = { id: number; name: string };

type Racer = {
  course: number;
  name: string;
  className: string;
  branch: string;
  nationalWin: number;
  nationalTop2: number;
  localWin: number;
  motorTop2: number;
  boatTop2: number;
  avgStart: number;
  score?: number;
  reasons?: string[];
};

type RaceResponse = {
  source: "kyoteibiyori" | "sample";
  date: string;
  placeNo: number;
  placeName: string;
  raceNo: number;
  raceName: string;
  raceRank: string;
  note?: string;
  racers: Racer[];
  prediction: {
    rankings: Racer[];
    honmei: Racer;
    taikou: Racer;
    ana: Racer;
    sanrentan: string;
    confidence: string;
    summary: string;
  };
};

export default function Home() {
  const [stadiums, setStadiums] = useState<Stadium[]>([]);
  const [races, setRaces] = useState<number[]>([]);
  const [dateLabel, setDateLabel] = useState("");
  const [place, setPlace] = useState(2);
  const [race, setRace] = useState(1);
  const [data, setData] = useState<RaceResponse | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    fetch("/api/schedule")
      .then((r) => r.json())
      .then((json) => {
        setStadiums(json.stadiums ?? []);
        setRaces(json.races ?? []);
        setDateLabel(json.dateLabel ?? "");
        if (json.stadiums?.[0]?.id) setPlace(json.stadiums[0].id);
      })
      .catch(() => setError("開催場の取得に失敗しました"));
  }, []);

  function load() {
    setError("");
    startTransition(async () => {
      try {
        const res = await fetch(`/api/race?place=${place}&race=${race}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "取得失敗");
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "取得失敗");
      }
    });
  }

  useEffect(() => {
    if (stadiums.length) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stadiums]);

  const maxScore = data
    ? Math.max(...data.prediction.rankings.map((r) => r.score ?? 0), 1)
    : 1;

  return (
    <main className="shell">
      <section className="hero">
        <h1 className="brand">潮読み</h1>
        <p className="lede">
          ボートレース日和の出走データをもとに、勝率・モーター・STを合成した参考予想を出します。
        </p>
        <div className="cta-row">
          <button className="btn" onClick={load} disabled={pending}>
            {pending ? "読み込み中…" : "今日のレースを読む"}
          </button>
          <a
            className="btn ghost"
            href="https://kyoteibiyori.com/"
            target="_blank"
            rel="noreferrer"
          >
            ボートレース日和
          </a>
        </div>
      </section>

      <section className="panel">
        <div className="controls">
          <div className="field">
            <label htmlFor="place">競艇場</label>
            <select
              id="place"
              value={place}
              onChange={(e) => setPlace(Number(e.target.value))}
            >
              {stadiums.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="race">レース</label>
            <select
              id="race"
              value={race}
              onChange={(e) => setRace(Number(e.target.value))}
            >
              {races.map((n) => (
                <option key={n} value={n}>
                  {n}R
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>日付</label>
            <select disabled value="today">
              <option value="today">{dateLabel || "Asia/Tokyo 今日"}</option>
            </select>
          </div>
          <button className="btn" onClick={load} disabled={pending}>
            予想する
          </button>
        </div>

        {error ? <p className="status">{error}</p> : null}
        {!data && !error ? <p className="status">出走表を準備しています…</p> : null}

        {data ? (
          <>
            <div className="meta">
              <span className="badge">
                {data.placeName} {data.raceNo}R
              </span>
              <span className="badge">{data.raceName || "番組"}</span>
              <span className="badge">{data.raceRank || "一般"}</span>
              <span className="badge">
                データ: {data.source === "kyoteibiyori" ? "ボートレース日和" : "サンプル"}
              </span>
              <span className="badge">信頼度 {data.prediction.confidence}</span>
            </div>

            <div className="pick">
              <div className="pick-main">
                <span className="badge">本命フォーカス</span>
                <h2>
                  {data.prediction.honmei.course}号 {data.prediction.honmei.name}
                </h2>
                <p>{data.prediction.summary}</p>
                <div className="sanren">{data.prediction.sanrentan}</div>
                <p className="note" style={{ marginTop: "0.4rem" }}>
                  参考3連単（本命-対抗-穴）
                </p>
              </div>
              <div className="side-picks">
                <div className="side-card">
                  <span>対抗</span>
                  <strong>
                    {data.prediction.taikou.course}号 {data.prediction.taikou.name}
                  </strong>
                </div>
                <div className="side-card">
                  <span>穴</span>
                  <strong>
                    {data.prediction.ana.course}号 {data.prediction.ana.name}
                  </strong>
                </div>
                <div className="side-card">
                  <span>注目材料</span>
                  <strong>
                    {(data.prediction.honmei.reasons ?? []).slice(0, 2).join(" / ") ||
                      "総合スコア"}
                  </strong>
                </div>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>枠</th>
                    <th>選手</th>
                    <th>級別</th>
                    <th>全国</th>
                    <th>当地</th>
                    <th>M2連</th>
                    <th>B2連</th>
                    <th>ST</th>
                    <th>スコア</th>
                  </tr>
                </thead>
                <tbody>
                  {data.prediction.rankings.map((r) => (
                    <tr key={r.course}>
                      <td>
                        <span className={`lane c${r.course}`}>{r.course}</span>
                      </td>
                      <td>
                        {r.name}
                        <div className="note" style={{ margin: 0 }}>
                          {r.branch}
                        </div>
                      </td>
                      <td>{r.className}</td>
                      <td>
                        {r.nationalWin.toFixed(2)}
                        <div className="note" style={{ margin: 0 }}>
                          2連 {r.nationalTop2.toFixed(1)}%
                        </div>
                      </td>
                      <td>{r.localWin.toFixed(2)}</td>
                      <td>{r.motorTop2.toFixed(1)}%</td>
                      <td>{r.boatTop2.toFixed(1)}%</td>
                      <td>{r.avgStart.toFixed(2)}</td>
                      <td style={{ minWidth: 110 }}>
                        {(r.score ?? 0).toFixed(1)}
                        <div className="scorebar">
                          <i
                            style={{
                              width: `${((r.score ?? 0) / maxScore) * 100}%`,
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="note">
              {data.note
                ? data.note
                : "出走データはボートレース日和の公開エンドポイントから取得しています。予想は娯楽・参考用で、的中を保証しません。"}
            </p>
          </>
        ) : null}
      </section>
    </main>
  );
}

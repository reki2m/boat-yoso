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
  courseSkill?: {
    winRate: number;
    top2Rate: number;
    starts: number;
    bestCourse: number | null;
    label: string;
    isSpecialist: boolean;
  };
};

type Band = {
  band: "honmei" | "oshi" | "ana";
  label: string;
  ok: boolean;
  reasons: string[];
  tickets: string[];
  ticketLabel: string;
  betType: string;
  validatedRoi?: number;
  validatedHit?: number;
  meetsTarget?: boolean;
  blockedByOdds?: boolean;
};

type RaceResponse = {
  source: "kyoteibiyori" | "openapi" | "sample";
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
  odds?: {
    source: string;
    trifectaCount: number;
    sample: Array<{ combo: string; odds: number }>;
  };
  courseSkills?: Array<{
    course: number;
    name: string;
    skill?: Racer["courseSkill"];
  }>;
  tripleSystem?: {
    bands: Band[];
    active: Band[];
    anomaly: {
      ok: boolean;
      favorite: string | null;
      favOdds: number | null;
      overbet: boolean;
      moneyConcentrate: boolean;
      top3ShareProxy: number;
      advice: string;
      flags: string[];
    };
    live: {
      status: string;
      message: string;
      exhibitionNotes: Array<{ boat: number; name: string; score: number; notes: string[] }>;
      stream?: { url: string; status: string; message: string };
    };
    portfolioTickets: string[];
    focus: string;
    disclaimer: string;
  };
};

type Research = {
  lockedHonmei: {
    ticketLabel: string;
    validated_test_roi: number;
    validated_test_selected: number;
    stadium_whitelist: number[];
    min_c1_nat: number;
    max_c1_st: number;
    min_motor2: number;
  };
  lockedTriple?: {
    oshi?: {
      ticketLabel?: string;
      validated_test_roi?: number;
      validated_test_hit_rate?: number;
      meets_target?: boolean;
      ticket?: string;
    } | null;
    ana?: {
      ticketLabel?: string;
      validated_test_roi?: number;
      validated_test_hit_rate?: number;
      meets_target?: boolean;
      ticket?: string;
    } | null;
  };
  stadiumInnige: Record<string, { rate: number; stadium: number }>;
  hotRacers: {
    as_of: string;
    windows: {
      "1m": Array<{ name: string; win_rate: number; best_course: number | null; starts: number }>;
    };
  };
  backtestSummary: {
    train_n: number;
    test_n: number;
    strategies_ge_150_test: number;
  };
  sources: Record<string, string>;
  exhibition: { note: string };
  oddsAnomaly?: { note: string };
};

export default function Home() {
  const [stadiums, setStadiums] = useState<Stadium[]>([]);
  const [races, setRaces] = useState<number[]>([]);
  const [dateLabel, setDateLabel] = useState("");
  const [place, setPlace] = useState(2);
  const [race, setRace] = useState(1);
  const [data, setData] = useState<RaceResponse | null>(null);
  const [research, setResearch] = useState<Research | null>(null);
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
    fetch("/api/research")
      .then((r) => r.json())
      .then((json) => setResearch(json))
      .catch(() => undefined);
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
  const triple = data?.tripleSystem;
  const activeBand = triple?.active?.[0];

  return (
    <main className="shell">
      <section className="hero">
        <h1 className="brand">潮読み</h1>
        <p className="lede">
          本命・押し目・穴の3段システム。得意コースと異常オッズ回避のうえで、イン戦からの買い目を出す。
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
                データ:{" "}
                {data.source === "kyoteibiyori"
                  ? "ボートレース日和"
                  : data.source === "openapi"
                    ? "OpenAPI"
                    : "サンプル"}
              </span>
              <span className="badge">信頼度 {data.prediction.confidence}</span>
              <span className={`badge ${triple?.anomaly.ok ? "" : "warn"}`}>
                オッズ: {triple?.anomaly.ok ? "妥当" : "要注意"}
              </span>
            </div>

            <div className="pick">
              <div className="pick-main">
                <span className="badge">{triple?.focus ?? "参考スコア"}</span>
                <h2>
                  {activeBand
                    ? `${activeBand.label}採用`
                    : `${data.prediction.honmei.course}号 ${data.prediction.honmei.name}`}
                </h2>
                <p>
                  {activeBand
                    ? `${activeBand.ticketLabel} / ${(activeBand.tickets || []).join(" · ") || "見送り"}`
                    : data.prediction.summary}
                </p>
                <div className="sanren">
                  {(activeBand?.tickets?.length
                    ? activeBand.tickets
                    : [data.prediction.sanrentan]
                  ).join(" / ")}
                </div>
                <p className="note" style={{ marginTop: "0.4rem" }}>
                  {triple?.disclaimer}
                </p>
              </div>
              <div className="side-picks">
                {(triple?.bands ?? []).map((b) => (
                  <div key={b.band} className={`side-card band-${b.band} ${b.ok ? "on" : ""}`}>
                    <span>
                      {b.label}
                      {b.meetsTarget ? " ★目標達成ルール" : ""}
                      {b.blockedByOdds ? " / 異常オッズ回避" : ""}
                    </span>
                    <strong>
                      {b.ok ? b.tickets.join(" · ") : "見送り"}
                    </strong>
                    <div className="note" style={{ margin: "0.35rem 0 0" }}>
                      {b.ok
                        ? `${b.ticketLabel}${b.validatedRoi != null ? ` / 検証ROI ${b.validatedRoi.toFixed(1)}%` : ""}${b.validatedHit != null ? ` / 的中 ${b.validatedHit.toFixed(1)}%` : ""}`
                        : b.reasons.slice(0, 2).join(" / ")}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {triple ? (
              <div className={`anomaly ${triple.anomaly.ok ? "ok" : "bad"}`}>
                <strong>異常オッズ監視</strong>
                <p>{triple.anomaly.advice}</p>
                <div className="note" style={{ margin: 0 }}>
                  1番人気 {triple.anomaly.favorite ?? "—"} @ {triple.anomaly.favOdds ?? "—"} /
                  上位占有 {((triple.anomaly.top3ShareProxy ?? 0) * 100).toFixed(1)}% /
                  フラグ {(triple.anomaly.flags || []).join(", ") || "なし"}
                </div>
                {data.odds?.sample?.length ? (
                  <div className="odds-row">
                    {data.odds.sample.map((o) => (
                      <span key={o.combo} className="badge">
                        {o.combo} {o.odds.toFixed(1)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="note">当日オッズ未取得（履歴ルールのみ適用）</p>
                )}
              </div>
            ) : null}

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
                    <th>ST</th>
                    <th>得意コース</th>
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
                      <td>{r.avgStart.toFixed(2)}</td>
                      <td>
                        {r.courseSkill?.label ?? "—"}
                        <div className="note" style={{ margin: 0 }}>
                          勝率 {((r.courseSkill?.winRate ?? 0) * 100).toFixed(1)}%
                          {r.courseSkill?.bestCourse
                            ? ` / 最得意${r.courseSkill.bestCourse}`
                            : ""}
                        </div>
                      </td>
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

            {triple?.live ? (
              <div className="live-box">
                <strong>ライブ解析フック</strong>
                <p className="note" style={{ marginTop: "0.35rem" }}>
                  {triple.live.message}
                </p>
                {triple.live.exhibitionNotes?.length ? (
                  <div className="odds-row">
                    {triple.live.exhibitionNotes.slice(0, 6).map((n) => (
                      <span key={n.boat} className="badge">
                        {n.boat}号 {n.notes.join("·") || "標準"} ({n.score})
                      </span>
                    ))}
                  </div>
                ) : null}
                {triple.live.stream ? (
                  <a
                    className="btn ghost"
                    style={{ display: "inline-flex", marginTop: "0.75rem" }}
                    href={triple.live.stream.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    公式結果/ライブ導線
                  </a>
                ) : null}
              </div>
            ) : null}

            <p className="note">
              {data.note
                ? data.note
                : "出走はボートレース日和、履歴・得意コースはOpenAPI/艇愛DB。予想は娯楽・参考用で的中や回収を保証しません。"}
            </p>
          </>
        ) : null}
      </section>

      {research ? (
        <section className="panel" style={{ marginTop: "1rem" }}>
          <h2 style={{ fontFamily: "var(--font-display)", marginTop: 0 }}>3段検証レポート</h2>
          <p className="note">
            学習 {research.backtestSummary.train_n.toLocaleString()} レース /
            検証 {research.backtestSummary.test_n.toLocaleString()} レース /
            本命ROI150%超 {research.backtestSummary.strategies_ge_150_test} 本
          </p>
          <div className="band-grid">
            <div className="side-card on">
              <span>本命</span>
              <strong>
                ROI {research.lockedHonmei.validated_test_roi.toFixed(1)}%
              </strong>
              <div className="note" style={{ margin: "0.35rem 0 0" }}>
                {research.lockedHonmei.ticketLabel} / 場{" "}
                {research.lockedHonmei.stadium_whitelist.join(",")}
              </div>
            </div>
            <div className={`side-card ${research.lockedTriple?.oshi?.meets_target ? "on" : ""}`}>
              <span>押し目</span>
              <strong>
                ROI {(research.lockedTriple?.oshi?.validated_test_roi ?? 0).toFixed(1)}%
                {research.lockedTriple?.oshi?.validated_test_hit_rate != null
                  ? ` / 的中 ${research.lockedTriple.oshi.validated_test_hit_rate.toFixed(1)}%`
                  : ""}
              </strong>
              <div className="note" style={{ margin: "0.35rem 0 0" }}>
                {research.lockedTriple?.oshi?.ticketLabel ?? "探索中"}
                {research.lockedTriple?.oshi?.meets_target ? " / 目標達成" : " / 目標未達・最良候補"}
              </div>
            </div>
            <div className={`side-card ${research.lockedTriple?.ana?.meets_target ? "on" : ""}`}>
              <span>穴目</span>
              <strong>
                ROI {(research.lockedTriple?.ana?.validated_test_roi ?? 0).toFixed(1)}%
                {research.lockedTriple?.ana?.validated_test_hit_rate != null
                  ? ` / 的中 ${research.lockedTriple.ana.validated_test_hit_rate.toFixed(1)}%`
                  : ""}
              </strong>
              <div className="note" style={{ margin: "0.35rem 0 0" }}>
                {research.lockedTriple?.ana?.ticketLabel ?? "探索中"}
                {research.lockedTriple?.ana?.meets_target ? " / 目標達成" : " / 目標未達・最良候補"}
              </div>
            </div>
          </div>
          <p className="note">{research.oddsAnomaly?.note}</p>
          <p className="note">{research.exhibition.note}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>場</th>
                  <th>イン逃げ率</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(research.stadiumInnige)
                  .sort((a, b) => b[1].rate - a[1].rate)
                  .map(([name, v]) => (
                    <tr key={name}>
                      <td>
                        {name}
                        {research.lockedHonmei.stadium_whitelist.includes(v.stadium)
                          ? " ★本命対象"
                          : ""}
                      </td>
                      <td>{(v.rate * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <h3 style={{ marginTop: "1rem" }}>ノリ好調（直近1ヶ月 / as of {research.hotRacers.as_of}）</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>選手</th>
                  <th>出走</th>
                  <th>勝率</th>
                  <th>得意コース</th>
                </tr>
              </thead>
              <tbody>
                {research.hotRacers.windows["1m"].slice(0, 10).map((r) => (
                  <tr key={r.name + r.starts}>
                    <td>{r.name}</td>
                    <td>{r.starts}</td>
                    <td>{(r.win_rate * 100).toFixed(1)}%</td>
                    <td>{r.best_course ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}

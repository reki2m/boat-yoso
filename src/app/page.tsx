"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

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
  why?: string;
  tickets: string[];
  ticketLabel: string;
  betType: string;
  validatedRoi?: number;
  validatedHit?: number;
  meetsTarget?: boolean;
  blockedByOdds?: boolean;
};

type EquityBand = {
  selected: number;
  hits: number;
  hit_rate: number;
  bets: number;
  pay: number;
  pnl: number;
  roi: number;
  final_equity: number;
  curve: Array<{ n: number; equity: number; hit: boolean; date: string }>;
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
  exhibition?: {
    ready: boolean;
    reason: string;
    entryChanged: boolean;
    changes: Array<{ boat: number; name: string; from: number; to: number }>;
    boats: Array<{
      boat: number;
      name: string;
      entry: number;
      course: number | null;
      slit: number | null;
      lapTime: number | null;
      entryChanged: boolean;
    }>;
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
    why?: string;
    disclaimer: string;
    ticketsLocked?: boolean;
    skipped?: boolean;
    skipReason?: string | null;
    liveUrls?: {
      mediaTop: string;
      raceIndex: string;
      raceList: string;
      beforeInfo: string;
      placeName: string;
    };
  };
};

type Research = {
  lockedHonmei: {
    ticketLabel: string;
    validated_test_roi: number;
    validated_test_selected: number;
    stadium_whitelist: number[];
  };
  lockedTriple?: {
    oshi?: {
      ticketLabel?: string;
      validated_test_roi?: number;
      validated_test_hit_rate?: number;
      meets_target?: boolean;
    } | null;
    ana?: {
      ticketLabel?: string;
      validated_test_roi?: number;
      validated_test_hit_rate?: number;
      meets_target?: boolean;
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
  equity10k?: {
    stake_per_race: number;
    period: string;
    note: string;
    bands: Record<string, EquityBand>;
    portfolio: EquityBand & { rule?: string };
  };
};

type LiveStadium = {
  id: number;
  name: string;
  open: boolean;
  liveUrl: string;
  raceIndex: string;
  beforeInfo: string;
};

function EquityMiniChart({
  curve,
  color,
}: {
  curve: Array<{ n: number; equity: number }>;
  color: string;
}) {
  const points = useMemo(() => {
    if (!curve.length) return "";
    const xs = curve.map((c) => c.n);
    const ys = curve.map((c) => c.equity);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys, 0);
    const maxY = Math.max(...ys, 0);
    const w = 320;
    const h = 90;
    const sx = (x: number) => ((x - minX) / Math.max(maxX - minX, 1)) * (w - 8) + 4;
    const sy = (y: number) => h - ((y - minY) / Math.max(maxY - minY, 1)) * (h - 8) - 4;
    return curve.map((c, i) => `${i ? "L" : "M"}${sx(c.n).toFixed(1)},${sy(c.equity).toFixed(1)}`).join(" ");
  }, [curve]);
  if (!curve.length) return null;
  return (
    <svg viewBox="0 0 320 90" className="equity-svg" aria-hidden>
      <path d={points} fill="none" stroke={color} strokeWidth="2.5" />
    </svg>
  );
}

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
  const [purchased, setPurchased] = useState(false);
  const [demoExhibition, setDemoExhibition] = useState(false);
  const [liveStadiums, setLiveStadiums] = useState<LiveStadium[]>([]);
  const [liveDate, setLiveDate] = useState("");
  const [activeLive, setActiveLive] = useState<LiveStadium | null>(null);

  useEffect(() => {
    fetch("/api/schedule")
      .then((r) => r.json())
      .then((json) => {
        setStadiums(json.stadiums ?? []);
        setRaces(json.races ?? Array.from({ length: 12 }, (_, i) => i + 1));
        setDateLabel(json.dateLabel ?? "");
        if (json.stadiums?.[0]?.id) setPlace(json.stadiums[0].id);
        setRace(1);
      })
      .catch(() => setError("開催場の取得に失敗しました"));
    fetch("/api/research")
      .then((r) => r.json())
      .then((json) => setResearch(json))
      .catch(() => undefined);
    fetch("/api/live")
      .then((r) => r.json())
      .then((json) => {
        setLiveStadiums(json.stadiums ?? []);
        setLiveDate(json.date ?? "");
        const firstOpen = (json.stadiums as LiveStadium[] | undefined)?.find((s) => s.open);
        if (firstOpen) setActiveLive(firstOpen);
      })
      .catch(() => undefined);
  }, []);

  function load(opts?: { demo?: boolean }) {
    setError("");
    setPurchased(false);
    const useDemo = opts?.demo ?? demoExhibition;
    startTransition(async () => {
      try {
        const qs = new URLSearchParams({
          place: String(place),
          race: String(race),
        });
        if (useDemo) qs.set("demoExhibition", "1");
        const res = await fetch(`/api/race?${qs.toString()}`);
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

  // 展示待ちなら自動再取得（朝1Rから監視）
  useEffect(() => {
    if (!data?.tripleSystem?.ticketsLocked) return;
    const t = setInterval(() => load(), 45000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.tripleSystem?.ticketsLocked, place, race]);

  const maxScore = data
    ? Math.max(...data.prediction.rankings.map((r) => r.score ?? 0), 1)
    : 1;
  const triple = data?.tripleSystem;
  const activeBand = triple?.active?.[0];
  const liveUrls = triple?.liveUrls;

  return (
    <main className="shell">
      <section className="hero">
        <h1 className="brand">潮読み</h1>
        <p className="lede">
          本命だけ。三連単1-2-3単点、対象8場、1R/9R除外。展示・オッズ通過後だけ買う。1日だいたい1レース前後。
        </p>
        <div className="cta-row">
          <button className="btn" onClick={() => load()} disabled={pending}>
            {pending ? "読み込み中…" : "今日のレースを読む"}
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              setDemoExhibition(true);
              load({ demo: true });
            }}
            disabled={pending}
          >
            展示デモで確認
          </button>
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
              {(races.length ? races : Array.from({ length: 12 }, (_, i) => i + 1)).map((n) => (
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
          <button className="btn" onClick={() => load()} disabled={pending}>
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
              <span className={`badge ${data.exhibition?.ready ? "" : "warn"}`}>
                展示: {data.exhibition?.ready ? "確定" : "待ち"}
              </span>
              <span className={`badge ${triple?.anomaly.ok ? "" : "warn"}`}>
                オッズ: {triple?.anomaly.ok ? "妥当" : "要注意"}
              </span>
            </div>

            <div
              className={`anomaly ${
                triple?.skipped ? "bad" : data.exhibition?.ready ? "ok" : "bad"
              }`}
            >
              <strong>スタート展示ゲート</strong>
              <p>{data.exhibition?.reason ?? triple?.focus}</p>
              {data.exhibition?.entryChanged || triple?.skipped ? (
                <div className="note" style={{ margin: 0 }}>
                  進入変更・予期しない事態を検知 → このレースはスキップします。
                  {(data.exhibition?.changes ?? [])
                    .map((c) => `${c.boat}号 ${c.from}→${c.to}`)
                    .join(" / ")}
                </div>
              ) : null}
              {data.exhibition?.boats?.length ? (
                <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>枠</th>
                        <th>選手</th>
                        <th>進入</th>
                        <th>スリット</th>
                        <th>周回</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.exhibition.boats.map((b) => (
                        <tr key={b.boat}>
                          <td>{b.entry}</td>
                          <td>{b.name}</td>
                          <td>{b.course ?? "—"}{b.entryChanged ? " ※変更" : ""}</td>
                          <td>{b.slit ?? "—"}</td>
                          <td>{b.lapTime ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>

            <div className="pick">
              <div className="pick-main">
                <span className="badge">{triple?.focus ?? "参考スコア"}</span>
                <h2>
                  {triple?.skipped
                    ? "スキップ"
                    : triple?.ticketsLocked
                      ? "買い目ロック中"
                      : activeBand
                        ? `${activeBand.label}採用`
                        : "見送り"}
                </h2>
                <p>
                  {triple?.skipped
                    ? "進入変更または予期しない事態のため、このレースは買いません。"
                    : triple?.ticketsLocked
                      ? "進入状況・スリット・周回タイムの確定後に買い目を出します。"
                      : activeBand
                        ? `${activeBand.ticketLabel} / ${activeBand.tickets.join(" · ")}`
                        : data.prediction.summary}
                </p>
                <div className="sanren">
                  {triple?.skipped
                    ? "SKIP"
                    : triple?.ticketsLocked
                      ? "WAIT"
                      : (activeBand?.tickets?.length
                          ? activeBand.tickets
                          : ["見送り"]
                        ).join(" / ")}
                </div>
                {triple?.why ? (
                  <div className="why-box">
                    <strong>なぜこのレースか</strong>
                    <p>{triple.why}</p>
                    {activeBand?.reasons?.length ? (
                      <ul>
                        {activeBand.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
                {!triple?.ticketsLocked &&
                !triple?.skipped &&
                (triple?.portfolioTickets?.length ?? 0) > 0 ? (
                  <div className="cta-row" style={{ marginTop: "1rem" }}>
                    <button
                      className="btn"
                      onClick={() => setPurchased(true)}
                    >
                      購入した
                    </button>
                  </div>
                ) : null}
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
                    </span>
                    <strong>{b.ok ? b.tickets.join(" · ") : "見送り"}</strong>
                    <div className="note" style={{ margin: "0.35rem 0 0" }}>
                      {b.ok
                        ? `${b.ticketLabel}${b.validatedRoi != null ? ` / 検証ROI ${b.validatedRoi.toFixed(1)}%` : ""}`
                        : b.reasons.slice(0, 2).join(" / ")}
                    </div>
                    {b.ok && b.why ? (
                      <div className="note" style={{ margin: "0.45rem 0 0" }}>
                        {b.why}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {purchased && liveUrls ? (
              <div className="live-box purchased">
                <strong>購入済み → ライブ放送</strong>
                <p className="note" style={{ marginTop: "0.35rem" }}>
                  {liveUrls.placeName} の公式ライブ入口を開きます。
                </p>
                <div className="cta-row">
                  <a className="btn" href={liveUrls.mediaTop} target="_blank" rel="noreferrer">
                    公式ライブを見る
                  </a>
                  <a className="btn ghost" href={liveUrls.beforeInfo} target="_blank" rel="noreferrer">
                    直前情報
                  </a>
                  <a className="btn ghost" href={liveUrls.raceList} target="_blank" rel="noreferrer">
                    出走表
                  </a>
                </div>
                {liveUrls.mediaTop ? (
                  <iframe
                    title="boatrace-live"
                    className="live-frame"
                    src={liveUrls.mediaTop}
                    referrerPolicy="no-referrer"
                  />
                ) : null}
              </div>
            ) : null}

            {triple ? (
              <div className={`anomaly ${triple.anomaly.ok ? "ok" : "bad"}`}>
                <strong>異常オッズ監視</strong>
                <p>{triple.anomaly.advice}</p>
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
                      <td>{r.nationalWin.toFixed(2)}</td>
                      <td>{r.motorTop2.toFixed(1)}%</td>
                      <td>{r.avgStart.toFixed(2)}</td>
                      <td>
                        {r.courseSkill?.label ?? "—"}
                        <div className="note" style={{ margin: 0 }}>
                          勝率 {((r.courseSkill?.winRate ?? 0) * 100).toFixed(1)}%
                        </div>
                      </td>
                      <td style={{ minWidth: 110 }}>
                        {(r.score ?? 0).toFixed(1)}
                        <div className="scorebar">
                          <i style={{ width: `${((r.score ?? 0) / maxScore) * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      <section className="panel" style={{ marginTop: "1rem" }}>
        <h2 style={{ fontFamily: "var(--font-display)", marginTop: 0 }}>全場ライブ</h2>
        <p className="note">
          {liveDate || "本日"} — 場を押すとその場の公式ライブ入口が開きます。開催中の場を優先表示。
        </p>
        <div className="stadium-live-grid">
          {liveStadiums.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`stadium-live-btn ${s.open ? "open" : ""} ${
                activeLive?.id === s.id ? "active" : ""
              }`}
              onClick={() => {
                setActiveLive(s);
                setPlace(s.id);
              }}
            >
              <span>{s.name}</span>
              <strong>{s.open ? "開催中" : "休催"}</strong>
            </button>
          ))}
        </div>
        {activeLive ? (
          <div className="live-box purchased">
            <strong>{activeLive.name} ライブ</strong>
            <div className="cta-row" style={{ marginTop: "0.65rem" }}>
              <a className="btn" href={activeLive.liveUrl} target="_blank" rel="noreferrer">
                公式ライブを開く
              </a>
              <a className="btn ghost" href={activeLive.beforeInfo} target="_blank" rel="noreferrer">
                直前情報
              </a>
              <a className="btn ghost" href={activeLive.raceIndex} target="_blank" rel="noreferrer">
                レース一覧
              </a>
            </div>
            <iframe
              title={`${activeLive.name}-live`}
              className="live-frame"
              src={activeLive.liveUrl}
              referrerPolicy="no-referrer"
            />
          </div>
        ) : null}
      </section>

      <StakeSimulationPanel
        band={research?.equity10k?.bands?.honmei}
        period={research?.equity10k?.period}
        baseStake={research?.equity10k?.stake_per_race || 10000}
      />
    </main>
  );
}

const STAKE_OPTIONS = [1000, 2000, 3000] as const;

function scaleEquityBand(band: EquityBand, baseStake: number, stake: number): EquityBand {
  const ratio = stake / Math.max(baseStake, 1);
  return {
    ...band,
    bets: Math.round(band.bets * ratio),
    pay: Math.round(band.pay * ratio),
    pnl: Math.round(band.pnl * ratio),
    final_equity: Math.round(band.final_equity * ratio),
    curve: band.curve.map((c) => ({
      ...c,
      equity: Math.round(c.equity * ratio),
    })),
  };
}

function StakeSimulationPanel({
  band,
  period,
  baseStake,
}: {
  band?: EquityBand;
  period?: string;
  baseStake: number;
}) {
  const [stake, setStake] = useState<(typeof STAKE_OPTIONS)[number]>(1000);
  if (!band) {
    return (
      <section className="panel" style={{ marginTop: "1rem" }}>
        <h2 style={{ fontFamily: "var(--font-display)", marginTop: 0 }}>資金別シミュレーション</h2>
        <p className="status">検証データを読み込み中…</p>
      </section>
    );
  }
  const scaled = scaleEquityBand(band, baseStake, stake);
  return (
    <section className="panel" style={{ marginTop: "1rem" }}>
      <h2 style={{ fontFamily: "var(--font-display)", marginTop: 0 }}>資金別シミュレーション</h2>
      <p className="note">
        本命FIXの検証期間 {period || "—"} を、1レースあたりの投資額で換算した参考値です。将来の利益を保証しません。
      </p>
      <div className="cta-row" style={{ margin: "0.85rem 0 1rem" }}>
        {STAKE_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className={`btn ${stake === s ? "" : "ghost"}`}
            onClick={() => setStake(s)}
          >
            {s.toLocaleString()}円/レース
          </button>
        ))}
      </div>
      <div className="band-grid">
        <div className="side-card on">
          <span>最終損益</span>
          <strong>{scaled.pnl.toLocaleString()}円</strong>
          <div className="note" style={{ margin: "0.35rem 0 0" }}>
            ROI {scaled.roi.toFixed(1)}%
          </div>
        </div>
        <div className="side-card on">
          <span>投資合計</span>
          <strong>{scaled.bets.toLocaleString()}円</strong>
          <div className="note" style={{ margin: "0.35rem 0 0" }}>
            払戻 {scaled.pay.toLocaleString()}円
          </div>
        </div>
        <div className="side-card on">
          <span>対象レース</span>
          <strong>{scaled.selected}R</strong>
          <div className="note" style={{ margin: "0.35rem 0 0" }}>
            的中 {scaled.hit_rate.toFixed(1)}%（{scaled.hits}本）
          </div>
        </div>
      </div>
      <div className="side-card on" style={{ marginTop: "0.85rem" }}>
        <span>{stake.toLocaleString()}円/レースの収支推移</span>
        <EquityMiniChart curve={scaled.curve} color="#3ad0c4" />
      </div>
    </section>
  );
}

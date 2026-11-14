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
    signals?: {
      source?: string;
      notes?: string[];
      stretchSlits?: Array<{ boat: number; slit: number }>;
      fastLaps?: Array<{ boat: number; lapTime: number }>;
    };
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
      aiSummary?: string[];
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
      officialSite?: string;
      stadiumPage?: string;
      liveNote?: string;
    };
  };
  seriesDay?: number | null;
  seriesDayLabel?: string;
  deepPicks?: {
    tickets: Array<{ combo: string; rank: number; role: string; why: string; reasons?: string[] }>;
    count: number;
    axis: number;
    partners: number[];
    confidence: number;
    confidenceLabel?: string;
    commentary: string[];
    sTickets?: Array<{ combo: string; rank: number; role: string; why: string; reasons?: string[] }>;
    sCount?: number;
    sSingleTickets?: Array<{ combo: string; rank: number; role: string; why: string; reasons?: string[] }>;
    sSingleCount?: number;
    sReady?: boolean;
    sLabel?: string;
    oshiTickets?: Array<{ combo: string; rank: number; role: string; why: string; reasons?: string[] }>;
    oshiCount?: number;
    oshiAxis?: number | null;
    oshiCommentary?: string[];
    anaTickets?: Array<{ combo: string; rank: number; role: string; why: string; reasons?: string[] }>;
    anaCount?: number;
    anaAxis?: number | null;
    anaHitPct?: number;
    anaConfidence?: number;
    anaConfidenceLabel?: string;
    anaCommentary?: string[];
    method: string;
    racerViews?: Array<{
      course: number;
      name: string;
      className: string;
      score: number;
      nationalWin: number;
      recentWin: number;
      localWin: number;
      motorTop2: number;
      boatTop2: number;
      avgStart: number;
      seriesLabel: string;
      reasons: string[];
    }>;
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
  update?: {
    cadence?: string;
    last_success_at?: string | null;
    last_success_date?: string | null;
    last_confirm_at?: string | null;
    auto?: boolean;
  };
  learning?: {
    applied?: boolean;
    status?: string;
    note?: string;
    ops_status?: string | null;
    rolling_roi?: number | null;
    last_learn_at?: string | null;
    auto?: boolean;
    cadence?: string;
    best?: { name?: string; roi?: number; n?: number };
    baseline?: { roi?: number; n?: number };
  };
};

type LiveStadium = {
  id: number;
  name: string;
  open: boolean;
  liveUrl: string;
  raceIndex: string;
  beforeInfo: string;
  raceList?: string;
  officialSite?: string;
  stadiumPage?: string;
  liveNote?: string;
};

type BoardPick = {
  stadium?: number;
  stadium_name?: string;
  race?: number;
  tickets?: string[];
  status?: string;
  why?: string;
  skip_reason?: string | null;
  label?: string;
  band?: string;
  points?: number;
  reasons?: string[];
  stake_per_ticket?: number;
  validated_roi?: number | null;
};

type PicksBoard = {
  active_date?: string;
  date?: string;
  count?: number;
  mode?: string;
  picks?: BoardPick[];
  note?: string;
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
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();
  const [liveStadiums, setLiveStadiums] = useState<LiveStadium[]>([]);
  const [liveDate, setLiveDate] = useState("");
  const [activeLive, setActiveLive] = useState<LiveStadium | null>(null);
  const [board, setBoard] = useState<PicksBoard | null>(null);
  const [boardStale, setBoardStale] = useState(false);
  const [operatorKey, setOperatorKey] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatMsg, setChatMsg] = useState("");
  const [raceConfidence, setRaceConfidence] = useState<Record<string, number>>({});
  const [exhibitionCheckedAt, setExhibitionCheckedAt] = useState("");
  /** 買い目カードを押すと理由を開く */
  const [openTicketKey, setOpenTicketKey] = useState("");
  /** 本日ボードの買い目理由 */
  const [openBoardPickKey, setOpenBoardPickKey] = useState("");
  /** none=出さない / board=本日の本命 / race=表示中レース予想 */
  const [chatShareMode, setChatShareMode] = useState<"none" | "board" | "race">("none");

  useEffect(() => {
    try {
      // 旧版で保存した運営キーを破棄（ブラウザ保存しない）
      window.localStorage.removeItem("shioyomi_operator_key");
      window.localStorage.removeItem("shioyomi_admin_key");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [scheduleRes, picksRes] = await Promise.all([
          fetch("/api/schedule"),
          fetch("/api/picks"),
        ]);
        const scheduleJson = await scheduleRes.json();
        const picksJson = await picksRes.json().catch(() => ({}));
        if (cancelled) return;

        const nextStadiums: Stadium[] = scheduleJson.stadiums ?? [];
        setStadiums(nextStadiums);
        setRaces(scheduleJson.races ?? Array.from({ length: 12 }, (_, i) => i + 1));
        setDateLabel(scheduleJson.dateLabel ?? "");

        const nextBoard = (picksJson.board as PicksBoard) || null;
        setBoard(nextBoard);
        setBoardStale(Boolean(picksJson.stale));
        const first = (nextBoard?.picks || []).find(
          (p) => p.status !== "skipped" && p.stadium && p.race,
        );
        if (first?.stadium && first?.race) {
          await load({ placeNo: Number(first.stadium), raceNo: Number(first.race) });
        } else if (nextStadiums[0]?.id) {
          await load({ placeNo: nextStadiums[0].id, raceNo: 1 });
        }
      } catch {
        if (!cancelled) setError("開催場の取得に失敗しました");
      }
    }

    void bootstrap();
    const loadResearch = () =>
      fetch("/api/research")
        .then((r) => r.json())
        .then((json) => {
          if (!cancelled) setResearch(json);
        })
        .catch(() => undefined);
    void loadResearch();
    // 最新の学習・更新状態を定期取得（自動学習の反映をUIに載せる）
    const researchTimer = window.setInterval(() => {
      void loadResearch();
    }, 5 * 60 * 1000);
    fetch("/api/live")
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        setLiveStadiums(json.stadiums ?? []);
        setLiveDate(json.date ?? "");
        const firstOpen = (json.stadiums as LiveStadium[] | undefined)?.find((s) => s.open);
        if (firstOpen) setActiveLive(firstOpen);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      window.clearInterval(researchTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(opts?: {
    placeNo?: number;
    raceNo?: number;
    quiet?: boolean;
  }) {
    const placeNo = opts?.placeNo ?? place;
    const raceNo = opts?.raceNo ?? race;
    if (opts?.placeNo != null) setPlace(opts.placeNo);
    if (opts?.raceNo != null) setRace(opts.raceNo);
    if (!opts?.quiet) {
      setError("");
      setLoading(true);
    }
    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), 20000);
    try {
      const qs = new URLSearchParams({
        place: String(placeNo),
        race: String(raceNo),
      });
      const res = await fetch(`/api/race?${qs.toString()}`, { signal: ac.signal });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "取得失敗");
      startTransition(() => setData(json));
      setExhibitionCheckedAt(
        new Intl.DateTimeFormat("ja-JP", {
          timeZone: "Asia/Tokyo",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(new Date()),
      );
    } catch (e) {
      if (opts?.quiet) return;
      const msg =
        e instanceof DOMException && e.name === "AbortError"
          ? "取得がタイムアウトしました。もう一度押してください。"
          : e instanceof Error
            ? e.message
            : "取得失敗";
      setError(msg);
    } finally {
      window.clearTimeout(timer);
      if (!opts?.quiet) setLoading(false);
    }
  }

  // 展示が出るまで自動監視。ロック中は20秒、それ以外も60秒で最新化
  useEffect(() => {
    if (!data) return;
    const locked = Boolean(data.tripleSystem?.ticketsLocked);
    const ms = locked ? 20000 : 60000;
    const t = setInterval(() => {
      void load({ quiet: true });
    }, ms);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.tripleSystem?.ticketsLocked, place, race]);

  // 場を変えたら各Rの信頼度を取得して色分け
  useEffect(() => {
    let cancelled = false;
    async function fetchConfidence() {
      try {
        const res = await fetch(`/api/confidence-map?place=${place}`);
        const json = await res.json();
        if (!cancelled && json?.confidences) {
          setRaceConfidence(json.confidences as Record<string, number>);
        }
      } catch {
        if (!cancelled) setRaceConfidence({});
      }
    }
    void fetchConfidence();
    return () => {
      cancelled = true;
    };
  }, [place]);

  const maxScore = data
    ? Math.max(...data.prediction.rankings.map((r) => r.score ?? 0), 1)
    : 1;
  const triple = data?.tripleSystem;
  const activeBand = triple?.active?.[0];
  const liveUrls = triple?.liveUrls;
  const boardDate = board?.active_date || board?.date || "";
  const boardPicks = board?.picks || [];
  const buyablePicks = boardPicks.filter((p) => p.status !== "skipped");

  return (
    <main className="shell">
      <section className="hero">
        <h1 className="brand">律丸ボート部</h1>
        <p className="brand-sub">本命・押し目・穴 · 今日のレース</p>
        <div className="gate-rail" aria-hidden>
          <i /><i /><i /><i /><i /><i />
        </div>
        <p className="lede">
          本命は強イン逃げで1-2-3単点（2026検証）。本命Sは単点と条件付き5点を両方表示（5点検証ROI約140%）。押し・穴は本線で見送り。
        </p>
        {research?.update || research?.learning ? (
          <div className="meta" style={{ marginBottom: "0.85rem" }}>
            <span className="badge">最新データ自動取得</span>
            <span className="badge">回収率自動学習</span>
            {research.update?.last_success_date ? (
              <span className="badge">更新 {research.update.last_success_date}</span>
            ) : (
              <span className="badge">更新待機</span>
            )}
            {research.learning?.rolling_roi != null ? (
              <span className="badge">
                学習ROI {Number(research.learning.rolling_roi).toFixed(1)}%
              </span>
            ) : null}
            {research.learning?.applied ? <span className="badge">閾値学習適用</span> : null}
            {research.learning?.ops_status ? (
              <span className="badge">{String(research.learning.ops_status)}</span>
            ) : null}
            {research.learning?.last_learn_at ? (
              <span className="badge">
                学習{" "}
                {String(research.learning.last_learn_at).slice(0, 16).replace("T", " ")}
              </span>
            ) : null}
          </div>
        ) : null}
        {research?.learning?.note || research?.update?.cadence || research?.learning?.cadence ? (
          <p className="note" style={{ marginTop: "-0.35rem", marginBottom: "0.85rem" }}>
            {String(
              research?.learning?.cadence ||
                research?.update?.cadence ||
                "毎日自動（最新データ→買い目→展示確認→的中再計算→回収率学習）",
            )}
            {research?.learning?.note ? ` / ${String(research.learning.note)}` : ""}
          </p>
        ) : null}
        <div className="cta-row">
          <button
            type="button"
            className="btn"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "読み込み中…" : "今日のレースを読む"}
          </button>
          <a className="btn ghost" href="/chat">
            専用チャットを開く
          </a>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              void (async () => {
                await fetch("/api/app-auth", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "logout" }),
                });
                window.location.href = "/login";
              })();
            }}
          >
            アプリをロック
          </button>
        </div>
        <details style={{ marginTop: "0.85rem" }}>
          <summary className="note" style={{ cursor: "pointer" }}>
            管理人メニュー（チャット投稿・一括消去）
          </summary>
          <div className="cta-row" style={{ marginTop: "0.65rem" }}>
            <div className="field" style={{ minWidth: 220 }}>
              <label htmlFor="chatShareMode">チャット欄への反映</label>
              <select
                id="chatShareMode"
                value={chatShareMode}
                onChange={(e) =>
                  setChatShareMode(e.target.value as "none" | "board" | "race")
                }
                className="chat-input"
              >
                <option value="none">出さない</option>
                <option value="board">本日の本命を出す</option>
                <option value="race">表示中のレース予想を出す</option>
              </select>
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setChatMsg("");
                const key = operatorKey.trim();
                if (!key) {
                  setChatMsg("管理人キーを入力してからアップしてください");
                  return;
                }
                if (chatShareMode === "none") {
                  setChatMsg("「チャット欄への反映」で出す内容を選んでください");
                  return;
                }
                if (chatShareMode === "race" && !data) {
                  setChatMsg("先にレースを予想してからアップしてください");
                  return;
                }
                setChatBusy(true);
                void (async () => {
                  try {
                    const body =
                      chatShareMode === "board"
                        ? {
                            operatorKey: key,
                            kind: "picks" as const,
                            mirrorDiscord: false,
                          }
                        : {
                            operatorKey: key,
                            kind: "note" as const,
                            mirrorDiscord: false,
                            note: [
                              `【管理人予想】${data?.placeName || `場${place}`} ${race}R`,
                              triple?.skipped
                                ? "スキップ（進入変更）"
                                : [
                                    `本命: ${(data?.deepPicks?.tickets || []).map((t) => t.combo).join(" / ") || "—"}`,
                                    data?.deepPicks?.sReady
                                      ? [
                                          `本命S単点: ${(data.deepPicks.sSingleTickets || []).map((t) => t.combo).join(" / ") || "—"}`,
                                          `本命S5点: ${(data.deepPicks.sTickets || []).map((t) => t.combo).join(" / ")}`,
                                        ].join("\n")
                                      : "本命S: 条件外",
                                    `押し目: ${(data?.deepPicks?.oshiTickets || []).map((t) => t.combo).join(" / ") || "—"}`,
                                    `穴: ${(data?.deepPicks?.anaTickets || []).map((t) => t.combo).join(" / ") || "—"}`,
                                  ].join("\n"),
                              data?.deepPicks?.commentary?.[0]
                                ? `説明: ${data.deepPicks.commentary[0]}`
                                : triple?.why
                                  ? `理由: ${triple.why}`
                                  : "",
                            ]
                              .filter(Boolean)
                              .join("\n"),
                          };
                    const res = await fetch("/api/chat", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(body),
                    });
                    const json = await res.json();
                    if (!res.ok) {
                      setChatMsg(json.hint || json.error || "アップに失敗しました");
                      return;
                    }
                    setChatMsg(
                      chatShareMode === "board"
                        ? "本日の本命を専用チャットにアップしました"
                        : "表示中のレース予想を専用チャットにアップしました",
                    );
                  } catch {
                    setChatMsg("アップに失敗しました");
                  } finally {
                    setChatBusy(false);
                  }
                })();
              }}
              disabled={chatBusy || chatShareMode === "none"}
            >
              {chatBusy ? "アップ中…" : "チャットにアップ"}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={chatBusy}
              onClick={() => {
                setChatMsg("");
                const key = operatorKey.trim();
                if (!key) {
                  setChatMsg("管理人キーを入力してから消去してください");
                  return;
                }
                if (
                  !window.confirm(
                    "専用チャット履歴を全消去します。管理人のみの操作です。よろしいですか？",
                  )
                ) {
                  return;
                }
                setChatBusy(true);
                void (async () => {
                  try {
                    const res = await fetch("/api/chat", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        operatorKey: key,
                        kind: "clear",
                      }),
                    });
                    const json = await res.json();
                    if (!res.ok) {
                      setChatMsg(json.hint || json.error || "消去に失敗しました");
                      return;
                    }
                    setChatMsg(`チャットを消去しました（${json.deleted ?? 0}件）`);
                  } catch {
                    setChatMsg("消去に失敗しました");
                  } finally {
                    setChatBusy(false);
                  }
                })();
              }}
            >
              一括消去
            </button>
          </div>
          <div className="field" style={{ marginTop: "0.65rem", maxWidth: 420 }}>
            <label htmlFor="operatorKey">管理人キー</label>
            <input
              id="operatorKey"
              type="password"
              value={operatorKey}
              onChange={(e) => setOperatorKey(e.target.value)}
              placeholder="CHAT_ADMIN_KEY"
              autoComplete="off"
              className="chat-input"
            />
          </div>
          {chatMsg ? <p className="note">{chatMsg}</p> : null}
        </details>
      </section>

      <section className="panel" style={{ marginBottom: "1rem" }}>
        <h2 style={{ fontFamily: "var(--font-display)", marginTop: 0 }}>今日の買い目</h2>
        <p className="note">
          {boardDate || dateLabel || "本日"} / {board?.mode || "honmei_fix_race_filter"} — カードを押すとそのレースを開きます。
          {exhibitionCheckedAt ? ` / 展示更新 ${exhibitionCheckedAt} JST` : ""}
        </p>
        {boardStale ? (
          <p className="chat-reset-note" style={{ marginTop: "0.75rem" }}>
            {(board as { stale_from?: string } | null)?.stale_from
              ? `${(board as { stale_from?: string }).stale_from} の買い目は非表示にしました。`
              : "前日の買い目は非表示にしています。"}
            当日分の生成待ちです。
          </p>
        ) : null}
        {buyablePicks.length ? (
          <div className="board-pick-stack" style={{ marginTop: "0.75rem" }}>
            {buyablePicks.map((p) => {
              const sid = Number(p.stadium || 0);
              const rid = Number(p.race || 0);
              const pickKey = `${sid}-${rid}-${p.label || p.band || ""}-${(p.tickets || []).join(",")}`;
              const active = place === sid && race === rid;
              const reasonOpen = openBoardPickKey === pickKey;
              return (
                <div key={pickKey} className={`board-pick-row ${active ? "active" : ""}`}>
                  <div className="cta-row" style={{ margin: 0 }}>
                    <button
                      type="button"
                      className={`btn ${active ? "" : "ghost"}`}
                      onClick={() => void load({ placeNo: sid, raceNo: rid })}
                      disabled={loading || !sid || !rid}
                    >
                      <span>
                        {(p.stadium_name || `場${sid}`) + ` ${rid}R `}
                        {p.label ? `· ${p.label} ` : ""}
                        <span className="board-pick-tickets">
                          {(p.tickets || ["1-2-3"]).join("/")}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`btn ghost ticket-reason-toggle ${reasonOpen ? "open" : ""}`}
                      aria-expanded={reasonOpen}
                      onClick={() =>
                        setOpenBoardPickKey((prev) => (prev === pickKey ? "" : pickKey))
                      }
                    >
                      買い目の理由
                    </button>
                  </div>
                  {reasonOpen ? (
                    <div className="ticket-reason-panel">
                      <strong>買い目の理由 · {(p.tickets || []).join(" / ")}</strong>
                      {p.why ? <p>{p.why}</p> : null}
                      {(p.reasons || []).length ? (
                        <ul>
                          {p.reasons!.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      ) : null}
                      {p.validated_roi != null ? (
                        <p className="note">検証ROI目安 約{Number(p.validated_roi).toFixed(1)}%</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="status" style={{ marginBottom: 0 }}>
            本日の本命ボード該当はありません。下でレースを選ぶと押し目・穴は出ます。
          </p>
        )}
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
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>レース（信頼度4=橙 / 5=赤）</label>
            <div className="race-pick-grid">
              {(races.length ? races : Array.from({ length: 12 }, (_, i) => i + 1)).map((n) => {
                const conf = Number(raceConfidence[String(n)] || 0);
                const tone =
                  conf >= 5 ? "conf5" : conf >= 4 ? "conf4" : conf > 0 ? "conf-mid" : "";
                return (
                  <button
                    key={n}
                    type="button"
                    className={`race-pick-btn ${tone} ${race === n ? "active" : ""}`}
                    onClick={() => {
                      setRace(n);
                      void load({ raceNo: n });
                    }}
                    disabled={loading}
                    title={conf ? `信頼度 ${conf}/5` : "信頼度未算出"}
                  >
                    {n}R
                    {conf >= 4 ? <em>{conf}</em> : null}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="field">
            <label>日付</label>
            <select disabled value="today">
              <option value="today">{dateLabel || "Asia/Tokyo 今日"}</option>
            </select>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "読み込み中…" : "予想する"}
          </button>
        </div>
        <p className="note" style={{ marginTop: "0.65rem" }}>
          展示は自動監視します
          {exhibitionCheckedAt ? `（最終確認 ${exhibitionCheckedAt} JST）` : ""}。
          買い目は朝時点で固定し、展示後は確定かスルーのみ（券種は変えません）。進入・スリット伸び・周回は直前CSVでも即時確認します。
        </p>

        {error ? <p className="status">{error}</p> : null}
        {!data && !error ? <p className="status">出走表を準備しています…</p> : null}

        {data ? (
          <>
            <div className="meta">
              <span className="badge">
                {data.placeName} {data.raceNo}R
              </span>
              {data.seriesDayLabel ? (
                <span className="badge">{data.seriesDayLabel}</span>
              ) : null}
              <span className="badge">{data.raceName || "番組"}</span>
              <span className="badge">{data.raceRank || "一般"}</span>
              <span className={`badge ${data.exhibition?.ready ? "" : "warn"}`}>
                展示:{" "}
                {triple?.skipped
                  ? "スルー"
                  : data.exhibition?.ready
                    ? "完了"
                    : "待ち（ロック）"}
              </span>
              {exhibitionCheckedAt ? (
                <span className="badge">更新 {exhibitionCheckedAt}</span>
              ) : null}
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
              {(data.exhibition?.signals?.notes?.length ||
                triple?.live?.aiSummary?.length) ? (
                <div className="note" style={{ margin: "0.35rem 0 0" }}>
                  即時シグナル:{" "}
                  {(data.exhibition?.signals?.notes?.length
                    ? data.exhibition.signals.notes
                    : triple?.live?.aiSummary || []
                  )
                    .slice(0, 3)
                    .join(" / ")}
                  {data.exhibition?.signals?.source
                    ? `（${data.exhibition.signals.source}）`
                    : ""}
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

            {data.deepPicks ? (
              <div className="panel" style={{ marginTop: "1rem", padding: "1rem" }}>
                <div className="meta" style={{ marginBottom: "0.65rem" }}>
                  <span className="badge">本日の買い目</span>
                  {data.seriesDayLabel ? (
                    <span className="badge">{data.seriesDayLabel}</span>
                  ) : null}
                  <span className="badge">
                    本命{data.deepPicks.count || 0}
                    {data.deepPicks.sReady ? ` · S${data.deepPicks.sCount || 0}` : ""}
                    {" · "}押し{data.deepPicks.oshiCount || 0} · 穴
                    {data.deepPicks.anaCount || 0}
                  </span>
                </div>

                <div className="band-grid" style={{ marginBottom: "0.85rem" }}>
                  <div className={`side-card band-honmei ${data.deepPicks.count ? "on" : ""}`}>
                    <span>
                      本命 · {data.deepPicks.count || 0}点
                      {data.deepPicks.confidence
                        ? ` · 信頼度${data.deepPicks.confidence}/5`
                        : ""}
                    </span>
                    <strong>
                      {data.deepPicks.tickets.length
                        ? data.deepPicks.tickets.map((t) => t.combo).join(" · ")
                        : "—"}
                    </strong>
                    <div className="note" style={{ margin: "0.35rem 0 0" }}>
                      本命{data.deepPicks.count || 0}点 · 軸{data.deepPicks.axis}号
                    </div>
                  </div>
                  <div
                    className={`side-card band-honmei ${data.deepPicks.sReady ? "on" : ""}`}
                    style={
                      data.deepPicks.sReady
                        ? { borderColor: "rgba(255, 176, 32, 0.75)" }
                        : undefined
                    }
                  >
                    <span>
                      本命S
                      {data.deepPicks.sReady
                        ? ` · 単点${data.deepPicks.sSingleCount || 0}+5点${data.deepPicks.sCount || 0}`
                        : ""}
                    </span>
                    <strong>
                      {data.deepPicks.sReady
                        ? [
                            (data.deepPicks.sSingleTickets || []).length
                              ? `単点 ${(data.deepPicks.sSingleTickets || []).map((t) => t.combo).join(" · ")}`
                              : null,
                            (data.deepPicks.sTickets || []).length
                              ? `5点 ${(data.deepPicks.sTickets || []).map((t) => t.combo).join(" · ")}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" ／ ")
                        : "条件外"}
                    </strong>
                    <div className="note" style={{ margin: "0.35rem 0 0" }}>
                      {data.deepPicks.sLabel || "単点と条件付き5点を併記"}
                    </div>
                  </div>
                  <div
                    className={`side-card band-oshi ${
                      data.deepPicks.oshiCount ? "on" : ""
                    }`}
                  >
                    <span>
                      押し目 · 見送り
                      {data.deepPicks.oshiAxis != null
                        ? ` · 軸${data.deepPicks.oshiAxis}号`
                        : ""}
                    </span>
                    <strong>
                      {(data.deepPicks.oshiTickets || []).length
                        ? data.deepPicks.oshiTickets!.map((t) => t.combo).join(" · ")
                        : "—"}
                    </strong>
                    <div className="note" style={{ margin: "0.35rem 0 0" }}>
                      2026検証で本線併売なし
                    </div>
                  </div>
                  <div
                    className={`side-card band-ana ${
                      data.deepPicks.anaCount ? "on" : ""
                    }`}
                  >
                    <span>
                      穴 · 見送り
                      {data.deepPicks.anaAxis != null
                        ? ` · 軸${data.deepPicks.anaAxis}号`
                        : ""}
                      {data.deepPicks.anaHitPct
                        ? ` · 参考${data.deepPicks.anaHitPct}%`
                        : ""}
                    </span>
                    <strong>
                      {(data.deepPicks.anaTickets || []).length
                        ? data.deepPicks.anaTickets!.map((t) => t.combo).join(" · ")
                        : "—"}
                    </strong>
                    <div className="note" style={{ margin: "0.35rem 0 0" }}>
                      2026検証で本線併売なし
                    </div>
                  </div>
                </div>

                {(
                  [
                    {
                      key: "s",
                      title: "本命S・単点の内訳",
                      show: Boolean(
                        data.deepPicks.sReady && (data.deepPicks.sSingleTickets || []).length,
                      ),
                      list: data.deepPicks.sSingleTickets || [],
                    },
                    {
                      key: "s5",
                      title: "本命S・5点の内訳",
                      show: Boolean(
                        data.deepPicks.sReady && (data.deepPicks.sTickets || []).length,
                      ),
                      list: data.deepPicks.sTickets || [],
                    },
                    {
                      key: "h",
                      title: `本命の内訳（${data.deepPicks.count || 0}点）`,
                      show: Boolean(data.deepPicks.tickets.length),
                      list: data.deepPicks.tickets,
                    },
                    {
                      key: "o",
                      title: "押し目の内訳",
                      show: Boolean((data.deepPicks.oshiTickets || []).length),
                      list: data.deepPicks.oshiTickets || [],
                    },
                    {
                      key: "a",
                      title: "穴の内訳",
                      show: Boolean((data.deepPicks.anaTickets || []).length),
                      list: data.deepPicks.anaTickets || [],
                    },
                  ] as const
                )
                  .filter((section) => section.show)
                  .map((section) => (
                    <div key={section.key} style={{ marginBottom: "0.85rem" }}>
                      <strong>
                        {section.title}
                        <span className="note" style={{ marginLeft: "0.45rem" }}>
                          「買い目の理由」で詳細
                        </span>
                      </strong>
                      <div className="band-grid" style={{ marginTop: "0.45rem" }}>
                        {section.list.map((t) => {
                          const ticketKey = `${section.key}-${t.combo}`;
                          const open = openTicketKey === ticketKey;
                          return (
                            <div key={ticketKey} className={`ticket-reason-card ${open ? "open" : ""}`}>
                              <button
                                type="button"
                                className="side-card on ticket-why-card"
                                aria-expanded={open}
                                onClick={() =>
                                  setOpenTicketKey((prev) =>
                                    prev === ticketKey ? "" : ticketKey,
                                  )
                                }
                              >
                                <span>
                                  {t.rank}. {t.role}
                                </span>
                                <strong>{t.combo}</strong>
                                <div className="note" style={{ margin: "0.35rem 0 0" }}>
                                  {open ? "理由を閉じる" : "買い目の理由"}
                                </div>
                              </button>
                              {open ? (
                                <div className="ticket-reason-panel">
                                  <strong>買い目の理由 · {t.combo}</strong>
                                  {t.why ? <p>{t.why}</p> : null}
                                  {(t.reasons || []).length ? (
                                    <ul>
                                      {t.reasons!.map((r) => (
                                        <li key={r}>{r}</li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="note">理由データなし</p>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                <div className="why-box" style={{ marginTop: "0.85rem" }}>
                  <strong>考察コメント</strong>
                  {data.deepPicks.commentary.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                  {(data.deepPicks.oshiCommentary || []).map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                  {(data.deepPicks.anaCommentary || []).map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                  <p className="note" style={{ marginBottom: 0 }}>
                    {data.deepPicks.method}
                  </p>
                </div>

                {data.deepPicks.racerViews?.length ? (
                  <div className="table-wrap" style={{ marginTop: "0.85rem" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>枠</th>
                          <th>選手</th>
                          <th>全国/直近</th>
                          <th>M/B</th>
                          <th>今節</th>
                          <th>評価</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.deepPicks.racerViews.map((r) => (
                          <tr key={r.course}>
                            <td>
                              <span className={`lane c${r.course}`}>{r.course}</span>
                            </td>
                            <td>
                              {r.name}
                              <div className="note" style={{ margin: 0 }}>
                                {r.className}
                              </div>
                            </td>
                            <td>
                              {r.nationalWin.toFixed(2)} / {r.recentWin.toFixed(2)}
                            </td>
                            <td>
                              {r.motorTop2.toFixed(0)}% / {r.boatTop2.toFixed(0)}%
                            </td>
                            <td>{r.seriesLabel}</td>
                            <td>{r.score.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="pick">
              <div className="pick-main">
                <span className="badge">
                  {data.seriesDayLabel
                    ? `${data.seriesDayLabel} · `
                    : ""}
                  {triple?.focus ?? "本日の推奨"}
                </span>
                <h2>
                  {triple?.skipped
                    ? "スキップ"
                    : triple?.ticketsLocked
                      ? "買い目ロック中"
                      : data.deepPicks?.sReady
                        ? "本命Sあり"
                        : data.deepPicks?.count
                          ? "本命採用"
                          : data.deepPicks?.oshiCount
                            ? "押し目"
                            : "推奨券を上で確認"}
                </h2>
                <p>
                  {triple?.skipped
                    ? "進入変更または予期しない事態のため、このレースは買いません。"
                    : triple?.ticketsLocked
                      ? "進入状況・スリット・周回タイムの確定後に買い目を確定します。"
                      : data.deepPicks?.sReady
                        ? [
                            data.deepPicks.sSingleTickets?.length
                              ? `本命S単点: ${data.deepPicks.sSingleTickets.map((t) => t.combo).join(" · ")}`
                              : null,
                            data.deepPicks.sTickets?.length
                              ? `本命S5点: ${data.deepPicks.sTickets.map((t) => t.combo).join(" · ")}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" ／ ")
                        : data.deepPicks?.tickets?.length
                          ? `本命: ${data.deepPicks.tickets.map((t) => t.combo).join(" · ")}`
                          : "上の本命・押し目・穴を参照してください。"}
                </p>
                <div className="sanren">
                  {triple?.skipped
                    ? "SKIP"
                    : triple?.ticketsLocked
                      ? "WAIT"
                      : (data.deepPicks?.sReady
                          ? [
                              ...(data.deepPicks.sSingleTickets || []).map((t) => t.combo),
                              ...(data.deepPicks.sTickets || []).map((t) => t.combo),
                            ]
                          : data.deepPicks?.tickets?.length
                            ? data.deepPicks.tickets.map((t) => t.combo)
                            : data.deepPicks?.oshiTickets?.map((t) => t.combo) ?? ["—"]
                        ).join(" / ")}
                </div>
                {triple?.why ? (
                  <div className="why-box">
                    <strong>なぜこのレースか（運用本命）</strong>
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
                <p className="note" style={{ marginTop: "0.4rem" }}>
                  {triple?.disclaimer}
                </p>
              </div>
              <div className="side-picks">
                {(
                  [
                    {
                      band: "honmei",
                      label: "本命",
                      ok: Boolean(data.deepPicks?.count),
                      tickets: data.deepPicks?.tickets.map((t) => t.combo) || [],
                      note: "2026検証ロジック",
                    },
                    {
                      band: "honmei-s",
                      label: "本命S・単点",
                      ok: Boolean(data.deepPicks?.sSingleTickets?.length),
                      tickets: data.deepPicks?.sSingleTickets?.map((t) => t.combo) || [],
                      note: "本命S単点（5点と併記）",
                    },
                    {
                      band: "honmei-s5",
                      label: "本命S・5点",
                      ok: Boolean(data.deepPicks?.sTickets?.length),
                      tickets: data.deepPicks?.sTickets?.map((t) => t.combo) || [],
                      note: data.deepPicks?.sLabel || "条件付き5点（回収100%超ゲート）",
                    },
                    {
                      band: "oshi",
                      label: "押し目",
                      ok: Boolean(data.deepPicks?.oshiCount),
                      tickets:
                        data.deepPicks?.oshiTickets?.map((t) => t.combo) || [],
                      note: "本線では見送り",
                    },
                    {
                      band: "ana",
                      label: "穴",
                      ok: Boolean(data.deepPicks?.anaCount),
                      tickets:
                        data.deepPicks?.anaTickets?.map((t) => t.combo) || [],
                      note: "本線では見送り",
                    },
                  ] as const
                ).map((b) => (
                  <div key={b.band} className={`side-card band-${b.band} ${b.ok ? "on" : ""}`}>
                    <span>{b.label}</span>
                    <strong>{b.ok ? b.tickets.join(" · ") : "見送り"}</strong>
                    <div className="note" style={{ margin: "0.35rem 0 0" }}>
                      {b.note}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {liveUrls ? (
              <div className="live-box purchased">
                <strong>{liveUrls.placeName} 公式リンク</strong>
                <div className="cta-row" style={{ marginTop: "0.55rem" }}>
                  <a
                    className="btn"
                    href={liveUrls.officialSite || liveUrls.stadiumPage || liveUrls.mediaTop}
                    target="_blank"
                    rel="noreferrer"
                  >
                    場公式HP
                  </a>
                  <a className="btn ghost" href={liveUrls.beforeInfo} target="_blank" rel="noreferrer">
                    レース情報
                  </a>
                  <a className="btn ghost" href={liveUrls.mediaTop} target="_blank" rel="noreferrer">
                    場ライブ
                  </a>
                </div>
              </div>
            ) : null}

            {triple ? (
              <div className={`anomaly ${triple.anomaly.ok ? "ok" : "bad"}`}>
                <strong>異常オッズ監視（稼働中）</strong>
                <p>{triple.anomaly.advice}</p>
                <div className="odds-row">
                  <span className={`badge ${triple.anomaly.overbet ? "warn" : ""}`}>
                    {triple.anomaly.overbet
                      ? "買われすぎ（本命見送り）"
                      : "買われすぎなし"}
                  </span>
                  <span className={`badge ${triple.anomaly.moneyConcentrate ? "warn" : ""}`}>
                    {triple.anomaly.moneyConcentrate
                      ? "大口集中（慎重）"
                      : "大口集中なし"}
                  </span>
                  {triple.anomaly.favorite ? (
                    <span className="badge">
                      1番人気 {triple.anomaly.favorite}
                      {triple.anomaly.favOdds != null
                        ? ` @ ${triple.anomaly.favOdds.toFixed(1)}`
                        : ""}
                    </span>
                  ) : (
                    <span className="badge warn">オッズ未取得</span>
                  )}
                </div>
                <p className="note" style={{ marginTop: "0.55rem" }}>
                  買われすぎ・資金集中のときは本命を自動見送りします。
                </p>
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

      <details className="panel" style={{ marginTop: "1rem", padding: "1rem" }}>
        <summary style={{ cursor: "pointer", fontFamily: "var(--font-display)" }}>
          全場リンク（{liveDate || "本日"}）
        </summary>
        <p className="note">場を押すと公式HP／レース情報／場ライブを開けます。</p>
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
            <strong>{activeLive.name}</strong>
            <div className="cta-row" style={{ marginTop: "0.65rem" }}>
              <a
                className="btn"
                href={activeLive.officialSite || activeLive.stadiumPage || activeLive.liveUrl}
                target="_blank"
                rel="noreferrer"
              >
                場公式HP
              </a>
              <a className="btn ghost" href={activeLive.beforeInfo} target="_blank" rel="noreferrer">
                レース情報
              </a>
              <a className="btn ghost" href={activeLive.liveUrl} target="_blank" rel="noreferrer">
                場ライブ
              </a>
            </div>
          </div>
        ) : null}
      </details>

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
  if (!band || !band.curve?.length) {
    return (
      <section className="panel" style={{ marginTop: "1rem" }}>
        <h2 style={{ fontFamily: "var(--font-display)", marginTop: 0 }}>資金別シミュレーション</h2>
        <p className="chat-reset-note" style={{ marginTop: "0.75rem" }}>
          資金シミュレーションは一旦リセット済みです。再計算後にここへ反映します。
        </p>
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

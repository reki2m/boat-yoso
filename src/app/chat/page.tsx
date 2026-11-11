"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";

type ChatMessage = {
  id: string;
  created_at: string;
  kind: "picks" | "note" | "chat";
  title: string;
  body: string;
  author_name?: string;
  author_role?: "operator" | "member";
  meta?: {
    date?: string;
    mode?: string;
    count?: number;
    discord?: boolean;
    placeNo?: number;
    raceNo?: number;
    tickets?: string[];
    visibility?: "public" | "private" | "admin";
    owner_session_id?: string;
    owner_name?: string;
  };
};

type ChatLiveTarget = {
  date: string;
  stadium: number;
  stadium_name: string;
  race: number;
  tickets: string[];
  status: string;
  skip_detail: string | null;
  why: string | null;
  live: {
    mediaTop: string;
    beforeInfo: string;
    officialSite?: string;
    stadiumPage?: string;
    liveNote?: string;
  };
};

type PresenceMember = {
  id: string;
  display_name: string;
  role: "operator" | "member";
  last_seen: string;
  me?: boolean;
};

type StadiumOpt = { id: number; name: string };

type AdminPredictionPick = {
  message_id: string;
  created_at: string;
  owner_name: string;
  date: string;
  placeNo: number;
  placeName: string;
  raceNo: number;
  tickets: string[];
  body: string;
  label: string;
  result: {
    settled: boolean;
    finishCombo: string | null;
    hitTickets: string[];
    stakeYen: number;
    payoutYen: number;
    recoveryPct: number | null;
  };
};

type AdminOwnerGroup = {
  owner_name: string;
  pickCount: number;
  settledCount: number;
  stakeYen: number;
  payoutYen: number;
  recoveryPct: number | null;
  picks: AdminPredictionPick[];
};

type AdminPredictionOversight = {
  stake_per_ticket: number;
  totals: {
    pickCount: number;
    settledCount: number;
    stakeYen: number;
    payoutYen: number;
    recoveryPct: number | null;
  };
  owners: AdminOwnerGroup[];
  picks: AdminPredictionPick[];
};

const INVITE_KEY = "shioyomi_chat_invite";
const NAME_KEY = "shioyomi_chat_name";
const LEGACY_OP_KEY = "shioyomi_operator_key";
const LEGACY_ADMIN_KEY = "shioyomi_admin_key";
const LEGACY_SESSION_KEY = "shioyomi_chat_session";

const DEFAULT_RULES = [
  "雑談と本命予想は全員のチャット欄に表示されます。",
  "場とレースを選ぶと、詳細のアプリ予想（穴目・理由など）が自分だけに追加表示されます。",
  "他の友達がどのレースを詳しく見たかは分かりません。",
  "チャット履歴は当日のレース終了から約1時間後に自動リセットされます。",
  "喧嘩・誹謗中傷・荒らし・個人攻撃は禁止です。",
  "予想・買い目は参考情報であり、的中や利益を保証しません。",
];

function formatJst(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function kindLabel(m: ChatMessage): string {
  if (m.meta?.mode === "admin_predict_log" || m.meta?.visibility === "admin") {
    return "管理人ログ";
  }
  if (m.meta?.mode === "app_race_pick" || m.meta?.visibility === "private") {
    return "詳細予想（自分のみ）";
  }
  if (m.meta?.mode === "chat_hit" || m.title.includes("的中")) return "的中🎯";
  if (m.kind === "picks" || m.meta?.mode === "morning_auto_honmei" || m.meta?.mode === "honmei_board") {
    return "本命予想";
  }
  if (m.kind === "note") return "メモ";
  return "雑談";
}

export default function ChatPage() {
  const [invite, setInvite] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [showAdminGate, setShowAdminGate] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rules, setRules] = useState<string[]>(DEFAULT_RULES);
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [targets, setTargets] = useState<ChatLiveTarget[]>([]);
  const [presence, setPresence] = useState<PresenceMember[]>([]);
  const [adminOversight, setAdminOversight] = useState<AdminPredictionOversight | null>(null);
  const [selectedAdminPickId, setSelectedAdminPickId] = useState<string>("");
  const [liveDate, setLiveDate] = useState("");
  const [stadiums, setStadiums] = useState<StadiumOpt[]>([]);
  const [races, setRaces] = useState<number[]>(Array.from({ length: 12 }, (_, i) => i + 1));
  const [pickStadium, setPickStadium] = useState<number>(0);
  const [pickRace, setPickRace] = useState<number>(1);
  const [pending, startTransition] = useTransition();
  const [sending, setSending] = useState(false);
  const [predicting, setPredicting] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_OP_KEY);
      window.localStorage.removeItem(LEGACY_ADMIN_KEY);
      window.localStorage.removeItem(LEGACY_SESSION_KEY);
    } catch {
      // ignore
    }
    const savedInvite = window.localStorage.getItem(INVITE_KEY) || "";
    const savedName = window.localStorage.getItem(NAME_KEY) || "";
    if (savedName) setDisplayName(savedName);
    if (savedInvite) {
      setInvite(savedInvite);
      void enterAndLoad(savedInvite, savedName || "メンバー", false);
    }
    void loadSchedule();
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    const onLeave = () => {
      const payload = JSON.stringify({
        kind: "leave",
        invite: invite.trim(),
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/chat",
          new Blob([payload], { type: "application/json" }),
        );
      }
    };
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  }, [unlocked, invite]);

  useEffect(() => {
    if (!unlocked) return;
    const msgTimer = window.setInterval(() => {
      void loadFeed(invite.trim(), {
        quiet: true,
        refresh: false,
        name: displayName,
      });
    }, 10000);
    const liveTimer = window.setInterval(() => {
      void loadFeed(invite.trim(), {
        quiet: true,
        refresh: true,
        name: displayName,
      });
    }, 45000);
    return () => {
      window.clearInterval(msgTimer);
      window.clearInterval(liveTimer);
    };
  }, [unlocked, invite, displayName, adminKey, isAdmin]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, unlocked]);

  async function loadSchedule() {
    try {
      const res = await fetch("/api/schedule");
      const json = await res.json();
      const next: StadiumOpt[] = json.stadiums || [];
      setStadiums(next);
      setRaces(json.races || Array.from({ length: 12 }, (_, i) => i + 1));
      if (next[0]?.id) setPickStadium(next[0].id);
    } catch {
      // ignore
    }
  }

  async function enterAndLoad(code: string, name: string, quiet: boolean) {
    if (!quiet) setError("");
    try {
      window.localStorage.setItem(NAME_KEY, name);
      const enterRes = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-chat-invite": code,
        },
        body: JSON.stringify({
          invite: code,
          kind: "enter",
          authorName: name,
          ...(adminKey.trim()
            ? { adminKey: adminKey.trim(), operatorKey: adminKey.trim() }
            : {}),
        }),
      });
      const enterJson = await enterRes.json();
      if (!enterRes.ok) {
        setUnlocked(false);
        if (!quiet) {
          setError(enterJson.error || "入場できません");
          window.localStorage.removeItem(INVITE_KEY);
        }
        return;
      }
      await loadFeed(code, { quiet, refresh: true, name });
    } catch {
      if (!quiet) setError("入場に失敗しました");
    }
  }

  async function loadFeed(
    code: string,
    opts: {
      quiet: boolean;
      refresh: boolean;
      name?: string;
    },
  ) {
    if (!opts.quiet) setError("");
    try {
      const name = (opts.name ?? displayName).trim();
      const q = new URLSearchParams();
      if (opts.refresh) q.set("refresh", "1");
      if (name) q.set("name", name);
      const headers: Record<string, string> = {
        "x-chat-invite": code,
      };
      if (adminKey.trim()) {
        headers["x-chat-admin"] = adminKey.trim();
        headers["x-chat-operator"] = adminKey.trim();
      }
      const res = await fetch(`/api/chat?${q.toString()}`, {
        headers,
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) {
        setUnlocked(false);
        setMessages([]);
        setTargets([]);
        setPresence([]);
        setAdminOversight(null);
        setSelectedAdminPickId("");
        setIsAdmin(false);
        if (!opts.quiet) {
          setError(json.error || "入場できません");
          window.localStorage.removeItem(INVITE_KEY);
        }
        return;
      }
      window.localStorage.setItem(INVITE_KEY, code);
      setUnlocked(true);
      setMessages(json.messages || []);
      setTargets(json.targets || []);
      setPresence(Array.isArray(json.presence) ? json.presence : []);
      setLiveDate(json.liveDate || "");
      setIsAdmin(Boolean(json.isAdmin));
      setAdminOversight(
        json.isAdmin && json.adminOversight ? (json.adminOversight as AdminPredictionOversight) : null,
      );
      if (Array.isArray(json.rules) && json.rules.length) setRules(json.rules);
    } catch {
      if (!opts.quiet) setError("読み込みに失敗しました");
    }
  }

  async function leaveRoom() {
    const code = invite.trim();
    try {
      await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-chat-invite": code,
        },
        body: JSON.stringify({ kind: "leave", invite: code }),
        keepalive: true,
      });
    } catch {
      // ignore
    }
    window.localStorage.removeItem(INVITE_KEY);
    setUnlocked(false);
    setMessages([]);
    setTargets([]);
    setPresence([]);
    setAdminOversight(null);
    setSelectedAdminPickId("");
    setIsAdmin(false);
  }

  async function clearChatBulk() {
    const key = adminKey.trim();
    if (!key) {
      setError("一括消去には管理人キーが必要です");
      return;
    }
    if (!window.confirm("チャット履歴を一括消去します。管理人のみの操作です。よろしいですか？")) {
      return;
    }
    setSending(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-chat-admin": key,
          "x-chat-operator": key,
        },
        body: JSON.stringify({ kind: "clear", operatorKey: key }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.hint || json.error || "消去に失敗しました");
        return;
      }
      setStatus(`一括消去しました（${json.deleted ?? 0}件）`);
      await loadFeed(invite.trim(), {
        quiet: true,
        refresh: false,
        name: displayName,
      });
    } catch {
      setError("消去に失敗しました");
    } finally {
      setSending(false);
    }
  }

  async function sendMessage() {
    const text = draft.trim();
    const code = invite.trim();
    const name = displayName.trim();
    if (!text || !code) return;
    if (!name) {
      setError("表示名を入れてください");
      return;
    }
    setSending(true);
    setError("");
    setStatus("");
    try {
      window.localStorage.setItem(NAME_KEY, name);
      const res = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-chat-invite": code,
        },
        body: JSON.stringify({
          invite: code,
          kind: "chat",
          text,
          authorName: name,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "送信に失敗しました");
        return;
      }
      setDraft("");
      setStatus("雑談を送信しました（全員に表示）");
      await loadFeed(code, {
        quiet: true,
        refresh: false,
        name,
      });
    } catch {
      setError("送信に失敗しました");
    } finally {
      setSending(false);
    }
  }

  async function requestPredict() {
    const code = invite.trim();
    const name = displayName.trim();
    if (!code || !name) {
      setError("招待コードと表示名が必要です");
      return;
    }
    if (!pickStadium || !pickRace) {
      setError("場とレースを選んでください");
      return;
    }
    setPredicting(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-chat-invite": code,
        },
        body: JSON.stringify({
          invite: code,
          kind: "predict",
          placeNo: pickStadium,
          raceNo: pickRace,
          authorName: name,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "予想の取得に失敗しました");
        return;
      }
      setStatus("詳細のアプリ予想を表示しました（自分のみ／本命予想は全員のチャット欄）");
      await loadFeed(code, {
        quiet: true,
        refresh: false,
        name,
      });
    } catch {
      setError("予想の取得に失敗しました");
    } finally {
      setPredicting(false);
    }
  }

  return (
    <main className="shell chat-shell">
      <section className="hero compact">
        <Link className="top-link" href="/">
          ← 律丸ボート部
        </Link>
        <p className="brand-kicker">Friend Channel</p>
        <h1 className="brand" style={{ fontSize: "clamp(2.2rem, 7vw, 4rem)" }}>
          律丸ボート部
        </h1>
        <p className="brand-sub">MEMBER CHAT</p>
        <div className="gate-rail" aria-hidden>
          <i /><i /><i /><i /><i /><i />
        </div>
        <p className="lede">
          雑談と本命予想はチャット欄で全員共有。場とレースの詳細予想だけ自分用に追加できます。
        </p>
      </section>

      {!unlocked ? (
        <section className="panel">
          <div className="field">
            <label htmlFor="invite">招待コード</label>
            <input
              id="invite"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              placeholder="招待コードを入力"
              autoComplete="off"
              className="chat-input"
            />
          </div>
          <div className="field" style={{ marginTop: "0.85rem" }}>
            <label htmlFor="displayName">表示名</label>
            <input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="例: たかし"
              autoComplete="nickname"
              className="chat-input"
              maxLength={20}
            />
          </div>
          <div className="chat-rules">
            <strong>ご利用上の注意</strong>
            <ul>
              {rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <div className="cta-row" style={{ marginTop: "0.85rem" }}>
            <button
              type="button"
              className="btn"
              disabled={pending || !invite.trim() || !displayName.trim()}
              onClick={() => {
                startTransition(() => {
                  void enterAndLoad(invite.trim(), displayName.trim(), false);
                });
              }}
            >
              {pending ? "確認中…" : "入場する"}
            </button>
          </div>
          {error ? <p className="status">{error}</p> : null}
        </section>
      ) : (
        <section className="panel chat-room">
          <div className="meta" style={{ marginBottom: "0.85rem" }}>
            <span className="badge">招待入場中</span>
            <span className="badge">{displayName || "名無し"}</span>
            {isAdmin ? <span className="badge">管理人</span> : null}
            {liveDate ? <span className="badge">{liveDate}</span> : null}
          </div>
          <p className="chat-reset-note">
            雑談と本命予想は全員のチャット欄に出ます。詳細のアプリ予想だけ押した本人向けです。毎朝7時に本命配信、レース後に自動リセットします。
          </p>

          <div className="presence-panel">
            <div className="presence-head">
              <strong>入室中</strong>
              <span>{presence.length}人</span>
            </div>
            {presence.length === 0 ? (
              <p className="note" style={{ margin: 0 }}>
                まだ誰も表示されていません。
              </p>
            ) : (
              <ul className="presence-list">
                {presence.map((p) => (
                  <li
                    key={p.id}
                    className={`presence-chip ${p.me ? "me" : ""}`}
                  >
                    <i aria-hidden />
                    <span>{p.display_name}</span>
                    {p.me ? <em>自分</em> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="chat-predict-panel">
            <div className="chat-live-head">
              <strong>詳細予想</strong>
              <span className="note">自分だけに表示</span>
            </div>
            <div className="chat-predict-row">
              <label className="field">
                <span>競艇場</span>
                <select
                  value={pickStadium || ""}
                  onChange={(e) => setPickStadium(Number(e.target.value))}
                  className="chat-input"
                >
                  <option value="" disabled>
                    場を選択
                  </option>
                  {stadiums.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>レース</span>
                <select
                  value={pickRace}
                  onChange={(e) => setPickRace(Number(e.target.value))}
                  className="chat-input"
                >
                  {races.map((r) => (
                    <option key={r} value={r}>
                      {r}R
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn"
                disabled={predicting || !pickStadium}
                onClick={() => {
                  void requestPredict();
                }}
              >
                {predicting ? "取得中…" : "予想する"}
              </button>
            </div>
            <p className="note">
              穴目・理由など詳細は自分だけ。本日の本命予想そのものは毎朝チャット欄に全員向けで出ます。
            </p>
          </div>

          {targets.length > 0 ? (
            <div className="chat-live-panel">
              <div className="chat-live-head">
                <strong>本日の本命対象（全員共有）</strong>
              </div>
              <div className="cta-row chat-live-targets">
                {targets.map((t) => (
                  <button
                    key={`${t.stadium}-${t.race}`}
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      setPickStadium(t.stadium);
                      setPickRace(t.race);
                    }}
                  >
                    {t.stadium_name} {t.race}R
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {isAdmin ? (
            <div className="chat-admin-panel">
              <div className="chat-live-head">
                <strong>管理人専用（予想ログ・回収率）</strong>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={sending}
                  onClick={() => {
                    void clearChatBulk();
                  }}
                >
                  一括消去
                </button>
              </div>
              <p className="note">
                友達には見えません。入室者が開いたレースをタップすると予想本文と回収率を確認できます。
              </p>
              {adminOversight ? (
                <div className="admin-roi-summary">
                  <span>
                    全体回収率{" "}
                    <strong>
                      {adminOversight.totals.recoveryPct == null
                        ? "未確定"
                        : `${adminOversight.totals.recoveryPct.toFixed(1)}%`}
                    </strong>
                  </span>
                  <span>
                    確定 {adminOversight.totals.settledCount}/{adminOversight.totals.pickCount}件
                  </span>
                  <span>
                    投資 {adminOversight.totals.stakeYen.toLocaleString("ja-JP")}円 / 払戻{" "}
                    {adminOversight.totals.payoutYen.toLocaleString("ja-JP")}円
                  </span>
                  <span className="note">
                    1点{adminOversight.stake_per_ticket}円想定（三連単）
                  </span>
                </div>
              ) : null}
              {!adminOversight || adminOversight.owners.length === 0 ? (
                <p className="note">まだ予想ログはありません。</p>
              ) : (
                <div className="admin-owner-groups">
                  {adminOversight.owners.map((owner) => (
                    <div key={owner.owner_name} className="admin-owner-card">
                      <div className="admin-owner-head">
                        <strong>{owner.owner_name}</strong>
                        <span>
                          {owner.pickCount}件 / 回収率{" "}
                          {owner.recoveryPct == null ? "未確定" : `${owner.recoveryPct.toFixed(1)}%`}
                        </span>
                      </div>
                      <div className="cta-row chat-live-targets admin-race-chips">
                        {owner.picks.map((p) => (
                          <button
                            key={p.message_id}
                            type="button"
                            className={`btn ghost ${
                              selectedAdminPickId === p.message_id ? "active" : ""
                            }`}
                            onClick={() => {
                              setSelectedAdminPickId((cur) =>
                                cur === p.message_id ? "" : p.message_id,
                              );
                            }}
                          >
                            {p.label}
                            {p.result.settled
                              ? p.result.hitTickets.length
                                ? " ✓"
                                : " ×"
                              : ""}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {(() => {
                const pick =
                  adminOversight?.picks.find((p) => p.message_id === selectedAdminPickId) || null;
                if (!pick) return null;
                return (
                  <article className="chat-bubble op admin-log admin-pick-detail">
                    <div className="chat-bubble-meta">
                      <strong>
                        {pick.owner_name} · {pick.label}
                      </strong>
                      <span>{formatJst(pick.created_at)} JST</span>
                      <span>
                        回収率{" "}
                        {pick.result.recoveryPct == null
                          ? "未確定"
                          : `${pick.result.recoveryPct.toFixed(1)}%`}
                      </span>
                    </div>
                    <p className="note" style={{ marginTop: 0 }}>
                      {pick.result.settled
                        ? `結果 ${pick.result.finishCombo || "—"} / 的中 ${
                            pick.result.hitTickets.join("・") || "なし"
                          } / 投資 ${pick.result.stakeYen.toLocaleString("ja-JP")}円 → 払戻 ${pick.result.payoutYen.toLocaleString("ja-JP")}円`
                        : `結果待ち（買い目 ${pick.tickets.join("・") || "—"}）`}
                    </p>
                    <pre className="chat-bubble-body">{pick.body || "予想本文なし"}</pre>
                  </article>
                );
              })()}
            </div>
          ) : null}

          <div className="chat-stream" ref={listRef}>
            {messages.filter((m) => m.meta?.visibility !== "admin").length === 0 ? (
              <p className="status">まだメッセージがありません。雑談か本命予想の配信をお待ちください。</p>
            ) : (
              messages
                .filter((m) => m.meta?.visibility !== "admin")
                .map((m) => {
                const isPrivate = m.meta?.visibility === "private";
                const isOp =
                  m.author_role === "operator" || m.kind === "picks" || m.kind === "note";
                const isMine =
                  m.kind === "chat" && m.author_name === displayName.trim() && !isOp;
                return (
                  <article
                    key={m.id}
                    className={`chat-bubble ${isOp ? "op" : "member"} ${isMine ? "mine" : ""} ${
                      isPrivate ? "private" : ""
                    }`}
                  >
                    <div className="chat-bubble-meta">
                      <strong>{m.author_name || m.title || (isOp ? "運営" : "メンバー")}</strong>
                      <span>{kindLabel(m)}</span>
                      {isPrivate ? <span>自分のみ</span> : null}
                      <span>{formatJst(m.created_at)} JST</span>
                    </div>
                    <pre className="chat-bubble-body">{m.body}</pre>
                  </article>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          <div className="chat-composer">
            <div className="field">
              <label htmlFor="draft">雑談メッセージ</label>
              <textarea
                id="draft"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="みんなに見える雑談を書く"
                rows={3}
                maxLength={1000}
                className="chat-input chat-textarea"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
              />
            </div>
            <div className="cta-row" style={{ marginTop: "0.75rem" }}>
              <button
                type="button"
                className="btn"
                disabled={sending || !draft.trim()}
                onClick={() => {
                  void sendMessage();
                }}
              >
                {sending ? "送信中…" : "メッセージ送信"}
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={pending}
                onClick={() => {
                  startTransition(() => {
                    void loadFeed(invite.trim(), {
                      quiet: false,
                      refresh: true,
                      name: displayName,
                    });
                  });
                }}
              >
                更新
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  void leaveRoom();
                }}
              >
                退出
              </button>
            </div>

            <div className="chat-admin-gate">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setShowAdminGate((v) => !v)}
              >
                {showAdminGate ? "管理人メニューを閉じる" : "管理人のみ"}
              </button>
              {showAdminGate ? (
                <div className="field" style={{ marginTop: "0.55rem" }}>
                  <label htmlFor="chatAdminKey">管理人キー</label>
                  <input
                    id="chatAdminKey"
                    type="password"
                    value={adminKey}
                    onChange={(e) => setAdminKey(e.target.value)}
                    placeholder="管理人キー"
                    autoComplete="off"
                    className="chat-input"
                  />
                  <div className="cta-row" style={{ marginTop: "0.55rem" }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={!adminKey.trim() || pending}
                      onClick={() => {
                        startTransition(() => {
                          void enterAndLoad(
                            invite.trim(),
                            displayName.trim() || "管理人",
                            false,
                          );
                        });
                      }}
                    >
                      管理人として確認
                    </button>
                  </div>
                  <p className="note">
                    キーが正しければ、個人予想の一覧と一括消去が使えます。友達向け画面には出ません。
                  </p>
                </div>
              ) : null}
            </div>

            {status ? <p className="note">{status}</p> : null}
            {error ? <p className="status">{error}</p> : null}
          </div>
        </section>
      )}
    </main>
  );
}

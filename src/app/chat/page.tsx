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
  };
};

type LiveUrls = {
  placeName: string;
  mediaTop: string;
  raceIndex: string;
  raceList: string;
  beforeInfo: string;
  officialSite?: string;
  stadiumPage?: string;
  liveNote?: string;
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
  live: LiveUrls;
};

const INVITE_KEY = "shioyomi_chat_invite";
const NAME_KEY = "shioyomi_chat_name";
const OP_KEY = "shioyomi_operator_key";
const ADMIN_KEY = "shioyomi_admin_key";

const DEFAULT_RULES = [
  "誹謗中傷・喧嘩・荒らし・個人攻撃は禁止です。",
  "予想・買い目は参考情報であり、的中や利益を保証しません。",
  "舟券の購入・投票は自己責任です（未成年不可）。",
  "当サービスは免責とします。公式情報は各場・BOAT RACE公式を優先してください。",
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

function kindLabel(kind: ChatMessage["kind"]): string {
  if (kind === "picks") return "買い目";
  if (kind === "note") return "メモ";
  return "会話";
}

function statusLabel(status: string): string {
  if (status === "confirmed") return "確定";
  if (status === "skipped") return "スキップ";
  if (status === "provisional") return "展示待ち";
  return status || "—";
}

export default function ChatPage() {
  const [invite, setInvite] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [operatorKey, setOperatorKey] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [asOperator, setAsOperator] = useState(false);
  const [asAdmin, setAsAdmin] = useState(false);
  const [rules, setRules] = useState<string[]>(DEFAULT_RULES);
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [targets, setTargets] = useState<ChatLiveTarget[]>([]);
  const [liveDate, setLiveDate] = useState("");
  const [activeKey, setActiveKey] = useState("");
  const [pending, startTransition] = useTransition();
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const savedInvite = window.localStorage.getItem(INVITE_KEY) || "";
    const savedName = window.localStorage.getItem(NAME_KEY) || "";
    const savedOp = window.localStorage.getItem(OP_KEY) || "";
    const savedAdmin = window.localStorage.getItem(ADMIN_KEY) || "";
    if (savedName) setDisplayName(savedName);
    if (savedOp) {
      setOperatorKey(savedOp);
      setAsOperator(true);
    }
    if (savedAdmin) {
      setAdminKey(savedAdmin);
      setAsAdmin(true);
    }
    if (savedInvite) {
      setInvite(savedInvite);
      void loadFeed(savedInvite, { quiet: false, refresh: true });
    }
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    const msgTimer = window.setInterval(() => {
      void loadFeed(invite.trim(), { quiet: true, refresh: false });
    }, 5000);
    const liveTimer = window.setInterval(() => {
      void loadFeed(invite.trim(), { quiet: true, refresh: true });
    }, 30000);
    return () => {
      window.clearInterval(msgTimer);
      window.clearInterval(liveTimer);
    };
  }, [unlocked, invite]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, unlocked]);

  useEffect(() => {
    if (!targets.length) {
      setActiveKey("");
      return;
    }
    if (!activeKey || !targets.some((t) => `${t.stadium}-${t.race}` === activeKey)) {
      setActiveKey(`${targets[0].stadium}-${targets[0].race}`);
    }
  }, [targets, activeKey]);

  async function loadFeed(
    code: string,
    opts: { quiet: boolean; refresh: boolean },
  ) {
    if (!opts.quiet) setError("");
    try {
      const q = new URLSearchParams({ invite: code });
      if (opts.refresh) q.set("refresh", "1");
      const res = await fetch(`/api/chat?${q.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        setUnlocked(false);
        setMessages([]);
        setTargets([]);
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
      setLiveDate(json.liveDate || "");
      if (Array.isArray(json.rules) && json.rules.length) setRules(json.rules);
    } catch {
      if (!opts.quiet) setError("読み込みに失敗しました");
    }
  }

  async function clearChatBulk() {
    const key = adminKey.trim() || operatorKey.trim();
    if (!key) {
      setError("一括消去には管理人キー（CHAT_ADMIN_KEY）が必要です");
      return;
    }
    if (!window.confirm("チャット履歴を一括消去します。管理人のみの操作です。よろしいですか？")) {
      return;
    }
    setSending(true);
    setError("");
    setStatus("");
    try {
      window.localStorage.setItem(ADMIN_KEY, key);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "clear",
          operatorKey: key,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.hint || json.error || "消去に失敗しました");
        return;
      }
      setStatus(`一括消去しました（${json.deleted ?? 0}件）`);
      await loadFeed(invite.trim(), { quiet: true, refresh: false });
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
      if (asOperator && operatorKey.trim()) {
        window.localStorage.setItem(OP_KEY, operatorKey.trim());
      }
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invite: code,
          kind: "chat",
          text,
          authorName: name,
          operatorKey: asOperator ? operatorKey.trim() : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "送信に失敗しました");
        return;
      }
      setDraft("");
      setStatus("送信しました");
      await loadFeed(code, { quiet: true, refresh: false });
    } catch {
      setError("送信に失敗しました");
    } finally {
      setSending(false);
    }
  }

  const active = targets.find((t) => `${t.stadium}-${t.race}` === activeKey) || null;

  return (
    <main className="shell chat-shell">
      <section className="hero" style={{ minHeight: "auto", paddingBottom: "1rem" }}>
        <p className="note" style={{ margin: 0 }}>
          <Link href="/">← 潮読みアプリ</Link>
        </p>
        <h1 className="brand" style={{ fontSize: "clamp(2rem, 6vw, 3.4rem)" }}>
          専用チャット
        </h1>
        <p className="lede">
          「徳山1R」のように場名とレースを送ると予測が返ります。対象レースのライブも同じ画面で見れます。
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
                window.localStorage.setItem(NAME_KEY, displayName.trim());
                startTransition(() => {
                  void loadFeed(invite.trim(), { quiet: false, refresh: true });
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
            <span className="badge">{messages.length}件</span>
            {liveDate ? <span className="badge">{liveDate}</span> : null}
          </div>
          <div className="chat-rules compact">
            <strong>注意 / 免責</strong>
            <ul>
              {rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>

          <div className="chat-live-panel">
            <div className="chat-live-head">
              <strong>対象レースライブ</strong>
              <button
                type="button"
                className="btn ghost"
                disabled={pending}
                onClick={() => {
                  startTransition(() => {
                    void loadFeed(invite.trim(), { quiet: false, refresh: true });
                  });
                }}
              >
                ライブ更新
              </button>
            </div>
            {targets.length === 0 ? (
              <p className="note">いま対象レースはありません。</p>
            ) : (
              <>
                <div className="cta-row chat-live-targets">
                  {targets.map((t) => {
                    const key = `${t.stadium}-${t.race}`;
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`btn ${activeKey === key ? "" : "ghost"}`}
                        onClick={() => setActiveKey(key)}
                      >
                        {t.stadium_name} {t.race}R · {statusLabel(t.status)}
                      </button>
                    );
                  })}
                </div>
                {active ? (
                  <div className="live-box purchased chat-live-box">
                    <strong>
                      {active.stadium_name} {active.race}R
                    </strong>
                    <p className="note" style={{ marginTop: "0.35rem" }}>
                      買い目 {active.tickets.join("/")} / {statusLabel(active.status)}
                      {active.skip_detail ? ` — ${active.skip_detail}` : ""}
                    </p>
                    {active.why ? <p className="note">{active.why}</p> : null}
                    <div className="cta-row">
                      <a
                        className="btn"
                        href={active.live.officialSite || active.live.stadiumPage || active.live.mediaTop}
                        target="_blank"
                        rel="noreferrer"
                      >
                        公式サイト
                      </a>
                      <a className="btn ghost" href={active.live.beforeInfo} target="_blank" rel="noreferrer">
                        直前情報
                      </a>
                      <a className="btn ghost" href={active.live.raceList} target="_blank" rel="noreferrer">
                        出走表
                      </a>
                      <a className="btn ghost" href={active.live.mediaTop} target="_blank" rel="noreferrer">
                        公式ライブ
                      </a>
                    </div>
                    <p className="note" style={{ marginTop: "0.55rem" }}>
                      {active.live.liveNote ||
                        "公式ライブは場単位です。開催時間外は配信なし表示になります。別タブで開いてください。"}
                    </p>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="chat-stream" ref={listRef}>
            {messages.length === 0 ? (
              <p className="status">まだメッセージがありません。最初の一言をどうぞ。</p>
            ) : (
              messages.map((m) => {
                const isOp = m.author_role === "operator" || m.kind === "picks" || m.kind === "note";
                const isMine =
                  m.kind === "chat" &&
                  m.author_name === displayName.trim() &&
                  ((asOperator && isOp) || (!asOperator && !isOp));
                return (
                  <article
                    key={m.id}
                    className={`chat-bubble ${isOp ? "op" : "member"} ${isMine ? "mine" : ""}`}
                  >
                    <div className="chat-bubble-meta">
                      <strong>{m.author_name || m.title || (isOp ? "運営" : "メンバー")}</strong>
                      <span>{kindLabel(m.kind)}</span>
                      <span>{formatJst(m.created_at)} JST</span>
                      {m.meta?.discord ? <span>Discord</span> : null}
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
              <label htmlFor="draft">メッセージ</label>
              <textarea
                id="draft"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="例: 徳山1R （場名+レースで予測）"
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
            <label className="chat-op-toggle">
              <input
                type="checkbox"
                checked={asOperator}
                onChange={(e) => setAsOperator(e.target.checked)}
              />
              運営として送る
            </label>
            {asOperator ? (
              <div className="field" style={{ marginTop: "0.55rem" }}>
                <label htmlFor="chatOperatorKey">運営キー</label>
                <input
                  id="chatOperatorKey"
                  type="password"
                  value={operatorKey}
                  onChange={(e) => setOperatorKey(e.target.value)}
                  placeholder="CHAT_OPERATOR_KEY"
                  autoComplete="off"
                  className="chat-input"
                />
              </div>
            ) : null}
            <label className="chat-op-toggle">
              <input
                type="checkbox"
                checked={asAdmin}
                onChange={(e) => setAsAdmin(e.target.checked)}
              />
              管理人メニュー（一括消去）
            </label>
            {asAdmin ? (
              <div className="field" style={{ marginTop: "0.55rem" }}>
                <label htmlFor="chatAdminKey">管理人キー</label>
                <input
                  id="chatAdminKey"
                  type="password"
                  value={adminKey}
                  onChange={(e) => setAdminKey(e.target.value)}
                  placeholder="CHAT_ADMIN_KEY"
                  autoComplete="off"
                  className="chat-input"
                />
              </div>
            ) : null}
            <div className="cta-row" style={{ marginTop: "0.75rem" }}>
              <button
                type="button"
                className="btn"
                disabled={sending || !draft.trim()}
                onClick={() => {
                  void sendMessage();
                }}
              >
                {sending ? "送信中…" : "送信"}
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={pending}
                onClick={() => {
                  startTransition(() => {
                    void loadFeed(invite.trim(), { quiet: false, refresh: true });
                  });
                }}
              >
                更新
              </button>
              {asAdmin ? (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={sending || !(adminKey.trim() || operatorKey.trim())}
                  onClick={() => {
                    void clearChatBulk();
                  }}
                >
                  一括消去
                </button>
              ) : null}
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  window.localStorage.removeItem(INVITE_KEY);
                  setUnlocked(false);
                  setMessages([]);
                  setTargets([]);
                }}
              >
                退出
              </button>
            </div>
            <p className="note" style={{ marginTop: "0.55rem" }}>
              一括消去は管理人キー必須です。当日レース終了の約1時間後に自動消去も行います。
            </p>
            {status ? <p className="note">{status}</p> : null}
            {error ? <p className="status">{error}</p> : null}
          </div>
        </section>
      )}
    </main>
  );
}

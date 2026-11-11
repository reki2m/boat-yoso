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

const INVITE_KEY = "shioyomi_chat_invite";
const NAME_KEY = "shioyomi_chat_name";
const OP_KEY = "shioyomi_operator_key";

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

export default function ChatPage() {
  const [invite, setInvite] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [operatorKey, setOperatorKey] = useState("");
  const [asOperator, setAsOperator] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, startTransition] = useTransition();
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const savedInvite = window.localStorage.getItem(INVITE_KEY) || "";
    const savedName = window.localStorage.getItem(NAME_KEY) || "";
    const savedOp = window.localStorage.getItem(OP_KEY) || "";
    if (savedName) setDisplayName(savedName);
    if (savedOp) {
      setOperatorKey(savedOp);
      setAsOperator(true);
    }
    if (savedInvite) {
      setInvite(savedInvite);
      void loadFeed(savedInvite, false);
    }
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    const timer = window.setInterval(() => {
      void loadFeed(invite.trim(), true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [unlocked, invite]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, unlocked]);

  async function loadFeed(code: string, quiet: boolean) {
    if (!quiet) setError("");
    try {
      const res = await fetch(`/api/chat?invite=${encodeURIComponent(code)}`);
      const json = await res.json();
      if (!res.ok) {
        setUnlocked(false);
        setMessages([]);
        if (!quiet) {
          setError(json.error || "入場できません");
          window.localStorage.removeItem(INVITE_KEY);
        }
        return;
      }
      window.localStorage.setItem(INVITE_KEY, code);
      setUnlocked(true);
      setMessages(json.messages || []);
    } catch {
      if (!quiet) setError("読み込みに失敗しました");
    }
  }

  async function clearChat() {
    if (!asOperator || !operatorKey.trim()) {
      setError("チャット消去には運営キーが必要です");
      return;
    }
    if (!window.confirm("チャット履歴を全消去します。よろしいですか？")) return;
    setSending(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "clear",
          operatorKey: operatorKey.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "消去に失敗しました");
        return;
      }
      setStatus(`チャットを消去しました（${json.deleted ?? 0}件）`);
      await loadFeed(invite.trim(), true);
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
      await loadFeed(code, true);
    } catch {
      setError("送信に失敗しました");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="shell chat-shell">
      <section className="hero" style={{ minHeight: "auto", paddingBottom: "1rem" }}>
        <p className="note" style={{ margin: 0 }}>
          <Link href="/">← 潮読みアプリ</Link>
        </p>
        <h1 className="brand" style={{ fontSize: "clamp(2rem, 6vw, 3.4rem)" }}>
          専用チャット
        </h1>
        <p className="lede">招待メンバーと会話できます。運営の買い目もここに流れます。</p>
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
          <div className="cta-row" style={{ marginTop: "0.85rem" }}>
            <button
              type="button"
              className="btn"
              disabled={pending || !invite.trim() || !displayName.trim()}
              onClick={() => {
                window.localStorage.setItem(NAME_KEY, displayName.trim());
                startTransition(() => {
                  void loadFeed(invite.trim(), false);
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
                placeholder="メンバーへ一言…"
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
                    void loadFeed(invite.trim(), false);
                  });
                }}
              >
                更新
              </button>
              {asOperator ? (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={sending || !operatorKey.trim()}
                  onClick={() => {
                    void clearChat();
                  }}
                >
                  チャット消去
                </button>
              ) : null}
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  window.localStorage.removeItem(INVITE_KEY);
                  setUnlocked(false);
                  setMessages([]);
                }}
              >
                退出
              </button>
            </div>
            {status ? <p className="note">{status}</p> : null}
            {error ? <p className="status">{error}</p> : null}
          </div>
        </section>
      )}
    </main>
  );
}

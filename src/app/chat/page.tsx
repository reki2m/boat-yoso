"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";

type ChatMessage = {
  id: string;
  created_at: string;
  kind: "picks" | "note";
  title: string;
  body: string;
  meta?: {
    date?: string;
    mode?: string;
    count?: number;
    discord?: boolean;
  };
};

const INVITE_KEY = "shioyomi_chat_invite";

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

export default function ChatPage() {
  const [invite, setInvite] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const saved = window.localStorage.getItem(INVITE_KEY) || "";
    if (saved) {
      setInvite(saved);
      void loadFeed(saved);
    }
  }, []);

  async function loadFeed(code: string) {
    setError("");
    try {
      const res = await fetch(`/api/chat?invite=${encodeURIComponent(code)}`);
      const json = await res.json();
      if (!res.ok) {
        setUnlocked(false);
        setMessages([]);
        setError(json.error || "入場できません");
        window.localStorage.removeItem(INVITE_KEY);
        return;
      }
      window.localStorage.setItem(INVITE_KEY, code);
      setUnlocked(true);
      setMessages(json.messages || []);
    } catch {
      setError("読み込みに失敗しました");
    }
  }

  return (
    <main className="shell">
      <section className="hero" style={{ minHeight: "auto", paddingBottom: "1rem" }}>
        <p className="note" style={{ margin: 0 }}>
          <Link href="/">← 潮読みアプリ</Link>
        </p>
        <h1 className="brand" style={{ fontSize: "clamp(2rem, 6vw, 3.4rem)" }}>
          専用チャット
        </h1>
        <p className="lede">
          招待制。運営がアプリからアップした買い目だけが表示されます。
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
              style={{
                width: "100%",
                padding: "0.85rem 1rem",
                borderRadius: 12,
                border: "1px solid var(--line)",
                background: "rgba(8,28,38,0.55)",
                color: "var(--foam)",
              }}
            />
          </div>
          <div className="cta-row" style={{ marginTop: "0.85rem" }}>
            <button
              type="button"
              className="btn"
              disabled={pending || !invite.trim()}
              onClick={() => {
                startTransition(() => {
                  void loadFeed(invite.trim());
                });
              }}
            >
              {pending ? "確認中…" : "入場する"}
            </button>
          </div>
          {error ? <p className="status">{error}</p> : null}
        </section>
      ) : (
        <section className="panel">
          <div className="meta" style={{ marginBottom: "0.85rem" }}>
            <span className="badge">招待入場中</span>
            <span className="badge">{messages.length}件</span>
          </div>
          <div className="cta-row" style={{ marginBottom: "1rem" }}>
            <button
              type="button"
              className="btn ghost"
              disabled={pending}
              onClick={() => {
                startTransition(() => {
                  void loadFeed(invite.trim());
                });
              }}
            >
              更新
            </button>
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
          {messages.length === 0 ? (
            <p className="status">まだ投稿がありません。運営のアップ待ちです。</p>
          ) : (
            <div style={{ display: "grid", gap: "0.85rem" }}>
              {messages.map((m) => (
                <article key={m.id} className="side-card on" style={{ padding: "0.9rem 1rem" }}>
                  <div className="meta" style={{ marginBottom: "0.45rem" }}>
                    <span className="badge">{m.kind === "picks" ? "買い目" : "メモ"}</span>
                    <span className="badge">{formatJst(m.created_at)} JST</span>
                    {m.meta?.discord ? <span className="badge">Discord反映</span> : null}
                  </div>
                  <strong style={{ display: "block", marginBottom: "0.35rem" }}>{m.title}</strong>
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      fontFamily: "var(--font-body)",
                      color: "var(--foam)",
                      lineHeight: 1.55,
                      fontSize: "0.95rem",
                    }}
                  >
                    {m.body}
                  </pre>
                </article>
              ))}
            </div>
          )}
          {error ? <p className="status">{error}</p> : null}
        </section>
      )}
    </main>
  );
}

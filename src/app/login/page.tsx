"use client";

import { Suspense, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  async function unlock() {
    setError("");
    try {
      const res = await fetch("/api/app-auth", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim(), action: "login" }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.hint ? `${json.error}（${json.hint}）` : json.error || "解錠できません");
        return;
      }
      const next = params.get("next") || "/";
      router.replace(next === "/login" ? "/" : next);
      router.refresh();
    } catch {
      setError("解錠に失敗しました");
    }
  }

  return (
    <section className="panel login-panel">
      <div className="field">
        <label htmlFor="appKey">管理人キー</label>
        <input
          id="appKey"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="CHAT_ADMIN_KEY / CHAT_OPERATOR_KEY"
          autoComplete="off"
          className="chat-input"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              startTransition(() => {
                void unlock();
              });
            }
          }}
        />
      </div>
      <div className="cta-row" style={{ marginTop: "0.85rem" }}>
        <button
          type="button"
          className="btn"
          disabled={pending || !key.trim()}
          onClick={() => {
            startTransition(() => {
              void unlock();
            });
          }}
        >
          {pending ? "確認中…" : "アプリを開く"}
        </button>
        <Link className="btn ghost" href="/chat">
          専用チャットへ
        </Link>
      </div>
      {error ? <p className="status">{error}</p> : null}
      <p className="note" style={{ marginTop: "0.85rem" }}>
        ここに入れるのは招待コードではなく、Cursor Apps の Secrets にある CHAT_ADMIN_KEY（または
        CHAT_OPERATOR_KEY）です。友達には /chat と招待コードだけ渡してください。
      </p>
    </section>
  );
}

export default function LoginPage() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="brand-kicker">Restricted Access</p>
        <h1 className="brand">律丸ボート部</h1>
        <p className="brand-sub">ADMIN GATE</p>
        <div className="gate-rail" aria-hidden>
          <i /><i /><i /><i /><i /><i />
        </div>
        <p className="lede">アプリ本体は管理人のみ。友達は専用チャットへどうぞ。</p>
      </section>
      <Suspense fallback={<section className="panel login-panel">読み込み中…</section>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { STADIUMS } from "@/lib/stadiums";
import {
  chipToneClass,
  formatTicketPayout,
  hasBandTickets,
  normalizeBandTickets,
  raceStatusTone,
  splitPickBody,
  statusBadge,
  statusDetail,
  summarizeChips,
  type RaceChipView,
} from "@/lib/chatRaceDisplay";

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
    bands?: RaceChipView["bands"];
    confidence?: number;
    confidenceLabel?: string;
    visibility?: "public" | "private" | "admin";
    owner_session_id?: string;
    owner_name?: string;
    race_label?: string;
    races?: RaceChipView[];
    purchaseDecision?: "yes" | "no" | "purchased" | "skip";
    purchaseLockedExhibition?: "waiting" | "after" | "unknown";
  };
};

type PurchaseLockState = "yes" | "no" | "purchased" | "skip";

type ChatLiveTarget = {
  date: string;
  stadium: number;
  stadium_name: string;
  race: number;
  tickets: string[];
  tickets_single?: string[];
  tickets_five?: string[];
  label?: string | null;
  status: string;
  skip_detail: string | null;
  why: string | null;
  reasons?: string[];
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
  if (
    m.meta?.mode === "purchase_ack" ||
    m.meta?.mode === "target_purchase_ack" ||
    m.meta?.mode === "day_purchase_ack"
  ) {
    return "購入ロック";
  }
  if (m.meta?.mode === "app_race_pick") {
    return "AI予想（自分のみ）";
  }
  if (m.meta?.visibility === "private") {
    return "自分のみ";
  }
  if (m.meta?.mode === "honmei_result") return "結果・払戻";
  if (m.meta?.mode === "chat_hit" || m.title.includes("的中")) return "的中";
  if (m.meta?.mode === "exhibition_after_honmei") return "展示後・確定/スルー";
  if (m.kind === "picks" || m.meta?.mode === "morning_auto_honmei" || m.meta?.mode === "honmei_board") {
    return "本命配信";
  }
  if (m.kind === "note") return "メモ";
  return "雑談";
}

function targetToneClass(status: string): string {
  if (status === "skipped") return "skipped";
  if (status === "confirmed") return "waiting buyok";
  if (status === "provisional" || status === "programs_unavailable") return "waiting";
  return "";
}

function targetBadge(status: string): string {
  if (status === "skipped") return "スルー";
  if (status === "confirmed") return "展示確認済み購入OK";
  if (status === "provisional" || status === "programs_unavailable") return "展示待ち";
  return "";
}

function purchaseLockTone(lock: PurchaseLockState | null | undefined): string {
  if (lock === "yes") return "purchase-locked";
  if (lock === "purchased") return "purchase-bought";
  if (lock === "no") return "purchase-passed";
  return "";
}

function targetExhibitDone(status: string): boolean {
  return status === "confirmed" || status === "skipped";
}

function aiExhibitDone(m: ChatMessage): boolean {
  const locked = m.meta?.purchaseLockedExhibition;
  if (locked === "after") return true;
  if (locked === "waiting") {
    const chip = Array.isArray(m.meta?.races) ? m.meta!.races![0] : null;
    return Boolean(
      chip &&
        (chip.exhibition === "after" ||
          chip.status === "confirmed" ||
          chip.status === "skipped" ||
          chip.status === "settled" ||
          chip.settled),
    );
  }
  const chip = Array.isArray(m.meta?.races) ? m.meta!.races![0] : null;
  if (!chip) return false;
  return (
    chip.exhibition === "after" ||
    chip.status === "confirmed" ||
    chip.status === "skipped" ||
    chip.status === "settled" ||
    Boolean(chip.settled)
  );
}

function raceKey(chip: Pick<RaceChipView, "placeNo" | "raceNo">): string {
  return `${chip.placeNo}:${chip.raceNo}`;
}

/** meta.races.why が空の古い投稿向けに【説明】本文から拾う */
function whyFallback(explainBlock: string, chip: RaceChipView): string {
  if (!explainBlock) return "";
  const label = `${chip.placeName} ${chip.raceNo}R`;
  const lines = explainBlock.split("\n").map((l) => l.trim());
  for (const line of lines) {
    if (line.includes(label) || line.includes(`${chip.placeName}${chip.raceNo}R`)) {
      return line.replace(/^[・･]\s*/, "").replace(/^.*?[—–-]\s*/, "").trim();
    }
  }
  // 単レース投稿なら説明ブロック全体
  if (lines.length === 1) return lines[0].replace(/^[・･]\s*/, "");
  return "";
}

function messageRaces(m: ChatMessage): RaceChipView[] {
  if (Array.isArray(m.meta?.races) && m.meta!.races!.length) return m.meta!.races!;
  if (m.meta?.placeNo && m.meta?.raceNo) {
    return [
      {
        placeNo: m.meta.placeNo,
        placeName: STADIUMS[m.meta.placeNo] || `場${m.meta.placeNo}`,
        raceNo: m.meta.raceNo,
        label: m.meta.race_label || `${STADIUMS[m.meta.placeNo] || ""} ${m.meta.raceNo}R`,
        tickets: m.meta.tickets || [],
        bands: m.meta.bands,
        confidence: m.meta.confidence,
        confidenceLabel: m.meta.confidenceLabel,
        status: undefined,
        exhibition: "unknown",
      },
    ];
  }
  return [];
}

type RacePhase = "waiting" | "final" | "result";

function racePhase(m: ChatMessage, chip: RaceChipView): RacePhase {
  if (m.meta?.mode === "honmei_result" || m.meta?.mode === "chat_hit") return "result";
  const tone = raceStatusTone(chip);
  if (tone === "result") return "result";
  if (tone === "confirmed" || tone === "skipped") return "final";
  return "waiting";
}

function isPrivateAiPick(m: ChatMessage): boolean {
  return m.meta?.mode === "app_race_pick";
}

/**
 * 同じレースの展示待ち/確定チップは新しい方を優先。
 * メッセージ本文自体は消さない（履歴を残す）。チップだけ間引く。
 */
function dedupeRaceUi(
  messages: ChatMessage[],
): Map<string, RaceChipView[]> {
  const seenWaiting = new Set<string>();
  const seenFinal = new Set<string>();
  const seenResult = new Set<string>();
  const seenAi = new Set<string>();
  const out = new Map<string, RaceChipView[]>();

  // 新しいメッセージ優先
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    const races = messageRaces(m);
    if (!races.length) {
      out.set(m.id, []);
      continue;
    }
    const aiPick = isPrivateAiPick(m);
    const kept: RaceChipView[] = [];
    for (const chip of races) {
      const key = raceKey(chip);
      // AI予想同士だけ最新1件。ボード本命のスルー/確定とは独立。
      if (aiPick) {
        if (seenAi.has(key)) continue;
        seenAi.add(key);
        kept.push(chip);
        continue;
      }
      const phase = racePhase(m, chip);
      if (phase === "result") {
        if (seenResult.has(key)) continue;
        seenResult.add(key);
        kept.push(chip);
      } else if (phase === "final") {
        if (seenFinal.has(key)) continue;
        seenFinal.add(key);
        seenWaiting.add(key); // 確定後は待ち表示も不要
        kept.push(chip);
      } else {
        if (seenWaiting.has(key) || seenFinal.has(key)) continue;
        seenWaiting.add(key);
        kept.push(chip);
      }
    }
    // チップが全部間引かれても空配列を入れ、呼び出し側で本文は残す
    out.set(m.id, kept);
  }
  return out;
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
  const [raceConfidence, setRaceConfidence] = useState<Record<string, number>>({});
  const [pending, startTransition] = useTransition();
  const [sending, setSending] = useState(false);
  const [predicting, setPredicting] = useState(false);
  /** messageId → "placeNo:raceNo" */
  const [openRaceByMessage, setOpenRaceByMessage] = useState<Record<string, string>>({});
  const [showBodyByMessage, setShowBodyByMessage] = useState<Record<string, boolean>>({});
  /** messageId → "band:combo" で買い目理由を開く */
  const [openTicketByMessage, setOpenTicketByMessage] = useState<Record<string, string>>({});
  /** 本日の本命対象チップを開く（stadium-race） */
  const [openTargetKey, setOpenTargetKey] = useState("");
  /** 本命対象内の買い目（stadium-race:band:combo）を開く */
  const [openTargetTicketKey, setOpenTargetTicketKey] = useState("");
  /** 本命対象レースごとの購入ロック stadium-race → state */
  const [targetPurchases, setTargetPurchases] = useState<Record<string, PurchaseLockState>>({});
  const [purchaseBusyId, setPurchaseBusyId] = useState("");
  const [targetPurchaseBusyKey, setTargetPurchaseBusyKey] = useState("");
  /** 購入ロック操作のインラインエラー */
  const [purchaseInlineError, setPurchaseInlineError] = useState("");
  const [purchaseInlineErrorKey, setPurchaseInlineErrorKey] = useState("");
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

  // 場を変えたら各Rの信頼度を取得して色分け（本体アプリと同じ）
  useEffect(() => {
    if (!unlocked || !pickStadium) {
      setRaceConfidence({});
      return;
    }
    let cancelled = false;
    const code = invite.trim();
    void (async () => {
      try {
        // セッション Cookie ＋招待ヘッダ（どちらかで通る）
        const res = await fetch(`/api/chat/confidence-map?place=${pickStadium}`, {
          credentials: "include",
          headers: {
            ...(code ? { "x-chat-invite": code } : {}),
          },
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (json?.ok && json?.confidences && typeof json.confidences === "object") {
          setRaceConfidence(json.confidences as Record<string, number>);
        }
        // 失敗時は前の色を消さない（一時的な401/タイムアウト対策）
      } catch {
        // keep previous colors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, pickStadium, invite]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, unlocked]);

  async function loadSchedule() {
    const allRaces = Array.from({ length: 12 }, (_, i) => i + 1);
    const fallback: StadiumOpt[] = Object.entries(STADIUMS).map(([id, name]) => ({
      id: Number(id),
      name,
    }));
    try {
      const res = await fetch("/api/schedule");
      const json = await res.json().catch(() => ({}));
      const next: StadiumOpt[] = Array.isArray(json.stadiums) ? json.stadiums : [];
      if (next.length) {
        setStadiums(next);
        setRaces(json.races || allRaces);
        setPickStadium((prev) => prev || next[0]?.id || 0);
        return;
      }
    } catch {
      // fall through to full list
    }
    setStadiums(fallback);
    setRaces(allRaces);
    setPickStadium((prev) => prev || fallback[0]?.id || 0);
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
        setTargetPurchases({});
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
      setTargetPurchases(
        json.targetPurchases && typeof json.targetPurchases === "object"
          ? (json.targetPurchases as Record<string, PurchaseLockState>)
          : {},
      );
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
    setTargetPurchases({});
    setOpenTargetKey("");
    setOpenTargetTicketKey("");
  }

  async function confirmPurchase(messageId: string, decision: PurchaseLockState) {
    const code = invite.trim();
    const name = displayName.trim();
    if (!code || !name || !messageId) {
      setPurchaseInlineErrorKey(messageId || "ai");
      setPurchaseInlineError("先に入場と表示名を入れてください");
      setError("先に入場と表示名を入れてください");
      return;
    }
    setPurchaseBusyId(messageId);
    setPurchaseInlineErrorKey(messageId);
    setPurchaseInlineError("");
    setError("");
    setStatus("");
    // 楽観的にロック表示へ（Discord待ちで無反応に見えないように）
    if (decision === "yes" || decision === "purchased" || decision === "no") {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                meta: {
                  ...m.meta,
                  purchaseDecision: decision,
                  purchaseLockedExhibition:
                    decision === "yes"
                      ? m.meta?.purchaseLockedExhibition || "waiting"
                      : m.meta?.purchaseLockedExhibition,
                },
              }
            : m,
        ),
      );
    } else if (decision === "skip") {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, meta: { ...m.meta, purchaseDecision: undefined } }
            : m,
        ),
      );
    }
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
          kind: "purchase_confirm",
          messageId,
          decision,
          authorName: name,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json.error || "購入ロックに失敗しました";
        setPurchaseInlineError(msg);
        setError(msg);
        await loadFeed(code, { quiet: true, refresh: false, name });
        return;
      }
      setPurchaseInlineError("");
      setStatus(
        decision === "yes"
          ? "購入予定でロックしました"
          : decision === "purchased"
            ? "購入済みで固定しました"
            : decision === "skip"
              ? "スルー（通常表示に戻しました）"
              : "見送りにしました",
      );
      await loadFeed(code, { quiet: true, refresh: false, name });
    } catch {
      const msg = "購入ロックに失敗しました（通信エラー）";
      setPurchaseInlineError(msg);
      setError(msg);
      await loadFeed(code, { quiet: true, refresh: false, name }).catch(() => null);
    } finally {
      setPurchaseBusyId("");
    }
  }

  async function confirmTargetPurchase(
    placeNo: number,
    raceNo: number,
    decision: PurchaseLockState,
  ) {
    const code = invite.trim();
    const name = displayName.trim();
    const key = `${placeNo}-${raceNo}`;
    if (!code || !name) {
      setPurchaseInlineErrorKey(key);
      setPurchaseInlineError("先に入場と表示名を入れてください");
      setError("先に入場と表示名を入れてください");
      return;
    }
    setTargetPurchaseBusyKey(key);
    setPurchaseInlineErrorKey(key);
    setPurchaseInlineError("");
    setError("");
    setStatus("");
    // 楽観的更新：押した瞬間にロック色へ
    setTargetPurchases((prev) => {
      const next = { ...prev };
      if (decision === "skip") delete next[key];
      else next[key] = decision;
      return next;
    });
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 12000);
      const res = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-chat-invite": code,
        },
        body: JSON.stringify({
          invite: code,
          kind: "target_purchase_confirm",
          placeNo,
          raceNo,
          decision,
          authorName: name,
        }),
        signal: controller.signal,
      });
      window.clearTimeout(timer);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json.error || "本命対象の購入ロックに失敗しました";
        setPurchaseInlineError(msg);
        setError(msg);
        await loadFeed(code, { quiet: true, refresh: false, name });
        return;
      }
      setPurchaseInlineError("");
      setStatus(
        decision === "yes"
          ? "本命対象を購入予定でロックしました"
          : decision === "purchased"
            ? "本命対象を購入済みで固定しました"
            : decision === "skip"
              ? "スルー（通常表示に戻しました）"
              : "本命対象を見送りにしました",
      );
      await loadFeed(code, { quiet: true, refresh: false, name });
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      const msg = aborted
        ? "応答が遅いです。再読み込みしてロック状態を確認してください"
        : "本命対象の購入ロックに失敗しました（通信エラー）";
      setPurchaseInlineError(msg);
      setError(msg);
      await loadFeed(code, { quiet: true, refresh: false, name }).catch(() => null);
    } finally {
      setTargetPurchaseBusyKey("");
    }
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

  async function requestPredict(opts?: { placeNo?: number; raceNo?: number }) {
    const code = invite.trim();
    const name = displayName.trim();
    const placeNo = Number(opts?.placeNo || pickStadium || 0);
    const raceNo = Number(opts?.raceNo || pickRace || 0);
    if (!code || !name) {
      setError("招待コードと表示名が必要です");
      return;
    }
    if (!placeNo || !raceNo) {
      setError("場とレースを選んでください");
      return;
    }
    setPickStadium(placeNo);
    setPickRace(raceNo);
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
          placeNo,
          raceNo,
          authorName: name,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "予想の取得に失敗しました");
        return;
      }
      setStatus("AI予想を表示しました（自分と管理人のみ／他の友達には見えません）");
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

          {isAdmin ? (
            <div className="chat-admin-panel">
              <div className="chat-live-head">
                <strong>管理人専用・回収率</strong>
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
              <p className="note">友達のAI予想ログです。行を押すと本文と回収率を見られます。</p>
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
                </div>
              ) : null}
              {!adminOversight || adminOversight.picks.length === 0 ? (
                <p className="note">まだAI予想ログはありません。</p>
              ) : (
                <ul className="chat-predict-log">
                  {adminOversight.picks.map((p) => (
                    <li key={p.message_id}>
                      <button
                        type="button"
                        className={`btn ghost ${selectedAdminPickId === p.message_id ? "active" : ""}`}
                        onClick={() => {
                          setSelectedAdminPickId((cur) =>
                            cur === p.message_id ? "" : p.message_id,
                          );
                          setPickStadium(p.placeNo);
                          setPickRace(p.raceNo);
                        }}
                      >
                        {p.owner_name} · {p.label}
                        {p.result.recoveryPct == null
                          ? ""
                          : ` · ${p.result.recoveryPct.toFixed(1)}%`}
                      </button>
                    </li>
                  ))}
                </ul>
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
                      <span>
                        回収率{" "}
                        {pick.result.recoveryPct == null
                          ? "未確定"
                          : `${pick.result.recoveryPct.toFixed(1)}%`}
                      </span>
                    </div>
                    <pre className="chat-bubble-body">{pick.body || "予想本文なし"}</pre>
                  </article>
                );
              })()}
            </div>
          ) : null}

          <div className="chat-predict-panel chat-ai-bar">
            <div className="chat-live-head">
              <strong>AI予想</strong>
              <span className="note">1時間に12レースが上限（同じレースの再取得は数えません）</span>
            </div>
            <div className="chat-predict-row">
              <label className="field">
                <span>場</span>
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
              <button
                type="button"
                className="btn"
                disabled={predicting || !pickStadium}
                onClick={() => {
                  void requestPredict();
                }}
              >
                {predicting ? "取得中…" : "AI予想"}
              </button>
            </div>
            <div className="field" style={{ marginTop: "0.55rem" }}>
              <span>レース（信頼度4=橙 / 5=赤）</span>
              <div className="race-pick-grid chat-race-pick-grid" style={{ marginTop: "0.35rem" }}>
                {(races.length ? races : Array.from({ length: 12 }, (_, i) => i + 1)).map(
                  (n) => {
                    const conf = Number(raceConfidence[String(n)] || 0);
                    const tone =
                      conf >= 5
                        ? "conf5"
                        : conf >= 4
                          ? "conf4"
                          : conf > 0
                            ? "conf-mid"
                            : "";
                    return (
                      <button
                        key={n}
                        type="button"
                        className={`race-pick-btn ${tone} ${pickRace === n ? "active" : ""}`}
                        disabled={!pickStadium || predicting}
                        onClick={() => setPickRace(n)}
                      >
                        {n}R
                        {conf > 0 ? <em>{conf}/5</em> : null}
                      </button>
                    );
                  },
                )}
              </div>
            </div>
            {targets.length > 0 ? (
              <div className="chat-honmei-targets">
                <span className="chat-honmei-targets-label">
                  本日の本命対象
                  <em className="chat-pick-hint">押すと買い目・理由</em>
                </span>
                <div className="chat-target-stack">
                  {[...new Map(targets.map((t) => [`${t.stadium}-${t.race}`, t])).values()]
                    .slice(0, 8)
                    .map((t) => {
                    const key = `${t.stadium}-${t.race}`;
                    const open = openTargetKey === key;
                    const badge = targetBadge(t.status);
                    const single = t.tickets_single || [];
                    const five = t.tickets_five || [];
                    const ticketHint = [
                      single.length ? `単点 ${single.join("/")}` : null,
                      five.length ? `5点 ${five.join("/")}` : null,
                    ]
                      .filter(Boolean)
                      .join(" ／ ");
                    const ticketFallback =
                      ticketHint ||
                      (t.tickets?.length ? t.tickets.join(" / ") : "—");
                    const lock = targetPurchases[key];
                    const lockTone = purchaseLockTone(lock);
                    const lockBusy = targetPurchaseBusyKey === key;
                    const exhibitDone = targetExhibitDone(t.status);
                    const lockBadge =
                      lock === "purchased"
                        ? "購入済み"
                        : lock === "yes"
                          ? exhibitDone
                            ? "展示後・選択待ち"
                            : "ロック中"
                          : lock === "no"
                            ? "見送り"
                            : "";
                    return (
                      <div
                        key={key}
                        className={`chat-target-item ${open ? "open" : ""} ${targetToneClass(t.status)} ${lockTone}`}
                      >
                        <button
                          type="button"
                          className={`chat-race-chip ${open ? "active" : ""} ${targetToneClass(t.status)} ${lockTone}`}
                          aria-expanded={open}
                          title="買い目と理由を表示"
                          onClick={() => {
                            setPickStadium(t.stadium);
                            setPickRace(t.race);
                            setOpenTargetKey((prev) => {
                              const next = prev === key ? "" : key;
                              if (next !== key) setOpenTargetTicketKey("");
                              return next;
                            });
                          }}
                        >
                          <span className="chat-race-chip-label">
                            {t.stadium_name}
                            {t.race}R
                            {t.label ? ` · ${t.label}` : ""}
                          </span>
                          {lockBadge ? <em>{lockBadge}</em> : badge ? <em>{badge}</em> : null}
                        </button>
                        {open ? (
                          <div className={`chat-target-detail ${lockTone}`}>
                            <strong>
                              {t.stadium_name}
                              {t.race}R の買い目
                              {t.label ? `（${t.label}）` : ""}
                              <em className="chat-pick-hint">押すと買い目の理由</em>
                            </strong>
                            {single.length || five.length ? (
                              <div className="chat-band-stack">
                                {(
                                  [
                                    { key: "single", label: "本命S・単点", list: single },
                                    { key: "five", label: "本命S・5点", list: five },
                                  ] as const
                                )
                                  .filter((band) => band.list.length)
                                  .map((band) => (
                                    <div key={band.key} className="chat-band-row">
                                      <span className="chat-band-label">
                                        {band.label}
                                        {` · ${band.list.length}`}
                                      </span>
                                      <ul className="chat-ticket-list">
                                        {band.list.map((combo) => {
                                          const ticketKey = `${key}:${band.key}:${combo}`;
                                          const ticketOpen = openTargetTicketKey === ticketKey;
                                          return (
                                            <li key={ticketKey}>
                                              <button
                                                type="button"
                                                className={`chat-ticket-btn ${ticketOpen ? "open" : ""}`}
                                                aria-expanded={ticketOpen}
                                                onClick={() =>
                                                  setOpenTargetTicketKey((prev) =>
                                                    prev === ticketKey ? "" : ticketKey,
                                                  )
                                                }
                                              >
                                                <span className="chat-ticket-combo">{combo}</span>
                                              </button>
                                              {ticketOpen ? (
                                                <div className="chat-ticket-why">
                                                  <strong>買い目の理由 · {combo}</strong>
                                                  <p>
                                                    {t.why?.trim() ||
                                                      (t.status === "skipped"
                                                        ? t.skip_detail || "スルー"
                                                        : "") ||
                                                      "理由データなし"}
                                                  </p>
                                                  {(t.reasons || []).length ? (
                                                    <ul className="chat-ticket-reasons">
                                                      {t.reasons!.map((r) => (
                                                        <li key={r}>{r}</li>
                                                      ))}
                                                    </ul>
                                                  ) : null}
                                                  {t.skip_detail && t.status === "skipped" ? (
                                                    <p className="note">スルー: {t.skip_detail}</p>
                                                  ) : null}
                                                </div>
                                              ) : null}
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    </div>
                                  ))}
                              </div>
                            ) : t.tickets?.length ? (
                              <ul className="chat-ticket-list">
                                {t.tickets.map((combo) => {
                                  const ticketKey = `${key}:flat:${combo}`;
                                  const ticketOpen = openTargetTicketKey === ticketKey;
                                  return (
                                    <li key={ticketKey}>
                                      <button
                                        type="button"
                                        className={`chat-ticket-btn ${ticketOpen ? "open" : ""}`}
                                        aria-expanded={ticketOpen}
                                        onClick={() =>
                                          setOpenTargetTicketKey((prev) =>
                                            prev === ticketKey ? "" : ticketKey,
                                          )
                                        }
                                      >
                                        <span className="chat-ticket-combo">{combo}</span>
                                      </button>
                                      {ticketOpen ? (
                                        <div className="chat-ticket-why">
                                          <strong>買い目の理由 · {combo}</strong>
                                          <p>
                                            {t.why?.trim() ||
                                              (t.status === "skipped"
                                                ? t.skip_detail || "スルー"
                                                : "") ||
                                              "理由データなし"}
                                          </p>
                                          {(t.reasons || []).length ? (
                                            <ul className="chat-ticket-reasons">
                                              {t.reasons!.map((r) => (
                                                <li key={r}>{r}</li>
                                              ))}
                                            </ul>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : (
                              <p className="chat-pick-empty">{ticketFallback}</p>
                            )}
                            <div className={`chat-purchase-ask ${lockTone}`}>
                              {lockBusy ? (
                                <p className="chat-purchase-ask-busy">反映中…</p>
                              ) : null}
                              {purchaseInlineError && purchaseInlineErrorKey === key ? (
                                <p className="chat-purchase-ask-error">{purchaseInlineError}</p>
                              ) : null}
                              {lock === "purchased" ? (
                                <p className="chat-purchase-ask-done">購入済み（チャットに固定）</p>
                              ) : lock === "no" ? (
                                <p className="chat-purchase-ask-done">見送り</p>
                              ) : lock === "yes" && exhibitDone ? (
                                <>
                                  <p className="chat-purchase-ask-label">
                                    展示後の情報です。スルー推奨か購入済みか選んでください
                                  </p>
                                  <div className="chat-purchase-ask-actions">
                                    <button
                                      type="button"
                                      className="btn ghost chat-purchase-skip"
                                      disabled={lockBusy}
                                      onClick={() => {
                                        void confirmTargetPurchase(t.stadium, t.race, "skip");
                                      }}
                                    >
                                      スルー推奨
                                    </button>
                                    <button
                                      type="button"
                                      className="btn chat-purchase-bought"
                                      disabled={lockBusy}
                                      onClick={() => {
                                        void confirmTargetPurchase(
                                          t.stadium,
                                          t.race,
                                          "purchased",
                                        );
                                      }}
                                    >
                                      購入済み
                                    </button>
                                  </div>
                                </>
                              ) : lock === "yes" ? (
                                <p className="chat-purchase-ask-done">
                                  ロック中（購入予定）・展示後にスルー推奨／購入済みを選べます
                                </p>
                              ) : (
                                <>
                                  <p className="chat-purchase-ask-label">購入予定？</p>
                                  <div className="chat-purchase-ask-actions">
                                    <button
                                      type="button"
                                      className="btn chat-purchase-yes"
                                      disabled={lockBusy}
                                      onClick={() => {
                                        void confirmTargetPurchase(t.stadium, t.race, "yes");
                                      }}
                                    >
                                      YES
                                    </button>
                                    <button
                                      type="button"
                                      className="btn ghost chat-purchase-no"
                                      disabled={lockBusy}
                                      onClick={() => {
                                        void confirmTargetPurchase(t.stadium, t.race, "no");
                                      }}
                                    >
                                      NO
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="note">いま対象レースはありません。</p>
            )}
          </div>

          <div className="chat-stream" ref={listRef}>
            {messages.length === 0 ? (
              <p className="status">まだ雑談がありません。下からメッセージを送れます。</p>
            ) : (
              (() => {
                // 管理人は全員のアクション（admin/private）もチャット欄に表示。
                // 一般は admin ログを隠す（自分の private と公開のみ）。
                const visible = isAdmin
                  ? messages
                  : messages.filter((m) => m.meta?.visibility !== "admin");
                const raceUiById = dedupeRaceUi(visible);
                return visible.map((m) => {
                const isPrivate = m.meta?.visibility === "private";
                const isAdminLog =
                  m.meta?.visibility === "admin" || m.meta?.mode === "admin_predict_log";
                const isOp =
                  m.author_role === "operator" || m.kind === "picks" || m.kind === "note";
                const isAdminSpeech =
                  isOp &&
                  m.meta?.visibility !== "admin" &&
                  m.meta?.visibility !== "private" &&
                  (m.kind === "chat" || m.meta?.mode === "casual" || !m.meta?.mode);
                const isMine =
                  m.kind === "chat" && m.author_name === displayName.trim() && !isOp;
                const races = raceUiById.get(m.id) || [];
                // チップ重複で空でも本文は残す（レース選択で履歴が消えない）
                const hasRaceUi = races.length > 0;
                const isExhibition = m.meta?.mode === "exhibition_after_honmei";
                const isResult = m.meta?.mode === "honmei_result";
                const openKey =
                  openRaceByMessage[m.id] || (races[0] ? raceKey(races[0]) : "");
                const selected =
                  races.find((r) => raceKey(r) === openKey) || races[0] || null;
                const split = hasRaceUi ? splitPickBody(m.body) : null;
                const showRaw = Boolean(showBodyByMessage[m.id]);
                const purchaseTone =
                  m.meta?.mode === "app_race_pick"
                    ? purchaseLockTone(m.meta.purchaseDecision)
                    : m.meta?.mode === "purchase_ack" || m.meta?.mode === "target_purchase_ack"
                      ? purchaseLockTone(m.meta.purchaseDecision)
                      : "";
                return (
                  <article
                    key={m.id}
                    className={`chat-bubble ${isOp ? "op" : "member"} ${isMine ? "mine" : ""} ${
                      isPrivate ? "private" : ""
                    } ${isAdminLog ? "admin-log" : ""} ${
                      isAdminSpeech ? "admin-speech" : ""
                    } ${hasRaceUi ? "has-race-ui" : ""} ${isExhibition ? "exhibition-after" : ""} ${
                      isResult ? "honmei-result" : ""
                    } ${purchaseTone}`}
                  >
                    <div className="chat-bubble-meta">
                      <strong>
                        {m.kind === "chat"
                          ? m.author_name || "メンバー"
                          : m.author_name || m.title || (isOp ? "運営" : "メンバー")}
                      </strong>
                      <span>{kindLabel(m)}</span>
                      {isAdminLog ? <span>管理人のみ</span> : null}
                      {isPrivate && !isAdminLog ? (
                        <span>{isAdmin ? `ユーザー: ${m.meta?.owner_name || "—"}` : "自分のみ"}</span>
                      ) : null}
                      <span>{formatJst(m.created_at)} JST</span>
                    </div>

                    {hasRaceUi && selected ? (
                      <div className="chat-race-ui">
                        <p className="chat-race-summary">
                          {/確定|展示待ち|スルー|結果/.test(m.title)
                            ? m.title
                            : races.length > 1
                              ? `${m.title} · ${summarizeChips(races)}`
                              : m.title}
                        </p>
                        <div className="chat-race-chips" role="list">
                          {races.map((chip) => {
                            const badge = statusBadge(chip);
                            const active = raceKey(chip) === raceKey(selected);
                            return (
                              <button
                                key={raceKey(chip)}
                                type="button"
                                role="listitem"
                                className={`chat-race-chip ${chipToneClass(chip)} ${
                                  active ? "active" : ""
                                }`}
                                onClick={() =>
                                  setOpenRaceByMessage((prev) => ({
                                    ...prev,
                                    [m.id]: raceKey(chip),
                                  }))
                                }
                              >
                                <span className="chat-race-chip-label">{chip.label}</span>
                                {badge ? <em>{badge}</em> : null}
                              </button>
                            );
                          })}
                        </div>

                        <div className="chat-race-detail">
                          <div className="chat-pick-status-row">
                            <strong>{selected.label}</strong>
                            <span
                              className={`chat-status-pill ${chipToneClass(selected)}`}
                            >
                              {statusDetail(selected)}
                            </span>
                          </div>

                          {(selected.confidence != null ||
                            selected.confidenceLabel ||
                            m.meta?.confidence != null) && (
                            <div className="chat-confidence-row">
                              <span className="chat-confidence-badge">
                                信頼度{" "}
                                {selected.confidenceLabel ||
                                  m.meta?.confidenceLabel ||
                                  `${selected.confidence ?? m.meta?.confidence}/5`}
                              </span>
                            </div>
                          )}

                          <div className="chat-pick-block">
                            <div className="chat-pick-block-label">
                              買い目
                              <em className="chat-pick-hint">押すと買い目の理由</em>
                            </div>
                            {selected.status === "skipped" ? (
                              <p className="chat-pick-empty">スルーのため買い目なし</p>
                            ) : hasBandTickets(selected.bands) ? (
                              <div className="chat-band-stack">
                                {(
                                  [
                                    {
                                      key: "honmei",
                                      label: "本命",
                                      list: normalizeBandTickets(selected.bands?.honmei),
                                    },
                                    {
                                      key: "honmeiSSingle",
                                      label: "本命S・単点",
                                      list: normalizeBandTickets(selected.bands?.honmeiSSingle),
                                    },
                                    {
                                      key: "honmeiS",
                                      label: "本命S・5点",
                                      list: normalizeBandTickets(selected.bands?.honmeiS),
                                    },
                                    {
                                      key: "oshi",
                                      label: "押し目",
                                      list: normalizeBandTickets(selected.bands?.oshi),
                                    },
                                    {
                                      key: "ana",
                                      label: "穴",
                                      list: normalizeBandTickets(selected.bands?.ana),
                                    },
                                  ] as const
                                ).map((band) => (
                                  <div key={band.key} className="chat-band-row">
                                    <span className="chat-band-label">
                                      {band.label}
                                      {band.list.length ? ` · ${band.list.length}` : ""}
                                    </span>
                                    {band.list.length ? (
                                      <ul className="chat-ticket-list">
                                        {band.list.map((t) => {
                                          const ticketKey = `${band.key}:${t.combo}`;
                                          const open =
                                            openTicketByMessage[m.id] === ticketKey;
                                          const settled = Boolean(t.result);
                                          const pay = formatTicketPayout(t.payout);
                                          return (
                                            <li key={ticketKey}>
                                              <button
                                                type="button"
                                                className={`chat-ticket-btn ${open ? "open" : ""} ${
                                                  t.result === "hit"
                                                    ? "hit"
                                                    : t.result === "miss"
                                                      ? "miss"
                                                      : ""
                                                }`}
                                                aria-expanded={open}
                                                onClick={() =>
                                                  setOpenTicketByMessage((prev) => ({
                                                    ...prev,
                                                    [m.id]: open ? "" : ticketKey,
                                                  }))
                                                }
                                              >
                                                <span className="chat-ticket-combo">
                                                  {settled
                                                    ? t.result === "hit"
                                                      ? "⭕️ "
                                                      : "❌ "
                                                    : ""}
                                                  {t.combo}
                                                </span>
                                                {t.result === "hit" && pay ? (
                                                  <span className="chat-ticket-payout">
                                                    {pay}
                                                  </span>
                                                ) : null}
                                              </button>
                                              {open ? (
                                                <div className="chat-ticket-why">
                                                  <strong>買い目の理由 · {t.combo}</strong>
                                                  {t.role ? <p className="chat-ticket-role">{t.role}</p> : null}
                                                  <p>
                                                    {t.why?.trim() ||
                                                      selected.why?.trim() ||
                                                      "理由データなし"}
                                                  </p>
                                                  {(t.reasons || []).length ? (
                                                    <ul className="chat-ticket-reasons">
                                                      {t.reasons!.map((r) => (
                                                        <li key={r}>{r}</li>
                                                      ))}
                                                    </ul>
                                                  ) : null}
                                                  {settled ? (
                                                    <p>
                                                      {t.result === "hit"
                                                        ? `的中 ⭕️${pay ? ` 払戻 ${pay}` : ""}`
                                                        : "不的中 ❌"}
                                                    </p>
                                                  ) : null}
                                                </div>
                                              ) : null}
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    ) : (
                                      <p className="chat-pick-empty">
                                        {band.key === "honmeiS" || band.key === "honmeiSSingle"
                                          ? "条件外"
                                          : "—"}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : selected.tickets && selected.tickets.length ? (
                              <ul className="chat-ticket-list">
                                {selected.tickets.map((t) => {
                                  const ticketKey = `flat:${t}`;
                                  const open = openTicketByMessage[m.id] === ticketKey;
                                  const settledRow = selected.ticketResults?.find(
                                    (r) => r.combo === t,
                                  );
                                  const pay = formatTicketPayout(settledRow?.payout);
                                  return (
                                    <li key={t}>
                                      <button
                                        type="button"
                                        className={`chat-ticket-btn ${open ? "open" : ""} ${
                                          settledRow?.result === "hit"
                                            ? "hit"
                                            : settledRow?.result === "miss"
                                              ? "miss"
                                              : ""
                                        }`}
                                        aria-expanded={open}
                                        onClick={() =>
                                          setOpenTicketByMessage((prev) => ({
                                            ...prev,
                                            [m.id]: open ? "" : ticketKey,
                                          }))
                                        }
                                      >
                                        <span className="chat-ticket-combo">
                                          {settledRow
                                            ? settledRow.result === "hit"
                                              ? "⭕️ "
                                              : "❌ "
                                            : ""}
                                          {t}
                                        </span>
                                        {settledRow?.result === "hit" && pay ? (
                                          <span className="chat-ticket-payout">{pay}</span>
                                        ) : null}
                                      </button>
                                      {open ? (
                                        <div className="chat-ticket-why">
                                          <p>
                                            {selected.why?.trim() ||
                                              whyFallback(
                                                split?.explainBlock || "",
                                                selected,
                                              ) ||
                                              "理由データなし"}
                                          </p>
                                          {settledRow ? (
                                            <p>
                                              {settledRow.result === "hit"
                                                ? `的中 ⭕️${pay ? ` 払戻 ${pay}` : ""}`
                                                : "不的中 ❌"}
                                            </p>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : (
                              <p className="chat-pick-empty">買い目なし</p>
                            )}
                          </div>

                          <div className="chat-pick-block chat-pick-explain">
                            <div className="chat-pick-block-label">レース説明</div>
                            <p className="chat-pick-why">
                              {selected.why?.trim() ||
                                whyFallback(split?.explainBlock || "", selected) ||
                                (selected.status === "skipped"
                                  ? "条件外または進入変更のためスルー"
                                  : "—")}
                            </p>
                          </div>

                          {m.meta?.mode === "app_race_pick" ? (
                            <div
                              className={`chat-purchase-ask ${purchaseLockTone(m.meta.purchaseDecision)}`}
                            >
                              {purchaseBusyId === m.id ? (
                                <p className="chat-purchase-ask-busy">反映中…</p>
                              ) : null}
                              {purchaseInlineError && purchaseInlineErrorKey === m.id ? (
                                <p className="chat-purchase-ask-error">{purchaseInlineError}</p>
                              ) : null}
                              {m.meta.purchaseDecision === "purchased" ? (
                                <p className="chat-purchase-ask-done">
                                  購入済み（チャットに固定・結果はDiscord通知）
                                </p>
                              ) : m.meta.purchaseDecision === "no" ? (
                                <p className="chat-purchase-ask-done">見送り</p>
                              ) : m.meta.purchaseDecision === "yes" &&
                                aiExhibitDone(m) ? (
                                <>
                                  <p className="chat-purchase-ask-label">
                                    展示後の情報です。スルー推奨か購入済みか選んでください
                                  </p>
                                  <div className="chat-purchase-ask-actions">
                                    <button
                                      type="button"
                                      className="btn ghost chat-purchase-skip"
                                      disabled={purchaseBusyId === m.id}
                                      onClick={() => {
                                        void confirmPurchase(m.id, "skip");
                                      }}
                                    >
                                      スルー推奨
                                    </button>
                                    <button
                                      type="button"
                                      className="btn chat-purchase-bought"
                                      disabled={purchaseBusyId === m.id}
                                      onClick={() => {
                                        void confirmPurchase(m.id, "purchased");
                                      }}
                                    >
                                      購入済み
                                    </button>
                                  </div>
                                </>
                              ) : m.meta.purchaseDecision === "yes" ? (
                                <p className="chat-purchase-ask-done">
                                  ロック中（購入予定）・展示後にスルー推奨／購入済みを選べます
                                </p>
                              ) : (
                                <>
                                  <p className="chat-purchase-ask-label">購入予定？</p>
                                  <div className="chat-purchase-ask-actions">
                                    <button
                                      type="button"
                                      className="btn chat-purchase-yes"
                                      disabled={purchaseBusyId === m.id}
                                      onClick={() => {
                                        void confirmPurchase(m.id, "yes");
                                      }}
                                    >
                                      YES
                                    </button>
                                    <button
                                      type="button"
                                      className="btn ghost chat-purchase-no"
                                      disabled={purchaseBusyId === m.id}
                                      onClick={() => {
                                        void confirmPurchase(m.id, "no");
                                      }}
                                    >
                                      NO
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          ) : null}
                        </div>

                        {split && (split.explainBlock || split.rest || m.body) ? (
                          <div className="chat-race-more">
                            <button
                              type="button"
                              className="btn ghost chat-race-more-btn"
                              onClick={() =>
                                setShowBodyByMessage((prev) => ({
                                  ...prev,
                                  [m.id]: !prev[m.id],
                                }))
                              }
                            >
                              {showRaw ? "本文を閉じる" : "全文を見る"}
                            </button>
                            {showRaw ? (
                              <pre className="chat-bubble-body chat-race-raw">{m.body}</pre>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <pre className="chat-bubble-body">{m.body}</pre>
                    )}
                  </article>
                );
              });
              })()
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

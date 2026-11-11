import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";

export type ChatMessage = {
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

type ChatFeed = {
  updated_at: string | null;
  messages: ChatMessage[];
};

const MAX_MESSAGES = 200;

function feedPaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "data", "chat_feed.json"),
    path.join(cwd, "src", "data", "chat_feed.json"),
  ];
}

function emptyFeed(): ChatFeed {
  return { updated_at: null, messages: [] };
}

export function readChatFeed(): ChatFeed {
  for (const p of feedPaths()) {
    try {
      if (!existsSync(p)) continue;
      const doc = JSON.parse(readFileSync(p, "utf8")) as ChatFeed;
      if (!Array.isArray(doc.messages)) return emptyFeed();
      return doc;
    } catch {
      // try next
    }
  }
  return emptyFeed();
}

export function writeChatFeed(feed: ChatFeed): void {
  const text = JSON.stringify(feed, null, 2) + "\n";
  for (const p of feedPaths()) {
    try {
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text, "utf8");
    } catch {
      // best-effort both paths
    }
  }
}

export function appendChatMessage(message: Omit<ChatMessage, "id" | "created_at"> & { id?: string; created_at?: string }): ChatMessage {
  const feed = readChatFeed();
  const row: ChatMessage = {
    id: message.id || `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    created_at: message.created_at || new Date().toISOString(),
    kind: message.kind,
    title: message.title,
    body: message.body,
    meta: message.meta,
  };
  feed.messages = [row, ...feed.messages].slice(0, MAX_MESSAGES);
  feed.updated_at = row.created_at;
  writeChatFeed(feed);
  return row;
}

export function inviteCode(): string {
  return (process.env.CHAT_INVITE_CODE || "shio-invite").trim();
}

export function operatorKey(): string {
  return (process.env.CHAT_OPERATOR_KEY || "shio-op").trim();
}

export function checkInvite(code: string | null | undefined): boolean {
  return Boolean(code && code.trim() === inviteCode());
}

export function checkOperator(key: string | null | undefined): boolean {
  return Boolean(key && key.trim() === operatorKey());
}

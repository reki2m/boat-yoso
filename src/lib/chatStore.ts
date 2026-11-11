import { sql } from "@/lib/db";

export type ChatKind = "picks" | "note" | "chat";
export type ChatRole = "operator" | "member";

export type ChatMessage = {
  id: string;
  created_at: string;
  kind: ChatKind;
  title: string;
  body: string;
  author_name?: string;
  author_role?: ChatRole;
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

const MAX_MESSAGES = 300;
const MAX_BODY = 1000;
const MAX_NAME = 20;

type ChatRow = {
  id: string;
  created_at: string | Date;
  kind: string;
  title: string;
  body: string;
  author_name?: string | null;
  author_role?: string | null;
  meta: ChatMessage["meta"] | string | null;
};

function asIso(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function parseMeta(meta: ChatRow["meta"]): ChatMessage["meta"] | undefined {
  if (!meta) return undefined;
  if (typeof meta === "string") {
    try {
      return JSON.parse(meta) as ChatMessage["meta"];
    } catch {
      return undefined;
    }
  }
  return meta;
}

function asKind(kind: string): ChatKind {
  if (kind === "note") return "note";
  if (kind === "chat") return "chat";
  return "picks";
}

function asRole(role: string | null | undefined): ChatRole | undefined {
  if (role === "operator" || role === "member") return role;
  return undefined;
}

function emptyFeed(): ChatFeed {
  return { updated_at: null, messages: [] };
}

export function sanitizeDisplayName(raw: string | null | undefined): string {
  const name = (raw || "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return name || "名無し";
}

export function sanitizeChatBody(raw: string | null | undefined): string {
  return (raw || "").trim().slice(0, MAX_BODY);
}

export async function readChatFeed(): Promise<ChatFeed> {
  try {
    const rows = await sql<ChatRow>(
      `select id, created_at, kind, title, body, author_name, author_role, meta
       from chat_messages
       order by created_at asc
       limit $1`,
      [MAX_MESSAGES],
    );
    const messages: ChatMessage[] = rows.map((row) => ({
      id: row.id,
      created_at: asIso(row.created_at),
      kind: asKind(row.kind),
      title: row.title,
      body: row.body,
      author_name: row.author_name || undefined,
      author_role: asRole(row.author_role),
      meta: parseMeta(row.meta),
    }));
    return {
      updated_at: messages[messages.length - 1]?.created_at ?? null,
      messages,
    };
  } catch {
    return emptyFeed();
  }
}

export async function clearChatMessages(): Promise<number> {
  const before = await sql<{ count: string | number }>(
    `select count(*)::int as count from chat_messages`,
  ).catch(() => [{ count: 0 }]);
  await sql(`delete from chat_messages`);
  return Number(before[0]?.count ?? 0);
}

export async function appendChatMessage(
  message: Omit<ChatMessage, "id" | "created_at"> & { id?: string; created_at?: string },
): Promise<ChatMessage> {
  const row: ChatMessage = {
    id: message.id || `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    created_at: message.created_at || new Date().toISOString(),
    kind: message.kind,
    title: message.title,
    body: message.body,
    author_name: message.author_name,
    author_role: message.author_role,
    meta: message.meta,
  };
  await sql(
    `insert into chat_messages (id, created_at, kind, title, body, author_name, author_role, meta)
     values ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      row.id,
      row.created_at,
      row.kind,
      row.title,
      row.body,
      row.author_name ?? null,
      row.author_role ?? null,
      JSON.stringify(row.meta ?? null),
    ],
  );
  return row;
}

export function inviteCode(): string {
  const fromEnv = process.env.CHAT_INVITE_CODE?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") return "";
  return "shio-invite";
}

export function operatorKey(): string {
  const fromEnv = process.env.CHAT_OPERATOR_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") return "";
  return "shio-op";
}

export function checkInvite(code: string | null | undefined): boolean {
  const expected = inviteCode();
  return Boolean(expected && code && code.trim() === expected);
}

export function checkOperator(key: string | null | undefined): boolean {
  const expected = operatorKey();
  return Boolean(expected && key && key.trim() === expected);
}

import { sql } from "@/lib/db";

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

type ChatRow = {
  id: string;
  created_at: string | Date;
  kind: string;
  title: string;
  body: string;
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

function emptyFeed(): ChatFeed {
  return { updated_at: null, messages: [] };
}

export async function readChatFeed(): Promise<ChatFeed> {
  try {
    const rows = await sql<ChatRow>(
      `select id, created_at, kind, title, body, meta
       from chat_messages
       order by created_at desc
       limit $1`,
      [MAX_MESSAGES],
    );
    const messages: ChatMessage[] = rows.map((row) => ({
      id: row.id,
      created_at: asIso(row.created_at),
      kind: row.kind === "note" ? "note" : "picks",
      title: row.title,
      body: row.body,
      meta: parseMeta(row.meta),
    }));
    return {
      updated_at: messages[0]?.created_at ?? null,
      messages,
    };
  } catch {
    return emptyFeed();
  }
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
    meta: message.meta,
  };
  await sql(
    `insert into chat_messages (id, created_at, kind, title, body, meta)
     values ($1, $2::timestamptz, $3, $4, $5, $6::jsonb)`,
    [
      row.id,
      row.created_at,
      row.kind,
      row.title,
      row.body,
      JSON.stringify(row.meta ?? null),
    ],
  );
  return row;
}

export function inviteCode(): string {
  const fromEnv = process.env.CHAT_INVITE_CODE?.trim();
  if (fromEnv) return fromEnv;
  // Local sample only. Production must set CHAT_INVITE_CODE.
  if (process.env.NODE_ENV === "production") return "";
  return "shio-invite";
}

export function operatorKey(): string {
  const fromEnv = process.env.CHAT_OPERATOR_KEY?.trim();
  if (fromEnv) return fromEnv;
  // Local sample only. Production must set CHAT_OPERATOR_KEY.
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

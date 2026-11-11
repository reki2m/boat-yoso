import { sql } from "@/lib/db";
import { safeEqualText } from "@/lib/chatSecurity";
import { STADIUMS } from "@/lib/stadiums";

export type ChatKind = "picks" | "note" | "chat";
export type ChatRole = "operator" | "member";
export type ChatVisibility = "public" | "private";

export type ChatMessageMeta = {
  date?: string;
  mode?: string;
  count?: number;
  discord?: boolean;
  placeNo?: number;
  raceNo?: number;
  tickets?: string[];
  visibility?: ChatVisibility;
  owner_session_id?: string;
  owner_name?: string;
};

export type ChatMessage = {
  id: string;
  created_at: string;
  kind: ChatKind;
  title: string;
  body: string;
  author_name?: string;
  author_role?: ChatRole;
  meta?: ChatMessageMeta;
};

export type PredictionSummaryRow = {
  message_id: string;
  created_at: string;
  owner_session_id: string;
  owner_name: string;
  date: string;
  placeNo: number;
  placeName: string;
  raceNo: number;
  tickets: string[];
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
  meta: ChatMessageMeta | string | null;
};

function asIso(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function parseMeta(meta: ChatRow["meta"]): ChatMessageMeta | undefined {
  if (!meta) return undefined;
  if (typeof meta === "string") {
    try {
      return JSON.parse(meta) as ChatMessageMeta;
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

function mapRow(row: ChatRow): ChatMessage {
  return {
    id: row.id,
    created_at: asIso(row.created_at),
    kind: asKind(row.kind),
    title: row.title,
    body: row.body,
    author_name: row.author_name || undefined,
    author_role: asRole(row.author_role),
    meta: parseMeta(row.meta),
  };
}

export function isPrivateMessage(m: ChatMessage): boolean {
  return m.meta?.visibility === "private";
}

export function canViewMessage(
  m: ChatMessage,
  viewer: { sessionId?: string; isAdmin?: boolean },
): boolean {
  if (!isPrivateMessage(m)) return true;
  if (viewer.isAdmin) return true;
  const owner = m.meta?.owner_session_id || "";
  return Boolean(viewer.sessionId && owner && owner === viewer.sessionId);
}

export function sanitizeDisplayName(raw: string | null | undefined): string {
  const name = (raw || "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return name || "名無し";
}

export function sanitizeChatBody(raw: string | null | undefined): string {
  return (raw || "").trim().slice(0, MAX_BODY);
}

export async function readChatFeed(viewer?: {
  sessionId?: string;
  isAdmin?: boolean;
}): Promise<ChatFeed> {
  try {
    const rows = await sql<ChatRow>(
      `select id, created_at, kind, title, body, author_name, author_role, meta
       from chat_messages
       order by created_at asc
       limit $1`,
      [MAX_MESSAGES],
    );
    const mapped = rows.map(mapRow);
    const messages = viewer
      ? mapped.filter((m) => canViewMessage(m, viewer))
      : mapped.filter((m) => !isPrivateMessage(m));
    return {
      updated_at: messages[messages.length - 1]?.created_at ?? null,
      messages,
    };
  } catch {
    return emptyFeed();
  }
}

/** 管理人用: 誰がどのレースを個人予想したか */
export async function listPrivatePredictionSummary(): Promise<PredictionSummaryRow[]> {
  try {
    const rows = await sql<ChatRow>(
      `select id, created_at, kind, title, body, author_name, author_role, meta
       from chat_messages
       where coalesce(meta->>'visibility','public') = 'private'
         and coalesce(meta->>'mode','') in ('private_race_pick', 'chat_race_reply')
       order by created_at desc
       limit 200`,
    );
    return rows.map(mapRow).flatMap((m) => {
      const placeNo = Number(m.meta?.placeNo || 0);
      const raceNo = Number(m.meta?.raceNo || 0);
      if (!placeNo || !raceNo) return [];
      return [
        {
          message_id: m.id,
          created_at: m.created_at,
          owner_session_id: m.meta?.owner_session_id || "",
          owner_name: m.meta?.owner_name || m.author_name || "名無し",
          date: String(m.meta?.date || ""),
          placeNo,
          placeName: STADIUMS[placeNo] || `場${placeNo}`,
          raceNo,
          tickets: Array.isArray(m.meta?.tickets) ? m.meta!.tickets!.map(String) : [],
        },
      ];
    });
  } catch {
    return [];
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

/** 管理人キー。未設定時は運営キーと同じ。チャット消去など破壊操作専用。 */
export function adminKey(): string {
  const fromEnv = process.env.CHAT_ADMIN_KEY?.trim();
  if (fromEnv) return fromEnv;
  return operatorKey();
}

export function checkInvite(code: string | null | undefined): boolean {
  const expected = inviteCode();
  const got = (code || "").trim();
  return Boolean(expected && got && safeEqualText(got, expected));
}

export function checkOperator(key: string | null | undefined): boolean {
  const expected = operatorKey();
  const got = (key || "").trim();
  return Boolean(expected && got && safeEqualText(got, expected));
}

export function checkAdmin(key: string | null | undefined): boolean {
  const expected = adminKey();
  const got = (key || "").trim();
  return Boolean(expected && got && safeEqualText(got, expected));
}

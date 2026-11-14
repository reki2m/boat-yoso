import { sql } from "@/lib/db";
import { normalizeSecret, safeEqualText } from "@/lib/chatSecurity";
import { STADIUMS } from "@/lib/stadiums";

export type ChatKind = "picks" | "note" | "chat";
export type ChatRole = "operator" | "member";
/** public=全員 / private=依頼者のみ / admin=管理人のみ */
export type ChatVisibility = "public" | "private" | "admin";

/** 1点分の買い目（押すと理由を出す用） */
export type ChatBandTicket = {
  combo: string;
  role?: string;
  why?: string;
  /** レース終了後の的中判定（配信時に結果を重ねる） */
  result?: "hit" | "miss";
  /** 100円あたり払戻（的中時） */
  payout?: number;
};

/** 本体アプリと同じ帯分け（本命 / 本命S / 押し / 穴） */
export type ChatPickBands = {
  honmei?: ChatBandTicket[];
  honmeiS?: ChatBandTicket[];
  honmeiSSingle?: ChatBandTicket[];
  oshi?: ChatBandTicket[];
  ana?: ChatBandTicket[];
};

/** チャット欄の「〇〇場 〇〇R」UI用 */
export type ChatRaceChip = {
  placeNo: number;
  placeName: string;
  raceNo: number;
  label: string;
  tickets?: string[];
  /** 本体と同じ買い目帯。あればUIはこちらを優先 */
  bands?: ChatPickBands;
  status?: string;
  why?: string;
  confidence?: number;
  confidenceLabel?: string;
  /** waiting=展示前 / after=展示後反映 */
  exhibition?: "waiting" | "after" | "unknown";
  /** 公式結果が付いたら true（展示待ち表示を結果表示へ切替） */
  settled?: boolean;
  finishCombo?: string;
  ticketResults?: Array<{ combo: string; result: "hit" | "miss"; payout: number }>;
};

export type ChatMessageMeta = {
  date?: string;
  mode?: string;
  count?: number;
  discord?: boolean;
  placeNo?: number;
  raceNo?: number;
  tickets?: string[];
  bands?: ChatPickBands;
  confidence?: number;
  confidenceLabel?: string;
  visibility?: ChatVisibility;
  owner_session_id?: string;
  owner_name?: string;
  /** チャット欄レースUI（〇〇場 〇〇R） */
  races?: ChatRaceChip[];
  race_label?: string;
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
/** AI予想（本命/本命S/押し/穴）本文が入るため余裕を持たせる */
const MAX_BODY = 2200;
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

export function messageVisibility(m: ChatMessage): ChatVisibility {
  const v = m.meta?.visibility;
  if (v === "private" || v === "admin") return v;
  return "public";
}

export function canViewMessage(
  m: ChatMessage,
  viewer: { sessionId?: string; isAdmin?: boolean },
): boolean {
  const vis = messageVisibility(m);
  if (vis === "public") return true;
  if (vis === "admin") return Boolean(viewer.isAdmin);
  // private: 依頼した本人のみ（管理人にも本文は出さない。管理人は admin ログを見る）
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

async function loadMappedMessages(limit = MAX_MESSAGES): Promise<ChatMessage[]> {
  const rows = await sql<ChatRow>(
    `select id, created_at, kind, title, body, author_name, author_role, meta
     from chat_messages
     order by created_at asc
     limit $1`,
    [limit],
  );
  return rows.map(mapRow);
}

function scrubMessageForClient(m: ChatMessage): ChatMessage {
  if (!m.meta?.owner_session_id) return m;
  const { owner_session_id: _omit, ...meta } = m.meta;
  return { ...m, meta };
}

export async function readChatFeed(viewer?: {
  sessionId?: string;
  isAdmin?: boolean;
}): Promise<ChatFeed> {
  try {
    const mapped = await loadMappedMessages();
    const messages = (
      viewer
        ? mapped.filter((m) => canViewMessage(m, viewer))
        : mapped.filter((m) => messageVisibility(m) === "public")
    ).map(scrubMessageForClient);
    return {
      updated_at: messages[messages.length - 1]?.created_at ?? null,
      messages,
    };
  } catch {
    return emptyFeed();
  }
}

/** 精算など内部ジョブ用（可視性フィルタなし） */
export async function readAllChatMessagesForJobs(): Promise<ChatMessage[]> {
  try {
    return await loadMappedMessages();
  } catch {
    return [];
  }
}

/** 管理人用: 誰がどのレースのアプリ予想を開いたか（admin ログ由来） */
export async function listPrivatePredictionSummary(): Promise<PredictionSummaryRow[]> {
  try {
    const rows = await sql<ChatRow>(
      `select id, created_at, kind, title, body, author_name, author_role, meta
       from chat_messages
       where coalesce(meta->>'visibility','public') = 'admin'
         and coalesce(meta->>'mode','') = 'admin_predict_log'
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
  const fromEnv = normalizeSecret(process.env.CHAT_INVITE_CODE);
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") return "";
  return "shio-invite";
}

export function operatorKey(): string {
  const fromEnv = normalizeSecret(process.env.CHAT_OPERATOR_KEY);
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") return "";
  return "shio-op";
}

/** 管理人キー。未設定時は運営キーと同じ。チャット消去など破壊操作専用。 */
export function adminKey(): string {
  const fromEnv = normalizeSecret(process.env.CHAT_ADMIN_KEY);
  if (fromEnv) return fromEnv;
  return operatorKey();
}

export function checkInvite(code: string | null | undefined): boolean {
  const expected = inviteCode();
  const got = normalizeSecret(code);
  return Boolean(expected && got && safeEqualText(got, expected));
}

export function checkOperator(key: string | null | undefined): boolean {
  const expected = operatorKey();
  const got = normalizeSecret(key);
  return Boolean(expected && got && safeEqualText(got, expected));
}

export function checkAdmin(key: string | null | undefined): boolean {
  const expected = adminKey();
  const got = normalizeSecret(key);
  return Boolean(expected && got && safeEqualText(got, expected));
}

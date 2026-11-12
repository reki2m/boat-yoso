import { sql } from "@/lib/db";
import { publicPresenceId } from "@/lib/chatSession";
import { sanitizeDisplayName, type ChatRole } from "@/lib/chatStore";

export type PresenceMember = {
  /** 公開用の匿名ID（生の session_id ではない） */
  id: string;
  display_name: string;
  role: ChatRole;
  last_seen: string;
  me?: boolean;
};

const PRESENCE_TTL_MS = 45_000;
let ensured = false;

async function ensurePresenceTable(): Promise<void> {
  if (ensured) return;
  await sql(`
    create table if not exists chat_presence (
      session_id text primary key,
      display_name text not null,
      role text not null default 'member',
      last_seen timestamptz not null default now()
    )
  `);
  await sql(`
    create index if not exists chat_presence_last_seen_idx
      on chat_presence (last_seen desc)
  `).catch(() => null);
  ensured = true;
}

function asRole(role: string | null | undefined): ChatRole {
  return role === "operator" ? "operator" : "member";
}

function asIso(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

export async function touchPresence(input: {
  sessionId: string;
  displayName: string;
  role?: ChatRole | string | null;
}): Promise<void> {
  const sessionId = (input.sessionId || "").trim().slice(0, 80);
  if (!sessionId) return;
  const displayName = sanitizeDisplayName(input.displayName);
  const role = asRole(input.role);
  await ensurePresenceTable();
  await sql(
    `insert into chat_presence (session_id, display_name, role, last_seen)
     values ($1, $2, $3, now())
     on conflict (session_id) do update
       set display_name = excluded.display_name,
           role = excluded.role,
           last_seen = now()`,
    [sessionId, displayName, role],
  );
}

export async function leavePresence(sessionId: string | null | undefined): Promise<void> {
  const id = (sessionId || "").trim().slice(0, 80);
  if (!id) return;
  await ensurePresenceTable();
  await sql(`delete from chat_presence where session_id = $1`, [id]).catch(() => null);
}

export async function listPresence(viewerSessionId?: string | null): Promise<PresenceMember[]> {
  await ensurePresenceTable();
  const cutoff = new Date(Date.now() - PRESENCE_TTL_MS).toISOString();
  await sql(`delete from chat_presence where last_seen < $1::timestamptz`, [cutoff]).catch(
    () => null,
  );
  const rows = await sql<{
    session_id: string;
    display_name: string;
    role: string;
    last_seen: string | Date;
  }>(
    `select session_id, display_name, role, last_seen
     from chat_presence
     where last_seen >= $1::timestamptz
     order by
       case when role = 'operator' then 0 else 1 end,
       display_name asc,
       last_seen desc`,
    [cutoff],
  ).catch(() => []);

  return rows.map((row) => ({
    id: publicPresenceId(row.session_id),
    display_name: row.display_name,
    role: asRole(row.role),
    last_seen: asIso(row.last_seen),
    me: Boolean(viewerSessionId && viewerSessionId === row.session_id),
  }));
}

create table if not exists chat_presence (
  session_id text primary key,
  display_name text not null,
  role text not null default 'member',
  last_seen timestamptz not null default now()
);

create index if not exists chat_presence_last_seen_idx
  on chat_presence (last_seen desc);

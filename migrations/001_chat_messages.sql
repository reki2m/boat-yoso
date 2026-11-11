create table if not exists chat_messages (
  id text primary key,
  created_at timestamptz not null default now(),
  kind text not null,
  title text not null,
  body text not null,
  meta jsonb
);

create index if not exists chat_messages_created_at_idx
  on chat_messages (created_at desc);

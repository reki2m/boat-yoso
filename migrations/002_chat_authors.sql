alter table chat_messages
  add column if not exists author_name text;

alter table chat_messages
  add column if not exists author_role text;

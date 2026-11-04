-- 4/18: Room messages and replies
-- Requires public.chat_rooms and public.messages.
-- Existing messages remain in the hub with room_id = NULL.

alter table public.messages
  add column if not exists room_id uuid
  references public.chat_rooms(id)
  on delete cascade;

alter table public.messages
  add column if not exists reply_to_id uuid
  references public.messages(id)
  on delete set null;

create index if not exists messages_by_room_created_at
  on public.messages (room_id, created_at);

create index if not exists messages_by_reply_to
  on public.messages (reply_to_id)
  where reply_to_id is not null;

comment on column public.messages.room_id is
  'NULL means the original hub chat; otherwise identifies a room.';

comment on column public.messages.reply_to_id is
  'Optional original message ID for a reply. NULL means not a reply.';
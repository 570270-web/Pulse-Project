-- AI chat storage for pulse-v2.
--
-- Strictly additive: new `ai_*` tables and `ai_*` functions only. No existing
-- table, policy or function is altered. Accounts and sessions stay exactly as
-- they are: every function takes the same `p_token` the rest of the app passes
-- and resolves it through public.sessions, the way the existing RPCs do.
--
-- Removal, if ever needed:
--   drop function if exists public.ai_profile_id(text);
--   drop function if exists public.ai_list_conversations(text);
--   drop function if exists public.ai_get_conversation(text, uuid);
--   drop function if exists public.ai_create_conversation(text, text, text);
--   drop function if exists public.ai_append_message(text, uuid, uuid, text, text, text, boolean);
--   drop function if exists public.ai_rewind_conversation(text, uuid, uuid);
--   drop function if exists public.ai_rename_conversation(text, uuid, text);
--   drop function if exists public.ai_set_conversation_model(text, uuid, text);
--   drop function if exists public.ai_delete_conversation(text, uuid);
--   drop function if exists public.ai_delete_all_conversations(text);
--   drop table if exists public.ai_messages;
--   drop table if exists public.ai_conversations;

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  model text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists ai_conversations_profile on public.ai_conversations (profile_id, updated_at desc);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  model text,
  interrupted boolean not null default false,
  created_at timestamp with time zone not null default now()
);

create index if not exists ai_messages_conversation on public.ai_messages (conversation_id, created_at);

-- Row level security with no policies: these tables are readable only through
-- the functions below, never directly with the anon key.
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

-- The profile behind a session token (null when the token is unknown).
create or replace function public.ai_profile_id(p_token text)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select s.profile_id from public.sessions s where s.token = p_token;
$$;

create or replace function public.ai_list_conversations(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_profile uuid;
  v_items jsonb;
begin
  v_profile := public.ai_profile_id(p_token);
  if v_profile is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.updated_at desc), '[]'::jsonb)
  into v_items
  from (
    select id, title, model, created_at, updated_at
    from public.ai_conversations
    where profile_id = v_profile
    order by updated_at desc
    limit 200
  ) c;

  return v_items;
end;
$$;

create or replace function public.ai_get_conversation(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_profile uuid;
  v_conversation public.ai_conversations%rowtype;
  v_messages jsonb;
begin
  v_profile := public.ai_profile_id(p_token);
  if v_profile is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  select * into v_conversation
  from public.ai_conversations
  where id = p_id and profile_id = v_profile;

  if not found then
    raise exception 'CONVERSATION_NOT_FOUND';
  end if;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb)
  into v_messages
  from public.ai_messages m
  where m.conversation_id = p_id;

  return jsonb_build_object(
    'conversation', to_jsonb(v_conversation),
    'messages', v_messages
  );
end;
$$;

create or replace function public.ai_create_conversation(p_token text, p_title text, p_model text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_profile uuid;
  v_conversation public.ai_conversations%rowtype;
begin
  v_profile := public.ai_profile_id(p_token);
  if v_profile is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  insert into public.ai_conversations (profile_id, title, model)
  values (
    v_profile,
    coalesce(nullif(left(trim(p_title), 80), ''), 'New chat'),
    coalesce(nullif(trim(p_model), ''), 'qwen2.5-0.5b')
  )
  returning * into v_conversation;

  return to_jsonb(v_conversation);
end;
$$;

create or replace function public.ai_append_message(
  p_token text,
  p_conversation_id uuid,
  p_id uuid,
  p_role text,
  p_content text,
  p_model text,
  p_interrupted boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_profile uuid;
  v_conversation public.ai_conversations%rowtype;
  v_message public.ai_messages%rowtype;
  v_at timestamp with time zone;
  v_max_length int;
begin
  v_profile := public.ai_profile_id(p_token);
  if v_profile is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  if p_role not in ('user', 'assistant') then
    raise exception 'INVALID_ROLE';
  end if;
  if p_content is null or length(trim(p_content)) = 0 then
    raise exception 'EMPTY_MESSAGE';
  end if;
  v_max_length := case when p_role = 'user' then 8000 else 100000 end;
  if length(p_content) > v_max_length then
    raise exception 'MESSAGE_TOO_LONG';
  end if;

  select * into v_conversation
  from public.ai_conversations
  where id = p_conversation_id and profile_id = v_profile;

  if not found then
    raise exception 'CONVERSATION_NOT_FOUND';
  end if;

  -- Monotonic within a chat, so the question always sorts before its answer
  -- even when both land in the same millisecond.
  select greatest(now(), coalesce(max(created_at), now()) + interval '1 millisecond')
  into v_at
  from public.ai_messages
  where conversation_id = p_conversation_id;

  insert into public.ai_messages (id, conversation_id, profile_id, role, content, model, interrupted, created_at)
  values (coalesce(p_id, gen_random_uuid()), p_conversation_id, v_profile, p_role, p_content, p_model, coalesce(p_interrupted, false), v_at)
  returning * into v_message;

  update public.ai_conversations
  set updated_at = v_at,
      model = coalesce(nullif(trim(p_model), ''), model)
  where id = p_conversation_id;

  return to_jsonb(v_message);
end;
$$;

create or replace function public.ai_rewind_conversation(p_token text, p_conversation_id uuid, p_after_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_profile uuid;
  v_target public.ai_messages%rowtype;
begin
  v_profile := public.ai_profile_id(p_token);
  if v_profile is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  select * into v_target
  from public.ai_messages
  where id = p_after_id and conversation_id = p_conversation_id and profile_id = v_profile;

  if not found then
    raise exception 'MESSAGE_NOT_FOUND';
  end if;

  delete from public.ai_messages
  where conversation_id = p_conversation_id
    and profile_id = v_profile
    and created_at > v_target.created_at;
end;
$$;

create or replace function public.ai_rename_conversation(p_token text, p_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_profile uuid;
  v_title text;
begin
  v_profile := public.ai_profile_id(p_token);
  if v_profile is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  v_title := nullif(left(trim(p_title), 80), '');
  if v_title is null then
    raise exception 'TITLE_REQUIRED';
  end if;

  update public.ai_conversations
  set title = v_title
  where id = p_id and profile_id = v_profile;

  if not found then
    raise exception 'CONVERSATION_NOT_FOUND';
  end if;
end;
$$;

create or replace function public.ai_set_conversation_model(p_token text, p_id uuid, p_model text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_profile uuid;
begin
  v_profile := public.ai_profile_id(p_token);
  if v_profile is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  update public.ai_conversations
  set model = coalesce(nullif(trim(p_model), ''), model)
  where id = p_id and profile_id = v_profile;

  if not found then
    raise exception 'CONVERSATION_NOT_FOUND';
  end if;
end;
$$;

create or replace function public.ai_delete_conversation(p_token text, p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_profile uuid;
begin
  v_profile := public.ai_profile_id(p_token);
  if v_profile is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  delete from public.ai_conversations
  where id = p_id and profile_id = v_profile;
end;
$$;

create or replace function public.ai_delete_all_conversations(p_token text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_profile uuid;
begin
  v_profile := public.ai_profile_id(p_token);
  if v_profile is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  delete from public.ai_conversations where profile_id = v_profile;
end;
$$;

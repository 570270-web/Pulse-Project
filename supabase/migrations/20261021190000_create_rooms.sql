-- PulseChat: room database foundation
-- Does not modify existing profiles, sessions, or messages tables.

create extension if not exists pgcrypto;

-- Chat rooms
create table if not exists public.chat_rooms (
  id uuid primary key default gen_random_uuid(),

  name text not null
    check (char_length(trim(name)) between 2 and 40),

  code text not null unique
    check (code ~ '^[A-Za-z0-9]{5}$'),

  visibility text not null
    check (visibility in ('public', 'restricted')),

  owner_nickname text not null,

  -- Restricted-room passwords are stored as hashes, never plaintext.
  password_hash text,

  created_at timestamptz not null default now(),

  check (
    (visibility = 'public' and password_hash is null)
    or
    (visibility = 'restricted')
  )
);

-- Room membership and room-specific roles
create table if not exists public.chat_room_members (
  room_id uuid not null
    references public.chat_rooms(id) on delete cascade,

  nickname text not null,

  role text not null default 'member'
    check (role in ('member', 'co_admin')),

  joined_at timestamptz not null default now(),

  primary key (room_id, nickname)
);

-- Room creation requests
create table if not exists public.chat_room_requests (
  id uuid primary key default gen_random_uuid(),

  requester_nickname text not null,

  room_name text not null
    check (char_length(trim(room_name)) between 2 and 40),

  visibility text not null
    check (visibility in ('public', 'restricted')),

  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),

  rejection_reason text,

  reviewed_by text,
  reviewed_at timestamptz,

  created_at timestamptz not null default now()
);

-- A user can have at most one pending request.
create unique index if not exists
  chat_room_requests_one_pending_per_user
on public.chat_room_requests (requester_nickname)
where status = 'pending';

create index if not exists
  chat_room_members_by_nickname
on public.chat_room_members (nickname);

create index if not exists
  chat_room_requests_by_status
on public.chat_room_requests (status, created_at);

-- Enable RLS and deny direct client access.
-- Access will be provided through token-validating database functions.
alter table public.chat_rooms enable row level security;
alter table public.chat_room_members enable row level security;
alter table public.chat_room_requests enable row level security;

revoke all on public.chat_rooms
  from anon, authenticated;

revoke all on public.chat_room_members
  from anon, authenticated;

revoke all on public.chat_room_requests
  from anon, authenticated;

-- Intentionally no client-facing policies yet.
-- Do not expose these tables until the authorization RPCs are added.
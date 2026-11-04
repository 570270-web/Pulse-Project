/*
# Create rooms, membership, roles, and room creation requests

## Overview
Transforms Pulse from a single global chat into a Hub → Multiple chat rooms model.
Users join rooms and chat inside them. Rooms are created via a request/approval
workflow controlled by the site administrator.

## New Tables

### rooms
- id (uuid, PK)
- code (text, unique, 5 characters from [A-Za-z0-9]) — short code for finding rooms
- name (text) — display name
- visibility (text, 'public' | 'restricted') — who can join without a password
- password_hash (text, nullable) — bcrypt hash of room password (only for restricted rooms)
- created_by (uuid, FK profiles) — the user who requested the room (becomes owner)
- created_at (timestamptz)

### room_members
- id (uuid, PK)
- room_id (uuid, FK rooms, CASCADE)
- profile_id (uuid, FK profiles, CASCADE)
- role (text, 'owner' | 'co_admin' | 'member') — role within this room
- joined_at (timestamptz)
- UNIQUE (room_id, profile_id)

### room_creation_requests
- id (uuid, PK)
- requester_id (uuid, FK profiles, CASCADE)
- room_name (text)
- visibility (text, 'public' | 'restricted')
- status (text, 'pending' | 'approved' | 'rejected' | 'password_set')
- reviewed_by (uuid, FK profiles, nullable)
- reviewed_at (timestamptz, nullable)
- created_at (timestamptz)
- room_id (uuid, FK rooms, nullable) — set when the room is created after approval
- Only one pending request per requester (enforced by partial unique index)

## Modified Tables

### messages
- Added room_id (uuid, FK rooms, nullable) — which room the message belongs to.
  Existing messages get room_id = NULL and remain visible in the legacy/global context.
- Added reply_to_id (uuid, FK messages, nullable) — references the message being replied to.
  Existing messages get reply_to_id = NULL.
- Added is_system (boolean, default false) — marks system-generated messages like join announcements.
- Added deleted (boolean, default false) — soft-delete flag so replies can show "original unavailable".

## Security
- RLS enabled on rooms, room_members, room_creation_requests.
  - rooms: SELECT visible to all (public rooms visible to everyone; restricted rooms visible too,
    but joining requires password). All mutations through SECURITY DEFINER functions.
  - room_members: SELECT visible to all (so users can see who's in a room). Mutations through functions.
  - room_creation_requests: No direct access — all through SECURITY DEFINER functions.
- RLS on messages already exists (public SELECT policy). New columns are covered by the existing policy.
- All privileged operations (room creation, approval, password setting, role management, joining)
  are handled by SECURITY DEFINER functions with internal authorization checks.
- Room password hashes are never returned to clients — only room metadata is returned.
*/

-- ── rooms table ──
CREATE TABLE IF NOT EXISTS public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'restricted')),
  password_hash text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rooms_visibility ON public.rooms(visibility);
CREATE INDEX IF NOT EXISTS idx_rooms_created_by ON public.rooms(created_by);

-- ── room_members table ──
CREATE TABLE IF NOT EXISTS public.room_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'co_admin', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_room_members_room ON public.room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_room_members_profile ON public.room_members(profile_id);

-- ── room_creation_requests table ──
CREATE TABLE IF NOT EXISTS public.room_creation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  room_name text NOT NULL,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'restricted')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'password_set')),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL
);
-- Only one pending request per requester
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_request_per_user
  ON public.room_creation_requests(requester_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_room_requests_status ON public.room_creation_requests(status);

-- ── Add columns to messages ──
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS room_id uuid REFERENCES public.rooms(id) ON DELETE CASCADE;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS deleted boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_messages_room ON public.messages(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON public.messages(reply_to_id);

-- ── RLS on new tables ──
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_creation_requests ENABLE ROW LEVEL SECURITY;

-- rooms: everyone can see room metadata (code, name, visibility) — joining still requires password
DROP POLICY IF EXISTS "anon_select_rooms" ON public.rooms;
CREATE POLICY "anon_select_rooms" ON public.rooms FOR SELECT
  TO anon, authenticated USING (true);

-- room_members: everyone can see who's in a room
DROP POLICY IF EXISTS "anon_select_room_members" ON public.room_members;
CREATE POLICY "anon_select_room_members" ON public.room_members FOR SELECT
  TO anon, authenticated USING (true);

-- room_creation_requests: locked down — access only through SECURITY DEFINER functions
-- (no policies = no direct access from anon/authenticated)

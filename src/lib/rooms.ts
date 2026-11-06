import { supabase, getToken } from './supabase';
import type { Message } from './supabase';
import type { RoomSummary, RoomVisibility } from './auth';
import { findRoomByCode } from './auth';
import { tr, type TKey } from './i18n';

/** 모든 RPC 래퍼가 돌려주는 공통 결과 형태 */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; retryAfter?: number };

export type MessagePreview = {
  id: string;
  nickname: string;
  content: string;
  deleted: boolean;
  /** 서버에서 찾지 못한 원본(완전히 삭제됨 등) */
  missing?: boolean;
};

export type RoomMember = {
  nickname: string;
  role: 'owner' | 'co_admin' | 'member';
  joined_at: string;
};

/** 관리자 문의함의 한 줄 = 문의한 유저 1명 (방이 아님) */
export type SupportThreadRow = {
  user_nickname: string;
  message_count: number;
  last_message_at: string | null;
  last_sender: string | null;
  /** 마지막 메시지를 관리자가 보냈는지 (false 이면 답변 필요) */
  last_from_admin: boolean;
};

export type SupportMessage = {
  id: string;
  sender_nickname: string;
  from_admin: boolean;
  content: string;
  /** 서버 문자열 그대로 (다음 조회의 커서로 재사용) */
  created_at: string;
};

export type AdminRoomRow = {
  id: string;
  code: string;
  name: string;
  visibility: RoomVisibility;
  owner_nickname: string;
  member_count: number;
  message_count: number;
};

/** 긴 코드가 먼저 매칭되도록 순서에 주의 (예: ..._LENGTH 가 INVALID_ROOM_PASSWORD 보다 먼저) */
const ERROR_KEYS: Array<[string, TKey]> = [
  ['INVALID_ROOM_PASSWORD_LENGTH', 'err.pwLength'],
  ['INVALID_ROOM_PASSWORD', 'err.roomPw'],
  ['NOT_ROOM_MEMBER', 'err.notMember'],
  ['INVALID_SESSION', 'err.session'],
  ['INVALID_MESSAGE_CONTENT', 'err.content'],
  ['REPLY_TARGET_INVALID', 'err.replyTarget'],
  ['INVALID_ROOM_NAME', 'err.roomName'],
  ['ROOM_PERMISSION_DENIED', 'err.permission'],
  ['SUPPORT_THREAD_NOT_FOUND', 'err.threadNotFound'],
  ['ROOM_NOT_FOUND', 'err.roomNotFound'],
  ['ADMIN_CANNOT_REQUEST_SUPPORT', 'err.adminSupport'],
  ['NOT_ADMIN', 'err.notAdmin'],
];

function describeError(raw: string): { text: string; retryAfter?: number } {
  const rate = /RATE_LIMIT_EXCEEDED:(\d+)/i.exec(raw);

  if (rate) {
    const seconds = Number(rate[1]);

    return {
      text: tr('chat.rateLimit', { max: 60, n: seconds }),
      retryAfter: seconds,
    };
  }

  const upper = raw.toUpperCase();

  for (const [code, key] of ERROR_KEYS) {
    if (upper.includes(code)) return { text: tr(key) };
  }

  return { text: raw || tr('err.unknown') };
}

async function call<T>(
  fn: string,
  args: Record<string, unknown> = {}
): Promise<Result<T>> {
  const token = getToken();

  if (!token) return { ok: false, error: tr('err.session') };

  const { data, error } = await supabase.rpc(fn, { p_token: token, ...args });

  if (error) {
    const described = describeError(error.message);

    return {
      ok: false,
      error: described.text,
      retryAfter: described.retryAfter,
    };
  }

  return { ok: true, data: data as T };
}

function toMessages(rows: unknown): Message[] {
  return ((rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    nickname: String(row.nickname ?? ''),
    content: String(row.content ?? ''),
    // 마이크로초 정밀도를 유지하려고 문자열 그대로 둔다 (페이징 커서로 재사용)
    created_at: String(row.created_at),
    reply_to_id: row.reply_to_id ? String(row.reply_to_id) : null,
    deleted: row.deleted === true,
    is_system: row.is_system === true,
  }));
}

/** 위쪽(과거) 로드. 결과는 오래된 → 최신 순서. */
export async function fetchMessagesBefore(
  roomId: string,
  before: string | null,
  limit: number
): Promise<Result<Message[]>> {
  const res = await call<unknown>('get_room_messages', {
    p_room_id: roomId,
    p_before: before,
    p_limit: limit,
  });

  if (!res.ok) return res;

  return { ok: true, data: toMessages(res.data).reverse() };
}

/** 아래쪽(최근) 로드. 결과는 오래된 → 최신 순서. */
export async function fetchMessagesAfter(
  roomId: string,
  after: string,
  limit: number
): Promise<Result<Message[]>> {
  const res = await call<unknown>('get_room_messages_after', {
    p_room_id: roomId,
    p_after: after,
    p_limit: limit,
  });

  if (!res.ok) return res;

  return { ok: true, data: toMessages(res.data) };
}

export async function fetchMessagePreviews(
  roomId: string,
  ids: string[]
): Promise<Result<MessagePreview[]>> {
  const res = await call<unknown>('get_message_previews', {
    p_room_id: roomId,
    p_ids: ids,
  });

  if (!res.ok) return res;

  return {
    ok: true,
    data: ((res.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      nickname: String(row.nickname ?? ''),
      content: String(row.content ?? ''),
      deleted: row.deleted === true,
    })),
  };
}

/** 에러 문구와 재시도 대기시간(초)까지 돌려주는 전송 함수 */
export async function sendRoomMessage(
  content: string,
  roomId: string,
  replyToId: string | null
): Promise<Result<null>> {
  const res = await call<unknown>('send_message', {
    p_content: content,
    p_room_id: roomId,
    p_reply_to_id: replyToId,
  });

  if (!res.ok) return res;

  return { ok: true, data: null };
}

export async function getRoomMembers(
  roomId: string
): Promise<Result<RoomMember[]>> {
  const res = await call<unknown>('get_room_members', { p_room_id: roomId });

  if (!res.ok) return res;

  return {
    ok: true,
    data: ((res.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      nickname: String(row.nickname ?? ''),
      role:
        row.role === 'owner' || row.role === 'co_admin' ? row.role : 'member',
      joined_at: String(row.joined_at ?? ''),
    })),
  };
}

/** 읽음 확인: 방 멤버 1명의 마지막 읽은 시각 */
export type RoomReadPointer = {
  nickname: string;
  last_read_at: string | null;
};

/** 내가 이 방을 지금 읽었다고 서버에 알린다 */
export async function markRoomRead(roomId: string): Promise<Result<string>> {
  const res = await call<string>('mark_room_read', { p_room_id: roomId });

  if (!res.ok) return res;

  return { ok: true, data: String(res.data ?? '') };
}

/** 방 멤버들의 마지막 읽은 시각을 읽어온다 */
export async function fetchRoomReadState(
  roomId: string
): Promise<Result<RoomReadPointer[]>> {
  const res = await call<unknown>('get_room_read_state', { p_room_id: roomId });

  if (!res.ok) return res;

  return {
    ok: true,
    data: ((res.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      nickname: String(row.nickname ?? ''),
      last_read_at: row.last_read_at ? String(row.last_read_at) : null,
    })),
  };
}

export async function renameRoom(
  roomId: string,
  name: string
): Promise<Result<string>> {
  const res = await call<string>('rename_chat_room', {
    p_room_id: roomId,
    p_name: name.trim(),
  });

  if (!res.ok) return res;

  return { ok: true, data: String(res.data ?? name.trim()) };
}

/**
 * 비밀번호를 넘기면 비공개(restricted)로 전환/변경,
 * null 을 넘기면 비밀번호를 해제하고 공개(public)로 전환한다.
 */
export async function updateRoomSecurity(
  roomId: string,
  password: string | null
): Promise<Result<RoomVisibility>> {
  const res = await call<string>('update_room_security', {
    p_room_id: roomId,
    p_password: password,
  });

  if (!res.ok) return res;

  return {
    ok: true,
    data: res.data === 'restricted' ? 'restricted' : 'public',
  };
}

/** 최신 방 이름/공개 여부를 다시 읽어온다 (다른 사람이 방 이름을 바꿨을 때) */
export async function refreshRoom(code: string): Promise<RoomSummary | null> {
  try {
    return await findRoomByCode(code);
  } catch {
    return null;
  }
}

function toSupportMessages(rows: unknown): SupportMessage[] {
  return ((rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    sender_nickname: String(row.sender_nickname ?? ''),
    from_admin: row.from_admin === true,
    content: String(row.content ?? ''),
    created_at: String(row.created_at),
  }));
}

/** 내 문의 대화 (after 를 주면 그 이후의 새 메시지만) */
export async function getMySupportMessages(
  after?: string
): Promise<Result<SupportMessage[]>> {
  const res = await call<unknown>('support_get_my_messages', {
    p_after: after ?? null,
  });

  if (!res.ok) return res;

  return { ok: true, data: toSupportMessages(res.data) };
}

export async function sendSupportMessage(
  content: string
): Promise<Result<null>> {
  const res = await call<unknown>('support_send_message', {
    p_content: content,
  });

  if (!res.ok) return res;

  return { ok: true, data: null };
}

export async function adminListSupportThreads(): Promise<
  Result<SupportThreadRow[]>
> {
  const res = await call<unknown>('admin_support_threads');

  if (!res.ok) return res;

  return {
    ok: true,
    data: ((res.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      user_nickname: String(row.user_nickname ?? ''),
      message_count: Number(row.message_count ?? 0),
      last_message_at: row.last_message_at ? String(row.last_message_at) : null,
      last_sender: row.last_sender ? String(row.last_sender) : null,
      last_from_admin: row.last_from_admin === true,
    })),
  };
}

export async function adminGetSupportMessages(
  user: string,
  after?: string
): Promise<Result<SupportMessage[]>> {
  const res = await call<unknown>('admin_support_get_messages', {
    p_user: user,
    p_after: after ?? null,
  });

  if (!res.ok) return res;

  return { ok: true, data: toSupportMessages(res.data) };
}

export async function adminReplySupport(
  user: string,
  content: string
): Promise<Result<null>> {
  const res = await call<unknown>('admin_support_reply', {
    p_user: user,
    p_content: content,
  });

  if (!res.ok) return res;

  return { ok: true, data: null };
}

export async function adminListAllRooms(): Promise<Result<AdminRoomRow[]>> {
  const res = await call<unknown>('list_admin_rooms');

  if (!res.ok) return res;

  return {
    ok: true,
    data: ((res.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      code: String(row.code ?? ''),
      name: String(row.name ?? ''),
      visibility: row.visibility === 'restricted' ? 'restricted' : 'public',
      owner_nickname: String(row.owner_nickname ?? ''),
      member_count: Number(row.member_count ?? 0),
      message_count: Number(row.message_count ?? 0),
    })),
  };
}
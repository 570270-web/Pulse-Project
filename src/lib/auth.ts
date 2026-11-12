import { supabase, getToken, clearToken } from './supabase';
 
export async function editMessage(
  messageId: string,
  content: string
): Promise<{ ok: boolean; error?: string }> {
  const token = getToken();
 
  if (!token) {
    return { ok: false, error: 'Session expired. Please log in again.' };
  }
 
  const { error } = await supabase.rpc('edit_message', {
    p_token: token,
    p_message_id: messageId,
    p_content: content,
  });
 
  if (error) {
    return { ok: false, error: error.message };
  }
 
  return { ok: true };
}
 
export async function deleteMessage(
  messageId: string
): Promise<{ ok: boolean; error?: string }> {
  const token = getToken();
 
  if (!token) {
    return { ok: false, error: 'Session expired. Please log in again.' };
  }
 
  const { error } = await supabase.rpc('delete_message', {
    p_token: token,
    p_message_id: messageId,
  });
 
  if (error) {
    return { ok: false, error: error.message };
  }
 
  return { ok: true };
}
 
export type AuthResult =
  | { ok: true; token: string }
  | { ok: false; error: string };
 
export type NicknameStatus =
  | { status: 'available' }
  | { status: 'taken' }
  | { status: 'error'; message: string };
 
export type PasswordResult =
  | { ok: true }
  | { ok: false; error: string };
 
export type AdminProfile = {
  id: string;
  nickname: string;
  last_active_at: string;
  created_at: string;
  is_admin: boolean;
};
 
export type RoomVisibility = 'public' | 'restricted';
 
export type RoomSummary = {
  id: string;
  room_id?: string;
  code: string;
  name: string;
  visibility: RoomVisibility;
  role?: 'owner' | 'co_admin' | 'member' | 'admin';
  joined_at?: string;
};
 
function parseError(message: string): string {
  const normalized = message.toUpperCase();
 
  if (normalized.includes('NOT_ROOM_MEMBER')) {
    return 'You are not a member of this room.';
  }
  if (normalized.includes('INVALID_CURRENT_PASSWORD')) {
    return 'Incorrect current password.';
  }
  if (normalized.includes('PASSWORD_TOO_SHORT')) {
    return 'Password must be at least 4 characters long.';
  }
  if (normalized.includes('NICKNAME_NOT_FOUND')) {
    return 'Nickname not found.';
  }
  if (normalized.includes('DEVICE_BANNED')) {
    return 'This device has been blocked by an administrator.';
  }
  if (normalized.includes('CANNOT_BAN_ADMIN')) {
    return 'Administrator accounts cannot be blocked.';
  }
  if (normalized.includes('CANNOT_BAN_SELF')) {
    return 'You cannot block your own account.';
  }
  if (normalized.includes('NOT_ADMIN')) {
    return 'Administrator permission required.';
  }
  if (normalized.includes('NICKNAME_TAKEN')) {
    return 'This nickname is already taken.';
  }
 
  // Check the length error first because its name also contains
  // "INVALID_ROOM_PASSWORD".
  if (normalized.includes('INVALID_ROOM_PASSWORD_LENGTH')) {
    return 'Room password must be 4–128 characters long.';
  }
  if (normalized.includes('INVALID_ROOM_PASSWORD')) {
    return 'Incorrect room password.';
  }
  if (normalized.includes('ROOM_NOT_FOUND')) {
    return 'Room not found.';
  }
  if (normalized.includes('ROOM_NOT_READY')) {
    return 'This room is not ready yet.';
  }
  if (
    normalized.includes('ROOM_ALREADY_PENDING') ||
    normalized.includes('PENDING_REQUEST_EXISTS')
  ) {
    return 'You already have a pending room request.';
  }
  if (normalized.includes('REQUEST_NOT_FOUND')) {
    return 'Room request not found.';
  }
  if (normalized.includes('REQUEST_ALREADY_PROCESSED')) {
    return 'This request has already been processed.';
  }
  if (normalized.includes('MESSAGE_NOT_FOUND')) {
    return 'Message not found.';
  }
  if (normalized.includes('MESSAGE_NOT_OWNED')) {
    return 'You can only edit or delete your own messages.';
  }
  if (normalized.includes('MESSAGE_DELETED')) {
    return 'This message has already been deleted.';
  }
  if (normalized.includes('OWNER_CANNOT_LEAVE')) {
    return 'Room owners cannot leave. Delete the room instead.';
  }
  if (normalized.includes('ROOM_PERMISSION_DENIED')) {
    return 'You do not have permission to do this.';
  }
  if (
    normalized.includes('ADMIN_REQUIRED') ||
    normalized.includes('NOT_ADMIN')
  ) {
    return 'Administrator permission required.';
  }
  if (normalized.includes('INVALID_ROOM_NAME')) {
    return 'Room name must be 2–40 characters long.';
  }
  if (normalized.includes('INVALID_VISIBILITY')) {
    return 'Invalid room type.';
  }
  if (normalized.includes('INVALID_MESSAGE_CONTENT')) {
    return 'Message cannot be empty.';
  }
  if (normalized.includes('INVALID_PASSWORD')) {
    return 'Incorrect password.';
  }
  if (normalized.includes('INVALID_SESSION')) {
    return 'Session expired. Please log in again.';
  }
 
  // 개발 중에는 실제 오류를 숨기지 않는다.
  return message || 'Unknown error.';
}
 
export async function checkNickname(
  nickname: string
): Promise<NicknameStatus> {
  const { data, error } = await supabase.rpc('check_nickname', {
    p_nickname: nickname,
  });
 
  if (error) {
    return { status: 'error', message: error.message };
  }
 
  return data ? { status: 'taken' } : { status: 'available' };
}
 
export async function registerNickname(
  nickname: string,
  password: string
): Promise<AuthResult> {
  const { data, error } = await supabase.rpc('register_nickname', {
    p_nickname: nickname,
    p_password: password,
  });
 
  if (error) {
    return { ok: false, error: parseError(error.message) };
  }
 
  return { ok: true, token: data as string };
}
 
export async function loginNickname(
  nickname: string,
  password: string
): Promise<AuthResult> {
  const { data, error } = await supabase.rpc('login_nickname', {
    p_nickname: nickname,
    p_password: password,
  });
 
  if (error) {
    return { ok: false, error: parseError(error.message) };
  }
 
  return { ok: true, token: data as string };
}
 
export async function getSessionNickname(
  token: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_session_profile', {
    p_token: token,
  });
 
  if (error || !data || (data as unknown[]).length === 0) {
    return null;
  }
 
  const first = (data as unknown[])[0];
 
  if (typeof first === 'string') return first;
 
  if (first && typeof first === 'object' && 'nickname' in first) {
    return (first as { nickname: string }).nickname;
  }
 
  return null;
}
 
export async function checkIsAdmin(token: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('check_is_admin', {
    p_token: token,
  });
 
  if (error || !data || (data as unknown[]).length === 0) {
    return false;
  }
 
  const first = (data as unknown[])[0];
 
  if (first && typeof first === 'object' && 'is_admin' in first) {
    return (first as { is_admin: boolean }).is_admin === true;
  }
 
  if (typeof first === 'boolean') return first;
 
  return false;
}
 
export async function listAllProfiles(): Promise<AdminProfile[]> {
  const token = getToken();
  if (!token) return [];
 
  const { data, error } = await supabase.rpc('list_all_profiles', {
    p_token: token,
  });
 
  if (error || !data) return [];
 
  return data as AdminProfile[];
}
 
export async function deleteProfile(nickname: string): Promise<boolean> {
  const token = getToken();
  if (!token) return false;
 
  const { error } = await supabase.rpc('delete_profile', {
    p_token: token,
    p_nickname: nickname,
  });
 
  return !error;
}
 
export type AccountDevice = {
  device_id: string;
  user_agent: string | null;
  fingerprint: string | null;
  first_seen_at: string;
  last_seen_at: string;
  banned: boolean;
  /** 같은 기기를 쓰는 다른 계정 수 */
  other_accounts: number;
};

export type DeviceBan = {
  device_id: string;
  nickname: string | null;
  user_agent: string | null;
  fingerprint: string | null;
  reason: string | null;
  banned_by: string | null;
  created_at: string;
};

/** 관리자: 한 계정이 접속한 기기 목록 (밴 여부 포함) */
export async function listAccountDevices(
  nickname: string
): Promise<AccountDevice[]> {
  const token = getToken();
  if (!token) return [];

  const { data, error } = await supabase.rpc('admin_list_account_devices', {
    p_token: token,
    p_nickname: nickname,
  });

  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map((row) => ({
    device_id: String(row.device_id ?? ''),
    user_agent: row.user_agent == null ? null : String(row.user_agent),
    fingerprint:
      row.fingerprint == null ? null : String(row.fingerprint),
    first_seen_at: String(row.first_seen_at ?? ''),
    last_seen_at: String(row.last_seen_at ?? ''),
    banned: row.banned === true,
    other_accounts: Number(row.other_accounts ?? 0),
  }));
}

/** 관리자: 계정이 쓴 모든 기기를 차단 (차단된 기기 수 반환) */
export async function banAccountDevices(
  nickname: string,
  reason: string
): Promise<{ ok: boolean; count?: number; error?: string }> {
  const token = getToken();
  if (!token) {
    return { ok: false, error: 'Session expired. Please log in again.' };
  }

  const { data, error } = await supabase.rpc('admin_ban_account_devices', {
    p_token: token,
    p_nickname: nickname,
    p_reason: reason.trim() ? reason.trim() : null,
  });

  if (error) {
    return { ok: false, error: parseError(error.message) };
  }

  return { ok: true, count: Number(data ?? 0) };
}

/** 관리자: 현재 기기 차단 목록 */
export async function listDeviceBans(): Promise<DeviceBan[]> {
  const token = getToken();
  if (!token) return [];

  const { data, error } = await supabase.rpc('admin_list_device_bans', {
    p_token: token,
  });

  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map((row) => ({
    device_id: String(row.device_id ?? ''),
    nickname: row.nickname == null ? null : String(row.nickname),
    user_agent: row.user_agent == null ? null : String(row.user_agent),
    fingerprint:
      row.fingerprint == null ? null : String(row.fingerprint),
    reason: row.reason == null ? null : String(row.reason),
    banned_by: row.banned_by == null ? null : String(row.banned_by),
    created_at: String(row.created_at ?? ''),
  }));
}

/** 관리자: 기기 하나 차단 해제 */
export async function unbanDevice(deviceId: string): Promise<boolean> {
  const token = getToken();
  if (!token) return false;

  const { error } = await supabase.rpc('admin_unban_device', {
    p_token: token,
    p_device_id: deviceId,
  });

  return !error;
}

export async function clearAllMessages(): Promise<boolean> {
  const token = getToken();
  if (!token) return false;
 
  const { error } = await supabase.rpc('clear_all_messages', {
    p_token: token,
  });
 
  return !error;
}
 
export async function sendMessage(
  content: string,
  roomId: string | null = null,
  replyToId: string | null = null
): Promise<boolean> {
  const token = getToken();
  if (!token) return false;
 
  const { error } = await supabase.rpc('send_message', {
    p_token: token,
    p_content: content,
    p_room_id: roomId,
    p_reply_to_id: replyToId,
  });
 
  return !error;
}
 
export async function logout(): Promise<void> {
  const token = getToken();
 
  if (token) {
    await supabase.rpc('logout', { p_token: token });
  }
 
  clearToken();
}
 
/** Change the current user's password. */
export async function changeAccountPassword(
  currentPassword: string,
  newPassword: string
): Promise<PasswordResult> {
  const token = getToken();
 
  if (!token) {
    return {
      ok: false,
      error: 'Session expired. Please log in again.',
    };
  }
 
  const { error } = await supabase.rpc('change_account_password', {
    p_token: token,
    p_current_password: currentPassword,
    p_new_password: newPassword,
  });
 
  if (error) {
    return { ok: false, error: parseError(error.message) };
  }
 
  return { ok: true };
}
 
/** Site admin resets another user's password. */
export async function adminResetAccountPassword(
  nickname: string,
  newPassword: string
): Promise<PasswordResult> {
  const token = getToken();
 
  if (!token) {
    return {
      ok: false,
      error: 'Session expired. Please log in again.',
    };
  }
 
  const { error } = await supabase.rpc('admin_reset_account_password', {
    p_token: token,
    p_target_nickname: nickname.trim(),
    p_new_password: newPassword,
  });
 
  if (error) {
    return { ok: false, error: parseError(error.message) };
  }
 
  return { ok: true };
}
 
export async function getJoinedRooms(): Promise<RoomSummary[]> {
  const token = getToken();
  if (!token) return [];
 
  const { data, error } = await supabase.rpc('get_joined_rooms', {
    p_token: token,
  });
 
  if (error || !data) return [];
 
  return (
    data as Array<{
      room_id: string;
      code: string;
      name: string;
      visibility: RoomVisibility;
      role: RoomSummary['role'];
      joined_at: string;
    }>
  ).map((room) => ({
    ...room,
    id: room.room_id,
  }));
}
 
export async function listPublicRooms(): Promise<RoomSummary[]> {
  const token = getToken();
  if (!token) return [];
 
  const { data, error } = await supabase.rpc('list_public_rooms', {
    p_token: token,
  });
 
  if (error || !data) return [];
 
  return (data as Array<Record<string, unknown>>).map((item) => {
    const roomId = String(item.id ?? item.room_id ?? '');
 
    return {
      id: roomId,
      room_id: roomId,
      code: String(item.code ?? ''),
      name: String(item.name ?? ''),
      visibility: item.visibility === 'restricted' ? 'restricted' : 'public',
      role: item.role as RoomSummary['role'],
    };
  });
}
 
export async function findRoomByCode(
  code: string
): Promise<RoomSummary | null> {
  const token = getToken();
  if (!token) return null;
 
  const { data, error } = await supabase.rpc('find_room_by_code', {
    p_token: token,
    p_code: code.trim(),
  });
 
  if (error || !data) return null;
 
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) return null;
 
  const item = result as Record<string, unknown>;
  const id = String(item.id ?? item.room_id ?? '');
 
  return {
    id,
    room_id: id,
    code: String(item.code ?? ''),
    name: String(item.name ?? ''),
    visibility: item.visibility === 'restricted' ? 'restricted' : 'public',
    role: item.role as RoomSummary['role'],
  };
}
 
export async function joinRoom(
  code: string,
  password?: string
): Promise<{ ok: boolean; room?: RoomSummary; error?: string }> {
  const token = getToken();
 
  if (!token) {
    return {
      ok: false,
      error: 'Session expired. Please log in again.',
    };
  }
 
  const { data, error } = await supabase.rpc('join_room', {
    p_token: token,
    p_room_code: code.trim(),
    p_room_password: password ?? null,
  });
 
  if (error) {
    console.error('[join_room RPC error]', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
 
    return {
      ok: false,
      error: parseError(error.message),
    };
  }
 
  const result = Array.isArray(data) ? data[0] : data;
 
  if (!result || typeof result !== 'object') {
    console.error('[join_room] Unexpected response:', data);
 
    return {
      ok: false,
      error: 'The server returned no room information.',
    };
  }
 
  const item = result as Record<string, unknown>;
  const id = String(item.id ?? item.room_id ?? '');
 
  if (!id) {
    console.error('[join_room] Room ID is missing:', data);
 
    return {
      ok: false,
      error: 'The server returned room information without a room ID.',
    };
  }
 
  const room: RoomSummary = {
    id,
    room_id: id,
    code: String(item.code ?? code.trim()),
    name: String(item.name ?? ''),
    visibility:
      item.visibility === 'restricted' ? 'restricted' : 'public',
    role: item.role as RoomSummary['role'],
  };
 
  if (!room.name) {
    console.error('[join_room] Room name is missing:', data);
 
    return {
      ok: false,
      error: 'The server returned incomplete room information.',
    };
  }
 
  return {
    ok: true,
    room,
  };
}
 
/**
 * Returns whether a restricted room already has a password.
 * The current Supabase RPC allows the room owner and site admins.
 */
export async function getRoomPasswordStatus(
  roomId: string
): Promise<{ ok: boolean; isSet?: boolean; error?: string }> {
  const token = getToken();
 
  if (!token) {
    return { ok: false, error: 'Session expired. Please log in again.' };
  }
 
  const { data, error } = await supabase.rpc('get_room_password_status', {
    p_token: token,
    p_room_id: roomId,
  });
 
  if (error) {
    return { ok: false, error: parseError(error.message) };
  }
 
  return { ok: true, isSet: data === true };
}
 
/**
 * Sets or changes a restricted room's password.
 * Supabase enforces the room-owner/co-admin/site-admin permission check.
 */
export async function changeRoomPassword(
  roomId: string,
  newPassword: string
): Promise<PasswordResult> {
  const token = getToken();
 
  if (!token) {
    return {
      ok: false,
      error: 'Session expired. Please log in again.',
    };
  }
 
  const { error } = await supabase.rpc('change_room_password', {
    p_token: token,
    p_room_id: roomId,
    p_new_password: newPassword,
  });
 
  if (error) {
    return { ok: false, error: parseError(error.message) };
  }
 
  return { ok: true };
}
 
export async function requestRoomCreation(
  name: string,
  visibility: RoomVisibility
): Promise<{ ok: boolean; error?: string }> {
  const token = getToken();
 
  if (!token) {
    return {
      ok: false,
      error: 'Session expired. Please log in again.',
    };
  }
 
  const { error } = await supabase.rpc('request_room_creation', {
    p_token: token,
    p_room_name: name.trim(),
    p_visibility: visibility,
  });
 
  if (error) {
    return { ok: false, error: parseError(error.message) };
  }
 
  return { ok: true };
}
 
export type LeaveRoomResult =
  | { ok: true; result: 'left' | 'room_deleted' | 'admin' }
  | { ok: false; error: string };
 
export async function leaveRoom(
  roomId: string
): Promise<LeaveRoomResult> {
  const token = getToken();
 
  if (!token) {
    return {
      ok: false,
      error: 'Session expired. Please log in again.',
    };
  }
 
  const { data, error } = await supabase.rpc('leave_room', {
    p_token: token,
    p_room_id: roomId,
  });
 
  if (error) {
    console.error('[leave_room RPC error]', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
 
    return {
      ok: false,
      error: parseError(error.message),
    };
  }
 
  if (data !== 'left' && data !== 'room_deleted' && data !== 'admin') {
    console.error('[leave_room] Unexpected response:', data);
 
    return {
      ok: false,
      error: 'The server returned an unexpected response.',
    };
  }
 
  return { ok: true, result: data };
}
 
export type Announcement = {
  id: string;
  title: string;
  body: string;
  starts_at: string;
  ends_at: string;
};
 
export type AdminAnnouncement = Announcement & {
  created_at: string;
  updated_at: string;
};
 
export async function getUnreadAnnouncements(): Promise<Announcement[]> {
  const token = getToken();
  if (!token) return [];
 
  const { data, error } = await supabase.rpc(
    'get_unread_announcements',
    { p_token: token }
  );
 
  if (error) throw error;
  return (data ?? []) as Announcement[];
}
 
export async function markAnnouncementRead(
  announcementId: string
): Promise<void> {
  const token = getToken();
  if (!token) throw new Error('Session expired. Please log in again.');
 
  const { data, error } = await supabase.rpc(
    'mark_announcement_read',
    {
      p_token: token,
      p_announcement_id: announcementId,
    }
  );
 
  if (error) throw error;
  if (data !== true) throw new Error('Could not mark announcement as read.');
}
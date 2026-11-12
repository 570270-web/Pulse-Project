import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Shield,
  Trash2,
  LogOut,
  Search,
  Users,
  Loader2,
  AlertTriangle,
  X,
  KeyRound,
  MessagesSquare,
  DoorOpen,
  Eye,
  RefreshCw,
  Check,
  Ban,
  LockKeyhole,
  Globe,
  Clock,
  LayoutDashboard,
  MessageSquareX,
  Copy,
  Sun,
  Moon,
  LogIn,
  Inbox,
} from 'lucide-react';
 
import {
  listAllProfiles,
  deleteProfile,
  logout,
  adminResetAccountPassword,
  listAccountDevices,
  banAccountDevices,
  listDeviceBans,
  unbanDevice,
  type AccountDevice,
  type AdminProfile,
  type DeviceBan,
  type RoomSummary,
} from '@/lib/auth';
import { adminListSupportThreads, type SupportThreadRow } from '@/lib/rooms';
import SupportChat from '@/components/SupportChat';
 
import { supabase, getToken, clearToken } from '@/lib/supabase';
import AnnouncementManager from '@/components/AnnouncementManager';
import SupportInbox, { needsReply } from '@/components/AdminInbox';
 
type Props = {
  nickname: string;
  onLogout: () => void;
  /** 관리자로 방에 들어가서 직접 대화에 참여 */
  onEnterRoom: (room: RoomSummary) => void;
  /** false 이면 화면만 숨겨둔 상태 (방에 들어가 있는 동안) */
  active?: boolean;
};
 
type Tab = 'users' | 'rooms' | 'support' | 'ipbans' | 'announcements';
type RoomSection = 'rooms' | 'requests';
 
type AdminRoom = RoomSummary & {
  created_at?: string;
  created_by?: string;
  owner_nickname?: string;
  member_count?: number;
  message_count?: number;
  password_set?: boolean;
};
 
type RoomRequest = {
  id: string;
  requester_nickname: string;
  room_name: string;
  visibility: 'public' | 'restricted';
  status: string;
  created_at: string;
  room_id?: string | null;
};
 
type RoomMessage = {
  id: string;
  message_id: string;
  version_number: number;
  nickname: string;
  content: string;
  message_created_at: string;
  recorded_at: string;
  deleted: boolean;
  is_current: boolean;
  is_system: boolean;
  editor_nickname: string;
};
 
type ConfirmAction =
  | { type: 'delete-user'; nickname: string }
  | { type: 'delete-room'; room: AdminRoom }
  | { type: 'clear-room'; room: AdminRoom }
  | { type: 'approve-request'; request: RoomRequest }
  | { type: 'reject-request'; request: RoomRequest }
  | null;
 
type Result = {
  ok: boolean;
  error?: string;
};
 
const panelClass =
  'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70';
 
const buttonClass =
  'inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50';
 
/** 회색 보조 버튼 (라이트/다크 모두 읽히도록) */
const neutralButton =
  'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700';
 
/** 검색 입력창 */
const searchInputClass =
  'w-full rounded-xl border border-slate-300 bg-slate-50 py-3 pl-11 pr-4 text-slate-900 placeholder:text-slate-500 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800/60 dark:text-white';
 
function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String(error.message);
 
    if (message.includes('INVALID_SESSION')) {
      return 'Session expired. Please log in again.';
    }
    if (message.includes('NOT_ADMIN')) {
      return 'Administrator permission required.';
    }
    if (message.includes('ROOM_NOT_FOUND')) {
      return 'Room not found. Refresh the room list.';
    }
    if (message.includes('PASSWORD_TOO_SHORT')) {
      return 'Password must be at least 4 characters long.';
    }
 
    return message;
  }
 
  return 'Something went wrong. Please try again.';
}
 
function getRowString(
  row: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined) {
      return String(value);
    }
  }
 
  return '';
}
 
function renderMessageContent(content: string) {
  const urlPattern = /(https?:\/\/[^\s]+)/gi;
 
  return content.split(urlPattern).map((part, index) => {
    if (/^https?:\/\//i.test(part)) {
      return (
        <a
          key={`url-${index}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-sky-600 underline decoration-sky-500/50 underline-offset-2 hover:text-sky-500 dark:text-sky-400 dark:hover:text-sky-300"
        >
          {part}
        </a>
      );
    }
 
    return <span key={`text-${index}`}>{part}</span>;
  });
}
 
function normalizeRoom(row: Record<string, unknown>): AdminRoom {
  const id = getRowString(row, 'id', 'room_id');
 
  return {
    id,
    room_id: id,
    code: getRowString(row, 'code', 'room_code'),
    name: getRowString(row, 'name', 'room_name') || 'Unnamed room',
    visibility:
      row.visibility === 'restricted' ? 'restricted' : 'public',
    role: 'admin',
    created_at: getRowString(row, 'created_at') || undefined,
    created_by: getRowString(row, 'created_by') || undefined,
    owner_nickname:
      getRowString(row, 'owner_nickname', 'creator_nickname', 'owner') ||
      undefined,
    member_count: Number(row.member_count ?? 0),
    message_count: Number(row.message_count ?? 0),
    password_set:
      typeof row.password_set === 'boolean'
        ? row.password_set
        : undefined,
  };
}
 
function normalizeRequest(
  row: Record<string, unknown>
): RoomRequest {
  return {
    id: getRowString(row, 'id', 'request_id'),
    requester_nickname: getRowString(
      row,
      'requester_nickname',
      'nickname',
      'requester'
    ),
    room_name: getRowString(row, 'room_name', 'name'),
    visibility:
      row.visibility === 'restricted' ? 'restricted' : 'public',
    status: getRowString(row, 'status') || 'pending',
    created_at: getRowString(row, 'created_at'),
    room_id:
      row.room_id == null ? null : String(row.room_id),
  };
}
 
export default function AdminScreen({
  nickname,
  onLogout,
  onEnterRoom,
  active = true,
}: Props) {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'dark';
    return localStorage.getItem('pulse_theme') === 'light' ? 'light' : 'dark';
  });
  const [tab, setTab] = useState<Tab>('users');
  const [roomSection, setRoomSection] = useState<RoomSection>('rooms');
 
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [requests, setRequests] = useState<RoomRequest[]>([]);
  const [supportRooms, setSupportRooms] = useState<SupportThreadRow[]>([])
  const [openThread, setOpenThread] = useState<string | null>(null);
 
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [loadingSupport, setLoadingSupport] = useState(true);
 
  const [search, setSearch] = useState('');
  const [roomSearch, setRoomSearch] = useState('');
 
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [confirmAction, setConfirmAction] =
    useState<ConfirmAction>(null);

  // 기기 차단: 계정별 기기 목록 + 전체 차단 목록
  const [deviceBans, setDeviceBans] = useState<DeviceBan[]>([]);
  const [loadingBans, setLoadingBans] = useState(true);
  const [banTarget, setBanTarget] = useState<string | null>(null);
  const [banDevices, setBanDevices] = useState<AccountDevice[]>([]);
  const [banDevicesLoading, setBanDevicesLoading] = useState(false);
  const [banReason, setBanReason] = useState('');
  const [banBusy, setBanBusy] = useState(false);
 
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);
 
  const [passwordRoom, setPasswordRoom] = useState<AdminRoom | null>(null);
  const [roomPassword, setRoomPassword] = useState('');
  const [savingRoomPassword, setSavingRoomPassword] = useState(false);
 
  const [watchRoom, setWatchRoom] = useState<AdminRoom | null>(null);
  const [watchMessages, setWatchMessages] = useState<RoomMessage[]>([]);
  const [watchLoading, setWatchLoading] = useState(false);
  const [watchError, setWatchError] = useState('');
 
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('pulse_theme', theme);
  }, [theme]);
 
  const clearNotices = () => {
    setError('');
    setSuccess('');
  };
 
  const loadProfiles = useCallback(async () => {
    setLoadingUsers(true);
 
    try {
      const data = await listAllProfiles();
      setProfiles(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoadingUsers(false);
    }
  }, []);
 
  const loadRooms = useCallback(async () => {
    const currentToken = getToken();
 
    if (!currentToken) {
      setError('Session expired. Please log in again.');
      setLoadingRooms(false);
      return;
    }
 
    setLoadingRooms(true);
 
    try {
      // Requires an administrator-only list_admin_rooms RPC.
      const { data, error: rpcError } = await supabase.rpc(
        'list_admin_rooms',
        { p_token: currentToken }
      );
 
      if (rpcError) throw rpcError;
 
      setRooms(
        ((data ?? []) as Array<Record<string, unknown>>).map(
          normalizeRoom
        )
      );
    } catch (err) {
      setRooms([]);
      setError(
        `Could not load rooms: ${getErrorMessage(err)}`
      );
    } finally {
      setLoadingRooms(false);
    }
  }, []);
 
  /** 승인/거절이 끝난 요청은 목록에서 빼고, 대기 중인 요청만 보여준다 */
  const loadRequests = useCallback(async () => {
    const currentToken = getToken();
 
    if (!currentToken) {
      setError('Session expired. Please log in again.');
      setLoadingRequests(false);
      return;
    }
 
    setLoadingRequests(true);
 
    try {
      const { data, error: rpcError } = await supabase.rpc(
        'admin_list_room_requests',
        { p_token: currentToken }
      );
 
      if (rpcError) throw rpcError;
 
      setRequests(
        ((data ?? []) as Array<Record<string, unknown>>)
          .map(normalizeRequest)
          .filter((request) => request.status === 'pending')
      );
    } catch (err) {
      setRequests([]);
      setError(
        `Could not load room requests: ${getErrorMessage(err)}`
      );
    } finally {
      setLoadingRequests(false);
    }
  }, []);
 
  const loadSupport = useCallback(async () => {
    setLoadingSupport(true);
 
    const res = await adminListSupportThreads();
 
    if (res.ok) {
      setSupportRooms(res.data);
    } else {
      setError(`Could not load inquiries: ${res.error}`);
    }
 
        setLoadingSupport(false);
  }, []);

  const loadDeviceBans = useCallback(async () => {
    setLoadingBans(true);

    try {
      setDeviceBans(await listDeviceBans());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoadingBans(false);
    }
  }, []);

  // 관리자 화면에 들어오면 전부 한 번씩 먼저 불러온다
  // (카운트와 배지가 각 탭에 들어가기 전에도 정확히 보이도록)
  useEffect(() => {
    void loadProfiles();
    void loadRooms();
    void loadRequests();
    void loadSupport();
    void loadDeviceBans();
  }, [loadProfiles, loadRooms, loadRequests, loadSupport, loadDeviceBans]);
 
  // 방에서 돌아오면 화면은 그대로 보여주고, 뒤에서 조용히 새로고침한다
  const wasActive = useRef(true);
 
  useEffect(() => {
    if (active && !wasActive.current) {
      setTheme(localStorage.getItem('pulse_theme') === 'light' ? 'light' : 'dark');
      void loadProfiles();
      void loadRooms();
      void loadRequests();
            void loadSupport();
      void loadDeviceBans();
    }

    wasActive.current = active;
  }, [
    active,
    loadProfiles,
    loadRooms,
    loadRequests,
    loadSupport,
    loadDeviceBans,
  ]);
 
  // 문의 배지는 가끔 새로 읽는다
  useEffect(() => {
    const timer = window.setInterval(() => void loadSupport(), 60_000);
 
    return () => window.clearInterval(timer);
  }, [loadSupport]);
 
  useEffect(() => {
    if (!success) return;
 
    const timer = window.setTimeout(() => setSuccess(''), 3500);
    return () => window.clearTimeout(timer);
  }, [success]);
 
  const filteredProfiles = useMemo(() => {
    const query = search.trim().toLowerCase();
 
    return profiles.filter((profile) =>
      profile.nickname.toLowerCase().includes(query)
    );
  }, [profiles, search]);
 
  const filteredRooms = useMemo(() => {
    const query = roomSearch.trim().toLowerCase();
 
    return rooms.filter((room) =>
      [
        room.name,
        room.code,
        room.owner_nickname ?? '',
        room.visibility,
      ].some((value) => value.toLowerCase().includes(query))
    );
  }, [rooms, roomSearch]);
 
  const waitingSupportCount = useMemo(
    () => supportRooms.filter(needsReply).length,
    [supportRooms]
  );
 
  const formatDate = (iso?: string) => {
    if (!iso) return 'Unknown';
 
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'Unknown';
 
    return date.toLocaleDateString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };
 
  const formatRelative = (iso?: string) => {
    if (!iso) return 'Unknown';
 
    const timestamp = new Date(iso).getTime();
    if (Number.isNaN(timestamp)) return 'Unknown';
 
    const mins = Math.floor((Date.now() - timestamp) / 60000);
 
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
 
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
 
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
 
    return `${Math.floor(days / 30)}mo ago`;
  };
 
  const getAvatarColor = (name: string) => {
    const colors = [
      'from-cyan-400 to-blue-500',
      'from-emerald-400 to-teal-500',
      'from-rose-400 to-pink-500',
      'from-amber-400 to-orange-500',
      'from-sky-400 to-indigo-500',
      'from-lime-400 to-green-500',
      'from-fuchsia-400 to-pink-500',
    ];
 
    let hash = 0;
 
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
 
    return colors[Math.abs(hash) % colors.length];
  };
 
  const handleLogout = async () => {
    await logout();
    clearToken();
    onLogout();
  };
 
  const enterAsAdmin = (room: AdminRoom) => {
    onEnterRoom({
      id: room.id,
      room_id: room.id,
      code: room.code,
      name: room.name,
      visibility: room.visibility,
      role: 'admin',
    });
  };
 
  const openSupportThread = (row: SupportThreadRow) => {
    setOpenThread(row.user_nickname);
  };
 
  const openBanModal = async (target: string) => {
    clearNotices();
    setBanTarget(target);
    setBanReason('');
    setBanDevices([]);
    setBanDevicesLoading(true);

    try {
      setBanDevices(await listAccountDevices(target));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBanDevicesLoading(false);
    }
  };

  const closeBanModal = () => {
    setBanTarget(null);
    setBanReason('');
    setBanDevices([]);
  };

  const handleBanAccount = async () => {
    if (!banTarget || banBusy) return;

    setBanBusy(true);
    clearNotices();

    try {
      const result = await banAccountDevices(banTarget, banReason);

      if (!result.ok) {
        setError(result.error ?? 'Failed to block this account.');
        return;
      }

      if (!result.count) {
        setError(
          `No device was recorded for "${banTarget}" yet. One is added on the next login.`
        );
        return;
      }

      closeBanModal();
      setSuccess(
        `Blocked ${result.count} device${
          result.count === 1 ? '' : 's'
        } used by "${banTarget}".`
      );
      await loadDeviceBans();
      await loadProfiles();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBanBusy(false);
    }
  };

  const handleUnban = async (deviceId: string) => {
    clearNotices();

    const ok = await unbanDevice(deviceId);

    if (!ok) {
      setError('Could not unblock this device.');
      return;
    }

    setSuccess(`Unblocked device ${deviceId.slice(0, 12)}…`);
    await loadDeviceBans();
  };

  const handleAccountPasswordReset = async () => {
    if (!resetTarget || resetting) return;
 
    if (newPassword.length < 4) {
      setError('Password must be at least 4 characters long.');
      return;
    }
 
    setResetting(true);
    clearNotices();
 
    try {
      const result = await adminResetAccountPassword(
        resetTarget,
        newPassword
      );
 
      if (!result.ok) {
        setError(result.error);
        return;
      }
 
      setSuccess(`Password reset for "${resetTarget}".`);
      setResetTarget(null);
      setNewPassword('');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setResetting(false);
    }
  };
 
  const runRoomAction = async (
    rpcName: string,
    args: Record<string, unknown>,
    successMessage: string,
    after?: () => Promise<void>
  ): Promise<Result> => {
    const currentToken = getToken();
 
    if (!currentToken) {
      return {
        ok: false,
        error: 'Session expired. Please log in again.',
      };
    }
 
    setActionBusy(true);
    clearNotices();
 
    try {
      const { error: rpcError } = await supabase.rpc(
        rpcName,
        {
          p_token: currentToken,
          ...args,
        } as never
      );
 
      if (rpcError) throw rpcError;
 
      setSuccess(successMessage);
 
      if (after) await after();
 
      return { ok: true };
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
      return { ok: false, error: message };
    } finally {
      setActionBusy(false);
    }
  };
 
  const handleConfirmAction = async () => {
    if (!confirmAction || actionBusy) return;
 
    const action = confirmAction;
 
    if (action.type === 'delete-user') {
      setActionBusy(true);
      clearNotices();
 
      try {
        const ok = await deleteProfile(action.nickname);
 
        if (!ok) {
          setError('Failed to delete account.');
          return;
        }
 
        setConfirmAction(null);
        setSuccess(`Account "${action.nickname}" deleted.`);
        await loadProfiles();
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setActionBusy(false);
      }
 
      return;
    }
 
    let result: Result;
 
    if (action.type === 'delete-room') {
      result = await runRoomAction(
        'admin_delete_room',
        { p_room_id: action.room.id },
        `Room "${action.room.name}" deleted.`,
        loadRooms
      );
    } else if (action.type === 'clear-room') {
      // Requires an administrator-only admin_clear_room_messages RPC.
      result = await runRoomAction(
        'admin_clear_room_messages',
        { p_room_id: action.room.id },
        `Messages in "${action.room.name}" deleted.`,
        loadRooms
      );
    } else if (action.type === 'approve-request') {
      // 처리된 요청은 목록에서 바로 사라진다 (loadRequests 가 대기 중인 것만 가져옴)
      result = await runRoomAction(
        'approve_room_request',
        { p_request_id: action.request.id },
        `Request for "${action.request.room_name}" approved.`,
        async () => {
          await loadRequests();
          await loadRooms();
        }
      );
    } else {
      result = await runRoomAction(
        'reject_room_request',
        { p_request_id: action.request.id },
        `Request for "${action.request.room_name}" rejected.`,
        loadRequests
      );
    }
 
    if (result.ok) setConfirmAction(null);
  };
 
  const handleRoomPasswordChange = async () => {
    if (!passwordRoom || savingRoomPassword) return;
 
    if (roomPassword.length < 4) {
      setError('Password must be at least 4 characters long.');
      return;
    }
 
    const currentToken = getToken();
 
    if (!currentToken) {
      setError('Session expired. Please log in again.');
      return;
    }
 
    setSavingRoomPassword(true);
    clearNotices();
 
    try {
      const { error: rpcError } = await supabase.rpc(
        'change_room_password',
        {
          p_token: currentToken,
          p_room_id: passwordRoom.id,
          p_new_password: roomPassword,
        }
      );
 
      if (rpcError) throw rpcError;
 
      setSuccess(`Room password updated for "${passwordRoom.name}".`);
      setPasswordRoom(null);
      setRoomPassword('');
      await loadRooms();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSavingRoomPassword(false);
    }
  };
 
  const openSpectator = async (room: AdminRoom) => {
    const currentToken = getToken();
 
    if (!currentToken) {
      setError('Session expired. Please log in again.');
      return;
    }
 
    setWatchRoom(room);
    setWatchMessages([]);
    setWatchError('');
    setWatchLoading(true);
 
    try {
      const { data, error: rpcError } = await supabase.rpc(
        'get_room_message_history',
        {
          p_token: currentToken,
          p_room_id: room.id,
        }
      );
 
      if (rpcError) throw rpcError;
 
      setWatchMessages(
        ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
          id: `${getRowString(row, 'message_id')}:${getRowString(row, 'version_number')}`,
          message_id: getRowString(row, 'message_id'),
          version_number: Number(row.version_number ?? 1),
          nickname: getRowString(row, 'nickname') || 'Unknown',
          content: getRowString(row, 'content'),
          message_created_at: getRowString(row, 'message_created_at'),
          recorded_at: getRowString(row, 'recorded_at'),
          deleted: row.deleted === true,
          is_current: row.is_current === true,
          is_system: row.is_system === true,
          editor_nickname: getRowString(row, 'editor_nickname'),
        }))
      );
    } catch (err) {
      setWatchError(
        `Could not load messages: ${getErrorMessage(err)}`
      );
    } finally {
      setWatchLoading(false);
    }
  };
 
  const copyRoomCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setSuccess(`Room code ${code} copied.`);
      setError('');
    } catch {
      setError('Could not copy the room code.');
    }
  };
 
  const pendingConfirmTitle = () => {
    if (!confirmAction) return '';
 
    switch (confirmAction.type) {
      case 'delete-user':
        return 'Delete account?';
      case 'delete-room':
        return 'Delete room?';
      case 'clear-room':
        return 'Delete room messages?';
      case 'approve-request':
        return 'Approve room request?';
      case 'reject-request':
        return 'Reject room request?';
    }
  };
 
  const pendingConfirmDescription = () => {
    if (!confirmAction) return '';
 
    switch (confirmAction.type) {
      case 'delete-user':
        return `Permanently delete "${confirmAction.nickname}" and its associated account data.`;
      case 'delete-room':
        return `Permanently delete "${confirmAction.room.name}", including its room membership and messages.`;
      case 'clear-room':
        return `Permanently delete messages in "${confirmAction.room.name}". The room itself will remain.`;
      case 'approve-request':
        return `Create "${confirmAction.request.room_name}" and approve the request from ${confirmAction.request.requester_nickname || 'the requester'}.`;
      case 'reject-request':
        return `Reject the request for "${confirmAction.request.room_name}".`;
    }
  };
 
  const tabClass = (key: Tab) =>
    `flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${
      tab === key
        ? 'border-emerald-500 text-emerald-600 dark:border-emerald-400 dark:text-emerald-300'
        : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
    }`;
 
  const sectionButtonClass = (active: boolean) =>
    `${buttonClass} ${
      active
        ? 'bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300'
        : 'bg-slate-100 text-slate-500 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-white'
    }`;
 
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white flex flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-lg shadow-emerald-500/20">
              <Shield className="h-5 w-5" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">
                Admin Panel
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Signed in as {nickname}
              </p>
            </div>
          </div>
 
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
              className={`${buttonClass} ${neutralButton}`}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span className="hidden sm:inline">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </button>
            <button
              onClick={() => void handleLogout()}
              className={`${buttonClass} bg-slate-100 text-slate-600 hover:bg-red-500/10 hover:text-red-500 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-red-400`}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </div>
      </header>
 
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className={`${panelClass} p-4`}>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <Users className="h-4 w-4" />
              Accounts
            </div>
            <p className="text-2xl font-bold">{profiles.length}</p>
          </div>
 
          <div className={`${panelClass} p-4`}>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <Shield className="h-4 w-4" />
              Admins
            </div>
            <p className="text-2xl font-bold">
              {profiles.filter((profile) => profile.is_admin).length}
            </p>
          </div>
 
          <div className={`${panelClass} p-4`}>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <DoorOpen className="h-4 w-4" />
              Rooms
            </div>
            <p className="text-2xl font-bold">{rooms.length}</p>
          </div>
 
          <div className={`${panelClass} p-4`}>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <Clock className="h-4 w-4" />
              Pending requests
            </div>
            <p className="text-2xl font-bold">
              {requests.length}
            </p>
          </div>
        </div>
 
        <div className="mb-6 flex gap-2 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
          <button
            onClick={() => {
              setTab('users');
              clearNotices();
            }}
            className={tabClass('users')}
          >
            <Users className="h-4 w-4" />
            Users
          </button>
 
          <button
            onClick={() => {
              setTab('rooms');
              clearNotices();
            }}
            className={tabClass('rooms')}
          >
            <MessagesSquare className="h-4 w-4" />
            Rooms
            {requests.length > 0 && (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
                {requests.length}
              </span>
            )}
          </button>
 
          <button
            onClick={() => {
              setTab('support');
              clearNotices();
              void loadSupport();
            }}
            className={tabClass('support')}
          >
            <Inbox className="h-4 w-4" />
            Inquiries
            {waitingSupportCount > 0 && (
              <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
                {waitingSupportCount}
              </span>
            )}
          </button>
 
          <button
            onClick={() => {
              setTab('ipbans');
              clearNotices();
              void loadDeviceBans();
            }}
            className={tabClass('ipbans')}
          >
            <Ban className="h-4 w-4" />
            Device bans
            {deviceBans.length > 0 && (
              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-700 dark:text-red-300">
                {deviceBans.length}
              </span>
            )}
          </button>

            <button
              onClick={() => {
                setTab('announcements');
                clearNotices();
              }}
              className={tabClass('announcements')}
            >
              Announcements
            </button>
        </div>
 
        {success && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{success}</span>
          </div>
        )}
 
        {error && (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            <span>{error}</span>
            <button
              onClick={() => setError('')}
              aria-label="Dismiss error"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
 
        {tab === 'announcements' && <AnnouncementManager />}
 
        {tab === 'support' && (
          <SupportInbox
            rows={supportRooms}
            loading={loadingSupport}
            onRefresh={() => void loadSupport()}
            onOpen={openSupportThread}
          />
        )}
 
        {tab === 'users' && (
          <section>
            <div className={`${panelClass} mb-5 p-4`}>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
                  <LayoutDashboard className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
                </div>
                <div>
                  <h2 className="font-semibold">User management</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Search accounts, reset passwords, or remove accounts.
                  </p>
                </div>
                <button
                  onClick={() => void loadProfiles()}
                  disabled={loadingUsers}
                  className={`${buttonClass} ml-auto ${neutralButton}`}
                  title="Refresh accounts"
                >
                  <RefreshCw className={`h-4 w-4 ${loadingUsers ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
              </div>
            </div>
 
            <div className="relative mb-4">
              <Search className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search accounts..."
                className={searchInputClass}
              />
            </div>
 
            {loadingUsers && profiles.length === 0 ? (
              <LoadingState label="Loading accounts..." />
            ) : filteredProfiles.length === 0 ? (
              <EmptyState
                icon={<Users className="h-10 w-10" />}
                title="No accounts found"
                detail="Try a different search."
              />
            ) : (
              <div className="space-y-2">
                {filteredProfiles.map((profile) => (
                  <div
                    key={profile.id}
                    className={`${panelClass} flex items-center justify-between gap-3 p-4 transition hover:border-slate-400 dark:hover:border-slate-700`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${getAvatarColor(profile.nickname)} font-bold text-white`}
                      >
                        {profile.nickname.charAt(0).toUpperCase()}
                      </div>
 
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold">
                            {profile.nickname}
                          </span>
                          {profile.is_admin && (
                            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                              ADMIN
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span>Active {formatRelative(profile.last_active_at)}</span>
                          <span>·</span>
                          <span>Joined {formatDate(profile.created_at)}</span>
                        </div>
                      </div>
                    </div>
 
                    {!profile.is_admin && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => void openBanModal(profile.nickname)}
                          title="Block this account's devices"
                          aria-label={`Block devices of ${profile.nickname}`}
                          className="rounded-lg p-2 text-slate-500 dark:text-slate-400 transition hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400"
                        >
                          <Ban className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            clearNotices();
                            setNewPassword('');
                            setResetTarget(profile.nickname);
                          }}
                          title="Reset account password"
                          aria-label={`Reset password for ${profile.nickname}`}
                          className="rounded-lg p-2 text-slate-500 dark:text-slate-400 transition hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-300"
                        >
                          <KeyRound className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            clearNotices();
                            setConfirmAction({
                              type: 'delete-user',
                              nickname: profile.nickname,
                            });
                          }}
                          title="Delete account"
                          aria-label={`Delete account ${profile.nickname}`}
                          className="rounded-lg p-2 text-slate-500 dark:text-slate-400 transition hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
 
        {tab === 'ipbans' && (
          <section>
            <div className={`${panelClass} mb-5 p-4`}>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10">
                  <Ban className="h-5 w-5 text-red-600 dark:text-red-300" />
                </div>
                <div>
                  <h2 className="font-semibold">Device bans</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Blocked devices cannot log in, even with a new account.
                    Their live sessions stop working too.
                  </p>
                </div>
                <button
                  onClick={() => void loadDeviceBans()}
                  disabled={loadingBans}
                  className={`${buttonClass} ml-auto ${neutralButton}`}
                  title="Refresh device bans"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${
                      loadingBans ? 'animate-spin' : ''
                    }`}
                  />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
              </div>
            </div>

            {loadingBans && deviceBans.length === 0 ? (
              <LoadingState label="Loading device bans..." />
            ) : deviceBans.length === 0 ? (
              <EmptyState
                icon={<Ban className="h-10 w-10" />}
                title="No blocked devices"
                detail="Open the Users tab and block an account to fill this list."
              />
            ) : (
              <div className="space-y-2">
                {deviceBans.map((ban) => (
                  <div
                    key={ban.device_id}
                    className={`${panelClass} flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold">
                          {ban.device_id.slice(0, 12)}…
                        </span>
                        {ban.nickname && (
                          <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-700 dark:text-red-300">
                            {ban.nickname}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 break-words text-xs text-slate-500">
                        {ban.user_agent || 'unknown device'}
                      </p>
                      <p className="mt-1 break-words text-xs text-slate-500">
                        {ban.reason || 'No reason given'} · blocked by{' '}
                        {ban.banned_by || 'admin'} ·{' '}
                        {formatDate(ban.created_at)}
                      </p>
                    </div>
                    <button
                      onClick={() => void handleUnban(ban.device_id)}
                      className={`${buttonClass} shrink-0 ${neutralButton}`}
                    >
                      <RefreshCw className="h-4 w-4" />
                      Unblock
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === 'rooms' && (
          <section>
            <div className={`${panelClass} mb-5 p-4`}>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10">
                  <MessagesSquare className="h-5 w-5 text-sky-600 dark:text-sky-300" />
                </div>
                <div>
                  <h2 className="font-semibold">Room management</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Review requests and manage existing rooms.
                  </p>
                </div>
                <button
                  onClick={() =>
                    void (roomSection === 'rooms'
                      ? loadRooms()
                      : loadRequests())
                  }
                  disabled={loadingRooms || loadingRequests}
                  className={`${buttonClass} ml-auto ${neutralButton}`}
                  title="Refresh"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${
                      loadingRooms || loadingRequests ? 'animate-spin' : ''
                    }`}
                  />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
              </div>
 
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setRoomSection('rooms');
                    clearNotices();
                  }}
                  className={sectionButtonClass(roomSection === 'rooms')}
                >
                  <DoorOpen className="h-4 w-4" />
                  All rooms
                </button>
 
                <button
                  onClick={() => {
                    setRoomSection('requests');
                    clearNotices();
                  }}
                  className={sectionButtonClass(roomSection === 'requests')}
                >
                  <Clock className="h-4 w-4" />
                  Requests
                  {requests.length > 0 && (
                    <span className="rounded-full bg-amber-500/20 px-1.5 text-xs text-amber-700 dark:text-amber-300">
                      {requests.length}
                    </span>
                  )}
                </button>
              </div>
            </div>
 
            {roomSection === 'rooms' && (
              <>
                <div className="relative mb-4">
                  <Search className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                  <input
                    value={roomSearch}
                    onChange={(event) => setRoomSearch(event.target.value)}
                    placeholder="Search room name, code, owner..."
                    className={searchInputClass}
                  />
                </div>
 
                {loadingRooms && rooms.length === 0 ? (
                  <LoadingState label="Loading rooms..." />
                ) : filteredRooms.length === 0 ? (
                  <EmptyState
                    icon={<MessagesSquare className="h-10 w-10" />}
                    title="No rooms found"
                    detail={
                      rooms.length === 0
                        ? 'The room list is empty or the room-list RPC is unavailable.'
                        : 'Try a different search.'
                    }
                  />
                ) : (
                  <div className="space-y-3">
                    {filteredRooms.map((room) => (
                      <article key={room.id} className={`${panelClass} p-4`}>
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="break-words font-semibold">
                                {room.name}
                              </h3>
                              <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1 font-mono text-xs text-slate-600 dark:text-slate-300">
                                {room.code || 'NO CODE'}
                              </span>
                              <button
                                onClick={() => void copyRoomCode(room.code)}
                                title="Copy room code"
                                className="rounded p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                              <span
                                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
                                  room.visibility === 'restricted'
                                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                    : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                }`}
                              >
                                {room.visibility === 'restricted' ? (
                                  <LockKeyhole className="h-3 w-3" />
                                ) : (
                                  <Globe className="h-3 w-3" />
                                )}
                                {room.visibility}
                              </span>
                            </div>
 
                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                              Owner: {room.owner_nickname || 'Unknown'}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                              <span>Members: {room.member_count ?? 0}</span>
                              <span>Messages: {room.message_count ?? 0}</span>
                              {room.created_at && (
                                <span>Created {formatDate(room.created_at)}</span>
                              )}
                            </div>
                          </div>
 
                          <div className="flex flex-wrap gap-2 sm:justify-end">
                            <button
                              onClick={() => enterAsAdmin(room)}
                              className={`${buttonClass} bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300`}
                            >
                              <LogIn className="h-4 w-4" />
                              Join chat
                            </button>
 
                            <button
                              onClick={() => void openSpectator(room)}
                              className={`${buttonClass} bg-sky-500/10 text-sky-700 hover:bg-sky-500/20 dark:text-sky-300`}
                            >
                              <Eye className="h-4 w-4" />
                              Watch
                            </button>
 
                            {room.visibility === 'restricted' && (
                              <button
                                onClick={() => {
                                  clearNotices();
                                  setPasswordRoom(room);
                                  setRoomPassword('');
                                }}
                                className={`${buttonClass} bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300`}
                              >
                                <KeyRound className="h-4 w-4" />
                                Password
                              </button>
                            )}
 
                            <button
                              onClick={() => {
                                clearNotices();
                                setConfirmAction({ type: 'clear-room', room });
                              }}
                              className={`${buttonClass} bg-orange-500/10 text-orange-700 hover:bg-orange-500/20 dark:text-orange-300`}
                            >
                              <MessageSquareX className="h-4 w-4" />
                              Clear messages
                            </button>
 
                            <button
                              onClick={() => {
                                clearNotices();
                                setConfirmAction({ type: 'delete-room', room });
                              }}
                              className={`${buttonClass} bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:text-red-300`}
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete room
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
 
            {roomSection === 'requests' && (
              <>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Room creation requests</h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Approved or rejected requests are removed from this list.
                    </p>
                  </div>
                  <span className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                    {requests.length} pending
                  </span>
                </div>
 
                {loadingRequests && requests.length === 0 ? (
                  <LoadingState label="Loading room requests..." />
                ) : requests.length === 0 ? (
                  <EmptyState
                    icon={<Clock className="h-10 w-10" />}
                    title="No pending requests"
                    detail="New requests will appear here when users submit them."
                  />
                ) : (
                  <div className="space-y-3">
                    {requests.map((request) => (
                      <article key={request.id} className={`${panelClass} p-4`}>
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="break-words font-semibold">
                                {request.room_name || 'Unnamed request'}
                              </h3>
                              <span
                                className={`rounded-md px-2 py-1 text-xs ${
                                  request.visibility === 'restricted'
                                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                    : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                }`}
                              >
                                {request.visibility}
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                              Requested by {request.requester_nickname || 'Unknown'}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              Submitted {formatDate(request.created_at)}
                            </p>
                          </div>
 
                          <div className="flex shrink-0 gap-2">
                            <button
                              onClick={() => {
                                clearNotices();
                                setConfirmAction({
                                  type: 'approve-request',
                                  request,
                                });
                              }}
                              className={`${buttonClass} bg-emerald-500 text-slate-950 hover:bg-emerald-400`}
                            >
                              <Check className="h-4 w-4" />
                              Approve
                            </button>
                            <button
                              onClick={() => {
                                clearNotices();
                                setConfirmAction({
                                  type: 'reject-request',
                                  request,
                                });
                              }}
                              className={`${buttonClass} bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:text-red-300`}
                            >
                              <Ban className="h-4 w-4" />
                              Reject
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </main>
 
      {openThread && (
        <SupportChat
          mode="admin"
          userNickname={openThread}
          onClose={() => {
            setOpenThread(null);
            void loadSupport();
          }}
        />
      )}
 
      {/* Confirmation modal */}
      {confirmAction && (
        <Modal onClose={() => !actionBusy && setConfirmAction(null)}>
          <div className="mb-4 flex items-start gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                confirmAction.type === 'approve-request'
                  ? 'bg-emerald-500/10'
                  : confirmAction.type === 'reject-request'
                    ? 'bg-amber-500/10'
                    : 'bg-red-500/10'
              }`}
            >
              {confirmAction.type === 'approve-request' ? (
                <Check className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
              ) : confirmAction.type === 'reject-request' ? (
                <Ban className="h-5 w-5 text-amber-600 dark:text-amber-300" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-300" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-bold">{pendingConfirmTitle()}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                {pendingConfirmDescription()}
              </p>
            </div>
          </div>
 
          <div className="flex gap-3">
            <button
              onClick={() => setConfirmAction(null)}
              disabled={actionBusy}
              className={`${buttonClass} flex-1 ${neutralButton}`}
            >
              Cancel
            </button>
            <button
              onClick={() => void handleConfirmAction()}
              disabled={actionBusy}
              className={`${buttonClass} flex-1 ${
                confirmAction.type === 'approve-request'
                  ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                  : confirmAction.type === 'reject-request'
                    ? 'bg-amber-500 text-white hover:bg-amber-400'
                    : 'bg-red-500 text-white hover:bg-red-400'
              }`}
            >
              {actionBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : confirmAction.type === 'approve-request' ? (
                <Check className="h-4 w-4" />
              ) : confirmAction.type === 'reject-request' ? (
                <Ban className="h-4 w-4" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {confirmAction.type === 'approve-request'
                ? 'Approve'
                : confirmAction.type === 'reject-request'
                  ? 'Reject'
                  : 'Confirm'}
            </button>
          </div>
        </Modal>
      )}
 
      {/* Device blocking */}
      {banTarget && (
        <Modal
          onClose={() => {
            if (banBusy) return;
            closeBanModal();
          }}
        >
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10">
              <Ban className="h-5 w-5 text-red-600 dark:text-red-300" />
            </div>
            <div>
              <h2 className="text-lg font-bold">
                Block this account's devices
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {banTarget}
              </p>
            </div>
          </div>

          {banDevicesLoading ? (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading device history...
            </p>
          ) : banDevices.length === 0 ? (
            <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              No device has been recorded for this account yet. One is added
              on the next login.
            </p>
          ) : (
            <>
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2 text-xs dark:border-slate-800">
                {banDevices.map((row) => (
                  <li
                    key={row.device_id}
                    className="flex flex-col gap-0.5 px-1 py-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono">
                        {row.device_id.slice(0, 12)}…
                      </span>
                      <span className="text-right text-slate-500">
                      {row.banned
                        ? 'already blocked'
                        : row.other_accounts > 0
                          ? `shared with ${row.other_accounts} other account${
                              row.other_accounts === 1 ? '' : 's'
                            }`
                          : 'this account only'}
                      </span>
                    </div>
                    <span className="truncate text-slate-400">
                      {row.user_agent || 'unknown device'}
                    </span>
                  </li>
                ))}
              </ul>

              {banDevices.some((row) => row.other_accounts > 0) && (
                <p className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                  Some of these devices are shared (school PC, tablet).
                  Accounts using them will be blocked as well.
                </p>
              )}
            </>
          )}

          <label
            htmlFor="ban-reason"
            className="mb-2 mt-4 block text-sm font-medium text-slate-600 dark:text-slate-300"
          >
            Reason (optional)
          </label>
          <input
            id="ban-reason"
            value={banReason}
            onChange={(event) => setBanReason(event.target.value)}
            maxLength={200}
            disabled={banBusy}
            placeholder="e.g. harassment"
            className="w-full rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-slate-900 outline-none focus:border-red-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />

          <div className="mt-5 flex gap-3">
            <button
              onClick={closeBanModal}
              disabled={banBusy}
              className={`${buttonClass} flex-1 ${neutralButton}`}
            >
              Cancel
            </button>
            <button
              onClick={() => void handleBanAccount()}
              disabled={
                banBusy || banDevicesLoading || banDevices.length === 0
              }
              className={`${buttonClass} flex-1 bg-red-500 text-white hover:bg-red-400`}
            >
              {banBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Ban className="h-4 w-4" />
              )}
              Block devices
            </button>
          </div>
        </Modal>
      )}

      {/* Account password reset */}
      {resetTarget && (
        <Modal
          onClose={() => {
            if (resetting) return;
            setResetTarget(null);
            setNewPassword('');
          }}
        >
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
              <KeyRound className="h-5 w-5 text-amber-600 dark:text-amber-300" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Reset account password</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{resetTarget}</p>
            </div>
          </div>
 
          <label
            htmlFor="admin-account-password"
            className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300"
          >
            New password
          </label>
          <input
            id="admin-account-password"
            type="password"
            autoComplete="new-password"
            minLength={4}
            maxLength={128}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !resetting) {
                void handleAccountPasswordReset();
              }
            }}
            placeholder="At least 4 characters"
            disabled={resetting}
            className="w-full rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-slate-900 outline-none focus:border-amber-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          <p className="mt-2 text-xs text-slate-500">
            The account owner will need to use this new password.
          </p>
 
          <div className="mt-5 flex gap-3">
            <button
              onClick={() => {
                setResetTarget(null);
                setNewPassword('');
              }}
              disabled={resetting}
              className={`${buttonClass} flex-1 ${neutralButton}`}
            >
              Cancel
            </button>
            <button
              onClick={() => void handleAccountPasswordReset()}
              disabled={resetting || newPassword.length < 4}
              className={`${buttonClass} flex-1 bg-amber-400 text-slate-950 hover:bg-amber-300`}
            >
              {resetting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              Reset password
            </button>
          </div>
        </Modal>
      )}
 
      {/* Restricted room password reset */}
      {passwordRoom && (
        <Modal
          onClose={() => {
            if (savingRoomPassword) return;
            setPasswordRoom(null);
            setRoomPassword('');
          }}
        >
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
              <LockKeyhole className="h-5 w-5 text-amber-600 dark:text-amber-300" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Reset room password</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {passwordRoom.name} · {passwordRoom.code}
              </p>
            </div>
          </div>
 
          <label
            htmlFor="admin-room-password"
            className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300"
          >
            New room password
          </label>
          <input
            id="admin-room-password"
            type="password"
            autoComplete="new-password"
            minLength={4}
            maxLength={128}
            value={roomPassword}
            onChange={(event) => setRoomPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !savingRoomPassword) {
                void handleRoomPasswordChange();
              }
            }}
            placeholder="At least 4 characters"
            disabled={savingRoomPassword}
            className="w-full rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-slate-900 outline-none focus:border-amber-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
 
          <p className="mt-2 text-xs text-slate-500">
            This changes the room password, not any user's account password.
          </p>
 
          <div className="mt-5 flex gap-3">
            <button
              onClick={() => {
                setPasswordRoom(null);
                setRoomPassword('');
              }}
              disabled={savingRoomPassword}
              className={`${buttonClass} flex-1 ${neutralButton}`}
            >
              Cancel
            </button>
            <button
              onClick={() => void handleRoomPasswordChange()}
              disabled={savingRoomPassword || roomPassword.length < 4}
              className={`${buttonClass} flex-1 bg-amber-400 text-slate-950 hover:bg-amber-300`}
            >
              {savingRoomPassword ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              Save password
            </button>
          </div>
        </Modal>
      )}
 
      {/* Read-only spectator */}
      {watchRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-3 backdrop-blur-sm sm:p-6">
          <section className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            <header className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Eye className="h-5 w-5 shrink-0 text-sky-600 dark:text-sky-300" />
                  <h2 className="truncate font-bold">{watchRoom.name}</h2>
                  <span className="rounded bg-sky-500/10 px-2 py-1 text-xs text-sky-700 dark:text-sky-300">
                    Read-only
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Room code: {watchRoom.code}
                </p>
              </div>
              <button
                onClick={() => setWatchRoom(null)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                aria-label="Close spectator"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
 
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {watchLoading ? (
                <LoadingState label="Loading room messages..." />
              ) : watchError ? (
                <p className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
                  {watchError}
                </p>
              ) : watchMessages.length === 0 ? (
                <EmptyState
                  icon={<MessagesSquare className="h-10 w-10" />}
                  title="No messages"
                  detail="No messages were returned for this room."
                />
              ) : (
                <div className="space-y-3">
                  {watchMessages.map((message) => {
                    const isDeleted = message.deleted && message.is_current;
                    const isPreviousVersion = !message.is_current;
                    const cardClass = isDeleted
                      ? 'border-red-300 bg-red-50 dark:border-red-500/50 dark:bg-red-950/60'
                      : isPreviousVersion
                        ? 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900/70'
                        : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/50';
                    const versionLabel = isDeleted
                      ? 'Deleted'
                      : message.is_current
                        ? 'Current'
                        : message.version_number === 1
                          ? 'Original'
                          : `Revision ${message.version_number - 1}`;
 
                    return (
                      <article
                        key={message.id}
                        className={`rounded-xl border p-3 ${cardClass}`}
                      >
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`text-sm font-semibold ${isDeleted ? 'text-red-700 dark:text-red-200' : 'text-sky-700 dark:text-sky-200'}`}>
                              {message.nickname}
                            </span>
                            <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${isDeleted ? 'bg-red-500/20 text-red-700 dark:text-red-200' : isPreviousVersion ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300' : 'bg-sky-500/10 text-sky-700 dark:text-sky-300'}`}>
                              {versionLabel}
                            </span>
                          </div>
                          <time className="text-xs text-slate-500">
                            {message.recorded_at
                              ? new Date(message.recorded_at).toLocaleString()
                              : message.message_created_at
                                ? new Date(message.message_created_at).toLocaleString()
                                : ''}
                          </time>
                        </div>
                        <p className={`whitespace-pre-wrap break-words text-sm leading-6 ${isDeleted ? 'text-red-700 line-through dark:text-red-200' : isPreviousVersion ? 'text-slate-500 dark:text-slate-400 line-through' : 'text-slate-700 dark:text-slate-200'}`}>
                          {renderMessageContent(message.content)}
                        </p>
                        {isPreviousVersion && message.editor_nickname && (
                          <p className="mt-2 text-[11px] text-slate-500">
                            Recorded by {message.editor_nickname}
                          </p>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
 
            <footer className="flex items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 p-3">
              <p className="text-xs text-slate-500">
                Showing message history and current status. Sending is disabled.
              </p>
              <button
                onClick={() => void openSpectator(watchRoom)}
                disabled={watchLoading}
                className={`${buttonClass} ${neutralButton}`}
              >
                <RefreshCw className={`h-4 w-4 ${watchLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
 
function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-500">
      <Loader2 className="mb-3 h-8 w-8 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
 
function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 px-5 py-16 text-center">
      <div className="mb-3 text-slate-400 dark:text-slate-700">{icon}</div>
      <p className="font-semibold text-slate-600 dark:text-slate-300">{title}</p>
      <p className="mt-1 max-w-md text-sm text-slate-500">{detail}</p>
    </div>
  );
}
 
function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-slate-900 shadow-2xl dark:text-white">
        {children}
      </div>
    </div>
  );
}
 

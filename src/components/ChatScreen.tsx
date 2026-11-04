import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  Send,
  MessageCircle,
  Loader2,
  ArrowLeft,
  Hash,
  Sun,
  Moon,
  Reply,
  X,
  Settings,
  Link as LinkIcon,
  Pencil,
  Trash2,
  Check,
  ChevronDown,
  Users,
  Lock,
  MoreVertical,
  ExternalLink,
} from 'lucide-react';

import { supabase } from '@/lib/supabase';
import {
  editMessage,
  deleteMessage,
  getRoomPasswordStatus,
} from '@/lib/auth';
import type { Message } from '@/lib/supabase';
import type { RoomSummary } from '@/lib/auth';
import {
  fetchMessagesBefore,
  fetchMessagesAfter,
  fetchMessagePreviews,
  sendRoomMessage,
  getRoomMembers,
  renameRoom,
  updateRoomSecurity,
  refreshRoom,
  type MessagePreview,
  type RoomMember,
} from '@/lib/rooms';
import { useTheme } from '@/lib/useTheme';
import { dateLocale, translateSystemMessage, tr, useLang } from '@/lib/i18n';
import LanguageToggle from '@/components/LanguageToggle';
import NotificationToggle from '@/components/NotificationToggle';
import { notifyNewMessage } from '@/lib/notify';

type Props = {
  nickname: string;
  room: RoomSummary;
  onBackToHub: () => void;
  onLogout?: () => void;
};

/** 한 번에 불러오는 메시지 수 */
const PAGE_SIZE = 50;
/**
 * 화면(메모리)에 들고 있는 메시지 최대 개수.
 * 평소에는 지우지 않고, 이 개수를 넘으면 사용자가 보고 있지 않은 쪽 끝을 비운다.
 * (500~1000 사이에서 조절하세요)
 */
const MAX_LOADED = 500;
/** 계정당 전송 제한: 1분에 6개 */
const RATE_LIMIT_COUNT = 6;
const RATE_WINDOW_MS = 60_000;
/** 스크롤이 위/아래 끝에서 이 거리 안으로 들어오면 다음 구간을 불러온다 */
const EDGE_THRESHOLD = 160;

const timeFormatter = {
  format: (date: Date) =>
    new Intl.DateTimeFormat(dateLocale(), {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date),
};

const dateFormatter = {
  format: (date: Date) =>
    new Intl.DateTimeFormat(dateLocale(), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(date),
};

const URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
const TRAILING_PUNCTUATION = /[.,!?;:)\]}>]+$/;

function splitUrl(raw: string): { url: string; trailing: string } {
  const match = TRAILING_PUNCTUATION.exec(raw);

  if (!match) return { url: raw, trailing: '' };

  return {
    url: raw.slice(0, match.index),
    trailing: match[0],
  };
}

function toHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function getHostname(href: string): string {
  try {
    return new URL(href).hostname;
  } catch {
    return href;
  }
}

function getInitial(name: string) {
  return name.charAt(0).toUpperCase();
}

function getAvatarColor(name: string) {
  const colors = [
    'from-cyan-400 to-blue-500',
    'from-emerald-400 to-teal-500',
    'from-rose-400 to-pink-500',
    'from-amber-400 to-orange-500',
    'from-violet-400 to-purple-500',
    'from-sky-400 to-indigo-500',
    'from-lime-400 to-green-500',
    'from-fuchsia-400 to-pink-500',
  ];

  let hash = 0;

  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

/** 스크롤 위치 보존용: 화면 맨 위에 보이는 메시지와 그 오프셋을 기억한다 */
type Anchor = { id: string; offset: number };

function captureAnchor(container: HTMLElement | null): Anchor | null {
  if (!container) return null;

  const containerTop = container.getBoundingClientRect().top;
  const nodes = container.querySelectorAll<HTMLElement>('[data-mid]');

  for (const node of nodes) {
    const rect = node.getBoundingClientRect();

    if (rect.bottom > containerTop + 1) {
      return { id: node.dataset.mid ?? '', offset: rect.top - containerTop };
    }
  }

  return null;
}

function restoreAnchor(container: HTMLElement | null, anchor: Anchor) {
  if (!container || !anchor.id) return;

  const node = container.querySelector<HTMLElement>(
    `[data-mid="${anchor.id}"]`
  );

  if (!node) return;

  const delta =
    node.getBoundingClientRect().top -
    container.getBoundingClientRect().top -
    anchor.offset;

  if (delta !== 0) container.scrollTop += delta;
}

function prependUnique(older: Message[], current: Message[]): Message[] {
  const ids = new Set(current.map((message) => message.id));

  return [...older.filter((message) => !ids.has(message.id)), ...current];
}

function appendUnique(current: Message[], newer: Message[]): Message[] {
  const ids = new Set(current.map((message) => message.id));

  return [...current, ...newer.filter((message) => !ids.has(message.id))];
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label={tr('common.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function ChatScreen({ nickname, room, onBackToHub }: Props) {
  const { theme, toggleTheme } = useTheme();
  useLang(); // 언어가 바뀌면 화면을 다시 그린다
  const nicknameLower = nickname.toLocaleLowerCase();

  const [roomInfo, setRoomInfo] = useState<RoomSummary>(room);

  const [messages, setMessages] = useState<Message[]>([]);
  const [previews, setPreviews] = useState<Record<string, MessagePreview>>({});
  const [loading, setLoading] = useState(true);
  const [hasOlder, setHasOlderState] = useState(false);
  const [hasNewer, setHasNewerState] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const [awayCount, setAwayCount] = useState(0);
  const [farFromBottom, setFarFromBottom] = useState(false);

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [deletingMessage, setDeletingMessage] = useState<Message | null>(null);
  const [openMessageMenuId, setOpenMessageMenuId] = useState<string | null>(
    null
  );
  const [actionError, setActionError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const [onlineNicknames, setOnlineNicknames] = useState<string[]>([]);
  const [typingNicknames, setTypingNicknames] = useState<string[]>([]);

  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState('');
  const [pendingLink, setPendingLink] = useState<string | null>(null);

  const [showMembers, setShowMembers] = useState(false);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState('');

  const [showSettings, setShowSettings] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordIsSet, setPasswordIsSet] = useState<boolean | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [reconnectTick, setReconnectTick] = useState(0);
  const roomNameRef = useRef(room.name);
  const firstLoadRef = useRef(true);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onlineAtRef = useRef(new Date().toISOString());

  const aliveRef = useRef(true);
  const messagesRef = useRef<Message[]>([]);
  const previewsRef = useRef<Record<string, MessagePreview>>({});
  const hasOlderRef = useRef(false);
  const hasNewerRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const loadingNewerRef = useRef(false);
  /** 맨 아래(실시간 끝)에 붙어서 보고 있는지 */
  const nearBottomRef = useRef(true);
  const pendingScrollRef = useRef<'instant' | 'smooth' | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  const lastLoadRef = useRef<'older' | 'newer' | 'live'>('live');
  const sentTimesRef = useRef<number[]>([]);

  const typingRef = useRef(false);
  const lastTypingSentRef = useRef(0);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  messagesRef.current = messages;
  roomNameRef.current = roomInfo.name;
  previewsRef.current = previews;

  const role = roomInfo.role;
  const isSiteAdmin = role === 'admin';
  const isSupportRoom = roomInfo.name.startsWith('문의 · ');
  const canManage =
    !isSupportRoom &&
    (role === 'owner' || role === 'co_admin' || role === 'admin');
  const canSeePasswordStatus = role === 'owner' || role === 'admin';

  const setHasOlder = (value: boolean) => {
    hasOlderRef.current = value;
    setHasOlderState(value);
  };

  const setHasNewer = (value: boolean) => {
    hasNewerRef.current = value;
    setHasNewerState(value);
  };

  /* ------------------------------------------------------------------ */
  /* 데이터 불러오기                                                      */
  /* ------------------------------------------------------------------ */

  /** 불러온 구간 밖에 있는 "답장 원본"을 미리보기용으로 가져온다 */
  const loadPreviewsFor = useCallback(
    async (chunk: Message[]) => {
      const known = new Set<string>([
        ...messagesRef.current.map((message) => message.id),
        ...chunk.map((message) => message.id),
        ...Object.keys(previewsRef.current),
      ]);

      const missing = [
        ...new Set(
          chunk
            .map((message) => message.reply_to_id)
            .filter((id): id is string => Boolean(id) && !known.has(id as string))
        ),
      ].slice(0, 100);

      if (missing.length === 0) return;

      const res = await fetchMessagePreviews(room.id, missing);

      if (!res.ok || !aliveRef.current) return;

      setPreviews((previous) => {
        const next = { ...previous };

        for (const preview of res.data) next[preview.id] = preview;

        for (const id of missing) {
          if (!next[id]) {
            next[id] = {
              id,
              nickname: '',
              content: '',
              deleted: true,
              missing: true,
            };
          }
        }

        return next;
      });
    },
    [room.id]
  );

  /** 가장 최근 구간으로 교체 (처음 입장 / "최신으로 이동") */
  const loadLatest = useCallback(
    async (initial: boolean) => {
      if (initial) setLoading(true);

      const res = await fetchMessagesBefore(room.id, null, PAGE_SIZE);

      if (!aliveRef.current) return;

      if (!res.ok) {
        setActionError(res.error);
        if (initial) setLoading(false);
        return;
      }

      await loadPreviewsFor(res.data);

      if (!aliveRef.current) return;

      lastLoadRef.current = 'live';
      pendingScrollRef.current = 'instant';
      setMessages(res.data);
      setHasOlder(res.data.length === PAGE_SIZE);
      setHasNewer(false);
      setAwayCount(0);

      if (initial) setLoading(false);
    },
    [room.id, loadPreviewsFor]
  );

  /** 위로 스크롤: 더 오래된 50개 */
  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasOlderRef.current) return;

    const oldest = messagesRef.current[0];

    if (!oldest) return;

    loadingOlderRef.current = true;
    setLoadingOlder(true);

    try {
      const res = await fetchMessagesBefore(
        room.id,
        oldest.created_at,
        PAGE_SIZE
      );

      if (!aliveRef.current) return;

      if (!res.ok) {
        setActionError(res.error);
        return;
      }

      await loadPreviewsFor(res.data);

      if (!aliveRef.current) return;

      anchorRef.current = captureAnchor(containerRef.current);
      lastLoadRef.current = 'older';
      setMessages((previous) => prependUnique(res.data, previous));
      setHasOlder(res.data.length === PAGE_SIZE);
    } finally {
      loadingOlderRef.current = false;
      if (aliveRef.current) setLoadingOlder(false);
    }
  }, [room.id, loadPreviewsFor]);

  /** 아래로 스크롤: 더 최근 50개 (과거를 보고 있다가 내려올 때) */
  const loadNewer = useCallback(async () => {
    if (loadingNewerRef.current || !hasNewerRef.current) return;

    const list = messagesRef.current;
    const newest = list[list.length - 1];

    if (!newest) return;

    loadingNewerRef.current = true;
    setLoadingNewer(true);

    try {
      const res = await fetchMessagesAfter(
        room.id,
        newest.created_at,
        PAGE_SIZE
      );

      if (!aliveRef.current) return;

      if (!res.ok) {
        setActionError(res.error);
        return;
      }

      await loadPreviewsFor(res.data);

      if (!aliveRef.current) return;

      lastLoadRef.current = 'newer';
      setMessages((previous) => appendUnique(previous, res.data));

      if (res.data.length < PAGE_SIZE) {
        // 실시간 끝에 도착. 이제부터 새 메시지는 바로 붙인다.
        setHasNewer(false);
        setAwayCount(0);

        // 떨어져 있는 동안 도착한 메시지가 빠지지 않도록 한 번 더 확인
        const last = res.data[res.data.length - 1] ?? newest;
        const extra = await fetchMessagesAfter(
          room.id,
          last.created_at,
          PAGE_SIZE
        );

        if (extra.ok && extra.data.length > 0 && aliveRef.current) {
          await loadPreviewsFor(extra.data);

          if (aliveRef.current) {
            setMessages((previous) => appendUnique(previous, extra.data));
          }
        }
      }
    } finally {
      loadingNewerRef.current = false;
      if (aliveRef.current) setLoadingNewer(false);
    }
  }, [room.id, loadPreviewsFor]);

  /** 내가 보낸 직후, 실시간 이벤트가 늦거나 끊겼어도 내 메시지가 보이게 보정 */
  const syncTail = useCallback(async () => {
    if (hasNewerRef.current) return;

    const list = messagesRef.current;
    const newest = list[list.length - 1];

    if (!newest) {
      await loadLatest(false);
      return;
    }

    const res = await fetchMessagesAfter(room.id, newest.created_at, PAGE_SIZE);

    if (!res.ok || !aliveRef.current || hasNewerRef.current) return;

    const known = new Set(messagesRef.current.map((message) => message.id));
    const fresh = res.data.filter((message) => !known.has(message.id));

    if (fresh.length === 0) return;

    await loadPreviewsFor(fresh);

    if (!aliveRef.current) return;

    lastLoadRef.current = 'live';
    pendingScrollRef.current = 'instant';
    setMessages((previous) => appendUnique(previous, fresh));
  }, [room.id, loadLatest, loadPreviewsFor]);

  const refreshRoomInfo = useCallback(async () => {
    const fresh = await refreshRoom(room.code);

    if (!fresh || !aliveRef.current) return;

    setRoomInfo((previous) => ({
      ...previous,
      name: fresh.name || previous.name,
      visibility: fresh.visibility,
    }));
  }, [room.code]);

  /**
   * 실시간 이벤트가 안 오거나 끊겼을 때를 대비한 보정.
   * 몇 초마다 (그리고 탭으로 돌아올 때) 새 메시지만 확인해서 붙인다.
   * 읽는 중이면 화면을 끌어내리지 않고, 맨 아래에 붙어 있을 때만 따라간다.
   */
  const pollTail = useCallback(async () => {
    if (hasNewerRef.current || loadingNewerRef.current) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    const newest = messagesRef.current[messagesRef.current.length - 1];

    if (!newest) return;

    const res = await fetchMessagesAfter(room.id, newest.created_at, PAGE_SIZE);

    if (!res.ok || !aliveRef.current || hasNewerRef.current) return;

    const known = new Set(messagesRef.current.map((message) => message.id));
    const fresh = res.data.filter((message) => !known.has(message.id));

    if (fresh.length === 0) return;

    await loadPreviewsFor(fresh);

    if (!aliveRef.current || hasNewerRef.current) return;

    if (fresh.some((message) => message.is_system)) void refreshRoomInfo();

    for (const message of fresh) {
      if (
        !message.is_system &&
        !message.deleted &&
        message.nickname.toLocaleLowerCase() !== nicknameLower
      ) {
        notifyNewMessage({
          id: message.id,
          title: roomNameRef.current,
          body: `${message.nickname}: ${message.content}`,
        });
      }
    }

    lastLoadRef.current = 'live';

    if (nearBottomRef.current) pendingScrollRef.current = 'smooth';

    setMessages((previous) => appendUnique(previous, fresh));
  }, [room.id, nicknameLower, loadPreviewsFor, refreshRoomInfo]);

  useEffect(() => {
    const timer = window.setInterval(() => void pollTail(), 3000);
    const onVisible = () => {
      if (!document.hidden) void pollTail();
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [pollTail]);

  /**
   * 연결 감시: 탭이 백그라운드였다가 돌아오거나 인터넷이 다시 연결되면
   * 연결 상태를 확인하고, 'joined' 가 아니면 구독을 새로 만든다.
   * 연결이 살아 있으면 접속 표시(presence)를 다시 알린다 (유령 계정 방지).
   */
  useEffect(() => {
    const check = () => {
      if (document.hidden) return;

      const channel = channelRef.current;

      if (!channel || channel.state !== 'joined') {
        setReconnectTick((tick) => tick + 1);
        return;
      }

      void channel.track({
        nickname,
        room_id: room.id,
        online_at: onlineAtRef.current,
        typing: false,
      });
    };

    const timer = window.setInterval(() => {
      const channel = channelRef.current;

      if (!document.hidden && channel && channel.state !== 'joined' && channel.state !== 'joining') {
        setReconnectTick((tick) => tick + 1);
      }
    }, 10000);

    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
    };
  }, [nickname, room.id]);

  /* ------------------------------------------------------------------ */
  /* 실시간 구독 + 첫 로드                                                */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    aliveRef.current = true;

    // 이 구독이 정리된 뒤 늦게 도착하는 상태 변화는 무시하기 위한 표시
    let disposed = false;

    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      void loadLatest(true);
    } else {
      // 연결이 끊겼다가 다시 붙은 경우: 목록을 새로 그리지 않고 빠진 메시지만 채운다
      void pollTail();
    }

    const channel = supabase
      .channel(`room:${room.id}:messages:${reconnectTick}`, {
        config: { presence: { key: nickname } },
      })
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `room_id=eq.${room.id}`,
        },
        (payload) => {
          const incoming = payload.new as Message;

          if (messagesRef.current.some((message) => message.id === incoming.id)) {
            return;
          }

          // 방 이름/비밀번호가 바뀌면 시스템 메시지가 오므로 그때 다시 읽는다
          if (incoming.is_system) void refreshRoomInfo();

          const own = incoming.nickname.toLocaleLowerCase() === nicknameLower;

          // 과거를 보고 있는 중이면 목록에 끼워 넣지 않고 "새 메시지" 표시만
          if (hasNewerRef.current) {
            if (!own) setAwayCount((count) => count + 1);
            return;
          }

          const normalized: Message = {
            ...incoming,
            deleted: incoming.deleted === true,
            is_system: incoming.is_system === true,
          };

          if (!own && !normalized.is_system) {
            notifyNewMessage({
              id: normalized.id,
              title: roomNameRef.current,
              body: `${normalized.nickname}: ${normalized.content}`,
            });
          }

          void loadPreviewsFor([normalized]);

          lastLoadRef.current = 'live';

          // 읽는 중(위로 올라가 있음)이면 절대 맨 아래로 끌어내리지 않는다.
          // 내가 보낸 메시지이거나, 이미 맨 아래에 붙어 있을 때만 따라간다.
          if (own) {
            pendingScrollRef.current = 'instant';
          } else if (nearBottomRef.current) {
            pendingScrollRef.current = 'smooth';
          }

          setMessages((previous) =>
            previous.some((message) => message.id === normalized.id)
              ? previous
              : [...previous, normalized]
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `room_id=eq.${room.id}`,
        },
        (payload) => {
          const updated = payload.new as Partial<Message> & { id: string };
          const nowDeleted = updated.deleted === true;

          const apply = <T extends { id: string; content: string; deleted?: boolean }>(
            item: T
          ): T =>
            item.id === updated.id
              ? {
                  ...item,
                  content: nowDeleted
                    ? ''
                    : (updated.content ?? item.content),
                  deleted: nowDeleted || item.deleted === true,
                }
              : item;

          setMessages((previous) => previous.map((message) => apply(message)));
          setPreviews((previous) =>
            previous[updated.id]
              ? { ...previous, [updated.id]: apply(previous[updated.id]) }
              : previous
          );
        }
      )
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();

        setOnlineNicknames(Object.keys(state));

        const typingUsers = Object.values(state)
          .flat()
          .filter((presence: Record<string, unknown>) => {
            const presenceNickname = String(presence.nickname ?? '');

            return (
              presence.typing === true &&
              presenceNickname.toLocaleLowerCase() !== nicknameLower &&
              String(presence.room_id ?? '') === room.id
            );
          })
          .map((presence: Record<string, unknown>) =>
            String(presence.nickname ?? '').trim()
          )
          .filter(Boolean);

        setTypingNicknames([...new Set(typingUsers)]);
      })
      .subscribe(async (status) => {
        if (disposed) return;

        if (status === 'SUBSCRIBED') {
          reconnectAttemptRef.current = 0;

          await channel.track({
            nickname,
            room_id: room.id,
            online_at: onlineAtRef.current,
            typing: false,
          });

          // 끊겨 있던 동안 온 메시지 보충
          void pollTail();
          return;
        }

        if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          // 연결이 깨졌다: 잠깐 기다렸다가(점점 길게) 구독을 새로 만든다
          const delay = Math.min(
            15000,
            1000 * 2 ** reconnectAttemptRef.current
          );

          reconnectAttemptRef.current += 1;

          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);

          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            if (!disposed) setReconnectTick((tick) => tick + 1);
          }, delay);
        }
      });

    channelRef.current = channel;

    return () => {
      disposed = true;
      aliveRef.current = false;

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      if (typingStopTimerRef.current) {
        clearTimeout(typingStopTimerRef.current);
        typingStopTimerRef.current = null;
      }

      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [
    room.id,
    nickname,
    nicknameLower,
    reconnectTick,
    pollTail,
    loadLatest,
    loadPreviewsFor,
    refreshRoomInfo,
  ]);

  /* ------------------------------------------------------------------ */
  /* 스크롤 위치 관리                                                     */
  /* ------------------------------------------------------------------ */

  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container) return;

    const pending = pendingScrollRef.current;

    if (pending) {
      pendingScrollRef.current = null;
      anchorRef.current = null;
      container.scrollTo({
        top: container.scrollHeight,
        behavior: pending === 'smooth' ? 'smooth' : 'auto',
      });
      nearBottomRef.current = true;
    } else if (anchorRef.current) {
      // 위/아래에서 메시지가 붙거나 빠져도 보던 자리가 그대로 유지되게 보정
      restoreAnchor(container, anchorRef.current);
      anchorRef.current = null;
    }

    // 개수가 많아지면 사용자가 보고 있지 않은 쪽 끝을 비운다
    if (messages.length > MAX_LOADED) {
      const mode = lastLoadRef.current;

      if (mode === 'older') {
        setHasNewer(true);
        setMessages((previous) => previous.slice(0, MAX_LOADED));
      } else if (
        mode === 'newer' ||
        (mode === 'live' && nearBottomRef.current && !hasNewerRef.current)
      ) {
        anchorRef.current = captureAnchor(container);
        setHasOlder(true);
        setMessages((previous) => previous.slice(previous.length - MAX_LOADED));
      }
    }
  }, [messages]);

  const handleScroll = () => {
    const container = containerRef.current;

    if (!container) return;

    const distanceToBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    nearBottomRef.current =
      distanceToBottom < EDGE_THRESHOLD && !hasNewerRef.current;

    setFarFromBottom(distanceToBottom > 400);

    if (container.scrollTop < EDGE_THRESHOLD) void loadOlder();

    if (distanceToBottom < EDGE_THRESHOLD && hasNewerRef.current) {
      void loadNewer();
    }
  };

  const jumpToLatest = () => {
    if (hasNewerRef.current) {
      void loadLatest(false);
      return;
    }

    containerRef.current?.scrollTo({
      top: containerRef.current.scrollHeight,
      behavior: 'smooth',
    });
  };

  /* ------------------------------------------------------------------ */
  /* 입력 / 전송                                                          */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (cooldown <= 0) return;

    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);

    return () => clearTimeout(timer);
  }, [cooldown]);

  const trackPresence = (typing: boolean) => {
    const channel = channelRef.current;

    if (!channel) return;

    void channel.track({
      nickname,
      room_id: room.id,
      online_at: onlineAtRef.current,
      typing,
    });
  };

  const stopTyping = () => {
    if (typingStopTimerRef.current) {
      clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }

    if (typingRef.current) {
      typingRef.current = false;
      trackPresence(false);
    }
  };

  const handleInputChange = (value: string) => {
    setInput(value);

    const typing = value.trim().length > 0;
    const now = Date.now();

    // 상태가 바뀔 때, 또는 입력 중이면 2.5초마다만 서버로 알린다
    if (
      typing !== typingRef.current ||
      (typing && now - lastTypingSentRef.current > 2500)
    ) {
      typingRef.current = typing;
      lastTypingSentRef.current = now;
      trackPresence(typing);
    }

    if (typingStopTimerRef.current) {
      clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }

    if (typing) {
      typingStopTimerRef.current = setTimeout(() => {
        typingRef.current = false;
        trackPresence(false);
        typingStopTimerRef.current = null;
      }, 3000);
    }
  };

  /** 클라이언트 쪽 사전 확인 (서버가 최종 판단). 남은 대기 초를 돌려준다. */
  const secondsUntilNextSend = (): number => {
    if (isSiteAdmin) return 0;

    const now = Date.now();

    sentTimesRef.current = sentTimesRef.current.filter(
      (time) => now - time < RATE_WINDOW_MS
    );

    if (sentTimesRef.current.length < RATE_LIMIT_COUNT) return 0;

    return Math.max(
      1,
      Math.ceil((sentTimesRef.current[0] + RATE_WINDOW_MS - now) / 1000)
    );
  };

  const insertLink = () => {
    const url = linkUrl.trim();

    if (!/^(https?:\/\/|www\.)\S+$/i.test(url)) {
      setLinkError(tr('chat.invalidLink'));
      return;
    }

    setInput((previous) => (previous ? `${previous} ${url}` : url));
    setLinkUrl('');
    setLinkError('');
    setShowLinkDialog(false);
    inputRef.current?.focus();
  };

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();

    const content = input.trim();

    if (!content || sending || actionBusy) return;

    if (!editingMessage && cooldown > 0) return;

    stopTyping();
    setSending(true);
    setActionError('');

    try {
      if (editingMessage) {
        const result = await editMessage(editingMessage.id, content);

        if (!result.ok) {
          setActionError(result.error ?? tr('chat.editFailed'));
          return;
        }

        setMessages((previous) =>
          previous.map((message) =>
            message.id === editingMessage.id ? { ...message, content } : message
          )
        );

        setEditingMessage(null);
        setInput('');
        return;
      }

      const wait = secondsUntilNextSend();

      if (wait > 0) {
        setCooldown(wait);
        setActionError(
          tr('chat.rateLimit', { max: RATE_LIMIT_COUNT, n: wait })
        );
        return;
      }

      const result = await sendRoomMessage(content, room.id, replyTo?.id ?? null);

      if (!result.ok) {
        setActionError(result.error);
        if (result.retryAfter) setCooldown(result.retryAfter);
        return;
      }

      sentTimesRef.current.push(Date.now());
      setInput('');
      setReplyTo(null);

      if (hasNewerRef.current) {
        // 과거를 보고 있었다면 최신 구간으로 이동해서 내 메시지를 보여준다
        void loadLatest(false);
      } else {
        window.setTimeout(() => {
          if (aliveRef.current) void syncTail();
        }, 700);
      }
    } catch (error) {
      console.error('Message action failed:', error);
      setActionError(tr('chat.actionFailed'));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleReply = (message: Message) => {
    setReplyTo(message);
    setEditingMessage(null);
    setOpenMessageMenuId(null);
    inputRef.current?.focus();
  };

  const startEditing = (message: Message) => {
    setEditingMessage(message);
    setReplyTo(null);
    setInput(message.content);
    setActionError('');
    setOpenMessageMenuId(null);
    inputRef.current?.focus();
  };

  const cancelEditing = () => {
    setEditingMessage(null);
    setInput('');
    setActionError('');
    inputRef.current?.focus();
  };

  const confirmDelete = async () => {
    if (!deletingMessage || actionBusy) return;

    setActionBusy(true);
    setActionError('');

    try {
      const result = await deleteMessage(deletingMessage.id);

      if (!result.ok) {
        setActionError(result.error ?? tr('chat.deleteFailed'));
        setDeletingMessage(null);
        return;
      }

      setMessages((previous) =>
        previous.map((message) =>
          message.id === deletingMessage.id
            ? { ...message, content: '', deleted: true }
            : message
        )
      );

      if (editingMessage?.id === deletingMessage.id) {
        setEditingMessage(null);
        setInput('');
      }

      if (replyTo?.id === deletingMessage.id) setReplyTo(null);

      setDeletingMessage(null);
    } catch (error) {
      console.error('Failed to delete message:', error);
      setActionError(tr('chat.deleteFailed'));
      setDeletingMessage(null);
    } finally {
      setActionBusy(false);
    }
  };

  const handleBackToHub = async () => {
    stopTyping();
    // 서버 응답을 기다리지 않고 바로 넘어간다 (채널 정리는 언마운트 시 자동으로 처리됨)
    void channelRef.current?.untrack().catch(() => {});
    onBackToHub();
  };

  /* ------------------------------------------------------------------ */
  /* 멤버 목록 / 방 설정                                                  */
  /* ------------------------------------------------------------------ */

  const openMembers = async () => {
    setShowMembers(true);
    setMembersLoading(true);
    setMembersError('');

    const res = await getRoomMembers(room.id);

    if (!aliveRef.current) return;

    if (res.ok) setMembers(res.data);
    else setMembersError(res.error);

    setMembersLoading(false);
  };

  const openSettings = async () => {
    setShowSettings(true);
    setRenameValue(roomInfo.name);
    setNewPassword('');
    setSettingsNotice(null);
    setPasswordIsSet(null);

    if (roomInfo.visibility === 'restricted' && canSeePasswordStatus) {
      const res = await getRoomPasswordStatus(room.id);

      if (aliveRef.current && res.ok) setPasswordIsSet(res.isSet === true);
    }
  };

  const handleRename = async () => {
    const name = renameValue.trim();

    if (settingsBusy || name === roomInfo.name) return;

    setSettingsBusy(true);
    setSettingsNotice(null);

    const res = await renameRoom(room.id, name);

    setSettingsBusy(false);

    if (!res.ok) {
      setSettingsNotice({ kind: 'error', text: res.error });
      return;
    }

    setRoomInfo((previous) => ({ ...previous, name: res.data }));
    setRenameValue(res.data);
    setSettingsNotice({ kind: 'ok', text: tr('chat.renamed') });
  };

  const applyPassword = async (password: string | null) => {
    if (settingsBusy) return;

    if (password !== null && (password.length < 4 || password.length > 128)) {
      setSettingsNotice({
        kind: 'error',
        text: tr('chat.pwLength'),
      });
      return;
    }

    setSettingsBusy(true);
    setSettingsNotice(null);

    const res = await updateRoomSecurity(room.id, password);

    setSettingsBusy(false);

    if (!res.ok) {
      setSettingsNotice({ kind: 'error', text: res.error });
      return;
    }

    setRoomInfo((previous) => ({ ...previous, visibility: res.data }));
    setPasswordIsSet(res.data === 'restricted' ? true : null);
    setNewPassword('');
    setSettingsNotice({
      kind: 'ok',
      text:
        res.data === 'restricted'
          ? tr('chat.pwSet')
          : tr('chat.pwCleared'),
    });
  };

  /* ------------------------------------------------------------------ */
  /* 렌더링 도우미                                                        */
  /* ------------------------------------------------------------------ */

  const renderMessageContent = (content: string, own: boolean) =>
    content.split(URL_PATTERN).map((part, index) => {
      // split 에 캡처 그룹을 썼으므로 홀수 인덱스가 URL
      if (index % 2 === 0) return <span key={index}>{part}</span>;

      const { url, trailing } = splitUrl(part);
      const href = toHref(url);

      return (
        <span key={index}>
          <a
            href={href}
            onClick={(event) => {
              event.preventDefault();
              setPendingLink(href);
            }}
            className={`break-all underline underline-offset-2 hover:opacity-80 ${
              own ? 'text-white' : 'text-cyan-600 dark:text-cyan-400'
            }`}
          >
            {url}
          </a>
          {trailing}
        </span>
      );
    });

  const renderReplyPreview = (message: Message) => {
    if (!message.reply_to_id) return null;

    const inList = messages.find((item) => item.id === message.reply_to_id);
    const preview = previews[message.reply_to_id];

    const source = inList ?? preview;
    const deleted = Boolean(source?.deleted);

    return (
      <div className="mb-1 rounded-lg border-l-2 border-cyan-400 bg-black/5 px-3 py-2 dark:bg-white/5">
        <p className="text-xs font-semibold text-cyan-600 dark:text-cyan-400">
          {source?.nickname || tr('chat.originalMessage')}
        </p>
        <p className="truncate text-xs opacity-80">
          {deleted
            ? tr('chat.deletedMessage')
            : source?.content || tr('chat.originalUnavailable')}
        </p>
      </div>
    );
  };

  const renderMessageRow = (
    message: Message,
    options: { own: boolean; showHeader: boolean }
  ) => {
    const { own, showHeader } = options;
    const deleted = message.deleted === true;
    const time = timeFormatter.format(new Date(message.created_at));
    const canEdit = own && !deleted;
    const canDelete = (own || isSiteAdmin) && !deleted;

    const actions = !deleted && (
      <div
        className={`flex shrink-0 items-center gap-0.5 self-center opacity-60 transition focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100 ${
          own ? 'order-first' : ''
        }`}
      >
        <button
          type="button"
          onClick={() => handleReply(message)}
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-200 hover:text-cyan-600 dark:hover:bg-slate-700 dark:hover:text-cyan-400"
          title={tr('chat.reply')}
          aria-label={tr('chat.reply')}
        >
          <Reply className="h-3.5 w-3.5" />
        </button>

        {(canEdit || canDelete) && (
          <div className="relative">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setOpenMessageMenuId((current) =>
                  current === message.id ? null : message.id
                );
              }}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-white"
              title={tr('chat.messageOptions')}
              aria-label={tr('chat.messageOptions')}
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>

            {openMessageMenuId === message.id && (
              <div
                className={`absolute top-full z-30 mt-1 w-32 rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900 ${
                  own ? 'right-0' : 'left-0'
                }`}
                onClick={(event) => event.stopPropagation()}
              >
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => startEditing(message)}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Pencil className="h-4 w-4" />
                    {tr('common.edit')}
                  </button>
                )}

                {canDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      setDeletingMessage(message);
                      setOpenMessageMenuId(null);
                      setActionError('');
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    <Trash2 className="h-4 w-4" />
                    {tr('common.delete')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );

    const bubble = (
      <div className="flex min-w-0 flex-col">
        {renderReplyPreview(message)}
        <div
          className={`break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere] ${
            own
              ? 'rounded-tr-md bg-gradient-to-r from-cyan-500 to-blue-600 text-white'
              : 'rounded-tl-md bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
          }`}
        >
          {deleted ? (
            <span className="italic opacity-70">{tr('chat.deletedNotice')}</span>
          ) : (
            renderMessageContent(message.content, own)
          )}
        </div>
        {editingMessage?.id === message.id && (
          <span className="mt-1 text-xs text-cyan-600 dark:text-cyan-400">
            {tr('chat.editing')}
          </span>
        )}
      </div>
    );

    const timeLabel = (
      <span className="shrink-0 self-end pb-0.5 text-[11px] text-slate-400 dark:text-slate-500">
        {time}
      </span>
    );

    if (own) {
      return (
        <div
          data-mid={message.id}
          className={`group flex justify-end ${showHeader ? 'mt-3' : 'mt-1'}`}
        >
          <div className="flex max-w-[88%] items-stretch gap-1.5">
            {actions}
            {timeLabel}
            {bubble}
          </div>
        </div>
      );
    }

    return (
      <div
        data-mid={message.id}
        className={`group flex justify-start ${showHeader ? 'mt-3' : 'mt-1'}`}
      >
        <div className="flex max-w-[88%] gap-2">
          <div className="flex w-8 shrink-0 flex-col items-center">
            {showHeader ? (
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${getAvatarColor(message.nickname)} text-sm font-bold text-white shadow-md`}
              >
                {getInitial(message.nickname)}
              </div>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col">
            {showHeader && (
              <span className="mb-0.5 text-sm font-semibold text-slate-700 dark:text-slate-300">
                {message.nickname}
              </span>
            )}

            <div className="flex items-stretch gap-1.5">
              {bubble}
              {timeLabel}
              {actions}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderMessages = () => {
    const nodes: React.ReactNode[] = [];

    messages.forEach((message, index) => {
      const previous = messages[index - 1];
      const day = new Date(message.created_at).toDateString();
      const newDay = !previous || new Date(previous.created_at).toDateString() !== day;

      if (newDay) {
        nodes.push(
          <div
            key={`day-${message.id}`}
            className="my-4 flex items-center justify-center"
          >
            <span className="rounded-full bg-slate-200/70 px-3 py-1 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {dateFormatter.format(new Date(message.created_at))}
            </span>
          </div>
        );
      }

      if (message.is_system) {
        nodes.push(
          <div
            key={message.id}
            data-mid={message.id}
            className="my-2 flex justify-center"
          >
            <span className="max-w-[90%] rounded-full bg-slate-200/70 px-3 py-1 text-center text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {translateSystemMessage(message.content)}
            </span>
          </div>
        );
        return;
      }

      const own = message.nickname.toLocaleLowerCase() === nicknameLower;

      const sameSender =
        previous &&
        !previous.is_system &&
        previous.nickname.toLocaleLowerCase() ===
          message.nickname.toLocaleLowerCase();

      const timeGap =
        !previous ||
        new Date(message.created_at).getTime() -
          new Date(previous.created_at).getTime() >
          5 * 60 * 1000;

      const showHeader = newDay || !sameSender || timeGap;

      nodes.push(
        <div key={message.id} className="animate-fadeIn">
          {renderMessageRow(message, { own, showHeader })}
        </div>
      );
    });

    return nodes;
  };

  const onlineLower = new Set(
    onlineNicknames.map((name) => name.toLocaleLowerCase())
  );
  const onlineCount = Math.max(onlineNicknames.length, 1);
  const showJumpButton = farFromBottom || hasNewer;

  const sendDisabled =
    !input.trim() || sending || actionBusy || (!editingMessage && cooldown > 0);

  return (
    <div
      className="flex h-[100dvh] flex-col bg-slate-50 dark:bg-slate-950"
      onClick={() => {
        if (openMessageMenuId) setOpenMessageMenuId(null);
      }}
    >
      <header className="z-20 flex shrink-0 items-center justify-between border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur-xl sm:px-6 dark:border-slate-800 dark:bg-slate-900/80">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={handleBackToHub}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
            title={tr('chat.backToHub')}
            aria-label={tr('chat.backToHub')}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 shadow-lg shadow-cyan-500/20">
            <MessageCircle className="h-5 w-5 text-white" strokeWidth={2.5} />
          </div>

          <div className="min-w-0">
            <h1 className="flex items-center gap-1.5 truncate text-lg font-bold leading-tight text-slate-900 dark:text-white">
              <span className="truncate">{roomInfo.name}</span>
              {roomInfo.visibility === 'restricted' && !isSupportRoom && (
                <Lock className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              )}
            </h1>

            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <Hash className="h-3 w-3" />
                {roomInfo.code}
              </span>
              {role === 'owner' && (
                <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                  {tr('chat.owner')}
                </span>
              )}
              {role === 'co_admin' && (
                <span className="rounded-md bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                  {tr('chat.coAdmin')}
                </span>
              )}
              {role === 'admin' && (
                <span className="rounded-md bg-cyan-100 px-2 py-0.5 text-xs font-semibold text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300">
                  {tr('chat.siteAdmin')}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => void openMembers()}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-2 text-xs font-medium text-slate-600 transition hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:text-white"
            title={tr('chat.members')}
          >
            <Users className="h-4 w-4" />
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
              {onlineCount}
            </span>
          </button>

          {canManage && (
            <button
              type="button"
              onClick={() => void openSettings()}
              title={tr('chat.settings')}
              aria-label={tr('chat.settings')}
              className="rounded-lg border border-slate-200 bg-slate-100 p-2 text-slate-500 transition hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:text-white"
            >
              <Settings className="h-4 w-4" />
            </button>
          )}

          <NotificationToggle />

          <LanguageToggle />

          <button
            type="button"
            onClick={toggleTheme}
            title={tr('chat.theme')}
            className="rounded-lg border border-slate-200 bg-slate-100 p-2 text-slate-500 transition hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:text-white"
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>

          <div className="hidden items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 md:flex dark:bg-slate-800/60">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br ${getAvatarColor(nickname)} text-sm font-bold text-white`}
            >
              {getInitial(nickname)}
            </div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {nickname}
            </span>
          </div>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          style={{ overflowAnchor: 'none' }}
          className="h-full overflow-y-auto overscroll-contain px-4 py-4 sm:px-6"
        >
          <div className="mx-auto max-w-3xl">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-slate-500">
                <Loader2 className="mb-3 h-8 w-8 animate-spin" />
                <p className="text-sm">{tr('chat.loading')}</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-slate-500">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
                  <MessageCircle className="h-8 w-8 text-slate-300 dark:text-slate-600" />
                </div>
                <p className="font-medium text-slate-500 dark:text-slate-400">
                  {tr('chat.empty')}
                </p>
                <p className="mt-1 text-sm text-slate-400 dark:text-slate-600">
                  {tr('chat.emptyHint')}
                </p>
              </div>
            ) : (
              <>
                {/* 높이를 고정해 두어서 로딩 표시가 켜지고 꺼져도 스크롤이 흔들리지 않는다 */}
                <div className="flex h-8 items-center justify-center text-xs text-slate-400 dark:text-slate-500">
                  {loadingOlder ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : hasOlder ? (
                    <button
                      type="button"
                      onClick={() => void loadOlder()}
                      className="rounded-md px-2 py-1 hover:text-cyan-500"
                    >
                      {tr('chat.loadOlder')}
                    </button>
                  ) : (
                    tr('chat.startOfChat')
                  )}
                </div>

                {renderMessages()}

                <div className="flex h-8 items-center justify-center text-xs text-slate-400 dark:text-slate-500">
                  {loadingNewer && <Loader2 className="h-4 w-4 animate-spin" />}
                </div>
              </>
            )}
          </div>
        </div>

        {showJumpButton && !loading && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-3 right-4 flex items-center gap-1.5 rounded-full bg-cyan-500 px-3.5 py-2 text-xs font-semibold text-white shadow-lg shadow-cyan-500/30 transition hover:bg-cyan-400"
          >
            <ChevronDown className="h-4 w-4" />
            {awayCount > 0 ? tr('chat.newMessages', { n: awayCount }) : tr('chat.jumpLatest')}
          </button>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-white/80 px-4 pb-4 pt-2 backdrop-blur-xl sm:px-6 dark:border-slate-800 dark:bg-slate-900/80">
        {/* 입력 중 표시는 스크롤 영역 밖에 두어서 위치가 흔들리지 않게 한다 */}
        <div
          className="mx-auto h-5 max-w-3xl px-1 text-xs text-slate-400 dark:text-slate-500"
          aria-live="polite"
        >
          {typingNicknames.length === 1
            ? tr('chat.typingOne', { name: typingNicknames[0] })
            : typingNicknames.length > 1
              ? tr('chat.typingMany', { name: typingNicknames[0], n: typingNicknames.length - 1 })
              : ''}
        </div>

        {actionError && (
          <div className="mx-auto mb-2 flex w-full max-w-3xl items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
            <span>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError('')}
              className="ml-2 rounded p-1 hover:bg-red-100 dark:hover:bg-red-950/50"
              aria-label={tr('chat.closeError')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {(replyTo || editingMessage) && (
          <div className="mx-auto mb-3 flex max-w-3xl items-center justify-between rounded-xl border-l-4 border-cyan-500 bg-slate-100 px-3 py-2 dark:bg-slate-800">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-cyan-600 dark:text-cyan-400">
                {editingMessage
                  ? tr('chat.editMessage')
                  : tr('chat.replyTo', { name: replyTo?.nickname ?? '' })}
              </p>
              <p className="truncate text-sm text-slate-600 dark:text-slate-300">
                {editingMessage?.content ?? replyTo?.content ?? ''}
              </p>
            </div>

            <button
              type="button"
              onClick={editingMessage ? cancelEditing : () => setReplyTo(null)}
              className="ml-3 rounded-lg p-2 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 dark:hover:bg-slate-700 dark:hover:text-white"
              title={tr('chat.cancel')}
              aria-label={tr('chat.cancel')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <form
          onSubmit={handleSend}
          className="mx-auto flex max-w-3xl items-center gap-2 sm:gap-3"
        >
          {!editingMessage && (
            <button
              type="button"
              onClick={() => setShowLinkDialog(true)}
              className="shrink-0 rounded-xl border border-slate-200 bg-slate-100 p-3.5 text-slate-500 hover:text-cyan-500 dark:border-slate-700 dark:bg-slate-800"
              title={tr('chat.insertLink')}
              aria-label={tr('chat.insertLink')}
            >
              <LinkIcon className="h-5 w-5" />
            </button>
          )}

          <div className="relative min-w-0 flex-1">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(event) => handleInputChange(event.target.value)}
              placeholder={
                editingMessage
                  ? tr('chat.phEdit')
                  : cooldown > 0
                    ? tr('chat.phCooldown', { n: cooldown })
                    : replyTo
                      ? tr('chat.phReply', { name: replyTo.nickname })
                      : tr('chat.phSend', { room: roomInfo.name })
              }
              maxLength={500}
              className="w-full rounded-xl border border-slate-200 bg-slate-100 px-4 py-3.5 text-slate-900 transition-all placeholder:text-slate-400 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-800/60 dark:text-white dark:placeholder:text-slate-500"
            />
          </div>

          {editingMessage && (
            <button
              type="button"
              onClick={cancelEditing}
              className="flex shrink-0 items-center justify-center rounded-xl border border-slate-200 p-3.5 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              title={tr('chat.cancelEdit')}
            >
              <X className="h-5 w-5" />
            </button>
          )}

          <button
            type="submit"
            disabled={sendDisabled}
            className="flex min-w-[3.25rem] shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 p-3.5 text-white shadow-lg shadow-cyan-500/20 transition-all hover:from-cyan-400 hover:to-blue-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            title={editingMessage ? tr('chat.saveEdit') : tr('chat.send')}
          >
            {sending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : editingMessage ? (
              <Check className="h-5 w-5" />
            ) : !editingMessage && cooldown > 0 ? (
              <span className="text-sm font-semibold tabular-nums">
                {cooldown}s
              </span>
            ) : (
              <Send className="h-5 w-5" />
            )}
          </button>
        </form>
      </div>

      {/* 링크 삽입 */}
      {showLinkDialog && (
        <ModalShell
          title={tr('chat.insertLink')}
          onClose={() => {
            setShowLinkDialog(false);
            setLinkError('');
          }}
        >
          <input
            type="text"
            value={linkUrl}
            autoFocus
            onChange={(event) => {
              setLinkUrl(event.target.value);
              setLinkError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                insertLink();
              }
            }}
            placeholder="https://example.com"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />

          {linkError && <p className="mt-2 text-sm text-red-500">{linkError}</p>}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowLinkDialog(false);
                setLinkError('');
              }}
              className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {tr('common.cancel')}
            </button>
            <button
              type="button"
              onClick={insertLink}
              className="rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-sm font-semibold text-white"
            >
              {tr('chat.addToInput')}
            </button>
          </div>
        </ModalShell>
      )}

      {/* 링크 열기 확인: 진짜 <a> 링크라서 팝업 차단에 걸리지 않는다 */}
      {pendingLink && (
        <ModalShell title={tr('chat.openLinkTitle')} onClose={() => setPendingLink(null)}>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {tr('chat.openLinkBodyPre')}
            <strong className="text-slate-800 dark:text-slate-100">
              {getHostname(pendingLink)}
            </strong>
            {tr('chat.openLinkBodyPost')}
          </p>
          <p className="mt-2 break-all rounded-lg bg-slate-100 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {pendingLink}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingLink(null)}
              className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {tr('common.cancel')}
            </button>
            <a
              href={pendingLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setPendingLink(null)}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-sm font-semibold text-white"
            >
              <ExternalLink className="h-4 w-4" />
              {tr('chat.open')}
            </a>
          </div>
        </ModalShell>
      )}

      {/* 참여자 */}
      {showMembers && (
        <ModalShell
          title={`${tr('chat.membersTitle')}${members.length ? ` (${members.length})` : ''}`}
          onClose={() => setShowMembers(false)}
        >
          {membersLoading ? (
            <div className="flex justify-center py-8 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : membersError ? (
            <p className="text-sm text-red-500">{membersError}</p>
          ) : (
            <ul className="space-y-1">
              {members.map((member) => {
                const online = onlineLower.has(
                  member.nickname.toLocaleLowerCase()
                );

                return (
                  <li
                    key={member.nickname}
                    className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${getAvatarColor(member.nickname)} text-sm font-bold text-white`}
                    >
                      {getInitial(member.nickname)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                        {member.nickname}
                        {member.nickname.toLocaleLowerCase() ===
                          nicknameLower && (
                          <span className="ml-1 text-xs text-slate-400">
                            {tr('common.me')}
                          </span>
                        )}
                      </p>
                    </div>

                    {member.role === 'owner' && (
                      <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                        {tr('chat.owner')}
                      </span>
                    )}
                    {member.role === 'co_admin' && (
                      <span className="rounded-md bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                        {tr('chat.coAdmin')}
                      </span>
                    )}

                    <span
                      className={`flex items-center gap-1 text-xs ${
                        online
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          online
                            ? 'bg-emerald-500 dark:bg-emerald-400'
                            : 'bg-slate-300 dark:bg-slate-600'
                        }`}
                      />
                      {online ? tr('chat.online') : tr('chat.offline')}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </ModalShell>
      )}

      {/* 방 설정: 이름 변경 / 비밀번호 */}
      {showSettings && (
        <ModalShell title={tr('chat.settings')} onClose={() => setShowSettings(false)}>
          <section>
            <label
              htmlFor="room-rename"
              className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
            >
              {tr('chat.roomName')}
            </label>
            <div className="flex gap-2">
              <input
                id="room-rename"
                value={renameValue}
                maxLength={50}
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleRename();
                  }
                }}
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <button
                type="button"
                disabled={
                  settingsBusy ||
                  renameValue.trim().length < 2 ||
                  renameValue.trim() === roomInfo.name
                }
                onClick={() => void handleRename()}
                className="rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-400 disabled:opacity-40"
              >
                {tr('chat.rename')}
              </button>
            </div>
          </section>

          <section className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-800">
            <div className="mb-2 flex items-center gap-2">
              <Lock className="h-4 w-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {tr('chat.roomPassword')}
              </h3>
              <span
                className={`rounded-md px-2 py-0.5 text-xs ${
                  roomInfo.visibility === 'restricted'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                }`}
              >
                {roomInfo.visibility === 'restricted' ? tr('chat.privateRoom') : tr('chat.publicRoom')}
              </span>
            </div>

            {roomInfo.visibility === 'restricted' && passwordIsSet === false && (
              <p className="mb-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                {tr('chat.noPasswordYet')}
              </p>
            )}

            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
              {roomInfo.visibility === 'restricted'
                ? tr('chat.restrictedInfo')
                : tr('chat.publicInfo')}
            </p>

            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              maxLength={128}
              onChange={(event) => setNewPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void applyPassword(newPassword);
                }
              }}
              placeholder={
                roomInfo.visibility === 'restricted'
                  ? tr('chat.phNewPw')
                  : tr('chat.phPw')
              }
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none focus:border-amber-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={settingsBusy || newPassword.length < 4}
                onClick={() => void applyPassword(newPassword)}
                className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-400 disabled:opacity-40"
              >
                {roomInfo.visibility === 'restricted'
                  ? tr('chat.changePw')
                  : tr('chat.setPw')}
              </button>

              {roomInfo.visibility === 'restricted' && (
                <button
                  type="button"
                  disabled={settingsBusy}
                  onClick={() => void applyPassword(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {tr('chat.clearPw')}
                </button>
              )}
            </div>
          </section>

          {settingsBusy && (
            <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              {tr('chat.saving')}
            </div>
          )}

          {settingsNotice && (
            <p
              role={settingsNotice.kind === 'error' ? 'alert' : 'status'}
              className={`mt-4 rounded-lg px-3 py-2 text-sm ${
                settingsNotice.kind === 'error'
                  ? 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'
                  : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
              }`}
            >
              {settingsNotice.text}
            </p>
          )}
        </ModalShell>
      )}

      {/* 메시지 삭제 확인 */}
      {deletingMessage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => {
            if (!actionBusy) setDeletingMessage(null);
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400">
              <Trash2 className="h-6 w-6" />
            </div>

            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {tr('chat.deleteConfirmTitle')}
            </h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {tr('chat.deleteConfirmBody')}
            </p>

            <div className="mt-4 max-h-24 overflow-hidden rounded-xl bg-slate-100 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {deletingMessage.content}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => setDeletingMessage(null)}
                className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
              >
                {tr('common.cancel')}
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void confirmDelete()}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {actionBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                {tr('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
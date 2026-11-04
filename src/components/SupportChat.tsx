import { useCallback, useEffect, useRef, useState } from 'react';
import { LifeBuoy, Loader2, Send, X } from 'lucide-react';

import { dateLocale, tr, useLang } from '@/lib/i18n';
import LanguageToggle from '@/components/LanguageToggle';

import {
  adminGetSupportMessages,
  adminReplySupport,
  getMySupportMessages,
  sendSupportMessage,
  type SupportMessage,
} from '@/lib/rooms';

type Props = {
  /** user: 내 문의 대화 / admin: 특정 유저의 문의 대화에 답변 */
  mode: 'user' | 'admin';
  /** admin 모드에서 대화 상대(문의한 유저) */
  userNickname?: string;
  onClose: () => void;
};

const POLL_MS = 4000;
const MAX_LENGTH = 500;

function formatTime(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString(dateLocale(), {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * 관리자 문의 대화창. 채팅방이 아니라 문의 전용 대화라서
 * 유저가 문의를 열어도 새 방이 생기지 않는다.
 * (비공개 대화라 실시간 구독 대신 몇 초마다 새 메시지만 확인한다)
 */
export default function SupportChat({ mode, userNickname, onClose }: Props) {
  useLang();

  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const lastCursorRef = useRef<string | undefined>(undefined);

  const fetchMessages = useCallback(
    (after?: string) =>
      mode === 'admin' && userNickname
        ? adminGetSupportMessages(userNickname, after)
        : getMySupportMessages(after),
    [mode, userNickname]
  );

  // 처음 불러오기
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const res = await fetchMessages();

      if (cancelled) return;

      if (res.ok) {
        setMessages(res.data);
        lastCursorRef.current = res.data.at(-1)?.created_at;
      } else {
        setError(res.error);
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchMessages]);

  // 새 메시지 확인
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (document.hidden || cancelled) return;

      const res = await fetchMessages(lastCursorRef.current);

      if (cancelled || !res.ok || res.data.length === 0) return;

      lastCursorRef.current = res.data.at(-1)?.created_at;

      setMessages((current) => {
        const known = new Set(current.map((m) => m.id));
        const fresh = res.data.filter((m) => !known.has(m.id));

        return fresh.length ? [...current, ...fresh] : current;
      });
    };

    const timer = window.setInterval(() => void poll(), POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [fetchMessages]);

  // 맨 아래를 보고 있을 때만 새 메시지에 맞춰 내려간다
  useEffect(() => {
    const el = listRef.current;

    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  const handleScroll = () => {
    const el = listRef.current;

    if (!el) return;

    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const handleSend = async () => {
    const text = draft.trim();

    if (!text || sending) return;

    setSending(true);
    setError('');

    const res =
      mode === 'admin' && userNickname
        ? await adminReplySupport(userNickname, text)
        : await sendSupportMessage(text);

    if (!res.ok) {
      setError(res.error);
      setSending(false);
      return;
    }

    setDraft('');
    stickToBottomRef.current = true;

    const latest = await fetchMessages(lastCursorRef.current);

    if (latest.ok && latest.data.length > 0) {
      lastCursorRef.current = latest.data.at(-1)?.created_at;

      setMessages((current) => {
        const known = new Set(current.map((m) => m.id));

        return [...current, ...latest.data.filter((m) => !known.has(m.id))];
      });
    }

    setSending(false);
  };

  const title =
    mode === 'admin'
      ? tr('support.threadTitle', { name: userNickname ?? '' })
      : tr('support.title');

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="flex h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-white sm:h-[70vh] sm:rounded-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-2">
            <LifeBuoy className="h-5 w-5 shrink-0 text-cyan-500" />
            <h2 className="truncate font-bold">{title}</h2>
          </div>
          <div className="flex items-center gap-1">
          <LanguageToggle />
          <button
            type="button"
            onClick={onClose}
            aria-label={tr('common.close')}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
          </div>
        </header>

        <div
          ref={listRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4 dark:bg-slate-950/40"
        >
          {loading ? (
            <div className="flex justify-center py-12 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <p className="py-12 text-center text-sm leading-6 text-slate-500 dark:text-slate-400">
              {mode === 'user' ? tr('support.emptyUser') : tr('support.emptyAdmin')}
            </p>
          ) : (
            messages.map((message) => {
              const mine = message.from_admin === (mode === 'admin');

              return (
                <div
                  key={message.id}
                  className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}
                >
                  <span className="mb-1 text-xs text-slate-500 dark:text-slate-400">
                    {message.from_admin ? tr('support.admin') : message.sender_nickname}
                  </span>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-6 ${
                      mine
                        ? 'bg-cyan-500 text-white'
                        : 'border border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
                    }`}
                  >
                    {message.content}
                  </div>
                  <span className="mt-1 text-[11px] text-slate-400">
                    {formatTime(message.created_at)}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-950/30 dark:text-red-400"
          >
            {error}
          </p>
        )}

        <footer className="flex items-end gap-2 border-t border-slate-200 p-3 dark:border-slate-800">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void handleSend();
              }
            }}
            maxLength={MAX_LENGTH}
            rows={1}
            placeholder={
              mode === 'admin' ? tr('support.phAdmin') : tr('support.phUser')
            }
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || draft.trim().length === 0}
            aria-label={tr('support.send')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500 text-white transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </footer>
      </section>
    </div>
  );
}
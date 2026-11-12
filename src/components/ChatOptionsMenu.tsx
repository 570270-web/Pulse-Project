import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  Languages,
  Moon,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sun,
} from 'lucide-react';

import { tr, useLang } from '@/lib/i18n';
import { useTheme } from '@/lib/useTheme';
import { useLeaveGuard } from '@/lib/leaveGuard';
import {
  disableNotifications,
  enableNotifications,
  getNotifyState,
  type NotifyState,
} from '@/lib/notify';

type Props = {
  canManage: boolean;
  onOpenRoomSettings: () => void;
};

const ITEM_CLASS =
  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';
const ON_TEXT = 'font-semibold text-emerald-700 dark:text-emerald-300';

/** 켜짐/꺼짐을 한눈에 보여주는 작은 스위치 */
function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition ${
        on ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
      }`}
    >
      <span
        className={`h-3 w-3 rounded-full bg-white shadow transition ${
          on ? 'translate-x-3' : ''
        }`}
      />
    </span>
  );
}

/**
 * 채팅 화면 오른쪽 위 톱니바퀴 메뉴.
 * 흩어져 있던 방 설정·테마·언어·알림·새로고침 방지 버튼을 여기 하나로 모았다.
 */
export default function ChatOptionsMenu({
  canManage,
  onOpenRoomSettings,
}: Props) {
  const { lang, setLang } = useLang();
  const { theme, toggleTheme } = useTheme();
  const leaveGuard = useLeaveGuard();

  const [open, setOpen] = useState(false);
  const [notifyState, setNotifyState] = useState<NotifyState>(() =>
    getNotifyState()
  );
  const [hint, setHint] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleNotify = async () => {
    setHint('');

    if (notifyState === 'on') {
      setNotifyState(disableNotifications());
      return;
    }

    const next = await enableNotifications();

    setNotifyState(next);

    if (next === 'blocked') setHint(tr('notify.blocked'));
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={tr('chat.options')}
        aria-label={tr('chat.options')}
        className={`rounded-lg border p-2 transition ${
          open
            ? 'border-cyan-300 bg-cyan-50 text-cyan-600 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-300'
            : 'border-slate-200 bg-slate-100 text-slate-500 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:text-white'
        }`}
      >
        <Settings className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={tr('chat.options')}
          className="absolute right-0 top-full z-40 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          {canManage && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onOpenRoomSettings();
                }}
                className={ITEM_CLASS}
              >
                <Settings className="h-4 w-4 shrink-0 text-slate-400" />
                {tr('chat.settings')}
              </button>

              <div className="my-1 h-px bg-slate-200 dark:bg-slate-700" />
            </>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={toggleTheme}
            className={ITEM_CLASS}
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4 shrink-0 text-slate-400" />
            ) : (
              <Moon className="h-4 w-4 shrink-0 text-slate-400" />
            )}
            <span className="flex-1">
              {theme === 'dark' ? tr('chat.themeLight') : tr('chat.themeDark')}
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')}
            className={ITEM_CLASS}
          >
            <Languages className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="flex-1">{tr('chat.language')}</span>
            <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">
              {lang === 'ko' ? '한국어' : 'English'}
            </span>
          </button>

          {notifyState !== 'unsupported' && (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={notifyState === 'on'}
              onClick={() => void handleNotify()}
              className={ITEM_CLASS}
            >
              {notifyState === 'on' ? (
                <Bell className="h-4 w-4 shrink-0 text-emerald-500 dark:text-emerald-400" />
              ) : (
                <BellOff className="h-4 w-4 shrink-0 text-slate-400" />
              )}
              <span
                className={`flex-1 ${
                  notifyState === 'on' ? ON_TEXT : ''
                }`}
              >
                {tr('chat.notify')}
              </span>
              <Switch on={notifyState === 'on'} />
            </button>
          )}

          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={leaveGuard.on}
            onClick={leaveGuard.toggle}
            className={ITEM_CLASS}
          >
            {leaveGuard.on ? (
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500 dark:text-emerald-400" />
            ) : (
              <ShieldAlert className="h-4 w-4 shrink-0 text-slate-400" />
            )}
            <span
              className={`flex-1 ${leaveGuard.on ? ON_TEXT : ''}`}
            >
              {tr('chat.leaveGuard')}
            </span>
            <Switch on={leaveGuard.on} />
          </button>

          {hint && (
            <p
              role="status"
              className="px-3 py-2 text-xs leading-5 text-amber-600 dark:text-amber-300"
            >
              {hint}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

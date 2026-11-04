import { useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
 
import {
  disableNotifications,
  enableNotifications,
  getNotifyState,
  type NotifyState,
} from '@/lib/notify';
import { tr, useLang } from '@/lib/i18n';
 
/** 알림 켜기/끄기 버튼 (채팅 화면 위쪽) */
export default function NotificationToggle() {
  useLang();
 
  const [state, setState] = useState<NotifyState>(() => getNotifyState());
  const [hint, setHint] = useState('');
 
  if (state === 'unsupported') return null;
 
  const handleClick = async () => {
    setHint('');
 
    if (state === 'on') {
      setState(disableNotifications());
      return;
    }
 
    const next = await enableNotifications();
 
    setState(next);
 
    if (next === 'blocked') setHint(tr('notify.blocked'));
  };
 
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void handleClick()}
        title={state === 'on' ? tr('notify.turnOff') : tr('notify.turnOn')}
        aria-label={state === 'on' ? tr('notify.turnOff') : tr('notify.turnOn')}
        aria-pressed={state === 'on'}
        className={`rounded-lg border p-2 transition ${
          state === 'on'
            ? 'border-cyan-300 bg-cyan-50 text-cyan-600 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-300'
            : 'border-slate-200 bg-slate-100 text-slate-500 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:text-white'
        }`}
      >
        {state === 'on' ? (
          <Bell className="h-4 w-4" />
        ) : (
          <BellOff className="h-4 w-4" />
        )}
      </button>
 
      {hint && (
        <p
          role="status"
          className="absolute right-0 top-full z-30 mt-2 w-60 rounded-lg border border-amber-200 bg-white p-2.5 text-xs text-amber-700 shadow-lg dark:border-amber-500/30 dark:bg-slate-900 dark:text-amber-300"
        >
          {hint}
        </p>
      )}
    </div>
  );
}
 
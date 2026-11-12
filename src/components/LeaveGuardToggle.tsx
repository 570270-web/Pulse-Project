import { ShieldAlert, ShieldCheck } from 'lucide-react';

import { tr, useLang } from '@/lib/i18n';
import { useLeaveGuard } from '@/lib/leaveGuard';

/** 사이드바의 새로고침·탭 닫기 방지 토글 */
export default function LeaveGuardToggle() {
  useLang();

  const { on, toggle } = useLeaveGuard();
  const label = on ? tr('guard.turnOff') : tr('guard.turnOn');

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      aria-pressed={on}
      className={`flex h-10 w-10 items-center justify-center rounded-xl transition ${
        on
          ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-white'
      }`}
    >
      {on ? (
        <ShieldCheck className="h-5 w-5" />
      ) : (
        <ShieldAlert className="h-5 w-5" />
      )}
    </button>
  );
}

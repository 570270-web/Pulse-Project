import { useEffect, useState } from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';

import { tr, useLang } from '@/lib/i18n';

const STORAGE_KEY = 'pulse_leave_guard';

function readInitial(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * 새로고침·탭 닫기 전에 브라우저 확인창을 띄우는 토글 (채팅 화면 위쪽).
 * 실수로 새로고침해서 쓰던 내용을 날리는 걸 막는다.
 */
export default function LeaveGuardToggle() {
  useLang();

  const [on, setOn] = useState<boolean>(readInitial);

  useEffect(() => {
    if (!on) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // 예전 브라우저는 returnValue 가 있어야 확인창을 띄운다
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [on]);

  const handleClick = () => {
    const next = !on;

    setOn(next);

    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // 저장 실패는 무시 (이번 접속 동안만 적용됨)
    }
  };

  const label = on ? tr('guard.turnOff') : tr('guard.turnOn');

  return (
    <button
      type="button"
      onClick={handleClick}
      title={label}
      aria-label={label}
      aria-pressed={on}
      className={`rounded-lg border p-2 transition ${
        on
          ? 'border-amber-300 bg-amber-50 text-amber-600 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300'
          : 'border-slate-200 bg-slate-100 text-slate-500 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:text-white'
      }`}
    >
      {on ? (
        <ShieldCheck className="h-4 w-4" />
      ) : (
        <ShieldAlert className="h-4 w-4" />
      )}
    </button>
  );
}

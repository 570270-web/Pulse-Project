import { useEffect, useState } from 'react';

const STORAGE_KEY = 'pulse_leave_guard';
const listeners = new Set<(on: boolean) => void>();

/** 새로고침·탭 닫기 확인창 설정이 켜져 있는지 (브라우저에 저장됨) */
export function getLeaveGuard(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setLeaveGuard(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // 저장 실패는 무시 (이번 접속 동안만 적용됨)
  }

  listeners.forEach((listener) => listener(on));
}

/**
 * 확인창은 한 번만 등록하면 되므로 모듈이 로드될 때 붙이고,
 * 이벤트 시점에 현재 설정을 다시 읽는다 (사이드바/채팅 메뉴가 같이 쓴다).
 */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (!getLeaveGuard()) return;

    event.preventDefault();
    event.returnValue = '';
  });
}

/** 설정 상태와 토글. 여러 곳에서 써도 같은 값을 본다. */
export function useLeaveGuard(): { on: boolean; toggle: () => void } {
  const [on, setOn] = useState<boolean>(getLeaveGuard);

  useEffect(() => {
    const listener = (next: boolean) => setOn(next);

    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }, []);

  return { on, toggle: () => setLeaveGuard(!on) };
}

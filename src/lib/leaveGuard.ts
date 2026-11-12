import { useEffect, useState } from 'react';

/**
 * 새로고침·탭 닫기 확인창은 브라우저가 "페이지를 새로 연 직후"에는 다시 물어봐 주지
 * 않는 경우가 있어서, 저장해 두면 UI 는 켜져 있는데 실제로는 안 막히는 상태가 된다.
 * 그래서 이 설정은 저장하지 않고 페이지를 열 때마다 항상 꺼진 상태로 시작한다.
 */
let guardOn = false;

const listeners = new Set<(on: boolean) => void>();

export function getLeaveGuard(): boolean {
  return guardOn;
}

export function setLeaveGuard(on: boolean): void {
  guardOn = on;

  listeners.forEach((listener) => listener(on));
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (!guardOn) return;

    event.preventDefault();
    event.returnValue = '';
  });
}

/** 설정 상태와 토글. 여러 곳에서 써도 같은 값을 본다. */
export function useLeaveGuard(): { on: boolean; toggle: () => void } {
  const [on, setOn] = useState<boolean>(guardOn);

  useEffect(() => {
    const listener = (next: boolean) => setOn(next);

    listeners.add(listener);
    // 마운트 사이에 다른 곳에서 바뀌었을 수 있다
    setOn(guardOn);

    return () => {
      listeners.delete(listener);
    };
  }, []);

  return { on, toggle: () => setLeaveGuard(!guardOn) };
}

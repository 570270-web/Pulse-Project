/**
 * 브라우저 알림 (탭이 보이지 않을 때 새 메시지를 알려준다).
 * 사이트가 열려 있는 동안만 동작한다. 사이트를 닫은 뒤에도 받는 "진짜 푸시"는
 * 서비스 워커와 푸시 서버가 따로 필요해서 이 모듈의 범위가 아니다.
 */

const STORAGE_KEY = 'pulse_notify';

export type NotifyState = 'on' | 'off' | 'blocked' | 'unsupported';

function supported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

function writeEnabled(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // 저장 실패는 무시 (이번 접속 동안만 적용됨)
  }
}

let enabledCache = readEnabled();

export function getNotifyState(): NotifyState {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';

  return enabledCache && Notification.permission === 'granted' ? 'on' : 'off';
}

/** 켜기: 필요하면 브라우저 권한을 물어본다. 결과 상태를 돌려준다. */
export async function enableNotifications(): Promise<NotifyState> {
  if (!supported()) return 'unsupported';

  let permission = Notification.permission;

  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = Notification.permission;
    }
  }

  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'off';

  enabledCache = true;
  writeEnabled(true);

  return 'on';
}

export function disableNotifications(): NotifyState {
  enabledCache = false;
  writeEnabled(false);

  return getNotifyState();
}

/** 탭이 보이는 중이면 알리지 않는다. 같은 메시지는 한 번만 알린다. */
const notified = new Set<string>();

export function notifyNewMessage(opts: {
  id: string;
  title: string;
  body: string;
}): void {
  if (getNotifyState() !== 'on') return;
  if (typeof document !== 'undefined' && !document.hidden && document.hasFocus()) {
    return;
  }
  if (notified.has(opts.id)) return;

  notified.add(opts.id);

  if (notified.size > 200) {
    const first = notified.values().next().value;
    if (first !== undefined) notified.delete(first);
  }

  try {
    const notification = new Notification(opts.title, {
      body: opts.body.length > 100 ? `${opts.body.slice(0, 100)}…` : opts.body,
      tag: opts.id,
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // 일부 모바일 브라우저는 Notification 생성자를 막는다 → 조용히 무시
  }
}
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables');
}

const DEVICE_KEY = 'pulse_device_id';
const DEVICE_COOKIE = 'pulse_device_id';
const DEVICE_ID_PATTERN = /^[0-9a-f]{32}$/;

function readCookie(name: string): string {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));

    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

function writeCookie(name: string, value: string): void {
  try {
    document.cookie = `${name}=${encodeURIComponent(
      value
    )}; Max-Age=63072000; Path=/; SameSite=Lax`;
  } catch {
    // 쿠키를 못 쓰면 localStorage 만 쓴다
  }
}

/**
 * 이 브라우저(기기)를 구분하는 값. 관리자의 "기기 밴" 기준이 된다.
 * localStorage 와 쿠키에 함께 남겨서, 하나만 지워도 같은 기기로 유지된다.
 */
export function getDeviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_KEY);

    if (stored && DEVICE_ID_PATTERN.test(stored)) {
      writeCookie(DEVICE_COOKIE, stored);
      return stored;
    }

    const fromCookie = readCookie(DEVICE_COOKIE);

    if (DEVICE_ID_PATTERN.test(fromCookie)) {
      localStorage.setItem(DEVICE_KEY, fromCookie);
      return fromCookie;
    }

    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const next = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
      ''
    );

    localStorage.setItem(DEVICE_KEY, next);
    writeCookie(DEVICE_COOKIE, next);

    return next;
  } catch {
    // 저장소를 쓸 수 없으면 기기 식별 불가
    return '';
  }
}

const deviceId = getDeviceId();

const deviceHeaders: Record<string, string> = {};

if (deviceId) deviceHeaders['x-pulse-device'] = deviceId;

export const supabase: SupabaseClient = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder-anon-key',
  {
    auth: { persistSession: false },
    // 모든 RPC 호출에 기기 ID 를 같이 보낸다 (서버가 기기 밴을 판정)
    global: {
      headers: deviceHeaders,
    },
  }
);

const TOKEN_KEY = 'chat_session_token';

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export type Message = {
  id: string;
  nickname: string;
  content: string;
  created_at: string;
  reply_to_id?: string | null;
  deleted?: boolean;
  is_system?: boolean;
  /** 버킷(chat-images) 안의 객체 경로. 있으면 사진이 달린 메시지 */
  attachment_path?: string | null;
};

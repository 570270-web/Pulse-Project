import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables');
}

const DEVICE_KEY = 'pulse_device_id';

/**
 * 이 브라우저(기기)를 구분하는 값. 관리자의 "기기 밴" 기준이 된다.
 * 계정과 무관하게 브라우저에 남기 때문에, 같은 기기에서 새 계정을 만들어도 그대로 적용된다.
 */
export function getDeviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_KEY);

    if (stored && /^[0-9a-f]{32}$/.test(stored)) return stored;

    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const next = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
      ''
    );

    localStorage.setItem(DEVICE_KEY, next);

    return next;
  } catch {
    // 저장소를 쓸 수 없으면 기기 식별 불가
    return '';
  }
}

const deviceId = getDeviceId();

export const supabase: SupabaseClient = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder-anon-key',
  {
    auth: { persistSession: false },
    // 모든 RPC 호출에 기기 ID를 같이 보낸다 (서버가 기기 밴을 판정)
    global: {
      headers: deviceId ? { 'x-pulse-device': deviceId } : {},
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

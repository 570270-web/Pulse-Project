import { useEffect, useState } from 'react';
import AuthScreen from '@/components/AuthScreen';
import ChatScreen from '@/components/ChatScreen';
import AdminScreen from '@/components/AdminScreen';
import HubScreen from '@/components/HubScreen';
import AiScreen from '@/components/AiScreen';
import AppSidebar, { type AppSection } from '@/components/AppSidebar';
import SupportButton from '@/components/SupportButton';
import { getToken, clearToken } from '@/lib/supabase';
import { getSessionNickname, checkIsAdmin } from '@/lib/auth';
import type { RoomSummary } from '@/lib/auth';
import { useTheme } from '@/lib/useTheme';

export default function App() {
  useTheme();

  const [nickname, setNickname] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeRoom, setActiveRoom] = useState<RoomSummary | null>(null);
  const [screen, setScreen] = useState<AppSection>('hub');
  // AI 화면은 한 번 열면 계속 살려 둔다(다른 탭에 다녀와도 대화와 답변이 유지되도록).
  const [aiMounted, setAiMounted] = useState(false);

  const [checking, setChecking] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [fatalError, setFatalError] = useState(false);
  const [sessionChanged, setSessionChanged] = useState(false);

  useEffect(() => {
    // 다른 탭에서 로그인 세션이 변경되었는지 감지
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'chat_session_token' || event.key === null) {
        setSessionChanged(true);
      }
    };

    window.addEventListener('storage', handleStorageChange);

    const token = getToken();

    if (!token) {
      setChecking(false);

      return () => {
        window.removeEventListener('storage', handleStorageChange);
      };
    }

    let cancelled = false;

    (async () => {
      try {
        const name = await getSessionNickname(token);

        if (cancelled) return;

        // 조회 중 다른 탭에서 세션이 바뀌었으면 진행하지 않음
        if (getToken() !== token) {
          setSessionChanged(true);
          setChecking(false);
          return;
        }

        if (name) {
          setNickname(name);

          const admin = await checkIsAdmin(token);

          if (cancelled) return;

          if (getToken() !== token) {
            setSessionChanged(true);
            setChecking(false);
            return;
          }

          setIsAdmin(admin);
        } else {
          clearToken();
        }
      } catch {
        if (!cancelled) setFatalError(true);
      }

      if (!cancelled) setChecking(false);
    })();

    return () => {
      cancelled = true;
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const handleLogout = () => {
    clearToken();
    setNickname(null);
    setIsAdmin(false);
    setActiveRoom(null);
    setScreen('hub');
  };

  const handleAuthSuccess = async (name: string) => {
    setAuthLoading(true);

    try {
      const token = getToken();

      if (token) {
        const admin = await checkIsAdmin(token);
        setIsAdmin(admin);
      }

      setNickname(name);
      setActiveRoom(null);
      setScreen('hub');
    } catch {
      setFatalError(true);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleEnterRoom = (room: RoomSummary) => {
    setActiveRoom(room);
  };

  const handleBackToHub = () => {
    setActiveRoom(null);
  };

  const goToSection = (next: AppSection) => {
    if (next === 'ai') setAiMounted(true);
    setScreen(next);
  };

  if (sessionChanged) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
        <div className="max-w-sm text-center">
          <h2 className="mb-3 text-xl font-bold text-slate-900 dark:text-white">
            다른 계정으로 접근이 감지되었습니다.
          </h2>

          <p className="mb-6 text-sm leading-6 text-slate-500 dark:text-slate-400">
            현재 로그인 세션이 변경되어 이 화면에서 계속 진행할 수 없습니다.
            새로고침하여 현재 로그인 상태를 확인해 주세요.
          </p>

          <button
            onClick={() => window.location.reload()}
            className="rounded-xl bg-cyan-500 px-6 py-2.5 font-medium text-white transition-all hover:bg-cyan-400"
          >
            새로고침
          </button>
        </div>
      </div>
    );
  }

  if (fatalError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
        <div className="max-w-sm text-center">
          <h2 className="mb-2 text-xl font-bold text-slate-900 dark:text-white">
            Something went wrong
          </h2>

          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            We couldn't load the app. Please try refreshing the page.
          </p>

          <button
            onClick={() => {
              clearToken();
              setFatalError(false);
              setChecking(false);
              setNickname(null);
              setIsAdmin(false);
              setActiveRoom(null);
            }}
            className="rounded-xl bg-cyan-500 px-6 py-2.5 font-medium text-white transition-all hover:bg-cyan-400"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (checking || authLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 dark:bg-slate-950">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-500 dark:border-slate-700" />
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>
      </div>
    );
  }

  if (!nickname) {
    return <AuthScreen onAuthSuccess={handleAuthSuccess} />;
  }

  const chat = activeRoom ? (
    <ChatScreen
      key={activeRoom.id}
      nickname={nickname}
      onLogout={handleLogout}
      room={activeRoom}
      onBackToHub={handleBackToHub}
    />
  ) : null;

  // 허브/AI 화면은 다른 화면을 보는 동안에도 숨겨서 유지한다
  // (돌아올 때 다시 만들고 다시 불러오느라 느려지지 않도록)
  const hubHidden = screen !== 'hub';
  const aiHidden = screen !== 'ai';

  return (
    <>
      <div className={`${activeRoom ? 'hidden' : 'flex'} min-h-screen`}>
        <AppSidebar
          active={screen}
          onNavigate={goToSection}
          onLogout={handleLogout}
        />

        <div className="min-w-0 flex-1">
          <div className={hubHidden ? 'hidden' : 'block'}>
            {isAdmin ? (
              <AdminScreen
                nickname={nickname}
                onLogout={handleLogout}
                onEnterRoom={handleEnterRoom}
                active={!hubHidden}
              />
            ) : (
              <>
                <HubScreen nickname={nickname} onEnterRoom={handleEnterRoom} />
                <SupportButton />
              </>
            )}
          </div>

          {aiMounted && (
            <div className={aiHidden ? 'hidden' : 'block'}>
              <AiScreen nickname={nickname} />
            </div>
          )}
        </div>
      </div>

      {chat}
    </>
  );
}
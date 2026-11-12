import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Languages,
  LogOut,
  MessageCircle,
  Moon,
  Sparkles,
  Sun,
} from 'lucide-react';

import { useLang } from '@/lib/i18n';
import { useTheme } from '@/lib/useTheme';
import LeaveGuardToggle from '@/components/LeaveGuardToggle';

export type AppSection = 'hub' | 'ai';

type AppSidebarProps = {
  active: AppSection;
  nickname: string;
  onNavigate: (section: AppSection) => void;
  onLogout: () => void;
};

const NAV_ITEMS = [
  { id: 'hub' as const, label: '채팅', Icon: MessageCircle },
  { id: 'ai' as const, label: 'AI', Icon: Sparkles },
];

const ITEM_CLASS =
  'flex h-10 w-10 items-center justify-center rounded-xl transition';
const ITEM_ON =
  'bg-cyan-50 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-300';
const ITEM_OFF =
  'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-white';

const MENU_ITEM_CLASS =
  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';

/**
 * 화면 맨 왼쪽에 붙는 아이콘 막대. 채팅(허브)과 AI를 오가고, 아래쪽에
 * 새로고침 방지 토글과 프로필(테마·언어·로그아웃 메뉴)을 둔다.
 */
export default function AppSidebar({
  active,
  nickname,
  onNavigate,
  onLogout,
}: AppSidebarProps) {
  const { theme, toggleTheme } = useTheme();
  const { lang, setLang } = useLang();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex h-[100dvh] w-14 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-slate-200 bg-white/80 py-3 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/70">
      <div className="mb-1 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 shadow-lg shadow-cyan-500/20">
        <Activity className="h-5 w-5 text-white" strokeWidth={2.5} />
      </div>

      <nav aria-label="주요 메뉴" className="flex flex-col items-center gap-1">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onNavigate(id)}
            title={label}
            aria-label={label}
            aria-current={active === id ? 'page' : undefined}
            className={`${ITEM_CLASS} ${active === id ? ITEM_ON : ITEM_OFF}`}
          >
            <Icon className="h-5 w-5" />
          </button>
        ))}
      </nav>

      <div className="mt-auto flex flex-col items-center gap-1">
        <LeaveGuardToggle />

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={nickname}
            aria-label={`${nickname} 계정 메뉴`}
            className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 text-sm font-bold text-white shadow-md shadow-cyan-500/20 transition ${
              menuOpen ? 'ring-2 ring-cyan-400/60' : ''
            }`}
          >
            {nickname.charAt(0).toUpperCase()}
          </button>

          {menuOpen && (
            <div
              role="menu"
              aria-label="계정 메뉴"
              className="absolute bottom-0 left-full z-40 ml-2 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
            >
              <p className="truncate px-3 py-2 text-xs font-semibold text-slate-400 dark:text-slate-500">
                {nickname}
              </p>

              <button
                type="button"
                role="menuitem"
                onClick={toggleTheme}
                className={MENU_ITEM_CLASS}
              >
                {theme === 'dark' ? (
                  <Sun className="h-4 w-4 shrink-0 text-slate-400" />
                ) : (
                  <Moon className="h-4 w-4 shrink-0 text-slate-400" />
                )}
                {theme === 'dark' ? '라이트 모드' : '다크 모드'}
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')}
                className={MENU_ITEM_CLASS}
              >
                <Languages className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="flex-1">언어</span>
                <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">
                  {lang === 'ko' ? '한국어' : 'English'}
                </span>
              </button>

              <div className="my-1 h-px bg-slate-200 dark:bg-slate-700" />

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onLogout();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                로그아웃
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

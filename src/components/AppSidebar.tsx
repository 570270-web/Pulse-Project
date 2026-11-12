import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

const MENU_GAP = 8;

type MenuPosition = { left: number; bottom: number };

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

  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = () => setMenuPosition(null);

  // 사이드바는 overflow/backdrop-blur 때문에 메뉴를 안에 두면 잘린다.
  // 프로필 기준 오른쪽 위에 뜨도록 위치를 계산해 body 로 포털 렌더한다.
  const toggleMenu = () => {
    if (menuPosition) {
      closeMenu();
      return;
    }

    const rect = buttonRef.current?.getBoundingClientRect();

    if (!rect) return;

    setMenuPosition({
      left: rect.right + MENU_GAP,
      bottom: Math.max(MENU_GAP, window.innerHeight - rect.bottom),
    });
  };

  useEffect(() => {
    if (!menuPosition) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;

      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    const handleResize = () => closeMenu();

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [menuPosition]);

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

        <button
          ref={buttonRef}
          type="button"
          onClick={toggleMenu}
          aria-haspopup="menu"
          aria-expanded={menuPosition !== null}
          title={nickname}
          aria-label={`${nickname} 계정 메뉴`}
          className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 text-sm font-bold text-white shadow-md shadow-cyan-500/20 transition ${
            menuPosition ? 'ring-2 ring-cyan-400/60' : ''
          }`}
        >
          {nickname.charAt(0).toUpperCase()}
        </button>
      </div>

      {menuPosition &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="계정 메뉴"
            style={{ left: menuPosition.left, bottom: menuPosition.bottom }}
            className="fixed z-50 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
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
                closeMenu();
                onLogout();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              로그아웃
            </button>
          </div>,
          document.body
        )}
    </aside>
  );
}

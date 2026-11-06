import { LogOut, MessageCircle, Moon, Sparkles, Sun } from 'lucide-react';

import { useTheme } from '@/lib/useTheme';

export type AppSection = 'hub' | 'ai';

type AppSidebarProps = {
  active: AppSection;
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

/**
 * 화면 맨 왼쪽에 붙는 아이콘 막대. 채팅(허브)과 AI를 오가고, 아래쪽에서
 * 테마 전환과 로그아웃을 한다. 좁은 화면에서도 항상 보인다.
 */
export default function AppSidebar({
  active,
  onNavigate,
  onLogout,
}: AppSidebarProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <aside className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-slate-200 bg-white/80 py-3 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/70">
      <div className="mb-1 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 shadow-lg shadow-cyan-500/20">
        <Sparkles className="h-5 w-5 text-white" strokeWidth={2.5} />
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
        <button
          type="button"
          onClick={toggleTheme}
          title="테마"
          aria-label="테마 전환"
          className={`${ITEM_CLASS} ${ITEM_OFF}`}
        >
          {theme === 'dark' ? (
            <Sun className="h-5 w-5" />
          ) : (
            <Moon className="h-5 w-5" />
          )}
        </button>

        <button
          type="button"
          onClick={onLogout}
          title="로그아웃"
          aria-label="로그아웃"
          className={`${ITEM_CLASS} text-slate-500 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-400`}
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </aside>
  );
}

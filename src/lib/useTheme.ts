import { useCallback, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

const STORAGE_KEY = 'pulse_theme';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return 'dark';
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  root.style.colorScheme = theme;
}

// 여러 화면(사이드바, 채팅 메뉴)에서 같은 테마를 보도록 모듈에서 한 번만 관리한다
let currentTheme: Theme = getInitialTheme();
const listeners = new Set<(theme: Theme) => void>();

function setThemeEverywhere(next: Theme) {
  currentTheme = next;
  applyTheme(next);

  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 저장 실패는 무시 (이번 접속 동안만 적용됨)
  }

  listeners.forEach((listener) => listener(next));
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    applyTheme(currentTheme);
    setTheme(currentTheme);

    const listener = (next: Theme) => setTheme(next);

    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeEverywhere(currentTheme === 'dark' ? 'light' : 'dark');
  }, []);

  return { theme, toggleTheme };
}

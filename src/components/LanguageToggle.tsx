import { Languages } from 'lucide-react';

import { tr, useLang } from '@/lib/i18n';

/** 한국어 / English 전환 버튼 (선택은 브라우저에 저장됨) */
export default function LanguageToggle({ className = '' }: { className?: string }) {
  const { lang, setLang } = useLang();

  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')}
      title={tr('lang.toggle')}
      aria-label={tr('lang.toggle')}
      className={`flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-2 text-xs font-semibold text-slate-500 transition hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:text-white ${className}`}
    >
      <Languages className="h-4 w-4" />
      {lang === 'ko' ? '한국어' : 'English'}
    </button>
  );
}
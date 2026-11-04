import { useState } from 'react';
import { Loader2, MessageCircle, RefreshCw, Search } from 'lucide-react';
// (RefreshCw: 새로고침 버튼 아이콘)
 
import type { SupportThreadRow } from '@/lib/rooms';
import { dateLocale, tr, useLang } from '@/lib/i18n';
 
type Props = {
  rows: SupportThreadRow[];
  loading: boolean;
  onRefresh: () => void;
  onOpen: (row: SupportThreadRow) => void;
};
 
/** 답변이 필요한 문의인지: 마지막 메시지를 유저가 보냈으면 true */
export function needsReply(row: SupportThreadRow): boolean {
  return !row.last_from_admin;
}
 
function formatWhen(iso: string | null): string {
  if (!iso) return tr('inbox.noMessages');
 
  const date = new Date(iso);
 
  if (Number.isNaN(date.getTime())) return '';
 
  return date.toLocaleString(dateLocale(), {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
 
/**
 * 관리자 화면의 "문의" 탭 내용.
 * 모든 유저의 문의가 한곳에 모이고, 답변이 필요한 것이 위로 올라온다.
 */
export default function SupportInbox({
  rows,
  loading,
  onRefresh,
  onOpen,
}: Props) {
  useLang();
 
  const [search, setSearch] = useState('');
 
  const query = search.trim().toLocaleLowerCase();
 
  const visible = rows
    .filter((row) => row.user_nickname.toLocaleLowerCase().includes(query))
    .sort((a, b) => Number(needsReply(b)) - Number(needsReply(a)));
 
  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tr('inbox.search')}
            className="w-full rounded-xl border border-slate-300 bg-slate-50 py-3 pl-11 pr-4 text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800/60 dark:text-white"
          />
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          title={tr('inbox.refresh')}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
 
      {loading && rows.length === 0 ? (
        <div className="flex justify-center py-16 text-slate-500">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 px-5 py-16 text-center text-sm text-slate-500 dark:border-slate-800">
          {rows.length === 0
            ? tr('inbox.none')
            : tr('inbox.noResults')}
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((row) => {
            const waiting = needsReply(row);
 
            return (
              <li key={row.user_nickname}>
                <button
                  type="button"
                  onClick={() => onOpen(row)}
                  className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition hover:border-emerald-400 ${
                    waiting
                      ? 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10'
                      : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70'
                  }`}
                >
                  <MessageCircle
                    className={`h-5 w-5 shrink-0 ${
                      waiting ? 'text-amber-500' : 'text-slate-400'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {row.user_nickname}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {tr('inbox.count', { n: row.message_count })} ·{' '}
                      {formatWhen(row.last_message_at)}
                    </p>
                  </div>
                  {waiting && (
                    <span className="shrink-0 rounded-md bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
                      {tr('inbox.needsReply')}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
 
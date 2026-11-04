import { useState } from 'react';
import { LifeBuoy } from 'lucide-react';

import SupportChat from '@/components/SupportChat';
import { tr, useLang } from '@/lib/i18n';

/**
 * 허브 화면 오른쪽 아래의 "관리자 문의" 버튼.
 * 방을 만들지 않고, 문의 전용 대화창만 띄운다.
 */
export default function SupportButton() {
  useLang();

  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-500/30 transition hover:from-cyan-400 hover:to-blue-500 active:scale-95"
      >
        <LifeBuoy className="h-4 w-4" />
        {tr('support.title')}
      </button>

      {open && <SupportChat mode="user" onClose={() => setOpen(false)} />}
    </>
  );
}
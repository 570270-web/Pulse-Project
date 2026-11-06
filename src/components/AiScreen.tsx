import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Cpu,
  Loader2,
  Menu,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
  Zap,
} from 'lucide-react';

import {
  AI_MODELS,
  AI_SYSTEM_PROMPT,
  DEFAULT_AI_MODEL,
  MAX_CONTEXT_MESSAGES,
  MAX_MESSAGE_CHARS,
  aiModelById,
  isAiModelId,
  titleFrom,
} from '@/lib/aiConfig';
import {
  appendMessage,
  createConversation,
  deleteAllConversations,
  deleteConversation,
  getConversation,
  listConversations,
  setConversationModel,
  type AiConversation,
  type AiMessage,
} from '@/lib/aiApi';
import { detectDevice, generateReply } from '@/lib/aiEngine';

type AiScreenProps = {
  nickname: string;
};

type Turn = {
  text: string;
  status: 'loading' | 'streaming' | 'error';
  progress: number | null;
  error: string | null;
};

const MODEL_STORAGE_KEY = 'pulse_ai_model';

function readStoredModel(): string {
  try {
    const stored = localStorage.getItem(MODEL_STORAGE_KEY);

    if (isAiModelId(stored)) return stored;
  } catch {
    // 저장소를 못 쓰면 기본 모델
  }

  return DEFAULT_AI_MODEL;
}

/**
 * 기기에서 돌아가는 AI 채팅 화면. 계정과 대화 기록은 pulse 세션을 그대로 쓰므로
 * 따로 로그인하지 않는다. 답변은 이 브라우저에서 생성되며 서버로 나가지 않는다.
 */
export default function AiScreen({ nickname }: AiScreenProps) {
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState<string>(readStoredModel);
  const [device, setDevice] = useState<'webgpu' | 'wasm' | null>(null);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [error, setError] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);
  const [showList, setShowList] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const busy = turn !== null && turn.status !== 'error';

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const items = await listConversations();

        if (!cancelled) setConversations(items);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : '대화 목록을 불러오지 못했습니다.',
          );
        }
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();

    void detectDevice().then((value) => {
      if (!cancelled) setDevice(value);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, turn?.text, turn?.status]);

  const openConversation = useCallback(
    async (id: string) => {
      setShowList(false);
      setActiveId(id);
      setLoadingChat(true);
      setError('');
      setTurn(null);

      try {
        const page = await getConversation(id);
        setMessages(page.messages);

        if (isAiModelId(page.conversation.model)) setModel(page.conversation.model);
      } catch (err) {
        setMessages([]);
        setError(
          err instanceof Error ? err.message : '이 대화를 불러오지 못했습니다.',
        );
      } finally {
        setLoadingChat(false);
      }
    },
    [],
  );

  const startNewChat = useCallback(() => {
    if (busy) return;

    setActiveId(null);
    setMessages([]);
    setTurn(null);
    setError('');
    setShowList(false);
  }, [busy]);

  const send = useCallback(
    async (raw?: string) => {
      const content = (raw ?? draft).trim();

      if (!content || busy) return;

      setDraft('');
      setError('');

      const controller = new AbortController();
      abortRef.current = controller;
      setTurn({ text: '', status: 'loading', progress: null, error: null });

      try {
        let conversationId = activeId;
        let history = messages;

        // 첫 메시지면 대화를 만들고, 그 다음에 질문을 저장한다.
        if (!conversationId) {
          const created = await createConversation({
            title: titleFrom(content),
            model,
          });

          conversationId = created.id;
          history = [];
          setActiveId(created.id);
          setConversations((items) => [created, ...items]);
          setMessages([]);
        }

        const savedUser = await appendMessage(conversationId, {
          role: 'user',
          content,
        });

        history = [...history, savedUser];
        setMessages(history);

        const local = aiModelById(model);

        if (!local) throw new Error('선택한 모델을 찾을 수 없습니다.');

        const prompt = [
          { role: 'system' as const, content: AI_SYSTEM_PROMPT },
          ...history
            .slice(-MAX_CONTEXT_MESSAGES)
            .map((message) => ({ role: message.role, content: message.content })),
        ];

        const reply = await generateReply({
          model: local,
          messages: prompt,
          signal: controller.signal,
          onReset: () =>
            setTurn((current) => (current ? { ...current, text: '' } : current)),
          onProgress: (progress) =>
            setTurn((current) => (current ? { ...current, progress } : current)),
          onToken: (chunk) =>
            setTurn((current) =>
              current
                ? {
                    ...current,
                    status: 'streaming',
                    progress: null,
                    text: current.text + chunk,
                  }
                : current,
            ),
        });

        if (!reply.trim()) {
          throw new Error('빈 답변이 돌아왔습니다. 다시 시도해 주세요.');
        }

        const saved = await appendMessage(conversationId, {
          role: 'assistant',
          content: reply,
          model,
          interrupted: controller.signal.aborted,
        });

        setMessages((current) => [...current, saved]);
        setTurn(null);
        setConversations((items) =>
          items.map((item) =>
            item.id === conversationId
              ? { ...item, updatedAt: Date.now(), title: item.title }
              : item,
          ),
        );
      } catch (err) {
        if (controller.signal.aborted) {
          setTurn(null);
          return;
        }

        setTurn({
          text: '',
          status: 'error',
          progress: null,
          error:
            err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.',
        });
      }
    },
    [activeId, busy, draft, messages, model],
  );

  const stop = () => {
    abortRef.current?.abort();
  };

  const changeModel = (next: string) => {
    if (!isAiModelId(next)) return;

    setModel(next);

    try {
      localStorage.setItem(MODEL_STORAGE_KEY, next);
    } catch {
      // 저장 실패는 무시
    }

    if (activeId) {
      void setConversationModel(activeId, next).catch(() => undefined);
    }
  };

  const removeConversation = async (id: string) => {
    if (busy) return;
    if (!window.confirm('이 대화를 삭제할까요? 되돌릴 수 없습니다.')) return;

    try {
      await deleteConversation(id);
      setConversations((items) => items.filter((item) => item.id !== id));

      if (id === activeId) startNewChat();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '대화를 삭제하지 못했습니다.',
      );
    }
  };

  const removeAll = async () => {
    if (busy) return;
    if (!window.confirm('모든 AI 대화를 삭제할까요? 되돌릴 수 없습니다.')) return;

    try {
      await deleteAllConversations();
      setConversations([]);
      startNewChat();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '대화를 삭제하지 못했습니다.',
      );
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white">
      <aside
        className={`${
          showList ? 'fixed inset-0 z-40 flex' : 'hidden'
        } w-full flex-col border-r border-slate-200 bg-white md:static md:flex md:w-72 dark:border-slate-800 dark:bg-slate-900/60`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-cyan-500 dark:text-cyan-400" />
            <span className="font-semibold">Pulse AI</span>
          </div>

          <button
            type="button"
            onClick={() => setShowList(false)}
            aria-label="목록 닫기"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 md:hidden dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-3">
          <button
            type="button"
            onClick={startNewChat}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-cyan-400 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />새 대화
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {loadingList ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : conversations.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-500">
              아직 대화가 없습니다
            </p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((conversation) => (
                <li key={conversation.id}>
                  <div
                    className={`group flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${
                      conversation.id === activeId
                        ? 'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void openConversation(conversation.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <MessageSquare className="h-4 w-4 shrink-0 opacity-70" />
                      <span className="truncate">{conversation.title}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void removeConversation(conversation.id)}
                      aria-label="대화 삭제"
                      className="shrink-0 rounded-md p-1 text-slate-400 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {conversations.length > 0 && (
          <div className="border-t border-slate-200 p-3 dark:border-slate-800">
            <button
              type="button"
              onClick={() => void removeAll()}
              disabled={busy}
              className="w-full rounded-lg px-3 py-2 text-xs text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:text-slate-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
            >
              모든 대화 삭제
            </button>
          </div>
        )}
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
          <button
            type="button"
            onClick={() => setShowList(true)}
            aria-label="대화 목록"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold sm:text-base">
              {activeId
                ? conversations.find((item) => item.id === activeId)?.title ??
                  'Pulse AI'
                : 'Pulse AI'}
            </h1>
            <p className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              {device === 'webgpu' ? (
                <>
                  <Zap className="h-3 w-3" /> 내 GPU에서 실행 중
                </>
              ) : device === 'wasm' ? (
                <>
                  <Cpu className="h-3 w-3" /> 내 CPU에서 실행 중
                </>
              ) : (
                '내 브라우저에서 실행'
              )}
            </p>
          </div>

          <select
            value={model}
            onChange={(event) => changeModel(event.target.value)}
            disabled={busy}
            aria-label="모델 선택"
            className="max-w-40 rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs text-slate-700 outline-none transition focus:border-cyan-500 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
          >
            {AI_MODELS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </header>

        {error && (
          <div
            role="alert"
            className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError('')}
              aria-label="오류 닫기"
              className="shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {loadingChat ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : messages.length === 0 && !turn ? (
              <div className="py-10 text-center">
                <div className="mb-4 flex justify-center">
                  <Sparkles className="h-10 w-10 text-cyan-500 dark:text-cyan-400" />
                </div>
                <h2 className="text-xl font-bold">
                  {nickname}님, 무엇을 도와드릴까요?
                </h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  답변은 이 기기에서 만들어집니다. 처음 고른 모델은 한 번만
                  내려받고, 이후엔 캐시에서 불러옵니다.
                </p>

              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${
                    message.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-7 ${
                      message.role === 'user'
                        ? 'bg-cyan-500 text-white'
                        : 'border border-slate-200 bg-white text-slate-800 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100'
                    }`}
                  >
                    {message.content}
                    {message.interrupted && (
                      <span className="mt-2 block text-xs opacity-70">
                        중간에 멈춘 답변입니다
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}

            {turn && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-800 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100">
                  {turn.status === 'loading' && (
                    <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {turn.progress === null
                        ? '모델을 준비하는 중…'
                        : `모델 내려받는 중 ${Math.round(turn.progress * 100)}%`}
                    </span>
                  )}

                  {turn.status === 'streaming' &&
                    (turn.text ? (
                      <span className="whitespace-pre-wrap break-words">
                        {turn.text}
                      </span>
                    ) : (
                      <span className="text-slate-500 dark:text-slate-400">
                        답변을 쓰는 중…
                      </span>
                    ))}

                  {turn.status === 'error' && (
                    <span className="text-red-600 dark:text-red-400">
                      {turn.error}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div ref={endRef} />
          </div>
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-white/80 px-4 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
            className="mx-auto flex max-w-3xl items-end gap-2"
          >
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={1}
              maxLength={MAX_MESSAGE_CHARS}
              placeholder="메시지를 입력하세요 (Shift+Enter로 줄바꿈)"
              className="max-h-40 min-h-[48px] flex-1 resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-800/60 dark:text-white dark:placeholder:text-slate-500"
            />

            {busy ? (
              <button
                type="button"
                onClick={stop}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-700 transition hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                aria-label="생성 중지"
              >
                <Square className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!draft.trim()}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-cyan-500 text-white transition hover:bg-cyan-400 disabled:opacity-40"
                aria-label="메시지 전송"
              >
                <Send className="h-5 w-5" />
              </button>
            )}
          </form>

          <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-slate-400 dark:text-slate-500">
            AI 답변은 부정확할 수 있습니다. 중요한 내용은 확인해 주세요.
          </p>
        </div>
      </div>
    </div>
  );
}

// AI 대화 기록은 pulse-v2의 ai_* 테이블에 쌓인다. 테이블에 직접 접근하지 않고
// pulse 세션 토큰을 받는 RPC로만 오가므로 RLS는 닫힌 채로 유지된다.
// 답변 자체는 기기에서 생성된다(aiEngine.ts).

import { supabase, getToken } from './supabase';

export type AiRole = 'user' | 'assistant';

export type AiConversation = {
  id: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
};

export type AiMessage = {
  id: string;
  conversationId: string;
  role: AiRole;
  content: string;
  model: string | null;
  interrupted: boolean;
  createdAt: number;
};

type ConversationJson = {
  id: string;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
};

type MessageJson = {
  id: string;
  conversation_id: string;
  role: AiRole;
  content: string;
  model: string | null;
  interrupted: boolean;
  created_at: string;
};

const conversationFrom = (row: ConversationJson): AiConversation => ({
  id: row.id,
  title: row.title,
  model: row.model,
  createdAt: Date.parse(row.created_at),
  updatedAt: Date.parse(row.updated_at),
});

const messageFrom = (row: MessageJson): AiMessage => ({
  id: row.id,
  conversationId: row.conversation_id,
  role: row.role,
  content: row.content,
  model: row.model,
  interrupted: row.interrupted,
  createdAt: Date.parse(row.created_at),
});

const readable: Record<string, string> = {
  NOT_SIGNED_IN: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  CONVERSATION_NOT_FOUND: '이 대화는 더 이상 없습니다.',
  MESSAGE_NOT_FOUND: '이 메시지는 더 이상 없습니다.',
  MESSAGE_TOO_LONG: '메시지가 너무 길어 저장할 수 없습니다.',
  EMPTY_MESSAGE: '메시지를 먼저 입력해 주세요.',
  TITLE_REQUIRED: '대화 제목을 입력해 주세요.',
};

const failure = (error: { message: string }): Error => {
  const known = Object.keys(readable).find((key) => error.message.includes(key));
  return new Error(known ? readable[known] : error.message);
};

const token = (): string => {
  const value = getToken();

  if (!value) throw new Error('로그인이 필요합니다.');

  return value;
};

export type AiConversationPage = {
  conversation: AiConversation;
  messages: AiMessage[];
};

export async function listConversations(): Promise<AiConversation[]> {
  const { data, error } = await supabase.rpc('ai_list_conversations', {
    p_token: token(),
  });

  if (error) throw failure(error);

  return ((data as ConversationJson[] | null) ?? []).map(conversationFrom);
}

export async function getConversation(id: string): Promise<AiConversationPage> {
  const { data, error } = await supabase.rpc('ai_get_conversation', {
    p_token: token(),
    p_id: id,
  });

  if (error) throw failure(error);

  const body = data as
    | { conversation: ConversationJson; messages: MessageJson[] }
    | null;

  if (!body?.conversation) throw new Error('이 대화는 더 이상 없습니다.');

  return {
    conversation: conversationFrom(body.conversation),
    messages: body.messages.map(messageFrom),
  };
}

export async function createConversation(input: {
  title: string;
  model: string;
}): Promise<AiConversation> {
  const { data, error } = await supabase.rpc('ai_create_conversation', {
    p_token: token(),
    p_title: input.title,
    p_model: input.model,
  });

  if (error) throw failure(error);

  return conversationFrom(data as ConversationJson);
}

export async function appendMessage(
  conversationId: string,
  input: {
    id?: string;
    role: AiRole;
    content: string;
    model?: string | null;
    interrupted?: boolean;
  },
): Promise<AiMessage> {
  const { data, error } = await supabase.rpc('ai_append_message', {
    p_token: token(),
    p_conversation_id: conversationId,
    p_id: input.id ?? crypto.randomUUID(),
    p_role: input.role,
    p_content: input.content,
    p_model: input.model ?? null,
    p_interrupted: input.interrupted ?? false,
  });

  if (error) throw failure(error);

  return messageFrom(data as MessageJson);
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const { error } = await supabase.rpc('ai_rename_conversation', {
    p_token: token(),
    p_id: id,
    p_title: title,
  });

  if (error) throw failure(error);
}

export async function setConversationModel(id: string, model: string): Promise<void> {
  const { error } = await supabase.rpc('ai_set_conversation_model', {
    p_token: token(),
    p_id: id,
    p_model: model,
  });

  if (error) throw failure(error);
}

export async function deleteConversation(id: string): Promise<void> {
  const { error } = await supabase.rpc('ai_delete_conversation', {
    p_token: token(),
    p_id: id,
  });

  if (error) throw failure(error);
}

export async function deleteAllConversations(): Promise<void> {
  const { error } = await supabase.rpc('ai_delete_all_conversations', {
    p_token: token(),
  });

  if (error) throw failure(error);
}

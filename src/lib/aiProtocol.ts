// 페이지와 모델 워커가 주고받는 메시지 타입. 양쪽이 서로의 코드를 끌어오지 않도록 분리.

export type AiChatTurn = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type AiGenerateRequest = {
  type: 'generate';
  id: string;
  repo: string;
  messages: AiChatTurn[];
  maxTokens: number;
};

export type AiCancelRequest = { type: 'cancel'; id: string };

export type AiWorkerRequest = AiGenerateRequest | AiCancelRequest;

export type AiWorkerEvent =
  | { type: 'progress'; id: string; progress: number }
  | { type: 'delta'; id: string; text: string }
  // 이미 보낸 조각을 버리고 처음부터 다시 쓴다(같은 답을 두 번 생성할 때).
  | { type: 'reset'; id: string }
  | { type: 'done'; id: string; text: string }
  | { type: 'error'; id: string; message: string };

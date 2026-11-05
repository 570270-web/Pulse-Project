// 온디바이스 AI 채팅 설정. 서버 호출도, 키도, 사용량 제한도 없다.
// 모델 가중치는 처음 고를 때 허깅페이스 허브에서 브라우저로 내려받아 캐시하고,
// 추론은 방문자 기기(GPU=WebGPU, 없으면 CPU=WASM)에서 돌아간다.

export const AI_BRAND = 'Pulse AI';

export const AI_SYSTEM_PROMPT = `You are ${AI_BRAND}, a thoughtful assistant inside Pulse. Be clear and direct. Match the length of your answer to the question: short for simple ones, structured for complex ones. Use Markdown when it helps (lists, headings, code blocks with a language), never for decoration. If you are unsure, say so.`;

export const AI_MODELS = [
  {
    id: 'smollm2-360m',
    name: 'SmolLM2 360M',
    repo: 'onnx-community/SmolLM2-360M-Instruct-ONNX',
    description: '가장 가볍고 빠름',
    size: '약 360MB',
  },
  {
    id: 'qwen2.5-0.5b',
    name: 'Qwen2.5 0.5B',
    repo: 'onnx-community/Qwen2.5-0.5B-Instruct',
    description: '일상 대화에 무난한 균형',
    size: '약 500MB',
  },
  {
    id: 'qwen2.5-1.5b',
    name: 'Qwen2.5 1.5B',
    repo: 'onnx-community/Qwen2.5-1.5B-Instruct',
    description: '답변 품질이 좋지만 느림',
    size: '약 1.5GB',
  },
] as const;

export type AiLocalModel = (typeof AI_MODELS)[number];
export type AiModelId = AiLocalModel['id'];

export const DEFAULT_AI_MODEL: AiModelId = 'qwen2.5-0.5b';

export const isAiModelId = (value: unknown): value is AiModelId =>
  AI_MODELS.some((model) => model.id === value);

export const aiModelById = (id: string): AiLocalModel | undefined =>
  AI_MODELS.find((model) => model.id === id);

// 한 번의 요청에 대한 한도(작은 모델의 컨텍스트 창)일 뿐, 하루 사용량 제한은 없다.
export const MAX_CONTEXT_MESSAGES = 24;
export const MAX_MESSAGE_CHARS = 8_000;
export const MAX_OUTPUT_TOKENS = 1_024;

export const AI_SUGGESTIONS = [
  '복리 이자가 뭔지 쉬운 예시로 설명해줘',
  '입금이 늦어진 거래처에 보낼 정중한 독촉 메일 써줘',
  '좁은 방에서 할 수 있는 20분 홈트 루틴 짜줘',
  '고양이 입양 전에 꼭 알아야 할 것들 알려줘',
];

export const titleFrom = (text: string): string => {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '새 대화';
  return cleaned.length > 40 ? `${cleaned.slice(0, 40)}…` : cleaned;
};

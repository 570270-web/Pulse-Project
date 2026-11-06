/// <reference lib="webworker" />
// 모델 본체. 워커에서 돌아가므로 가중치를 내려받는 동안에도 화면은 멈추지 않는다.
// 브라우저에 WebGPU가 있으면 GPU로, 없으면 WASM으로 CPU에서 추론한다.
// 가중치는 허깅페이스 허브에서 한 번만 받고 이후엔 브라우저 캐시를 쓴다.

import {
  InterruptableStoppingCriteria,
  TextStreamer,
  env,
  pipeline,
} from '@huggingface/transformers';

import { MAX_OUTPUT_TOKENS } from './aiConfig';
import type {
  AiGenerateRequest,
  AiWorkerEvent,
  AiWorkerRequest,
} from './aiProtocol';

env.allowLocalModels = false;

const post = (event: AiWorkerEvent) =>
  (self as unknown as { postMessage: (event: AiWorkerEvent) => void }).postMessage(
    event,
  );

type Pipeline = (messages: unknown, options: Record<string, unknown>) => Promise<unknown>;
type Loaded = {
  repo: string;
  device: 'webgpu' | 'wasm';
  pipe: Pipeline;
  tokenizer: unknown;
};

let loaded: Loaded | null = null;
const stoppers = new Map<string, InterruptableStoppingCriteria>();

type GpuAdapter = { features?: { has?: (name: string) => boolean } };

/**
 * GPU로 돌릴 수 있는지. 어댑터가 있어도 fp16 셰이더를 못 만드는 기기가 있는데,
 * 그런 기기에서는 q4f16 모델이 로드까지는 되고 첫 연산에서 죽는다
 * ("Gather requires f16 but the device does not support it"). 그래서 처음부터 걸러 낸다.
 */
async function hasWebGPU(): Promise<boolean> {
  const gpu = (navigator as unknown as {
    gpu?: { requestAdapter: () => Promise<GpuAdapter | null> };
  }).gpu;

  if (!gpu) return false;

  try {
    const adapter = await gpu.requestAdapter();
    return Boolean(adapter?.features?.has?.('shader-f16'));
  } catch {
    return false;
  }
}

/**
 * 이미 메모리에 있는 모델이면 그대로 쓰고, 아니면 가중치를 받아 올린다.
 * 진행률은 지금까지 받은 모든 파일의 합계 비율이라 화면에 숫자 하나로 보여줄 수 있다.
 */
async function load(
  request: AiGenerateRequest,
  onProgress: (progress: number) => void,
  forceCpu = false,
): Promise<Loaded> {
  if (!forceCpu && loaded?.repo === request.repo) return loaded;

  if (loaded) {
    try {
      await (loaded.pipe as unknown as { dispose?: () => Promise<void> }).dispose?.();
    } catch {
      // 어차피 버릴 파이프라인
    }
    loaded = null;
  }

  const files = new Map<string, { loaded: number; total: number }>();

  const progress = (info: {
    status?: string;
    file?: string;
    loaded?: number;
    total?: number;
  }) => {
    const key = info.file ?? 'model';
    const entry = files.get(key) ?? { loaded: 0, total: 0 };

    if (typeof info.total === 'number' && info.total > 0) entry.total = info.total;
    if (typeof info.loaded === 'number') entry.loaded = info.loaded;
    if (info.status === 'done' && entry.total > 0) entry.loaded = entry.total;

    files.set(key, entry);

    let total = 0;
    let done = 0;

    for (const file of files.values()) {
      total += file.total;
      done += file.loaded;
    }

    if (total > 0) onProgress(Math.min(1, done / total));
  };

  const attempts: { device: 'webgpu' | 'wasm'; dtype: 'q4f16' | 'q8' }[] = [];

  // GPU는 4비트 가중치 + fp16, CPU는 fp16 커널이 없어서 8비트를 쓴다.
  if (!forceCpu && (await hasWebGPU())) {
    attempts.push({ device: 'webgpu', dtype: 'q4f16' });
  }
  attempts.push({ device: 'wasm', dtype: 'q8' });

  let failure: unknown;

  for (const attempt of attempts) {
    try {
      const pipe = (await pipeline('text-generation', request.repo, {
        device: attempt.device,
        dtype: attempt.dtype,
        progress_callback: progress,
      })) as unknown as { tokenizer: unknown };

      loaded = {
        repo: request.repo,
        device: attempt.device,
        pipe: pipe as unknown as Pipeline,
        tokenizer: pipe.tokenizer,
      };

      return loaded;
    } catch (error) {
      // GPU에서 못 돌리면 CPU로 다시 시도한다. 실패가 답변을 막지 않도록.
      failure = error;
      files.clear();
    }
  }

  throw failure instanceof Error
    ? failure
    : new Error('이 모델은 이 기기에서 실행할 수 없습니다.');
}

/** 스트리머가 아무것도 못 봤을 때 파이프라인 결과에서 답변 텍스트를 꺼낸다. */
function replyText(output: unknown): string {
  const first = Array.isArray(output)
    ? (output[0] as { generated_text?: unknown } | undefined)
    : undefined;
  const generated = first?.generated_text;

  if (typeof generated === 'string') return generated;

  if (Array.isArray(generated)) {
    const last = generated[generated.length - 1] as { content?: unknown } | undefined;
    if (typeof last?.content === 'string') return last.content;
  }

  return '';
}

async function run(request: AiGenerateRequest) {
  const stopper = new InterruptableStoppingCriteria();

  stoppers.set(request.id, stopper);

  let text = '';

  const onProgress = (progress: number) =>
    post({ type: 'progress', id: request.id, progress });

  /** 한 번의 생성. 스트리밍 조각은 text 에 차곡차곡 쌓인다. */
  const generate = async (model: Loaded) => {
    const streamer = new TextStreamer(model.tokenizer as never, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (chunk: string) => {
        if (stopper.interrupted) return;
        text += chunk;
        post({ type: 'delta', id: request.id, text: chunk });
      },
    });

    const output = await model.pipe(request.messages, {
      max_new_tokens: request.maxTokens || MAX_OUTPUT_TOKENS,
      do_sample: false,
      return_full_text: false,
      streamer,
      stopping_criteria: [stopper],
    });

    if (!text) text = replyText(output);
  };

  try {
    let model = await load(request, onProgress);

    if (stopper.interrupted) {
      post({ type: 'done', id: request.id, text });
      return;
    }

    try {
      await generate(model);
    } catch (error) {
      // GPU 커널이 없다고 로드가 끝난 뒤에야 알려주는 기기도 있다(위의 Gather/f16).
      // 아직 아무 글자도 못 냈으면 모델을 CPU(8비트)로 다시 올려 한 번 더 시도한다.
      if (model.device !== 'webgpu' || text) throw error;

      model = await load(request, onProgress, true);

      if (stopper.interrupted) {
        post({ type: 'done', id: request.id, text });
        return;
      }

      await generate(model);
    }

    post({ type: 'done', id: request.id, text });
  } catch (error) {
    post({
      type: 'error',
      id: request.id,
      message:
        error instanceof Error ? error.message : '모델이 답변하지 못했습니다.',
    });
  } finally {
    stoppers.delete(request.id);
  }
}

self.onmessage = (event: MessageEvent<AiWorkerRequest>) => {
  const request = event.data;

  if (request.type === 'cancel') {
    stoppers.get(request.id)?.interrupt();
    return;
  }

  void run(request);
};

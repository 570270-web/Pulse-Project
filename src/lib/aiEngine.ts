// 온디바이스 추론의 메인 스레드 쪽. 워커를 하나만 두고 한 번에 한 답변씩 맡긴다.
// 가중치는 워커 안에 있으므로 화면을 옮겨도 다시 받지 않는다.

import { MAX_OUTPUT_TOKENS, type AiLocalModel } from './aiConfig';
import type { AiGenerateRequest, AiWorkerEvent } from './aiProtocol';

type Job = {
  onToken: (text: string) => void;
  onReset?: () => void;
  onProgress?: (progress: number) => void;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  detach?: () => void;
};

const jobs = new Map<string, Job>();
let worker: Worker | null = null;

function engine(): Worker {
  if (worker) return worker;

  const created = new Worker(new URL('./aiWorker.ts', import.meta.url), {
    type: 'module',
  });

  created.onmessage = (event: MessageEvent<AiWorkerEvent>) => {
    const job = jobs.get(event.data.id);
    if (!job) return;

    const data = event.data;

    switch (data.type) {
      case 'reset':
        job.onReset?.();
        break;
      case 'progress':
        job.onProgress?.(data.progress);
        break;
      case 'delta':
        job.onToken(data.text);
        break;
      case 'done':
        jobs.delete(data.id);
        job.detach?.();
        job.resolve(data.text);
        break;
      case 'error':
        jobs.delete(data.id);
        job.detach?.();
        job.reject(new Error(data.message));
        break;
    }
  };

  created.onerror = (event) => {
    const error = new Error(event.message || '모델이 예기치 않게 멈췄습니다.');

    for (const [id, job] of jobs) {
      jobs.delete(id);
      job.detach?.();
      job.reject(error);
    }
  };

  worker = created;

  return created;
}

/**
 * 답변 하나를 스트리밍한다. `signal`이 중단되면 생성을 멈추고 그때까지 쓴 텍스트를
 * 돌려주므로, 중간에 멈춘 답변도 기록으로 남길 수 있다.
 */
export function generateReply(input: {
  model: AiLocalModel;
  messages: AiGenerateRequest['messages'];
  signal?: AbortSignal;
  onToken: (text: string) => void;
  onReset?: () => void;
  onProgress?: (progress: number) => void;
}): Promise<string> {
  const id = crypto.randomUUID();
  const active = engine();

  return new Promise<string>((resolve, reject) => {
    const cancel = () => active.postMessage({ type: 'cancel', id });

    if (input.signal?.aborted) cancel();
    else input.signal?.addEventListener('abort', cancel, { once: true });

    jobs.set(id, {
      onToken: input.onToken,
      onReset: input.onReset,
      onProgress: input.onProgress,
      resolve,
      reject,
      detach: () => input.signal?.removeEventListener('abort', cancel),
    });

    active.postMessage({
      type: 'generate',
      id,
      repo: input.model.repo,
      messages: input.messages,
      maxTokens: MAX_OUTPUT_TOKENS,
    } satisfies AiGenerateRequest);
  });
}

/**
 * WebGPU가 있으면 GPU, 없으면 CPU.
 * 어댑터가 있어도 fp16 셰이더를 못 만드는 기기는 GPU 모델을 실행할 수 없으므로 CPU로 본다
 * (워커 쪽 판단과 같아야 화면에 뜨는 기기 표시가 실제 추론과 어긋나지 않는다).
 */
export async function detectDevice(): Promise<'webgpu' | 'wasm'> {
  const gpu = (navigator as unknown as {
    gpu?: {
      requestAdapter: () => Promise<{
        features?: { has?: (name: string) => boolean };
      } | null>;
    };
  }).gpu;

  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter();
      if (adapter?.features?.has?.('shader-f16')) return 'webgpu';
    } catch {
      // 쓸 수 있는 어댑터가 없음
    }
  }

  return 'wasm';
}

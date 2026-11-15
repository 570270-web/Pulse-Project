import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/** 정적 호스팅(Sites)이 파일 하나에 허용하는 최대 크기 */
const MAX_ASSET_BYTES = 10 * 1024 * 1024;

/**
 * onnxruntime 의 wasm(약 26MB)은 vite 가 import.meta.url 때문에 번들에 같이 넣지만,
 * 실제 실행 시에는 transformers 가 jsdelivr CDN 경로(버전 일치)로 받아 쓴다.
 * 그대로 두면 호스팅 업로드 한도를 넘겨 배포가 실패하므로 빌드에서 걸러 낸다.
 */
function dropOversizedAssets(): Plugin {
  return {
    name: 'drop-oversized-assets',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        const size =
          output.type === 'asset'
            ? Buffer.byteLength(output.source as string | Uint8Array)
            : Buffer.byteLength(output.code);

        if (size > MAX_ASSET_BYTES) {
          console.warn(
            `[drop-oversized-assets] ${fileName} (${(
              size /
              1024 /
              1024
            ).toFixed(1)}MB) 는 업로드 한도를 넘어 제외합니다 — 런타임에 CDN 에서 받습니다.`
          );
          delete bundle[fileName];
        }
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), dropOversizedAssets()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    // lucide-react를 미리 묶지 않으면 개발 서버가 아이콘을 파일 하나씩 따로
    // 내려보내 첫 화면이 아주 느려진다.
    // 모델 워커는 처음 쓸 때 transformers를 불러오는데, 미리 묶어 두면 답변 도중에
    // 다시 최적화하며 페이지를 새로고침하는 일이 없다.
    include: ['lucide-react', '@huggingface/transformers'],
  },
});

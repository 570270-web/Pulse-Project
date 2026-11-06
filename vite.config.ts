import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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

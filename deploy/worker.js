// 정적 자산(빌드된 SPA)만 서빙하는 Worker.
// API 는 전부 Supabase RPC 라서 서버 코드가 따로 필요 없다.
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};

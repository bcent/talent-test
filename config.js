/**
 * 项目运行时配置（前端可见）
 * ═══════════════════════════════════════════════════════════
 *
 * 🔴 部署前必须做的一件事：填入 SUPABASE_URL 和 SUPABASE_ANON_KEY

 *    - 打开 Supabase 集成详情页
 *    - 复制 "Project URL" → 填入 SUPABASE_URL
 *    - 复制 "anon public key" → 填入 SUPABASE_ANON_KEY
 *    - anon key 是公开设计的，暴露到前端不会导致数据泄露（RLS + RPC 已保护）
 *
 * ═══════════════════════════════════════════════════════════
 * 未填入时：应用会自动进入 "本地 mock 模式"（跳过邀请码校验、结果不入库）
 * 便于本地开发预览，绝对不要在生产环境保持 mock 模式！
 * ═══════════════════════════════════════════════════════════
 */
window.APP_CONFIG = {
  SUPABASE_URL: '',          // 例如：'https://xxxxx.supabase.co'
  SUPABASE_ANON_KEY: '',     // 例如：'sb_publishable_...'

  // 邀请码 URL 参数名，比如 https://example.com/?k=xxxxxxxx
  INVITE_PARAM: 'k',

  // 本地会话缓存 key（localStorage）
  STORAGE_KEY: 'talent_quiz_session_v1',

  // 应用版本号，改配置后 bump 一下可让老 session 失效
  VERSION: '1.0.0',
};

// 判断当前是否处于 mock 模式（未配置真实 Supabase 时）
window.APP_CONFIG.isMock = !window.APP_CONFIG.SUPABASE_URL || !window.APP_CONFIG.SUPABASE_ANON_KEY;

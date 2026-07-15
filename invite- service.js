/**
 * 邀请码 & 测评状态服务
 * ══════════════════════════════════════════════════════════════
 *
 * 对外暴露 window.inviteService（小写），含核心 API：
 *
 *   ① validate(code)         → 校验 URL 上传入的邀请码，返回 { status } 状态：
 *                               missing / invalid / completed / ready / error
 *
 *   ② submitResult(payload)  → 完成测评时调用，把答题记录 + 结果写入 Supabase
 *                              幂等：同一邀请码只能成功提交一次
 *
 *   ③ getSession()           → 拿到本地缓存的 { code, historyResult }
 *
 * 同时挂载 window.InviteService 别名（大写）供旧代码兼容。
 * ══════════════════════════════════════════════════════════════
 */
(function () {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const storageKey = cfg.STORAGE_KEY || 'talent_quiz_session_v1';

  /* ─────────── Supabase 客户端（懒加载单例） ─────────── */
  let _client = null;
  function getClient() {
    if (cfg.isMock) return null;
    if (_client) return _client;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      console.warn('[inviteService] supabase-js SDK 未加载');
      return null;
    }
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      console.warn('[inviteService] 缺少 SUPABASE_URL 或 SUPABASE_ANON_KEY');
      return null;
    }
    try {
      _client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    } catch (e) {
      console.error('[inviteService] 创建 supabase 客户端失败', e);
      return null;
    }
    return _client;
  }

  /* ─────────── 本地缓存工具 ─────────── */
  function readCache() {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
  function writeCache(patch) {
    try {
      const cur = readCache();
      localStorage.setItem(storageKey, JSON.stringify({ ...cur, ...patch, _t: Date.now() }));
    } catch { /* quota 满或隐私模式，忽略 */ }
  }
  function clearCache() {
    try { localStorage.removeItem(storageKey); } catch {}
  }

  /* ─────────── 从 URL 提取邀请码 ─────────── */
  function getCodeFromUrl() {
    try {
      const url = new URL(window.location.href);
      const paramName = cfg.INVITE_PARAM || 'k';
      let code = url.searchParams.get(paramName) || '';

      if (!code) {
        // 兼容 ?code=xxxx
        code = url.searchParams.get('code') || '';
      }
      // 兼容 hash 形式：#k=xxxx
      if (!code && url.hash) {
        const m = url.hash.match(new RegExp('[#&](' + paramName + '|code)=([^&]+)'));
        if (m) code = decodeURIComponent(m[2]);
      }
      return (code || '').trim();
    } catch {
      return '';
    }
  }

  /* ─────────── API ① 校验邀请码 ─────────── */
  /**
   * @param {string} [codeArg] 优先使用传入的 code；若未传，则从 URL 读取
   * @returns {Promise<{status:'missing'|'invalid'|'completed'|'ready'|'error', ...}>}
   */
  async function validate(codeArg) {
    const codeFromUrl = getCodeFromUrl();
    const cached = readCache();
    const code = (codeArg || codeFromUrl || cached.code || '').trim();

    if (!code) return { status: 'missing' };

    // Mock 模式（未配置 Supabase）：不阻塞用户，任意 code 视为 ready
    if (cfg.isMock) {
      writeCache({ code, mock: true });
      return { status: 'ready', code, mock: true };
    }

    const client = getClient();
    if (!client) return { status: 'error', message: '客户端初始化失败，请检查 config.js' };

    try {
      const { data, error } = await client.rpc('validate_invite', { p_code: code });

      if (error) {
        console.error('[inviteService] validate RPC 失败', error);
        // 网络/服务故障：本地已通过则放行离线模式
        if (cached.code === code && cached.validated) {
          return { status: 'ready', code, offline: true };
        }
        return { status: 'error', message: error.message || '服务暂时不可用' };
      }

      const payload = data || {};
      const status = payload.status;

      if (status === 'ready') {
        writeCache({ code, validated: true, mock: false });
        return { status: 'ready', code, note: payload.note || '' };
      }

      if (status === 'completed') {
        const meta = {
          child_name: payload.child_name,
          child_gender: payload.child_gender,
          age_group: payload.age_group,
          completed_at: payload.completed_at,
        };
        writeCache({
          code,
          validated: true,
          completed: true,
          historyResult: payload.result || null,
          historyMeta: meta,
        });
        return {
          status: 'completed',
          code,
          result: payload.result || null,
          meta,
        };
      }

      if (status === 'invalid') {
        // URL 上的 code 无效 → 清掉本地缓存，避免误伤
        if (codeFromUrl) clearCache();
        return { status: 'invalid' };
      }

      // 未知状态，兜底为 invalid
      return { status: 'invalid' };
    } catch (e) {
      console.error('[inviteService] validate 异常', e);
      return { status: 'error', message: '网络异常，请稍后重试' };
    }
  }

  /* ─────────── API ② 提交测评结果 ─────────── */
  /**
   * @param {Object} payload
   *   - childName / child_name
   *   - childGender / child_gender
   *   - ageGroup / age_group
   *   - answers
   *   - result
   */
  async function submitResult(payload) {
    payload = payload || {};
    const cached = readCache();
    const code = cached.code || getCodeFromUrl();

    if (!code) return { status: 'missing_code' };

    // 字段兼容驼峰/下划线
    const childName   = payload.childName   ?? payload.child_name   ?? null;
    const childGender = payload.childGender ?? payload.child_gender ?? null;
    const ageGroup    = payload.ageGroup    ?? payload.age_group    ?? null;
    const answers     = payload.answers     ?? null;
    const result      = payload.result      ?? null;

    // 无论走什么路径都先本地存一份
    writeCache({
      code,
      completed: true,
      historyResult: result,
      historyMeta: {
        child_name: childName,
        child_gender: childGender,
        age_group: ageGroup,
        completed_at: new Date().toISOString(),
      },
    });

    if (cfg.isMock) return { status: 'ok', mock: true };

    const client = getClient();
    if (!client) return { status: 'ok', offline: true, message: '本地已保存，未连接服务端' };

    try {
      const { data, error } = await client.rpc('complete_quiz', {
        p_code:         code,
        p_child_name:   childName,
        p_child_gender: childGender,
        p_age_group:    ageGroup,
        p_answers:      answers,
        p_result:       result,
      });

      if (error) {
        console.error('[inviteService] submit RPC 失败', error);
        return { status: 'ok', offline: true, message: '本地已保存，云端同步失败' };
      }
      return data || { status: 'ok' };
    } catch (e) {
      console.error('[inviteService] submit 异常', e);
      return { status: 'ok', offline: true, message: '本地已保存，云端同步失败' };
    }
  }

  /* ─────────── API ③ 拿本地会话 ─────────── */
  function getSession() {
    return readCache();
  }

  /* ─────────── 导出（小写 + 大写别名） ─────────── */
  const api = {
    validate,
    validateInvite: validate, // 兼容旧调用
    submitResult,
    getSession,
    clearCache,
    getCodeFromUrl,
    isMock: () => !!cfg.isMock,
  };
  window.inviteService = api;
  window.InviteService = api;
})();

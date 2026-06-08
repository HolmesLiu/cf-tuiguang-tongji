/**
 * 后台管理员鉴权（Cookie Session）
 */

import type { Env, Admin, AdminSession } from '../types.ts';
import {
  getSession,
  getAdminById,
  cleanExpiredSessions,
} from '../db/queries.ts';
import { parseCookie } from '../utils/json.ts';
import { fail } from '../utils/json.ts';
import type { Ctx } from '../types.ts';

export const SESSION_COOKIE = 'cf_session';

export async function requireAdmin(ctx: Ctx): Promise<{ ok: true; admin: Admin } | { ok: false; response: Response }> {
  const cookies = parseCookie(ctx.request.headers.get('cookie'));
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return { ok: false, response: fail('UNAUTHORIZED', '未登录', 401) };
  }

  const session = await getSession(ctx.env.DB, token);
  if (!session || session.expires_at < Date.now()) {
    return { ok: false, response: fail('UNAUTHORIZED', '会话已过期', 401) };
  }

  const admin = await getAdminById(ctx.env.DB, session.admin_id);
  if (!admin) {
    return { ok: false, response: fail('UNAUTHORIZED', '账号不存在', 401) };
  }

  // 30% 概率清理过期 session（轻量）
  if (Math.random() < 0.3) {
    ctx.request.headers;
    ctx.env.DB; // 防 DCE
    await cleanExpiredSessions(ctx.env.DB);
  }

  return { ok: true, admin };
}

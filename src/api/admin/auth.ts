/**
 * 后台认证 API
 */

import type { Env, Ctx } from '../../types.ts';
import {
  getAdminByUsername,
  touchAdminLogin,
  createSession,
  deleteSession,
} from '../../db/queries.ts';
import { fail, ok, parseJson, parseCookie, serializeCookie } from '../../utils/json.ts';
import { verifyPassword } from '../../utils/crypto.ts';
import { SESSION_COOKIE, requireAdmin } from '../../auth/admin.ts';

export async function handleAdminLogin(env: Env, req: Request): Promise<Response> {
  const body = await parseJson<{ username?: string; password?: string }>(req);
  if (!body.username || !body.password) {
    return fail('VALIDATION_ERROR', '用户名 / 密码必填', 400);
  }
  const admin = await getAdminByUsername(env.DB, body.username);
  if (!admin) {
    return fail('UNAUTHORIZED', '用户名或密码错误', 401);
  }
  const ok2 = await verifyPassword(body.password, admin.password_hash);
  if (!ok2) {
    return fail('UNAUTHORIZED', '用户名或密码错误', 401);
  }
  const ip = req.headers.get('cf-connecting-ip');
  const session = await createSession(env.DB, admin.id, ip);
  await touchAdminLogin(env.DB, admin.id);

  const cookie = serializeCookie(SESSION_COOKIE, session.token, {
    maxAge: 7 * 24 * 60 * 60,
    httpOnly: true,
    sameSite: 'Strict',
    secure: new URL(req.url).protocol === 'https:',
    path: '/',
  });

  return new Response(JSON.stringify({ ok: true, data: { admin: { id: admin.id, username: admin.username } } }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': cookie },
  });
}

export async function handleAdminLogout(env: Env, req: Request): Promise<Response> {
  const cookies = parseCookie(req.headers.get('cookie'));
  const token = cookies[SESSION_COOKIE];
  if (token) await deleteSession(env.DB, token);
  const cookie = serializeCookie(SESSION_COOKIE, '', {
    maxAge: 0,
    path: '/',
  });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': cookie },
  });
}

export async function handleAdminMe(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  return ok({ admin: { id: r.admin.id, username: r.admin.username } });
}

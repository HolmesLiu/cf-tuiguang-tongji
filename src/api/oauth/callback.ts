/**
 * OAuth 2.0 回调处理
 *
 * 流程：
 * 1. 推广人点 H5 的"开启待办通知"按钮
 * 2. 前端 POST /api/oauth/authorize?userid=xxx
 * 3. 后端 302 跳转到钉钉授权页（login.dingtalk.com/oauth2/auth）
 * 4. 用户同意 → 钉钉回调到 /api/oauth/callback?code=xxx&state=USERID
 * 5. 后端用 code 换 user access_token
 * 6. 存到 user_tokens 表
 * 7. 302 跳回 H5 详情页（带成功提示）
 */

import type { Ctx } from '../../types.ts';
import { ok, fail } from '../../utils/json.ts';
import { buildAuthUrl, exchangeCodeForToken } from '../../dingtalk/oauth.ts';
import { getUserToken, upsertUserToken } from '../../db/queries.ts';

/**
 * 启动 OAuth 流程
 * POST /api/oauth/authorize?userid=xxx
 * 302 跳转到钉钉授权页
 */
export async function handleOAuthAuthorize(ctx: Ctx): Promise<Response> {
  const url = ctx.url;
  const userid = url.searchParams.get('userid');
  if (!userid) {
    return fail('VALIDATION_ERROR', '缺少 userid', 400);
  }

  // 拼 redirect_uri（必须和钉钉开发者后台配置的一致）
  const redirectUri = `${url.origin}/api/oauth/callback`;
  const authUrl = buildAuthUrl(ctx.env, redirectUri, userid);

  return new Response(null, {
    status: 302,
    headers: { location: authUrl },
  });
}

/**
 * OAuth 回调
 * GET /api/oauth/callback?code=xxx&state=USERID
 * - 拿 code 换 access_token
 * - 存到 user_tokens
 * - 跳回 H5 详情页（带成功提示）
 */
export async function handleOAuthCallback(ctx: Ctx): Promise<Response> {
  const url = ctx.url;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state'); // = userid
  const error = url.searchParams.get('error');

  const h5Base = url.origin;

  if (error) {
    return new Response(null, {
      status: 302,
      headers: { location: `${h5Base}/h5/p/${state ?? 'unknown'}?oauth_error=${encodeURIComponent(error)}` },
    });
  }

  if (!code || !state) {
    return new Response('缺少 code 或 state 参数', { status: 400 });
  }

  try {
    const tokenRes = await exchangeCodeForToken(ctx.env, code);
    const expiresAt = Date.now() + tokenRes.expireIn * 1000;
    const refreshExpiresAt = tokenRes.refreshTokenExpireIn
      ? Date.now() + tokenRes.refreshTokenExpireIn * 1000
      : null;

    await upsertUserToken(ctx.env.DB, {
      userid: state,
      access_token: tokenRes.accessToken,
      refresh_token: tokenRes.refreshToken ?? null,
      expires_at: expiresAt,
      refresh_expires_at: refreshExpiresAt,
      scope: tokenRes.scope ?? null,
      union_id: tokenRes.unionId ?? null,
    });

    // 跳回 H5 详情页（带 success=1）
    return new Response(null, {
      status: 302,
      headers: { location: `${h5Base}/h5/p/${state}?oauth=success` },
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return new Response(`OAuth 失败: ${err}`, { status: 500 });
  }
}

/**
 * 查推广人 token 状态
 * GET /api/oauth/status?userid=xxx
 */
export async function handleOAuthStatus(ctx: Ctx): Promise<Response> {
  const url = ctx.url;
  const userid = url.searchParams.get('userid');
  if (!userid) return fail('VALIDATION_ERROR', '缺少 userid', 400);
  const token = await getUserToken(ctx.env.DB, userid);
  if (!token) {
    return ok({ authorized: false });
  }
  const valid = token.expires_at > Date.now() + 60_000; // 留 1 分钟 buffer
  return ok({
    authorized: true,
    expires_at: token.expires_at,
    valid,
    scope: token.scope,
  });
}

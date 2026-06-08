/**
 * 钉钉 OAuth 2.0（用户授权）
 * - 推广人在 H5 详情页主动点击"开启待办通知"按钮
 * - 跳转钉钉授权页，用户确认后回调
 * - 后端用 code 换 user access_token，存 user_tokens 表
 *
 * 文档：
 * - 授权 URL: https://login.dingtalk.com/oauth2/auth
 * - 换 token: POST https://api.dingtalk.com/v1.0/oauth2/userAccessToken
 */

import type { Env } from '../types.ts';

const AUTH_BASE = 'https://login.dingtalk.com/oauth2/auth';
const TOKEN_URL = 'https://api.dingtalk.com/v1.0/oauth2/userAccessToken';

/**
 * 拼钉钉授权 URL
 * 推广人点按钮 → 跳到这个 URL → 钉钉显示授权页 → 用户同意 → 回调到 redirect_uri
 */
export function buildAuthUrl(
  env: Env,
  redirectUri: string,
  state: string,
  scope: string = 'openid Todo.PersonalTodo.Write'
): string {
  if (!env.DINGTALK_APP_KEY) throw new Error('DINGTALK_APP_KEY 未配置');
  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    response_type: 'code',
    client_id: env.DINGTALK_APP_KEY,
    scope,
    state,
    prompt: 'consent',
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expireIn: number;            // access_token 有效秒数（通常是 7200）
  refreshTokenExpireIn: number;
  scope: string;
  unionId: string;
  nick?: string;
  openid?: string;
}

/**
 * 用授权码换 access_token
 */
export async function exchangeCodeForToken(
  env: Env,
  code: string
): Promise<TokenResponse> {
  if (!env.DINGTALK_APP_KEY || !env.DINGTALK_APP_SECRET) {
    throw new Error('DINGTALK_APP_KEY / DINGTALK_APP_SECRET 未配置');
  }
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clientId: env.DINGTALK_APP_KEY,
      clientSecret: env.DINGTALK_APP_SECRET,
      code,
      grantType: 'authorization_code',
    }),
  });
  const data = (await r.json()) as TokenResponse & { errcode?: number; errmsg?: string };
  if (!data.accessToken) {
    throw new Error(`换 token 失败: ${data.errmsg ?? '未知错误'} (errcode=${data.errcode ?? 'N/A'})`);
  }
  return data as TokenResponse;
}

/**
 * 刷新 access_token
 */
export async function refreshAccessToken(
  env: Env,
  refreshToken: string
): Promise<TokenResponse> {
  if (!env.DINGTALK_APP_KEY || !env.DINGTALK_APP_SECRET) {
    throw new Error('DINGTALK_APP_KEY / DINGTALK_APP_SECRET 未配置');
  }
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clientId: env.DINGTALK_APP_KEY,
      clientSecret: env.DINGTALK_APP_SECRET,
      refreshToken,
      grantType: 'refresh_token',
    }),
  });
  const data = (await r.json()) as TokenResponse & { errcode?: number; errmsg?: string };
  if (!data.accessToken) {
    throw new Error(`刷新 token 失败: ${data.errmsg ?? '未知错误'} (errcode=${data.errcode ?? 'N/A'})`);
  }
  return data as TokenResponse;
}

/**
 * 用 access_token 调钉钉用户身份 API
 * 自动处理 401（access token 过期时用 refresh_token 刷新）
 */
export async function userFetch(
  env: Env,
  accessToken: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = path.startsWith('http') ? path : `https://api.dingtalk.com${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      'x-acs-dingtalk-access-token': accessToken,
      'content-type': (init.headers as Record<string, string>)?.['content-type'] ?? 'application/json',
    },
  });
  return r;
}

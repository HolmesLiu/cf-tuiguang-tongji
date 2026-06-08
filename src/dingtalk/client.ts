/**
 * 钉钉 API 通用客户端
 * - access_token 自动获取与缓存（存 D1 + KV）
 * - 统一 fetch 封装
 */

import type { Env, DingtalkAccessTokenResponse } from '../types.ts';
import { getConfig, setAccessToken } from '../db/queries.ts';

const OLD_API_BASE = 'https://oapi.dingtalk.com';
const NEW_API_BASE = 'https://api.dingtalk.com';
const KV_TOKEN_KEY = 'dingtalk:access_token';

/**
 * 获取 corp access_token（自动缓存）
 */
export async function getAccessToken(env: Env): Promise<string> {
  // 1. 先看 KV
  const cached = await env.KV.get(KV_TOKEN_KEY);
  if (cached) {
    const parsed = safeParse<{ token: string; expiresAt: number }>(cached);
    if (parsed && parsed.expiresAt > Date.now() + 5 * 60 * 1000) {
      return parsed.token;
    }
  }

  // 2. 看 D1
  const cfg = await getConfig(env.DB);
  if (cfg?.dingtalk_access_token && cfg.dingtalk_token_expires && cfg.dingtalk_token_expires > Date.now() + 5 * 60 * 1000) {
    // 回填到 KV
    await env.KV.put(KV_TOKEN_KEY, JSON.stringify({
      token: cfg.dingtalk_access_token,
      expiresAt: cfg.dingtalk_token_expires,
    }), { expirationTtl: 7200 });
    return cfg.dingtalk_access_token;
  }

  // 3. 重新请求
  if (!env.DINGTALK_APP_KEY || !env.DINGTALK_APP_SECRET) {
    throw new Error('钉钉 AppKey/AppSecret 未配置');
  }

  const url = `${OLD_API_BASE}/gettoken?appkey=${encodeURIComponent(env.DINGTALK_APP_KEY)}&appsecret=${encodeURIComponent(env.DINGTALK_APP_SECRET)}`;
  const r = await fetch(url);
  const data = (await r.json()) as DingtalkAccessTokenResponse;
  if (data.errcode !== 0 || !data.access_token) {
    throw new Error(`获取 access_token 失败: ${data.errmsg} (errcode=${data.errcode})`);
  }

  const expiresAt = Date.now() + (data.expires_in ?? 7200) * 1000;
  await setAccessToken(env.DB, data.access_token, expiresAt);
  await env.KV.put(KV_TOKEN_KEY, JSON.stringify({ token: data.access_token, expiresAt }), { expirationTtl: 7200 });

  return data.access_token;
}

/**
 * 通用 GET 请求（老接口，access_token 放 query）
 */
export async function dtGet<T = unknown>(
  env: Env,
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  const token = await getAccessToken(env);
  const url = new URL(`${OLD_API_BASE}${path}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

/**
 * 通用 POST 请求（老接口）
 */
export async function dtPost<T = unknown>(
  env: Env,
  path: string,
  body: unknown
): Promise<T> {
  const token = await getAccessToken(env);
  const url = `${OLD_API_BASE}${path}?access_token=${token}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

function safeParse<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}

/**
 * 强制刷新 access_token（用于配置更新后）
 */
export async function clearAccessToken(env: Env): Promise<void> {
  await env.KV.delete(KV_TOKEN_KEY);
  await setAccessToken(env.DB, '', 0);
}

/**
 * 显式设置 access_token（用于测试 / 应急）
 */
export async function setExplicitToken(env: Env, token: string, expiresIn = 7200): Promise<void> {
  const expiresAt = Date.now() + expiresIn * 1000;
  await setAccessToken(env.DB, token, expiresAt);
  await env.KV.put(KV_TOKEN_KEY, JSON.stringify({ token, expiresAt }), { expirationTtl: expiresIn });
}

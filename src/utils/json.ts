/**
 * 统一 JSON 响应工具
 */

import type { ApiResponse } from '../types.ts';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

/**
 * 成功响应
 */
export function ok<T>(data: T, init: ResponseInit = {}): Response {
  const body: ApiResponse<T> = { ok: true, data };
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers ?? {}) },
  });
}

/**
 * 失败响应
 */
export function fail(
  code: string,
  message: string,
  status: number,
  details?: unknown
): Response {
  const body: ApiResponse<never> = {
    ok: false,
    error: { code, message, details },
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

/**
 * 解析 JSON 请求体
 */
export async function parseJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error('Invalid JSON body');
  }
}

/**
 * 安全解析 JSON 字符串（不抛错）
 */
export function safeJson<T = unknown>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/**
 * 301/302 跳转响应
 */
export function redirect(location: string, status: 301 | 302 | 307 | 308 = 302): Response {
  return new Response(null, {
    status,
    headers: { location },
  });
}

/**
 * 解析 Cookie
 */
export function parseCookie(header: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (!k) continue;
    result[k] = decodeURIComponent(v.join('='));
  }
  return result;
}

/**
 * 序列化 Cookie
 */
export function serializeCookie(
  name: string,
  value: string,
  opts: {
    maxAge?: number;
    expires?: Date;
    path?: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
  } = {}
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  parts.push(`Path=${opts.path ?? '/'}`);
  if (opts.httpOnly ?? true) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  parts.push(`SameSite=${opts.sameSite ?? 'Strict'}`);
  return parts.join('; ');
}

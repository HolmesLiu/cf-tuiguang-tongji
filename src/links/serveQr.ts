/**
 * 二维码图片代理（公开）
 * GET /qr/:key
 * 支持 .png（兼容旧数据）和 .svg（新格式）
 */

import type { Env } from '../types.ts';

export async function handleServeQr(env: Env, key: string): Promise<Response> {
  // 安全：限制 key 格式，避免路径穿越
  if (!/^qr\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(png|svg)$/.test(key)) {
    return new Response('Not Found', { status: 404 });
  }
  const obj = await env.QR_BUCKET.get(key);
  if (!obj) {
    return new Response('QR not found', { status: 404 });
  }
  const headers = new Headers();
  const isSvg = key.endsWith('.svg');
  headers.set('content-type', isSvg ? 'image/svg+xml; charset=utf-8' : 'image/png');
  headers.set('cache-control', 'public, max-age=86400');
  return new Response(obj.body, { status: 200, headers });
}

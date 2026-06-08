/**
 * 二维码生成 + R2 存储
 * 用 qrcode-svg（纯 SVG，无 Buffer 依赖，CF Workers 友好）
 */

import QRCode from 'qrcode-svg';
import type { Env } from '../types.ts';
import { buildQrR2Key } from './shortener.ts';

interface QrOptions {
  width?: number;
  height?: number;
  padding?: number;
  color?: string;
  background?: string;
  ecl?: 'L' | 'M' | 'Q' | 'H';
}

const DEFAULT_OPTIONS: QrOptions = {
  width: 400,
  height: 400,
  padding: 2,
  color: '#000000',
  background: '#ffffff',
  ecl: 'M',
};

/**
 * 生成二维码 SVG 字符串
 */
export function generateQrSvg(text: string, opts: QrOptions = {}): string {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const qr = new QRCode({
    content: text,
    padding: o.padding,
    width: o.width,
    height: o.height,
    color: o.color,
    background: o.background,
    ecl: o.ecl,
  });
  return qr.svg();
}

/**
 * 生成二维码 SVG 并存到 R2
 * 返回 R2 key
 */
export async function generateAndStoreQr(env: Env, text: string, shortCode: string): Promise<string> {
  const svg = generateQrSvg(text);
  const key = buildQrR2Key(shortCode).replace(/\.png$/, '.svg');
  await env.QR_BUCKET.put(key, svg, {
    httpMetadata: {
      contentType: 'image/svg+xml; charset=utf-8',
      cacheControl: 'public, max-age=86400',
    },
  });
  return key;
}

/**
 * 从 R2 读取二维码
 */
export async function getQrFromR2(env: Env, key: string): Promise<R2ObjectBody | null> {
  return env.QR_BUCKET.get(key);
}

/**
 * 构建二维码的公开访问 URL
 */
export function buildQrPublicUrl(base: string, key: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}/qr/${key}`;
}

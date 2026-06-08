/**
 * 二维码生成 + R2 存储
 */

import qrcodeModule from 'qrcode';
import type { Env } from '../types.ts';
import { buildQrR2Key } from './shortener.ts';

// CF Workers / esbuild 打包 CJS 互操作可能把 default 套一层
// 这里兼容两种情况：QRCode.toBuffer 或 QRCode.default.toBuffer
const QRCode: typeof qrcodeModule = (qrcodeModule as any).default ?? qrcodeModule;

const QR_OPTIONS = {
  type: 'png' as const,
  width: 400,
  margin: 2,
  errorCorrectionLevel: 'M' as const,
  color: {
    dark: '#000000',
    light: '#ffffff',
  },
};

/**
 * 生成二维码 PNG Buffer
 */
export async function generateQrPng(text: string): Promise<Uint8Array> {
  // qrcode.toBuffer 在 Workers 兼容模式下返回 Uint8Array
  const buf = (await QRCode.toBuffer(text, QR_OPTIONS)) as Uint8Array;
  return buf;
}

/**
 * 生成二维码并存到 R2
 * 返回 R2 key
 */
export async function generateAndStoreQr(env: Env, text: string, shortCode: string): Promise<string> {
  const png = await generateQrPng(text);
  const key = buildQrR2Key(shortCode);
  await env.QR_BUCKET.put(key, png, {
    httpMetadata: {
      contentType: 'image/png',
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
  // key 形如 "qr/AB/ABCDEFGH.png"
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}/qr/${key}`;
}

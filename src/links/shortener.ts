/**
 * 短链生成
 * - 8 位 base62（用 nanoid 的自定义字母表）
 * - 唯一性通过 DB UNIQUE 约束 + 应用层重试兜底
 */

import { customAlphabet } from 'nanoid';

// 不使用 0/O/1/l/I 等易混淆字符
const SHORT_CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const SHORT_CODE_LENGTH = 8;

const generate = customAlphabet(SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH);

/**
 * 生成一个短码
 */
export function makeShortCode(): string {
  return generate();
}

/**
 * 拼出完整短链 URL
 */
export function buildShortUrl(base: string, code: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}/s/${code}`;
}

/**
 * 生成 R2 存储 key
 */
export function buildQrR2Key(shortCode: string): string {
  // 简单分片：前 2 位作为目录，避免单目录过多
  // 扩展名 .svg（qrcode-svg 输出的格式）
  return `qr/${shortCode.slice(0, 2)}/${shortCode}.svg`;
}

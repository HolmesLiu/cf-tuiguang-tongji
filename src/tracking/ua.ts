/**
 * UA 解析
 * 用 ua-parser-js（CF Workers 兼容）
 */

import { UAParser } from 'ua-parser-js';

export interface ParsedUA {
  browser: string | null;
  os: string | null;
  device_type: string | null;
}

export function parseUA(userAgent: string | null): ParsedUA {
  if (!userAgent) return { browser: null, os: null, device_type: null };
  try {
    const parser = new UAParser(userAgent);
    const r = parser.getResult();
    return {
      browser: r.browser.name ?? null,
      os: r.os.name ?? null,
      device_type: r.device.type ?? 'desktop', // 桌面浏览器 ua-parser 经常返回 undefined
    };
  } catch {
    return { browser: null, os: null, device_type: null };
  }
}

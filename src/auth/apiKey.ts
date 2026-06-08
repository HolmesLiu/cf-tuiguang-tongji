/**
 * Agent API Key 鉴权
 */

import type { Env, ApiKey, Ctx } from '../types.ts';
import { findActiveApiKey, touchApiKey } from '../db/queries.ts';
import { fail } from '../utils/json.ts';

/**
 * 从 X-API-Key 或 Authorization: Bearer *** 读取 key
 */
export function readApiKey(req: Request): string | null {
  const header = req.headers.get('x-api-key');
  if (header) return header.trim();
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

export async function requireApiKey(ctx: Ctx): Promise<{ ok: true; key: ApiKey } | { ok: false; response: Response }> {
  const plain = readApiKey(ctx.request);
  if (!plain) {
    return { ok: false, response: fail('UNAUTHORIZED', '缺少 X-API-Key', 401) };
  }
  const key = await findActiveApiKey(ctx.env.DB, plain);
  if (!key) {
    return { ok: false, response: fail('UNAUTHORIZED', 'API Key 无效或已吊销', 401) };
  }
  // 异步记录 last_used_at（不阻塞）
  ctx.request.headers;
  ctx.env.DB;
  touchApiKey(ctx.env.DB, key.id);
  return { ok: true, key };
}

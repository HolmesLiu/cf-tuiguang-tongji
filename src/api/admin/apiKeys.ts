/**
 * API Key 管理
 */

import type { Ctx } from '../../types.ts';
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
} from '../../db/queries.ts';
import { fail, ok, parseJson } from '../../utils/json.ts';
import { requireAdmin } from '../../auth/admin.ts';

export async function handleListApiKeys(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  const keys = await listApiKeys(ctx.env.DB);
  return ok({ keys });
}

export async function handleCreateApiKey(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  const body = await parseJson<{ name?: string }>(ctx.request);
  if (!body.name) return fail('VALIDATION_ERROR', 'name 必填', 400);
  const { apiKey, plainKey } = await createApiKey(ctx.env.DB, body.name);
  // plainKey 只返回这一次，前端展示给用户复制
  return ok({
    api_key: {
      id: apiKey.id,
      name: apiKey.name,
      key_prefix: apiKey.key_prefix,
      created_at: apiKey.created_at,
    },
    plain_key: plainKey,
    notice: '请妥善保存，关闭后无法再次查看',
  });
}

export async function handleRevokeApiKey(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  const id = parseInt(ctx.params.id, 10);
  if (isNaN(id)) return fail('VALIDATION_ERROR', 'id 非法', 400);
  await revokeApiKey(ctx.env.DB, id);
  return ok({ revoked: true });
}

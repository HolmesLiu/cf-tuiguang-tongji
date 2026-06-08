/**
 * 系统配置 API
 */

import type { Env, Ctx, Config } from '../../types.ts';
import { getConfig, updateConfig } from '../../db/queries.ts';
import { fail, ok, parseJson } from '../../utils/json.ts';
import { requireAdmin } from '../../auth/admin.ts';
import { clearAccessToken, setExplicitToken } from '../../dingtalk/client.ts';
import { z } from 'zod';

const updateConfigSchema = z.object({
  dingtalk_corp_id: z.string().optional().nullable(),
  dingtalk_app_key: z.string().optional().nullable(),
  dingtalk_app_secret: z.string().optional().nullable(),
  dingtalk_agent_id: z.string().optional().nullable(),
  default_message_type: z.enum(['work_notification', 'todo']).optional(),
});

/**
 * 脱敏：app_secret 只显示前 4 位
 */
function maskConfig(cfg: Config | null): unknown {
  if (!cfg) return null;
  return {
    ...cfg,
    dingtalk_app_secret: cfg.dingtalk_app_secret
      ? cfg.dingtalk_app_secret.slice(0, 4) + '****'
      : null,
  };
}

export async function handleGetConfig(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  const cfg = await getConfig(ctx.env.DB);
  return ok({ config: maskConfig(cfg) });
}

export async function handleUpdateConfig(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;

  const parsed = updateConfigSchema.safeParse(await parseJson(ctx.request));
  if (!parsed.success) {
    return fail('VALIDATION_ERROR', '参数不合法', 400, parsed.error.flatten());
  }
  await updateConfig(ctx.env.DB, parsed.data);
  // 清空旧 access_token，强制下次重新拉
  await clearAccessToken(ctx.env);
  return ok({ updated: true });
}

/**
 * 手动设置 access_token（应急用）
 */
export async function handleSetToken(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  const body = await parseJson<{ token: string; expires_in?: number }>(ctx.request);
  if (!body.token) return fail('VALIDATION_ERROR', 'token 必填', 400);
  await setExplicitToken(ctx.env, body.token, body.expires_in);
  return ok({ set: true });
}

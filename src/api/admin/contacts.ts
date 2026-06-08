/**
 * 通讯录管理 API
 */

import type { Ctx } from '../../types.ts';
import { listDepartments, listUsers, getConfig } from '../../db/queries.ts';
import { fail, ok, parseJson } from '../../utils/json.ts';
import { requireAdmin } from '../../auth/admin.ts';
import { syncAllContacts, getSubDepartments } from '../../dingtalk/contacts.ts';
import { getAccessToken } from '../../dingtalk/client.ts';

const KV_SYNC_PROGRESS = 'contacts:sync:progress';

export async function handleListDepartments(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  const depts = await listDepartments(ctx.env.DB);
  return ok({ departments: depts });
}

export async function handleListUsers(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  const url = ctx.url;
  const q = url.searchParams.get('q') ?? undefined;
  const dept_id = url.searchParams.get('dept_id');
  const is_active = url.searchParams.get('is_active');
  const page = parseInt(url.searchParams.get('page') ?? '1', 10);
  const page_size = parseInt(url.searchParams.get('page_size') ?? '20', 10);

  const result = await listUsers(ctx.env.DB, {
    q,
    dept_id: dept_id ? parseInt(dept_id, 10) : undefined,
    is_active: is_active !== null ? parseInt(is_active, 10) : undefined,
    page,
    page_size,
  });
  return ok(result);
}

export async function handleSyncContacts(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  const cfg = await getConfig(ctx.env.DB);
  if (!cfg?.dingtalk_app_key || !cfg?.dingtalk_app_secret) {
    return fail('VALIDATION_ERROR', '请先在「系统配置」中填写 AppKey / AppSecret', 400);
  }

  // 同步 access_token 提前校验
  try {
    await getAccessToken(ctx.env);
  } catch (e) {
    return fail('DINGTALK_API_ERROR', `钉钉鉴权失败：${e instanceof Error ? e.message : String(e)}`, 502);
  }

  // 同步过程（同步阻塞，UI 显示进度）
  const cacheProgress = async (p: unknown) => {
    try {
      await ctx.env.KV.put(KV_SYNC_PROGRESS, JSON.stringify(p), { expirationTtl: 600 });
    } catch {}
  };

  try {
    const result = await syncAllContacts(ctx.env, async (p) => {
      await cacheProgress({ status: 'running', progress: p, error: null });
    });
    await cacheProgress({ status: 'done', progress: null, result, error: null });
    return ok({ result });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await cacheProgress({ status: 'error', progress: null, error: err });
    return fail('SYNC_ERROR', err, 500);
  }
}

export async function handleSyncStatus(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  const v = await ctx.env.KV.get(KV_SYNC_PROGRESS);
  if (!v) return ok({ status: 'idle' });
  return ok(JSON.parse(v));
}

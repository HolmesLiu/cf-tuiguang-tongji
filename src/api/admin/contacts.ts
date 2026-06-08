/**
 * 通讯录管理 API
 *
 * /api/contacts/sync (POST)        启动一次全量同步（清空 + 入队 + 跑首批）
 * /api/contacts/sync/status (GET)  查同步状态（status / queue / 进度 / 错误）
 * /api/contacts/sync/reset (POST)  重置状态（调试用）
 *
 * 大批量同步通过 wrangler.toml 的 cron trigger（每 5 分钟）自动推进。
 */

import type { Ctx } from '../../types.ts';
import { listDepartments, listUsers, getConfig } from '../../db/queries.ts';
import { fail, ok } from '../../utils/json.ts';
import { requireAdmin } from '../../auth/admin.ts';
import { getAccessToken } from '../../dingtalk/client.ts';
import { startSync, processNextBatch, resetSyncState } from '../../dingtalk/syncBatch.ts';
import { getSyncState } from '../../dingtalk/syncState.ts';

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

  // 鉴权钉钉
  try {
    await getAccessToken(ctx.env);
  } catch (e) {
    return fail('DINGTALK_API_ERROR', `钉钉鉴权失败：${e instanceof Error ? e.message : String(e)}`, 502);
  }

  try {
    const state = await startSync(ctx.env);
    return ok({
      message: '已启动全量同步。后台每 5 分钟推进一批。',
      state: serializeState(state),
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    if (err.includes('Too many subrequests')) {
      const hint = `同步批次触发了 subrequest 上限（即使分批也可能遇到企业非常大时）。\n` +
        `请联系大宇进一步缩减 BATCH_SIZE。错误：${err}`;
      return fail('SYNC_ERROR', hint, 500);
    }
    return fail('SYNC_ERROR', err, 500);
  }
}

export async function handleSyncStatus(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  const state = await getSyncState(ctx.env);
  return ok({ state: serializeState(state) });
}

export async function handleSyncReset(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  await resetSyncState(ctx.env);
  return ok({ reset: true });
}

export async function handleSyncTick(ctx: Ctx): Promise<Response> {
  // 手动推进一批（前端按钮调试用，不依赖 cron 等待）
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  const state = await processNextBatch(ctx.env);
  return ok({ state: serializeState(state) });
}

/**
 * 把 state 里的大数组剥掉（seen/queue 可能很大）
 * 保留进度信息
 */
function serializeState(state: any) {
  return {
    status: state.status,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    lastBatchAt: state.lastBatchAt,
    discoveredDepts: state.discoveredDepts,
    syncedDepts: state.syncedDepts,
    syncedUsers: state.syncedUsers,
    queueLength: state.queue?.length ?? 0,
    seenLength: state.seen?.length ?? 0,
    currentBatchDepts: state.currentBatchDepts,
    error: state.error,
  };
}

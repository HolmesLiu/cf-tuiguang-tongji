/**
 * 通讯录管理 API
 *
 * /api/contacts/sync (POST)        同步（智能路由）：
 *                                   - idle/error/done → 启动新同步（清空 + 跑首批）
 *                                   - pending → 继续推进（单次 invocation 跑尽可能多批，受 25s wall time 限制）
 * /api/contacts/sync/status (GET)  查同步状态
 * /api/contacts/sync/reset (POST)  重置状态（调试用）
 *
 * 纯手动同步模式：用户点按钮 → 前端反复调本 API → 库同步完成
 */

import type { Ctx } from '../../types.ts';
import { listDepartments, listUsers, getConfig } from '../../db/queries.ts';
import { fail, ok } from '../../utils/json.ts';
import { requireAdmin } from '../../auth/admin.ts';
import { getAccessToken } from '../../dingtalk/client.ts';
import { startSync, runUntilDoneOrTimeout, resetSyncState } from '../../dingtalk/syncBatch.ts';
import { getSyncState } from '../../dingtalk/syncState.ts';

const MAX_WALL_MS_PER_INVOCATION = 25_000;  // 25 秒硬上限（留 5 秒缓冲）

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

  // 鉴权钉钉（仅在启动时需要新 token；pending 状态 token 还在 cache 里）
  const beforeState = await getSyncState(ctx.env);
  if (beforeState.status !== 'pending') {
    try {
      await getAccessToken(ctx.env);
    } catch (e) {
      return fail('DINGTALK_API_ERROR', `钉钉鉴权失败：${e instanceof Error ? e.message : String(e)}`, 502);
    }
  }

  try {
    let state = beforeState;
    if (state.status === 'pending') {
      // 继续推进：单次 invocation 跑尽可能多批
      state = await runUntilDoneOrTimeout(ctx.env, MAX_WALL_MS_PER_INVOCATION);
      return ok({
        message: state.status === 'done' ? '同步完成' : '已推进一批，请前端继续触发',
        state: serializeState(state),
      });
    } else {
      // 启动新同步
      state = await startSync(ctx.env);
      return ok({
        message: '已启动全量同步，正在跑首批',
        state: serializeState(state),
      });
    }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    if (err.includes('Too many subrequests')) {
      const hint = `单次 invocation 仍超 subrequest 上限。\n` +
        `请大宇缩小 BATCH_SIZE（src/dingtalk/syncBatch.ts）。错误：${err}`;
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

/**
 * 后台任务管理 API
 */

import type { Ctx } from '../../types.ts';
import {
  listTasks,
  getTask,
  updateTask,
  listTargetsByTask,
  listClicksByTarget,
  getPromoterRanking,
  getUser,
} from '../../db/queries.ts';
import { fail, ok, parseJson } from '../../utils/json.ts';
import { requireAdmin } from '../../auth/admin.ts';
import { handleCreateTask } from '../../tasks/create.ts';
import { publishTask } from '../../tasks/publish.ts';
import { archiveTaskFlow, restoreArchivedTask, hardDeleteArchived } from '../../tasks/archive.ts';
import { getTaskStats } from '../../tasks/stats.ts';
import { z } from 'zod';

const updateTaskSchema = z.object({
  title: z.string().max(200).optional().nullable(),
  receivers: z.object({
    users: z.array(z.string()),
    departments: z.array(z.number()),
  }).optional(),
  message_type: z.enum(['work_notification', 'todo']).optional(),
  polished: z.object({
    friend_circle: z.string(),
    group: z.string(),
    private: z.string(),
  }).optional(),
});

export async function handleListTasks(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  const url = ctx.url;
  const status = url.searchParams.get('status') as 'draft' | 'published' | 'archived' | null;
  const include_deleted = url.searchParams.get('include_deleted') === 'true';
  const page = parseInt(url.searchParams.get('page') ?? '1', 10);
  const page_size = parseInt(url.searchParams.get('page_size') ?? '20', 10);
  const result = await listTasks(ctx.env.DB, { status: status ?? undefined, include_deleted, page, page_size });
  return ok(result);
}

export async function handleGetTask(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  const task = await getTask(ctx.env.DB, ctx.params.id, true);
  if (!task) return fail('NOT_FOUND', '任务不存在', 404);
  const targets = await listTargetsByTask(ctx.env.DB, ctx.params.id);
  // 给 target 补全 name
  const enriched = await Promise.all(
    targets.map(async (t) => {
      const u = await getUser(ctx.env.DB, t.userid);
      return { ...t, name: u?.name ?? t.userid };
    })
  );
  return ok({ task, targets: enriched });
}

export async function handleUpdateTask(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  const existing = await getTask(ctx.env.DB, ctx.params.id, true);
  if (!existing) return fail('NOT_FOUND', '任务不存在', 404);
  if (existing.status !== 'draft') return fail('VALIDATION_ERROR', '只有 draft 状态可编辑', 400);

  const parsed = updateTaskSchema.safeParse(await parseJson(ctx.request));
  if (!parsed.success) return fail('VALIDATION_ERROR', '参数不合法', 400, parsed.error.flatten());

  const patch: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.receivers) patch.receivers_json = JSON.stringify(parsed.data.receivers);
  if (parsed.data.message_type) patch.message_type = parsed.data.message_type;
  if (parsed.data.polished) patch.polished_json = JSON.stringify(parsed.data.polished);

  const updated = await updateTask(ctx.env.DB, ctx.params.id, patch);
  return ok({ task: updated });
}

export async function handleDeleteTask(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  try {
    await archiveTaskFlow(ctx.env, ctx.params.id, r.admin.username);
    return ok({ archived: true });
  } catch (e) {
    return fail('INTERNAL_ERROR', e instanceof Error ? e.message : String(e), 500);
  }
}

export async function handlePublishTask(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  try {
    const result = await publishTask(ctx.env, ctx.params.id);
    return ok({ result });
  } catch (e) {
    return fail('PUBLISH_ERROR', e instanceof Error ? e.message : String(e), 500);
  }
}

export async function handleTaskStats(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  const stats = await getTaskStats(ctx.env, ctx.params.id);
  return ok({ stats });
}

export async function handleTargetClicks(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  const url = ctx.url;
  const page = parseInt(url.searchParams.get('page') ?? '1', 10);
  const page_size = parseInt(url.searchParams.get('page_size') ?? '50', 10);
  const result = await listClicksByTarget(ctx.env.DB, ctx.params.id, ctx.params.userid, page, page_size);
  return ok(result);
}

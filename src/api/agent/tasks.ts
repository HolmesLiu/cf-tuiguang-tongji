/**
 * Agent API（API Key 鉴权）
 */

import type { Ctx } from '../../types.ts';
import {
  listTasks,
  getTask,
  listTargetsByTask,
  listClicksByTarget,
  getUser,
} from '../../db/queries.ts';
import { fail, ok } from '../../utils/json.ts';
import { requireApiKey } from '../../auth/apiKey.ts';
import { handleCreateTask } from '../../tasks/create.ts';
import { publishTask } from '../../tasks/publish.ts';
import { getTaskStats } from '../../tasks/stats.ts';

export async function handleAgentCreateTask(ctx: Ctx): Promise<Response> {
  const r = await requireApiKey(ctx);
  if (!r.ok) return r.response;
  const body = await ctx.request.json().catch(() => null);
  return handleCreateTask(ctx.env.DB, body, {
    source: 'agent',
    createdBy: 'agent',
    creatorId: 'agent',
  });
}

export async function handleAgentPublishTask(ctx: Ctx): Promise<Response> {
  const r = await requireApiKey(ctx);
  if (!r.ok) return r.response;
  try {
    const result = await publishTask(ctx.env, ctx.params.id);
    return ok({ result });
  } catch (e) {
    return fail('PUBLISH_ERROR', e instanceof Error ? e.message : String(e), 500);
  }
}

export async function handleAgentListTasks(ctx: Ctx): Promise<Response> {
  const r = await requireApiKey(ctx);
  if (!r.ok) return r.response;
  const url = ctx.url;
  const page = parseInt(url.searchParams.get('page') ?? '1', 10);
  const page_size = parseInt(url.searchParams.get('page_size') ?? '20', 10);
  const result = await listTasks(ctx.env.DB, {
    creator_id: 'agent',
    page,
    page_size,
  });
  return ok(result);
}

export async function handleAgentGetTask(ctx: Ctx): Promise<Response> {
  const r = await requireApiKey(ctx);
  if (!r.ok) return r.response;
  const task = await getTask(ctx.env.DB, ctx.params.id, true);
  if (!task) return fail('NOT_FOUND', '任务不存在', 404);
  const targets = await listTargetsByTask(ctx.env.DB, ctx.params.id);
  const enriched = await Promise.all(
    targets.map(async (t) => {
      const u = await getUser(ctx.env.DB, t.userid);
      return { ...t, name: u?.name ?? t.userid };
    })
  );
  const stats = await getTaskStats(ctx.env, ctx.params.id);
  return ok({ task, targets: enriched, stats });
}

export async function handleAgentGetTargetClicks(ctx: Ctx): Promise<Response> {
  const r = await requireApiKey(ctx);
  if (!r.ok) return r.response;
  const url = ctx.url;
  const page = parseInt(url.searchParams.get('page') ?? '1', 10);
  const page_size = parseInt(url.searchParams.get('page_size') ?? '50', 10);
  const result = await listClicksByTarget(ctx.env.DB, ctx.params.id, ctx.params.userid, page, page_size);
  return ok(result);
}

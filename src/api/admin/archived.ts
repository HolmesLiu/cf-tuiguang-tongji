/**
 * 归档管理 API
 */

import type { Ctx } from '../../types.ts';
import { listArchived, getArchived } from '../../db/queries.ts';
import { fail, ok } from '../../utils/json.ts';
import { requireAdmin } from '../../auth/admin.ts';
import { restoreArchivedTask, hardDeleteArchived } from '../../tasks/archive.ts';
import { safeJson } from '../../utils/json.ts';

export async function handleListArchived(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  const items = await listArchived(ctx.env.DB);
  // 解析 snapshot 摘要
  const summaries = items.map((a) => {
    const snap = safeJson<{ task?: { title?: string | null; original_url?: string } }>(a.snapshot, {});
    return {
      id: a.id,
      task_id: a.task_id,
      title: snap.task?.title ?? null,
      original_url: snap.task?.original_url ?? null,
      archived_at: a.archived_at,
      archived_by: a.archived_by,
    };
  });
  return ok({ archived: summaries });
}

export async function handleRestoreArchived(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  try {
    await restoreArchivedTask(ctx.env, ctx.params.taskId);
    return ok({ restored: true });
  } catch (e) {
    return fail('INTERNAL_ERROR', e instanceof Error ? e.message : String(e), 500);
  }
}

export async function handleHardDeleteArchived(ctx: Ctx): Promise<Response> {
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  try {
    await hardDeleteArchived(ctx.env, ctx.params.taskId);
    return ok({ deleted: true });
  } catch (e) {
    return fail('INTERNAL_ERROR', e instanceof Error ? e.message : String(e), 500);
  }
}

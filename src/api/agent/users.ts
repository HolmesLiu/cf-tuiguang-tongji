/**
 * Agent 推广人/部门查询
 */

import type { Ctx } from '../../types.ts';
import { listUsers, listDepartments } from '../../db/queries.ts';
import { ok } from '../../utils/json.ts';
import { requireApiKey } from '../../auth/apiKey.ts';

export async function handleAgentSearchUsers(ctx: Ctx): Promise<Response> {
  const r = await requireApiKey(ctx);
  if (!r.ok) return r.response;
  const url = ctx.url;
  const q = url.searchParams.get('q') ?? '';
  const page = parseInt(url.searchParams.get('page') ?? '1', 10);
  const page_size = parseInt(url.searchParams.get('page_size') ?? '20', 10);
  const result = await listUsers(ctx.env.DB, { q, page, page_size });
  return ok(result);
}

export async function handleAgentListDepartments(ctx: Ctx): Promise<Response> {
  const r = await requireApiKey(ctx);
  if (!r.ok) return r.response;
  const depts = await listDepartments(ctx.env.DB);
  return ok({ departments: depts });
}

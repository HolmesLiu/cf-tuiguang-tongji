/**
 * 任务归档、还原、彻底删除
 */

import type { Env } from '../types.ts';
import {
  archiveTask,
  softDeleteTask,
  deleteArchived,
  restoreArchived,
  getTask,
  getArchived,
  listTargetsByTask,
} from '../db/queries.ts';

/**
 * 软删（移到归档）
 */
export async function archiveTaskFlow(env: Env, taskId: string, archivedBy: string): Promise<void> {
  const task = await getTask(env.DB, taskId, true);
  if (!task) throw new Error('Task not found');
  // 1. 写归档快照
  await archiveTask(env.DB, taskId, archivedBy);
  // 2. 软删主表
  await softDeleteTask(env.DB, taskId);
}

/**
 * 还原归档
 */
export async function restoreArchivedTask(env: Env, taskId: string): Promise<void> {
  const archived = await getArchived(env.DB, taskId);
  if (!archived) throw new Error('归档记录不存在');
  await restoreArchived(env.DB, taskId);
}

/**
 * 彻底删除归档（不可逆）
 */
export async function hardDeleteArchived(env: Env, taskId: string): Promise<void> {
  await deleteArchived(env.DB, taskId);
}

/**
 * 通讯录同步状态机
 * - 状态存 KV（key: contacts:sync:state）
 * - 持久化 BFS 队列，支持分批推进
 * - 单次 invocation 内只处理 BATCH_SIZE 个部门，避免 subrequest 超限
 */

import type { Env, DingtalkDepartment, DingtalkUser } from '../types.ts';

const KV_KEY = 'contacts:sync:state';
const BATCH_SIZE = 3;                    // 每批处理 3 个部门
const MAX_SUBREQUESTS_PER_BATCH = 30;     // 单批硬上限，留 20 给其他

export type SyncStatus = 'idle' | 'pending' | 'done' | 'error';

export interface SyncState {
  status: SyncStatus;
  startedAt: number | null;
  finishedAt: number | null;
  lastBatchAt: number | null;

  // BFS：剩余待处理的部门 ID（从队列头开始处理）
  queue: number[];
  // 已发现的部门（防止重复入队）
  seen: number[];
  // 累计已拉部门数（每批递增）
  discoveredDepts: number;
  // 累计已写库部门数
  syncedDepts: number;
  // 累计已拉用户数
  syncedUsers: number;
  // 当前正在处理的部门 ID 列表（用于显示"正在处理 X 个部门"）
  currentBatchDepts: number[];

  // 错误信息
  error: string | null;
}

export const INITIAL_STATE: SyncState = {
  status: 'idle',
  startedAt: null,
  finishedAt: null,
  lastBatchAt: null,
  queue: [],
  seen: [],
  discoveredDepts: 0,
  syncedDepts: 0,
  syncedUsers: 0,
  currentBatchDepts: [],
  error: null,
};

/**
 * 读状态
 */
export async function getSyncState(env: Env): Promise<SyncState> {
  const v = await env.KV.get(KV_KEY);
  if (!v) return { ...INITIAL_STATE };
  try {
    return JSON.parse(v) as SyncState;
  } catch {
    return { ...INITIAL_STATE };
  }
}

/**
 * 写状态
 */
export async function setSyncState(env: Env, state: SyncState): Promise<void> {
  await env.KV.put(KV_KEY, JSON.stringify(state), { expirationTtl: 86400 * 7 });
}

export { BATCH_SIZE, MAX_SUBREQUESTS_PER_BATCH };

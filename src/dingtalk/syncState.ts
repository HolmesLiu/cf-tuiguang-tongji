/**
 * 通讯录同步状态机
 * - 状态存 KV（contacts:sync:state）
 * - 持久化 BFS 队列 + 已见部门缓存（避免每批查 D1）
 * - 单次 invocation 内只处理 BATCH_SIZE 个部门，避免 subrequest 超限
 */

import type { Env, DingtalkDepartment, DingtalkUser } from '../types.ts';

const KV_KEY = '***';
const BATCH_SIZE = 3;                    // 每批处理 3 个部门（CF Free plan 安全值）
const MAX_BATCHES_PER_INVOCATION = 2;    // 单次 invocation 最多跑 2 批（subrequest 预算 40 < 50）

export type SyncStatus = 'idle' | 'pending' | 'done' | 'error';

export interface SyncState {
  status: SyncStatus;
  startedAt: number | null;
  finishedAt: number | null;
  lastBatchAt: number | null;

  // BFS：剩余待处理的部门 ID
  queue: number[];
  // 已发现的部门 ID 列表
  seen: number[];
  // 已缓存的部门 Map（避免每批查 D1）
  // 序列化时是数组，反序列化时重建 Map
  deptCache: Array<{ dept_id: number; name: string; parent_id: number | null; path: string }>;
  // 累计已发现的部门数
  discoveredDepts: number;
  // 累计已写库部门数
  syncedDepts: number;
  // 累计已拉用户数
  syncedUsers: number;
  // 当前正在处理的部门 ID 列表
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
  deptCache: [],
  syncedDepts: 0,
  syncedUsers: 0,
  currentBatchDepts: [],
  error: null,
};

export async function getSyncState(env: Env): Promise<SyncState> {
  const v = await env.KV.get(KV_KEY);
  if (!v) return { ...INITIAL_STATE };
  try {
    return JSON.parse(v) as SyncState;
  } catch {
    return { ...INITIAL_STATE };
  }
}

export async function setSyncState(env: Env, state: SyncState): Promise<void> {
  await env.KV.put(KV_KEY, JSON.stringify(state), { expirationTtl: 86400 * 7 });
}

export { BATCH_SIZE, MAX_BATCHES_PER_INVOCATION };

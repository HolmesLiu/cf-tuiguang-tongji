/**
 * 通讯录分批同步（核心逻辑）
 *
 * - 启动：清空表 + 设状态 + 处理第一批
 * - 推进：从队列拉下一批部门（3 个），递归拉子部门 + 用户，写库
 * - 终止：队列空 + 当前批完成 → status: 'done'
 *
 * 单 invocation 最多跑 2 批（subrequest 预算 40 < 50）
 * 部门信息缓存到 state（避免每批 listDepartments）
 */

import type { Env, DingtalkDeptListResponse, DingtalkUserListResponse, DingtalkDepartment, DingtalkUser } from '../types.ts';
import { dtPost } from './client.ts';
import {
  bulkInsertDepartments,
  bulkInsertUsers,
  clearDepartments,
  clearUsers,
} from '../db/queries.ts';
import {
  getSyncState,
  setSyncState,
  INITIAL_STATE,
  BATCH_SIZE,
  MAX_BATCHES_PER_INVOCATION,
  SyncState,
} from './syncState.ts';

const PAGE_SIZE = 100;
const USER_PAGES_PER_DEPT = 5;            // 每部门最多 5 页（500 人）防 subrequest 超

// ==================== 启动 ====================

/**
 * 启动一次"全量同步"
 * - 清空 departments / users 表
 * - 初始化 state（队列 = [1] 根部门）
 * - 立即跑一批
 */
export async function startSync(env: Env): Promise<SyncState> {
  await clearDepartments(env.DB);
  await clearUsers(env.DB);

  const now = Date.now();
  const state: SyncState = {
    ...INITIAL_STATE,
    status: 'pending',
    startedAt: now,
    lastBatchAt: now,
    queue: [1],
    seen: [1],
    currentBatchDepts: [],
  };
  await setSyncState(env, state);

  await processNextBatch(env);

  return await getSyncState(env);
}

// ==================== 推进一批 ====================

/**
 * 推进一步：处理 BATCH_SIZE 个部门
 *  - 从队列头拿出部门
 *  - listsub 拿子部门
 *  - 写库（用 db.batch 合并，1 subrequest）
 *  - 然后拉这些新部门的用户，写库（1 subrequest）
 */
export async function processNextBatch(env: Env): Promise<SyncState> {
  const state = await getSyncState(env);
  if (state.status !== 'pending') return state;

  const t0 = Date.now();
  let subrequestsUsed = 0;
  const deptsToWrite: DingtalkDepartment[] = [];
  const usersToWrite: DingtalkUser[] = [];
  const currentBatchDepts: number[] = [];

  // 部门 Map（来自 state 缓存，避免查 D1）
  const deptById = new Map<number, { name: string; parent_id: number | null; path: string }>();
  for (const d of state.deptCache) {
    deptById.set(d.dept_id, d);
  }

  try {
    // ---------- 阶段 A: 拉本批部门的子部门 ----------
    while (
      state.queue.length > 0 &&
      currentBatchDepts.length < BATCH_SIZE &&
      subrequestsUsed < 15  // 留 25 给用户拉取
    ) {
      const deptId = state.queue.shift()!;
      currentBatchDepts.push(deptId);

      const resp = await dtPost<DingtalkDeptListResponse>(env, '/topapi/v2/department/listsub', {
        dept_id: deptId,
        language: 'zh_CN',
      });
      subrequestsUsed++;

      if (resp.errcode !== 0) {
        console.error(`[sync] listsub 失败 dept=${deptId}: ${resp.errmsg}`);
        continue;
      }
      if (!Array.isArray(resp.result)) continue;

      for (const d of resp.result) {
        if (!state.seen.includes(d.dept_id)) {
          state.seen.push(d.dept_id);
          state.discoveredDepts++;
          deptsToWrite.push({
            dept_id: d.dept_id,
            name: d.name,
            parent_id: d.parent_id || null,
            path: d.name,
            synced_at: 0,
          });
          state.queue.push(d.dept_id);
        }
      }
    }

    // 构建本批新部门的 path
    for (const d of deptsToWrite) {
      d.path = buildPathFromMap(d.dept_id, d.parent_id, deptById);
      // 缓存到 state
      state.deptCache.push({
        dept_id: d.dept_id,
        name: d.name,
        parent_id: d.parent_id,
        path: d.path,
      });
      deptById.set(d.dept_id, {
        name: d.name,
        parent_id: d.parent_id,
        path: d.path,
      });
    }
    state.syncedDepts += deptsToWrite.length;
    state.currentBatchDepts = currentBatchDepts;

    // ---------- 阶段 B: 拉本批新发现部门的用户 ----------
    let userBudget = 20;  // 留 5 给 batch dept/users
    for (const dept of deptsToWrite) {
      if (userBudget <= 0) break;
      let cursor = 0;
      let pageCount = 0;
      do {
        const resp = await dtPost<DingtalkUserListResponse>(env, '/topapi/v2/user/list', {
          dept_id: dept.dept_id,
          cursor,
          size: PAGE_SIZE,
          language: 'zh_CN',
        });
        subrequestsUsed++;
        userBudget--;
        pageCount++;

        if (resp.errcode !== 0) {
          console.error(`[sync] listuser 失败 dept=${dept.dept_id}: ${resp.errmsg}`);
          break;
        }
        if (!Array.isArray(resp.result?.list)) break;

        for (const u of resp.result.list) {
          const primaryDeptId = u.dept_id_list?.[0] ?? dept.dept_id;
          usersToWrite.push({
            userid: u.userid,
            name: u.name,
            mobile: u.mobile || null,
            avatar: u.avatar || null,
            dept_id: primaryDeptId,
            dept_path: buildPathFromMap(primaryDeptId, null, deptById),
            title: u.title ?? null,
            is_active: u.active ? 1 : 0,
            synced_at: 0,
          });
        }

        cursor = resp.result.has_more ? Number(resp.result.next_cursor) || 0 : -1;
      } while (cursor >= 0 && pageCount < USER_PAGES_PER_DEPT && userBudget > 0);
    }
    state.syncedUsers += usersToWrite.length;

    // ---------- 阶段 C: 写库（db.batch 合并 = 2 subrequest） ----------
    if (deptsToWrite.length > 0) {
      await bulkInsertDepartments(env.DB, deptsToWrite);
      subrequestsUsed++;
    }
    if (usersToWrite.length > 0) {
      await bulkInsertUsers(env.DB, usersToWrite);
      subrequestsUsed++;
    }

    // ---------- 更新状态 ----------
    state.lastBatchAt = Date.now();
    if (state.queue.length === 0) {
      state.status = 'done';
      state.finishedAt = Date.now();
      state.currentBatchDepts = [];
    }
    await setSyncState(env, state);

    console.log(
      `[sync] batch ok: depts +${deptsToWrite.length}, users +${usersToWrite.length}, ` +
      `queue=${state.queue.length}, subreq=${subrequestsUsed}, took=${Date.now() - t0}ms`
    );
    return state;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    state.status = 'error';
    state.error = err;
    state.lastBatchAt = Date.now();
    await setSyncState(env, state);
    console.error(`[sync] batch error:`, err);
    return state;
  }
}

// ==================== 连推：单次 invocation 内跑多批 ====================

/**
 * 循环跑批直到完成 / 出错 / 达到批数上限
 * 单 invocation 最多 2 批（subrequest 预算 ~40 < 50）
 */
export async function runUntilDoneOrTimeout(env: Env, maxWallMs = 25_000): Promise<SyncState> {
  const t0 = Date.now();
  let state = await getSyncState(env);
  if (state.status !== 'pending') return state;
  let batches = 0;
  while (state.status === 'pending' && batches < MAX_BATCHES_PER_INVOCATION) {
    if (Date.now() - t0 > maxWallMs) break;
    state = await processNextBatch(env);
    if (state.status === 'error') break;
    batches++;
  }
  return state;
}

// ==================== 重置 ====================

export async function resetSyncState(env: Env): Promise<void> {
  await env.KV.delete('contacts:sync:state');
}

// ==================== 辅助 ====================

function buildPathFromMap(
  selfId: number,
  _parentHint: number | null,
  byId: Map<number, { name: string; parent_id: number | null; path: string }>
): string {
  const path: string[] = [];
  let cur = byId.get(selfId);
  let guard = 0;
  while (cur && guard++ < 20) {
    path.unshift(cur.name);
    if (cur.parent_id == null) break;
    cur = byId.get(cur.parent_id);
  }
  return path.join('/');
}

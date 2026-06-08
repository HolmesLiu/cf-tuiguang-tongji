/**
 * 钉钉通讯录同步
 * - 全量同步（每次都重建，保证无重复）
 * - 部门递归：先根部门 listsub 拿子部门 ID，再递归
 * - 每个部门 listsub 拿完整子部门信息
 * - 每个部门 listsub 拉该部门下用户
 */

import type { Env, DingtalkDeptListResponse, DingtalkUserListResponse, DingtalkDepartment, DingtalkUser } from '../types.ts';
import { dtGet, dtPost } from './client.ts';
import { bulkInsertDepartments, bulkInsertUsers, clearDepartments, clearUsers, listDepartments } from '../db/queries.ts';

const PAGE_SIZE = 100;

export interface SyncProgress {
  phase: 'departments' | 'users' | 'finalize' | 'done';
  current: number;
  total: number;
  message: string;
}

export interface SyncResult {
  departments: number;
  users: number;
  durationMs: number;
}

/**
 * 全量同步通讯录
 */
export async function syncAllContacts(env: Env, onProgress?: (p: SyncProgress) => void): Promise<SyncResult> {
  const t0 = Date.now();

  // 1. 拉部门
  onProgress?.({ phase: 'departments', current: 0, total: 0, message: '开始拉取部门' });
  const depts = await fetchAllDepartments(env, onProgress);
  onProgress?.({ phase: 'departments', current: depts.length, total: depts.length, message: `获取到 ${depts.length} 个部门` });

  // 2. 拉用户（按部门）
  onProgress?.({ phase: 'users', current: 0, total: depts.length, message: '开始拉取用户' });
  const users = await fetchAllUsers(env, depts, onProgress);
  onProgress?.({ phase: 'users', current: depts.length, total: depts.length, message: `获取到 ${users.length} 个用户` });

  // 3. 写入（先建路径字段，再批量插入）
  onProgress?.({ phase: 'finalize', current: 0, total: 2, message: '构建部门路径' });
  const deptsWithPath = buildDeptPaths(depts);

  onProgress?.({ phase: 'finalize', current: 1, total: 2, message: '写入数据库' });
  // 全量同步：先清空再插入
  await clearDepartments(env.DB);
  await bulkInsertDepartments(env.DB, deptsWithPath);
  await clearUsers(env.DB);
  await bulkInsertUsers(env.DB, users);

  onProgress?.({ phase: 'done', current: 2, total: 2, message: '同步完成' });

  return {
    departments: depts.length,
    users: users.length,
    durationMs: Date.now() - t0,
  };
}

/**
 * 递归拉所有部门
 * 钉钉 /topapi/v2/department/listsub 返回的 result 是数组（不分页）
 */
async function fetchAllDepartments(env: Env, onProgress?: (p: SyncProgress) => void): Promise<DingtalkDepartment[]> {
  const result: DingtalkDepartment[] = [];
  const queue: number[] = [1]; // 根部门 id 通常是 1
  const seen = new Set<number>([1]);

  while (queue.length > 0) {
    const deptId = queue.shift()!;
    // listsub 是 POST 接口，body 传 dept_id
    const data = await dtPost<DingtalkDeptListResponse>(env, '/topapi/v2/department/listsub', {
      dept_id: deptId,
      language: 'zh_CN',
    });
    if (data.errcode !== 0) {
      throw new Error(`拉取部门失败: ${data.errmsg} (dept_id=${deptId}, errcode=${data.errcode})`);
    }
    if (!Array.isArray(data.result)) {
      throw new Error(`钉钉返回 result 不是数组: ${JSON.stringify(data).slice(0, 200)}`);
    }
    for (const d of data.result) {
      if (!seen.has(d.dept_id)) {
        seen.add(d.dept_id);
        result.push({
          dept_id: d.dept_id,
          name: d.name,
          parent_id: d.parent_id || null,
          path: d.name, // 后面 buildDeptPaths 重建
          synced_at: 0,
        });
        queue.push(d.dept_id);
      }
    }
    onProgress?.({ phase: 'departments', current: result.length, total: result.length, message: `已拉 ${result.length} 个部门` });
  }

  return result;
}

/**
 * 按部门拉所有用户
 */
async function fetchAllUsers(
  env: Env,
  depts: DingtalkDepartment[],
  onProgress?: (p: SyncProgress) => void
): Promise<DingtalkUser[]> {
  const result: DingtalkUser[] = [];
  const useridSeen = new Set<string>();
  const deptById = new Map<number, DingtalkDepartment>(depts.map((d) => [d.dept_id, d]));

  for (let i = 0; i < depts.length; i++) {
    const dept = depts[i];
    let cursor = 0;
    do {
      // 钉钉 /topapi/v2/user/list 是 POST 接口，body 传 dept_id / cursor / size
      const data = await dtPost<DingtalkUserListResponse>(env, '/topapi/v2/user/list', {
        dept_id: dept.dept_id,
        cursor,
        size: PAGE_SIZE,
        language: 'zh_CN',
      });
      if (data.errcode !== 0) {
        // 单个部门失败不阻塞，记录后继续
        console.error(`拉取用户失败 dept=${dept.dept_id}: ${data.errmsg}`);
        break;
      }
      if (!Array.isArray(data.result?.list)) {
        console.error(`拉取用户结果 list 不是数组 dept=${dept.dept_id}: ${JSON.stringify(data).slice(0, 200)}`);
        break;
      }
      for (const u of data.result.list) {
        if (useridSeen.has(u.userid)) continue;
        useridSeen.add(u.userid);
        // 部门路径
        const primaryDeptId = u.dept_id_list?.[0] ?? dept.dept_id;
        const deptPath = buildUserDeptPath(primaryDeptId, deptById);
        result.push({
          userid: u.userid,
          name: u.name,
          mobile: u.mobile || null,
          avatar: u.avatar || null,
          dept_id: primaryDeptId,
          dept_path: deptPath,
          title: u.title ?? null,
          is_active: u.active ? 1 : 0,
          synced_at: 0,
        });
      }
      cursor = data.result.has_more ? data.result.next_cursor : -1;
    } while (cursor >= 0);

    onProgress?.({
      phase: 'users',
      current: i + 1,
      total: depts.length,
      message: `已扫 ${i + 1}/${depts.length} 个部门，累计 ${result.length} 个用户`,
    });
  }

  return result;
}

/**
 * 构建部门 path（公司/销售部/销售一组）
 */
function buildDeptPaths(depts: DingtalkDepartment[]): DingtalkDepartment[] {
  const map = new Map<number, DingtalkDepartment>(depts.map((d) => [d.dept_id, { ...d }]));
  function pathFor(id: number): string {
    const d = map.get(id);
    if (!d) return '';
    if (d.parent_id == null) return d.name;
    const parentPath = pathFor(d.parent_id);
    return parentPath ? `${parentPath}/${d.name}` : d.name;
  }
  for (const d of map.values()) {
    d.path = pathFor(d.dept_id);
  }
  return Array.from(map.values());
}

function buildUserDeptPath(deptId: number, deptById: Map<number, DingtalkDepartment>): string {
  const path: string[] = [];
  let current = deptById.get(deptId);
  let guard = 0;
  while (current && guard++ < 20) {
    path.unshift(current.name);
    if (current.parent_id == null) break;
    current = deptById.get(current.parent_id);
  }
  return path.join('/');
}

/**
 * 获取所有子部门（递归）
 */
export async function getSubDepartments(env: Env, rootDeptId: number): Promise<number[]> {
  const all = await listDepartments(env.DB);
  const result: number[] = [];
  const queue: number[] = [rootDeptId];
  const seen = new Set<number>([rootDeptId]);
  const byParent = new Map<number, number[]>();
  for (const d of all) {
    if (d.parent_id == null) continue;
    if (!byParent.has(d.parent_id)) byParent.set(d.parent_id, []);
    byParent.get(d.parent_id)!.push(d.dept_id);
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);
    const children = byParent.get(id) ?? [];
    for (const c of children) {
      if (!seen.has(c)) {
        seen.add(c);
        queue.push(c);
      }
    }
  }
  return result;
}

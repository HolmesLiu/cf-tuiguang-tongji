/**
 * 数据库查询封装
 * 所有 SQL 集中在这里，方便 review 和优化
 */

import type {
  Admin,
  AdminSession,
  ApiKey,
  ArchivedTask,
  ClickLog,
  Config,
  DingtalkDepartment,
  DingtalkUser,
  Receivers,
  Task,
  TaskTarget,
  MessageType,
  TaskStatus,
  SendStatus,
  CopyType,
  PolishedCopy,
} from '../types.ts';
import { hashPassword, randomToken, sha256Hex, randomShortCode, toBase64, randomBytes } from '../utils/crypto.ts';
import { safeJson } from '../utils/json.ts';

// ============ 通用 ============

export async function now(): Promise<number> {
  return Date.now();
}

// ============ Admins ============

export async function getAdminByUsername(db: D1Database, username: string): Promise<Admin | null> {
  return db.prepare('SELECT * FROM admins WHERE username = ?').bind(username).first<Admin>();
}

export async function getAdminById(db: D1Database, id: number): Promise<Admin | null> {
  return db.prepare('SELECT * FROM admins WHERE id = ?').bind(id).first<Admin>();
}

export async function listAdmins(db: D1Database): Promise<Admin[]> {
  const r = await db.prepare('SELECT * FROM admins ORDER BY id ASC').all<Admin>();
  return r.results ?? [];
}

export async function createAdmin(db: D1Database, username: string, password: string): Promise<Admin> {
  const password_hash = await hashPassword(password);
  const r = await db
    .prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?) RETURNING *')
    .bind(username, password_hash, Date.now())
    .first<Admin>();
  if (!r) throw new Error('Failed to create admin');
  return r;
}

export async function touchAdminLogin(db: D1Database, id: number): Promise<void> {
  await db.prepare('UPDATE admins SET last_login_at = ? WHERE id = ?').bind(Date.now(), id).run();
}

// ============ Sessions ============

export async function createSession(db: D1Database, adminId: number, ip: string | null): Promise<AdminSession> {
  const token = randomToken(40);
  const created_at = Date.now();
  const expires_at = created_at + 7 * 24 * 60 * 60 * 1000; // 7 天
  await db
    .prepare('INSERT INTO admin_sessions (token, admin_id, created_at, expires_at, ip) VALUES (?, ?, ?, ?, ?)')
    .bind(token, adminId, created_at, expires_at, ip)
    .run();
  return { token, admin_id: adminId, created_at, expires_at, ip };
}

export async function getSession(db: D1Database, token: string): Promise<AdminSession | null> {
  return db.prepare('SELECT * FROM admin_sessions WHERE token = ?').bind(token).first<AdminSession>();
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run();
}

export async function cleanExpiredSessions(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').bind(Date.now()).run();
}

// ============ Config ============

export async function getConfig(db: D1Database): Promise<Config | null> {
  return db.prepare('SELECT * FROM config WHERE id = 1').first<Config>();
}

export async function updateConfig(
  db: D1Database,
  patch: Partial<Omit<Config, 'id' | 'dingtalk_access_token' | 'dingtalk_token_expires'>>
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) {
      fields.push(`${k} = ?`);
      values.push(v);
    }
  }
  fields.push('updated_at = ?');
  values.push(Date.now());
  // 写配置时清空 access_token（强制下次重新拉）
  fields.push('dingtalk_access_token = NULL');
  fields.push('dingtalk_token_expires = NULL');
  values.push(1);
  await db
    .prepare(`UPDATE config SET ${fields.join(', ')} WHERE id = 1`)
    .bind(...values as never[])
    .run();
}

export async function setAccessToken(db: D1Database, token: string, expiresAt: number): Promise<void> {
  await db
    .prepare('UPDATE config SET dingtalk_access_token = ?, dingtalk_token_expires = ?, updated_at = ? WHERE id = 1')
    .bind(token, expiresAt, Date.now())
    .run();
}

// ============ Departments ============

export async function listDepartments(db: D1Database): Promise<DingtalkDepartment[]> {
  const r = await db.prepare('SELECT * FROM departments ORDER BY dept_id ASC').all<DingtalkDepartment>();
  return r.results ?? [];
}

export async function bulkInsertDepartments(db: D1Database, depts: Omit<DingtalkDepartment, 'synced_at'>[]): Promise<void> {
  if (depts.length === 0) return;
  const synced_at = Date.now();
  // 批量插入，每批 50 条
  const BATCH = 50;
  for (let i = 0; i < depts.length; i += BATCH) {
    const batch = depts.slice(i, i + BATCH);
    const placeholders = batch.map(() => '(?, ?, ?, ?, ?)').join(', ');
    const values = batch.flatMap((d) => [d.dept_id, d.name, d.parent_id, d.path, synced_at]);
    await db.prepare(`INSERT OR REPLACE INTO departments (dept_id, name, parent_id, path, synced_at) VALUES ${placeholders}`)
      .bind(...values as never[])
      .run();
  }
}

export async function clearDepartments(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM departments').run();
}

// ============ Users ============

export async function listUsers(
  db: D1Database,
  opts: { q?: string; dept_id?: number; is_active?: number; page?: number; page_size?: number } = {}
): Promise<{ users: DingtalkUser[]; total: number }> {
  const page = opts.page ?? 1;
  const page_size = opts.page_size ?? 20;
  const offset = (page - 1) * page_size;

  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.q) {
    where.push('(name LIKE ? OR userid LIKE ? OR mobile LIKE ?)');
    const like = `%${opts.q}%`;
    params.push(like, like, like);
  }
  if (opts.dept_id !== undefined) {
    where.push('dept_id = ?');
    params.push(opts.dept_id);
  }
  if (opts.is_active !== undefined) {
    where.push('is_active = ?');
    params.push(opts.is_active);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const totalR = await db
    .prepare(`SELECT COUNT(*) AS c FROM users ${whereSql}`)
    .bind(...params as never[])
    .first<{ c: number }>();
  const total = totalR?.c ?? 0;

  const r = await db
    .prepare(`SELECT * FROM users ${whereSql} ORDER BY name ASC LIMIT ? OFFSET ?`)
    .bind(...params, page_size, offset)
    .all<DingtalkUser>();

  return { users: r.results ?? [], total };
}

export async function getUser(db: D1Database, userid: string): Promise<DingtalkUser | null> {
  return db.prepare('SELECT * FROM users WHERE userid = ?').bind(userid).first<DingtalkUser>();
}

export async function getUsersByDept(db: D1Database, deptId: number, includeSubDepts: number[] = []): Promise<DingtalkUser[]> {
  const allDeptIds = [deptId, ...includeSubDepts];
  const placeholders = allDeptIds.map(() => '?').join(',');
  const r = await db
    .prepare(`SELECT * FROM users WHERE dept_id IN (${placeholders}) AND is_active = 1`)
    .bind(...allDeptIds)
    .all<DingtalkUser>();
  return r.results ?? [];
}

export async function bulkInsertUsers(db: D1Database, users: Omit<DingtalkUser, 'synced_at'>[]): Promise<void> {
  if (users.length === 0) return;
  const synced_at = Date.now();
  const BATCH = 50;
  for (let i = 0; i < users.length; i += BATCH) {
    const batch = users.slice(i, i + BATCH);
    const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values = batch.flatMap((u) => [
      u.userid, u.name, u.mobile, u.avatar, u.dept_id, u.dept_path, u.title, u.is_active, synced_at,
    ]);
    await db.prepare(
      `INSERT OR REPLACE INTO users (userid, name, mobile, avatar, dept_id, dept_path, title, is_active, synced_at)
       VALUES ${placeholders}`
    ).bind(...values as never[]).run();
  }
}

export async function clearUsers(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM users').run();
}

// ============ Tasks ============

export async function getTask(db: D1Database, id: string, includeDeleted = false): Promise<Task | null> {
  const where = includeDeleted ? 'id = ?' : 'id = ? AND deleted_at IS NULL';
  return db.prepare(`SELECT * FROM tasks WHERE ${where}`).bind(id).first<Task>();
}

export async function listTasks(
  db: D1Database,
  opts: { status?: TaskStatus; creator_id?: string; page?: number; page_size?: number; include_deleted?: boolean } = {}
): Promise<{ tasks: Task[]; total: number }> {
  const page = opts.page ?? 1;
  const page_size = opts.page_size ?? 20;
  const offset = (page - 1) * page_size;

  const where: string[] = [];
  const params: unknown[] = [];
  if (!opts.include_deleted) where.push('deleted_at IS NULL');
  if (opts.status) {
    where.push('status = ?');
    params.push(opts.status);
  }
  if (opts.creator_id) {
    where.push('creator_id = ?');
    params.push(opts.creator_id);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const totalR = await db
    .prepare(`SELECT COUNT(*) AS c FROM tasks ${whereSql}`)
    .bind(...params as never[])
    .first<{ c: number }>();
  const total = totalR?.c ?? 0;

  const r = await db
    .prepare(`SELECT * FROM tasks ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...params, page_size, offset)
    .all<Task>();

  return { tasks: r.results ?? [], total };
}

export async function createTask(
  db: D1Database,
  data: Omit<Task, 'created_at' | 'updated_at' | 'published_at' | 'deleted_at'>
): Promise<Task> {
  const now = Date.now();
  await db
    .prepare(`INSERT INTO tasks
      (id, title, original_url, original_content, receivers_json, message_type, status, polished_json,
       created_by, creator_id, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      data.id, data.title, data.original_url, data.original_content,
      data.receivers_json, data.message_type, data.status, data.polished_json,
      data.created_by, data.creator_id, data.source, now, now
    )
    .run();
  return (await getTask(db, data.id, true))!;
}

export async function updateTask(db: D1Database, id: string, patch: Partial<Task>): Promise<Task | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && k !== 'id' && k !== 'created_at') {
      fields.push(`${k} = ?`);
      values.push(v);
    }
  }
  fields.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);
  await db
    .prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values as never[])
    .run();
  return getTask(db, id, true);
}

export async function softDeleteTask(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE tasks SET deleted_at = ?, status = ?, updated_at = ? WHERE id = ?')
    .bind(Date.now(), 'archived', Date.now(), id)
    .run();
}

export async function markTaskPublished(db: D1Database, id: string): Promise<void> {
  const now = Date.now();
  await db.prepare('UPDATE tasks SET status = ?, published_at = ?, updated_at = ? WHERE id = ?')
    .bind('published', now, now, id)
    .run();
}

// ============ TaskTargets ============

export async function listTargetsByTask(db: D1Database, taskId: string): Promise<TaskTarget[]> {
  const r = await db.prepare('SELECT * FROM task_targets WHERE task_id = ?').bind(taskId).all<TaskTarget>();
  return r.results ?? [];
}

export async function getTargetByCode(db: D1Database, code: string): Promise<TaskTarget | null> {
  return db.prepare('SELECT * FROM task_targets WHERE short_code = ?').bind(code).first<TaskTarget>();
}

export async function getTargetByUserid(db: D1Database, taskId: string, userid: string): Promise<TaskTarget | null> {
  return db.prepare('SELECT * FROM task_targets WHERE task_id = ? AND userid = ?')
    .bind(taskId, userid)
    .first<TaskTarget>();
}

export async function createTarget(
  db: D1Database,
  data: Omit<TaskTarget, 'id'>
): Promise<TaskTarget> {
  const r = await db
    .prepare(`INSERT INTO task_targets
      (task_id, userid, short_code, short_url, qr_r2_key, copy_used, copy_type,
       dingtalk_msg_id, sent_at, send_status, send_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`)
    .bind(
      data.task_id, data.userid, data.short_code, data.short_url, data.qr_r2_key,
      data.copy_used, data.copy_type, data.dingtalk_msg_id, data.sent_at,
      data.send_status, data.send_error
    )
    .first<TaskTarget>();
  if (!r) throw new Error('Failed to create target');
  return r;
}

export async function updateTarget(
  db: D1Database,
  id: number,
  patch: Partial<TaskTarget>
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && k !== 'id') {
      fields.push(`${k} = ?`);
      values.push(v);
    }
  }
  if (fields.length === 0) return;
  values.push(id);
  await db
    .prepare(`UPDATE task_targets SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values as never[])
    .run();
}

// ============ ClickLogs ============

export async function createClickLog(db: D1Database, log: Omit<ClickLog, 'id'>): Promise<void> {
  await db
    .prepare(`INSERT INTO click_logs
      (short_code, task_id, userid, clicked_at, ip, user_agent, browser, os, device_type, referer, country, city)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      log.short_code, log.task_id, log.userid, log.clicked_at,
      log.ip, log.user_agent, log.browser, log.os, log.device_type,
      log.referer, log.country, log.city
    )
    .run();
}

export async function listClicksByTarget(
  db: D1Database,
  taskId: string,
  userid: string,
  page = 1,
  pageSize = 50
): Promise<{ logs: ClickLog[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const totalR = await db
    .prepare('SELECT COUNT(*) AS c FROM click_logs WHERE task_id = ? AND userid = ?')
    .bind(taskId, userid)
    .first<{ c: number }>();
  const total = totalR?.c ?? 0;
  const r = await db
    .prepare('SELECT * FROM click_logs WHERE task_id = ? AND userid = ? ORDER BY clicked_at DESC LIMIT ? OFFSET ?')
    .bind(taskId, userid, pageSize, offset)
    .all<ClickLog>();
  return { logs: r.results ?? [], total };
}

export async function countClicksByTask(db: D1Database, taskId: string): Promise<{
  total: number;
  uniqueIps: number;
  uniquePromoters: number;
  byDevice: Record<string, number>;
  byCountry: Record<string, number>;
  byHour: number[];
  byBrowser: Record<string, number>;
  byOs: Record<string, number>;
  byReferer: Record<string, number>;
}> {
  const rows = await db
    .prepare('SELECT * FROM click_logs WHERE task_id = ?')
    .bind(taskId)
    .all<ClickLog>();
  const logs = rows.results ?? [];
  return aggregateClicks(logs);
}

export function aggregateClicks(logs: ClickLog[]): {
  total: number;
  uniqueIps: number;
  uniquePromoters: number;
  byDevice: Record<string, number>;
  byCountry: Record<string, number>;
  byHour: number[];
  byBrowser: Record<string, number>;
  byOs: Record<string, number>;
  byReferer: Record<string, number>;
} {
  const ips = new Set<string>();
  const users = new Set<string>();
  const byDevice: Record<string, number> = {};
  const byCountry: Record<string, number> = {};
  const byHour = new Array(24).fill(0);
  const byBrowser: Record<string, number> = {};
  const byOs: Record<string, number> = {};
  const byReferer: Record<string, number> = {};

  for (const log of logs) {
    if (log.ip) ips.add(log.ip);
    if (log.userid) users.add(log.userid);
    bump(byDevice, log.device_type ?? 'unknown');
    bump(byCountry, log.country ?? 'unknown');
    if (log.clicked_at) {
      const h = new Date(log.clicked_at).getHours();
      byHour[h]++;
    }
    bump(byBrowser, log.browser ?? 'unknown');
    bump(byOs, log.os ?? 'unknown');
    if (log.referer) {
      // 简化：用 host 部分作为归一 key
      try {
        const u = new URL(log.referer);
        bump(byReferer, u.host);
      } catch {
        bump(byReferer, log.referer);
      }
    }
  }

  return {
    total: logs.length,
    uniqueIps: ips.size,
    uniquePromoters: users.size,
    byDevice,
    byCountry,
    byHour,
    byBrowser,
    byOs,
    byReferer,
  };
}

function bump(obj: Record<string, number>, key: string): void {
  obj[key] = (obj[key] ?? 0) + 1;
}

// ============ Promoter Ranking ============

export async function getPromoterRanking(db: D1Database, taskId: string): Promise<
  Array<{ userid: string; name: string; clicks: number; unique_ips: number }>
> {
  const r = await db
    .prepare(`
      SELECT c.userid, u.name,
        COUNT(*) AS clicks,
        COUNT(DISTINCT c.ip) AS unique_ips
      FROM click_logs c
      LEFT JOIN users u ON c.userid = u.userid
      WHERE c.task_id = ?
      GROUP BY c.userid
      ORDER BY unique_ips DESC
    `)
    .bind(taskId)
    .all<{ userid: string; name: string; clicks: number; unique_ips: number }>();
  return r.results ?? [];
}

// ============ ArchivedTasks ============

export async function archiveTask(
  db: D1Database,
  taskId: string,
  archivedBy: string
): Promise<void> {
  const task = await getTask(db, taskId, true);
  if (!task) throw new Error('Task not found');
  const targets = await listTargetsByTask(db, taskId);
  const stats = await countClicksByTask(db, taskId);
  const snapshot = JSON.stringify({ task, targets, stats });
  await db
    .prepare('INSERT INTO archived_tasks (task_id, snapshot, archived_at, archived_by) VALUES (?, ?, ?, ?)')
    .bind(taskId, snapshot, Date.now(), archivedBy)
    .run();
}

export async function listArchived(db: D1Database): Promise<ArchivedTask[]> {
  const r = await db
    .prepare('SELECT * FROM archived_tasks ORDER BY archived_at DESC')
    .all<ArchivedTask>();
  return r.results ?? [];
}

export async function getArchived(db: D1Database, taskId: string): Promise<ArchivedTask | null> {
  return db
    .prepare('SELECT * FROM archived_tasks WHERE task_id = ? ORDER BY archived_at DESC LIMIT 1')
    .bind(taskId)
    .first<ArchivedTask>();
}

export async function deleteArchived(db: D1Database, taskId: string): Promise<void> {
  await db.prepare('DELETE FROM archived_tasks WHERE task_id = ?').bind(taskId).run();
  await db.prepare('DELETE FROM tasks WHERE id = ?').bind(taskId).run();
  await db.prepare('DELETE FROM task_targets WHERE task_id = ?').bind(taskId).run();
  await db.prepare('DELETE FROM click_logs WHERE task_id = ?').bind(taskId).run();
}

export async function restoreArchived(db: D1Database, taskId: string): Promise<void> {
  await db.prepare('UPDATE tasks SET deleted_at = NULL, status = ?, updated_at = ? WHERE id = ?')
    .bind('draft', Date.now(), taskId)
    .run();
  await db.prepare('DELETE FROM archived_tasks WHERE task_id = ?').bind(taskId).run();
}

// ============ API Keys ============

export async function listApiKeys(db: D1Database): Promise<Omit<ApiKey, 'key_hash'>[]> {
  const r = await db
    .prepare('SELECT id, name, key_prefix, created_at, last_used_at, is_active FROM api_keys ORDER BY id DESC')
    .all<Omit<ApiKey, 'key_hash'>>();
  return r.results ?? [];
}

export async function createApiKey(db: D1Database, name: string): Promise<{ apiKey: ApiKey; plainKey: string }> {
  const plainKey = `tk_${randomToken(40)}`;
  const key_hash = await sha256Hex(plainKey);
  const key_prefix = plainKey.slice(0, 8);
  const r = await db
    .prepare('INSERT INTO api_keys (name, key_hash, key_prefix, created_at, is_active) VALUES (?, ?, ?, ?, 1) RETURNING *')
    .bind(name, key_hash, key_prefix, Date.now())
    .first<ApiKey>();
  if (!r) throw new Error('Failed to create api key');
  return { apiKey: r, plainKey };
}

export async function findActiveApiKey(db: D1Database, plainKey: string): Promise<ApiKey | null> {
  const key_hash = await sha256Hex(plainKey);
  return db
    .prepare('SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1')
    .bind(key_hash)
    .first<ApiKey>();
}

export async function touchApiKey(db: D1Database, id: number): Promise<void> {
  await db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').bind(Date.now(), id).run();
}

export async function revokeApiKey(db: D1Database, id: number): Promise<void> {
  await db.prepare('UPDATE api_keys SET is_active = 0 WHERE id = ?').bind(id).run();
}

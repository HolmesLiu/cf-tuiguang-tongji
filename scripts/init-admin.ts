/**
 * 默认管理员初始化脚本
 * 用法：npx wrangler d1 execute cf-tuiguang-tongji --command "SELECT 1" 先确认数据库 OK
 *      然后通过 wrangler 控制台或 D1 Studio 执行：
 *      INSERT INTO admins (username, password_hash, created_at) VALUES (...)
 *
 * 或者本地用：wrangler dev 启动后调用 POST /api/admin/init 一次性接口
 * 首次启动时会自动建默认 admin/admin123（生产环境务必修改）
 */

import type { Env } from '../src/types.ts';
import { hashPassword } from '../src/utils/crypto.ts';
import { getAdminByUsername, createAdmin } from '../src/db/queries.ts';

/**
 * 自动初始化默认 admin（如果没有任何管理员）
 * 在 worker.ts 启动时调用
 */
export async function ensureDefaultAdmin(env: Env): Promise<void> {
  const existing = await getAdminByUsername(env.DB, 'admin');
  if (existing) return;
  // 创建默认 admin / admin123
  await createAdmin(env.DB, 'admin', 'admin123');
  console.warn('⚠️ 默认管理员已创建：admin / admin123，请登录后立即修改密码！');
}

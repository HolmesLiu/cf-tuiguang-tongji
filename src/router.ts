/**
 * 路由分发
 */

import type { Ctx, Env } from './types.ts';
import { fail } from './utils/json.ts';
import { handleShortLink } from './links/redirect.ts';
import { handleServeQr } from './links/serveQr.ts';
import {
  handleAdminLogin,
  handleAdminLogout,
  handleAdminMe,
} from './api/admin/auth.ts';
import {
  handleGetConfig,
  handleUpdateConfig,
  handleSetToken,
} from './api/admin/config.ts';
import {
  handleListDepartments,
  handleListUsers,
  handleSyncContacts,
  handleSyncStatus,
} from './api/admin/contacts.ts';
import {
  handleListTasks,
  handleGetTask,
  handleUpdateTask,
  handleDeleteTask,
  handlePublishTask,
  handleTaskStats,
  handleTargetClicks,
} from './api/admin/tasks.ts';
import {
  handleListApiKeys,
  handleCreateApiKey,
  handleRevokeApiKey,
} from './api/admin/apiKeys.ts';
import {
  handleListArchived,
  handleRestoreArchived,
  handleHardDeleteArchived,
} from './api/admin/archived.ts';
import {
  handleAgentCreateTask,
  handleAgentPublishTask,
  handleAgentListTasks,
  handleAgentGetTask,
  handleAgentGetTargetClicks,
} from './api/agent/tasks.ts';
import {
  handleAgentSearchUsers,
  handleAgentListDepartments,
} from './api/agent/users.ts';

type Handler = (ctx: Ctx) => Promise<Response> | Response;

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
  paramNames: string[];
}

function compileRoute(method: string, path: string, handler: Handler): Route {
  const paramNames: string[] = [];
  const pattern = new RegExp(
    '^' +
      path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => {
        paramNames.push(name);
        return '([^/]+)';
      }) +
      '/?$'
  );
  return { method, pattern, handler, paramNames };
}

const routes: Route[] = [
  // ============ 短链中转 / 二维码 ============
  compileRoute('GET', '/s/:code', (ctx) => handleShortLink(ctx.env, ctx.params.code, ctx.request)),
  compileRoute('GET', '/qr/:key', (ctx) => handleServeQr(ctx.env, ctx.params.key)),

  // ============ 后台认证 ============
  compileRoute('POST', '/api/admin/login', (ctx) => handleAdminLogin(ctx.env, ctx.request)),
  compileRoute('POST', '/api/admin/logout', (ctx) => handleAdminLogout(ctx.env, ctx.request)),
  compileRoute('GET', '/api/admin/me', (ctx) => handleAdminMe(ctx)),

  // ============ 后台配置 ============
  compileRoute('GET', '/api/config', handleGetConfig),
  compileRoute('PUT', '/api/config', handleUpdateConfig),
  compileRoute('POST', '/api/config/token', handleSetToken),

  // ============ 后台通讯录 ============
  compileRoute('GET', '/api/departments', handleListDepartments),
  compileRoute('GET', '/api/users', handleListUsers),
  compileRoute('POST', '/api/contacts/sync', handleSyncContacts),
  compileRoute('GET', '/api/contacts/sync/status', handleSyncStatus),

  // ============ 后台任务 ============
  compileRoute('GET', '/api/tasks', handleListTasks),
  compileRoute('POST', '/api/tasks', (ctx) => {
    // 兼容 GET POST 都可用
    const body = ctx.request.body ? { method: 'POST' } : {};
    void body;
    // 实际 handler 内部读 body
    return handleAdminCreateTaskProxy(ctx);
  }),
  compileRoute('GET', '/api/tasks/:id', handleGetTask),
  compileRoute('PUT', '/api/tasks/:id', handleUpdateTask),
  compileRoute('DELETE', '/api/tasks/:id', handleDeleteTask),
  compileRoute('POST', '/api/tasks/:id/publish', handlePublishTask),
  compileRoute('GET', '/api/tasks/:id/stats', handleTaskStats),
  compileRoute('GET', '/api/tasks/:id/targets/:userid/clicks', handleTargetClicks),

  // ============ 后台归档 ============
  compileRoute('GET', '/api/archive', handleListArchived),
  compileRoute('POST', '/api/archive/:taskId/restore', handleRestoreArchived),
  compileRoute('DELETE', '/api/archive/:taskId', handleHardDeleteArchived),

  // ============ 后台 API Key ============
  compileRoute('GET', '/api/api-keys', handleListApiKeys),
  compileRoute('POST', '/api/api-keys', handleCreateApiKey),
  compileRoute('DELETE', '/api/api-keys/:id', handleRevokeApiKey),

  // ============ Agent API ============
  compileRoute('POST', '/api/agent/tasks', handleAgentCreateTask),
  compileRoute('GET', '/api/agent/tasks', handleAgentListTasks),
  compileRoute('POST', '/api/agent/tasks/:id/publish', handleAgentPublishTask),
  compileRoute('GET', '/api/agent/tasks/:id', handleAgentGetTask),
  compileRoute('GET', '/api/agent/tasks/:id/targets/:userid/clicks', handleAgentGetTargetClicks),
  compileRoute('GET', '/api/agent/users/search', handleAgentSearchUsers),
  compileRoute('GET', '/api/agent/departments', handleAgentListDepartments),
];

// Proxy：把后台"创建任务"复用 agent 的 handler
async function handleAdminCreateTaskProxy(ctx: Ctx): Promise<Response> {
  // 后台创建：需要 admin 鉴权，复用 admin 路径
  const { requireAdmin } = await import('./auth/admin.ts');
  const r = await requireAdmin(ctx);
  if (!r.ok) return r.response;
  const { handleCreateTask } = await import('./tasks/create.ts');
  const body = await ctx.request.json().catch(() => null);
  return handleCreateTask(ctx.env.DB, body, {
    source: 'dashboard',
    createdBy: r.admin.username,
    creatorId: String(r.admin.id),
  });
}

/**
 * 路由匹配
 */
export async function route(env: Env, req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = url.pathname.match(r.pattern);
    if (!m) continue;
    const params: Record<string, string> = {};
    for (let i = 0; i < r.paramNames.length; i++) {
      params[r.paramNames[i]] = decodeURIComponent(m[i + 1]);
    }
    const ctx: Ctx = { request: req, env, url, params };
    return await r.handler(ctx);
  }
  return null;
}

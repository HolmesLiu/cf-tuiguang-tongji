/**
 * Worker 入口
 */

import type { Env } from './types.ts';
import { route } from './router.ts';
import { ensureDefaultAdmin } from '../scripts/init-admin.ts';

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // 首次启动：自动建默认 admin（仅当表为空时）
    try {
      // 只在第一次请求时执行（用 KV 标记）
      const flag = await env.KV.get('init:default_admin');
      if (!flag) {
        await ensureDefaultAdmin(env);
        await env.KV.put('init:default_admin', '1', { expirationTtl: 86400 });
      }
    } catch (e) {
      console.error('init admin failed:', e);
    }

    try {
      // 1. 尝试 API 路由
      const r = await route(env, req);
      if (r) return r;

      // 2. 静态资源（Workers Static Assets）
      if (env.ASSETS) {
        const assetResp = await env.ASSETS.fetch(req);
        if (assetResp.status !== 404) return assetResp;
      }

      // 3. SPA fallback：未匹配资源 → /index.html
      if (env.ASSETS && req.method === 'GET') {
        return env.ASSETS.fetch(new URL('/index.html', req.url));
      }

      return new Response('Not Found', { status: 404 });
    } catch (e) {
      console.error('worker error:', e);
      const msg = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? (e.stack || '').split('\n').slice(0, 5).join('\n') : '';
      return new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: msg,
            details: { stack, hint: '查看 docs/05-部署指南.md 或查看官方通讯录接口权限' }
          }
        }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }
  },
} satisfies ExportedHandler<Env>;

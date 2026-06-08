/**
 * Worker 入口
 * - HTTP fetch handler
 * - Scheduled handler（cron 推进通讯录分批同步）
 */

import type { Env } from './types.ts';
import { route } from './router.ts';
import { ensureDefaultAdmin } from '../scripts/init-admin.ts';
import { processNextBatch } from './dingtalk/syncBatch.ts';

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // 首次启动：自动建默认 admin（仅当表为空时）
    try {
      const flag = await env.KV.get('init:default_admin');
      if (!flag) {
        await ensureDefaultAdmin(env);
        await env.KV.put('init:default_admin', '1', { expirationTtl: 86400 });
      }
    } catch (e) {
      console.error('init admin failed:', e);
    }

    try {
      const r = await route(env, req);
      if (r) return r;

      if (env.ASSETS) {
        const assetResp = await env.ASSETS.fetch(req);
        if (assetResp.status !== 404) return assetResp;
      }

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
            details: { stack, hint: '查看 docs/05-部署指南.md' }
          }
        }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }
  },

  /**
   * Cron 触发（每 5 分钟）
   * 推进通讯录分批同步
   */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          console.log(`[cron] tick at ${new Date(event.scheduledTime).toISOString()}`);
          await processNextBatch(env);
        } catch (e) {
          console.error('[cron] sync batch failed:', e);
        }
      })()
    );
  },
} satisfies ExportedHandler<Env>;

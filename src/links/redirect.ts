/**
 * 短链中转 + 点击埋点
 * GET /s/:code
 */

import type { Env } from '../types.ts';
import { getTargetByCode, getTask, createClickLog } from '../db/queries.ts';
import { parseUA } from '../tracking/ua.ts';
import { normalizeReferer } from '../tracking/referer.ts';

const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>链接不存在</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #f5f5f7; min-height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0; }
    .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); text-align: center; max-width: 360px; }
    h1 { color: #333; margin: 0 0 12px; font-size: 22px; }
    p { color: #666; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🌸 链接不存在</h1>
    <p>短链无效或已被删除</p>
  </div>
</body>
</html>`;

export async function handleShortLink(env: Env, code: string, req: Request): Promise<Response> {
  const target = await getTargetByCode(env.DB, code);
  if (!target) {
    return new Response(NOT_FOUND_HTML, {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  // 软删检查：先看 task
  const task = await getTask(env.DB, target.task_id, true);
  if (!task || task.deleted_at !== null) {
    return new Response(NOT_FOUND_HTML, {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  // 解析请求头
  const ua = parseUA(req.headers.get('user-agent'));
  const referer = normalizeReferer(req.headers.get('referer'));
  const ip = req.headers.get('cf-connecting-ip') ?? null;
  const country = req.headers.get('cf-ipcountry') ?? null;
  const city = req.headers.get('cf-ipcity') ?? null;

  // 写日志（异步等待，但放在跳转前 - 确保不丢）
  try {
    await createClickLog(env.DB, {
      short_code: code,
      task_id: target.task_id,
      userid: target.userid,
      clicked_at: Date.now(),
      ip,
      user_agent: req.headers.get('user-agent'),
      browser: ua.browser,
      os: ua.os,
      device_type: ua.device_type,
      referer,
      country,
      city,
    });
  } catch (e) {
    console.error('click log failed:', e);
  }

  // 302 跳转
  return new Response(null, {
    status: 302,
    headers: { location: task.original_url },
  });
}

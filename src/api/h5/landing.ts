/**
 * H5 详情页（公开访问）
 * 推广人点这个链接能看到：任务标题 + 推广文案 + SVG 二维码 + 跳转原 URL 按钮
 * 解决：钉钉工作通知不显示 SVG 图片 + 推广时想看二维码
 */

import type { Env } from '../../types.ts';
import { getTargetByCode, getTask, getUserToken } from '../../db/queries.ts';
import { safeJson } from '../../utils/json.ts';

const HTML_HEAD = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <title>专属推广详情</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #f5f5f7; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; color: #1d1d1f; min-height: 100vh; }
    .wrap { max-width: 480px; margin: 0 auto; padding: 20px 16px 40px; }
    .card { background: white; border-radius: 16px; padding: 24px 20px; margin-bottom: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.05); }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
    .sub { color: #86868b; font-size: 13px; margin-bottom: 16px; }
    .qr-box { text-align: center; padding: 20px; background: #fbfbfd; border-radius: 12px; margin: 16px 0; }
    .qr-box img { max-width: 240px; width: 100%; height: auto; display: block; margin: 0 auto; }
    .qr-hint { color: #86868b; font-size: 12px; margin-top: 8px; }
    .copy-section { margin-top: 16px; }
    .copy-label { font-size: 12px; color: #86868b; text-transform: uppercase; margin-bottom: 6px; font-weight: 500; }
    .copy-text { background: #fbfbfd; padding: 12px; border-radius: 8px; font-size: 14px; line-height: 1.6; word-break: break-word; margin-bottom: 12px; }
    .copy-text.short { white-space: pre-line; }
    .btn { display: block; width: 100%; padding: 14px; background: #0066cc; color: white; border: none; border-radius: 10px; font-size: 16px; font-weight: 500; text-align: center; text-decoration: none; margin-top: 8px; }
    .btn:active { background: #0055aa; }
    .btn-secondary { background: #f5f5f7; color: #0066cc; border: 1px solid #d2d2d7; margin-top: 8px; }
    .short-url { background: #fbfbfd; padding: 8px 12px; border-radius: 6px; font-size: 12px; word-break: break-all; color: #0066cc; font-family: "SF Mono", Menlo, monospace; }
    .stats { text-align: center; color: #86868b; font-size: 12px; margin-top: 24px; }
    .oauth-status { padding: 10px 12px; border-radius: 8px; margin-top: 12px; font-size: 13px; }
    .oauth-status.authorized { background: #d1f4e0; color: #00875a; }
    .oauth-hint { color: #86868b; font-size: 11px; margin-top: 6px; }
    .oauth-banner { position: fixed; top: 0; left: 0; right: 0; background: #00875a; color: white; padding: 12px; text-align: center; z-index: 1000; font-size: 14px; }
    .oauth-banner.error { background: #d70015; }
  </style>
</head>
<body>
  <div class="wrap">`;

const HTML_FOOT = `
  </div>
  <script>
    // 长按图片保存提示
    document.addEventListener('DOMContentLoaded', function() {
      const img = document.querySelector('.qr-box img');
      if (img) {
        img.addEventListener('contextmenu', function(e) { e.preventDefault(); });
      }

      // OAuth 按钮：点一下 → 跳转到钉钉授权页
      const oauthBtn = document.getElementById('oauth-btn');
      if (oauthBtn) {
        oauthBtn.addEventListener('click', function() {
          const userid = oauthBtn.getAttribute('data-userid');
          if (!userid) return;
          // 用 window.location 触发 302 跳转（handleOAuthAuthorize 返回 302）
          window.location.href = '/api/oauth/authorize?userid=' + encodeURIComponent(userid);
        });
      }
    });
  </script>
</body>
</html>`;

export async function handleH5Landing(env: Env, code: string, origin: string): Promise<Response> {
  const target = await getTargetByCode(env.DB, code);
  if (!target) {
    return new Response('链接不存在', { status: 404 });
  }
  const task = await getTask(env.DB, target.task_id, true);
  if (!task || task.deleted_at !== null) {
    return new Response('链接已失效', { status: 404 });
  }

  const polished = safeJson<{ friend_circle?: string; group?: string; private?: string }>(task.polished_json, {});
  const copies = [
    { label: '📱 朋友圈版', text: polished.friend_circle || '' },
    { label: '👥 群发版', text: polished.group || '' },
    { label: '💬 私聊版', text: polished.private || '' },
  ];

  // 优先用 copy_used（任务实际发的文案），fallback 到 friend_circle
  const primaryCopy = target.copy_used || polished.friend_circle || '';

  const qrImgUrl = target.qr_r2_key ? `${origin}/qr/${target.qr_r2_key}` : '';
  const originUrl = task.original_url;

  // 查推广人 OAuth 授权状态
  const token = await getUserToken(env.DB, target.userid);
  const oauthAuthorized = !!token;
  const oauthBlock = oauthAuthorized
    ? `<div class="oauth-status authorized">✅ 已开启待办通知（你将收到钉钉待办）</div>`
    : `<button class="btn btn-secondary" id="oauth-btn" data-userid="${escAttr(target.userid)}" data-code="${escAttr(code)}">📌 开启钉钉待办通知（可选）</button>
       <p class="oauth-hint">开启后任务会以"个人待办"形式发到你钉钉，关闭则发"工作通知"。</p>`;

  const html = `${HTML_HEAD}
    <div class="card">
      <h1>📣 ${escapeHtml(task.title || '推广任务')}</h1>
      <div class="sub">${escapeHtml(target.userid)} 专属推广链接</div>

      <div class="qr-box">
        <img src="${escapeHtml(qrImgUrl)}" alt="专属二维码">
        <div class="qr-hint">长按图片 → 保存到相册 → 微信发送</div>
      </div>

      <div class="copy-section">
        <div class="copy-label">你的推广链接</div>
        <div class="short-url">${escapeHtml(target.short_url || '')}</div>
      </div>

      <a href="${escapeHtml(originUrl)}" class="btn" target="_blank" rel="noopener">🚀 打开原始推广页</a>
      <button class="btn btn-secondary" onclick="navigator.clipboard?.writeText('${escapeHtml(target.short_url || '')}')">📋 复制推广链接</button>
      ${oauthBlock}
    </div>

    ${primaryCopy ? `
    <div class="card">
      <div class="copy-label">推广文案</div>
      <div class="copy-text short">${escapeHtml(primaryCopy)}</div>
    </div>
    ` : ''}

    ${copies.filter(c => c.text && c.text !== primaryCopy).map(c => `
    <div class="card">
      <div class="copy-label">${escapeHtml(c.label)}</div>
      <div class="copy-text short">${escapeHtml(c.text)}</div>
    </div>
    `).join('')}

    <div class="stats">🌸 cf推广统计 · 每次点击都为你记录</div>
  ${HTML_FOOT}`;

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]!));
}

// HTML 属性里用，额外转义空格和等号
function escAttr(s: string): string {
  return escapeHtml(s).replace(/\s/g, '');
}

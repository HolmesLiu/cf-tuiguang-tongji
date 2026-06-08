/**
 * 钉钉待办（v1 新版 API）
 * - 用 user access_token（OAuth 授权后）调新版接口
 * - 文档: https://open.dingtalk.com/document/development/api-createpersonaltodotask
 * - 接口: POST /v1.0/todo/users/me/personalTasks
 * - 鉴权: Header x-acs-dingtalk-access-token
 */

import type { Env } from '../types.ts';
import { userFetch, refreshAccessToken } from './oauth.ts';
import { getUserToken, upsertUserToken } from '../db/queries.ts';

export interface WorkrecordAddResponse {
  errcode: number;
  errmsg: string;
  taskId?: string;
  createdTime?: number;
}

/**
 * 用 user access_token 发个人待办
 * - 内部自动处理 token 过期（用 refresh_token 刷新）
 */
export async function sendPersonalTodo(
  env: Env,
  userid: string,
  subject: string,
  description?: string
): Promise<WorkrecordAddResponse> {
  // 1. 拿 user token
  let token = await getUserToken(env.DB, userid);
  if (!token) {
    return { errcode: -1, errmsg: '该推广人未授权 OAuth，请先在 H5 详情页点击「开启待办通知」' };
  }

  // 2. 查 token 是否过期（留 5 分钟 buffer）
  let accessToken = token.access_token;
  if (token.expires_at < Date.now() + 5 * 60 * 1000) {
    // 刷新
    try {
      const refreshed = await refreshAccessToken(env, token.refresh_token);
      const newExpires = Date.now() + refreshed.expireIn * 1000;
      const newRefreshExpires = refreshed.refreshTokenExpireIn
        ? Date.now() + refreshed.refreshTokenExpireIn * 1000
        : token.refresh_expires_at;
      await upsertUserToken(env.DB, {
        userid,
        access_token: refreshed.accessToken,
        refresh_token: refreshed.refreshToken,
        expires_at: newExpires,
        refresh_expires_at: newRefreshExpires,
        scope: refreshed.scope,
        union_id: token.union_id,
      });
      accessToken = refreshed.accessToken;
    } catch (e) {
      return {
        errcode: -1,
        errmsg: `刷新 token 失败（推广人需要重新授权）: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  // 3. 调新版 API
  // unionId 是必填的，OAuth 回调时已经存了
  if (!token.union_id) {
    return { errcode: -1, errmsg: '推广人 token 缺 unionId（重新授权）' };
  }

  const r = await userFetch(env, accessToken, '/v1.0/todo/users/me/personalTasks', {
    method: 'POST',
    body: JSON.stringify({
      subject,
      description: description || subject,
      executorIds: [token.union_id],
      notifyConfigs: { dingNotify: '1' },
    }),
  });

  const data = (await r.json()) as WorkrecordAddResponse;
  if (data.errcode === undefined) {
    // 401 时 token 失效
    if (r.status === 401) {
      return { errcode: 401, errmsg: 'token 已失效，推广人需重新授权' };
    }
    return { errcode: r.status, errmsg: `HTTP ${r.status}` };
  }
  return data;
}

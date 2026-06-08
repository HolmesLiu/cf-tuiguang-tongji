/**
 * 钉钉待办
 * 文档：https://open.dingtalk.com/document/orgapp/workrecord-add
 * 接口：/topapi/workrecord/add
 *
 * 鉴权：只需要 corp access_token（不需要用户 OAuth）
 */

import type { Env } from '../types.ts';
import { dtPost } from './client.ts';

export interface WorkrecordAddResponse {
  errcode: number;
  errmsg: string;
  record_id?: string;
  request_id?: string;
}

export interface AddWorkrecordInput {
  userid: string;
  title: string;
  url: string;            // 待办点击跳转 URL
  createTime?: number;    // 毫秒时间戳
  formItemList?: Array<{ title: string; content: string }>;
  sourceName?: string;    // 来源名称（显示在待办卡片上）
}

/**
 * 创建钉钉待办（单个用户）
 */
export async function addWorkrecord(env: Env, input: AddWorkrecordInput): Promise<WorkrecordAddResponse> {
  if (!env.DINGTALK_AGENT_ID) throw new Error('DINGTALK_AGENT_ID 未配置');

  const body = {
    userid: input.userid,
    title: input.title,
    url: input.url,
    create_time: input.createTime ?? Date.now(),
    source_name: input.sourceName ?? 'cf推广统计',
    form_item_list: input.formItemList ?? [],
  };

  return dtPost<WorkrecordAddResponse>(env, '/topapi/workrecord/add', body);
}

/**
 * 批量创建待办（用 Promise.allSettled，并发但有上限）
 */
export async function batchAddWorkrecords(
  env: Env,
  list: AddWorkrecordInput[],
  concurrency = 5
): Promise<Array<{ userid: string; result: WorkrecordAddResponse | Error }>> {
  const results: Array<{ userid: string; result: WorkrecordAddResponse | Error }> = [];
  for (let i = 0; i < list.length; i += concurrency) {
    const batch = list.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map((item) => addWorkrecord(env, item)));
    for (let j = 0; j < settled.length; j++) {
      const s = settled[j];
      results.push({
        userid: batch[j].userid,
        result: s.status === 'fulfilled' ? s.value : s.reason,
      });
    }
  }
  return results;
}
